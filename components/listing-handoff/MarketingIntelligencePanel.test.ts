import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingIntelligencePanel, marketingReferenceFromSummary } from "@/components/listing-handoff/MarketingIntelligencePanel";

describe("MarketingIntelligencePanel", () => {
  it("展示旁路洞察并明确不属于商品事实", () => {
    const html = renderToStaticMarkup(
      createElement(MarketingIntelligencePanel, {
        summary: {
          counts: { vocInsights: 1, keywordCandidates: 2, competitiveInsights: 1, sourcingEntries: 1 },
          vocInsights: [{ theme: "organization_need", summary: "用户提到 messy storage", reviewCount: 3, strength: "recurring" }],
          keywordCandidates: [{ keyword: "kitchen organizer", reportType: "keyword" }],
          competitiveContext: [{ asin: "B0TEST", note: "help keep counters organized" }],
          sourcingContext: [{ offerId: "offer-1", title: "Organizer", displayedPrice: "$3", confirmed: false }],
        },
      }),
    );
    expect(html).toContain("marketing-intelligence-panel");
    expect(html).toContain("REFERENCE_ONLY");
    expect(html).toContain("仅供 Listing 策略参考，不属于商品事实");
    expect(html).toContain("Organization");
    expect(html).toContain("产品特征");
    expect(html).not.toContain("factId");
  });

  it("无研究摘要时保持安全空态", () => {
    const html = renderToStaticMarkup(createElement(MarketingIntelligencePanel, { summary: null }));
    expect(html).toContain("marketing-intelligence-empty");
    expect(html).toContain("当前暂无可用研究参考");
  });

  it("只投影既有参考摘要，不生成事实字段", () => {
    const projected = marketingReferenceFromSummary({
      vocInsights: [{ theme: "x", summary: "y", reviewCount: 1, strength: "weak" }],
    });
    expect(projected.voc).toHaveLength(1);
    expect(JSON.stringify(projected)).not.toContain("factId");
    expect(JSON.stringify(projected)).not.toContain("confirmedFacts");
  });
});
