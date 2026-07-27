import { describe, expect, it } from "vitest";
import {
  buildSellerSpriteOpportunityPreviewViewModel,
} from "@/lib/sellerSpriteOpportunityPreview";
import { buildSellerSpriteBriefBoundShadowReport } from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "@/lib/upstream/sellersprite/fixtures/category-current.sanitized.v1";
import {
  rankSellerSpriteMarketSignals,
  type SellerSpriteMarketSignalRankingReport,
} from "@/lib/upstream/sellersprite/marketSignalRanking";
import { buildSellerSpriteMarketSnapshot } from "@/lib/upstream/sellersprite/marketSnapshot";
import { precheckSellerSpriteXlsx } from "@/lib/upstream/sellersprite/precheck";
import { createSellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";

function buildInput(reportType: "search_results" | "category_current" = "search_results") {
  const capturedAt = "2026-07-27T02:00:00.000Z";
  const precheck = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook(
    reportType === "category_current" ? {
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    } : {},
  ), {
    capturedAt,
    expectedReportType: reportType,
  });
  const snapshot = buildSellerSpriteMarketSnapshot(precheck);
  const briefCommon = {
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    category: "Home & Kitchen",
    priceMin: 10,
    priceMax: 100,
    requiredSignals: reportType === "search_results"
      ? ["price", "rating", "reviews", "searchRank"]
      : ["price", "rating", "reviews"],
    optionalSignals: ["estimatedMonthlySales"],
    createdAt: capturedAt,
    briefSource: "view-model-test",
  };
  const brief = reportType === "search_results"
    ? createSellerSpriteShadowSelectionBrief({
        ...briefCommon,
        reportType,
        query: "storage box",
      })
    : createSellerSpriteShadowSelectionBrief({
        ...briefCommon,
        reportType,
        query: null,
      });
  const report = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
  const ranking = rankSellerSpriteMarketSignals({ snapshot, brief });
  return {
    requestId: "12345678-0000-0000-0000-000000000000",
    sourceFileName: "sample.xlsx",
    headerColumnCount: precheck.headerColumnCount,
    snapshot,
    brief,
    report,
    ranking,
  };
}

function withRanking(
  ranking: SellerSpriteMarketSignalRankingReport,
): SellerSpriteMarketSignalRankingReport {
  return ranking;
}

describe("SellerSprite ranking preview ViewModel integrity", () => {
  it.each([
    {
      label: "normalizedBusinessHash",
      mutate: (ranking: SellerSpriteMarketSignalRankingReport) => withRanking({
        ...ranking,
        normalizedBusinessHash: "0".repeat(64),
      }),
    },
    {
      label: "briefHash",
      mutate: (ranking: SellerSpriteMarketSignalRankingReport) => withRanking({
        ...ranking,
        briefHash: "0".repeat(64),
      }),
    },
    {
      label: "ASIN set",
      mutate: (ranking: SellerSpriteMarketSignalRankingReport) => withRanking({
        ...ranking,
        products: ranking.products.map((product, index) => (
          index === 0 ? { ...product, asin: "B0CLIENT000" } : product
        )),
      }),
    },
    {
      label: "safety flags",
      mutate: (ranking: SellerSpriteMarketSignalRankingReport) => withRanking({
        ...ranking,
        authoritative: true,
      } as unknown as SellerSpriteMarketSignalRankingReport),
    },
  ])("fails closed for a mismatched $label", ({ mutate }) => {
    const input = buildInput();
    expect(() => buildSellerSpriteOpportunityPreviewViewModel({
      ...input,
      ranking: mutate(input.ranking),
    })).toThrow("SELLERSPRITE_RANKING_INTEGRITY_FAILED");
  });

  it("returns only the ranking fields allowlisted for the browser", () => {
    const input = buildInput();
    const viewModel = buildSellerSpriteOpportunityPreviewViewModel(input);
    expect(viewModel.ranking).toMatchObject({
      schemaVersion: "sellersprite-market-signal-ranking.v2",
      modelVersion: "sellersprite-market-signal-ranking.search.v2",
      reportType: "search_results",
      conditionalSignalScoreUsage: "diagnostic_only_not_used_for_ranking",
      searchPlacementStatus: "available",
      safety: {
        authoritative: false,
        currentStage1Invoked: false,
        hardGateEvaluable: false,
        promotionEligible: false,
        manifestRegistered: false,
        productionEffect: false,
        productionDatabaseWritten: false,
      },
    });
    expect(viewModel.ranking.products).toHaveLength(input.snapshot.products.length);
    expect(viewModel.ranking.products.every((product) => (
      product.promotionEligible === false
      && product.componentScores.every((component) => (
        !("evidenceFields" in component)
        && !("sourceType" in component)
      ))
    ))).toBe(true);
    const serialized = JSON.stringify(viewModel.ranking);
    for (const forbidden of [
      "extraRaw",
      "rawText",
      "sourcePath",
      "stage1Result",
      "advance",
      "watch",
      "reject",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("separates Search and Category component contracts", () => {
    const search = buildSellerSpriteOpportunityPreviewViewModel(buildInput("search_results"));
    const category = buildSellerSpriteOpportunityPreviewViewModel(buildInput("category_current"));
    const searchComponents = search.ranking.products.flatMap((product) => (
      product.componentScores.map((component) => component.component)
    ));
    const categoryComponents = category.ranking.products.flatMap((product) => (
      product.componentScores.map((component) => component.component)
    ));
    expect(searchComponents).toContain("organicVisibility");
    expect(searchComponents).toContain("sponsoredExposure");
    expect(category.ranking.searchPlacementStatus).toBe("not_applicable");
    expect(categoryComponents).toContain("categoryBsrSignal");
    expect(categoryComponents).not.toContain("organicVisibility");
    expect(categoryComponents).not.toContain("sponsoredExposure");
    expect(categoryComponents).not.toContain("placementCoverage");
  });
});
