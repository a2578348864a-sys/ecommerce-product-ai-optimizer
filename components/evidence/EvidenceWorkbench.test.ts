import { describe, expect, it } from "vitest";
import {
  buildResearchMaterialRows,
  deriveResearchStatus,
  extractCandidateScore,
  extractDecisionSummary,
  extractEvidenceGaps,
  extractKeywordBrief,
  extractOverviewItems,
  extractReportSource,
  natureForField,
  type ResearchMaterialRow,
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

// ── V3 Final R12：研究资料清单 + 研究状态行（§170/§175/§176/§177） ──

describe("buildResearchMaterialRows / deriveResearchStatus", () => {
  const emptyInput = {
    overview: [],
    competitors: [],
    keywordReportEvidence: null,
    browserEvidence: null,
    vocEvidence: null,
    sourcingConfirmed: false,
  };

  it("无任何 Evidence → 0 类已有，状态 empty（研究资料尚待补充）", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    expect(rows.filter((row) => row.state === "已有")).toHaveLength(0);
    expect(deriveResearchStatus(rows, null)).toEqual({ status: "empty", collectedLabels: [] });
  });

  it("已有 Amazon + VOC Evidence、无 AI 总结 → partial（研究进行中），正确列出已收集类别", () => {
    const rows = buildResearchMaterialRows({
      ...emptyInput,
      browserEvidence: { snapshots: [{ asin: "B0X" }] },
      vocEvidence: { dataset: { reviews: [{ id: "r1" }] } },
    });
    expect(rows.find((row) => row.key === "browser")?.state).toBe("已有");
    expect(rows.find((row) => row.key === "voc")?.state).toBe("已有");
    const summary = deriveResearchStatus(rows, null);
    expect(summary.status).toBe("partial");
    expect(summary.collectedLabels).toEqual(["Amazon 页面", "买家评论"]);
  });

  it("有 AI 证据总结 → ai_ready（AI 已整理当前资料），不再显示「研究尚未开始」", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    const summary = deriveResearchStatus(rows, { summary: "..." });
    expect(summary.status).toBe("ai_ready");
  });

  it("研究开始 ≠ AI 总结生成：有 Evidence 无 AI 时不落入 empty", () => {
    const rows = buildResearchMaterialRows({
      ...emptyInput,
      competitors: [{ asin: "B0A" }],
      sourcingConfirmed: true,
    });
    expect(deriveResearchStatus(rows, null).status).toBe("partial");
  });

  it("可选类别缺失保持可选，必填类别缺失保持待补（Requirement×Collection 语义）", () => {
    const rows = buildResearchMaterialRows(emptyInput);
    expect(rows.find((row) => row.key === "competitor")?.state).toBe("可选");
    expect(rows.find((row) => row.key === "sourcing")?.state).toBe("可选");
    expect(rows.find((row) => row.key === "keyword")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "browser")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "voc")?.state).toBe("待补");
    expect(rows.find((row) => row.key === "productBasics")?.state).toBe("待补");
  });

  it("keyword 报表已有 → keyword 行升级为已有", () => {
    const rows = buildResearchMaterialRows({ ...emptyInput, keywordReportEvidence: {} });
    expect(rows.find((row) => row.key === "keyword")?.state).toBe("已有");
  });

  it("rows 类型完整（state 只能是三态）", () => {
    const rows: ResearchMaterialRow[] = buildResearchMaterialRows(emptyInput);
    for (const row of rows) {
      expect(["已有", "待补", "可选"]).toContain(row.state);
    }
  });
});
