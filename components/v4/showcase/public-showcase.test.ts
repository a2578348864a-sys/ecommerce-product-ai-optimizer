import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PublicShowcaseHome } from "./PublicShowcaseHome";
import { PublicCasePage } from "./PublicCasePage";
import { PublicCaseImage } from "./PublicCaseImage";
import { loadPublicShowcaseCase, scanBannedTerms } from "@/lib/public-showcase/case";
import type { RuntimeMode } from "@/lib/server/runtimeMode";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("公网演示首页（HR 收口）", () => {
  const html = renderToStaticMarkup(createElement(PublicShowcaseHome));
  it("渲染演示首页与唯一主按钮（指向案例页）", () => {
    expect(html).toContain('data-testid="showcase-home"');
    expect(html).toContain('data-testid="showcase-primary-cta"');
    expect(html).toContain('href="/replay"');
    expect(html).toContain("查看完整商品案例");
  });
  it("不出现旧入口/密码/旧工作台/旧流程卡", () => {
    for (const term of ["进入演示", "密码", "七阶段", "案例回放", "从既有工具", "最近研究", "待研究商品", "发现商品"]) {
      expect(html).not.toContain(term);
    }
  });
  it("首页文案无禁止术语（URL 属性不参与文案扫描）", () => {
    const textOnly = html.replace(/\s[a-z-]+="[^"]*"/g, " ");
    expect(scanBannedTerms(textOnly)).toEqual([]);
  });
});

describe("公网完整商品案例页", () => {
  const data = loadPublicShowcaseCase();
  const html = renderToStaticMarkup(createElement(PublicCasePage, { data }));
  it("展示 THERMOS 商品、美国站与最终结论", () => {
    expect(html).toContain("THERMOS FUNTAINER");
    expect(html).toContain("美国站");
    expect(html).toContain("ASIN B08NCVT244");
    expect(html).toContain("进入创作准备");
  });
  it("四个研究模块与人工决定、Listing、图片检查均有内容，含中文缺口文案", () => {
    for (const tid of ["showcase-module-market", "showcase-module-buyers", "showcase-module-sourcing", "showcase-module-costrisk", "showcase-decision", "showcase-listing"]) {
      expect(html).toContain('data-testid="' + tid + '"');
    }
    expect(html).toContain("尚缺（未取得");
    expect(html).toContain(data.listing.status);
    expect(html).toContain("待人工确认");
  });
  it("页面无禁止术语、无内部标识", () => {
    expect(scanBannedTerms(html)).toEqual([]);
    expect(html).not.toContain("cmt0lmsqa");
    expect(html).not.toContain("bundle");
    expect(html).not.toContain("时间线");
  });
  it("案例页商品图使用同源资产并带失败兜底接线", () => {
    const imageSource = readFileSync(resolve(process.cwd(), "components/v4/showcase/PublicCaseImage.tsx"), "utf8");
    expect(imageSource).toContain("showcase-image-fallback");
    expect(imageSource).toContain("onError");
    expect(html).toContain("showcase-image");
  });
});

describe("首页体验推导（访客会话不回落旧工作台）", () => {
  it("deriveHomeExperience 覆盖四种模式", async () => {
    const { deriveHomeExperience } = await import("@/components/v4/home/heroLogic");
    const base: { mode: RuntimeMode; noAuthOwner: boolean; v4Graph: boolean } = { mode: "public_showcase", noAuthOwner: false, v4Graph: false };
    expect(deriveHomeExperience(base, false)).toBe("showcase");
    expect(deriveHomeExperience(base, true)).toBe("showcase");
    expect(deriveHomeExperience({ ...base, mode: "local_owner" as RuntimeMode, noAuthOwner: true }, true)).toBe("dashboard");
    expect(deriveHomeExperience({ ...base, mode: "local_owner" as RuntimeMode, noAuthOwner: false }, false)).toBe("login");
    expect(deriveHomeExperience({ ...base, mode: "local_owner" as RuntimeMode, noAuthOwner: false }, true)).toBe("dashboard");
  });
});


describe("轮 16 视觉清口（商品身份/颜色/关键词移动端/Listing 文案）", () => {
  const d = loadPublicShowcaseCase();
  const html = renderToStaticMarkup(createElement(PublicCasePage, { data: d }));
  const h1 = (createElement(PublicCasePage, { data: d }) && null) || null;
  it("案例主标题与概览中商品名称完全相等且无「商品研究」", () => {
    const title = d.title;
    const overviewName = d.overviewSummary.fields.find((f) => f.label === "商品名称");
    expect(title).not.toContain("商品研究");
    expect(overviewName).toBeTruthy();
    expect(overviewName!.value).toBe(title);
    expect(html).not.toContain("Pink 商品研究");
    const heroMatch = html.match(/<h1[^>]*>([^<]*)</);
    expect(heroMatch).toBeTruthy();
    expect(heroMatch![1].trim()).toBe(title);
  });
  it("独立颜色字段显示中文（粉色）", () => {
    const color = d.overviewSummary.fields.find((f) => f.label === "颜色/款式");
    expect(color).toBeTruthy();
    expect(color!.value).not.toBe("Pink");
    expect(color!.value).toContain("粉");
    expect(html).toContain("粉色");
  });
  it("关键词区移动端有卡片列表（含分类完整）", () => {
    expect(html).toContain('data-testid="showcase-keywords-cards"');
    expect(html).toContain("当前商品相关词");
    expect(html).toContain("相邻类目词");
    expect(d.keywords.rows.some((r) => r.category === "品牌词（竞品品牌）")).toBe(true);
  });
  it("关键词卡片展示搜索量与竞争度（购买量缺失如实标注）", () => {
    expect(html).toContain("月搜索量");
    expect(html).toContain("竞争度");
    expect(html).toContain("购买量");
  });
  it("Listing 拒绝说明只出现一次，重复搜索词带明确标注", () => {
    expect((html.match(/未作为正式成果展示/g) || []).length).toBe(1);
    expect(html).toContain("历史草稿原始搜索词（含重复，未通过质量校验）");
    expect(html).toContain("历史 Listing 草稿未通过质量校验，未作为正式成果展示");
  });
});


describe("轮 17 Listing 说明去重", () => {
  it("完整说明句在最终 HTML 中恰好出现一次（不是仅存在）", () => {
    const d2 = loadPublicShowcaseCase();
    const html2 = renderToStaticMarkup(createElement(PublicCasePage, { data: d2 }));
    const sentence = "草稿由系统依据已确认事实自动起草；质量检查未通过，历史版本保留但不出现在正式成果中。";
    expect(html2.split(sentence).length - 1).toBe(1);
  });
});
