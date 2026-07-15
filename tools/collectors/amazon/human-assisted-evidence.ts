import type {
  CompletenessMetric,
  LayoutMetrics,
  QualityGateResult,
} from "../../../lib/upstream/contracts";
import {
  AMAZON_LAYOUT_GATE_THRESHOLDS,
  evaluateLayoutChangeWithEvidence,
  stableHash,
  type LayoutGateEvaluation,
} from "../../../lib/upstream/pipeline";
import type { AmazonEnvironmentGateResult } from "./environment-gate";
import type { AmazonSponsoredPlacementDiagnostic } from "./extract-search-page";
import type { AmazonSearchPageExtraction } from "./live-canary";
import type { buildAmazonPageDiagnostic } from "./page-diagnostics";

type SponsoredCounts = {
  true: number | null;
  false: number | null;
  null: number | null;
};

export type HumanAssistedSponsoredDiagnostic = AmazonSponsoredPlacementDiagnostic & {
  appearanceKey: string;
};

export type HumanAssistedExtractionAttempt = {
  schemaVersion: "human-assisted-extraction-attempt.v1";
  captureMode: "human_current_page";
  collectorNavigationPerformed: false;
  requestedSampleLimit: number;
  rawCardCount: number | null;
  expectedSampleCount: number | null;
  extractedObservationCount: number | null;
  samplingCoverage: CompletenessMetric;
  sampledObservationIds: string[] | null;
  identityCompleteness: CompletenessMetric;
  titleCompleteness: CompletenessMetric;
  priceCompleteness: CompletenessMetric;
  ratingCompleteness: CompletenessMetric;
  reviewCountCompleteness: CompletenessMetric;
  imageCompleteness: CompletenessMetric;
  sponsoredKnownCompleteness: CompletenessMetric;
  sponsoredCounts: SponsoredCounts;
  sponsoredDiagnostics?: HumanAssistedSponsoredDiagnostic[] | null;
  layoutMetrics: LayoutMetrics | null;
  qualityGate: QualityGateResult | null;
  layoutGate: LayoutGateEvaluation | null;
  thresholds: typeof AMAZON_LAYOUT_GATE_THRESHOLDS;
  reasonCodes: string[];
  missingReasons: Record<string, string>;
  diagnosticEvidenceHash: string | null;
  environmentGateHash: string | null;
  inputHash: string;
  evidenceHash: string;
  collectorVersion: string;
};

type LiveEvidence = {
  metrics: LayoutMetrics;
  qualityGate: QualityGateResult;
};

function completeness(
  observedCount: number | null,
  denominator: number | null,
  zeroDenominatorReason = "no_extracted_observations",
): CompletenessMetric {
  if (observedCount === null || denominator === null) {
    return { observedCount, denominator, ratio: null, missingReason: "extraction_unavailable" };
  }
  if (denominator === 0) {
    return { observedCount, denominator, ratio: null, missingReason: zeroDenominatorReason };
  }
  return { observedCount, denominator, ratio: observedCount / denominator, missingReason: null };
}

function isValidAsin(value: string | null): boolean {
  return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

function attemptHashCore(attempt: Omit<HumanAssistedExtractionAttempt, "inputHash" | "evidenceHash">) {
  return {
    schemaVersion: attempt.schemaVersion,
    captureMode: attempt.captureMode,
    collectorNavigationPerformed: attempt.collectorNavigationPerformed,
    requestedSampleLimit: attempt.requestedSampleLimit,
    rawCardCount: attempt.rawCardCount,
    expectedSampleCount: attempt.expectedSampleCount,
    extractedObservationCount: attempt.extractedObservationCount,
    samplingCoverage: attempt.samplingCoverage,
    sampledObservationIds: attempt.sampledObservationIds,
    identityCompleteness: attempt.identityCompleteness,
    titleCompleteness: attempt.titleCompleteness,
    priceCompleteness: attempt.priceCompleteness,
    ratingCompleteness: attempt.ratingCompleteness,
    reviewCountCompleteness: attempt.reviewCountCompleteness,
    imageCompleteness: attempt.imageCompleteness,
    sponsoredKnownCompleteness: attempt.sponsoredKnownCompleteness,
    sponsoredCounts: attempt.sponsoredCounts,
    ...(attempt.sponsoredDiagnostics === undefined
      ? {}
      : { sponsoredDiagnostics: attempt.sponsoredDiagnostics }),
    layoutMetrics: attempt.layoutMetrics,
    qualityGate: attempt.qualityGate,
    layoutGate: attempt.layoutGate,
    thresholds: attempt.thresholds,
    reasonCodes: attempt.reasonCodes,
    missingReasons: attempt.missingReasons,
    diagnosticEvidenceHash: attempt.diagnosticEvidenceHash,
    environmentGateHash: attempt.environmentGateHash,
    collectorVersion: attempt.collectorVersion,
  };
}

export function buildHumanAssistedExtractionAttempt(input: {
  collectorVersion: string;
  requestedSampleLimit: number;
  diagnostic: ReturnType<typeof buildAmazonPageDiagnostic> | null;
  environmentGate: AmazonEnvironmentGateResult | null;
  extraction: AmazonSearchPageExtraction | null;
  liveEvidence: LiveEvidence | null;
  unavailableReason?: string;
}): HumanAssistedExtractionAttempt {
  const { extraction, liveEvidence } = input;
  const observations = extraction?.observations ?? null;
  const rawCardCount = extraction?.rawCardCount ?? null;
  const extractedObservationCount = observations?.length ?? null;
  const expectedSampleCount = rawCardCount === null
    ? null
    : Math.min(rawCardCount, input.requestedSampleLimit);
  const identityCount = observations
    ? observations.filter((item) => isValidAsin(item.asin)).length
    : null;
  const titleCount = observations ? observations.filter((item) => item.title !== null).length : null;
  const priceCount = observations ? observations.filter((item) => item.priceText !== null).length : null;
  const ratingCount = observations ? observations.filter((item) => item.ratingText !== null).length : null;
  const reviewCount = observations ? observations.filter((item) => item.reviewCountText !== null).length : null;
  const imageCount = observations ? observations.filter((item) => item.imageUrl !== null).length : null;
  const sponsoredCounts: SponsoredCounts = observations ? {
    true: observations.filter((item) => item.sponsored === true).length,
    false: observations.filter((item) => item.sponsored === false).length,
    null: observations.filter((item) => item.sponsored === null).length,
  } : { true: null, false: null, null: null };
  const sponsoredKnownCount = sponsoredCounts.true === null || sponsoredCounts.false === null
    ? null
    : sponsoredCounts.true + sponsoredCounts.false;
  const sponsoredDiagnostics: HumanAssistedSponsoredDiagnostic[] | null = observations ? observations.map((item) => ({
    appearanceKey: item.appearanceKey,
    ...item.sponsoredDiagnostic,
  })) : null;
  const layoutGate = liveEvidence ? evaluateLayoutChangeWithEvidence(liveEvidence.metrics) : null;
  const missingReasons: Record<string, string> = {};
  if (!extraction) {
    const reason = input.unavailableReason ?? "extraction_unavailable";
    for (const field of [
      "rawCardCount",
      "expectedSampleCount",
      "extractedObservationCount",
      "samplingCoverage",
      "sampledObservationIds",
      "identityCompleteness",
      "titleCompleteness",
      "priceCompleteness",
      "ratingCompleteness",
      "reviewCountCompleteness",
      "imageCompleteness",
      "sponsoredKnownCompleteness",
      "sponsoredCounts",
      "sponsoredDiagnostics",
      "layoutMetrics",
      "qualityGate",
      "layoutGate",
    ]) missingReasons[field] = reason;
  } else if (!liveEvidence) {
    for (const field of ["layoutMetrics", "qualityGate", "layoutGate"]) {
      missingReasons[field] = "gate_evaluation_unavailable";
    }
  }
  const reasonCodes = [...new Set([
    ...(liveEvidence?.qualityGate.errorCodes ?? []),
    ...(liveEvidence?.qualityGate.missingReasons ?? []),
    ...(layoutGate?.errorCodes ?? []),
    ...(layoutGate?.reasonCodes ?? []),
    ...Object.values(missingReasons),
  ])].sort();
  const core: Omit<HumanAssistedExtractionAttempt, "inputHash" | "evidenceHash"> = {
    schemaVersion: "human-assisted-extraction-attempt.v1",
    captureMode: "human_current_page",
    collectorNavigationPerformed: false,
    requestedSampleLimit: input.requestedSampleLimit,
    rawCardCount,
    expectedSampleCount,
    extractedObservationCount,
    samplingCoverage: completeness(
      extractedObservationCount,
      expectedSampleCount,
      "no_expected_sample",
    ),
    sampledObservationIds: extraction ? [...extraction.sampledObservationIds] : null,
    identityCompleteness: completeness(identityCount, extractedObservationCount),
    titleCompleteness: completeness(titleCount, extractedObservationCount),
    priceCompleteness: completeness(priceCount, extractedObservationCount),
    ratingCompleteness: completeness(ratingCount, extractedObservationCount),
    reviewCountCompleteness: completeness(reviewCount, extractedObservationCount),
    imageCompleteness: completeness(imageCount, extractedObservationCount),
    sponsoredKnownCompleteness: completeness(sponsoredKnownCount, extractedObservationCount),
    sponsoredCounts,
    sponsoredDiagnostics,
    layoutMetrics: liveEvidence ? {
      ...liveEvidence.metrics,
      samplingCoverage: { ...liveEvidence.metrics.samplingCoverage },
    } : null,
    qualityGate: liveEvidence ? {
      ...liveEvidence.qualityGate,
      errorCodes: [...liveEvidence.qualityGate.errorCodes],
      missingReasons: [...liveEvidence.qualityGate.missingReasons],
    } : null,
    layoutGate,
    thresholds: AMAZON_LAYOUT_GATE_THRESHOLDS,
    reasonCodes,
    missingReasons,
    diagnosticEvidenceHash: input.diagnostic?.evidenceHash ?? null,
    environmentGateHash: input.environmentGate ? stableHash(input.environmentGate) : null,
    collectorVersion: input.collectorVersion,
  };
  const inputHash = stableHash(attemptHashCore(core));
  return { ...core, inputHash, evidenceHash: stableHash({ ...attemptHashCore(core), inputHash }) };
}

export function extractionAttemptHashesAreValid(attempt: HumanAssistedExtractionAttempt): boolean {
  const { inputHash, evidenceHash, ...core } = attempt;
  const expectedInputHash = stableHash(attemptHashCore(core));
  return inputHash === expectedInputHash
    && evidenceHash === stableHash({ ...attemptHashCore(core), inputHash: expectedInputHash });
}
