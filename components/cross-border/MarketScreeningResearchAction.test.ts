import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketScreeningResearchAction } from "@/components/cross-border/MarketScreeningResearchAction";

describe("MarketScreeningResearchAction", () => {
  it("renders the single primary action for a researchable product", () => {
    const html = renderToStaticMarkup(createElement(MarketScreeningResearchAction, {
      productKey: "amazon:US:B012345678",
      disabled: false,
    }));

    expect(html).toContain("研究此商品");
    expect(html).toContain('data-testid="research-market-screening-item"');
    expect(html).not.toContain('disabled=""');
  });

  it("keeps the action visible but disabled for a non-researchable product", () => {
    const html = renderToStaticMarkup(createElement(MarketScreeningResearchAction, {
      productKey: "amazon:US:B012345678",
      disabled: true,
    }));

    expect(html).toContain("研究此商品");
    expect(html).toContain('disabled=""');
    expect(html).toContain("当前证据状态不可研究");
  });
});
