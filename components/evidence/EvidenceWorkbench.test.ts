import { describe, expect, it } from "vitest";
import {
  extractCandidateScore,
  extractDecisionSummary,
  extractEvidenceGaps,
  extractKeywordBrief,
  extractOverviewItems,
  extractReportSource,
  natureForField,
} from "./EvidenceWorkbench";

const batchResult = {
  sourceMeta: {
    candidateSnapshot: { score: 73 },
    productBatchSnapshot: {
      asin: "B0TEST0001",
      marketplace: "amazon.com",
      reportType: "search_results",
      capturedAt: "2026-08-14T02:00:00.000Z",
      evidenceHash: "e".repeat(64),
      productFacts: {
        productTitle: "Golden Test Bottle",
        brand: "Golden Brand",
        price: 24.99,
        rating: 4.6,
        reviews: 1234,
        rootCategoryBsr: 12700,
        subCategoryBsr: 1266,
        estimatedMonthlySales: 228,
        estimatedMonthlyRevenue: 10237,
      },
    },
  },
  researchRecord: {
    latestDecision: {
      status: "needs_information",
      reason: "缺货源与合规证据",
      nextAction: "补充供应商信息",
    },
  },
  decisionEvidence: {
    missingData: [{ summary: "缺采购价" }, { summary: "缺 MOQ" }],
  },
  listingKeywordBrief: {
    primaryKeyword: "insulated water bottle",
    supportingKeywords: ["stainless steel"],
    backendSearchTerms: ["water bottle", "tumbler"],
    source: "sellersprite",
  },
};

describe("EvidenceWorkbench extractors", () => {
  it("extracts overview items with metricNature and estimate labeling", () => {
    const items = extractOverviewItems(batchResult);
    expect(items.find((item) => item.field === "asin")?.value).toBe("B0TEST0001");
    const price = items.find((item) => item.field === "price");
    expect(price?.value).toBe("24.99");
    expect(price?.nature).toBe("snapshot");
    const sales = items.find((item) => item.field === "estimatedMonthlySales");
    expect(sales?.nature).toBe("estimate");
    const title = items.find((item) => item.field === "productTitle");
    expect(title?.nature).toBe("unknown");
  });

  it("keeps missing facts as unknown instead of guessing", () => {
    const items = extractOverviewItems({
      sourceMeta: { productBatchSnapshot: { asin: "B0TEST0001", productFacts: { productTitle: "T" } } },
    });
    const price = items.find((item) => item.field === "price");
    expect(price?.value).toBe("unknown");
    expect(price?.raw).toBeUndefined();
  });

  it("extracts decision summary with labels", () => {
    const decision = extractDecisionSummary(batchResult);
    expect(decision?.status).toBe("needs_information");
    expect(decision?.label).toBe("待补信息");
    expect(decision?.reason).toContain("货源");
    expect(extractDecisionSummary({})).toBeNull();
  });

  it("extracts evidence gaps without inventing missing items", () => {
    expect(extractEvidenceGaps(batchResult)).toEqual(["缺采购价", "缺 MOQ"]);
    expect(extractEvidenceGaps({ decisionEvidence: {} })).toEqual([]);
  });

  it("extracts keyword brief", () => {
    const brief = extractKeywordBrief(batchResult);
    expect(brief?.primaryKeyword).toBe("insulated water bottle");
    expect(brief?.source).toBe("sellersprite");
    expect(extractKeywordBrief({})).toBeNull();
  });

  it("extracts candidate score with reference-signal semantics", () => {
    expect(extractCandidateScore(batchResult)).toEqual({ score: 73, available: true });
    expect(extractCandidateScore({})).toEqual({ score: null, available: false });
  });

  it("extracts report source provenance", () => {
    const source = extractReportSource(batchResult);
    expect(source?.reportType).toBe("search_results");
    expect(source?.capturedAt).toContain("2026-08-14");
    expect(source?.evidenceHash).toHaveLength(64);
  });

  it("maps metric nature per field contract", () => {
    expect(natureForField("price")).toBe("snapshot");
    expect(natureForField("rating")).toBe("snapshot");
    expect(natureForField("estimatedMonthlySales")).toBe("estimate");
    expect(natureForField("brand")).toBe("unknown");
  });
});
