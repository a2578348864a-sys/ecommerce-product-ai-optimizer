import { describe, expect, it } from "vitest";
import {
  buildStage15ShadowPublicSource,
  parseAmazonBestSellersMarkdown,
} from "./stage15-shadow-public-source";

function entry(index: number, price = `$${10 + index}.99`) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Desk Organizer ${index}](https://images-na.ssl-images-amazon.com/images/I/image${index}._AC_UL600.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Desk Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [${price}](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

describe("stage15 shadow public source", () => {
  it("extracts product identity, title, image, rating, reviews, rank, and price", () => {
    const records = parseAmazonBestSellersMarkdown(entry(1), { maxSamples: 20 });
    expect(records).toEqual([expect.objectContaining({ asin: "B000000001", title: "Desk Organizer 1", rank: 1, price: 11.99, rating: 4.7, reviewCount: 1001 })]);
    expect(records[0].imageUrl).toContain("images-na.ssl-images-amazon.com");
  });

  it("keeps missing price explicit and deduplicates ASINs", () => {
    const markdown = `${entry(1, "Click for details")}${entry(1, "Click for details")}`;
    const records = parseAmazonBestSellersMarkdown(markdown, { maxSamples: 20 });
    expect(records).toHaveLength(1);
    expect(records[0].price).toBeNull();
    expect(records[0].missingReasons).toContain("price_not_visible");
  });

  it("builds a real-source in-memory pipeline and frozen Stage 1 without writes", () => {
    const markdown = Array.from({ length: 20 }, (_, index) => entry(index + 1)).join("\n");
    const result = buildStage15ShadowPublicSource({
      role: "calibration",
      batchId: "shadow-c-20260717",
      briefId: "brief-shadow-c-20260717",
      collectionRunId: "run-shadow-c-20260717",
      query: "desk accessories and workspace organizers",
      category: "Desk Accessories & Workspace Organizers",
      targetScenario: "US Amazon desk organization market pre-screen",
      targetPriceRange: { min: 8, max: 45 },
      sourceUrl: "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514",
      sourceMarkdown: markdown,
      sourceFileSha256: "a".repeat(64),
      page: 1,
      capturedAt: "2026-07-17T04:00:00.000Z",
    });
    expect(result.sourceAdapterResult.qualitySummary.status).toBe("passed");
    expect(result.importPackage.candidates).toHaveLength(20);
    expect(result.rankingRun.rankingRuleVersion).toBe("stage1-deterministic-v1.1");
    expect(result.rankingRun.results).toHaveLength(20);
    expect(result.formalCandidateGenerated).toBe(false);
    expect(result.productionDatabaseWritten).toBe(false);
  });

  it("fails closed on blocked pages, duplicate identity shortage, or unapproved sample budget", () => {
    expect(() => parseAmazonBestSellersMarkdown("Captcha Enter the characters", { maxSamples: 20 })).toThrow("PUBLIC_SOURCE_BLOCKED");
    expect(() => buildStage15ShadowPublicSource({ role: "validation", batchId: "v", briefId: "b", collectionRunId: "r", query: "bathroom organizers", category: "Bathroom", targetScenario: "test", targetPriceRange: { min: 8, max: 45 }, sourceUrl: "https://www.amazon.com/x", sourceMarkdown: entry(1), sourceFileSha256: "a".repeat(64), page: 1, capturedAt: "2026-07-17T04:00:00.000Z" })).toThrow("PUBLIC_SOURCE_EXACT_COUNT_REQUIRED");
    expect(() => parseAmazonBestSellersMarkdown(entry(1), { maxSamples: 21 })).toThrow("PUBLIC_SOURCE_BUDGET_INVALID");
  });
});
