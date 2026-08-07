import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const importPageSource = readFileSync(
  resolve(process.cwd(), "app/opportunities/import/page.tsx"),
  "utf8",
);
const opportunitiesPageSource = readFileSync(
  resolve(process.cwd(), "app/opportunities/page.tsx"),
  "utf8",
);

describe("advanced opportunities import compatibility entry", () => {
  it("redirects the legacy import URL to the research-pool manual compatibility section", () => {
    expect(importPageSource).toContain('redirect("/opportunity-candidates?mode=manual")');
    expect(importPageSource).not.toContain("OpportunitiesForm");
  });

  it("keeps the formal discovery page on product-batch management (workbench moved to preview)", () => {
    expect(opportunitiesPageSource).toContain("<ProductBatchManager");
    expect(opportunitiesPageSource).not.toContain("<MarketScreeningWorkbench");
    expect(opportunitiesPageSource).not.toContain("<OpportunitiesForm");
    expect(opportunitiesPageSource).not.toContain('surface="advanced_import"');
  });
});
