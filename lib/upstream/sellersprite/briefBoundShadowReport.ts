import { sellerSpriteStableHash } from "./canonical";
import type { SellerSpriteMarketSnapshot } from "./marketSnapshot";
import type {
  SellerSpriteProductMetricField,
  SellerSpriteProductObservation,
} from "./projections";
import {
  normalizeAndValidateSellerSpriteShadowBrief,
  type SellerSpriteShadowSelectionBrief,
} from "./shadowBrief";

const SCHEMA_VERSION = "sellersprite-brief-bound-shadow-report.v2" as const;

export type SellerSpriteProvisionalDisposition =
  | "provisional_score_only"
  | "insufficient_hard_gate_evidence"
  | "conflicting_provider_metrics"
  | "insufficient_required_signals";

export interface SellerSpriteProvisionalScoreSource {
  component: "briefPriceFit" | "ratingSignal" | "reviewSignal" | "placementDiversity";
  fieldName: "price" | "rating" | "reviews" | "searchRank";
  source: "SellerSprite";
  sourceType: "provider_metric";
  usagePolicy: "screening_signal_only";
  normalizedValue: number | null | ReadonlyArray<"sponsored" | "organic" | "unknown">;
  provisionalPoints: number | null;
  appearanceIdentities: ReadonlyArray<string>;
  occurrenceIdentities: ReadonlyArray<string>;
}

export interface SellerSpriteBriefBoundShadowProduct {
  reportType: SellerSpriteMarketSnapshot["reportType"];
  asin: string;
  parentAsin: string | null;
  occurrenceIdentities: ReadonlyArray<string>;
  appearanceIdentities: ReadonlyArray<string>;
  occurrenceSummary: {
    occurrenceCount: number;
  };
  appearanceSummary: (SellerSpriteProductObservation["placementSummary"] & {
    appearanceCount: number;
  }) | null;
  categoryEvidenceSummary: SellerSpriteProductObservation["categoryEvidenceSummary"];
  providerEvidenceSummary: {
    evidenceCount: number;
    sourceTypes: readonly ["provider_metric"];
    metricNatureCounts: Readonly<Record<string, number>>;
    usagePolicyCounts: Readonly<Record<string, number>>;
  };
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<SellerSpriteProductMetricField>;
  briefPriceBandResult: {
    status: "within" | "outside" | "missing" | "conflict";
    price: number | null;
    currency: "USD";
    priceMin: number;
    priceMax: number;
  };
  provisionalNumericScore: number | null;
  provisionalDisposition: SellerSpriteProvisionalDisposition;
  scoreSources: ReadonlyArray<SellerSpriteProvisionalScoreSource>;
  scoreBreakdown: ReadonlyArray<SellerSpriteProvisionalScoreSource>;
  missingRequiredSignals: ReadonlyArray<string>;
  conflictingProviderMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  hardGateEvidenceStatus: "unknown";
  hardGateEvaluable: false;
  promotionEligible: false;
  authoritative: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
  distortionReasons: ReadonlyArray<string>;
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteBriefBoundShadowReport {
  schemaVersion: typeof SCHEMA_VERSION;
  reportHash: string;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  brief: SellerSpriteShadowSelectionBrief;
  reportType: SellerSpriteMarketSnapshot["reportType"];
  marketplace: "amazon.com";
  query: string | null;
  occurrenceCount: number;
  appearanceCount: number | null;
  productCount: number;
  familyCount: number;
  fieldCoverage: SellerSpriteMarketSnapshot["fieldCoverage"];
  placementSummary: SellerSpriteMarketSnapshot["placementSummary"];
  categoryBsrSummary: SellerSpriteMarketSnapshot["categoryBsrSummary"];
  conflictCounts: Readonly<Record<string, number>>;
  missingSignals: ReadonlyArray<string>;
  source: "SellerSprite";
  sourceType: "provider_metric";
  calculationRule: "sellersprite-provisional-compatibility-v1";
  currentStage1Invoked: false;
  currentStage1RuleModified: false;
  hardGateEvidenceStatus: "unknown";
  hardGateEvaluable: false;
  promotionEligible: false;
  authoritative: false;
  promotionAllowed: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
  hardGateMissingEvidence: ReadonlyArray<string>;
  products: ReadonlyArray<SellerSpriteBriefBoundShadowProduct>;
  provisionalDistribution: Readonly<Record<SellerSpriteProvisionalDisposition, number>>;
  contractCompatibilityRisk: true;
  warnings: ReadonlyArray<string>;
}

const HARD_GATE_MISSING_EVIDENCE = [
  "confirmed_ip_risk",
  "regulated_product",
  "price_out_of_budget_authoritative",
  "logistics_blocked",
  "verified_negative_contribution",
] as const;

function numericMetric(
  product: SellerSpriteProductObservation,
  field: Extract<SellerSpriteProductMetricField, "price" | "rating" | "reviews">,
): number | null {
  const metric = product.providerMetrics[field];
  return metric.status === "resolved" && typeof metric.normalized === "number"
    ? metric.normalized
    : null;
}

function signalMissing(product: SellerSpriteProductObservation, signal: string): boolean {
  if (signal === "searchRank" || signal === "placement") {
    if (product.reportType === "category_current") return false;
    return product.appearances.every((appearance) => appearance.placementType === "unknown");
  }
  if (signal === "hardGateEvidence") return true;
  if (signal in product.providerMetrics) {
    return product.providerMetrics[signal as SellerSpriteProductMetricField].status !== "resolved";
  }
  return true;
}

function scoreSources(
  product: SellerSpriteProductObservation,
  brief: SellerSpriteShadowSelectionBrief,
): SellerSpriteProvisionalScoreSource[] {
  const occurrenceIdentities = product.occurrences
    .map((occurrence) => occurrence.occurrenceIdentity)
    .sort();
  const appearanceIdentities = product.appearances
    .map((appearance) => appearance.appearanceIdentity)
    .sort();
  const price = numericMetric(product, "price");
  const rating = numericMetric(product, "rating");
  const reviews = numericMetric(product, "reviews");
  const placements = product.appearances.map((appearance) => appearance.placementType);
  return [
    {
      component: "briefPriceFit",
      fieldName: "price",
      source: "SellerSprite",
      sourceType: "provider_metric",
      usagePolicy: "screening_signal_only",
      normalizedValue: price,
      provisionalPoints: price === null
        ? null
        : price >= brief.priceMin && price <= brief.priceMax
          ? 25
          : 0,
      appearanceIdentities,
      occurrenceIdentities,
    },
    {
      component: "ratingSignal",
      fieldName: "rating",
      source: "SellerSprite",
      sourceType: "provider_metric",
      usagePolicy: "screening_signal_only",
      normalizedValue: rating,
      provisionalPoints: rating === null ? null : rating >= 4.5 ? 25 : rating >= 4 ? 18 : 8,
      appearanceIdentities,
      occurrenceIdentities,
    },
    {
      component: "reviewSignal",
      fieldName: "reviews",
      source: "SellerSprite",
      sourceType: "provider_metric",
      usagePolicy: "screening_signal_only",
      normalizedValue: reviews,
      provisionalPoints: reviews === null ? null : reviews >= 500 ? 25 : reviews >= 100 ? 18 : 10,
      appearanceIdentities,
      occurrenceIdentities,
    },
    ...(product.reportType === "search_results" ? [{
      component: "placementDiversity",
      fieldName: "searchRank",
      source: "SellerSprite",
      sourceType: "provider_metric",
      usagePolicy: "screening_signal_only",
      normalizedValue: placements,
      provisionalPoints: placements.includes("organic")
        ? 25
        : placements.includes("sponsored")
          ? 10
          : null,
      appearanceIdentities,
      occurrenceIdentities,
    } as SellerSpriteProvisionalScoreSource] : []),
  ];
}

function buildProduct(
  product: SellerSpriteProductObservation,
  brief: SellerSpriteShadowSelectionBrief,
): SellerSpriteBriefBoundShadowProduct {
  const sources = scoreSources(product, brief);
  const missingRequiredSignals = brief.requiredSignals
    .filter((signal) => signalMissing(product, signal))
    .sort();
  const hasConflicts = product.conflictingProviderMetrics.length > 0;
  const provisionalDisposition: SellerSpriteProvisionalDisposition = hasConflicts
    ? "conflicting_provider_metrics"
    : missingRequiredSignals.length > 0
      ? "insufficient_required_signals"
      : "insufficient_hard_gate_evidence";
  const scoreInputsComplete = sources.every((source) => source.provisionalPoints !== null);
  const provisionalNumericScore = hasConflicts
    || missingRequiredSignals.length > 0
    || !scoreInputsComplete
    ? null
    : sources.reduce((sum, source) => sum + (source.provisionalPoints ?? 0), 0);
  const priceMetric = product.providerMetrics.price;
  const price = numericMetric(product, "price");
  const briefPriceBandStatus = priceMetric.status === "conflict"
    ? "conflict" as const
    : price === null
      ? "missing" as const
      : price >= brief.priceMin && price <= brief.priceMax
        ? "within" as const
        : "outside" as const;
  const evidence = product.occurrences.flatMap((occurrence) => occurrence.providerEvidence);
  const metricNatureCounts: Record<string, number> = {};
  const usagePolicyCounts: Record<string, number> = {};
  for (const item of evidence) {
    metricNatureCounts[item.metricNature] = (metricNatureCounts[item.metricNature] ?? 0) + 1;
    usagePolicyCounts[item.usagePolicy] = (usagePolicyCounts[item.usagePolicy] ?? 0) + 1;
  }
  const missingSignals = [...new Set([
    ...product.missingProviderMetrics,
    ...missingRequiredSignals,
    ...(product.reportType === "search_results"
      && product.appearances.every((appearance) => appearance.placementType === "unknown")
      ? ["searchRank"]
      : []),
  ])].sort();
  const distortionReasons = [
    "hard_gate_evidence_unknown",
    "provider_metrics_are_not_direct_observations",
    ...(product.conflictingProviderMetrics.length > 0
      ? ["conflicting_provider_metrics_block_numeric_score"]
      : []),
    ...(missingRequiredSignals.length > 0
      ? ["required_signals_missing"]
      : []),
    ...(!scoreInputsComplete ? ["provisional_score_input_missing"] : []),
  ].sort();
  return {
    reportType: product.reportType,
    asin: product.asin,
    parentAsin: product.parentAsin,
    occurrenceIdentities: product.occurrences
      .map((occurrence) => occurrence.occurrenceIdentity)
      .sort(),
    appearanceIdentities: product.appearances
      .map((appearance) => appearance.appearanceIdentity)
      .sort(),
    occurrenceSummary: {
      occurrenceCount: product.occurrences.length,
    },
    appearanceSummary: product.reportType === "search_results" ? {
      appearanceCount: product.appearances.length,
      ...product.placementSummary,
    } : null,
    categoryEvidenceSummary: product.categoryEvidenceSummary,
    providerEvidenceSummary: {
      evidenceCount: evidence.length,
      sourceTypes: ["provider_metric"],
      metricNatureCounts,
      usagePolicyCounts,
    },
    missingSignals,
    conflictingSignals: product.conflictingProviderMetrics,
    briefPriceBandResult: {
      status: briefPriceBandStatus,
      price,
      currency: "USD",
      priceMin: brief.priceMin,
      priceMax: brief.priceMax,
    },
    provisionalNumericScore,
    provisionalDisposition,
    scoreSources: sources,
    scoreBreakdown: sources,
    missingRequiredSignals,
    conflictingProviderMetrics: product.conflictingProviderMetrics,
    hardGateEvidenceStatus: "unknown",
    hardGateEvaluable: false,
    promotionEligible: false,
    authoritative: false,
    productionEffect: false,
    productionDatabaseWritten: false,
    manifestRegistered: false,
    distortionReasons,
    warnings: [
      ...product.warnings,
      "hard_gate_evidence_unknown",
      "provisional_numeric_score_is_not_stage1",
    ].sort(),
  };
}

export function buildSellerSpriteBriefBoundShadowReport(
  snapshot: SellerSpriteMarketSnapshot,
  brief: SellerSpriteShadowSelectionBrief,
): SellerSpriteBriefBoundShadowReport {
  if (snapshot.schemaVersion !== "sellersprite-market-snapshot.v3") {
    throw new Error("SELLERSPRITE_MARKET_SNAPSHOT_VERSION_INVALID");
  }
  const normalizedBrief = normalizeAndValidateSellerSpriteShadowBrief(brief);
  if (
    snapshot.marketplace !== normalizedBrief.marketplace
    || snapshot.market !== normalizedBrief.market
    || snapshot.reportType !== normalizedBrief.reportType
  ) {
    throw new Error("SELLERSPRITE_SHADOW_BRIEF_MARKET_MISMATCH");
  }
  const products = snapshot.products.map((product) => buildProduct(product, normalizedBrief));
  const provisionalDistribution: Record<SellerSpriteProvisionalDisposition, number> = {
    provisional_score_only: 0,
    insufficient_hard_gate_evidence: 0,
    conflicting_provider_metrics: 0,
    insufficient_required_signals: 0,
  };
  for (const product of products) {
    provisionalDistribution[product.provisionalDisposition] += 1;
  }
  const conflictCounts: Record<string, number> = {};
  for (const product of snapshot.products) {
    for (const field of product.conflictingProviderMetrics) {
      conflictCounts[field] = (conflictCounts[field] ?? 0) + 1;
    }
  }
  const reportHash = sellerSpriteStableHash({
    schemaVersion: SCHEMA_VERSION,
    reportType: snapshot.reportType,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: normalizedBrief.briefHash,
    products: products.map((product) => ({
      asin: product.asin,
      provisionalNumericScore: product.provisionalNumericScore,
      provisionalDisposition: product.provisionalDisposition,
      scoreSources: product.scoreSources,
      missingRequiredSignals: product.missingRequiredSignals,
      conflictingProviderMetrics: product.conflictingProviderMetrics,
    })),
  });
  return {
    schemaVersion: SCHEMA_VERSION,
    reportHash,
    sourceFileSha256: snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: normalizedBrief.briefHash,
    brief: normalizedBrief,
    reportType: snapshot.reportType,
    marketplace: "amazon.com",
    query: normalizedBrief.query,
    occurrenceCount: snapshot.occurrences.length,
    appearanceCount: snapshot.reportType === "search_results"
      ? snapshot.appearances.length
      : null,
    productCount: snapshot.products.length,
    familyCount: snapshot.families.length,
    fieldCoverage: snapshot.fieldCoverage,
    placementSummary: snapshot.placementSummary,
    categoryBsrSummary: snapshot.categoryBsrSummary,
    conflictCounts,
    missingSignals: snapshot.missingSignals,
    source: "SellerSprite",
    sourceType: "provider_metric",
    calculationRule: "sellersprite-provisional-compatibility-v1",
    currentStage1Invoked: false,
    currentStage1RuleModified: false,
    hardGateEvidenceStatus: "unknown",
    hardGateEvaluable: false,
    promotionEligible: false,
    authoritative: false,
    promotionAllowed: false,
    productionEffect: false,
    productionDatabaseWritten: false,
    manifestRegistered: false,
    hardGateMissingEvidence: HARD_GATE_MISSING_EVIDENCE,
    products,
    provisionalDistribution,
    contractCompatibilityRisk: true,
    warnings: [
      "SellerSprite provider_metric is screening evidence only.",
      "Hard-gate evidence is unavailable; no promotion or formal disposition is allowed.",
      "The provisional score is not the current production Stage 1 score.",
    ],
  };
}
