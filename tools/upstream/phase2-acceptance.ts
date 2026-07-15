import type { FixturePipelineResult } from "../../lib/upstream/pipeline";
import { buildSourceIndependentPipeline, stableHash } from "../../lib/upstream/pipeline";
import {
  validateHumanAssistedAmazonRun,
  type HumanAssistedAmazonRunResult,
} from "../collectors/amazon/human-assisted";

const EXCLUDED_PROOF = [
  "api_integration",
  "database_transaction",
  "database_concurrency",
  "owner_visitor_authorization",
  "id_guessing_protection",
] as const;

type AcceptanceInput = {
  sourceRunSchemaVersion: string;
  sourceInputHash: string;
  sourceEvidenceHash: string;
  evaluatedAt: string;
  pipeline: FixturePipelineResult;
  formalCandidateGenerated: boolean;
  productionDatabaseWritten: boolean;
};

type AcceptanceCriteria = {
  contextQualityPassed: boolean;
  layoutQualityPassed: boolean;
  deterministicPipelineReplayMatched: boolean;
  storedPipelineMatchesReplay: boolean;
  identityCountsConsistent: boolean;
  quarantinedObservationsExcludedFromImport: boolean;
  evidenceTraceabilityComplete: boolean;
  evidenceFreshnessExplicit: boolean;
  formalCandidateNotGenerated: boolean;
  productionDatabaseNotWritten: boolean;
};

type AcceptanceReportBody = {
  schemaVersion: "phase2-acceptance-report.v1";
  status: "passed" | "failed";
  proofLevel: "pure_function_fixture_real_package_in_memory";
  sourceRunSchemaVersion: string;
  sourceInputHash: string;
  sourceEvidenceHash: string;
  evaluatedAt: string;
  collectionRunId: string;
  briefId: string;
  importPackageHash: string;
  counts: {
    rawObservationCount: number;
    uniqueProductCount: number;
    quarantinedCount: number;
    importPreviewCandidateCount: number;
  };
  criteria: AcceptanceCriteria;
  reasonCodes: string[];
  excludedProof: typeof EXCLUDED_PROOF;
};

export type Phase2AcceptanceReport = AcceptanceReportBody & { evidenceHash: string };

function observationDrafts(pipeline: FixturePipelineResult) {
  return pipeline.rawObservations.map((observation) => {
    const {
      schemaVersion: _schemaVersion,
      collectionRunId: _collectionRunId,
      marketplace: _marketplace,
      market: _market,
      sourceUrl: _sourceUrl,
      capturedAt: _capturedAt,
      contentHash: _contentHash,
      status: _status,
      errorCode: _errorCode,
      ...draft
    } = observation;
    void _schemaVersion;
    void _collectionRunId;
    void _marketplace;
    void _market;
    void _sourceUrl;
    void _capturedAt;
    void _contentHash;
    void _status;
    void _errorCode;
    return draft;
  });
}

function replayPipeline(pipeline: FixturePipelineResult) {
  return buildSourceIndependentPipeline({
    schemaVersion: "raw-observation-batch.v1",
    brief: pipeline.brief,
    run: pipeline.run,
    observations: observationDrafts(pipeline),
  });
}

function identityCountsConsistent(pipeline: FixturePipelineResult) {
  const productKeys = pipeline.importPackage.candidates.map((candidate) => candidate.productKey);
  const expectedUnique = new Set(pipeline.rawObservations
    .filter((observation) => observation.status !== "quarantined" && observation.asin !== null)
    .map((observation) => observation.asin!.trim().toUpperCase())).size;
  return pipeline.rawObservationCount === pipeline.rawObservations.length
    && pipeline.uniqueProductCount === pipeline.importPackage.candidates.length
    && pipeline.quarantined.length === pipeline.metrics.quarantinedCount
    && new Set(productKeys).size === productKeys.length
    && expectedUnique === pipeline.uniqueProductCount;
}

function quarantinedExcludedFromImport(pipeline: FixturePipelineResult) {
  const importedAppearances = new Set(pipeline.importPackage.candidates.flatMap((candidate) => candidate.appearanceKeys));
  return pipeline.quarantined.every(({ observation }) => !importedAppearances.has(observation.appearanceKey));
}

function evidenceTraceabilityComplete(pipeline: FixturePipelineResult) {
  return pipeline.importPackage.candidates.every((candidate) => {
    const evidence = candidate.evidenceSnapshot;
    const pack = candidate.minimumEvidencePack;
    return candidate.importBatchId === pipeline.importPackage.importBatchId
      && evidence.importBatchId === candidate.importBatchId
      && pack.importBatchId === candidate.importBatchId
      && evidence.productKey === candidate.productKey
      && evidence.product.productKey === candidate.productKey
      && pack.productKey === candidate.productKey
      && pack.evidenceSnapshotId === evidence.evidenceSnapshotId
      && evidence.collectionRunId === pipeline.run.collectionRunId
      && evidence.product.collectionRunId === pipeline.run.collectionRunId
      && evidence.product.variantGroupKey === candidate.variantGroupKey
      && evidence.inputHash === evidence.product.inputHash
      && evidence.sourceUrl.length > 0
      && evidence.capturedAt.length > 0
      && evidence.sourceTypes.includes("direct_observation");
  });
}

function evidenceFreshnessExplicit(pipeline: FixturePipelineResult) {
  const allowed = new Set(["fresh", "stale", "unknown"]);
  return pipeline.importPackage.candidates.every((candidate) => allowed.has(candidate.evidenceSnapshot.freshness));
}

function reasonCodes(criteria: AcceptanceCriteria) {
  return [
    criteria.contextQualityPassed ? null : "context_quality_failed",
    criteria.layoutQualityPassed ? null : "layout_quality_failed",
    criteria.deterministicPipelineReplayMatched ? null : "deterministic_pipeline_replay_mismatch",
    criteria.storedPipelineMatchesReplay ? null : "stored_pipeline_replay_mismatch",
    criteria.identityCountsConsistent ? null : "identity_counts_inconsistent",
    criteria.quarantinedObservationsExcludedFromImport ? null : "quarantined_observation_imported",
    criteria.evidenceTraceabilityComplete ? null : "evidence_traceability_incomplete",
    criteria.evidenceFreshnessExplicit ? null : "evidence_freshness_not_explicit",
    criteria.formalCandidateNotGenerated ? null : "formal_candidate_generated",
    criteria.productionDatabaseNotWritten ? null : "production_database_written",
  ].filter((code): code is string => code !== null).sort();
}

function validIsoTime(value: string) {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

export function buildPhase2AcceptanceReport(input: AcceptanceInput): Phase2AcceptanceReport {
  if (!input.sourceRunSchemaVersion || !/^[a-f0-9]{64}$/i.test(input.sourceInputHash)
    || !/^[a-f0-9]{64}$/i.test(input.sourceEvidenceHash) || !validIsoTime(input.evaluatedAt)) {
    throw new Error("PHASE2_ACCEPTANCE_INPUT_INVALID");
  }
  const firstReplay = replayPipeline(input.pipeline);
  const secondReplay = replayPipeline(input.pipeline);
  const criteria: AcceptanceCriteria = {
    contextQualityPassed: input.pipeline.contextGate.status === "passed",
    layoutQualityPassed: input.pipeline.layoutGate.status === "passed",
    deterministicPipelineReplayMatched: stableHash(firstReplay) === stableHash(secondReplay),
    storedPipelineMatchesReplay: stableHash(input.pipeline) === stableHash(firstReplay),
    identityCountsConsistent: identityCountsConsistent(input.pipeline),
    quarantinedObservationsExcludedFromImport: quarantinedExcludedFromImport(input.pipeline),
    evidenceTraceabilityComplete: evidenceTraceabilityComplete(input.pipeline),
    evidenceFreshnessExplicit: evidenceFreshnessExplicit(input.pipeline),
    formalCandidateNotGenerated: input.formalCandidateGenerated === false,
    productionDatabaseNotWritten: input.productionDatabaseWritten === false,
  };
  const failures = reasonCodes(criteria);
  const body: AcceptanceReportBody = {
    schemaVersion: "phase2-acceptance-report.v1",
    status: failures.length === 0 ? "passed" : "failed",
    proofLevel: "pure_function_fixture_real_package_in_memory",
    sourceRunSchemaVersion: input.sourceRunSchemaVersion,
    sourceInputHash: input.sourceInputHash,
    sourceEvidenceHash: input.sourceEvidenceHash,
    evaluatedAt: input.evaluatedAt,
    collectionRunId: input.pipeline.run.collectionRunId,
    briefId: input.pipeline.brief.briefId,
    importPackageHash: input.pipeline.importPackage.importPackageHash,
    counts: {
      rawObservationCount: input.pipeline.rawObservationCount,
      uniqueProductCount: input.pipeline.uniqueProductCount,
      quarantinedCount: input.pipeline.quarantined.length,
      importPreviewCandidateCount: input.pipeline.importPackage.candidates.length,
    },
    criteria,
    reasonCodes: failures,
    excludedProof: EXCLUDED_PROOF,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function phase2AcceptanceReportHashIsValid(report: Phase2AcceptanceReport) {
  const { evidenceHash, ...body } = report;
  return /^[a-f0-9]{64}$/i.test(evidenceHash) && stableHash(body) === evidenceHash;
}

export function buildPhase2AcceptanceReportFromHumanAssistedRun(
  input: unknown,
  evaluatedAt: string,
): Phase2AcceptanceReport {
  const validation = validateHumanAssistedAmazonRun(input);
  if (validation.evidenceStatus !== "complete") throw new Error("PHASE2_SOURCE_EVIDENCE_INCOMPLETE");
  const run = validation.run as unknown as HumanAssistedAmazonRunResult;
  if (run.status !== "completed" || run.sourceAdapter?.pipeline === null || !run.sourceAdapter?.pipeline) {
    throw new Error("PHASE2_SOURCE_RUN_NOT_COMPLETED");
  }
  return buildPhase2AcceptanceReport({
    sourceRunSchemaVersion: run.schemaVersion,
    sourceInputHash: run.sourceAdapter.sourceInputHash,
    sourceEvidenceHash: stableHash(run),
    evaluatedAt,
    pipeline: run.sourceAdapter.pipeline,
    formalCandidateGenerated: run.formalCandidateGenerated,
    productionDatabaseWritten: run.productionDatabaseWritten,
  });
}
