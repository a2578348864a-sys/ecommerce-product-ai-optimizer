import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSellerSpriteBriefBoundShadowReport } from "./briefBoundShadowReport";
import { SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH } from "./fixtures/search-export.sanitized.v1";
import { buildSellerSpriteMarketSnapshot } from "./marketSnapshot";
import { precheckSellerSpriteXlsx } from "./precheck";
import { createSellerSpriteShadowSelectionBrief } from "./shadowBrief";

const samplePath = process.env.SELLERSPRITE_XLSX_SAMPLE_PATH;
const runtimeIt = samplePath ? it : it.skip;

describe("SellerSprite XLSX local sample", () => {
  runtimeIt("prechecks an explicitly supplied official export without production effects", () => {
    const result = precheckSellerSpriteXlsx(readFileSync(samplePath!), {
      capturedAt: "2026-07-26T13:45:11.000Z",
      expectedReportType: "search_results",
    });

    expect(result.sheetName).toBe("US");
    expect(result.sourceFileHash).toBe(SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH);
    expect(result.headerColumnCount).toBe(73);
    expect(result.totalRows).toBe(10);
    expect(result.acceptedRows).toBe(10);
    expect(result.rejectedRows).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ code: "duplicate_asin", severity: "warning" }),
    ]);
    expect(result.sourceType).toBe("provider_metric");
    expect(result.records.every((record) => (
      record.estimatedMonthlySales.sourceType === "provider_metric"
      && record.estimatedMonthlyRevenue.sourceType === "provider_metric"
      && record.estimatedMonthlySales.metricNature === "estimate"
      && record.estimatedMonthlyRevenue.metricNature === "estimate"
    ))).toBe(true);
    expect(result.records.filter((record) => record.asin.normalized === "B082PJPQ1Y")).toHaveLength(2);
    expect(result.records.filter((record) => record.searchRank.normalized?.placementType === "sponsored")).toHaveLength(8);
    expect(result.records.filter((record) => record.searchRank.normalized?.placementType === "organic")).toHaveLength(2);
    expect(result.auxiliaryEvidence.brands).toMatchObject({ status: "available", sheetName: "Brands" });
    expect(result.auxiliaryEvidence.sellers).toMatchObject({ status: "available", sheetName: "Sellers" });
    expect(result.auxiliaryEvidence.note).toMatchObject({ status: "available", sheetName: "Note" });
    expect(result.auxiliaryEvidence.note.rawText.join("\n")).toContain("最近更新");
    expect(result.providerUpdatedAt).toBeNull();
    expect(result.exportedAt).toBeNull();

    const snapshot = buildSellerSpriteMarketSnapshot(result);
    expect(snapshot).toMatchObject({
      schemaVersion: "sellersprite-market-snapshot.v3",
      reportType: "search_results",
      sourceFileSha256: SELLERSPRITE_SEARCH_EXPORT_SOURCE_HASH,
      totalRows: 10,
      acceptedRows: 10,
      rejectedRows: 0,
      uniqueAsinCount: 9,
      duplicateAsinCount: 1,
      sponsoredPlacementCount: 8,
      organicPlacementCount: 2,
      unknownPlacementCount: 0,
      productionEffect: false,
      productionDatabaseWritten: false,
    });
    expect(snapshot.appearances).toHaveLength(10);
    expect(snapshot.products).toHaveLength(9);
    expect(snapshot.appearances.filter((item) => item.asin === "B082PJPQ1Y")).toHaveLength(2);
    expect(snapshot.products.find((item) => item.asin === "B082PJPQ1Y")?.appearances).toHaveLength(2);
    expect(
      snapshot.productWeightedSummary.estimatedMonthlySales.validCount
      + snapshot.productWeightedSummary.estimatedMonthlySales.missingCount
      + snapshot.productWeightedSummary.estimatedMonthlySales.conflictCount,
    ).toBe(9);
    expect(snapshot.brandConcentrationSummary.status).toBe("available");
    expect(snapshot.sellerConcentrationSummary.status).toBe("available");

    const brief = createSellerSpriteShadowSelectionBrief({
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      reportType: "search_results",
      query: "收纳盒",
      category: "Home & Kitchen",
      priceMin: 5,
      priceMax: 100,
      requiredSignals: ["price", "rating", "reviews"],
      optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue"],
      createdAt: "2026-07-26T13:45:11.000Z",
      briefSource: "runtime_test_explicit_input",
    });
    const shadow = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
    expect(shadow.currentStage1Invoked).toBe(false);
    expect(shadow.currentStage1RuleModified).toBe(false);
    expect(shadow.authoritative).toBe(false);
    expect(shadow.promotionAllowed).toBe(false);
    expect(shadow.promotionEligible).toBe(false);
    expect(shadow.hardGateEvidenceStatus).toBe("unknown");
    expect(shadow.hardGateEvaluable).toBe(false);
    expect(shadow.manifestRegistered).toBe(false);
    expect(shadow.productionEffect).toBe(false);
    expect(shadow.productionDatabaseWritten).toBe(false);
    expect(shadow.products).toHaveLength(9);
    expect(shadow.products.every((item) => item.promotionEligible === false)).toBe(true);
    for (const key of [
      "shadowDistribution",
      "formalDistribution",
      "advanceDistribution",
      "watchDistribution",
      "rejectDistribution",
      "ranking",
      "rankingOutput",
      "rankingRun",
      "stage1Ranking",
      "stage1Result",
      "observedRiskFlags",
      "promotionDecision",
      "formalDisposition",
      "promoted",
      "advance",
      "watch",
      "reject",
    ]) {
      expect(key in shadow).toBe(false);
    }
    expect(Object.keys(shadow.provisionalDistribution)).toEqual([
      "provisional_score_only",
      "insufficient_hard_gate_evidence",
      "conflicting_provider_metrics",
      "insufficient_required_signals",
    ]);
    const allowedDispositions = new Set([
      "provisional_score_only",
      "insufficient_hard_gate_evidence",
      "conflicting_provider_metrics",
      "insufficient_required_signals",
    ]);
    for (const product of shadow.products) {
      expect(allowedDispositions.has(product.provisionalDisposition)).toBe(true);
      for (const key of [
        "shadowDecision",
        "promotionDecision",
        "formalDisposition",
        "observedRiskFlags",
        "rankingRun",
        "stage1Result",
        "promoted",
        "advance",
        "watch",
        "reject",
      ]) {
        expect(key in product).toBe(false);
      }
    }
    expect(result.productionEffect).toBe(false);
    expect(result.productionDatabaseWritten).toBe(false);
  });
});

const categorySamples = [
  {
    name: "Sports",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_SPORTS_PATH,
    sha256: "41ced066135a5734251d493429effc8d6417db34d8fabdd7252abdde0f640582",
    familyCount: 8,
  },
  {
    name: "Office",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_OFFICE_PATH,
    sha256: "5069fcaa967ee945995d2ff84bd05667a8a32ea909f064c175f469101dd84247",
    familyCount: 7,
  },
  {
    name: "Auto",
    path: process.env.SELLERSPRITE_XLSX_CATEGORY_AUTO_PATH,
    sha256: "8cf6007874c1eb778f8ef389c556e1b93c43e2fe0d78ab530650596856ccf742",
    familyCount: 9,
  },
] as const;

describe("SellerSprite Category Current official samples", () => {
  for (const sample of categorySamples) {
    const categoryIt = sample.path ? it : it.skip;
    categoryIt(`${sample.name} stays Category Current and non-authoritative`, () => {
      const result = precheckSellerSpriteXlsx(readFileSync(sample.path!), {
        capturedAt: "2026-07-27T02:00:00.000Z",
        expectedReportType: "category_current",
      });
      expect(result).toMatchObject({
        schemaVersion: "sellersprite-xlsx-precheck.v2",
        sourceFileHash: sample.sha256,
        reportType: "category_current",
        reportTypeMatched: true,
        sheetName: "US",
        headerColumnCount: 72,
        totalRows: 10,
        acceptedRows: 10,
        rejectedRows: 0,
      });
      expect(result.records.every((record) => (
        record.searchRank.applicability === "not_applicable"
        && record.searchRank.normalized === null
      ))).toBe(true);

      const snapshot = buildSellerSpriteMarketSnapshot(result);
      expect(snapshot).toMatchObject({
        schemaVersion: "sellersprite-market-snapshot.v3",
        reportType: "category_current",
        uniqueAsinCount: 10,
        placementSummary: { status: "not_applicable" },
        sponsoredPlacementCount: null,
        organicPlacementCount: null,
        unknownPlacementCount: null,
        productionEffect: false,
        productionDatabaseWritten: false,
      });
      expect(snapshot.occurrences).toHaveLength(10);
      expect(snapshot.appearances).toEqual([]);
      expect(snapshot.products).toHaveLength(10);
      expect(snapshot.families).toHaveLength(sample.familyCount);
      expect(snapshot.missingSignals).not.toContain("product_field:searchRank");
      expect(snapshot.missingSignals).not.toContain("product_field_partial:searchRank");

      const brief = createSellerSpriteShadowSelectionBrief({
        marketplace: "amazon.com",
        market: "US",
        currency: "USD",
        reportType: "category_current",
        query: null,
        category: `${sample.name} Category`,
        priceMin: 20,
        priceMax: 100,
        requiredSignals: ["price", "rating", "reviews"],
        optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue"],
        createdAt: "2026-07-27T02:00:00.000Z",
        briefSource: "runtime_test_explicit_input",
      });
      const shadow = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
      expect(shadow.reportType).toBe("category_current");
      expect(shadow.query).toBeNull();
      expect(shadow.currentStage1Invoked).toBe(false);
      expect(shadow.authoritative).toBe(false);
      expect(shadow.promotionAllowed).toBe(false);
      expect(shadow.manifestRegistered).toBe(false);
      expect(shadow.productionEffect).toBe(false);
      expect(shadow.productionDatabaseWritten).toBe(false);
      expect(shadow.products.every((product) => product.promotionEligible === false)).toBe(true);
    });
  }
});
