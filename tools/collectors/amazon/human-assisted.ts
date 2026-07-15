import type { SelectionBrief } from "../../../lib/upstream/contracts";
import { AMAZON_LAYOUT_GATE_THRESHOLDS, stableHash } from "../../../lib/upstream/pipeline";
import {
  adaptCollectedRawSource,
  type SourceAdapterResult,
} from "../../../lib/upstream/sourceAdapters";
import {
  openHumanAssistedAmazonBrowser,
  resolveSystemBrowser,
  type BrowserExecutableCandidate,
  type HumanAssistedBrowserCleanup,
  type HumanAssistedBrowserSession,
} from "./browser-control";
import {
  buildHumanAssistedExtractionAttempt,
  extractionAttemptHashesAreValid,
  type HumanAssistedExtractionAttempt,
} from "./human-assisted-evidence";
import { buildLiveAmazonCanaryEvidence } from "./live-canary";

export type HumanAssistedTriggerDecision = "confirmed" | "cancelled";

export type HumanAssistedAmazonRunResult = {
  schemaVersion: "human-assisted-amazon-run.v2";
  status: "completed" | "failed" | "cancelled" | "timed_out";
  errorCode: string | null;
  collectorVersion: string;
  capturedAt: string;
  explicitTriggerConfirmed: boolean;
  pageReadCount: number;
  paginationNavigationCount: 0;
  detailNavigationCount: 0;
  diagnostic: Awaited<ReturnType<HumanAssistedBrowserSession["inspectCurrentPage"]>>["diagnostic"] | null;
  environmentGate: Awaited<ReturnType<HumanAssistedBrowserSession["inspectCurrentPage"]>>["environmentGate"] | null;
  extractionAttempt: HumanAssistedExtractionAttempt;
  sourceAdapter: SourceAdapterResult | null;
  cleanup: HumanAssistedBrowserCleanup | null;
  sensitiveBrowserDataStored: false;
  formalCandidateGenerated: false;
  productionDatabaseWritten: false;
};

type HumanAssistedRunInput = {
  brief: SelectionBrief;
  collectorVersion: string;
  capturedAt: string;
  timeoutMs: number;
  browser?: BrowserExecutableCandidate;
  openSession?: () => Promise<HumanAssistedBrowserSession>;
  waitForExplicitTrigger: (signal: AbortSignal) => Promise<HumanAssistedTriggerDecision>;
};

function waitForDecision(
  waitForExplicitTrigger: (signal: AbortSignal) => Promise<HumanAssistedTriggerDecision>,
  timeoutMs: number,
): Promise<HumanAssistedTriggerDecision | "timed_out"> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      resolve("timed_out");
    }, timeoutMs);
    waitForExplicitTrigger(controller.signal).then((decision) => {
      clearTimeout(timeout);
      controller.abort();
      resolve(decision);
    }, (error) => {
      clearTimeout(timeout);
      controller.abort();
      reject(error);
    });
  });
}

function baseResult(input: HumanAssistedRunInput): HumanAssistedAmazonRunResult {
  return {
    schemaVersion: "human-assisted-amazon-run.v2",
    status: "failed",
    errorCode: null,
    collectorVersion: input.collectorVersion,
    capturedAt: input.capturedAt,
    explicitTriggerConfirmed: false,
    pageReadCount: 0,
    paginationNavigationCount: 0,
    detailNavigationCount: 0,
    diagnostic: null,
    environmentGate: null,
    extractionAttempt: buildHumanAssistedExtractionAttempt({
      collectorVersion: input.collectorVersion,
      requestedSampleLimit: input.brief.sampleBudget.maxAppearances,
      diagnostic: null,
      environmentGate: null,
      extraction: null,
      liveEvidence: null,
      unavailableReason: "collection_not_started",
    }),
    sourceAdapter: null,
    cleanup: null,
    sensitiveBrowserDataStored: false,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
  };
}

export async function runHumanAssistedAmazonCurrentPage(
  input: HumanAssistedRunInput,
): Promise<HumanAssistedAmazonRunResult> {
  const result = baseResult(input);
  if (input.brief.schemaVersion !== "selection-brief.v1") throw new Error("SELECTION_BRIEF_VERSION_INVALID");
  if (input.brief.marketplace !== "amazon.com" || input.brief.market !== "US"
    || input.brief.targetPriceRange.currency !== "USD" || input.brief.query !== "closet organizer") {
    throw new Error("HUMAN_ASSISTED_BRIEF_NOT_AUTHORIZED");
  }
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30 * 60_000) {
    throw new Error("HUMAN_ASSISTED_TIMEOUT_INVALID");
  }
  let session: HumanAssistedBrowserSession | null = null;
  try {
    const openSession = input.openSession ?? (async () => {
      const browser = input.browser ?? resolveSystemBrowser();
      if (!browser) throw new Error("browser executable not found");
      return await openHumanAssistedAmazonBrowser({ browser, headless: false });
    });
    session = await openSession();
    const decision = await waitForDecision(input.waitForExplicitTrigger, input.timeoutMs);
    if (decision === "timed_out") {
      result.status = "timed_out";
      result.errorCode = "human_confirmation_timeout";
      return result;
    }
    if (decision === "cancelled") {
      result.status = "cancelled";
      result.errorCode = "human_confirmation_cancelled";
      return result;
    }
    result.explicitTriggerConfirmed = true;
    const inspection = await session.inspectCurrentPage({
      query: "closet organizer",
      capturedAt: input.capturedAt,
      maxAppearances: Math.min(20, input.brief.sampleBudget.maxAppearances),
      expectedPostalCode: "10001",
    });
    result.pageReadCount = 1;
    result.diagnostic = inspection.diagnostic;
    result.environmentGate = inspection.environmentGate;
    result.extractionAttempt = buildHumanAssistedExtractionAttempt({
      collectorVersion: input.collectorVersion,
      requestedSampleLimit: input.brief.sampleBudget.maxAppearances,
      diagnostic: inspection.diagnostic,
      environmentGate: inspection.environmentGate,
      extraction: inspection.extraction,
      liveEvidence: null,
      unavailableReason: "page_gate_prevented_extraction",
    });
    if (!["amazon_normal", "amazon_normal_variant"].includes(inspection.diagnostic.classification)) {
      result.errorCode = inspection.diagnostic.classification;
      return result;
    }
    if (!inspection.allowedSearchPage) {
      result.errorCode = "not_amazon_search_page";
      return result;
    }
    if (inspection.environmentGate.status === "failed") {
      result.errorCode = inspection.environmentGate.errorCodes[0] ?? "environment_gate_failed";
      return result;
    }
    if (!inspection.extraction) {
      result.errorCode = "current_page_extraction_unavailable";
      return result;
    }
    if (inspection.extraction.page !== 1 || inspection.extraction.observations.length > 20) {
      result.errorCode = "sample_budget_exceeded";
      return result;
    }
    const evidence = buildLiveAmazonCanaryEvidence({
      brief: input.brief,
      extraction: inspection.extraction,
      collectorVersion: input.collectorVersion,
    });
    result.extractionAttempt = buildHumanAssistedExtractionAttempt({
      collectorVersion: input.collectorVersion,
      requestedSampleLimit: input.brief.sampleBudget.maxAppearances,
      diagnostic: inspection.diagnostic,
      environmentGate: inspection.environmentGate,
      extraction: inspection.extraction,
      liveEvidence: evidence,
    });
    if (evidence.qualityGate.status === "failed" || evidence.layoutGate.status === "failed") {
      result.errorCode = evidence.qualityGate.errorCodes[0]
        ?? evidence.layoutGate.errorCodes[0]
        ?? "source_quality_failed";
      return result;
    }
    result.sourceAdapter = adaptCollectedRawSource({
      sourceType: "human_assisted_amazon",
      sourceSchemaVersion: "amazon-search-page-extraction.v2",
      sourceInputHashMaterial: {
        evidenceHash: evidence.evidenceHash,
        collectorVersion: input.collectorVersion,
        sampledObservationIds: evidence.sampledObservationIds,
      },
      brief: input.brief,
      run: evidence.collectionRun,
      observations: evidence.observations,
    });
    result.status = "completed";
    result.errorCode = null;
    return result;
  } catch {
    result.status = "failed";
    result.errorCode = "human_assisted_runtime_failed";
    return result;
  } finally {
    if (session) result.cleanup = await session.close();
  }
}

type HumanAssistedRunValidation = {
  evidenceStatus: "complete" | "historical_evidence_insufficient";
  run: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeIntegerOrNull(value: unknown): boolean {
  return value === null || (Number.isInteger(value) && Number(value) >= 0);
}

function validCompleteness(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return nonNegativeIntegerOrNull(value.observedCount)
    && nonNegativeIntegerOrNull(value.denominator)
    && (value.ratio === null || (typeof value.ratio === "number" && Number.isFinite(value.ratio)
      && value.ratio >= 0 && value.ratio <= 1))
    && (value.missingReason === null || typeof value.missingReason === "string");
}

function validCoverage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return nonNegativeIntegerOrNull(value.observedCount)
    && nonNegativeIntegerOrNull(value.denominator)
    && (value.ratio === null || (typeof value.ratio === "number" && Number.isFinite(value.ratio)
      && value.ratio >= 0))
    && (value.missingReason === null || typeof value.missingReason === "string");
}

function validDerivedMetric(
  value: unknown,
  expectedDenominator: number | null,
  allowRatioAboveOne = false,
): boolean {
  if (!isRecord(value) || value.denominator !== expectedDenominator) return false;
  if (value.observedCount === null || expectedDenominator === null) {
    return value.observedCount === null && value.ratio === null;
  }
  if (!Number.isInteger(value.observedCount) || Number(value.observedCount) < 0) return false;
  if (!allowRatioAboveOne && Number(value.observedCount) > expectedDenominator) return false;
  if (expectedDenominator === 0) return value.ratio === null;
  return value.ratio === Number(value.observedCount) / expectedDenominator;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

function validSponsoredDiagnostic(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const validStates = [true, false, null];
  const validSources = ["known_dom_selector", "visible_text", "known_card_structure", "none"];
  const validSelectorCategories = [
    "aria_label_sponsored",
    "sponsored_label_class",
    "sponsored_component_marker",
    "ambiguous_ad_text",
    "standard_search_result_card",
    "unrecognized_card_structure",
  ];
  const validReasonCodes = [
    "sponsored_marker_present",
    "known_organic_structure",
    "ambiguous_ad_text_without_known_marker",
    "insufficient_sponsored_evidence",
  ];
  const commonValid = value.schemaVersion === "amazon-sponsored-placement-diagnostic.v1"
    && typeof value.appearanceKey === "string"
    && value.appearanceKey.length > 0
    && validStates.includes(value.state as boolean | null)
    && validSources.includes(value.markerSource as string)
    && validSelectorCategories.includes(value.selectorCategory as string)
    && validReasonCodes.includes(value.reasonCode as string)
    && (value.matchedText === null
      || (typeof value.matchedText === "string" && value.matchedText.length > 0 && value.matchedText.length <= 80));
  if (!commonValid) return false;
  if (value.state === true) {
    return value.markerSource === "known_dom_selector"
      && value.reasonCode === "sponsored_marker_present";
  }
  if (value.state === false) {
    return value.markerSource === "known_card_structure"
      && value.selectorCategory === "standard_search_result_card"
      && value.reasonCode === "known_organic_structure"
      && value.matchedText === null;
  }
  return (value.markerSource === "visible_text"
      && value.selectorCategory === "ambiguous_ad_text"
      && value.reasonCode === "ambiguous_ad_text_without_known_marker")
    || (value.markerSource === "none"
      && value.selectorCategory === "unrecognized_card_structure"
      && value.reasonCode === "insufficient_sponsored_evidence"
      && value.matchedText === null);
}

function validSponsoredDiagnostics(value: unknown): boolean {
  return value === undefined
    || value === null
    || (Array.isArray(value) && value.every(validSponsoredDiagnostic));
}

function validRate(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function validQualityGate(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === "quality-gate-result.v1"
    && (value.status === "passed" || value.status === "failed")
    && validStringArray(value.errorCodes)
    && Array.isArray(value.missingReasons)
    && value.missingReasons.every((item) => typeof item === "string");
}

function validThresholds(value: unknown): boolean {
  return isRecord(value)
    && value.minimumRawCardsForRateChecks === AMAZON_LAYOUT_GATE_THRESHOLDS.minimumRawCardsForRateChecks
    && value.minimumIdentityCompleteness === AMAZON_LAYOUT_GATE_THRESHOLDS.minimumIdentityCompleteness
    && value.minimumPriceCompleteness === AMAZON_LAYOUT_GATE_THRESHOLDS.minimumPriceCompleteness
    && value.minimumSponsoredKnownCompleteness === AMAZON_LAYOUT_GATE_THRESHOLDS.minimumSponsoredKnownCompleteness;
}

function validLayoutGate(value: unknown): boolean {
  return isRecord(value)
    && value.schemaVersion === "layout-gate-evaluation.v1"
    && (value.status === "passed" || value.status === "failed")
    && validStringArray(value.errorCodes)
    && Array.isArray(value.reasonCodes)
    && value.reasonCodes.every((item) => typeof item === "string")
    && validThresholds(value.thresholds)
    && typeof value.rateChecksApplied === "boolean"
    && isRecord(value.observedRates)
    && validRate(value.observedRates.identityCompleteness)
    && validRate(value.observedRates.priceCompleteness)
    && validRate(value.observedRates.sponsoredKnownCompleteness);
}

function validLayoutMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const field of [
    "rawCardCount",
    "requestedSampleLimit",
    "expectedSampleCount",
    "extractedObservationCount",
    "identitySuccessCount",
    "priceVisibleCount",
    "ratingVisibleCount",
    "reviewVisibleCount",
    "sponsoredKnownCount",
    "quarantinedCount",
    "uniqueProductCount",
  ]) {
    if (!nonNegativeIntegerOrNull(value[field]) || value[field] === null) return false;
  }
  return validCoverage(value.samplingCoverage)
    && typeof value.keyContainerFound === "boolean"
    && typeof value.blockedPage === "boolean";
}

function validHashOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
}

function validDiagnostic(value: unknown): boolean {
  return value === null || (isRecord(value)
    && value.schemaVersion === "amazon-page-diagnostic.v2"
    && typeof value.classification === "string"
    && Array.isArray(value.classificationReasonCodes)
    && value.classificationReasonCodes.every((item) => typeof item === "string")
    && typeof value.evidenceHash === "string"
    && /^[a-f0-9]{64}$/.test(value.evidenceHash));
}

function validEnvironmentGate(value: unknown): boolean {
  return value === null || (isRecord(value)
    && (value.status === "passed" || value.status === "failed")
    && Array.isArray(value.errorCodes)
    && value.errorCodes.every((item) => typeof item === "string")
    && typeof value.canSearch === "boolean"
    && isRecord(value.observed)
    && isRecord(value.observedEvidence));
}

function validCleanup(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return [
    "pageClosed",
    "browserClosed",
    "forcedTerminationUsed",
    "debugPortReleased",
    "profileRemoved",
    "browserProcessBaselineRestored",
  ].every((field) => typeof value[field] === "boolean");
}

function validSourceAdapter(value: unknown): boolean {
  return value === null || (isRecord(value)
    && value.schemaVersion === "source-adapter-result.v1"
    && typeof value.sourceType === "string"
    && typeof value.sourceSchemaVersion === "string"
    && typeof value.sourceInputHash === "string"
    && typeof value.sourceBatchId === "string"
    && nonNegativeIntegerOrNull(value.acceptedCount)
    && value.acceptedCount !== null
    && nonNegativeIntegerOrNull(value.quarantinedCount)
    && value.quarantinedCount !== null
    && Array.isArray(value.quarantinedRows)
    && isRecord(value.qualitySummary));
}

function assertV2ExtractionAttempt(value: unknown): asserts value is HumanAssistedExtractionAttempt {
  if (!isRecord(value)
    || value.schemaVersion !== "human-assisted-extraction-attempt.v1"
    || value.captureMode !== "human_current_page"
    || value.collectorNavigationPerformed !== false
    || !Number.isInteger(value.requestedSampleLimit)
    || Number(value.requestedSampleLimit) < 1
    || Number(value.requestedSampleLimit) > 20
    || !nonNegativeIntegerOrNull(value.rawCardCount)
    || !nonNegativeIntegerOrNull(value.expectedSampleCount)
    || !nonNegativeIntegerOrNull(value.extractedObservationCount)
    || !validCoverage(value.samplingCoverage)
    || !(value.sampledObservationIds === null || (Array.isArray(value.sampledObservationIds)
      && value.sampledObservationIds.every((item) => typeof item === "string" && item.length > 0)))
    || !validCompleteness(value.identityCompleteness)
    || !validCompleteness(value.titleCompleteness)
    || !validCompleteness(value.priceCompleteness)
    || !validCompleteness(value.ratingCompleteness)
    || !validCompleteness(value.reviewCountCompleteness)
    || !validCompleteness(value.imageCompleteness)
    || !validCompleteness(value.sponsoredKnownCompleteness)
    || !isRecord(value.sponsoredCounts)
    || !nonNegativeIntegerOrNull(value.sponsoredCounts.true)
    || !nonNegativeIntegerOrNull(value.sponsoredCounts.false)
    || !nonNegativeIntegerOrNull(value.sponsoredCounts.null)
    || !validSponsoredDiagnostics(value.sponsoredDiagnostics)
    || !(value.layoutMetrics === null || validLayoutMetrics(value.layoutMetrics))
    || !(value.qualityGate === null || validQualityGate(value.qualityGate))
    || !(value.layoutGate === null || validLayoutGate(value.layoutGate))
    || !validThresholds(value.thresholds)
    || !Array.isArray(value.reasonCodes)
    || !value.reasonCodes.every((item) => typeof item === "string")
    || !isRecord(value.missingReasons)
    || !Object.values(value.missingReasons).every((item) => typeof item === "string" && item.length > 0)
    || !validHashOrNull(value.diagnosticEvidenceHash)
    || !validHashOrNull(value.environmentGateHash)
    || typeof value.inputHash !== "string"
    || !/^[a-f0-9]{64}$/.test(value.inputHash)
    || typeof value.evidenceHash !== "string"
    || !/^[a-f0-9]{64}$/.test(value.evidenceHash)
    || typeof value.collectorVersion !== "string"
    || !value.collectorVersion.trim()) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  const attempt = value as unknown as HumanAssistedExtractionAttempt;
  if (attempt.sampledObservationIds !== null
    && new Set(attempt.sampledObservationIds).size !== attempt.sampledObservationIds.length) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  const qualityErrors = attempt.qualityGate?.errorCodes ?? [];
  const sampledCountMismatch = attempt.extractedObservationCount !== null && attempt.sampledObservationIds !== null
    && attempt.extractedObservationCount !== attempt.sampledObservationIds.length;
  if (sampledCountMismatch && !qualityErrors.includes("sampled_observation_count_mismatch")) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  const expectedSampleCount = attempt.rawCardCount === null
    ? null
    : Math.min(attempt.rawCardCount, attempt.requestedSampleLimit);
  if (attempt.expectedSampleCount !== expectedSampleCount) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  const extractedExceedsExpected = attempt.extractedObservationCount !== null
    && attempt.expectedSampleCount !== null
    && attempt.extractedObservationCount > attempt.expectedSampleCount;
  if (extractedExceedsExpected && !qualityErrors.includes("extracted_count_exceeds_expected_sample_count")) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  if (!validDerivedMetric(attempt.samplingCoverage, attempt.expectedSampleCount, true)) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  for (const metric of [
    attempt.identityCompleteness,
    attempt.titleCompleteness,
    attempt.priceCompleteness,
    attempt.ratingCompleteness,
    attempt.reviewCountCompleteness,
    attempt.imageCompleteness,
    attempt.sponsoredKnownCompleteness,
  ]) {
    if (!validDerivedMetric(metric, attempt.extractedObservationCount)) {
      throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    }
  }
  if (attempt.extractedObservationCount !== null) {
    const sponsoredTotal = Number(attempt.sponsoredCounts.true)
      + Number(attempt.sponsoredCounts.false)
      + Number(attempt.sponsoredCounts.null);
    if (sponsoredTotal !== attempt.extractedObservationCount
      || attempt.sponsoredKnownCompleteness.observedCount
        !== Number(attempt.sponsoredCounts.true) + Number(attempt.sponsoredCounts.false)) {
      throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    }
  }
  if (attempt.sponsoredDiagnostics !== undefined) {
    if (attempt.sampledObservationIds === null) {
      if (attempt.sponsoredDiagnostics !== null) throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    } else if (!Array.isArray(attempt.sponsoredDiagnostics)
      || attempt.sponsoredDiagnostics.length !== attempt.extractedObservationCount
      || (attempt.sponsoredDiagnostics.length === attempt.sampledObservationIds.length
        && attempt.sponsoredDiagnostics.some((item, index) => (
          item.appearanceKey !== attempt.sampledObservationIds?.[index]
        )))) {
      throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    } else {
      const diagnosticCounts = {
        true: attempt.sponsoredDiagnostics.filter((item) => item.state === true).length,
        false: attempt.sponsoredDiagnostics.filter((item) => item.state === false).length,
        null: attempt.sponsoredDiagnostics.filter((item) => item.state === null).length,
      };
      if (diagnosticCounts.true !== attempt.sponsoredCounts.true
        || diagnosticCounts.false !== attempt.sponsoredCounts.false
        || diagnosticCounts.null !== attempt.sponsoredCounts.null) {
        throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
      }
    }
  }
  if (attempt.rawCardCount !== null && attempt.layoutMetrics !== null
    && attempt.rawCardCount !== attempt.layoutMetrics.rawCardCount) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  if (attempt.layoutMetrics !== null) {
    const metrics = attempt.layoutMetrics;
    if (metrics.requestedSampleLimit !== attempt.requestedSampleLimit
      || metrics.expectedSampleCount !== attempt.expectedSampleCount
      || metrics.extractedObservationCount !== attempt.extractedObservationCount
      || stableHash(metrics.samplingCoverage) !== stableHash(attempt.samplingCoverage)) {
      throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    }
  }
  if (value.layoutGate !== null && value.qualityGate === null) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  if (!extractionAttemptHashesAreValid(value as HumanAssistedExtractionAttempt)) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_HASH_INVALID");
  }
}

export function validateHumanAssistedAmazonRun(input: unknown): HumanAssistedRunValidation {
  if (!isRecord(input)) throw new Error("HUMAN_ASSISTED_RUN_INVALID");
  if (input.schemaVersion !== "human-assisted-amazon-run.v1"
    && input.schemaVersion !== "human-assisted-amazon-run.v2") {
    throw new Error("HUMAN_ASSISTED_RUN_VERSION_INVALID");
  }
  if (!(["completed", "failed", "cancelled", "timed_out"] as unknown[]).includes(input.status)
    || !(input.errorCode === null || typeof input.errorCode === "string")
    || typeof input.collectorVersion !== "string"
    || typeof input.capturedAt !== "string"
    || typeof input.explicitTriggerConfirmed !== "boolean"
    || !nonNegativeIntegerOrNull(input.pageReadCount)
    || input.pageReadCount === null
    || input.paginationNavigationCount !== 0
    || input.detailNavigationCount !== 0
    || input.sensitiveBrowserDataStored !== false
    || input.formalCandidateGenerated !== false
    || input.productionDatabaseWritten !== false) {
    throw new Error(input.schemaVersion === "human-assisted-amazon-run.v2"
      ? "HUMAN_ASSISTED_RUN_V2_INVALID"
      : "HUMAN_ASSISTED_RUN_V1_INVALID");
  }
  if (input.schemaVersion === "human-assisted-amazon-run.v1") {
    return { evidenceStatus: "historical_evidence_insufficient", run: input };
  }
  assertV2ExtractionAttempt(input.extractionAttempt);
  const attempt = input.extractionAttempt;
  if (!validDiagnostic(input.diagnostic)
    || !validEnvironmentGate(input.environmentGate)
    || !validSourceAdapter(input.sourceAdapter)
    || !validCleanup(input.cleanup)
    || attempt.collectorVersion !== input.collectorVersion) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  if (input.status === "completed") {
    if (input.errorCode !== null || input.sourceAdapter === null || input.cleanup === null) {
      throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
    }
  } else if (input.sourceAdapter !== null) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_INVALID");
  }
  const diagnosticHash = isRecord(input.diagnostic) && typeof input.diagnostic.evidenceHash === "string"
    ? input.diagnostic.evidenceHash
    : null;
  const environmentHash = isRecord(input.environmentGate)
    ? stableHash(input.environmentGate)
    : null;
  if (attempt.diagnosticEvidenceHash !== diagnosticHash || attempt.environmentGateHash !== environmentHash) {
    throw new Error("HUMAN_ASSISTED_RUN_V2_HASH_INVALID");
  }
  return { evidenceStatus: "complete", run: input };
}
