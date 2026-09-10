import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ListingCopyStrategyCard } from "./ListingCopyStrategyCard";
import type { CopyStrategyV1 } from "@/lib/listingHandoff/copyStrategy/types";

const strategy: CopyStrategyV1 = {
  version: "copy-strategy.v1",
  referenceOnly: true,
  targetBuyer: "通勤和日常携带的人群",
  buyerPainPoints: ["希望日常使用更顺手"],
  mainAngle: "清晰表达日常使用价值",
  emotionalHook: null,
  copyTone: "practical",
  bulletStrategies: [
    { order: 1, structure: "feature_benefit_scenario", purpose: "先说功能，再连接使用价值和场景", referenceOnly: true },
  ],
  titleStrategy: "品牌 + 品类 + 主要特点，保持可读",
  descriptionStrategy: "产品是什么 → 对用户有什么帮助 → 合理使用场景",
  avoidExpressions: ["未经证实的性能承诺"],
};

describe("ListingCopyStrategyCard", () => {
  it("shows a compact strategy card without internal contract fields", () => {
    const html = renderToStaticMarkup(createElement(ListingCopyStrategyCard, { strategy }));
    expect(html).toContain("营销文案策略");
    expect(html).toContain("来自 VOC / 关键词 / 竞品研究");
    expect(html).toContain("目标买家");
    expect(html).toContain("Feature");
    expect(html).not.toContain("factId");
    expect(html).not.toContain("confirmedFacts");
    expect(html).not.toContain("referenceOnly");
  });

  it("only shows the applied badge in the result summary when explicitly marked", () => {
    const html = renderToStaticMarkup(createElement(ListingCopyStrategyCard, {
      strategy,
      applied: true,
      summaryOnly: true,
    }));
    expect(html).toContain("本次采用策略");
    expect(html).toContain("✓ 已应用到本次 Listing");
  });

  it("renders a recoverable empty state", () => {
    const html = renderToStaticMarkup(createElement(ListingCopyStrategyCard, { strategy: null }));
    expect(html).toContain("当前研究资料暂未形成表达策略");
    expect(html).not.toContain("空卡片");
  });
});
