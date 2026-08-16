/**
 * V3.5 — SourcingEvidencePanel UI 测试（SSR 静态渲染 + 文案纪律 + 状态语义）
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourcingEvidencePanel } from "@/components/cross-border/SourcingEvidencePanel";

vi.mock("@/lib/client/accessPassword", () => ({
  useAccessPassword: () => ["test-password"],
}));
vi.mock("@/lib/client/accessToken", () => ({
  buildAccessHeaders: () => ({ "x-access-token": "test" }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPanel() {
  return renderToStaticMarkup(createElement(SourcingEvidencePanel, {
    taskId: "task-1",
    amazonContext: { title: "亚马逊候选保温杯", image: null, asin: null },
  }));
}

describe("SourcingEvidencePanel 文案纪律与结构", () => {
  it("渲染供应线索面板与三个获取入口", () => {
    const html = renderPanel();
    expect(html).toContain("供应线索（1688）");
    expect(html).toContain("关键词找货");
    expect(html).toContain("图片找货");
    expect(html).toContain("已有 1688 链接");
    expect(html).toContain("候选主图 https:// 链接");
  });

  it("图片找货就绪状态与扩展加载引导（业务语言，不出现技术术语）", () => {
    const html = renderPanel();
    // D1：toolStatus 未知时按能力独立提示（图片找货依赖扩展，不依赖 CLI 登录）
    expect(html).toContain("图片找货");
    expect(html).toContain("需要先在 Chrome 中加载浏览器助手扩展");
    expect(html).toContain("chrome://extensions");
    expect(html).toContain("已加载，重新检测");
    expect(html).not.toContain("1688-cli");
    expect(html).not.toContain("Qingxuan");
    expect(html).not.toContain("CDP");
    expect(html).not.toContain("shadow");
    expect(html).not.toContain("resolver");
    expect(html).not.toContain("V35");
  });

  it("关键词与链接入口显示登录状态徽章与引导（无 1688-cli 字样）", () => {
    const html = renderPanel();
    expect(html).toContain("需登录 1688");
    expect(html).toContain("需要先登录 1688 后使用（见顶部登录提示）");
    expect(html).not.toContain("1688-cli");
  });

  it("R1：两套登录态明确区分 + 登录窗口 CTA + 重新检测反馈", () => {
    const html = renderPanel();
    // 两套独立登录说明（常驻可见）
    expect(html).toContain("1688 有两套相互独立的登录");
    expect(html).toContain("关键词找货 / 链接读取");
    expect(html).toContain("图片找货");
    expect(html).toContain("互不影响");
    // 重新检测按钮（扩展区 SSR 可见）
    expect(html).toContain("重新检测");
    // 普通 Chrome 登录说明（图片找货独立于 CLI）
    expect(html).toContain("图片找货需确认已在普通 Chrome 中登录 1688");
    // 无技术术语
    expect(html).not.toContain("1688-cli");
    expect(html).not.toContain("命令提示符");
    expect(html).not.toContain("V35");
  });

  it("禁止文案零出现：无推荐/评分/采购建议", () => {
    const html = renderPanel();
    for (const forbidden of ["最佳供应商", "推荐供应商", "最优货源", "靠谱指数", "采购指数", "成功率", "建议购买", "采购成本", "purchaseCost"]) {
      expect(html).not.toContain(forbidden);
    }
  });

  it("允许文案：供应线索 / 搜索入口就绪", () => {
    const html = renderPanel();
    expect(html).toContain("供应线索（1688）");
    expect(html).toContain("搜索");
    expect(html).toContain("图搜");
    expect(html).toContain("读取");
  });
});

describe("SourcingEvidencePanel 询盘问题生成（确定性，不猜事实）", () => {
  it("无 MOQ/阶梯/SKU → 生成对应确认问题", async () => {
    const { buildInquiryQuestions } = await import("@/components/cross-border/SourcingEvidencePanel");
    const questions = buildInquiryQuestions({
      schema: "acquisition-candidate.v1",
      source: "1688",
      offerId: "674035283676",
      sourceUrl: "https://detail.1688.com/offer/674035283676.html",
      capturedAt: "2026-08-15T00:00:00.000Z",
      acquisitionMethod: "keyword",
      sourceProductRole: "candidate",
      title: "保温杯",
      images: [],
      displayedPrice: { text: "¥16", nature: "displayed_price" },
      priceRange: { min: 16, max: 16, text: "¥16" },
      priceTiers: [],
      displayedMoq: null,
      skuSpecs: [],
      sellerClaims: [{ name: "材质", value: "304不锈钢", evidenceClass: "seller_claim" }],
      platformMetadata: [],
      supplierDisplayName: "测试供应商",
      matchState: null,
    });
    expect(questions.some((question) => question.includes("起批量"))).toBe(true);
    expect(questions.some((question) => question.includes("数量阶梯"))).toBe(true);
    expect(questions.some((question) => question.includes("SKU"))).toBe(true);
    // 有材质 claim → 不重复问材质；有定制 claim → 不问定制
    const withClaims = buildInquiryQuestions({
      schema: "acquisition-candidate.v1",
      source: "1688",
      offerId: "674035283676",
      sourceUrl: "https://detail.1688.com/offer/674035283676.html",
      capturedAt: "2026-08-15T00:00:00.000Z",
      acquisitionMethod: "keyword",
      sourceProductRole: "candidate",
      title: "保温杯",
      images: [],
      displayedPrice: null,
      priceRange: null,
      priceTiers: [{ minQty: 1, price: 16.5, text: "1 件起 ¥16.5" }],
      displayedMoq: { text: "1 个", value: 1, nature: "displayed_moq" },
      skuSpecs: [{ skuId: "s1", specs: "白色", price: 16.5, multiPrice: 16.5, stock: 1 }],
      sellerClaims: [
        { name: "加工定制", value: "是", evidenceClass: "seller_claim" },
        { name: "内胆材质", value: "304不锈钢", evidenceClass: "seller_claim" },
      ],
      platformMetadata: [],
      supplierDisplayName: "测试供应商",
      matchState: null,
    });
    expect(withClaims.some((question) => question.includes("定制"))).toBe(false);
    expect(withClaims.some((question) => question.includes("材质"))).toBe(false);
    // 仍问包装/样品
    expect(withClaims.some((question) => question.includes("样品"))).toBe(true);
  });
});
