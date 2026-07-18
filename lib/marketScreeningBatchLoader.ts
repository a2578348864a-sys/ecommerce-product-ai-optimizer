import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  loadMarketScreeningBatchManifest,
  type ManifestErrorCode,
  type MarketScreeningArtifactKey,
  type MarketScreeningArtifactRef,
  type MarketScreeningBatchManifest,
  type MarketScreeningEnvironment,
  type ProductionBatchRegistration,
} from "@/lib/marketScreeningBatchManifest";
import {
  determineMarketScreeningBatchReadiness,
  MARKET_SCREENING_ARTIFACT_KEYS,
  type ArtifactValidationState,
  type BatchReadiness,
} from "@/lib/marketScreeningBatchReadiness";
import { stableHash } from "@/lib/upstream/pipeline";

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

export type MarketScreeningBatchErrorCode =
  | ManifestErrorCode
  | "artifact_path_invalid"
  | "artifact_hash_mismatch"
  | "artifact_schema_invalid"
  | "artifact_identity_conflict"
  | "upstream_artifact_missing";

export const MANIFEST_TO_BATCH_ERROR_CODE = {
  batch_manifest_not_configured: "batch_manifest_not_configured",
  batch_manifest_missing: "batch_manifest_missing",
  batch_manifest_sidecar_invalid: "batch_manifest_sidecar_invalid",
  batch_manifest_hash_mismatch: "batch_manifest_hash_mismatch",
  batch_manifest_schema_invalid: "batch_manifest_schema_invalid",
  batch_manifest_path_invalid: "batch_manifest_path_invalid",
} as const satisfies Record<ManifestErrorCode, MarketScreeningBatchErrorCode>;

export function mapManifestErrorCode(code: ManifestErrorCode): MarketScreeningBatchErrorCode {
  return MANIFEST_TO_BATCH_ERROR_CODE[code];
}

export type VerifiedArtifactValue = Readonly<Record<string, unknown>>;

export type VerifiedUpstreamBatch = {
  manifest: MarketScreeningBatchManifest;
  artifacts: Partial<Record<MarketScreeningArtifactKey, VerifiedArtifactValue>>;
  batchReadiness: BatchReadiness & { status: "upstream_only" };
};

export type VerifiedMarketScreeningBatch = {
  manifest: MarketScreeningBatchManifest;
  artifacts: Partial<Record<MarketScreeningArtifactKey, VerifiedArtifactValue>>;
  batchReadiness: BatchReadiness & { status: "ready_full" | "ready_partial" };
};

export type MarketScreeningBatchLoadResult =
  | { status: "ready"; batch: VerifiedMarketScreeningBatch }
  | { status: "upstream_only"; upstream: VerifiedUpstreamBatch }
  | {
      status: "blocked";
      batchReadiness: BatchReadiness & { status: "blocked" };
      errorCode: MarketScreeningBatchErrorCode;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isContained(root: string, candidate: string) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function allStates(state: ArtifactValidationState) {
  return Object.fromEntries(MARKET_SCREENING_ARTIFACT_KEYS.map((key) => [key, state])) as Record<
    MarketScreeningArtifactKey,
    ArtifactValidationState
  >;
}

function blockedWithoutManifest(): BatchReadiness & { status: "blocked" } {
  return {
    status: "blocked",
    reasonCodes: ["manifest_invalid"],
    artifactStates: allStates("not_declared"),
    successfulSourceIds: [],
    failedSourceIds: [],
    pendingSourceIds: [],
    includedSourceBatchIds: [],
    acceptedUniqueProductCount: 0,
    stage1InputCount: 0,
    stage15PartitionCount: 0,
    optionalDetailStatus: "not_attached",
  };
}

function pointerValue(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current: unknown = value;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/u.test(token)) return undefined;
      current = current[Number(token)];
    } else if (isRecord(current)) {
      current = current[token];
    } else {
      return undefined;
    }
  }
  return current;
}

type FileReadResult =
  | { status: "ready"; container: Record<string, unknown> }
  | { status: "missing" }
  | { status: "invalid"; state: ArtifactValidationState; errorCode: MarketScreeningBatchErrorCode };

function readContainer(
  projectRoot: string,
  ref: MarketScreeningArtifactRef,
): FileReadResult {
  const target = resolve(projectRoot, ref.relativePath);
  if (!isContained(projectRoot, target)) {
    return { status: "invalid", state: "path_invalid", errorCode: "artifact_path_invalid" };
  }
  let actual: string;
  try {
    if (lstatSync(target).isSymbolicLink()) {
      return { status: "invalid", state: "path_invalid", errorCode: "artifact_path_invalid" };
    }
    actual = realpathSync(target);
  } catch {
    return { status: "missing" };
  }
  if (!isContained(projectRoot, actual)) {
    return { status: "invalid", state: "path_invalid", errorCode: "artifact_path_invalid" };
  }
  const stat = statSync(actual);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) {
    return { status: "invalid", state: "schema_invalid", errorCode: "artifact_schema_invalid" };
  }
  const bytes = readFileSync(actual);
  if (createHash("sha256").update(bytes).digest("hex") !== ref.fileSha256) {
    return { status: "invalid", state: "hash_mismatch", errorCode: "artifact_hash_mismatch" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { status: "invalid", state: "schema_invalid", errorCode: "artifact_schema_invalid" };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== ref.containerSchemaVersion) {
    return { status: "invalid", state: "schema_invalid", errorCode: "artifact_schema_invalid" };
  }
  return { status: "ready", container: parsed };
}

function validateArtifact(
  ref: MarketScreeningArtifactRef,
  container: Record<string, unknown>,
): { status: "ready"; value: VerifiedArtifactValue } | {
  status: "invalid";
  state: ArtifactValidationState;
  errorCode: MarketScreeningBatchErrorCode;
} {
  const selected = pointerValue(container, ref.jsonPointer);
  if (!isRecord(selected) || selected.schemaVersion !== ref.artifactSchemaVersion) {
    return { status: "invalid", state: "schema_invalid", errorCode: "artifact_schema_invalid" };
  }
  for (const assertion of ref.bindingAssertions) {
    if (!Object.is(pointerValue(selected, assertion.jsonPointer), assertion.equals)) {
      return { status: "invalid", state: "identity_conflict", errorCode: "artifact_identity_conflict" };
    }
  }
  return { status: "ready", value: selected };
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordArray(value: unknown): Record<string, unknown>[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

function exactStringSet(values: Array<string | null>): string[] | null {
  if (values.some((value) => value === null)) return null;
  const strings = values as string[];
  const normalized = [...new Set(strings)].sort();
  return normalized.length === strings.length ? normalized : null;
}

function sameStrings(left: string[] | null, right: string[] | null): boolean {
  return left !== null
    && right !== null
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function productIdentitySet(value: unknown): string[] | null {
  const values = recordArray(value);
  if (!values) return null;
  return exactStringSet(values.map((item) => {
    const candidateId = stringValue(item.candidateId);
    const productKey = stringValue(item.productKey);
    return candidateId && productKey ? `${candidateId}\u0000${productKey}` : null;
  }));
}

function stage15AsinSet(value: unknown): string[] | null {
  const values = recordArray(value);
  if (!values) return null;
  return exactStringSet(values.map((item) => {
    const productKey = stringValue(item.productKey);
    return productKey ? /^amazon:[^:]+:([A-Z0-9]{10})$/u.exec(productKey)?.[1] ?? null : null;
  }));
}

function detailBriefAsinSet(value: unknown): string[] | null {
  const values = recordArray(value);
  if (!values) return null;
  return exactStringSet(values.map((target) => {
    const safePath = stringValue(target.safePath);
    return safePath ? /^\/dp\/([A-Z0-9]{10})$/u.exec(safePath)?.[1] ?? null : null;
  }));
}

function detailRunAsinSet(value: unknown): string[] | null {
  const values = recordArray(value);
  if (!values) return null;
  return exactStringSet(values.map((page) => {
    const asin = stringValue(page.expectedAsin);
    return asin && /^[A-Z0-9]{10}$/u.test(asin) ? asin : null;
  }));
}

function isExplicitlyPending(value: VerifiedArtifactValue): boolean {
  return value.status === "pending"
    || value.status === "not_started"
    || value.status === "pending_generation";
}

function crossArtifactConflict(
  manifest: MarketScreeningBatchManifest,
  artifacts: Partial<Record<MarketScreeningArtifactKey, VerifiedArtifactValue>>,
): MarketScreeningArtifactKey | null {
  const importPackage = artifacts.importPackage;
  const ranking = artifacts.stage1Ranking;
  const stage15 = artifacts.stage15Run;
  const blind = artifacts.stage1BlindReviewMaterial;
  const visualInput = artifacts.visualPresentationInput;
  const visualPacket = artifacts.visualPacket;
  const visualSummary = artifacts.visualGenerationSummary;
  const detailBrief = artifacts.detailBrief;
  const detailRun = artifacts.detailRun;

  if (importPackage && ranking) {
    const imported = productIdentitySet(importPackage.candidates);
    const ranked = productIdentitySet(ranking.results);
    if (!sameStrings(imported, ranked)) return "stage1Ranking";
  }
  if (ranking && stage15) {
    const ranked = productIdentitySet(ranking.results);
    const screened = productIdentitySet(stage15.items);
    if (!sameStrings(ranked, screened)) return "stage15Run";
  }
  if (importPackage && Array.isArray(importPackage.candidates)
    && importPackage.candidates.length !== manifest.expectedCounts.acceptedUniqueProductCount) return "importPackage";
  if (ranking && Array.isArray(ranking.results)
    && ranking.results.length !== manifest.expectedCounts.stage1InputCount) return "stage1Ranking";
  if (stage15) {
    const items = recordArray(stage15.items);
    const summary = isRecord(stage15.summary) ? stage15.summary : null;
    const expected = manifest.expectedCounts.stage15;
    if (!items || items.length !== expected.total || !summary
      || summary.advance !== expected.advance
      || summary.watch !== expected.watch
      || summary.reject !== expected.reject
      || summary.insufficient !== expected.insufficient) return "stage15Run";
  }
  if (blind && visualPacket && stableHash(blind) !== visualPacket.sourceEvidenceHash) return "visualPacket";
  if (visualInput && visualPacket
    && (visualInput.sourceBlindReviewId !== visualPacket.sourceBlindReviewId
      || visualInput.sourceVisualEvidenceHash !== visualPacket.sourceVisualEvidenceHash)) return "visualPacket";
  if (visualSummary && visualPacket
    && (visualSummary.sourceBlindReviewId !== visualPacket.sourceBlindReviewId
      || visualSummary.sourceEvidenceHash !== visualPacket.sourceEvidenceHash
      || visualSummary.sourceVisualEvidenceHash !== visualPacket.sourceVisualEvidenceHash
      || visualSummary.packetHash !== visualPacket.packetHash)) return "visualGenerationSummary";

  if (stage15 && detailBrief) {
    const stageAsins = stage15AsinSet(stage15.items);
    const briefAsins = detailBriefAsinSet(detailBrief.targets);
    if (stageAsins === null || briefAsins === null
      || !briefAsins.every((asin) => stageAsins.includes(asin))) return "detailBrief";
  }
  if (detailBrief && detailRun) {
    const briefAsins = detailBriefAsinSet(detailBrief.targets);
    const runAsins = detailRunAsinSet(detailRun.pages);
    if (!sameStrings(briefAsins, runAsins)) return "detailRun";
  }
  return null;
}

export function loadMarketScreeningBatch(options: {
  environment: MarketScreeningEnvironment;
  projectMaterialsRoot: string;
  testManifestPath?: string;
  productionRegistration?: ProductionBatchRegistration;
}): MarketScreeningBatchLoadResult {
  const manifestResult = loadMarketScreeningBatchManifest(options);
  if (manifestResult.status === "unavailable") {
    return {
      status: "blocked",
      batchReadiness: blockedWithoutManifest(),
      errorCode: mapManifestErrorCode(manifestResult.errorCode),
    };
  }

  let projectRoot: string;
  try {
    projectRoot = realpathSync(resolve(options.projectMaterialsRoot));
  } catch {
    return {
      status: "blocked",
      batchReadiness: blockedWithoutManifest(),
      errorCode: "batch_manifest_path_invalid",
    };
  }
  const manifest = manifestResult.manifest;
  const artifactStates = allStates("not_declared");
  const artifacts: Partial<Record<MarketScreeningArtifactKey, VerifiedArtifactValue>> = {};
  const cache = new Map<string, FileReadResult>();
  let firstError: MarketScreeningBatchErrorCode | null = null;

  for (const ref of manifest.artifacts) {
    const containerResult = cache.get(ref.relativePath) ?? readContainer(projectRoot, ref);
    cache.set(ref.relativePath, containerResult);
    if (containerResult.status === "missing") {
      artifactStates[ref.key] = "missing";
      continue;
    }
    if (containerResult.status === "invalid") {
      artifactStates[ref.key] = containerResult.state;
      firstError ??= containerResult.errorCode;
      continue;
    }
    const artifactResult = validateArtifact(ref, containerResult.container);
    if (artifactResult.status === "invalid") {
      artifactStates[ref.key] = artifactResult.state;
      firstError ??= artifactResult.errorCode;
      continue;
    }
    if ((ref.requirementLevel === "stage_required" || ref.requirementLevel === "presentation_required")
      && isExplicitlyPending(artifactResult.value)) {
      artifactStates[ref.key] = "pending";
      continue;
    }
    artifactStates[ref.key] = "verified";
    artifacts[ref.key] = artifactResult.value;
  }

  const crossConflict = crossArtifactConflict(manifest, artifacts);
  if (crossConflict) {
    artifactStates[crossConflict] = "identity_conflict";
    firstError ??= "artifact_identity_conflict";
  }

  const sourceAdapter = artifacts.sourceAdapterResult;
  const ranking = artifacts.stage1Ranking;
  const stage15 = artifacts.stage15Run;
  const sourceType = stringValue(sourceAdapter?.sourceType);
  const sourceBatchId = stringValue(stage15?.sourceBatchId);
  const stage15Summary = isRecord(stage15?.summary) ? stage15.summary : {};
  const stage15PartitionCount = ["advance", "watch", "reject", "insufficient"]
    .reduce((sum, key) => sum + numberValue(stage15Summary[key]), 0);
  const readiness = determineMarketScreeningBatchReadiness({
    manifest,
    artifactStates,
    successfulSourceIds: sourceType && sourceAdapter?.qualitySummary
      && isRecord(sourceAdapter.qualitySummary) && sourceAdapter.qualitySummary.status === "passed"
      ? [sourceType]
      : [],
    failedSourceIds: [],
    pendingSourceIds: [],
    includedSourceBatchIds: sourceBatchId ? [sourceBatchId] : manifest.identities.sourceBatchIds,
    acceptedUniqueProductCount: numberValue(sourceAdapter?.acceptedCount),
    stage1InputCount: arrayLength(ranking?.results),
    stage15PartitionCount,
  });

  if (readiness.optionalDetailStatus !== "verified") {
    for (const ref of manifest.artifacts) {
      if (ref.requirementLevel === "optional_detail") delete artifacts[ref.key];
    }
  }

  if (readiness.status === "blocked") {
    return {
      status: "blocked",
      batchReadiness: readiness,
      errorCode: firstError ?? (readiness.reasonCodes.includes("upstream_artifact_missing")
        ? "upstream_artifact_missing"
        : "artifact_identity_conflict"),
    };
  }
  if (readiness.status === "upstream_only") {
    return {
      status: "upstream_only",
      upstream: { manifest, artifacts, batchReadiness: readiness },
    };
  }
  return {
    status: "ready",
    batch: { manifest, artifacts, batchReadiness: readiness },
  };
}
