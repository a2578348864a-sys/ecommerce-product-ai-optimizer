import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactSetAtomically } from "./artifact-set-writer";
import {
  ALT_REVIEW_BATCH_ID,
  buildStage15ShadowAltReviewAccessRequest,
  buildStage15ShadowAltReviewProbeBrief,
  buildStage15ShadowAltReviewSourceRegistry,
  selectStage15ShadowAltReviewSamples,
  type AltReviewRegistryEntry,
  type Stage15ShadowAltReviewAccessRequest,
  type Stage15ShadowAltReviewProbeBrief,
  type Stage15ShadowAltReviewSourceRegistry,
} from "./stage15-shadow-alt-review-contract";
import {
  evaluateStage15ShadowDetailAccessPreflight,
  type Stage15ShadowDetailAccessAuthorization,
  type Stage15ShadowDetailAccessLogEntry,
  type Stage15ShadowDetailAccessRequest,
} from "./stage15-shadow-detail-access";

const MANIFEST_FILE = "stage15-shadow-upstream-manifest.v1.json";
const BINDINGS_FILE = "stage15-shadow-combined-human-evaluation-bindings.private.v1.json";
const PACKET_FILE = "stage15-shadow-combined-human-evaluation-packet.v1.json";
const DETAIL_REQUEST_FILE = "stage15-shadow-detail-access-request.v1.json";
const DETAIL_AUTHORIZATION_FILE = "stage15-shadow-detail-access-authorization.v1.json";
const DETAIL_LOG_FILE = "stage15-shadow-detail-access-log.v1.json";
const DETAIL_PREFLIGHT_FILE = "stage15-shadow-detail-access-preflight.v1.json";
const DETAIL_STOP_FILE = "stage15-shadow-detail-access-stop-evidence.v1.json";
const INITIAL_GATE_FILE = "stage15-shadow-human-evaluation-start-gate.v1.json";
const DETAIL_GATE_FILE = "stage15-shadow-human-evaluation-start-gate.detail-stop.v1.json";
const REQUEST_SUMMARY_FILE = "generation-summary.stage15-shadow-detail-access-request.v1.json";
const REQUIRED_MANIFEST_ARTIFACTS = [
  "selection-brief.v1.json",
  "stage15-shadow-access-budget.v1.json",
  "source-capture.amazon-bestsellers.md",
  "collection-run.v2.json",
  "source-adapter-result.v1.json",
  "import-package.v1.json",
  "ranking-run.v1.json",
  "stage15-shadow-observations.v1.json",
  "stage15-shadow-visual-reference-packet.v1.json",
  "stage15-shadow-combined-human-evaluation-packet.v1.json",
  "stage15-shadow-combined-human-evaluation-bindings.private.v1.json",
  "stage15-shadow-combined-human-evaluation-result-template.v1.json",
  "human-evaluation-form.md",
  "generation-summary.stage15-shadow-public-upstream.v1.json",
] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

type JsonRecord = Record<string, unknown>;
type ManifestArtifact = { relativePath: string; sha256: string; canonicalStableHash: string | null };
type UpstreamManifest = JsonRecord & {
  schemaVersion: string;
  manifestId: string;
  batchId: string;
  role: string;
  frozenValidationBatch: boolean;
  explicitPathOnly: boolean;
  automaticLatestSelectionAllowed: boolean;
  crossBatchArtifactFallbackAllowed: boolean;
  artifacts: ManifestArtifact[];
  identity: { count: number; productKeysHash: string };
  manifestHash: string;
};

export type Stage15ShadowAltReviewReadiness = {
  schemaVersion: "stage15-shadow-alt-review-readiness.v1";
  batchId: string;
  briefHash: string;
  registryHash: string;
  requestHash: string;
  status: "pending_user_access_approval";
  executionAllowed: false;
  humanEvaluationAllowed: false;
  batchVUnlocked: false;
  policyCandidateGenerated: false;
  databaseWritten: false;
  productionEffect: false;
  createdAt: string;
  readinessHash: string;
};

export type Stage15ShadowAltReviewPreparationResult = {
  directory: string;
  brief: Stage15ShadowAltReviewProbeBrief;
  registry: Stage15ShadowAltReviewSourceRegistry;
  request: Stage15ShadowAltReviewAccessRequest;
  readiness: Stage15ShadowAltReviewReadiness;
  files: string[];
  write: { directory: string; written: string[]; unchanged: string[] };
};

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(directory: string, relativePath: string): T {
  return JSON.parse(readFileSync(join(directory, relativePath), "utf8")) as T;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function withoutField(value: JsonRecord, field: string): JsonRecord {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function assertSelfHash(value: JsonRecord, field: string, code: string): void {
  if (typeof value[field] !== "string" || stableHash(withoutField(value, field)) !== value[field]) throw new Error(code);
}

function topLevelSnapshot(directory: string): Record<string, string> {
  return Object.fromEntries(readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [entry.name, sha256(readFileSync(join(directory, entry.name)))])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function sameSnapshot(left: Record<string, string>, right: Record<string, string>): boolean {
  return stableHash(left) === stableHash(right);
}

function assertUpstream(directory: string, snapshot: Record<string, string>) {
  const manifest = readJson<UpstreamManifest>(directory, MANIFEST_FILE);
  assertSelfHash(manifest, "manifestHash", "SHADOW_ALT_REVIEW_MANIFEST_DRIFT");
  if (manifest.schemaVersion !== "stage15-shadow-upstream-manifest.v1"
    || manifest.batchId !== ALT_REVIEW_BATCH_ID || manifest.role !== "calibration"
    || manifest.frozenValidationBatch !== true || manifest.explicitPathOnly !== true
    || manifest.automaticLatestSelectionAllowed !== false
    || manifest.crossBatchArtifactFallbackAllowed !== false
    || !Array.isArray(manifest.artifacts)) {
    throw new Error("SHADOW_ALT_REVIEW_MANIFEST_INVALID");
  }
  for (const artifact of manifest.artifacts) {
    if (!artifact || typeof artifact.relativePath !== "string" || !artifact.relativePath
      || artifact.relativePath === "." || artifact.relativePath === ".."
      || /[\\/\0]/u.test(artifact.relativePath)) {
      throw new Error("SHADOW_ALT_REVIEW_MANIFEST_ARTIFACT_PATH_INVALID");
    }
    if (!SHA256_PATTERN.test(artifact.sha256)
      || (artifact.canonicalStableHash !== null && !SHA256_PATTERN.test(artifact.canonicalStableHash))) {
      throw new Error("SHADOW_ALT_REVIEW_MANIFEST_ARTIFACT_HASH_INVALID");
    }
  }
  const manifestPaths = manifest.artifacts.map((artifact) => artifact.relativePath).sort();
  const requiredPaths = [...REQUIRED_MANIFEST_ARTIFACTS].sort();
  if (stableHash(manifestPaths) !== stableHash(requiredPaths)) {
    throw new Error("SHADOW_ALT_REVIEW_MANIFEST_ARTIFACT_SET_INVALID");
  }
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (seen.has(artifact.relativePath) || snapshot[artifact.relativePath] !== artifact.sha256) {
      throw new Error(`SHADOW_ALT_REVIEW_UPSTREAM_HASH_DRIFT:${artifact?.relativePath ?? "unknown"}`);
    }
    seen.add(artifact.relativePath);
    if (artifact.canonicalStableHash !== null) {
      const parsed = readJson<unknown>(directory, artifact.relativePath);
      if (stableHash(parsed) !== artifact.canonicalStableHash) {
        throw new Error(`SHADOW_ALT_REVIEW_UPSTREAM_STABLE_HASH_DRIFT:${artifact.relativePath}`);
      }
    }
  }
  const request = readJson<Stage15ShadowDetailAccessRequest>(directory, DETAIL_REQUEST_FILE);
  if (request.sourceManifest.manifestId !== manifest.manifestId
    || request.sourceManifest.manifestHash !== manifest.manifestHash
    || request.sourceManifest.fileSha256 !== snapshot[MANIFEST_FILE]) {
    throw new Error("SHADOW_ALT_REVIEW_MANIFEST_FILE_HASH_DRIFT");
  }
  return { manifest, request };
}

function assertDetailStop(directory: string, manifest: UpstreamManifest, request: Stage15ShadowDetailAccessRequest) {
  const authorization = readJson<Stage15ShadowDetailAccessAuthorization>(directory, DETAIL_AUTHORIZATION_FILE);
  const logEnvelope = readJson<JsonRecord & { entries: Stage15ShadowDetailAccessLogEntry[]; summary: JsonRecord }>(directory, DETAIL_LOG_FILE);
  const preflight = readJson<JsonRecord>(directory, DETAIL_PREFLIGHT_FILE);
  const stopEvidence = readJson<JsonRecord>(directory, DETAIL_STOP_FILE);
  const initialGate = readJson<JsonRecord>(directory, INITIAL_GATE_FILE);
  const detailGate = readJson<JsonRecord>(directory, DETAIL_GATE_FILE);
  const requestSummary = readJson<JsonRecord>(directory, REQUEST_SUMMARY_FILE);
  const sidecar = readFileSync(join(directory, `${DETAIL_REQUEST_FILE.replace(/\.json$/u, "")}.sha256`), "utf8");
  const expectedSidecar = `${sha256(readFileSync(join(directory, DETAIL_REQUEST_FILE)))}  ${DETAIL_REQUEST_FILE}\n`;
  if (sidecar !== expectedSidecar) throw new Error("SHADOW_ALT_REVIEW_DETAIL_REQUEST_SIDECAR_DRIFT");

  let recomputed: JsonRecord;
  try {
    recomputed = evaluateStage15ShadowDetailAccessPreflight({ request, authorization, accessLog: logEnvelope.entries }) as JsonRecord;
  } catch {
    throw new Error("SHADOW_ALT_REVIEW_DETAIL_STOP_INVALID");
  }
  if (stableHash(recomputed) !== stableHash(preflight)
    || preflight.status !== "blocked_stop_condition" || preflight.executionAllowed !== false
    || preflight.stopCondition !== "login_wall" || preflight.stoppedProductKey !== "amazon:US:B0044UP39U"
    || preflight.remainingRequests !== 19 || preflight.completedRequests !== 1
    || logEnvelope.requestHash !== request.requestHash || !Array.isArray(logEnvelope.entries)
    || logEnvelope.entries.length !== 1 || logEnvelope.entries[0]?.outcome !== "login_wall"
    || logEnvelope.entries[0]?.productKey !== "amazon:US:B0044UP39U"
    || logEnvelope.summary.automaticRetries !== 0 || logEnvelope.summary.remainingBudget !== 19) {
    throw new Error("SHADOW_ALT_REVIEW_DETAIL_STOP_INVALID");
  }
  assertSelfHash(stopEvidence, "evidenceHash", "SHADOW_ALT_REVIEW_DETAIL_STOP_EVIDENCE_DRIFT");
  assertSelfHash(initialGate, "gateHash", "SHADOW_ALT_REVIEW_INITIAL_GATE_DRIFT");
  assertSelfHash(detailGate, "gateHash", "SHADOW_ALT_REVIEW_DETAIL_GATE_DRIFT");
  assertSelfHash(requestSummary, "summaryHash", "SHADOW_ALT_REVIEW_DETAIL_REQUEST_SUMMARY_DRIFT");
  const capture = stopEvidence.capture as JsonRecord;
  if (stopEvidence.requestHash !== request.requestHash
    || stopEvidence.authorizationHash !== stableHash(authorization)
    || stopEvidence.productKey !== "amazon:US:B0044UP39U" || stopEvidence.accessOutcome !== "login_wall"
    || typeof capture?.relativePath !== "string" || typeof capture?.fileSha256 !== "string"
    || sha256(readFileSync(join(directory, capture.relativePath))) !== capture.fileSha256
    || (stopEvidence.rawVisibleDiagnostics as JsonRecord)?.exactVariantPositiveReviews !== null
    || (stopEvidence.rawVisibleDiagnostics as JsonRecord)?.exactVariantNegativeReviews !== null
    || (stopEvidence.continuation as JsonRecord)?.allowed !== false
    || detailGate.sourceManifestHash !== manifest.manifestHash
    || detailGate.sourceDetailAccessRequestHash !== request.requestHash
    || detailGate.sourceDetailAccessPreflightHash !== preflight.preflightHash
    || detailGate.sourceDetailAccessStopEvidenceHash !== stopEvidence.evidenceHash
    || detailGate.previousGateHash !== initialGate.gateHash
    || detailGate.status !== "hold_detail_access_stopped_login_wall"
    || detailGate.humanEvaluationAllowed !== false || detailGate.policyCandidateCanFreeze !== false
    || !Array.isArray(detailGate.reasonCodes)
    || !detailGate.reasonCodes.includes("exact_variant_review_coverage_0_of_10")) {
    throw new Error("SHADOW_ALT_REVIEW_DETAIL_STOP_INVALID");
  }
  return { stopEvidence, detailGate };
}

function artifactsWithSidecars(values: Array<{ relativePath: string; value: unknown }>) {
  return values.flatMap(({ relativePath, value }) => {
    const content = jsonContent(value);
    const sidecarPath = relativePath.replace(/\.json$/u, ".sha256");
    return [
      { relativePath, content },
      { relativePath: sidecarPath, content: `${sha256(content)}  ${relativePath}\n` },
    ];
  });
}

export function generateStage15ShadowAltReviewPreparation(input: {
  batchDirectory: string;
  registryEntries: AltReviewRegistryEntry[];
  queries: Stage15ShadowAltReviewAccessRequest["queries"];
  createdAt: string;
}): Stage15ShadowAltReviewPreparationResult {
  const directory = resolve(input.batchDirectory);
  const firstSnapshot = topLevelSnapshot(directory);
  const { manifest, request: detailRequest } = assertUpstream(directory, firstSnapshot);
  assertDetailStop(directory, manifest, detailRequest);
  const bindings = readJson<JsonRecord & { packetHash: string; bindings: Array<{ productKey: string }> }>(directory, BINDINGS_FILE);
  const packet = readJson<JsonRecord>(directory, PACKET_FILE);
  assertSelfHash(bindings, "bindingHash", "SHADOW_ALT_REVIEW_BINDINGS_DRIFT");
  assertSelfHash(packet, "packetHash", "SHADOW_ALT_REVIEW_PACKET_DRIFT");
  const productKeys = bindings.bindings?.map((binding) => binding.productKey);
  if (!Array.isArray(productKeys) || productKeys.length !== 20 || new Set(productKeys).size !== 20
    || bindings.batchId !== ALT_REVIEW_BATCH_ID || bindings.packetHash !== packet.packetHash
    || manifest.identity.count !== 20 || manifest.identity.productKeysHash !== stableHash([...productKeys].sort())) {
    throw new Error("SHADOW_ALT_REVIEW_BINDINGS_INVALID");
  }
  const samples = selectStage15ShadowAltReviewSamples(productKeys);
  const brief = buildStage15ShadowAltReviewProbeBrief({
    batchId: ALT_REVIEW_BATCH_ID,
    role: "calibration",
    sourceManifest: { manifestId: manifest.manifestId, manifestHash: manifest.manifestHash, fileSha256: firstSnapshot[MANIFEST_FILE] },
    productKeys,
    createdAt: input.createdAt,
  });
  if (stableHash(brief.samples) !== stableHash(samples)) throw new Error("SHADOW_ALT_REVIEW_SAMPLE_DRIFT");
  const registryCreatedAt = new Date(Date.parse(input.createdAt) + 60_000).toISOString();
  const requestCreatedAt = new Date(Date.parse(input.createdAt) + 120_000).toISOString();
  const registry = buildStage15ShadowAltReviewSourceRegistry({
    batchId: ALT_REVIEW_BATCH_ID,
    briefHash: brief.briefHash,
    entries: input.registryEntries,
    createdAt: registryCreatedAt,
  });
  const request = buildStage15ShadowAltReviewAccessRequest({ brief, registry, queries: input.queries, createdAt: requestCreatedAt });
  const readinessBody = {
    schemaVersion: "stage15-shadow-alt-review-readiness.v1" as const,
    batchId: ALT_REVIEW_BATCH_ID,
    briefHash: brief.briefHash,
    registryHash: registry.registryHash,
    requestHash: request.requestHash,
    status: "pending_user_access_approval" as const,
    executionAllowed: false as const,
    humanEvaluationAllowed: false as const,
    batchVUnlocked: false as const,
    policyCandidateGenerated: false as const,
    databaseWritten: false as const,
    productionEffect: false as const,
    createdAt: requestCreatedAt,
  };
  const readiness: Stage15ShadowAltReviewReadiness = { ...readinessBody, readinessHash: stableHash(readinessBody) };
  const outputValues = [
    { relativePath: "stage15-shadow-alt-review-probe-brief.v1.json", value: brief },
    { relativePath: "stage15-shadow-alt-review-source-registry.v1.json", value: registry },
    { relativePath: "stage15-shadow-alt-review-access-request.v1.json", value: request },
    { relativePath: "stage15-shadow-alt-review-readiness.v1.json", value: readiness },
  ];
  const summaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-alt-review-preparation.v1",
    batchId: ALT_REVIEW_BATCH_ID,
    status: "pending_user_access_approval",
    sourceFiles: firstSnapshot,
    outputs: outputValues.map(({ relativePath, value }) => ({ relativePath, sha256: sha256(jsonContent(value)) })),
    boundary: { externalWebsiteAccessed: false, humanEvaluationAllowed: false, batchVUnlocked: false, databaseWritten: false, productionEffect: false },
    createdAt: requestCreatedAt,
  };
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts = artifactsWithSidecars([...outputValues, {
    relativePath: "generation-summary.stage15-shadow-alt-review-preparation.v1.json",
    value: summary,
  }]);
  const secondSnapshot = topLevelSnapshot(directory);
  if (!sameSnapshot(firstSnapshot, secondSnapshot)) throw new Error("SHADOW_ALT_REVIEW_SOURCE_CHANGED_DURING_GENERATION");
  const parent = join(directory, "alternative-review-probe-v1");
  const write = writeArtifactSetAtomically(parent, "preparation", artifacts, "STAGE15_SHADOW_ALT_REVIEW_PREPARATION_CONFLICT");
  const files = artifacts.map((artifact) => artifact.relativePath);
  return { directory: write.directory, brief, registry, request, readiness, files, write };
}
