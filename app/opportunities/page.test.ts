import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Opportunities SellerSprite Preview entry", () => {
  it("wires both legacy consumers into the single convergence view without backend coupling", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).toContain("OpportunitiesConvergenceView");
    expect(source).toContain("legacyContent");
    expect(source).toContain("ProductBatchManager");
    expect(source).toContain("MarketScreeningWorkbench");
    expect(source).not.toContain("opportunityCandidateService");
    expect(source).not.toContain("marketSignalRanking");
  });
});
