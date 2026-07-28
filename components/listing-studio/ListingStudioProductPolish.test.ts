import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ListingStudioClient } from "@/components/listing-studio/ListingStudioClient";
import {
  ListingResultWorkspace,
  type ListingPack,
} from "@/components/listing-studio/ListingResultWorkspace";
import type { StudioListingPreferences } from "@/lib/studioListingInput";

const preferences: StudioListingPreferences = {
  targetMarket: "US",
  outputLanguage: "en",
  coreFunction: "抬高屏幕，支持多角度调节",
  targetAudience: "居家办公用户",
  problemSolved: "缓解桌面空间拥挤",
  differentiators: ["可折叠", "便携"],
  primaryKeywords: ["foldable laptop stand"],
  secondaryKeywords: ["portable laptop riser", "adjustable stand"],
  competitorKeywords: ["desk laptop holder"],
  tone: "professional",
  confirmedFacts: ["可折叠铝合金框架"],
  unverifiedFacts: [],
  prohibitedClaims: ["军用级"],
  listingObjective: "balanced",
};

const listingPack: ListingPack = {
  source: "mock_ai_draft",
  version: 1,
  generatedAt: "2026-07-26T00:00:00.000Z",
  model: "mock",
  titles: ["Foldable Laptop Stand for Home Office"],
  bullets: [
    "Adjustable viewing angles for a more comfortable workspace.",
    "Folds flat for easy storage and travel.",
  ],
  description: "A compact laptop stand designed for flexible home-office setups.",
  keywords: ["foldable laptop stand", "portable laptop riser"],
  sellingPoints: ["Adjustable", "Foldable"],
  humanReviewRequired: true,
  riskNotes: ["Manual review required."],
  complianceWarnings: [],
  blockedClaims: [],
  reviewChecklist: ["Check supplier documents."],
};

describe("Listing Studio product workbench", () => {
  it("renders the structured product, selling-point, SEO, style, and mode inputs", () => {
    const html = renderToStaticMarkup(createElement(ListingStudioClient));

    for (const heading of ["商品基础", "事实可信度", "商品卖点", "SEO 设置", "Listing 目标", "文案风格"]) {
      expect(html).toContain(heading);
    }
    for (const label of [
      "商品名称",
      "商品类别",
      "商品描述",
      "目标市场",
      "输出语言",
      "核心功能",
      "目标用户",
      "解决问题",
      "差异化卖点",
      "主关键词",
      "次关键词",
      "竞品关键词",
      "已确认事实",
      "待人工确认事实",
      "禁止生成的声明",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Mock 预览");
    expect(html).toContain("Real AI");
    expect(html).toContain("Mock 不调用真实 AI");
    expect(html).toContain("字段参与生成");
    expect(html).toContain("竞品词只作研究参考");
    expect(html).not.toContain("Français");
    expect(html).toContain("Listing 工作区");
    expect(html).toContain("复制全部");
    expect(html).toContain("信息完整度");
    expect(html).toContain("均衡");
    expect(html).toContain("导出 TXT");
    expect(html).toContain("导出 JSON");
  });

  it("renders actionable output modules with transparent local review semantics", () => {
    const html = renderToStaticMarkup(createElement(ListingResultWorkspace, {
      listingPack,
      preferences,
      mode: "mock",
      copiedSection: null,
      onCopy: vi.fn(),
    }));

    for (const heading of ["标题", "Bullet Points", "Description", "Search Terms", "AI Review"]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("字符");
    expect(html).toContain("关键词覆盖");
    expect(html).toContain("使用卖点");
    expect(html).toContain("已覆盖关键词");
    expect(html).toContain("建议关键词");
    expect(html).toContain("关键词落位矩阵");
    expect(html).toContain("主关键词");
    expect(html).toContain("次关键词");
    expect(html).toContain("标题");
    expect(html).toContain("Bullet");
    expect(html).toContain("Description");
    expect(html).toContain("总次数");
    expect(html).toContain("风险检查");
    expect(html).toContain("优化建议");
    expect(html).toContain("人工复核提示");
    expect(html).toContain("Mock 本地辅助检查");
    expect(html).toContain("不等于 AI 判断或平台合规结论");
    expect(html).toContain("竞品词仅作研究参考");
    expect(html).not.toMatch(/\b(?:score|评分)\s*[:：]?\s*\d+/i);
    expect(html.match(/>复制(?:标题|要点|描述|搜索词)</g)?.length ?? 0).toBe(4);
  });
});
