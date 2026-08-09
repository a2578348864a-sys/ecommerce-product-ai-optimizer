import {
  sellerSpriteDeterministicStringCompare,
  sellerSpriteStableHash,
} from "./canonical";
import type { SellerSpriteMarketSnapshot } from "./marketSnapshot";
import type {
  SellerSpriteProductObservation,
  SellerSpriteProductMetricField,
  SellerSpriteResolvedProviderMetric,
} from "./projections";
import {
  normalizeAndValidateSellerSpriteShadowBrief,
  type SellerSpriteShadowSelectionBrief,
} from "./shadowBrief";

const SCHEMA_VERSION = "sellersprite-market-signal-ranking.v2" as const;
const SEARCH_MODEL_VERSION = "sellersprite-market-signal-ranking.search.v2" as const;
const CATEGORY_MODEL_VERSION = "sellersprite-market-signal-ranking.category.v2" as const;
const NORMALIZATION_VERSION = "sellersprite-market-signal-normalization.v2" as const;
const COVERAGE_FORMULA_VERSION = "sellersprite-market-signal-coverage.v2" as const;
const NORMALIZATION_POLICY = {
  version: NORMALIZATION_VERSION,
  percentile: "full_precision_midrank",
  singletonPercentile: 0.5,
  sampleShrinkage: "0.5+min(1,(n-1)/4)*(p-0.5)",
  missingAndConflictingValues: "excluded",
  conditionalScoreNormalization: "available_weight_only",
  comparisonScoreNormalization: "fixed_total_weight_100",
  tiePolicy: "competition_rank",
} as const;

export const SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS = {
  priceFit: 15,
  estimatedMonthlySales: 25,
  ratingQuality: 15,
  salesReviewEfficiency: 15,
  organicVisibility: 20,
  placementCoverage: 5,
  sponsoredExposure: 5,
} as const;

export const SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS = {
  priceFit: 20,
  estimatedMonthlySales: 20,
  ratingQuality: 20,
  salesReviewEfficiency: 20,
  categoryBsrSignal: 20,
} as const;

export type SellerSpriteMarketSignalComponent =
  | keyof typeof SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS
  | keyof typeof SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS;

export type SellerSpriteRankingEvidenceStatus =
  | "sufficient_for_comparison"
  | "limited_evidence"
  | "insufficient_evidence";

export type SellerSpriteResearchPriority =
  | "priority_1"
  | "priority_2"
  | "priority_3"
  | "unranked_insufficient_evidence";

export interface SellerSpriteMarketSignalComponentEvidence {
  component: SellerSpriteMarketSignalComponent;
  weight: number;
  available: boolean;
  normalizedSignal: number | null;
  weightedPoints: number | null;
  sourceType: "provider_metric";
  metricNature: "snapshot" | "estimate" | "derived";
  evidenceFields: ReadonlyArray<string>;
  explanation: string;
}

interface SellerSpriteMarketSignalRankedProductCommon {
  asin: string;
  parentAsin: string | null;
  order: number;
  scoreRank: number | null;
  scoreTie: boolean;
  availableWeight: number;
  earnedWeightedPoints: number;
  conditionalSignalScore: number | null;
  signalScore: number | null;
  evidenceCoverage: number;
  coveragePenalty: number | null;
  evidenceStatus: SellerSpriteRankingEvidenceStatus;
  researchPriority: SellerSpriteResearchPriority;
  componentEvidence: ReadonlyArray<SellerSpriteMarketSignalComponentEvidence>;
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<string>;
  positiveReasons: ReadonlyArray<string>;
  counterSignals: ReadonlyArray<string>;
  familyIdentity: string;
  familyRepresentative: boolean;
  promotionEligible: false;
}

export type SellerSpriteMarketSignalRankedProduct =
  | (SellerSpriteMarketSignalRankedProductCommon & {
    reportType: "search_results";
    componentScores: Readonly<Record<
      keyof typeof SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS,
      number | null
    >>;
  })
  | (SellerSpriteMarketSignalRankedProductCommon & {
    reportType: "category_current";
    componentScores: Readonly<Record<
      keyof typeof SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS,
      number | null
    >>;
  });

export interface SellerSpriteFamilyResearchItem {
  familyIdentity: string;
  representativeAsin: string;
  members: ReadonlyArray<string>;
  rankableMemberCount: number;
  representativeReason: string;
  familyWarnings: ReadonlyArray<string>;
}

export interface SellerSpriteProductDominanceDiagnostic {
  asin: string;
  componentDominance: number | null;
  dominantComponent: SellerSpriteMarketSignalComponent | null;
  dominanceWarning: boolean;
}

export interface SellerSpriteMarketSignalRankingDiagnostics {
  salesOnlyOrder: ReadonlyArray<string>;
  top3SalesOverlap: number;
  productDominance: ReadonlyArray<SellerSpriteProductDominanceDiagnostic>;
  scoreSpread: {
    minimum: number | null;
    median: number | null;
    maximum: number | null;
    standardDeviation: number | null;
  };
  marketConcentrationContext: {
    interpretation: "context_only_not_scored";
    brand: {
      status: SellerSpriteMarketSnapshot["brandConcentrationSummary"]["status"];
      topShare: number | null;
      top3Share: number | null;
    };
    seller: {
      status: SellerSpriteMarketSnapshot["sellerConcentrationSummary"]["status"];
      topShare: number | null;
      top3Share: number | null;
    };
  };
}

interface SellerSpriteMarketSignalRankingReportCommon {
  schemaVersion: typeof SCHEMA_VERSION;
  normalizationVersion: typeof NORMALIZATION_VERSION;
  normalizationPolicy: typeof NORMALIZATION_POLICY;
  coverageFormulaVersion: typeof COVERAGE_FORMULA_VERSION;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  rankingHash: string;
  productCount: number;
  rankableProductCount: number;
  unrankedProductCount: number;
  limitedEvidenceProductCount: number;
  insufficientEvidenceProductCount: number;
  products: ReadonlyArray<SellerSpriteMarketSignalRankedProduct>;
  familyResearchList: ReadonlyArray<SellerSpriteFamilyResearchItem>;
  familyResearchListCount: number;
  diagnostics: SellerSpriteMarketSignalRankingDiagnostics;
  authoritative: false;
  currentStage1Invoked: false;
  hardGateEvaluable: false;
  promotionEligible: false;
  manifestRegistered: false;
  productionEffect: false;
  productionDatabaseWritten: false;
}

export type SellerSpriteMarketSignalRankingReport =
  | (SellerSpriteMarketSignalRankingReportCommon & {
    modelVersion: typeof SEARCH_MODEL_VERSION;
    reportType: "search_results";
    weights: typeof SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS;
  })
  | (SellerSpriteMarketSignalRankingReportCommon & {
    modelVersion: typeof CATEGORY_MODEL_VERSION;
    reportType: "category_current";
    weights: typeof SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS;
  });

interface NumericInput {
  value: number | null;
  status: "resolved" | "missing" | "conflict";
}

interface WorkingProduct {
  product: SellerSpriteProductObservation;
  components: SellerSpriteMarketSignalComponentEvidence[];
  missingSignals: string[];
  conflictingSignals: string[];
  positiveReasons: string[];
  counterSignals: string[];
  availableWeight: number;
  earnedWeightedPoints: number;
  conditionalScore: number | null;
  coverage: number;
  coveragePenalty: number | null;
  status: SellerSpriteRankingEvidenceStatus;
  score: number | null;
  scoringConflict: boolean;
  sales: number | null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function numericMetric(
  metric: SellerSpriteResolvedProviderMetric,
  expectedNature?: "snapshot" | "estimate",
): NumericInput {
  if (
    metric.status !== "resolved"
    || metric.sourceType !== "provider_metric"
    || (expectedNature !== undefined && metric.nature !== expectedNature)
  ) {
    return { value: null, status: metric.status };
  }
  return typeof metric.normalized === "number" && Number.isFinite(metric.normalized)
    ? { value: metric.normalized, status: "resolved" }
    : { value: null, status: "missing" };
}

function stringMetric(metric: SellerSpriteResolvedProviderMetric): string | null {
  return metric.status === "resolved" && typeof metric.normalized === "string"
    ? metric.normalized
    : null;
}

interface PercentileEntry<T> {
  id: string;
  value: T;
}

function shrunkenPercentiles<T>(
  entries: ReadonlyArray<PercentileEntry<T>>,
  compareValues: (left: T, right: T) => number,
  direction: "higher_is_better" | "lower_is_better",
): Map<string, number> {
  const sorted = [...entries].sort((left, right) => (
    compareValues(left.value, right.value)
    || sellerSpriteDeterministicStringCompare(left.id, right.id)
  ));
  const count = sorted.length;
  const result = new Map<string, number>();
  if (count === 0) return result;
  if (count === 1) {
    result.set(sorted[0].id, 0.5);
    return result;
  }
  const shrink = Math.min(1, (count - 1) / 4);
  let start = 0;
  while (start < count) {
    let end = start;
    while (
      end + 1 < count
      && compareValues(sorted[start].value, sorted[end + 1].value) === 0
    ) {
      end += 1;
    }
    const midrankPercentile = ((start + end) / 2) / (count - 1);
    const directional = direction === "higher_is_better"
      ? midrankPercentile
      : 1 - midrankPercentile;
    const shrunken = clamp(0.5 + shrink * (directional - 0.5));
    for (let index = start; index <= end; index += 1) {
      result.set(sorted[index].id, shrunken);
    }
    start = end + 1;
  }
  return result;
}

function numericPercentiles(
  values: ReadonlyArray<{ id: string; value: number }>,
  direction: "higher_is_better" | "lower_is_better",
): Map<string, number> {
  return shrunkenPercentiles(values, (left, right) => left - right, direction);
}

function addUnavailableSignal(
  product: SellerSpriteProductObservation,
  fieldName: keyof SellerSpriteProductObservation["providerMetrics"],
  missingSignals: string[],
  conflictingSignals: string[],
  missingName: string = fieldName,
): void {
  const metric = product.providerMetrics[fieldName];
  if (metric.status === "conflict") conflictingSignals.push(fieldName);
  else missingSignals.push(missingName);
}

function component(
  componentName: SellerSpriteMarketSignalComponent,
  weight: number,
  signal: number | null,
  metricNature: "snapshot" | "estimate" | "derived",
  evidenceFields: ReadonlyArray<string>,
  explanation: string,
): SellerSpriteMarketSignalComponentEvidence {
  return {
    component: componentName,
    weight,
    available: signal !== null,
    normalizedSignal: signal,
    weightedPoints: signal === null ? null : signal * weight,
    sourceType: "provider_metric",
    metricNature,
    evidenceFields: [...evidenceFields],
    explanation,
  };
}

function commonComponents(
  product: SellerSpriteProductObservation,
  brief: SellerSpriteShadowSelectionBrief,
  weights: typeof SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS
    | typeof SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS,
  salesPercentiles: ReadonlyMap<string, number>,
  reviewPercentiles: ReadonlyMap<string, number>,
  missingSignals: string[],
  conflictingSignals: string[],
  positiveReasons: string[],
  counterSignals: string[],
): SellerSpriteMarketSignalComponentEvidence[] {
  const price = numericMetric(product.providerMetrics.price, "snapshot");
  const sales = numericMetric(product.providerMetrics.estimatedMonthlySales, "estimate");
  const rating = numericMetric(product.providerMetrics.rating, "snapshot");
  const reviews = numericMetric(product.providerMetrics.reviews, "snapshot");
  const variationCount = numericMetric(product.providerMetrics.variationCount, "snapshot");
  if (variationCount.value !== null && variationCount.value > 1) {
    counterSignals.push("multiple_variations_context_only_no_score");
  }

  let priceFit: number | null = null;
  if (price.value !== null) {
    const insideLowerBound = brief.priceMin === null || price.value >= brief.priceMin;
    const insideUpperBound = brief.priceMax === null || price.value <= brief.priceMax;
    priceFit = insideLowerBound && insideUpperBound ? 1 : 0;
    (priceFit === 1 ? positiveReasons : counterSignals).push(
      priceFit === 1 ? "price_within_brief_range" : "price_outside_brief_range",
    );
  } else {
    addUnavailableSignal(product, "price", missingSignals, conflictingSignals, "priceFit");
  }

  const salesSignal = sales.value === null ? null : salesPercentiles.get(product.asin) ?? null;
  if (salesSignal === null) {
    addUnavailableSignal(
      product,
      "estimatedMonthlySales",
      missingSignals,
      conflictingSignals,
    );
  } else if (salesSignal >= 0.5) {
    positiveReasons.push("estimated_monthly_sales_at_or_above_report_midpoint");
  } else {
    counterSignals.push("estimated_monthly_sales_below_report_midpoint");
  }

  const reviewSignal = reviews.value === null ? null : reviewPercentiles.get(product.asin) ?? null;
  let ratingQuality: number | null = null;
  if (rating.value !== null && reviewSignal !== null) {
    const ratingBase = clamp((rating.value - 1) / 4);
    const reviewSupport = 0.9 + 0.1 * reviewSignal;
    ratingQuality = ratingBase * reviewSupport;
    (ratingQuality >= 0.75 ? positiveReasons : counterSignals).push(
      ratingQuality >= 0.75 ? "rating_quality_supported" : "rating_quality_limited",
    );
  } else {
    if (rating.value === null) {
      addUnavailableSignal(product, "rating", missingSignals, conflictingSignals);
    }
    if (reviewSignal === null) {
      addUnavailableSignal(product, "reviews", missingSignals, conflictingSignals);
    }
  }

  let efficiency: number | null = null;
  if (salesSignal !== null && reviewSignal !== null) {
    efficiency = clamp(0.5 + 0.5 * (salesSignal - reviewSignal));
    (efficiency >= 0.5 ? positiveReasons : counterSignals).push(
      efficiency >= 0.5
        ? "sales_review_efficiency_at_or_above_neutral"
        : "sales_review_efficiency_below_neutral",
    );
  }

  return [
    component(
      "priceFit",
      weights.priceFit,
      priceFit,
      "snapshot",
      ["price", "brief.priceMin", "brief.priceMax"],
      priceFit === null
        ? "Price evidence is unavailable or conflicting."
        : priceFit === 1
          ? "Provider price is inside the inclusive Brief range."
          : "Provider price is outside the Brief range; evidence eligibility is unchanged.",
    ),
    component(
      "estimatedMonthlySales",
      weights.estimatedMonthlySales,
      salesSignal,
      "estimate",
      ["estimatedMonthlySales"],
      salesSignal === null
        ? "SellerSprite estimated monthly sales are unavailable or conflicting."
        : "Shrunken within-report percentile of SellerSprite estimated monthly sales; not orders.",
    ),
    component(
      "ratingQuality",
      weights.ratingQuality,
      ratingQuality,
      "derived",
      ["rating", "reviews"],
      ratingQuality === null
        ? "Rating quality requires both rating and review-count evidence."
        : "Rating quality with review support capped at ten percent of this component.",
    ),
    component(
      "salesReviewEfficiency",
      weights.salesReviewEfficiency,
      efficiency,
      "derived",
      ["estimatedMonthlySales", "reviews"],
      efficiency === null
        ? "Sales-review efficiency requires both estimated sales and review-count evidence."
        : "Relative estimated-sales versus review-count percentile; not an order or profit metric.",
    ),
  ];
}

function evidenceStatus(
  coverage: number,
  coreConditionsMet: boolean,
  scoringConflict: boolean,
): SellerSpriteRankingEvidenceStatus {
  if (coverage < 0.5) return "insufficient_evidence";
  return coverage >= 0.75 && coreConditionsMet && !scoringConflict
    ? "sufficient_for_comparison"
    : "limited_evidence";
}

function scoringConflictFields(
  product: SellerSpriteProductObservation,
  components: ReadonlyArray<SellerSpriteMarketSignalComponentEvidence>,
): SellerSpriteProductMetricField[] {
  const fields = components.flatMap((item) => item.evidenceFields);
  return [...new Set(fields.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(product.providerMetrics, field)) return [];
    const metricField = field as SellerSpriteProductMetricField;
    return product.providerMetrics[metricField].status === "conflict" ? [metricField] : [];
  }))].sort(sellerSpriteDeterministicStringCompare);
}

function finalizeWorkingProduct(
  working: Omit<
    WorkingProduct,
    | "availableWeight"
    | "earnedWeightedPoints"
    | "conditionalScore"
    | "coverage"
    | "coveragePenalty"
    | "status"
    | "score"
    | "scoringConflict"
  >,
  coreConditionsMet: boolean,
): WorkingProduct {
  const availableWeight = working.components.reduce(
    (sum, item) => sum + (item.available ? item.weight : 0),
    0,
  );
  const rawEarnedWeightedPoints = working.components.reduce(
    (sum, item) => sum + (item.weightedPoints ?? 0),
    0,
  );
  // Preserve the v1 Coverage=1 floating representation while keeping a fixed 100-point basis.
  const earnedWeightedPoints = rawEarnedWeightedPoints / 100 * 100;
  const coverage = availableWeight / 100;
  const scoringConflicts = scoringConflictFields(working.product, working.components);
  const scoringConflict = scoringConflicts.length > 0;
  const status = evidenceStatus(coverage, coreConditionsMet, scoringConflict);
  const conditionalScore = availableWeight < 50
    ? null
    : availableWeight === 100
      ? earnedWeightedPoints
      : earnedWeightedPoints / availableWeight * 100;
  return {
    ...working,
    conflictingSignals: [...new Set([
      ...working.conflictingSignals,
      ...scoringConflicts,
    ])].sort(sellerSpriteDeterministicStringCompare),
    availableWeight,
    earnedWeightedPoints,
    conditionalScore,
    coverage,
    coveragePenalty: conditionalScore === null
      ? null
      : availableWeight === 100
        ? 0
        : conditionalScore - earnedWeightedPoints,
    status,
    score: status === "sufficient_for_comparison" ? earnedWeightedPoints : null,
    scoringConflict,
  };
}

function validPosition(
  product: SellerSpriteProductObservation,
  placementType: "organic" | "sponsored",
): { page: number; position: number } | null {
  const positions = product.appearances
    .filter((appearance) => (
      appearance.placementType === placementType
      && appearance.page !== null
      && appearance.position !== null
      && Number.isSafeInteger(appearance.page)
      && Number.isSafeInteger(appearance.position)
      && appearance.page > 0
      && appearance.position > 0
    ))
    .map((appearance) => ({ page: appearance.page!, position: appearance.position! }))
    .sort((left, right) => left.page - right.page || left.position - right.position);
  return positions[0] ?? null;
}

function buildSearchWorkingProducts(
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
): WorkingProduct[] {
  const numeric = snapshot.products.map((product) => ({
    product,
    sales: numericMetric(product.providerMetrics.estimatedMonthlySales, "estimate"),
    reviews: numericMetric(product.providerMetrics.reviews, "snapshot"),
    organic: validPosition(product, "organic"),
    sponsored: validPosition(product, "sponsored"),
  }));
  const salesPercentiles = numericPercentiles(
    numeric.flatMap(({ product, sales }) => (
      sales.value === null ? [] : [{ id: product.asin, value: sales.value }]
    )),
    "higher_is_better",
  );
  const reviewPercentiles = numericPercentiles(
    numeric.flatMap(({ product, reviews }) => (
      reviews.value === null ? [] : [{ id: product.asin, value: reviews.value }]
    )),
    "higher_is_better",
  );
  const comparePositions = (
    left: { page: number; position: number },
    right: { page: number; position: number },
  ) => left.page - right.page || left.position - right.position;
  const organicPercentiles = shrunkenPercentiles(
    numeric.flatMap(({ product, organic }) => (
      organic === null ? [] : [{ id: product.asin, value: organic }]
    )),
    comparePositions,
    "lower_is_better",
  );
  const sponsoredPercentiles = shrunkenPercentiles(
    numeric.flatMap(({ product, sponsored }) => (
      sponsored === null ? [] : [{ id: product.asin, value: sponsored }]
    )),
    comparePositions,
    "lower_is_better",
  );

  return numeric.map(({ product, sales, organic, sponsored }) => {
    const missingSignals: string[] = [];
    const conflictingSignals: string[] = [];
    const positiveReasons: string[] = [];
    const counterSignals: string[] = [];
    const components = commonComponents(
      product,
      brief,
      SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS,
      salesPercentiles,
      reviewPercentiles,
      missingSignals,
      conflictingSignals,
      positiveReasons,
      counterSignals,
    );
    const hasOrganic = organic !== null;
    const hasSponsored = sponsored !== null;
    const hasPosition = hasOrganic || hasSponsored;
    const organicSignal = hasOrganic
      ? organicPercentiles.get(product.asin) ?? null
      : hasSponsored ? 0 : null;
    const placementSignal = hasOrganic && hasSponsored
      ? 1
      : hasOrganic ? 0.75 : hasSponsored ? 0.25 : null;
    const sponsoredSignal = hasSponsored
      ? sponsoredPercentiles.get(product.asin) ?? null
      : hasOrganic ? 0 : null;
    if (!hasPosition) missingSignals.push("searchPlacement");
    if (hasOrganic) positiveReasons.push("organic_visibility_observed");
    else if (hasSponsored) counterSignals.push("sponsored_only_visibility");
    if (hasOrganic && hasSponsored) positiveReasons.push("organic_and_sponsored_coverage");
    if (hasSponsored && !hasOrganic) counterSignals.push("organic_visibility_zero_with_sponsored_evidence");
    components.push(
      component(
        "organicVisibility",
        SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS.organicVisibility,
        organicSignal,
        "snapshot",
        ["searchRank.placementType", "searchRank.page", "searchRank.position"],
        organicSignal === null
          ? "No valid organic or sponsored placement evidence is available."
          : hasOrganic
            ? "Best organic placement ranked within valid organic placements."
            : "Valid sponsored placement exists but organic placement does not, so this signal is zero.",
      ),
      component(
        "placementCoverage",
        SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS.placementCoverage,
        placementSignal,
        "derived",
        ["searchRank.placementType"],
        placementSignal === null
          ? "No valid placement structure is available."
          : "Fixed organic/sponsored occurrence coverage mapping.",
      ),
      component(
        "sponsoredExposure",
        SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS.sponsoredExposure,
        sponsoredSignal,
        "snapshot",
        ["searchRank.placementType", "searchRank.page", "searchRank.position"],
        sponsoredSignal === null
          ? "No valid organic or sponsored placement evidence is available."
          : hasSponsored
            ? "Best sponsored placement ranked within valid sponsored placements."
            : "Valid organic placement exists but sponsored placement does not, so this signal is zero.",
      ),
    );
    const coreConflict = product.providerMetrics.estimatedMonthlySales.status === "conflict";
    if (sales.value === null) {
      counterSignals.push(coreConflict
        ? "core_estimated_monthly_sales_conflicting"
        : "core_estimated_monthly_sales_missing");
    }
    if (!hasPosition) counterSignals.push("core_search_placement_missing");
    const coreConditionsMet = sales.value !== null && hasPosition && !coreConflict;
    return finalizeWorkingProduct({
      product,
      components,
      missingSignals: [...new Set(missingSignals)].sort(sellerSpriteDeterministicStringCompare),
      conflictingSignals: [...new Set(conflictingSignals)]
        .sort(sellerSpriteDeterministicStringCompare),
      positiveReasons: [...new Set(positiveReasons)].sort(sellerSpriteDeterministicStringCompare),
      counterSignals: [...new Set(counterSignals)].sort(sellerSpriteDeterministicStringCompare),
      sales: sales.value,
    }, coreConditionsMet);
  });
}

function buildCategoryWorkingProducts(
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
): WorkingProduct[] {
  const numeric = snapshot.products.map((product) => ({
    product,
    sales: numericMetric(product.providerMetrics.estimatedMonthlySales, "estimate"),
    reviews: numericMetric(product.providerMetrics.reviews, "snapshot"),
    rootBsr: numericMetric(product.providerMetrics.rootCategoryBsr, "snapshot"),
    subBsr: numericMetric(product.providerMetrics.subCategoryBsr, "snapshot"),
    subCategory: stringMetric(product.providerMetrics.subCategory),
  }));
  const salesPercentiles = numericPercentiles(
    numeric.flatMap(({ product, sales }) => (
      sales.value === null ? [] : [{ id: product.asin, value: sales.value }]
    )),
    "higher_is_better",
  );
  const reviewPercentiles = numericPercentiles(
    numeric.flatMap(({ product, reviews }) => (
      reviews.value === null ? [] : [{ id: product.asin, value: reviews.value }]
    )),
    "higher_is_better",
  );
  const rootBsrPercentiles = numericPercentiles(
    numeric.flatMap(({ product, rootBsr }) => (
      rootBsr.value === null ? [] : [{ id: product.asin, value: rootBsr.value }]
    )),
    "lower_is_better",
  );
  const subCategoryGroups = new Map<string, Array<{ id: string; value: number }>>();
  for (const { product, subBsr, subCategory } of numeric) {
    if (subCategory === null || subBsr.value === null) continue;
    const group = subCategoryGroups.get(subCategory) ?? [];
    group.push({ id: product.asin, value: subBsr.value });
    subCategoryGroups.set(subCategory, group);
  }
  const subBsrPercentiles = new Map<string, number>();
  for (const group of subCategoryGroups.values()) {
    if (group.length < 3) continue;
    for (const [asin, percentile] of numericPercentiles(group, "lower_is_better")) {
      subBsrPercentiles.set(asin, percentile);
    }
  }

  return numeric.map(({ product, sales, rootBsr, subBsr, subCategory }) => {
    const missingSignals: string[] = [];
    const conflictingSignals: string[] = [];
    const positiveReasons: string[] = [];
    const counterSignals: string[] = [];
    const components = commonComponents(
      product,
      brief,
      SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS,
      salesPercentiles,
      reviewPercentiles,
      missingSignals,
      conflictingSignals,
      positiveReasons,
      counterSignals,
    );
    const rootSignal = rootBsr.value === null
      ? null
      : rootBsrPercentiles.get(product.asin) ?? null;
    const subSignal = subCategory !== null && subBsr.value !== null
      ? subBsrPercentiles.get(product.asin) ?? null
      : null;
    const categoryBsrSignal = rootSignal === null
      ? null
      : subSignal === null
        ? rootSignal
        : 0.8 * rootSignal + 0.2 * subSignal;
    if (rootSignal === null) {
      addUnavailableSignal(
        product,
        "rootCategoryBsr",
        missingSignals,
        conflictingSignals,
      );
    } else {
      positiveReasons.push("root_category_bsr_comparable");
      if (subSignal === null) counterSignals.push("subcategory_bsr_not_comparable");
      else positiveReasons.push("subcategory_bsr_comparable_within_exact_group");
    }
    components.push(component(
      "categoryBsrSignal",
      SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS.categoryBsrSignal,
      categoryBsrSignal,
      "snapshot",
      ["rootCategoryBsr", "subCategory", "subCategoryBsr"],
      categoryBsrSignal === null
        ? "A valid non-conflicting root-category BSR is required."
        : subSignal === null
          ? "Root-category BSR percentile only; subcategory evidence is absent or its exact group has fewer than three valid products."
          : "Eighty percent root-category BSR and twenty percent exact-subcategory BSR percentile.",
    ));
    const coreConflict = product.providerMetrics.estimatedMonthlySales.status === "conflict"
      || product.providerMetrics.rootCategoryBsr.status === "conflict";
    if (sales.value === null) {
      counterSignals.push(product.providerMetrics.estimatedMonthlySales.status === "conflict"
        ? "core_estimated_monthly_sales_conflicting"
        : "core_estimated_monthly_sales_missing");
    }
    if (rootBsr.value === null) {
      counterSignals.push(product.providerMetrics.rootCategoryBsr.status === "conflict"
        ? "core_root_category_bsr_conflicting"
        : "core_root_category_bsr_missing");
    }
    const coreConditionsMet = sales.value !== null && rootBsr.value !== null && !coreConflict;
    return finalizeWorkingProduct({
      product,
      components,
      missingSignals: [...new Set(missingSignals)].sort(sellerSpriteDeterministicStringCompare),
      conflictingSignals: [...new Set(conflictingSignals)]
        .sort(sellerSpriteDeterministicStringCompare),
      positiveReasons: [...new Set(positiveReasons)].sort(sellerSpriteDeterministicStringCompare),
      counterSignals: [...new Set(counterSignals)].sort(sellerSpriteDeterministicStringCompare),
      sales: sales.value,
    }, coreConditionsMet);
  });
}

function compareWorkingProducts(left: WorkingProduct, right: WorkingProduct): number {
  const leftRankable = left.status === "sufficient_for_comparison";
  const rightRankable = right.status === "sufficient_for_comparison";
  if (leftRankable !== rightRankable) return leftRankable ? -1 : 1;
  if (left.score !== right.score) {
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score;
  }
  if (left.coverage !== right.coverage) return right.coverage - left.coverage;
  return sellerSpriteDeterministicStringCompare(left.product.asin, right.product.asin);
}

function priorityForRank(rank: number | null): SellerSpriteResearchPriority {
  if (rank === null) return "unranked_insufficient_evidence";
  if (rank <= 3) return "priority_1";
  if (rank <= 6) return "priority_2";
  return "priority_3";
}

function buildRankedProducts(
  workingProducts: ReadonlyArray<WorkingProduct>,
): SellerSpriteMarketSignalRankedProduct[] {
  const sorted = [...workingProducts].sort(compareWorkingProducts);
  const rankableScores = sorted
    .filter((item) => item.status === "sufficient_for_comparison" && item.score !== null)
    .map((item) => item.score!);
  return sorted.map((working, index) => {
    const scoreRank = working.score === null
      ? null
      : rankableScores.findIndex((score) => score === working.score) + 1;
    const scoreTie = working.score !== null
      && rankableScores.filter((score) => score === working.score).length > 1;
    const common = {
      asin: working.product.asin,
      parentAsin: working.product.parentAsin,
      order: index + 1,
      scoreRank,
      scoreTie,
      availableWeight: working.availableWeight,
      earnedWeightedPoints: working.earnedWeightedPoints,
      conditionalSignalScore: working.conditionalScore,
      signalScore: working.score,
      evidenceCoverage: working.coverage,
      coveragePenalty: working.coveragePenalty,
      evidenceStatus: working.status,
      researchPriority: priorityForRank(scoreRank),
      componentEvidence: working.components,
      missingSignals: working.missingSignals,
      conflictingSignals: working.conflictingSignals,
      positiveReasons: working.positiveReasons,
      counterSignals: working.counterSignals,
      familyIdentity: working.product.parentAsin ?? working.product.asin,
      familyRepresentative: false,
      promotionEligible: false as const,
    };
    const componentScores = Object.fromEntries(
      working.components.map((item) => [item.component, item.normalizedSignal]),
    );
    return working.product.reportType === "search_results"
      ? {
        ...common,
        reportType: "search_results" as const,
        componentScores: componentScores as Record<
          keyof typeof SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS,
          number | null
        >,
      }
      : {
        ...common,
        reportType: "category_current" as const,
        componentScores: componentScores as Record<
          keyof typeof SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS,
          number | null
        >,
      };
  });
}

function representativeCompare(
  left: SellerSpriteMarketSignalRankedProduct,
  right: SellerSpriteMarketSignalRankedProduct,
  scoringConflictByAsin: ReadonlyMap<string, boolean>,
): number {
  const leftRankable = left.evidenceStatus === "sufficient_for_comparison";
  const rightRankable = right.evidenceStatus === "sufficient_for_comparison";
  if (leftRankable !== rightRankable) return leftRankable ? -1 : 1;
  const leftScoringConflict = scoringConflictByAsin.get(left.asin) ?? false;
  const rightScoringConflict = scoringConflictByAsin.get(right.asin) ?? false;
  if (leftScoringConflict !== rightScoringConflict) return leftScoringConflict ? 1 : -1;
  if (left.signalScore !== right.signalScore) {
    if (left.signalScore === null) return 1;
    if (right.signalScore === null) return -1;
    return right.signalScore - left.signalScore;
  }
  if (left.evidenceCoverage !== right.evidenceCoverage) {
    return right.evidenceCoverage - left.evidenceCoverage;
  }
  return sellerSpriteDeterministicStringCompare(left.asin, right.asin);
}

function buildFamilyResearchList(
  products: SellerSpriteMarketSignalRankedProduct[],
  workingProducts: ReadonlyArray<WorkingProduct>,
): SellerSpriteFamilyResearchItem[] {
  const scoringConflictByAsin = new Map(
    workingProducts.map((working) => [working.product.asin, working.scoringConflict]),
  );
  const families = new Map<string, SellerSpriteMarketSignalRankedProduct[]>();
  for (const product of products) {
    const members = families.get(product.familyIdentity) ?? [];
    members.push(product);
    families.set(product.familyIdentity, members);
  }
  const result = [...families.entries()]
    .map(([familyIdentity, members]) => {
      const orderedMembers = [...members].sort((left, right) => (
        representativeCompare(left, right, scoringConflictByAsin)
      ));
      const representative = orderedMembers[0];
      representative.familyRepresentative = true;
      const familyWarnings = [...new Set(members.flatMap((member) => [
        ...member.conflictingSignals.map((field) => `conflicting_provider_metric:${field}`),
        ...(member.evidenceStatus === "sufficient_for_comparison"
          ? []
          : [`member_not_rankable:${member.asin}`]),
      ]))].sort(sellerSpriteDeterministicStringCompare);
      return {
        familyIdentity,
        representativeAsin: representative.asin,
        members: members
          .map((member) => member.asin)
          .sort(sellerSpriteDeterministicStringCompare),
        rankableMemberCount: members.filter(
          (member) => member.evidenceStatus === "sufficient_for_comparison",
        ).length,
        representativeReason: representative.evidenceStatus === "sufficient_for_comparison"
          ? "highest_rankable_signal_score_then_coverage"
          : "best_available_non_authoritative_evidence",
        familyWarnings,
      };
    })
    .sort((left, right) => {
      const leftProduct = products.find((product) => product.asin === left.representativeAsin)!;
      const rightProduct = products.find((product) => product.asin === right.representativeAsin)!;
      return leftProduct.order - rightProduct.order
        || sellerSpriteDeterministicStringCompare(left.familyIdentity, right.familyIdentity);
    });
  return result;
}

function numericSpread(values: ReadonlyArray<number>): {
  minimum: number | null;
  median: number | null;
  maximum: number | null;
  standardDeviation: number | null;
} {
  if (values.length === 0) {
    return { minimum: null, median: null, maximum: null, standardDeviation: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0)
    / sorted.length;
  return {
    minimum: sorted[0],
    median,
    maximum: sorted[sorted.length - 1],
    standardDeviation: Math.sqrt(variance),
  };
}

function buildDiagnostics(
  products: ReadonlyArray<SellerSpriteMarketSignalRankedProduct>,
  workingProducts: ReadonlyArray<WorkingProduct>,
  snapshot: SellerSpriteMarketSnapshot,
): SellerSpriteMarketSignalRankingDiagnostics {
  const salesOnlyOrder = workingProducts
    .filter((working) => working.sales !== null)
    .sort((left, right) => (
      right.sales! - left.sales!
      || sellerSpriteDeterministicStringCompare(left.product.asin, right.product.asin)
    ))
    .map((working) => working.product.asin);
  const rankedTop3 = products
    .filter((product) => product.scoreRank !== null)
    .slice(0, 3)
    .map((product) => product.asin);
  const salesTop3 = new Set(salesOnlyOrder.slice(0, 3));
  const productDominance = products.map((product) => {
    const available = product.componentEvidence.filter(
      (item) => item.weightedPoints !== null,
    );
    const total = available.reduce((sum, item) => sum + item.weightedPoints!, 0);
    const dominant = [...available].sort((left, right) => (
      right.weightedPoints! - left.weightedPoints!
      || sellerSpriteDeterministicStringCompare(left.component, right.component)
    ))[0] ?? null;
    const ratio = dominant === null || total <= 0 ? null : dominant.weightedPoints! / total;
    return {
      asin: product.asin,
      componentDominance: ratio,
      dominantComponent: dominant?.component ?? null,
      dominanceWarning: ratio !== null && ratio > 0.5,
    };
  });
  return {
    salesOnlyOrder,
    top3SalesOverlap: rankedTop3.filter((asin) => salesTop3.has(asin)).length,
    productDominance,
    scoreSpread: numericSpread(products.flatMap((product) => (
      product.signalScore === null ? [] : [product.signalScore]
    ))),
    marketConcentrationContext: {
      interpretation: "context_only_not_scored",
      brand: {
        status: snapshot.brandConcentrationSummary.status,
        topShare: snapshot.brandConcentrationSummary.topShare,
        top3Share: snapshot.brandConcentrationSummary.top3Share,
      },
      seller: {
        status: snapshot.sellerConcentrationSummary.status,
        topShare: snapshot.sellerConcentrationSummary.topShare,
        top3Share: snapshot.sellerConcentrationSummary.top3Share,
      },
    },
  };
}

function rankingBusinessPayload(
  report: Omit<SellerSpriteMarketSignalRankingReportCommon, "rankingHash"> & {
    modelVersion: typeof SEARCH_MODEL_VERSION | typeof CATEGORY_MODEL_VERSION;
    reportType: "search_results" | "category_current";
    weights: Readonly<Record<string, number>>;
  },
): unknown {
  return {
    schemaVersion: report.schemaVersion,
    modelVersion: report.modelVersion,
    normalizationVersion: report.normalizationVersion,
    normalizationPolicy: report.normalizationPolicy,
    coverageFormulaVersion: report.coverageFormulaVersion,
    reportType: report.reportType,
    normalizedBusinessHash: report.normalizedBusinessHash,
    briefHash: report.briefHash,
    weights: report.weights,
    products: report.products.map((product) => ({
      asin: product.asin,
      parentAsin: product.parentAsin,
      order: product.order,
      scoreRank: product.scoreRank,
      scoreTie: product.scoreTie,
      availableWeight: product.availableWeight,
      earnedWeightedPoints: product.earnedWeightedPoints,
      conditionalSignalScore: product.conditionalSignalScore,
      signalScore: product.signalScore,
      evidenceCoverage: product.evidenceCoverage,
      coveragePenalty: product.coveragePenalty,
      evidenceStatus: product.evidenceStatus,
      researchPriority: product.researchPriority,
      componentEvidence: product.componentEvidence.map((item) => ({
        component: item.component,
        weight: item.weight,
        available: item.available,
        normalizedSignal: item.normalizedSignal,
        weightedPoints: item.weightedPoints,
        sourceType: item.sourceType,
        metricNature: item.metricNature,
        evidenceFields: item.evidenceFields,
      })),
      missingSignals: product.missingSignals,
      conflictingSignals: product.conflictingSignals,
      positiveReasons: product.positiveReasons,
      counterSignals: product.counterSignals,
      familyIdentity: product.familyIdentity,
      familyRepresentative: product.familyRepresentative,
    })),
    familyResearchList: report.familyResearchList,
    diagnostics: report.diagnostics,
  };
}

export function rankSellerSpriteMarketSignals(input: {
  snapshot: SellerSpriteMarketSnapshot;
  brief: SellerSpriteShadowSelectionBrief;
}): SellerSpriteMarketSignalRankingReport {
  if (input.snapshot.schemaVersion !== "sellersprite-market-snapshot.v3") {
    throw new Error("SELLERSPRITE_RANKING_SNAPSHOT_VERSION_UNSUPPORTED");
  }
  if (
    input.snapshot.reportType !== "search_results"
    && input.snapshot.reportType !== "category_current"
  ) {
    throw new Error("SELLERSPRITE_RANKING_REPORT_TYPE_UNSUPPORTED");
  }
  const brief = normalizeAndValidateSellerSpriteShadowBrief(input.brief);
  if (brief.reportType !== input.snapshot.reportType) {
    throw new Error("SELLERSPRITE_RANKING_BRIEF_REPORT_TYPE_MISMATCH");
  }
  const workingProducts = input.snapshot.reportType === "search_results"
    ? buildSearchWorkingProducts(input.snapshot, brief)
    : buildCategoryWorkingProducts(input.snapshot, brief);
  const products = buildRankedProducts(workingProducts);
  const familyResearchList = buildFamilyResearchList(products, workingProducts);
  const diagnostics = buildDiagnostics(products, workingProducts, input.snapshot);
  const rankableProductCount = products.filter(
    (product) => product.evidenceStatus === "sufficient_for_comparison",
  ).length;
  const common = {
    schemaVersion: SCHEMA_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    normalizationPolicy: NORMALIZATION_POLICY,
    coverageFormulaVersion: COVERAGE_FORMULA_VERSION,
    sourceFileSha256: input.snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: input.snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: input.snapshot.normalizedBusinessHash,
    briefHash: brief.briefHash,
    productCount: products.length,
    rankableProductCount,
    unrankedProductCount: products.length - rankableProductCount,
    limitedEvidenceProductCount: products.filter(
      (product) => product.evidenceStatus === "limited_evidence",
    ).length,
    insufficientEvidenceProductCount: products.filter(
      (product) => product.evidenceStatus === "insufficient_evidence",
    ).length,
    products,
    familyResearchList,
    familyResearchListCount: familyResearchList.length,
    diagnostics,
    authoritative: false as const,
    currentStage1Invoked: false as const,
    hardGateEvaluable: false as const,
    promotionEligible: false as const,
    manifestRegistered: false as const,
    productionEffect: false as const,
    productionDatabaseWritten: false as const,
  };
  if (input.snapshot.reportType === "search_results") {
    const withoutHash = {
      ...common,
      modelVersion: SEARCH_MODEL_VERSION,
      reportType: "search_results" as const,
      weights: SELLERSPRITE_SEARCH_MARKET_SIGNAL_WEIGHTS,
    };
    return {
      ...withoutHash,
      rankingHash: sellerSpriteStableHash(rankingBusinessPayload(withoutHash)),
    };
  }
  const withoutHash = {
    ...common,
    modelVersion: CATEGORY_MODEL_VERSION,
    reportType: "category_current" as const,
    weights: SELLERSPRITE_CATEGORY_MARKET_SIGNAL_WEIGHTS,
  };
  return {
    ...withoutHash,
    rankingHash: sellerSpriteStableHash(rankingBusinessPayload(withoutHash)),
  };
}
