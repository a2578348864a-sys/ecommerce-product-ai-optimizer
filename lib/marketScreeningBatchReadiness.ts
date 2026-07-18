import type {
  MarketScreeningArtifactKey,
  MarketScreeningBatchManifest,
} from "@/lib/marketScreeningBatchManifest";

export type ArtifactValidationState =
  | "verified"
  | "not_declared"
  | "missing"
  | "pending"
  | "schema_invalid"
  | "hash_mismatch"
  | "identity_conflict"
  | "path_invalid";

export type BatchReadinessStatus =
  | "blocked"
  | "upstream_only"
  | "ready_partial"
  | "ready_full";

export type BatchReadinessReasonCode =
  | "manifest_invalid"
  | "upstream_artifact_missing"
  | "stage_artifact_not_ready"
  | "presentation_artifact_not_ready"
  | "artifact_path_invalid"
  | "artifact_hash_mismatch"
  | "artifact_schema_invalid"
  | "artifact_identity_conflict"
  | "required_source_failed"
  | "partial_source_gate_failed"
  | "detail_evidence_not_attached"
  | "detail_evidence_group_incomplete";

type BatchReadinessBase = {
  reasonCodes: BatchReadinessReasonCode[];
  artifactStates: Record<MarketScreeningArtifactKey, ArtifactValidationState>;
  successfulSourceIds: string[];
  failedSourceIds: string[];
  pendingSourceIds: string[];
  includedSourceBatchIds: string[];
  acceptedUniqueProductCount: number;
  stage1InputCount: number;
  stage15PartitionCount: number;
  optionalDetailStatus: "verified" | "not_attached" | "incomplete_omitted";
};

export type BatchReadiness = BatchReadinessBase & (
  | { status: "blocked" }
  | { status: "upstream_only" }
  | { status: "ready_partial" }
  | { status: "ready_full" }
);

export const MARKET_SCREENING_ARTIFACT_KEYS: readonly MarketScreeningArtifactKey[] = [
  "selectionBrief",
  "collectionRun",
  "sourceAdapterResult",
  "importPackage",
  "stage1BlindReviewMaterial",
  "stage1Ranking",
  "stage1Summary",
  "stage15Run",
  "stage15Acceptance",
  "stage15GenerationSummary",
  "visualPresentationInput",
  "visualPacket",
  "visualGenerationSummary",
  "detailBrief",
  "detailBriefGenerationSummary",
  "detailAuthorization",
  "detailRun",
  "detailGenerationSummary",
] as const;

const CONTRADICTION_REASON: Partial<Record<ArtifactValidationState, BatchReadinessReasonCode>> = {
  path_invalid: "artifact_path_invalid",
  hash_mismatch: "artifact_hash_mismatch",
  schema_invalid: "artifact_schema_invalid",
  identity_conflict: "artifact_identity_conflict",
};

function normalized(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function equalSets(left: readonly string[], right: readonly string[]) {
  const a = normalized(left);
  const b = normalized(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function missingOrPending(state: ArtifactValidationState) {
  return state === "missing" || state === "pending" || state === "not_declared";
}

export function determineMarketScreeningBatchReadiness(input: {
  manifest: MarketScreeningBatchManifest;
  artifactStates: Partial<Record<MarketScreeningArtifactKey, ArtifactValidationState>>;
  successfulSourceIds: string[];
  failedSourceIds: string[];
  pendingSourceIds: string[];
  includedSourceBatchIds: string[];
  acceptedUniqueProductCount: number;
  stage1InputCount: number;
  stage15PartitionCount: number;
}): BatchReadiness {
  const artifactStates = Object.fromEntries(MARKET_SCREENING_ARTIFACT_KEYS.map((key) => [
    key,
    input.artifactStates[key] ?? "not_declared",
  ])) as Record<MarketScreeningArtifactKey, ArtifactValidationState>;
  const successfulSourceIds = normalized(input.successfulSourceIds);
  const failedSourceIds = normalized(input.failedSourceIds);
  const pendingSourceIds = normalized(input.pendingSourceIds);
  const includedSourceBatchIds = normalized(input.includedSourceBatchIds);

  const detailRefs = input.manifest.artifacts.filter((artifact) => artifact.requirementLevel === "optional_detail");
  const detailStates = detailRefs.map((artifact) => artifactStates[artifact.key]);
  const optionalDetailStatus = detailRefs.length === 0
    ? "not_attached" as const
    : detailStates.every((state) => state === "verified")
      ? "verified" as const
      : "incomplete_omitted" as const;
  const detailReasons: BatchReadinessReasonCode[] = optionalDetailStatus === "not_attached"
    ? ["detail_evidence_not_attached"]
    : optionalDetailStatus === "incomplete_omitted"
      ? ["detail_evidence_group_incomplete"]
      : [];

  const base = {
    artifactStates,
    successfulSourceIds,
    failedSourceIds,
    pendingSourceIds,
    includedSourceBatchIds,
    acceptedUniqueProductCount: input.acceptedUniqueProductCount,
    stage1InputCount: input.stage1InputCount,
    stage15PartitionCount: input.stage15PartitionCount,
    optionalDetailStatus,
  };

  for (const key of MARKET_SCREENING_ARTIFACT_KEYS) {
    const reason = CONTRADICTION_REASON[artifactStates[key]];
    if (reason) return { ...base, status: "blocked", reasonCodes: [reason] };
  }

  const upstreamRefs = input.manifest.artifacts.filter((artifact) => artifact.requirementLevel === "upstream_required");
  if (upstreamRefs.some((artifact) => missingOrPending(artifactStates[artifact.key]))) {
    return { ...base, status: "blocked", reasonCodes: ["upstream_artifact_missing"] };
  }

  const requiredSources = new Set(input.manifest.sourcePolicy.requiredSourceIds);
  if ([...failedSourceIds, ...pendingSourceIds].some((sourceId) => requiredSources.has(sourceId))
    || [...requiredSources].some((sourceId) => !successfulSourceIds.includes(sourceId))) {
    return { ...base, status: "blocked", reasonCodes: ["required_source_failed"] };
  }

  const stageRefs = input.manifest.artifacts.filter((artifact) => artifact.requirementLevel === "stage_required");
  if (stageRefs.some((artifact) => missingOrPending(artifactStates[artifact.key]))) {
    return { ...base, status: "upstream_only", reasonCodes: ["stage_artifact_not_ready"] };
  }

  const presentationRefs = input.manifest.artifacts.filter((artifact) => artifact.requirementLevel === "presentation_required");
  if (presentationRefs.some((artifact) => missingOrPending(artifactStates[artifact.key]))) {
    return { ...base, status: "upstream_only", reasonCodes: ["presentation_artifact_not_ready"] };
  }

  const sourceIncomplete = failedSourceIds.length > 0 || pendingSourceIds.length > 0;
  const frozenCountGatePassed = input.acceptedUniqueProductCount === input.manifest.expectedCounts.acceptedUniqueProductCount
    && input.stage1InputCount === input.manifest.expectedCounts.stage1InputCount
    && input.stage15PartitionCount === input.manifest.expectedCounts.stage15.total;
  const allowedIncompleteIds = new Set(input.manifest.sourcePolicy.optionalSourceIds);
  const partialGatePassed = input.manifest.sourcePolicy.allowStageOutputsWhenPartial
    && [...failedSourceIds, ...pendingSourceIds].every((sourceId) => allowedIncompleteIds.has(sourceId))
    && successfulSourceIds.length >= input.manifest.sourcePolicy.minimumSuccessfulSourceCount
    && input.acceptedUniqueProductCount >= input.manifest.sourcePolicy.minimumStage1InputCount
    && input.stage1InputCount >= input.manifest.sourcePolicy.minimumStage1InputCount
    && input.stage15PartitionCount === input.manifest.expectedCounts.stage15.total
    && equalSets(includedSourceBatchIds, input.manifest.identities.sourceBatchIds);

  if (!frozenCountGatePassed
    || successfulSourceIds.length < input.manifest.sourcePolicy.minimumSuccessfulSourceCount
    || (sourceIncomplete && !partialGatePassed)
    || (!sourceIncomplete && !equalSets(includedSourceBatchIds, input.manifest.identities.sourceBatchIds))) {
    return { ...base, status: "blocked", reasonCodes: ["partial_source_gate_failed"] };
  }

  return {
    ...base,
    status: sourceIncomplete ? "ready_partial" : "ready_full",
    reasonCodes: detailReasons,
  };
}
