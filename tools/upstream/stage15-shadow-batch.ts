import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage15ShadowObservation } from "./stage15-shadow-calibration";

type ShadowBatchRole = "calibration" | "validation";
type ArtifactKey = "selectionBrief" | "collectionRun" | "sourceAdapterResult" | "importPackage"
  | "rankingRun" | "screeningRun" | "visualPacket" | "observations" | "detailEvidence";

export type Stage15ShadowBatchManifest = {
  schemaVersion: "stage15-shadow-batch-manifest.v1";
  batchId: string;
  role: ShadowBatchRole;
  expectedCount: 20;
  briefId: string;
  collectionRunId: string;
  sourceBatchId: string;
  artifactHashes: Partial<Record<ArtifactKey, string>>;
  fileSha256: Partial<Record<ArtifactKey, string>>;
};

export type Stage15ShadowBatchBuildInput = {
  role: ShadowBatchRole;
  manifest: Stage15ShadowBatchManifest;
  selectionBrief: { schemaVersion: string; briefId: string; query?: unknown };
  collectionRun: { schemaVersion: string; collectionRunId: string; briefId: string; sampledObservationIds?: string[] };
  sourceAdapterResult: { schemaVersion: string; sourceBatchId: string; acceptedCount: number };
  importPackage: { schemaVersion: string; briefId: string; collectionRunId: string; candidates: Array<{ productKey: string }> };
  rankingRun: { schemaVersion: string; briefId: string; collectionRunId: string; results: Array<{ productKey: string; rank: number | null }> };
  screeningRun: { schemaVersion: string; items: Array<{ productKey: string; status: string }> };
  visualPacket: { schemaVersion: string; items: Array<{ productKey: string; blindItemId: string }> };
  observations: Stage15ShadowObservation[];
  detailEvidence?: unknown[];
  actualFileSha256: Partial<Record<ArtifactKey, string>>;
  createdAt: string;
};

export type Stage15ShadowBatch = {
  schemaVersion: "stage15-shadow-batch.v1";
  batchId: string;
  role: ShadowBatchRole;
  readiness: "ready_partial" | "ready_full";
  productKeys: string[];
  observations: Stage15ShadowObservation[];
  baseline: Array<{ productKey: string; rank: number | null; status: string }>;
  missingReasons: string[];
  createdAt: string;
  batchHash: string;
};

const SHA256 = /^[a-f0-9]{64}$/u;

function exactProductKeys(values: Array<{ productKey: string }>, label: string): string[] {
  const keys = values.map((value) => value.productKey);
  if (keys.length !== 20 || keys.some((key) => typeof key !== "string" || !key)
    || new Set(keys).size !== keys.length) throw new Error(`SHADOW_BATCH_IDENTITY_INVALID:${label}`);
  return [...keys].sort();
}

function sameSet(left: string[], right: string[], label: string): void {
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(`SHADOW_BATCH_IDENTITY_CONFLICT:${label}`);
  }
}

export function buildStage15ShadowBatch(input: Stage15ShadowBatchBuildInput): Stage15ShadowBatch {
  const { manifest } = input;
  if (manifest.schemaVersion !== "stage15-shadow-batch-manifest.v1" || manifest.role !== input.role
    || manifest.expectedCount !== 20 || !manifest.batchId || manifest.batchId !== input.observations[0]?.batchId
    || Number.isNaN(Date.parse(input.createdAt))) throw new Error("SHADOW_BATCH_MANIFEST_INVALID");
  if (input.selectionBrief.briefId !== manifest.briefId
    || input.collectionRun.briefId !== manifest.briefId
    || input.collectionRun.collectionRunId !== manifest.collectionRunId
    || input.importPackage.briefId !== manifest.briefId
    || input.importPackage.collectionRunId !== manifest.collectionRunId
    || input.rankingRun.briefId !== manifest.briefId
    || input.rankingRun.collectionRunId !== manifest.collectionRunId
    || input.sourceAdapterResult.sourceBatchId !== manifest.sourceBatchId
    || input.sourceAdapterResult.acceptedCount !== 20) throw new Error("SHADOW_BATCH_BINDING_CONFLICT");

  const artifacts: Partial<Record<ArtifactKey, unknown>> = {
    selectionBrief: input.selectionBrief,
    collectionRun: input.collectionRun,
    sourceAdapterResult: input.sourceAdapterResult,
    importPackage: input.importPackage,
    rankingRun: input.rankingRun,
    screeningRun: input.screeningRun,
    visualPacket: input.visualPacket,
    observations: input.observations,
  };
  if (input.detailEvidence !== undefined) artifacts.detailEvidence = input.detailEvidence;
  for (const [key, value] of Object.entries(artifacts) as Array<[ArtifactKey, unknown]>) {
    if (stableHash(value) !== manifest.artifactHashes[key]) throw new Error(`SHADOW_BATCH_CANONICAL_HASH_CONFLICT:${key}`);
    const declaredFileHash = manifest.fileSha256[key];
    if (!declaredFileHash || !SHA256.test(declaredFileHash) || input.actualFileSha256[key] !== declaredFileHash) {
      throw new Error(`SHADOW_BATCH_FILE_HASH_CONFLICT:${key}`);
    }
  }

  const imported = exactProductKeys(input.importPackage.candidates, "importPackage");
  sameSet(imported, exactProductKeys(input.rankingRun.results, "rankingRun"), "rankingRun");
  sameSet(imported, exactProductKeys(input.screeningRun.items, "screeningRun"), "screeningRun");
  sameSet(imported, exactProductKeys(input.visualPacket.items, "visualPacket"), "visualPacket");
  sameSet(imported, exactProductKeys(input.observations, "observations"), "observations");
  if (input.observations.some((observation) => observation.batchId !== manifest.batchId)) {
    throw new Error("SHADOW_BATCH_OBSERVATION_BATCH_CONFLICT");
  }

  if (input.detailEvidence !== undefined && input.detailEvidence.length !== 5) {
    throw new Error("SHADOW_BATCH_OPTIONAL_DETAIL_GROUP_INCOMPLETE");
  }
  const readiness = input.detailEvidence === undefined ? "ready_partial" as const : "ready_full" as const;
  const statusByKey = new Map(input.screeningRun.items.map((item) => [item.productKey, item.status]));
  const body = {
    schemaVersion: "stage15-shadow-batch.v1" as const,
    batchId: manifest.batchId,
    role: input.role,
    readiness,
    productKeys: imported,
    observations: [...input.observations].sort((a, b) => a.productKey.localeCompare(b.productKey)),
    baseline: input.rankingRun.results
      .map((item) => ({ productKey: item.productKey, rank: item.rank, status: statusByKey.get(item.productKey) ?? "insufficient" }))
      .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)),
    missingReasons: readiness === "ready_partial" ? ["optional_detail_evidence_not_attached"] : [],
    createdAt: input.createdAt,
  };
  return { ...body, batchHash: stableHash(body) };
}

export function assertStage15ShadowBatchIsolation(
  calibration: Stage15ShadowBatch,
  validation: Stage15ShadowBatch,
): void {
  if (calibration.role !== "calibration" || validation.role !== "validation" || calibration.batchId === validation.batchId) {
    throw new Error("SHADOW_BATCH_ROLE_CONFLICT");
  }
  const calibrationKeys = new Set(calibration.productKeys);
  if (validation.productKeys.some((key) => calibrationKeys.has(key))) {
    throw new Error("SHADOW_BATCH_IDENTITY_OVERLAP");
  }
}
