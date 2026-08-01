import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OpportunitiesConvergenceView } from "./OpportunitiesConvergenceView";

function renderView(): string {
  const legacyContent = createElement(
    "form",
    { "aria-label": "旧版批次表单" },
    createElement("input", { type: "file", name: "file" }),
    createElement("input", { name: "query" }),
    createElement("select", { name: "category" }),
    createElement("input", { name: "priceMin" }),
    createElement("input", { name: "priceMax" }),
  );

  return renderToStaticMarkup(
    createElement(OpportunitiesConvergenceView, { legacyContent }),
  );
}

describe("OpportunitiesConvergenceView", () => {
  it("renders one primary SellerSprite entry and keeps all legacy inputs inside a closed details region", () => {
    const html = renderView();
    const primaryEntries = html.match(/data-testid="sellersprite-primary-entry"/g) ?? [];
    const details = html.match(/<details([^>]*)>([\s\S]*)<\/details>/);

    expect(primaryEntries).toHaveLength(1);
    expect(html).toContain('href="/opportunities/sellersprite-preview"');
    expect(details).not.toBeNull();
    expect(details?.[1]).not.toMatch(/\bopen\b/);
    expect(details?.[2]).toContain("旧版 ProductBatch 流程仅用于历史兼容");
    expect(details?.[2]).toContain('type="file"');
    expect(details?.[2]).toContain('name="query"');
    expect(details?.[2]).toContain('name="category"');
    expect(details?.[2]).toContain('name="priceMin"');
    expect(details?.[2]).toContain('name="priceMax"');
    expect(html.slice(0, html.indexOf("<details"))).not.toMatch(/type="file"|name="query"|name="category"|name="priceMin"|name="priceMax"/);
  });

  it("uses a native keyboard-accessible summary and responsive existing workspace classes", () => {
    const html = renderView();

    expect(html).toMatch(/<details[^>]*><summary[^>]*>[^<]*旧版批次与历史/);
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("linear-button-primary");
  });
});
