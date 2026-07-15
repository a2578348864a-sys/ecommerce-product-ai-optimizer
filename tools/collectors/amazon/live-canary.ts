import type {
  CollectionRun,
  LayoutMetrics,
  RawObservation,
  SelectionBrief,
} from "../../../lib/upstream/contracts";
import {
  buildCollectionRunContentHash,
  detectLayoutChange,
  evaluateCollectionRunQuality,
  stableHash,
} from "../../../lib/upstream/pipeline";
import type { extractAmazonSearchPage } from "./extract-search-page";

export type AmazonSearchPageExtraction = ReturnType<typeof extractAmazonSearchPage>;

function parseObservedNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseObservedCount(value: string | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").trim().match(/(\d+(?:\.\d+)?)\s*([KMB])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  const multiplier = match[2]?.toUpperCase() === "K" ? 1_000
    : match[2]?.toUpperCase() === "M" ? 1_000_000
      : match[2]?.toUpperCase() === "B" ? 1_000_000_000
        : 1;
  const parsed = Math.round(base * multiplier);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function validAsin(value: string | null): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/.test(value);
}

export function buildLiveAmazonCanaryEvidence(input: {
  brief: SelectionBrief;
  extraction: AmazonSearchPageExtraction;
  collectorVersion: string;
}) {
  const { brief, extraction, collectorVersion } = input;
  if (brief.query !== extraction.query) throw new Error("CANARY_BRIEF_QUERY_MISMATCH");
  if (brief.sampleBudget.maxPages < extraction.page) throw new Error("CANARY_PAGE_BUDGET_EXCEEDED");
  if (brief.sampleBudget.maxAppearances < extraction.observations.length) {
    throw new Error("CANARY_SAMPLE_BUDGET_EXCEEDED");
  }

  const collectionRunId = `run-amazon-live-${stableHash({
    capturedAt: extraction.capturedAt,
    query: extraction.query,
    sampledObservationIds: extraction.sampledObservationIds,
  }).slice(0, 24)}`;
  const sourceUrl = `https://www.amazon.com/s?k=${encodeURIComponent(extraction.query).replace(/%20/g, "+")}`;
  const observationDrafts = extraction.observations.map((observation) => ({
    schemaVersion: "raw-observation.v1" as const,
    appearanceKey: observation.appearanceKey,
    collectionRunId,
    marketplace: "amazon.com" as const,
    market: "US" as const,
    sourceUrl,
    capturedAt: extraction.capturedAt,
    contentHash: "",
    page: observation.page,
    position: observation.position,
    sponsored: observation.sponsored,
    asin: observation.asin,
    parentAsin: null,
    title: observation.title,
    price: parseObservedNumber(observation.priceText),
    priceCurrency: observation.priceCurrency,
    rating: parseObservedNumber(observation.ratingText),
    reviewCount: parseObservedCount(observation.reviewCountText),
    brand: observation.brand,
    productUrl: observation.productUrl ?? sourceUrl,
    imageUrl: observation.imageUrl,
    identityMissingReason: observation.identityMissingReason,
    fieldMissingReasons: { ...observation.fieldMissingReasons },
    observedRiskFlags: [] as string[],
    status: validAsin(observation.asin) ? "observed" as const : "quarantined" as const,
    errorCode: validAsin(observation.asin) ? null : "missing_identity",
  }));
  const runDraft: CollectionRun = {
    schemaVersion: "collection-run.v2",
    collectionRunId,
    briefId: brief.briefId,
    requested: { ...extraction.requested },
    observed: { ...extraction.observed },
    sampledObservationIds: [...extraction.sampledObservationIds],
    diagnosticVisiblePriceNodeCount: extraction.diagnosticVisiblePriceNodeCount,
    pageStatus: extraction.pageStatus,
    sourceUrl,
    capturedAt: extraction.capturedAt,
    collectorVersion,
    status: extraction.pageStatus === "ok" ? "completed" : "blocked",
    errorCode: extraction.pageStatus === "ok" ? null : extraction.pageStatus,
    contentHash: "",
  };
  const contentHash = buildCollectionRunContentHash(runDraft, observationDrafts);
  const collectionRun = { ...runDraft, contentHash };
  const observations: RawObservation[] = observationDrafts.map((observation) => ({
    ...observation,
    contentHash: stableHash({ collectionRunHash: contentHash, observation }),
  }));
  const uniqueAsins = new Set(observations.filter((item) => validAsin(item.asin)).map((item) => item.asin));
  const expectedSampleCount = Math.min(extraction.rawCardCount, brief.sampleBudget.maxAppearances);
  const extractedObservationCount = observations.length;
  const metrics: LayoutMetrics = {
    rawCardCount: extraction.rawCardCount,
    requestedSampleLimit: brief.sampleBudget.maxAppearances,
    expectedSampleCount,
    extractedObservationCount,
    samplingCoverage: expectedSampleCount === 0
      ? { observedCount: extractedObservationCount, denominator: 0, ratio: null, missingReason: "no_expected_sample" }
      : {
        observedCount: extractedObservationCount,
        denominator: expectedSampleCount,
        ratio: extractedObservationCount / expectedSampleCount,
        missingReason: null,
      },
    identitySuccessCount: observations.filter((item) => validAsin(item.asin)).length,
    priceVisibleCount: observations.filter((item) => item.price !== null).length,
    ratingVisibleCount: observations.filter((item) => item.rating !== null).length,
    reviewVisibleCount: observations.filter((item) => item.reviewCount !== null).length,
    sponsoredKnownCount: observations.filter((item) => item.sponsored !== null).length,
    quarantinedCount: observations.filter((item) => item.status === "quarantined").length,
    uniqueProductCount: uniqueAsins.size,
    keyContainerFound: extraction.keyContainerFound,
    blockedPage: extraction.blocked,
  };
  const qualityGate = evaluateCollectionRunQuality(brief, collectionRun, observations);
  if (extractedObservationCount > expectedSampleCount) {
    qualityGate.status = "failed";
    qualityGate.errorCodes = [...new Set([
      ...qualityGate.errorCodes,
      "extracted_count_exceeds_expected_sample_count",
    ])].sort();
    qualityGate.missingReasons = [...new Set([
      ...qualityGate.missingReasons,
      "extracted_observations_exceed_page_discovery_and_sample_limit",
    ])].sort();
  }
  const layoutGate = detectLayoutChange(metrics);
  const sponsoredStates = {
    sponsored: observations.filter((item) => item.sponsored === true).length,
    organic: observations.filter((item) => item.sponsored === false).length,
    unknown: observations.filter((item) => item.sponsored === null).length,
  };
  const core = {
    schemaVersion: "amazon-public-page-canary-evidence.v2" as const,
    evidenceAuthority: "live_public_page" as const,
    collectorVersion,
    extractionSchemaVersion: extraction.schemaVersion,
    capturedAt: extraction.capturedAt,
    requested: collectionRun.requested,
    observed: collectionRun.observed,
    sampledObservationIds: collectionRun.sampledObservationIds,
    diagnosticVisiblePriceNodeCount: collectionRun.diagnosticVisiblePriceNodeCount,
    collectionRun,
    inputHash: collectionRun.contentHash,
    qualityGate,
    layoutGate,
    metrics,
    sponsoredStates,
    observations,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
  };
  return { ...core, evidenceHash: stableHash(core) };
}
