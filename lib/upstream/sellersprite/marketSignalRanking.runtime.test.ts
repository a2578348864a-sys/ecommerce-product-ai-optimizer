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
    modelVersion: "sellersprite-market-signal-ranking.search.v2",
    v1RankingHash: "226254bfeb0f9611d10d9fd7c17e5662f7aa7131ddc7d360cd6d6d77237ecaaf",
    top3: [
      { asin: "B08HR4K9Y5", score: 59.32782738095238 },
      { asin: "B09ZV2TX28", score: 57.64843750000001 },
      { asin: "B082PJN8BD", score: 51.27752976190476 },
    ],
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
    modelVersion: "sellersprite-market-signal-ranking.category.v2",
    v1RankingHash: "b97e79e25f7004a3e5131f8e24c2e98d176d29962a1e6da340974feb0a8e4883",
    top3: [
      { asin: "B0GSH7JDR8", score: 89.31111111111112 },
      { asin: "B0G3Y89LW9", score: 82.88888888888889 },
      { asin: "B0GXHR4CR9", score: 79.11111111111111 },
    ],
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
    modelVersion: "sellersprite-market-signal-ranking.category.v2",
    v1RankingHash: "c87070d62eb3ad2fa5852f5a6dc1ffa048e5650e63aac68d3e2b5e32e81768bc",
    top3: [
      { asin: "B0GVZ3CWK1", score: 87.6 },
      { asin: "B0G8SFR7DH", score: 85.45555555555556 },
      { asin: "B0GLD9K9LF", score: 61.44444444444444 },
    ],
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
    modelVersion: "sellersprite-market-signal-ranking.category.v2",
    v1RankingHash: "90f9d24f06811fca779be0948f0cd720aa8bcd6338f8ff7e8eb61b70805d4b2a",
    top3: [
      { asin: "B0GHY6D5B2", score: 86.5 },
      { asin: "B0GXJM1Q2K", score: 85.13333333333333 },
      { asin: "B0H7W11LTY", score: 70.42222222222222 },
    ],
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
        schemaVersion: "sellersprite-market-signal-ranking.v2",
        modelVersion: sample.modelVersion,
        coverageFormulaVersion: "sellersprite-market-signal-coverage.v2",
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
      expect(first.rankingHash).not.toBe(sample.v1RankingHash);
      expect(first.products.every((product) => product.promotionEligible === false)).toBe(true);
      const rankableProducts = first.products.filter((product) => product.scoreRank !== null);
      expect(rankableProducts).toHaveLength(sample.rankableProductCount);
      expect(rankableProducts.every((product) => (
        product.availableWeight === 100
        && product.evidenceCoverage === 1
        && product.conditionalSignalScore === product.earnedWeightedPoints
        && product.signalScore === product.earnedWeightedPoints
        && product.coveragePenalty === 0
      ))).toBe(true);
      for (const product of rankableProducts) {
        const frozenV1SignalScore = product.componentEvidence.reduce(
          (sum, component) => sum + (component.weightedPoints ?? 0),
          0,
        ) / product.availableWeight * 100;
        expect(product.signalScore).toBe(frozenV1SignalScore);
      }
      expect(rankableProducts.slice(0, 3).map((product) => ({
        asin: product.asin,
        score: product.signalScore,
      }))).toEqual(sample.top3);
      if (sample.reportType === "search_results") {
        expect(first.unrankedProductCount).toBe(1);
      }
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
