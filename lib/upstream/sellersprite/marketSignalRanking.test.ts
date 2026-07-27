import { describe, expect, it, vi } from "vitest";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "./fixtures/category-current.sanitized.v1";
import {
  SELLERSPRITE_SANITIZED_ROWS,
} from "./fixtures/search-export.sanitized.v1";
import { buildSellerSpriteMarketSnapshot } from "./marketSnapshot";
import {
  rankSellerSpriteMarketSignals,
  type SellerSpriteMarketSignalRankedProduct,
} from "./marketSignalRanking";
import { precheckSellerSpriteXlsx } from "./precheck";
import { createSellerSpriteShadowSelectionBrief } from "./shadowBrief";
import { createSellerSpritePreviewTestWorkbook } from "../../../tools/upstream/sellersprite-preview/test-fixtures";

const CAPTURED_AT = "2026-07-27T02:00:00.000Z";

const SEARCH_HEADERS = [
  "ASIN",
  "Product Title",
  "Product URL",
  "Parent ASIN",
  "Search Rank",
  "Price",
  "Rating",
  "Reviews",
  "Estimated Monthly Sales",
  "Estimated Monthly Revenue",
  "Variation Count",
  "Brand",
  "Seller",
  "Root Category",
  "Root Category BSR",
  "Subcategory",
  "Subcategory BSR",
] as const;

const CATEGORY_HEADERS = SEARCH_HEADERS.filter((header) => header !== "Search Rank");

interface SyntheticRowInput {
  asin?: string;
  parentAsin?: string;
  placementType?: "sponsored" | "organic";
  page?: number;
  position?: number;
  searchRank?: string;
  price?: string;
  rating?: string;
  reviews?: string;
  sales?: string;
  revenue?: string;
  variationCount?: string;
  rootCategory?: string;
  rootCategoryBsr?: string;
  subCategory?: string;
  subCategoryBsr?: string;
  title?: string;
}

function asSearchProduct(product: SellerSpriteMarketSignalRankedProduct) {
  if (product.reportType !== "search_results") {
    throw new Error("EXPECTED_SEARCH_RANKING_PRODUCT");
  }
  return product;
}

function asCategoryProduct(product: SellerSpriteMarketSignalRankedProduct) {
  if (product.reportType !== "category_current") {
    throw new Error("EXPECTED_CATEGORY_RANKING_PRODUCT");
  }
  return product;
}

function searchRankRaw(
  placementType: "sponsored" | "organic",
  page: number,
  position: number,
): string {
  return `${placementType === "sponsored" ? "广告位" : "自然位"}：第${page}页第${position}位`;
}

function syntheticRow(index: number, input: SyntheticRowInput = {}): Record<string, string> {
  const asin = input.asin ?? `B0TST${String(index).padStart(5, "0")}`;
  const price = input.price ?? "30";
  const sales = input.sales ?? String(1000 - index * 25);
  return {
    ASIN: asin,
    "Product Title": input.title ?? `Synthetic Product ${index}`,
    "Product URL": `https://www.amazon.com/dp/${asin}`,
    "Parent ASIN": input.parentAsin ?? "",
    "Search Rank": input.searchRank ?? searchRankRaw(
      input.placementType ?? "sponsored",
      input.page ?? 1,
      input.position ?? index,
    ),
    Price: price,
    Rating: input.rating ?? "4.5",
    Reviews: input.reviews ?? String(100 + index * 10),
    "Estimated Monthly Sales": sales,
    "Estimated Monthly Revenue": input.revenue ?? (
      price === "" || sales === "" ? "" : String(Number(price) * Number(sales))
    ),
    "Variation Count": input.variationCount ?? "2",
    Brand: "Synthetic Brand",
    Seller: "Synthetic Seller",
    "Root Category": input.rootCategory ?? "Synthetic Root",
    "Root Category BSR": input.rootCategoryBsr ?? String(100 + index),
    Subcategory: input.subCategory ?? "Synthetic Subcategory",
    "Subcategory BSR": input.subCategoryBsr ?? String(10 + index),
  };
}

function buildSyntheticSnapshot(
  reportType: "search_results" | "category_current",
  rows: ReadonlyArray<Readonly<Record<string, string>>>,
) {
  return buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
    createSellerSpritePreviewTestWorkbook({
      headers: reportType === "search_results" ? SEARCH_HEADERS : CATEGORY_HEADERS,
      rows,
    }),
    {
      capturedAt: CAPTURED_AT,
      expectedReportType: reportType,
    },
  ));
}

function buildSearchSnapshot() {
  return buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
    createSellerSpritePreviewTestWorkbook({
      rows: SELLERSPRITE_SANITIZED_ROWS,
    }),
    {
      capturedAt: CAPTURED_AT,
      expectedReportType: "search_results",
    },
  ));
}

function buildCategorySnapshot() {
  return buildSellerSpriteMarketSnapshot(precheckSellerSpriteXlsx(
    createSellerSpritePreviewTestWorkbook({
      headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
      rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS,
    }),
    {
      capturedAt: CAPTURED_AT,
      expectedReportType: "category_current",
    },
  ));
}

function buildBrief(reportType: "search_results" | "category_current") {
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
    briefSource: "market-signal-ranking-test",
  } as const;
  return reportType === "search_results"
    ? createSellerSpriteShadowSelectionBrief({
      ...common,
      reportType,
      query: "synthetic query",
    })
    : createSellerSpriteShadowSelectionBrief({
      ...common,
      reportType,
      query: null,
    });
}

describe("SellerSprite offline market signal ranking", () => {
  it("uses separate frozen Search and Category models", () => {
    const search = rankSellerSpriteMarketSignals({
      snapshot: buildSearchSnapshot(),
      brief: buildBrief("search_results"),
    });
    const category = rankSellerSpriteMarketSignals({
      snapshot: buildCategorySnapshot(),
      brief: buildBrief("category_current"),
    });

    expect(search).toMatchObject({
      schemaVersion: "sellersprite-market-signal-ranking.v2",
      modelVersion: "sellersprite-market-signal-ranking.search.v2",
      coverageFormulaVersion: "sellersprite-market-signal-coverage.v2",
      reportType: "search_results",
      weights: {
        priceFit: 15,
        estimatedMonthlySales: 25,
        ratingQuality: 15,
        salesReviewEfficiency: 15,
        organicVisibility: 20,
        placementCoverage: 5,
        sponsoredExposure: 5,
      },
    });
    expect(category).toMatchObject({
      schemaVersion: "sellersprite-market-signal-ranking.v2",
      modelVersion: "sellersprite-market-signal-ranking.category.v2",
      coverageFormulaVersion: "sellersprite-market-signal-coverage.v2",
      reportType: "category_current",
      weights: {
        priceFit: 20,
        estimatedMonthlySales: 20,
        ratingQuality: 20,
        salesReviewEfficiency: 20,
        categoryBsrSignal: 20,
      },
    });
  });

  it("fails closed for a non-v3 Snapshot", () => {
    const snapshot = {
      ...buildSearchSnapshot(),
      schemaVersion: "sellersprite-market-snapshot.v2",
    };
    expect(() => rankSellerSpriteMarketSignals({
      snapshot: snapshot as never,
      brief: buildBrief("search_results"),
    })).toThrow("SELLERSPRITE_RANKING_SNAPSHOT_VERSION_UNSUPPORTED");
  });

  it("fails closed for an unsupported report type", () => {
    const snapshot = {
      ...buildSearchSnapshot(),
      reportType: "unknown",
    };
    expect(() => rankSellerSpriteMarketSignals({
      snapshot: snapshot as never,
      brief: buildBrief("search_results"),
    })).toThrow("SELLERSPRITE_RANKING_REPORT_TYPE_UNSUPPORTED");
  });

  it("fails closed when the Brief report type does not match the Snapshot", () => {
    expect(() => rankSellerSpriteMarketSignals({
      snapshot: buildSearchSnapshot(),
      brief: buildBrief("category_current"),
    })).toThrow("SELLERSPRITE_RANKING_BRIEF_REPORT_TYPE_MISMATCH");
  });

  it("returns source-bound hashes and fixed non-authoritative safety flags", () => {
    const snapshot = buildSearchSnapshot();
    const brief = buildBrief("search_results");
    const result = rankSellerSpriteMarketSignals({ snapshot, brief });

    expect(result).toMatchObject({
      sourceFileSha256: snapshot.sourceFileSha256,
      sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
      normalizedBusinessHash: snapshot.normalizedBusinessHash,
      briefHash: brief.briefHash,
      authoritative: false,
      currentStage1Invoked: false,
      hardGateEvaluable: false,
      promotionEligible: false,
      manifestRegistered: false,
      productionEffect: false,
      productionDatabaseWritten: false,
    });
    expect(result.unrankedProductCount).toBe(
      result.productCount - result.rankableProductCount,
    );
    expect(result.familyResearchListCount).toBe(result.familyResearchList.length);
    expect(result.normalizationPolicy).toMatchObject({
      version: "sellersprite-market-signal-normalization.v2",
      percentile: "full_precision_midrank",
      singletonPercentile: 0.5,
      missingAndConflictingValues: "excluded",
      conditionalScoreNormalization: "available_weight_only",
      comparisonScoreNormalization: "fixed_total_weight_100",
      tiePolicy: "competition_rank",
    });
    expect(result.rankingHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("treats both Brief price boundaries as inside the range", () => {
    const snapshot = buildSyntheticSnapshot("category_current", [
      syntheticRow(1, { price: "20" }),
      syntheticRow(2, { price: "100" }),
      syntheticRow(3, { price: "100.01" }),
    ]);
    const result = rankSellerSpriteMarketSignals({
      snapshot,
      brief: buildBrief("category_current"),
    });

    expect(result.products.find((product) => product.asin === "B0TST00001")
      ?.componentScores.priceFit).toBe(1);
    expect(result.products.find((product) => product.asin === "B0TST00002")
      ?.componentScores.priceFit).toBe(1);
    expect(result.products.find((product) => product.asin === "B0TST00003")
      ?.componentScores.priceFit).toBe(0);
  });

  it("removes missing price from coverage instead of treating it as zero", () => {
    const snapshot = buildSyntheticSnapshot("search_results", [
      syntheticRow(1, { price: "" }),
      syntheticRow(2),
    ]);
    const result = rankSellerSpriteMarketSignals({
      snapshot,
      brief: buildBrief("search_results"),
    });
    const missingPrice = result.products.find((product) => product.asin === "B0TST00001");

    expect(missingPrice).toMatchObject({
      evidenceCoverage: 0.85,
      evidenceStatus: "sufficient_for_comparison",
      componentScores: { priceFit: null },
    });
    expect(missingPrice?.missingSignals).toContain("priceFit");
  });

  it("does not rank a product with missing estimated monthly sales", () => {
    const snapshot = buildSyntheticSnapshot("search_results", [
      syntheticRow(1, { sales: "" }),
      syntheticRow(2),
    ]);
    const result = rankSellerSpriteMarketSignals({
      snapshot,
      brief: buildBrief("search_results"),
    });
    const missingSales = result.products.find((product) => product.asin === "B0TST00001");

    expect(missingSales).toMatchObject({
      scoreRank: null,
      evidenceStatus: "limited_evidence",
      researchPriority: "unranked_insufficient_evidence",
    });
    expect(missingSales?.missingSignals).toContain("estimatedMonthlySales");
  });

  it("does not choose a favorable value when estimated sales conflict", () => {
    const asin = "B0TST00001";
    const snapshot = buildSyntheticSnapshot("search_results", [
      syntheticRow(1, { asin, sales: "100" }),
      syntheticRow(2, { asin, sales: "9999", position: 2 }),
      syntheticRow(3),
    ]);
    const result = rankSellerSpriteMarketSignals({
      snapshot,
      brief: buildBrief("search_results"),
    });
    const conflict = result.products.find((product) => product.asin === asin);

    expect(conflict?.evidenceCoverage).toBe(0.45);
    expect(conflict).toMatchObject({
      scoreRank: null,
      evidenceStatus: "insufficient_evidence",
    });
    expect(conflict?.conflictingSignals).toContain("estimatedMonthlySales");
  });

  it("treats Category search placement as not applicable without reducing coverage", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1),
        syntheticRow(2),
      ]),
      brief: buildBrief("category_current"),
    });

    expect(result.products.every((product) => product.evidenceCoverage === 1)).toBe(true);
    expect(result.products.every((product) => (
      !("organicVisibility" in product.componentScores)
      && !("sponsoredExposure" in product.componentScores)
      && !("placementCoverage" in product.componentScores)
      && !product.missingSignals.includes("searchPlacement")
    ))).toBe(true);
  });

  it("does not rank Search products without any valid placement", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("search_results", [
        syntheticRow(1, { searchRank: "" }),
        syntheticRow(2),
      ]),
      brief: buildBrief("search_results"),
    });
    const noPlacement = result.products.find((product) => product.asin === "B0TST00001");

    expect(noPlacement).toMatchObject({
      evidenceCoverage: 0.7,
      evidenceStatus: "limited_evidence",
      scoreRank: null,
    });
    expect(noPlacement?.missingSignals).toContain("searchPlacement");
  });

  it("keeps sponsored-only evidence distinct from organic visibility", () => {
    const sponsoredOnly = asSearchProduct(rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("search_results", [
        syntheticRow(1, { placementType: "sponsored" }),
      ]),
      brief: buildBrief("search_results"),
    }).products[0]);
    const both = asSearchProduct(rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("search_results", [
        syntheticRow(1, { placementType: "sponsored" }),
        syntheticRow(1, { asin: "B0TST00001", placementType: "organic", position: 2 }),
      ]),
      brief: buildBrief("search_results"),
    }).products[0]);

    expect(sponsoredOnly.componentScores).toMatchObject({
      organicVisibility: 0,
      placementCoverage: 0.25,
      sponsoredExposure: 0.5,
    });
    expect(sponsoredOnly.missingSignals).not.toContain("organicVisibility");
    expect(sponsoredOnly.counterSignals).toContain("sponsored_only_visibility");
    expect(both.componentScores.placementCoverage).toBe(1);
  });

  it("uses midranks, n=1 neutrality, and the frozen small-sample shrinkage", () => {
    const single = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [syntheticRow(1)]),
      brief: buildBrief("category_current"),
    }).products[0];
    const tied = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "100" }),
        syntheticRow(2, { sales: "100" }),
        syntheticRow(3, { sales: "200" }),
      ]),
      brief: buildBrief("category_current"),
    });
    const pair = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "100" }),
        syntheticRow(2, { sales: "200" }),
      ]),
      brief: buildBrief("category_current"),
    });

    expect(single.componentScores.estimatedMonthlySales).toBe(0.5);
    expect(tied.products.find((product) => product.asin === "B0TST00001")
      ?.componentScores.estimatedMonthlySales).toBe(0.375);
    expect(tied.products.find((product) => product.asin === "B0TST00002")
      ?.componentScores.estimatedMonthlySales).toBe(0.375);
    expect(pair.products.find((product) => product.asin === "B0TST00001")
      ?.componentScores.estimatedMonthlySales).toBe(0.375);
    expect(pair.products.find((product) => product.asin === "B0TST00002")
      ?.componentScores.estimatedMonthlySales).toBe(0.625);
  });

  it("is independent of product input order and locale helpers", () => {
    const snapshot = buildSyntheticSnapshot("category_current", [
      syntheticRow(1),
      syntheticRow(2),
      syntheticRow(3),
    ]);
    const localeCompare = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("localeCompare must not be used");
      });
    try {
      const first = rankSellerSpriteMarketSignals({
        snapshot,
        brief: buildBrief("category_current"),
      });
      const second = rankSellerSpriteMarketSignals({
        snapshot: { ...snapshot, products: [...snapshot.products].reverse() },
        brief: buildBrief("category_current"),
      });
      expect(second.products).toEqual(first.products);
      expect(second.rankingHash).toBe(first.rankingHash);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("uses lower-is-better root BSR and does not compare different subcategories", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, {
          rootCategoryBsr: "100",
          subCategory: "Sub A",
          subCategoryBsr: "1",
        }),
        syntheticRow(2, {
          rootCategoryBsr: "200",
          subCategory: "Sub B",
          subCategoryBsr: "999",
        }),
      ]),
      brief: buildBrief("category_current"),
    });
    const first = asCategoryProduct(
      result.products.find((product) => product.asin === "B0TST00001")!,
    );
    const second = asCategoryProduct(
      result.products.find((product) => product.asin === "B0TST00002")!,
    );

    expect(first?.componentScores.categoryBsrSignal).toBe(0.625);
    expect(second?.componentScores.categoryBsrSignal).toBe(0.375);
    expect(first?.counterSignals).toContain("subcategory_bsr_not_comparable");
    expect(second?.counterSignals).toContain("subcategory_bsr_not_comparable");
  });

  it("uses subcategory BSR only inside exact groups with at least three valid products", () => {
    const rows = [
      syntheticRow(1, { rootCategoryBsr: "100", subCategory: "Same", subCategoryBsr: "30" }),
      syntheticRow(2, { rootCategoryBsr: "100", subCategory: "Same", subCategoryBsr: "20" }),
      syntheticRow(3, { rootCategoryBsr: "100", subCategory: "Same", subCategoryBsr: "10" }),
      syntheticRow(4, { rootCategoryBsr: "100", subCategory: "Different", subCategoryBsr: "1" }),
    ];
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", rows),
      brief: buildBrief("category_current"),
    });
    const bestSame = asCategoryProduct(
      result.products.find((product) => product.asin === "B0TST00003")!,
    );
    const different = asCategoryProduct(
      result.products.find((product) => product.asin === "B0TST00004")!,
    );

    expect(bestSame?.componentScores.categoryBsrSignal).toBeGreaterThan(0.5);
    expect(bestSame?.positiveReasons).toContain("subcategory_bsr_comparable_within_exact_group");
    expect(different?.componentScores.categoryBsrSignal).toBe(0.5);
    expect(different?.counterSignals).toContain("subcategory_bsr_not_comparable");
  });

  it("makes rating quality unavailable without rating and both derived components unavailable without reviews", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { rating: "" }),
        syntheticRow(2, { reviews: "" }),
        syntheticRow(3),
      ]),
      brief: buildBrief("category_current"),
    });
    const noRating = result.products.find((product) => product.asin === "B0TST00001");
    const noReviews = result.products.find((product) => product.asin === "B0TST00002");

    expect(noRating?.componentScores.ratingQuality).toBeNull();
    expect(noReviews?.componentScores.ratingQuality).toBeNull();
    expect(noReviews?.componentScores.salesReviewEfficiency).toBeNull();
  });

  it("uses the frozen sales-review efficiency formula without giving low sales a false boost", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "200", reviews: "10" }),
        syntheticRow(2, { sales: "100", reviews: "20" }),
      ]),
      brief: buildBrief("category_current"),
    });
    const highSalesLowReviews = result.products.find(
      (product) => product.asin === "B0TST00001",
    );
    const lowSalesHighReviews = result.products.find(
      (product) => product.asin === "B0TST00002",
    );

    expect(highSalesLowReviews?.componentScores.salesReviewEfficiency).toBe(0.625);
    expect(lowSalesHighReviews?.componentScores.salesReviewEfficiency).toBe(0.375);
  });

  it("keeps matched high/high and low/low sales-review evidence neutral", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "200", reviews: "200" }),
        syntheticRow(2, { sales: "100", reviews: "100" }),
      ]),
      brief: buildBrief("category_current"),
    });

    expect(result.products.every(
      (product) => product.componentScores.salesReviewEfficiency === 0.5,
    )).toBe(true);
  });

  it("keeps an out-of-range price as a zero component instead of rejecting the product", () => {
    const product = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { price: "101", variationCount: "99" }),
      ]),
      brief: buildBrief("category_current"),
    }).products[0];

    expect(product).toMatchObject({
      evidenceStatus: "sufficient_for_comparison",
      componentScores: { priceFit: 0 },
    });
    expect(product.counterSignals).toContain("price_outside_brief_range");
    expect(product.counterSignals).toContain("multiple_variations_context_only_no_score");
    expect(product.componentScores).not.toHaveProperty("variationCount");
  });

  it("does not score estimated revenue and does not duplicate product-level sales", () => {
    const asin = "B0TST00001";
    const firstSnapshot = buildSyntheticSnapshot("search_results", [
      syntheticRow(1, { asin, revenue: "1000" }),
      syntheticRow(1, { asin, revenue: "1000", placementType: "organic", position: 2 }),
      syntheticRow(2),
    ]);
    const secondSnapshot = buildSyntheticSnapshot("search_results", [
      syntheticRow(1, { asin, revenue: "999999" }),
      syntheticRow(1, { asin, revenue: "999999", placementType: "organic", position: 2 }),
      syntheticRow(2),
    ]);
    const first = rankSellerSpriteMarketSignals({
      snapshot: firstSnapshot,
      brief: buildBrief("search_results"),
    });
    const second = rankSellerSpriteMarketSignals({
      snapshot: secondSnapshot,
      brief: buildBrief("search_results"),
    });

    expect(first.productCount).toBe(2);
    expect(first.products.find((product) => product.asin === asin)?.signalScore)
      .toBe(second.products.find((product) => product.asin === asin)?.signalScore);
    expect(first.products[0].componentScores).not.toHaveProperty("estimatedMonthlyRevenue");
    expect(first.rankingHash).not.toBe(second.rankingHash);
  });

  it("uses fixed-total comparison points without rewarding missing evidence", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, {
          rating: "",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
        syntheticRow(2, {
          rating: "1",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
      ]),
      brief: buildBrief("category_current"),
    });
    const missing = result.products.find((item) => item.asin === "B0TST00001")!;
    const complete = result.products.find((item) => item.asin === "B0TST00002")!;

    expect(missing).toMatchObject({
      availableWeight: 80,
      earnedWeightedPoints: 50,
      conditionalSignalScore: 62.5,
      evidenceCoverage: 0.8,
      signalScore: 50,
      coveragePenalty: 12.5,
      evidenceStatus: "sufficient_for_comparison",
      scoreRank: 1,
      scoreTie: true,
    });
    expect(complete).toMatchObject({
      availableWeight: 100,
      earnedWeightedPoints: 50,
      conditionalSignalScore: 50,
      evidenceCoverage: 1,
      signalScore: 50,
      coveragePenalty: 0,
      evidenceStatus: "sufficient_for_comparison",
      scoreRank: 1,
      scoreTie: true,
    });
    expect(result.products.map((product) => product.asin)).toEqual([
      complete.asin,
      missing.asin,
    ]);
    expect(missing.signalScore).toBe(
      missing.conditionalSignalScore! * missing.evidenceCoverage,
    );
  });

  it("keeps comparison points monotonic when missing evidence becomes zero or positive", () => {
    const makeResult = (rating: string) => rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, {
          rating,
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
        syntheticRow(2, {
          rating: "1",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
      ]),
      brief: buildBrief("category_current"),
    }).products.find((product) => product.asin === "B0TST00001")!;
    const missing = makeResult("");
    const zero = makeResult("1");
    const positive = makeResult("5");

    expect(missing.signalScore).toBe(50);
    expect(zero.signalScore).toBe(50);
    expect(zero.evidenceCoverage).toBeGreaterThan(missing.evidenceCoverage);
    expect(positive.signalScore).toBeGreaterThan(zero.signalScore!);
  });

  it("keeps conditional scores diagnostic-only for limited and insufficient evidence", () => {
    const limited = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { rating: "", reviews: "" }),
        syntheticRow(2),
      ]),
      brief: buildBrief("category_current"),
    }).products.find((product) => product.asin === "B0TST00001")!;
    const insufficient = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { rating: "", reviews: "", sales: "" }),
        syntheticRow(2),
      ]),
      brief: buildBrief("category_current"),
    }).products.find((product) => product.asin === "B0TST00001")!;
    const coreMissing = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("search_results", [
        syntheticRow(1, { sales: "" }),
        syntheticRow(2),
      ]),
      brief: buildBrief("search_results"),
    }).products.find((product) => product.asin === "B0TST00001")!;

    expect(limited).toMatchObject({
      availableWeight: 60,
      evidenceCoverage: 0.6,
      evidenceStatus: "limited_evidence",
      signalScore: null,
      scoreRank: null,
      conditionalSignalScore: expect.any(Number),
    });
    expect(insufficient).toMatchObject({
      availableWeight: 40,
      evidenceCoverage: 0.4,
      evidenceStatus: "insufficient_evidence",
      signalScore: null,
      scoreRank: null,
      conditionalSignalScore: null,
      coveragePenalty: null,
    });
    expect(coreMissing).toMatchObject({
      availableWeight: 60,
      evidenceCoverage: 0.6,
      evidenceStatus: "limited_evidence",
      signalScore: null,
      scoreRank: null,
    });
    expect(coreMissing.earnedWeightedPoints).toBeLessThanOrEqual(coreMissing.availableWeight);
    expect(coreMissing.conditionalSignalScore).toBeLessThanOrEqual(100);
  });

  it("unranks any product with a conflict in a scoring source field", () => {
    const asin = "B0TST00001";
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, {
          asin,
          rating: "4",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
        syntheticRow(1, {
          asin,
          rating: "5",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
        syntheticRow(2, {
          rating: "1",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
      ]),
      brief: buildBrief("category_current"),
    });
    const conflict = result.products.find((product) => product.asin === asin)!;

    expect(conflict).toMatchObject({
      availableWeight: 80,
      evidenceCoverage: 0.8,
      evidenceStatus: "limited_evidence",
      signalScore: null,
      scoreRank: null,
      researchPriority: "unranked_insufficient_evidence",
      conditionalSignalScore: 62.5,
    });
    expect(conflict.conflictingSignals).toContain("rating");
    expect(result.familyResearchList.find(
      (family) => family.familyIdentity === asin,
    )?.rankableMemberCount).toBe(0);
  });

  it("chooses family representatives by comparison points before coverage", () => {
    const parentAsin = "B0PAR00001";
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, {
          parentAsin,
          rating: "",
          sales: "200",
          reviews: "100",
          rootCategoryBsr: "100",
          subCategoryBsr: "100",
        }),
        syntheticRow(2, {
          parentAsin,
          rating: "1",
          sales: "100",
          reviews: "100",
          rootCategoryBsr: "200",
          subCategoryBsr: "100",
        }),
      ]),
      brief: buildBrief("category_current"),
    });
    const lessComplete = result.products.find((product) => product.asin === "B0TST00001")!;
    const complete = result.products.find((product) => product.asin === "B0TST00002")!;
    const family = result.familyResearchList.find(
      (item) => item.familyIdentity === parentAsin,
    );

    expect(lessComplete.signalScore).toBeGreaterThan(complete.signalScore!);
    expect(lessComplete.evidenceCoverage).toBeLessThan(complete.evidenceCoverage);
    expect(family?.representativeAsin).toBe(lessComplete.asin);
  });

  it("uses explicit Parent ASIN only and keeps one representative per family", () => {
    const parent = "B0PAR00001";
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { parentAsin: parent, title: "Shared title" }),
        syntheticRow(2, { parentAsin: parent, title: "Shared title" }),
        syntheticRow(3, { title: "Shared title" }),
      ]),
      brief: buildBrief("category_current"),
    });
    const family = result.familyResearchList.find((item) => item.familyIdentity === parent);
    const singleton = result.familyResearchList.find(
      (item) => item.familyIdentity === "B0TST00003",
    );

    expect(family?.members).toEqual(["B0TST00001", "B0TST00002"]);
    expect(family?.rankableMemberCount).toBe(2);
    expect(result.products.filter((product) => (
      product.familyIdentity === parent && product.familyRepresentative
    ))).toHaveLength(1);
    expect(singleton?.members).toEqual(["B0TST00003"]);
  });

  it("uses competition ranks and keeps ties in the higher priority band", () => {
    const rows = Array.from({ length: 7 }, (_, index) => syntheticRow(index + 1, {
      sales: "100",
      reviews: "100",
      rootCategoryBsr: "100",
      subCategory: "Same",
      subCategoryBsr: "100",
    }));
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", rows),
      brief: buildBrief("category_current"),
    });

    expect(result.products.map((product) => product.scoreRank)).toEqual(
      Array.from({ length: 7 }, () => 1),
    );
    expect(result.products.every((product) => product.scoreTie)).toBe(true);
    expect(result.products.every((product) => product.researchPriority === "priority_1"))
      .toBe(true);
    expect(result.products.map((product) => product.asin)).toEqual(
      [...result.products.map((product) => product.asin)].sort(),
    );
  });

  it("keeps rankingHash stable across runtime times and changes it for Brief or business data", () => {
    const snapshot = buildSyntheticSnapshot("category_current", [
      syntheticRow(1),
      syntheticRow(2),
    ]);
    const brief = buildBrief("category_current");
    const base = rankSellerSpriteMarketSignals({ snapshot, brief });
    const differentTimes = rankSellerSpriteMarketSignals({
      snapshot: {
        ...snapshot,
        ingestedAt: "2030-01-01T00:00:00.000Z",
      },
      brief: {
        ...brief,
        createdAt: "2030-01-01T00:00:00.000Z",
      },
    });
    const differentBrief = rankSellerSpriteMarketSignals({
      snapshot,
      brief: createSellerSpriteShadowSelectionBrief({
        reportType: "category_current",
        marketplace: brief.marketplace,
        market: brief.market,
        currency: brief.currency,
        category: brief.category,
        priceMin: brief.priceMin,
        priceMax: 101,
        requiredSignals: brief.requiredSignals,
        optionalSignals: brief.optionalSignals,
        createdAt: CAPTURED_AT,
        briefSource: brief.briefSource,
        query: null,
      }),
    });
    const differentBusiness = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "9999" }),
        syntheticRow(2),
      ]),
      brief,
    });

    expect(differentTimes.rankingHash).toBe(base.rankingHash);
    expect(differentBrief.rankingHash).not.toBe(base.rankingHash);
    expect(differentBusiness.rankingHash).not.toBe(base.rankingHash);
  });

  it("keeps coverage arithmetic finite, monotonic, and free of negative zero", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1),
        syntheticRow(2, { price: "", rating: "" }),
        syntheticRow(3, { rating: "", reviews: "" }),
        syntheticRow(4, { rating: "", reviews: "", sales: "" }),
      ]),
      brief: buildBrief("category_current"),
    });
    const numbers: number[] = [];
    const collectNumbers = (value: unknown): void => {
      if (typeof value === "number") {
        numbers.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(collectNumbers);
        return;
      }
      if (value !== null && typeof value === "object") {
        Object.values(value).forEach(collectNumbers);
      }
    };
    collectNumbers(result);

    expect(numbers.length).toBeGreaterThan(0);
    for (const value of numbers) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Object.is(value, -0)).toBe(false);
    }
    for (const product of result.products) {
      expect(product.earnedWeightedPoints).toBeLessThanOrEqual(product.availableWeight);
      if (product.conditionalSignalScore !== null) {
        expect(product.earnedWeightedPoints).toBeCloseTo(
          product.conditionalSignalScore * product.evidenceCoverage,
          12,
        );
      }
      if (product.signalScore !== null) {
        expect(product.signalScore).toBe(product.earnedWeightedPoints);
      }
    }
  });

  it("emits deterministic dominance and sales-only diagnostics without decision vocabulary", () => {
    const result = rankSellerSpriteMarketSignals({
      snapshot: buildSyntheticSnapshot("category_current", [
        syntheticRow(1, { sales: "300" }),
        syntheticRow(2, { sales: "200" }),
        syntheticRow(3, { sales: "100" }),
        syntheticRow(4, { sales: "50" }),
      ]),
      brief: buildBrief("category_current"),
    });
    const serialized = JSON.stringify(result);

    expect(result.diagnostics.salesOnlyOrder.slice(0, 3)).toEqual([
      "B0TST00001",
      "B0TST00002",
      "B0TST00003",
    ]);
    expect(result.diagnostics.top3SalesOverlap).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.top3SalesOverlap).toBeLessThanOrEqual(3);
    expect(result.diagnostics.productDominance).toHaveLength(4);
    expect(result.diagnostics.scoreSpread).toMatchObject({
      minimum: expect.any(Number),
      median: expect.any(Number),
      maximum: expect.any(Number),
      standardDeviation: expect.any(Number),
    });
    for (const banned of [
      "\"advance\"",
      "\"watch\"",
      "\"reject\"",
      "\"promoted\"",
      "\"promotionDecision\"",
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });
});
