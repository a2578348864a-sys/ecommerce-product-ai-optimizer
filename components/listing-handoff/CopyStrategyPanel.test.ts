import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyStrategyPanel } from "./CopyStrategyPanel";
import { buildCopyStrategy } from "@/lib/listingHandoff/copyStrategy/analyzer";
import { analyzeMarketingIntelligence } from "@/lib/listingHandoff/marketingIntelligence/analyzer";

describe("CopyStrategyPanel", () => {
  it("displays reference-only copy strategy without changing Listing", () => {
    const strategy = buildCopyStrategy({
      marketingInsight: analyzeMarketingIntelligence({
        voc: ["messy kitchen storage"],
        keywords: ["kitchen organizer"],
        competitors: [],
        sourcing: [],
      }),
      confirmedFactSummary: { count: 2, labels: ["Product type", "Color"] },
    });
    const html = renderToStaticMarkup(createElement(CopyStrategyPanel, { strategy }));
    expect(html).toContain("copy-strategy-panel");
    expect(html).toContain("REFERENCE_ONLY");
    expect(html).toContain("策略参考，不直接修改 Listing");
    expect(html).toContain("Bullet 写作结构");
    expect(html).toContain("标题策略");
    expect(html).toContain("描述策略");
  });

  it("renders a safe empty state", () => {
    const html = renderToStaticMarkup(createElement(CopyStrategyPanel, { strategy: null }));
    expect(html).toContain("copy-strategy-empty");
    expect(html).toContain("Listing 生成与现有质量检查保持不变");
  });
});
