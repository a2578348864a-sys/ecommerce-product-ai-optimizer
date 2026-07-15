import { createHash } from "crypto";
import type {
  CollectionRun,
  EvidenceSnapshot,
  ImportCandidate,
  ImportPackage,
  LayoutMetrics,
  MinimumEvidencePack,
  NormalizedProduct,
  ObservedValue,
  QualityGateResult,
  RawObservation,
  SelectionBrief,
} from "./contracts";

type FixtureObservationInput = Omit<RawObservation,
  "schemaVersion" | "collectionRunId" | "marketplace" | "market" | "sourceUrl" | "capturedAt" | "contentHash" | "status" | "errorCode">;

type FixtureBatchInput = {
  schemaVersion: string;
  brief: SelectionBrief;
  run: CollectionRun;
  observations: FixtureObservationInput[];
};

export type FixturePipelineResult = {
  brief: SelectionBrief;
  run: CollectionRun;
  rawObservations: RawObservation[];
  rawObservationCount: number;
  uniqueProductCount: number;
  quarantined: Array<{ observation: RawObservation; qualityGate: QualityGateResult }>;
  metrics: LayoutMetrics;
  contextGate: QualityGateResult;
  layoutGate: QualityGateResult;
  importPackage: ImportPackage;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("CANONICAL_VALUE_INVALID");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error("CANONICAL_VALUE_INVALID");
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function buildImportPackageHash(pkg: Pick<ImportPackage,
  "schemaVersion" | "briefId" | "collectionRunId" | "marketplace" | "market" | "sourceUrl" | "capturedAt"
  | "importBatchId" | "candidates">): string {
  return stableHash({
    schemaVersion: pkg.schemaVersion,
    briefId: pkg.briefId,
    collectionRunId: pkg.collectionRunId,
    marketplace: pkg.marketplace,
    market: pkg.market,
    sourceUrl: pkg.sourceUrl,
    capturedAt: pkg.capturedAt,
    importBatchId: pkg.importBatchId,
    candidates: pkg.candidates,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const OBSERVATION_DRAFT_FIELDS = new Set([
  "appearanceKey", "page", "position", "sponsored", "asin", "parentAsin", "title", "price",
  "priceCurrency", "rating", "reviewCount", "brand", "productUrl", "imageUrl", "identityMissingReason",
  "fieldMissingReasons", "observedRiskFlags",
]);

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function assertObservationDraftShape(value: unknown): asserts value is FixtureObservationInput {
  if (!isRecord(value)) throw new Error("RAW_OBSERVATION_INVALID");
  if (Object.keys(value).some((key) => !OBSERVATION_DRAFT_FIELDS.has(key))) {
    throw new Error("RAW_OBSERVATION_FIELD_NOT_ALLOWED");
  }
  if (!nonEmptyString(value.appearanceKey)
    || !Number.isInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 2
    || !Number.isInteger(value.position) || (value.position as number) < 1
    || ![true, false, null].includes(value.sponsored as boolean | null)
    || !nullableString(value.asin) || !nullableString(value.parentAsin) || !nullableString(value.title)
    || !nullableFiniteNumber(value.price) || !nullableFiniteNumber(value.rating)
    || !(value.reviewCount === null || (Number.isSafeInteger(value.reviewCount) && (value.reviewCount as number) >= 0))
    || !nullableString(value.brand) || !nonEmptyString(value.productUrl) || !nullableString(value.imageUrl)
    || !nullableString(value.identityMissingReason)
    || !["USD", "JPY", null].includes(value.priceCurrency as "USD" | "JPY" | null)
    || !isRecord(value.fieldMissingReasons)
    || !Object.values(value.fieldMissingReasons).every((reason) => typeof reason === "string" && reason.length > 0)
    || !Array.isArray(value.observedRiskFlags) || !value.observedRiskFlags.every((flag) => typeof flag === "string")) {
    throw new Error("RAW_OBSERVATION_INVALID");
  }
}

function assertCollectionRunShape(run: unknown): asserts run is CollectionRun {
  if (!isRecord(run) || run.schemaVersion !== "collection-run.v2") throw new Error("COLLECTION_RUN_VERSION_INVALID");
  if (!nonEmptyString(run.collectionRunId) || !nonEmptyString(run.briefId) || !nonEmptyString(run.sourceUrl)
    || !nonEmptyString(run.capturedAt) || !nonEmptyString(run.collectorVersion)) {
    throw new Error("COLLECTION_RUN_CORE_INVALID");
  }
  if (!isRecord(run.requested) || !isRecord(run.observed) || !Array.isArray(run.sampledObservationIds)) {
    throw new Error("COLLECTION_RUN_CONTEXT_INVALID");
  }
  if (!run.sampledObservationIds.every(nonEmptyString) || new Set(run.sampledObservationIds).size !== run.sampledObservationIds.length) {
    throw new Error("COLLECTION_RUN_SAMPLE_IDS_INVALID");
  }
  const diagnosticVisiblePriceNodeCount = run.diagnosticVisiblePriceNodeCount;
  if (diagnosticVisiblePriceNodeCount !== null
    && (typeof diagnosticVisiblePriceNodeCount !== "number"
      || !Number.isInteger(diagnosticVisiblePriceNodeCount)
      || diagnosticVisiblePriceNodeCount < 0)) {
    throw new Error("COLLECTION_RUN_DIAGNOSTIC_COUNT_INVALID");
  }
  if (!["ok", "captcha", "login_wall", "error_page", "unknown_page"].includes(String(run.pageStatus))) {
    throw new Error("COLLECTION_RUN_PAGE_STATUS_INVALID");
  }
}

export function buildCollectionRunContentHash(run: unknown, observations: unknown): string {
  if (!isRecord(run) || !Array.isArray(observations)) throw new Error("COLLECTION_RUN_HASH_INPUT_INVALID");
  const sampledPriceEvidence = observations.map((item) => {
    if (!isRecord(item)) throw new Error("COLLECTION_RUN_HASH_INPUT_INVALID");
    return {
      appearanceKey: item.appearanceKey ?? null,
      price: item.price ?? null,
      priceCurrency: item.priceCurrency ?? null,
    };
  });
  return stableHash({
    schemaVersion: run.schemaVersion,
    collectionRunId: run.collectionRunId,
    briefId: run.briefId,
    requested: run.requested,
    observed: run.observed,
    sampledObservationIds: run.sampledObservationIds,
    diagnosticVisiblePriceNodeCount: run.diagnosticVisiblePriceNodeCount,
    pageStatus: run.pageStatus,
    sourceUrl: run.sourceUrl,
    capturedAt: run.capturedAt,
    collectorVersion: run.collectorVersion,
    status: run.status,
    errorCode: run.errorCode,
    sampledPriceEvidence,
  });
}

function normalizeAsin(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

export function canonicalizeAmazonProductUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.hostname !== "www.amazon.com" && url.hostname !== "amazon.com")) {
    throw new Error("AMAZON_PRODUCT_URL_NOT_ALLOWED");
  }
  if (url.username || url.password || url.port) throw new Error("AMAZON_PRODUCT_URL_NOT_ALLOWED");
  const match = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:\/|$)/);
  if (!match) throw new Error("AMAZON_ASIN_NOT_FOUND");
  return `https://www.amazon.com/dp/${match[1].toUpperCase()}`;
}

function observedValue<T>(rawValue: T | null, missingReason: string | undefined): ObservedValue<T> {
  return {
    sourceType: "direct_observation",
    rawValue,
    normalizedValue: rawValue,
    manualOverride: null,
    missingReason: rawValue === null ? (missingReason ?? "not_observed") : null,
  };
}

function buildMinimumEvidencePack(
  product: NormalizedProduct,
  evidenceSnapshotId: string,
): Omit<MinimumEvidencePack, "importBatchId"> {
  const missingEvidence: string[] = [];
  if (!product.platformProductId) missingEvidence.push("identity");
  if (product.title.normalizedValue === null) missingEvidence.push("title");
  if (product.price.normalizedValue === null) missingEvidence.push("price");
  if (product.rating.normalizedValue === null) missingEvidence.push("rating");
  if (product.reviewCount.normalizedValue === null) missingEvidence.push("review_count");
  return {
    schemaVersion: "minimum-evidence-pack.v1",
    productKey: product.productKey,
    evidenceSnapshotId,
    complete: missingEvidence.length === 0,
    missingEvidence,
  };
}

function sameOrderedValues(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function evaluateCollectionRunQuality(
  brief: SelectionBrief,
  run: CollectionRun,
  observations: RawObservation[],
): QualityGateResult {
  const errors: string[] = [];
  const missingReasons: string[] = [];
  const requested = run.requested;
  const observed = run.observed;

  if (requested.marketplace !== brief.marketplace || requested.market !== brief.market
    || requested.currency !== brief.targetPriceRange.currency) errors.push("requested_context_mismatch");

  const requiredObserved = [
    ["marketplace", observed.marketplace],
    ["market", observed.market],
    ["currency", observed.currency],
    ["delivery_region", observed.deliveryRegion],
    ["delivery_region_market", observed.deliveryRegionMarket],
    ["language", observed.language],
  ] as const;
  for (const [field, value] of requiredObserved) {
    if (!nonEmptyString(value)) missingReasons.push(`observed_${field}_unknown`);
  }
  if (missingReasons.length) errors.push("insufficient_core_fields");
  if (observed.marketplace !== null && observed.marketplace !== requested.marketplace) errors.push("conflicting_values");
  if (observed.market !== null && observed.market !== requested.market) errors.push("conflicting_values");
  if (observed.currency !== null && observed.currency !== requested.currency) errors.push("conflicting_values");
  if (observed.deliveryRegionMarket !== null && observed.deliveryRegionMarket !== requested.market) errors.push("conflicting_values");
  if (observed.language !== null && observed.language.trim().toLowerCase() !== "en-us") errors.push("conflicting_values");

  const observedIds = observations.map((item) => item.appearanceKey);
  if (run.sampledObservationIds.length !== observations.length) {
    errors.push("sampled_observation_count_mismatch");
    missingReasons.push("sampled_observation_ids_length_does_not_match_extracted_observations");
  }
  if (!sameOrderedValues(run.sampledObservationIds, observedIds)) {
    errors.push("sample_binding_mismatch");
    missingReasons.push("sampled_observation_ids_do_not_match_observations");
  }
  const pricedSamples = observations.filter((item) => item.price !== null);
  if (pricedSamples.length === 0) {
    errors.push("insufficient_core_fields");
    missingReasons.push("sampled_price_evidence_missing");
  }
  if (pricedSamples.some((item) => item.priceCurrency === null)) {
    errors.push("insufficient_core_fields");
    missingReasons.push("sampled_price_currency_unknown");
  }
  if (pricedSamples.some((item) => item.priceCurrency !== null && item.priceCurrency !== requested.currency)) {
    errors.push("conflicting_values");
    missingReasons.push("sampled_price_currency_conflicts_with_request");
  }
  if (pricedSamples.some((item) => item.priceCurrency !== null && item.priceCurrency !== observed.currency)) {
    errors.push("conflicting_values");
    missingReasons.push("sampled_price_currency_conflicts_with_observation");
  }

  if (run.pageStatus !== "ok") {
    errors.push(run.pageStatus === "unknown_page" ? "suspected_layout_change" : "blocked_page");
    errors.push(run.pageStatus);
  }
  return {
    schemaVersion: "quality-gate-result.v1",
    status: errors.length ? "failed" : "passed",
    errorCodes: [...new Set(errors)].sort(),
    missingReasons: [...new Set(missingReasons)].sort(),
  };
}

export const AMAZON_LAYOUT_GATE_THRESHOLDS = Object.freeze({
  minimumRawCardsForRateChecks: 5,
  minimumIdentityCompleteness: 0.6,
  minimumPriceCompleteness: 0.4,
  minimumSponsoredKnownCompleteness: 0.4,
});

export type LayoutGateEvaluation = {
  schemaVersion: "layout-gate-evaluation.v1";
  status: "passed" | "failed";
  errorCodes: string[];
  reasonCodes: string[];
  thresholds: typeof AMAZON_LAYOUT_GATE_THRESHOLDS;
  rateChecksApplied: boolean;
  observedRates: {
    identityCompleteness: number | null;
    priceCompleteness: number | null;
    sponsoredKnownCompleteness: number | null;
  };
};

export function evaluateLayoutChangeWithEvidence(metrics: LayoutMetrics): LayoutGateEvaluation {
  const errors: string[] = [];
  const reasons: string[] = [];
  if (metrics.blockedPage) {
    errors.push("blocked_page");
    reasons.push("blocked_page");
  }
  if (!metrics.keyContainerFound) {
    errors.push("suspected_layout_change");
    reasons.push("key_container_missing");
  }
  if (metrics.expectedSampleCount > 0 && metrics.extractedObservationCount === 0) {
    errors.push("suspected_layout_change");
    reasons.push("observation_extraction_empty");
  }
  if (metrics.extractedObservationCount > metrics.expectedSampleCount) {
    errors.push("suspected_layout_change");
    reasons.push("extracted_count_exceeds_expected_sample_count");
  }
  const rateChecksApplied = metrics.rawCardCount >= AMAZON_LAYOUT_GATE_THRESHOLDS.minimumRawCardsForRateChecks;
  const identityRate = metrics.extractedObservationCount > 0
    ? metrics.identitySuccessCount / metrics.extractedObservationCount
    : null;
  const priceRate = metrics.extractedObservationCount > 0
    ? metrics.priceVisibleCount / metrics.extractedObservationCount
    : null;
  const sponsoredRate = metrics.extractedObservationCount > 0
    ? metrics.sponsoredKnownCount / metrics.extractedObservationCount
    : null;
  if (rateChecksApplied) {
    if (identityRate !== null && identityRate < AMAZON_LAYOUT_GATE_THRESHOLDS.minimumIdentityCompleteness) {
      errors.push("suspected_layout_change");
      reasons.push("identity_completeness_below_threshold");
    }
    if (priceRate !== null && priceRate < AMAZON_LAYOUT_GATE_THRESHOLDS.minimumPriceCompleteness) {
      errors.push("suspected_layout_change");
      reasons.push("price_completeness_below_threshold");
    }
    if (sponsoredRate !== null && sponsoredRate < AMAZON_LAYOUT_GATE_THRESHOLDS.minimumSponsoredKnownCompleteness) {
      errors.push("suspected_layout_change");
      reasons.push("sponsored_known_completeness_below_threshold");
    }
  }
  return {
    schemaVersion: "layout-gate-evaluation.v1",
    status: errors.length ? "failed" : "passed",
    errorCodes: [...new Set(errors)].sort(),
    reasonCodes: [...new Set(reasons)],
    thresholds: AMAZON_LAYOUT_GATE_THRESHOLDS,
    rateChecksApplied,
    observedRates: {
      identityCompleteness: identityRate,
      priceCompleteness: priceRate,
      sponsoredKnownCompleteness: sponsoredRate,
    },
  };
}

export function detectLayoutChange(metrics: LayoutMetrics): QualityGateResult {
  const evaluation = evaluateLayoutChangeWithEvidence(metrics);
  return {
    schemaVersion: "quality-gate-result.v1",
    status: evaluation.status,
    errorCodes: [...evaluation.errorCodes],
    missingReasons: [],
  };
}

export function buildSourceIndependentPipeline(input: unknown): FixturePipelineResult {
  if (!isRecord(input) || input.schemaVersion !== "raw-observation-batch.v1") throw new Error("FIXTURE_SCHEMA_VERSION_INVALID");
  const fixture = input as unknown as FixtureBatchInput;
  if (!isRecord(fixture.brief) || fixture.brief.schemaVersion !== "selection-brief.v1") throw new Error("SELECTION_BRIEF_VERSION_INVALID");
  assertCollectionRunShape(fixture.run);
  if (!Array.isArray(fixture.observations)) throw new Error("FIXTURE_OBSERVATIONS_INVALID");
  fixture.observations.forEach(assertObservationDraftShape);
  if (fixture.run.briefId !== fixture.brief.briefId) throw new Error("RUN_BRIEF_MISMATCH");
  if (fixture.brief.sampleBudget.maxPages > 2) throw new Error("SAMPLE_PAGE_BUDGET_EXCEEDED");
  if (fixture.observations.length > fixture.brief.sampleBudget.maxAppearances) throw new Error("SAMPLE_APPEARANCE_BUDGET_EXCEEDED");

  const run: CollectionRun = {
    ...fixture.run,
    requested: { ...fixture.run.requested },
    observed: { ...fixture.run.observed },
    sampledObservationIds: [...fixture.run.sampledObservationIds],
    contentHash: buildCollectionRunContentHash(fixture.run, fixture.observations),
  };
  const rawObservations: RawObservation[] = fixture.observations.map((item) => ({
    ...item,
    schemaVersion: "raw-observation.v1",
    collectionRunId: run.collectionRunId,
    marketplace: "amazon.com",
    market: "US",
    sourceUrl: run.sourceUrl,
    capturedAt: run.capturedAt,
    contentHash: stableHash({ collectionRunHash: run.contentHash, observation: item }),
    status: item.asin ? "observed" : "quarantined",
    errorCode: item.asin ? null : "missing_identity",
  }));
  const contextGate = evaluateCollectionRunQuality(fixture.brief, run, rawObservations);
  if (contextGate.status === "failed") throw new Error(contextGate.errorCodes.join(","));

  const quarantined = rawObservations.filter((item) => normalizeAsin(item.asin) === null).map((observation) => ({
    observation,
    qualityGate: {
      schemaVersion: "quality-gate-result.v1" as const,
      status: "failed" as const,
      errorCodes: ["missing_identity"],
      missingReasons: [observation.identityMissingReason ?? "asin_invalid"],
    },
  }));

  const groups = new Map<string, RawObservation[]>();
  for (const observation of rawObservations) {
    const asin = normalizeAsin(observation.asin);
    if (!asin) continue;
    const productKey = `amazon:US:${asin}`;
    groups.set(productKey, [...(groups.get(productKey) ?? []), observation]);
  }

  const candidateDrafts = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([productKey, appearances]) => {
    const first = appearances[0];
    const asin = normalizeAsin(first.asin);
    if (!asin) throw new Error("PRODUCT_IDENTITY_INVALID");
    const parentAsin = normalizeAsin(first.parentAsin);
    const sourceUrl = canonicalizeAmazonProductUrl(first.productUrl);
    const variantGroupKey = `amazon:US:${parentAsin ?? asin}`;
    const inputHash = stableHash({ collectionRunHash: run.contentHash, appearances: appearances.map((item) => item.contentHash) });
    const product: NormalizedProduct = {
      schemaVersion: "normalized-product.v1",
      productKey,
      variantGroupKey,
      marketplace: "amazon.com",
      market: "US",
      platformProductId: asin,
      sourceUrl,
      capturedAt: run.capturedAt,
      collectionRunId: run.collectionRunId,
      inputHash,
      title: observedValue(first.title, first.fieldMissingReasons.title),
      price: observedValue(first.price, first.fieldMissingReasons.price),
      rating: observedValue(first.rating, first.fieldMissingReasons.rating),
      reviewCount: observedValue(first.reviewCount, first.fieldMissingReasons.reviewCount),
      brand: observedValue(first.brand, first.fieldMissingReasons.brand),
      imageUrl: observedValue(first.imageUrl, first.fieldMissingReasons.imageUrl),
      observedRiskFlags: [...new Set(appearances.flatMap((item) => item.observedRiskFlags))].sort(),
      status: "normalized",
      errorCode: null,
    };
    const evidenceSnapshotId = `evidence-${stableHash({ productKey, run: run.collectionRunId, inputHash }).slice(0, 24)}`;
    const evidenceSnapshotDraft = {
      schemaVersion: "evidence-snapshot.v1" as const,
      evidenceSnapshotId,
      productKey,
      collectionRunId: run.collectionRunId,
      marketplace: "amazon.com" as const,
      market: "US" as const,
      sourceUrl,
      capturedAt: run.capturedAt,
      inputHash,
      freshness: "fresh" as const,
      sourceTypes: ["direct_observation" as const],
      product,
      status: "valid" as const,
      errorCode: null,
    };
    return {
      candidateId: `candidate-${stableHash(productKey).slice(0, 20)}`,
      productKey,
      variantGroupKey,
      appearanceKeys: appearances.map((item) => item.appearanceKey).sort(),
      appearances: appearances.map((item) => ({ appearanceKey: item.appearanceKey, sponsored: item.sponsored }))
        .sort((left, right) => left.appearanceKey.localeCompare(right.appearanceKey)),
      evidenceSnapshotDraft,
      minimumEvidencePack: buildMinimumEvidencePack(product, evidenceSnapshotId),
    };
  });

  const metrics: LayoutMetrics = {
    rawCardCount: rawObservations.length,
    requestedSampleLimit: fixture.brief.sampleBudget.maxAppearances,
    expectedSampleCount: Math.min(rawObservations.length, fixture.brief.sampleBudget.maxAppearances),
    extractedObservationCount: rawObservations.length,
    samplingCoverage: rawObservations.length === 0
      ? { observedCount: 0, denominator: 0, ratio: null, missingReason: "no_expected_sample" }
      : { observedCount: rawObservations.length, denominator: rawObservations.length, ratio: 1, missingReason: null },
    identitySuccessCount: rawObservations.filter((item) => normalizeAsin(item.asin) !== null).length,
    priceVisibleCount: rawObservations.filter((item) => item.price !== null).length,
    ratingVisibleCount: rawObservations.filter((item) => item.rating !== null).length,
    reviewVisibleCount: rawObservations.filter((item) => item.reviewCount !== null).length,
    sponsoredKnownCount: rawObservations.filter((item) => item.sponsored !== null).length,
    quarantinedCount: quarantined.length,
    uniqueProductCount: candidateDrafts.length,
    keyContainerFound: rawObservations.length > 0,
    blockedPage: run.pageStatus !== "ok",
  };
  const layoutGate = detectLayoutChange(metrics);
  if (layoutGate.status === "failed") throw new Error(layoutGate.errorCodes.join(","));

  const packageIdentityHash = stableHash({
    schemaVersion: "import-package.v1",
    briefId: fixture.brief.briefId,
    collectionRunId: run.collectionRunId,
    collectionRunHash: run.contentHash,
    sourceUrl: run.sourceUrl,
    capturedAt: run.capturedAt,
    candidates: candidateDrafts,
  });
  const importBatchId = `batch-${packageIdentityHash.slice(0, 20)}`;
  const candidates: ImportCandidate[] = candidateDrafts.map((candidate) => ({
    candidateId: candidate.candidateId,
    importBatchId,
    productKey: candidate.productKey,
    variantGroupKey: candidate.variantGroupKey,
    appearanceKeys: candidate.appearanceKeys,
    appearances: candidate.appearances,
    evidenceSnapshot: {
      ...candidate.evidenceSnapshotDraft,
      importBatchId,
      sourceState: "active",
    } satisfies EvidenceSnapshot,
    minimumEvidencePack: {
      ...candidate.minimumEvidencePack,
      importBatchId,
    },
  }));
  const packageCore = {
    schemaVersion: "import-package.v1" as const,
    briefId: fixture.brief.briefId,
    collectionRunId: run.collectionRunId,
    marketplace: "amazon.com" as const,
    market: "US" as const,
    sourceUrl: run.sourceUrl,
    capturedAt: run.capturedAt,
    importBatchId,
    candidates,
  };
  const importPackageHash = buildImportPackageHash(packageCore);
  const importPackage: ImportPackage = {
    ...packageCore,
    importPackageHash,
    importIdempotencyKey: `import:${importPackageHash}`,
    status: "preview_ready",
    errorCode: null,
  };

  return {
    brief: fixture.brief,
    run,
    rawObservations,
    rawObservationCount: rawObservations.length,
    uniqueProductCount: candidates.length,
    quarantined,
    metrics,
    contextGate,
    layoutGate,
    importPackage,
  };
}

/** Compatibility entrypoint for the original offline Fixture caller. */
export function buildFixturePipeline(input: unknown): FixturePipelineResult {
  return buildSourceIndependentPipeline(input);
}
