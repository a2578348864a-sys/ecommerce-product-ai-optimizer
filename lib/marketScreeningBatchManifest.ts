import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
} from "node:path";

export const FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH =
  "06_测试与验证/2026-07-17-Phase0-Market-Screening-Frozen-Batch-01/market-screening-batch-manifest.v1.json";

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_SIDECAR_BYTES = 512;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ArtifactRequirementLevel =
  | "upstream_required"
  | "stage_required"
  | "presentation_required"
  | "optional_detail";

export type MarketScreeningArtifactKey =
  | "selectionBrief"
  | "collectionRun"
  | "sourceAdapterResult"
  | "importPackage"
  | "stage1BlindReviewMaterial"
  | "stage1Ranking"
  | "stage1Summary"
  | "stage15Run"
  | "stage15Acceptance"
  | "stage15GenerationSummary"
  | "visualPresentationInput"
  | "visualPacket"
  | "visualGenerationSummary"
  | "detailBrief"
  | "detailBriefGenerationSummary"
  | "detailAuthorization"
  | "detailRun"
  | "detailGenerationSummary";

export type MarketScreeningArtifactRef = {
  key: MarketScreeningArtifactKey;
  requirementLevel: ArtifactRequirementLevel;
  groupId: "core" | "visual_presentation" | "detail_evidence_a02";
  relativePath: string;
  fileSha256: string;
  containerSchemaVersion: string;
  jsonPointer: string;
  artifactSchemaVersion: string;
  bindingAssertions: Array<{
    jsonPointer: string;
    equals: string | number | boolean;
  }>;
};

export type MarketScreeningEnvironment = "development" | "test" | "production";

export type ProductionBatchRegistration = {
  registrationId: string;
  manifestId: string;
  manifestRelativePath: string;
  manifestSha256: string;
};

export type MarketScreeningBatchManifest = {
  schemaVersion: "market-screening-batch-manifest.v1";
  batchMode: "frozen_validation_batch";
  manifestId: string;
  environment: MarketScreeningEnvironment;
  identities: {
    briefId: string;
    collectionRunId: string;
    sourceBatchIds: string[];
    importBatchId: string;
    importPackageHash: string;
    rankingRunId: string;
    screeningHash: string;
  };
  artifacts: MarketScreeningArtifactRef[];
  imageAssetRoot: { relativePath: string };
  sourcePolicy: {
    requiredSourceIds: string[];
    optionalSourceIds: string[];
    minimumSuccessfulSourceCount: number;
    minimumStage1InputCount: number;
    allowStageOutputsWhenPartial: boolean;
  };
  expectedCounts: {
    acceptedUniqueProductCount: number;
    stage1InputCount: number;
    stage15: {
      advance: number;
      watch: number;
      reject: number;
      insufficient: number;
      total: number;
    };
  };
  createdAt: string;
  frozenAt: string;
};

export type ManifestErrorCode =
  | "batch_manifest_not_configured"
  | "batch_manifest_missing"
  | "batch_manifest_sidecar_invalid"
  | "batch_manifest_hash_mismatch"
  | "batch_manifest_schema_invalid"
  | "batch_manifest_path_invalid";

export type ManifestLoadResult =
  | {
      status: "ready";
      manifest: MarketScreeningBatchManifest;
      manifestPath: string;
      manifestSha256: string;
    }
  | { status: "unavailable"; errorCode: ManifestErrorCode };

const ARTIFACT_KEYS = new Set<MarketScreeningArtifactKey>([
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
]);
const REQUIREMENT_LEVELS = new Set<ArtifactRequirementLevel>([
  "upstream_required",
  "stage_required",
  "presentation_required",
  "optional_detail",
]);
const GROUP_IDS = new Set([
  "core",
  "visual_presentation",
  "detail_evidence_a02",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every(isNonEmptyString)
    && new Set(value).size === value.length;
}

function isIsoTime(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function isSafeRelativePath(value: unknown): value is string {
  if (!isNonEmptyString(value) || isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, "/");
  return !normalized.split("/").some((segment) => segment === ".." || segment === "");
}

function isJsonPointer(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !value.startsWith("/")) return false;
  return value.split("/").slice(1).every((token) => !/~(?![01])/u.test(token));
}

function isBindingAssertion(value: unknown): value is MarketScreeningArtifactRef["bindingAssertions"][number] {
  if (!isRecord(value) || !isJsonPointer(value.jsonPointer)) return false;
  if (!["string", "number", "boolean"].includes(typeof value.equals)) return false;
  return typeof value.equals !== "number" || Number.isFinite(value.equals);
}

function isArtifactRef(value: unknown): value is MarketScreeningArtifactRef {
  return isRecord(value)
    && typeof value.key === "string"
    && ARTIFACT_KEYS.has(value.key as MarketScreeningArtifactKey)
    && typeof value.requirementLevel === "string"
    && REQUIREMENT_LEVELS.has(value.requirementLevel as ArtifactRequirementLevel)
    && typeof value.groupId === "string"
    && GROUP_IDS.has(value.groupId)
    && isSafeRelativePath(value.relativePath)
    && typeof value.fileSha256 === "string"
    && SHA256_PATTERN.test(value.fileSha256)
    && isNonEmptyString(value.containerSchemaVersion)
    && isJsonPointer(value.jsonPointer)
    && isNonEmptyString(value.artifactSchemaVersion)
    && Array.isArray(value.bindingAssertions)
    && value.bindingAssertions.every(isBindingAssertion);
}

function isSourcePolicy(value: unknown): value is MarketScreeningBatchManifest["sourcePolicy"] {
  if (!isRecord(value)
    || !isStringArray(value.requiredSourceIds)
    || !isStringArray(value.optionalSourceIds)
    || !isPositiveInteger(value.minimumSuccessfulSourceCount)
    || !isPositiveInteger(value.minimumStage1InputCount)
    || typeof value.allowStageOutputsWhenPartial !== "boolean") return false;
  const optionalSourceIds = value.optionalSourceIds;
  return !value.requiredSourceIds.some((sourceId) => optionalSourceIds.includes(sourceId));
}

function hasConsistentContainerDeclarations(artifacts: MarketScreeningArtifactRef[]): boolean {
  const declarations = new Map<string, string>();
  for (const artifact of artifacts) {
    const declaration = `${artifact.fileSha256}\u0000${artifact.containerSchemaVersion}`;
    const previous = declarations.get(artifact.relativePath);
    if (previous && previous !== declaration) return false;
    declarations.set(artifact.relativePath, declaration);
  }
  return true;
}

function parseManifest(value: unknown): MarketScreeningBatchManifest | null {
  if (!isRecord(value)
    || value.schemaVersion !== "market-screening-batch-manifest.v1"
    || value.batchMode !== "frozen_validation_batch"
    || !isNonEmptyString(value.manifestId)
    || !["development", "test", "production"].includes(String(value.environment))
    || !isRecord(value.identities)
    || !isNonEmptyString(value.identities.briefId)
    || !isNonEmptyString(value.identities.collectionRunId)
    || !isStringArray(value.identities.sourceBatchIds)
    || !isNonEmptyString(value.identities.importBatchId)
    || typeof value.identities.importPackageHash !== "string"
    || !SHA256_PATTERN.test(value.identities.importPackageHash)
    || !isNonEmptyString(value.identities.rankingRunId)
    || typeof value.identities.screeningHash !== "string"
    || !SHA256_PATTERN.test(value.identities.screeningHash)
    || !Array.isArray(value.artifacts)
    || value.artifacts.length === 0
    || !value.artifacts.every(isArtifactRef)
    || new Set(value.artifacts.map((artifact) => artifact.key)).size !== value.artifacts.length
    || !hasConsistentContainerDeclarations(value.artifacts as MarketScreeningArtifactRef[])
    || !isRecord(value.imageAssetRoot)
    || !isSafeRelativePath(value.imageAssetRoot.relativePath)
    || !isSourcePolicy(value.sourcePolicy)
    || !isRecord(value.expectedCounts)
    || !isPositiveInteger(value.expectedCounts.acceptedUniqueProductCount)
    || !isPositiveInteger(value.expectedCounts.stage1InputCount)
    || !isRecord(value.expectedCounts.stage15)
    || !isNonNegativeInteger(value.expectedCounts.stage15.advance)
    || !isNonNegativeInteger(value.expectedCounts.stage15.watch)
    || !isNonNegativeInteger(value.expectedCounts.stage15.reject)
    || !isNonNegativeInteger(value.expectedCounts.stage15.insufficient)
    || !isPositiveInteger(value.expectedCounts.stage15.total)
    || value.expectedCounts.stage15.advance
      + value.expectedCounts.stage15.watch
      + value.expectedCounts.stage15.reject
      + value.expectedCounts.stage15.insufficient !== value.expectedCounts.stage15.total
    || !isIsoTime(value.createdAt)
    || !isIsoTime(value.frozenAt)) {
    return null;
  }
  return value as MarketScreeningBatchManifest;
}

function unavailable(errorCode: ManifestErrorCode): ManifestLoadResult {
  return { status: "unavailable", errorCode };
}

function resolveManifestPath(options: {
  environment: MarketScreeningEnvironment;
  projectMaterialsRoot: string;
  testManifestPath?: string;
  productionRegistration?: ProductionBatchRegistration;
}): { root: string; path: string } | ManifestLoadResult {
  if (options.environment === "production" && !options.productionRegistration) {
    return unavailable("batch_manifest_not_configured");
  }
  if (options.environment === "production" && options.testManifestPath) {
    return unavailable("batch_manifest_path_invalid");
  }
  if (options.environment !== "production" && options.productionRegistration) {
    return unavailable("batch_manifest_path_invalid");
  }
  if (options.environment === "test" && !options.testManifestPath) {
    return unavailable("batch_manifest_not_configured");
  }
  if (options.environment === "development" && options.testManifestPath) {
    return unavailable("batch_manifest_path_invalid");
  }

  const root = resolve(options.projectMaterialsRoot);
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
    if (!statSync(rootReal).isDirectory()) return unavailable("batch_manifest_path_invalid");
  } catch {
    return unavailable("batch_manifest_path_invalid");
  }

  const registration = options.productionRegistration;
  if (registration && (!isNonEmptyString(registration.registrationId)
    || !isNonEmptyString(registration.manifestId)
    || !isSafeRelativePath(registration.manifestRelativePath)
    || !SHA256_PATTERN.test(registration.manifestSha256))) {
    return unavailable("batch_manifest_path_invalid");
  }
  const requested = options.environment === "test"
    ? options.testManifestPath!
    : options.environment === "production"
      ? registration!.manifestRelativePath
      : FROZEN_VALIDATION_MANIFEST_RELATIVE_PATH;
  const path = isAbsolute(requested) ? resolve(requested) : resolve(root, requested);
  if (!isContained(root, path)) return unavailable("batch_manifest_path_invalid");

  try {
    const pathReal = realpathSync(path);
    if (!isContained(rootReal, pathReal) || lstatSync(path).isSymbolicLink()) {
      return unavailable("batch_manifest_path_invalid");
    }
  } catch {
    return unavailable("batch_manifest_missing");
  }
  return { root: rootReal, path };
}

export function loadMarketScreeningBatchManifest(options: {
  environment: MarketScreeningEnvironment;
  projectMaterialsRoot: string;
  testManifestPath?: string;
  productionRegistration?: ProductionBatchRegistration;
}): ManifestLoadResult {
  const resolved = resolveManifestPath(options);
  if ("status" in resolved) return resolved;

  const manifestPath = resolved.path;
  const sidecarPath = manifestPath.replace(/\.json$/u, ".sha256");
  if (sidecarPath === manifestPath) return unavailable("batch_manifest_path_invalid");

  let manifestBuffer: Buffer;
  let sidecar: string;
  try {
    const sidecarReal = realpathSync(sidecarPath);
    if (!isContained(resolved.root, sidecarReal) || lstatSync(sidecarPath).isSymbolicLink()) {
      return unavailable("batch_manifest_path_invalid");
    }
    if (statSync(manifestPath).size > MAX_MANIFEST_BYTES) {
      return unavailable("batch_manifest_schema_invalid");
    }
    if (statSync(sidecarPath).size > MAX_SIDECAR_BYTES) {
      return unavailable("batch_manifest_sidecar_invalid");
    }
    manifestBuffer = readFileSync(manifestPath);
    sidecar = readFileSync(sidecarPath, "utf8");
  } catch {
    return unavailable("batch_manifest_sidecar_invalid");
  }

  const sidecarMatch = /^([a-f0-9]{64})  ([^\r\n]+)\r?\n?$/u.exec(sidecar);
  if (!sidecarMatch || sidecarMatch[2] !== basename(manifestPath)) {
    return unavailable("batch_manifest_sidecar_invalid");
  }
  const actualSha256 = createHash("sha256").update(manifestBuffer).digest("hex");
  if (actualSha256 !== sidecarMatch[1]) {
    return unavailable("batch_manifest_hash_mismatch");
  }
  if (options.productionRegistration
    && actualSha256 !== options.productionRegistration.manifestSha256) {
    return unavailable("batch_manifest_hash_mismatch");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    return unavailable("batch_manifest_schema_invalid");
  }
  const manifest = parseManifest(parsed);
  if (!manifest
    || manifest.environment !== options.environment
    || (options.productionRegistration
      && manifest.manifestId !== options.productionRegistration.manifestId)) {
    return unavailable("batch_manifest_schema_invalid");
  }
  return {
    status: "ready",
    manifest,
    manifestPath,
    manifestSha256: actualSha256,
  };
}
