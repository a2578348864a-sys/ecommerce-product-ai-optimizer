import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "./fixtures/category-current.sanitized.v1";
import {
  SELLERSPRITE_SANITIZED_ROWS,
  SELLERSPRITE_SEARCH_EXPORT_HEADERS,
} from "./fixtures/search-export.sanitized.v1";
import {
  GOLDEN_CC_CURRENT_ROWS,
  GOLDEN_CURRENT_FORMAT_HEADERS,
  GOLDEN_PS_NO_SEARCH_RANK_ROWS,
  goldenRowToValues,
} from "./golden/golden-fixtures";
import { normalizeSellerSpriteField } from "./fields";
import { buildSellerSpriteMarketSnapshot } from "./marketSnapshot";
import { precheckSellerSpriteXlsx } from "./precheck";
import { detectSellerSpriteReportType } from "./reportType";
import {
  createSellerSpriteShadowSelectionBrief,
  normalizeAndValidateSellerSpriteShadowBrief,
} from "./shadowBrief";
import { createSellerSpritePreviewTestWorkbook } from "../../../tools/upstream/sellersprite-preview/test-fixtures";

const CAPTURED_AT = "2026-07-27T02:00:00.000Z";

describe("SellerSprite dual report type contract", () => {
  it("detects Search Results from workbook headers, not the file name or ordinal column", () => {
    expect(detectSellerSpriteReportType(SELLERSPRITE_SEARCH_EXPORT_HEADERS)).toMatchObject({
      reportType: "search_results",
      evidence: {
        hasSearchRankColumn: true,
        hasRootCategoryColumn: true,
        hasRootCategoryBsrColumn: true,
        hasSubCategoryColumn: true,
        hasSubCategoryBsrColumn: true,
      },
    });
    expect(detectSellerSpriteReportType([
      "#",
      "ASIN",
      "商品标题",
      "商品详情页链接",
    ])).toMatchObject({ reportType: "unknown" });
  });

  it("detects Category Current only with the row-level BSR band signature (headers alone fail closed)", () => {
    // 仅表头（PS/CC 表头相同，无「搜索排名」列）无法证明类型 → fail-closed（requires_row_signal）
    expect(detectSellerSpriteReportType(SELLERSPRITE_CATEGORY_CURRENT_HEADERS)).toMatchObject({
      reportType: "unknown",
      evidence: {
        hasSearchRankColumn: false,
        hasRootCategoryColumn: true,
        hasRootCategoryBsrColumn: true,
        hasSubCategoryColumn: true,
        hasSubCategoryBsrColumn: true,
      },
      reasonCode: "requires_row_signal",
    });
    // 行级信号（真实 BSR 榜值域 [1..10]）→ category_current
    expect(detectSellerSpriteReportType(
      SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      GOLDEN_CC_CURRENT_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    )).toMatchObject({ reportType: "category_current" });
    // 无搜索排名 + 大 BSR 值域（新格式 Product Search 模式）→ 不静默判 CC，fail-closed
    expect(detectSellerSpriteReportType(
      SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      GOLDEN_PS_NO_SEARCH_RANK_ROWS.map((row) => goldenRowToValues(row, GOLDEN_CURRENT_FORMAT_HEADERS)),
    )).toMatchObject({ reportType: "unknown", reasonCode: "ambiguous_ps_without_search_rank" });
    expect(detectSellerSpriteReportType([
      "ASIN",
      "商品标题",
      "商品详情页链接",
      "大类目",
      "大类BSR",
    ])).toMatchObject({ reportType: "unknown" });
  });

  it("normalizes Category BSR only as an unsigned positive integer", () => {
    expect(normalizeSellerSpriteField("rootCategoryBsr", "1,234")).toEqual({
      normalized: 1234,
    });
    expect(normalizeSellerSpriteField("subCategoryBsr", "")).toEqual({
      normalized: null,
    });
    expect(normalizeSellerSpriteField("rootCategoryBsr", "$123")).toMatchObject({
      normalized: null,
      errorCode: "currency_mismatch",
    });
    expect(normalizeSellerSpriteField("rootCategoryBsr", "+123")).toMatchObject({
      normalized: null,
      errorCode: "invalid_number_format",
    });
    expect(normalizeSellerSpriteField("rootCategoryBsr", "0")).toMatchObject({
      normalized: null,
      errorCode: "invalid_number_format",
    });
    expect(normalizeSellerSpriteField("subCategoryBsr", "7\n9")).toEqual({
      normalized: [7, 9],
    });
  });

  it("prechecks Category Current with explicit type matching and field applicability", () => {
    const result = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook({
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    }), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "category_current",
    });

    expect(result).toMatchObject({
      schemaVersion: "sellersprite-xlsx-precheck.v2",
      reportType: "category_current",
      expectedReportType: "category_current",
      reportTypeMatched: true,
      headerColumnCount: 72,
      acceptedRows: 2,
      rejectedRows: 0,
    });
    expect(result.reportTypeDetectionEvidence).toMatchObject({
      hasSearchRankColumn: false,
      hasRootCategoryBsrColumn: true,
      hasSubCategoryBsrColumn: true,
    });
    expect(result.records[0].searchRank).toMatchObject({
      raw: null,
      normalized: null,
      applicability: "not_applicable",
    });
    expect(result.records[0].rootCategoryBsr).toMatchObject({
      raw: "1,234",
      normalized: 1234,
      applicability: "available",
      sourceType: "provider_metric",
      metricNature: "snapshot",
    });
    expect(result.records[0].extraRaw["#"]).toBe("1");
  });

  it("fails closed when explicit and detected report types differ", () => {
    const result = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook(), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "category_current",
    });
    expect(result.reportType).toBe("search_results");
    expect(result.reportTypeMatched).toBe(false);
    expect(result.acceptedRows).toBe(0);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "report_type_mismatch",
      severity: "error",
    }));
  });

  it("fails closed for an unknown template rather than defaulting to Search", () => {
    const headers = SELLERSPRITE_SEARCH_EXPORT_HEADERS.filter((header) => (
      header !== "搜索排名"
      && header !== "大类BSR"
      && header !== "小类BSR"
    ));
    const result = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook({
      headers,
      rows: SELLERSPRITE_SANITIZED_ROWS,
    }), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "search_results",
    });
    expect(result.reportType).toBe("unknown");
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "unsupported_report_type",
      severity: "error",
    }));
  });

  it("distinguishes missing and invalid Search Rank values", () => {
    const missing = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook({
      rows: [{ ...SELLERSPRITE_SANITIZED_ROWS[0], 搜索排名: "" }],
    }), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "search_results",
    });
    expect(missing.records[0].searchRank.applicability).toBe("missing");

    const invalid = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook({
      rows: [{ ...SELLERSPRITE_SANITIZED_ROWS[0], 搜索排名: "第一个位置" }],
    }), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "search_results",
    });
    expect(invalid.rejectedRecords[0].normalizedRecord?.searchRank.applicability).toBe("invalid");
  });

  it("projects Category Current records without creating Search appearances or missing search signals", () => {
    const precheck = precheckSellerSpriteXlsx(createSellerSpritePreviewTestWorkbook({
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    }), {
      capturedAt: CAPTURED_AT,
      expectedReportType: "category_current",
    });
    const snapshot = buildSellerSpriteMarketSnapshot(precheck);

    expect(snapshot).toMatchObject({
      schemaVersion: "sellersprite-market-snapshot.v3",
      reportType: "category_current",
      placementSummary: { status: "not_applicable" },
      sponsoredPlacementCount: null,
      organicPlacementCount: null,
      unknownPlacementCount: null,
    });
    expect(snapshot.appearances).toEqual([]);
    expect(snapshot.occurrences).toHaveLength(2);
    expect(snapshot.occurrences.every(
      (occurrence) => occurrence.occurrenceType === "category_current_record",
    )).toBe(true);
    expect(snapshot.occurrences[0]).toMatchObject({
      occurrenceType: "category_current_record",
      ordinalRaw: "1",
      rootCategory: { normalized: "Synthetic Root Category" },
      rootCategoryBsr: { normalized: 1234 },
      subCategory: { normalized: "Synthetic Subcategory" },
      subCategoryBsr: { normalized: 57 },
    });
    expect(snapshot.products[0]).toMatchObject({
      reportType: "category_current",
      sponsoredAppearanceCount: null,
      organicAppearanceCount: null,
      unknownAppearanceCount: null,
      placementSummary: { status: "not_applicable" },
      categoryEvidenceSummary: {
        rootCategoryBsr: { status: "resolved", normalized: 1234 },
        subCategoryBsr: { status: "resolved", normalized: 57 },
      },
    });
    expect(snapshot.families[0]).toMatchObject({
      reportType: "category_current",
      occurrenceCount: 2,
      aggregationPolicy: "identity_only_no_metric_aggregation",
    });
    expect(snapshot.categoryBsrSummary.rootCategoryBsr).toMatchObject({
      validCount: 2,
      missingCount: 0,
      conflictCount: 0,
      minimum: 1234,
      median: 1851,
      maximum: 2468,
    });
    expect(snapshot.missingSignals).not.toContain("product_field:searchRank");
    expect(snapshot.missingSignals).not.toContain("product_field_partial:searchRank");
  });

  it("binds reportType to normalized business hashes but not runtime ingestion time", () => {
    const categoryWorkbook = createSellerSpritePreviewTestWorkbook({
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    });
    const first = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      categoryWorkbook,
      { capturedAt: CAPTURED_AT, expectedReportType: "category_current" },
    ));
    const later = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      categoryWorkbook,
      { capturedAt: "2026-07-27T03:00:00.000Z", expectedReportType: "category_current" },
    ));
    const searchHeaders = [
      ...SELLERSPRITE_CATEGORY_CURRENT_HEADERS.slice(0, 7),
      "搜索排名",
      ...SELLERSPRITE_CATEGORY_CURRENT_HEADERS.slice(7),
    ];
    const searchRows = SELLERSPRITE_CATEGORY_CURRENT_ROWS.map((row) => ({
      ...row,
      搜索排名: "自然位：第1页第1位",
    }));
    const search = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createSellerSpritePreviewTestWorkbook({ headers: searchHeaders, rows: searchRows }),
      { capturedAt: CAPTURED_AT, expectedReportType: "search_results" },
    ));

    expect(first.normalizedBusinessHash).toBe(later.normalizedBusinessHash);
    expect(first.normalizedBusinessHash).not.toBe(search.normalizedBusinessHash);
  });

  it("keeps Category business hashes stable when columns are reordered", () => {
    const normal = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }),
      { capturedAt: CAPTURED_AT, expectedReportType: "category_current" },
    ));
    const reordered = buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
      createSellerSpritePreviewTestWorkbook({
        headers: [...SELLERSPRITE_CATEGORY_CURRENT_HEADERS].reverse(),
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
      }),
      { capturedAt: CAPTURED_AT, expectedReportType: "category_current" },
    ));
    expect(normal.normalizedBusinessHash).toBe(reordered.normalizedBusinessHash);
  });

  it("uses discriminated Briefs and includes reportType in briefHash", () => {
    const common = {
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      category: "Synthetic Category",
      priceMin: 20,
      priceMax: 100,
      requiredSignals: ["price", "rating", "reviews"],
      optionalSignals: ["estimatedMonthlySales"],
      createdAt: CAPTURED_AT,
      briefSource: "dual-report-test",
    } as const;
    const search = createSellerSpriteShadowSelectionBrief({
      ...common,
      reportType: "search_results",
      query: "synthetic query",
    });
    const category = createSellerSpriteShadowSelectionBrief({
      ...common,
      reportType: "category_current",
      query: null,
    });
    expect(search.briefHash).not.toBe(category.briefHash);
    expect(search.query).toBe("synthetic query");
    expect(category.query).toBeNull();
    expect(() => createSellerSpriteShadowSelectionBrief({
      ...common,
      reportType: "category_current",
      query: "not allowed",
    })).toThrow("SELLERSPRITE_BRIEF_QUERY_NOT_APPLICABLE");
    expect(() => normalizeAndValidateSellerSpriteShadowBrief({
      ...category,
      query: "tampered",
    })).toThrow();
  });
});
