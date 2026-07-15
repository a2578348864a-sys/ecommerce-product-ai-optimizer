import { buildFixturePipeline, stableHash } from "./pipeline";
import { buildBlindReviewMaterial, calibrateStage2, rankStage1 } from "./ranking";
import { adaptFixtureSource, adaptJsonSource } from "./sourceAdapters";

export function buildFixtureArtifacts(fixture: unknown) {
  const fixtureSource = adaptFixtureSource(fixture);
  const jsonSource = adaptJsonSource(JSON.stringify(fixture));
  const pipeline = fixtureSource.pipeline ?? buildFixturePipeline(fixture);
  const stage1 = rankStage1(pipeline.importPackage, pipeline.brief.createdAt);
  const blindReview = buildBlindReviewMaterial(pipeline.importPackage, "blind-amazon-us-closet-organizer-fixture-v1");
  const ranked = stage1.results.filter((item) => item.rank !== null).sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0));
  const insufficient = stage1.results.find((item) => item.promotionDecision === "insufficient_evidence");
  if (ranked.length < 3 || !insufficient) throw new Error("FIXTURE_CALIBRATION_BUCKETS_INCOMPLETE");

  const samples = [
    { sampleBucket: "high_rank" as const, result: ranked[0] },
    { sampleBucket: "middle_rank" as const, result: ranked[Math.floor(ranked.length / 2)] },
    { sampleBucket: "low_rank" as const, result: ranked[ranked.length - 1] },
    { sampleBucket: "insufficient_evidence" as const, result: insufficient },
  ];
  const stage2Calibration = samples.map(({ sampleBucket, result }) => {
    const candidate = pipeline.importPackage.candidates.find((item) => item.candidateId === result.candidateId);
    if (!candidate) throw new Error("FIXTURE_CANDIDATE_NOT_FOUND");
    const calibrationInput = {
      candidateId: result.candidateId,
      currency: "USD" as const,
      salePrice: candidate.evidenceSnapshot.product.price.normalizedValue,
      bom: null,
      firstMile: null,
      platformCommission: null,
      fba: null,
      packaging: null,
      storage: null,
      returnReserve: null,
    };
    return {
      sampleBucket,
      candidateId: result.candidateId,
      stage1Rank: result.rank,
      stage1Decision: result.promotionDecision,
      calibrationInput,
      calibration: calibrateStage2(calibrationInput),
      humanSupplyChainEvidenceRequired: true,
    };
  });

  const canaryCore = {
    schemaVersion: "amazon-public-page-canary-evidence.v2" as const,
    evidenceAuthority: "offline_fixture" as const,
    historicalSchemaVersion: null,
    capturedAt: pipeline.run.capturedAt,
    requested: pipeline.run.requested,
    observed: pipeline.run.observed,
    sampledObservationIds: pipeline.run.sampledObservationIds,
    diagnosticVisiblePriceNodeCount: pipeline.run.diagnosticVisiblePriceNodeCount,
    collectionRunHash: pipeline.run.contentHash,
    qualityGate: pipeline.contextGate,
    layoutGate: pipeline.layoutGate,
    metrics: pipeline.metrics,
    observations: pipeline.rawObservations,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
  };
  const canaryEvidence = { ...canaryCore, evidenceHash: stableHash(canaryCore) };

  return { fixtureSource, jsonSource, pipeline, stage1, blindReview, stage2Calibration, canaryEvidence };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildNonAuthoritativeCanaryEvidence(input: unknown) {
  const legacy = asRecord(input);
  const request = asRecord(legacy.request ?? legacy.requested);
  const observation = asRecord(legacy.observation ?? legacy.observed);
  const rawObservations = Array.isArray(legacy.observations) ? legacy.observations : [];
  const observations = rawObservations.map((item) => {
    const record = asRecord(item);
    return {
      appearanceKey: optionalString(record.appearanceKey),
      asin: optionalString(record.asin),
      priceText: optionalString(record.priceText),
      sponsored: typeof record.sponsored === "boolean" ? record.sponsored : null,
      capturedAt: optionalString(record.capturedAt),
    };
  });
  const core = {
    schemaVersion: "amazon-public-page-canary-evidence.v2" as const,
    evidenceAuthority: "non_authoritative_canary_evidence" as const,
    historicalSchemaVersion: optionalString(legacy.historicalSchemaVersion) ?? optionalString(legacy.schemaVersion),
    capturedAt: optionalString(legacy.capturedAt),
    requested: {
      marketplace: optionalString(request.marketplace) ?? optionalString(legacy.marketplace),
      market: optionalString(request.market) ?? optionalString(legacy.market),
      currency: optionalString(request.currency),
    },
    observed: {
      marketplace: optionalString(observation.marketplace),
      market: optionalString(observation.market),
      currency: optionalString(observation.currency),
      deliveryRegion: optionalString(observation.deliveryRegion),
      deliveryRegionMarket: optionalString(observation.deliveryRegionMarket),
      language: optionalString(observation.language),
    },
    sampledObservationIds: observations.map((item) => item.appearanceKey).filter((item): item is string => item !== null),
    diagnosticVisiblePriceNodeCount: null,
    collectionRunHash: null,
    qualityGate: {
      schemaVersion: "quality-gate-result.v1" as const,
      status: "failed" as const,
      errorCodes: ["requires_live_recollection"],
      missingReasons: ["legacy_canary_context_was_not_generated_by_the_v2_runtime_contract"],
    },
    layoutGate: null,
    metrics: null,
    observations,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
  };
  return { ...core, evidenceHash: stableHash(core) };
}
