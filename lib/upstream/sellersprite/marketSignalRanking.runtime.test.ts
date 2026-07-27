import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSellerSpriteMarketSnapshot } from "./marketSnapshot";
import { rankSellerSpriteMarketSignals } from "./marketSignalRanking";
import { precheckSellerSpriteXlsx } from "./precheck";
import { createSellerSpriteShadowSelectionBrief } from "./shadowBrief";

const CAPTURED_AT = "2026-07-27T02:00:00.000Z";

const samples = [
  {
    name: "Search",
    path: process.env.SELLERSPRITE_XLSX_SAMPLE_PATH,
    sha256: "9513f6e53feb8bd71b8c31dfb42d79cbf9fb1e11b7457b5f88ae7ad3aa67547c",
    reportType: "search_results",
    category: "Storage & Organization",
    query: "收纳盒",
    productCount: 9,
    rankableProductCount: 8,
  },
  {
    name: "Sports",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_SPORTS_PATH,
    sha256: "41ced066135a5734251d493429effc8d6417db34d8fabdd7252abdde0f640582",
    reportType: "category_current",
    category: "Sports & Outdoors",
    query: null,
    productCount: 10,
    rankableProductCount: 10,
  },
  {
    name: "Office",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_OFFICE_PATH,
    sha256: "5069fcaa967ee945995d2ff84bd05667a8a32ea909f064c175f469101dd84247",
    reportType: "category_current",
    category: "Office Products",
    query: null,
    productCount: 10,
    rankableProductCount: 10,
  },
  {
    name: "Auto",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_AUTO_PATH,
    sha256: "8cf6007874c1eb778f8ef389c556e1b93c43e2fe0d78ab530650596856ccf742",
    reportType: "category_current",
    category: "Automotive",
    query: null,
    productCount: 10,
    rankableProductCount: 10,
  },
] as const;

describe("SellerSprite market signal ranking official samples", () => {
  for (const sample of samples) {
    const runtimeIt = sample.path ? it : it.skip;
    runtimeIt(`${sample.name} produces a non-authoritative deterministic ranking`, () => {
      const precheck = precheckSellerSpriteXlsx(readFileSync(sample.path!), {
        capturedAt: CAPTURED_AT,
        expectedReportType: sample.reportType,
      });
      const snapshot = buildSellerSpriteMarketSnapshot(precheck);
      const commonBrief = {
        marketplace: "amazon.com",
        market: "US",
        currency: "USD",
        category: sample.category,
        priceMin: 20,
        priceMax: 100,
        requiredSignals: ["price", "rating", "reviews"],
        optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue"],
        createdAt: CAPTURED_AT,
        briefSource: "market_signal_ranking_runtime_test",
      } as const;
      const brief = sample.reportType === "search_results"
        ? createSellerSpriteShadowSelectionBrief({
          ...commonBrief,
          reportType: "search_results",
          query: sample.query!,
        })
        : createSellerSpriteShadowSelectionBrief({
          ...commonBrief,
          reportType: "category_current",
          query: null,
        });
      const first = rankSellerSpriteMarketSignals({ snapshot, brief });
      const second = rankSellerSpriteMarketSignals({ snapshot, brief });

      expect(snapshot.sourceFileSha256).toBe(sample.sha256);
      expect(first).toMatchObject({
        schemaVersion: "sellersprite-market-signal-ranking.v1",
        reportType: sample.reportType,
        sourceFileSha256: sample.sha256,
        productCount: sample.productCount,
        rankableProductCount: sample.rankableProductCount,
        authoritative: false,
        currentStage1Invoked: false,
        hardGateEvaluable: false,
        promotionEligible: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      });
      expect(first.rankingHash).toBe(second.rankingHash);
      expect(first.products.every((product) => product.promotionEligible === false)).toBe(true);
      if (sample.reportType === "search_results") {
        expect(first.products.every((product) => (
          "organicVisibility" in product.componentScores
          && !("categoryBsrSignal" in product.componentScores)
        ))).toBe(true);
      } else {
        expect(first.products.every((product) => (
          "categoryBsrSignal" in product.componentScores
          && !("organicVisibility" in product.componentScores)
          && !product.missingSignals.includes("searchPlacement")
        ))).toBe(true);
      }

      console.info(JSON.stringify({
        sample: sample.name,
        reportType: first.reportType,
        top3: first.products
          .filter((product) => product.scoreRank !== null)
          .slice(0, 3)
          .map((product) => ({
            asin: product.asin,
            score: product.signalScore,
            coverage: product.evidenceCoverage,
            researchPriority: product.researchPriority,
          })),
        salesOnlyTop3: first.diagnostics.salesOnlyOrder.slice(0, 3),
        top3SalesOverlap: first.diagnostics.top3SalesOverlap,
        scoreSpread: first.diagnostics.scoreSpread,
        familyCount: first.familyResearchList.length,
        familyFoldReduction: first.productCount - first.familyResearchList.length,
        rankingHash: first.rankingHash,
      }));
    });
  }
});
