import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactSetAtomically } from "./artifact-set-writer";
import {
  assertStage15ShadowAltReviewAuthorizationIntegrity,
  assertStage15ShadowAltReviewBriefIntegrity,
  assertStage15ShadowAltReviewRegistryIntegrity,
  assertStage15ShadowAltReviewRequestIntegrity,
  type AltReviewAccessLogEntry,
  type AltReviewCapture,
  type Stage15ShadowAltReviewAccessRequest,
  type Stage15ShadowAltReviewAuthorization,
  type Stage15ShadowAltReviewProbeBrief,
  type Stage15ShadowAltReviewSourceRegistry,
} from "./stage15-shadow-alt-review-contract";
import {
  buildStage15ShadowAltReviewEvidencePackage,
  type Stage15ShadowAltReviewEvidencePackage,
} from "./stage15-shadow-alt-review-evidence";

type JsonRecord = Record<string, unknown>;

const PREPARATION_FILES = [
  "stage15-shadow-alt-review-probe-brief.v1.json",
  "stage15-shadow-alt-review-source-registry.v1.json",
  "stage15-shadow-alt-review-access-request.v1.json",
  "stage15-shadow-alt-review-readiness.v1.json",
  "generation-summary.stage15-shadow-alt-review-preparation.v1.json",
] as const;

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson<T>(directory: string, relativePath: string): T {
  return JSON.parse(readFileSync(join(directory, relativePath), "utf8")) as T;
}

function withoutField(value: JsonRecord, field: string): JsonRecord {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function assertSelfHash(value: JsonRecord, field: string, code: string): void {
  if (typeof value[field] !== "string" || stableHash(withoutField(value, field)) !== value[field]) throw new Error(code);
}

function assertPreparation(directory: string) {
  const preparationDirectory = join(directory, "alternative-review-probe-v1", "preparation");
  const expectedFiles = PREPARATION_FILES.flatMap((relativePath) => [relativePath, relativePath.replace(/\.json$/u, ".sha256")]).sort();
  const entries = readdirSync(preparationDirectory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) throw new Error("SHADOW_ALT_REVIEW_PREPARATION_SET_DRIFT");
  const actualFiles = entries
    .map((entry) => entry.name)
    .sort();
  if (stableHash(actualFiles) !== stableHash(expectedFiles)) throw new Error("SHADOW_ALT_REVIEW_PREPARATION_SET_DRIFT");
  for (const relativePath of PREPARATION_FILES) {
    const content = readFileSync(join(preparationDirectory, relativePath));
    const sidecarPath = relativePath.replace(/\.json$/u, ".sha256");
    if (readFileSync(join(preparationDirectory, sidecarPath), "utf8") !== `${sha256(content)}  ${relativePath}\n`) {
      throw new Error(`SHADOW_ALT_REVIEW_PREPARATION_HASH_DRIFT:${relativePath}`);
    }
  }
  const brief = readJson<Stage15ShadowAltReviewProbeBrief>(preparationDirectory, PREPARATION_FILES[0]);
  const registry = readJson<Stage15ShadowAltReviewSourceRegistry>(preparationDirectory, PREPARATION_FILES[1]);
  const request = readJson<Stage15ShadowAltReviewAccessRequest>(preparationDirectory, PREPARATION_FILES[2]);
  const readiness = readJson<JsonRecord>(preparationDirectory, PREPARATION_FILES[3]);
  const summary = readJson<JsonRecord>(preparationDirectory, PREPARATION_FILES[4]);
  assertStage15ShadowAltReviewBriefIntegrity(brief);
  assertStage15ShadowAltReviewRegistryIntegrity(registry);
  assertStage15ShadowAltReviewRequestIntegrity(request);
  assertSelfHash(readiness, "readinessHash", "SHADOW_ALT_REVIEW_PREPARATION_READINESS_DRIFT");
  assertSelfHash(summary, "summaryHash", "SHADOW_ALT_REVIEW_PREPARATION_SUMMARY_DRIFT");
  if (registry.briefHash !== brief.briefHash || request.briefHash !== brief.briefHash
    || request.registryHash !== registry.registryHash || readiness.requestHash !== request.requestHash
    || readiness.status !== "pending_user_access_approval" || readiness.executionAllowed !== false) {
    throw new Error("SHADOW_ALT_REVIEW_PREPARATION_CROSS_REFERENCE_DRIFT");
  }
  return { preparationDirectory, brief, registry, request };
}

function artifactPairs(values: Array<{ relativePath: string; value: unknown }>) {
  return values.flatMap(({ relativePath, value }) => {
    const content = jsonContent(value);
    return [
      { relativePath, content },
      { relativePath: relativePath.replace(/\.json$/u, ".sha256"), content: `${sha256(content)}  ${relativePath}\n` },
    ];
  });
}

export type Stage15ShadowAltReviewResult = {
  directory: string;
  evidence: Stage15ShadowAltReviewEvidencePackage;
  files: string[];
  write: { directory: string; written: string[]; unchanged: string[] };
};

export function generateStage15ShadowAltReviewResult(input: {
  batchDirectory: string;
  authorization: Stage15ShadowAltReviewAuthorization;
  accessLog: AltReviewAccessLogEntry[];
  captures: AltReviewCapture[];
  createdAt: string;
}): Stage15ShadowAltReviewResult {
  const batchDirectory = resolve(input.batchDirectory);
  const { brief, registry, request } = assertPreparation(batchDirectory);
  assertStage15ShadowAltReviewAuthorizationIntegrity(input.authorization);
  if (input.authorization.requestHash !== request.requestHash
    || input.authorization.registryHash !== registry.registryHash
    || stableHash(input.authorization.approvedBudget) !== stableHash(request.budget)
    || Date.parse(input.authorization.approvedAt) < Date.parse(request.createdAt)) {
    throw new Error("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  }
  for (const capture of input.captures) {
    const path = resolve(batchDirectory, capture.sourceCapture.relativePath);
    if (!path.startsWith(`${batchDirectory}${sep}`)) throw new Error("SHADOW_ALT_REVIEW_CAPTURE_FILE_DRIFT");
    let actual: string;
    try {
      actual = sha256(readFileSync(path));
    } catch {
      throw new Error("SHADOW_ALT_REVIEW_CAPTURE_FILE_DRIFT");
    }
    if (actual !== capture.sourceCapture.fileSha256) throw new Error("SHADOW_ALT_REVIEW_CAPTURE_FILE_DRIFT");
  }
  const evidence = buildStage15ShadowAltReviewEvidencePackage({
    brief,
    registry,
    request,
    authorization: input.authorization,
    accessLog: input.accessLog,
    captures: input.captures,
    createdAt: input.createdAt,
  });
  const accessLogBody = {
    schemaVersion: "stage15-shadow-alt-review-access-log.v1",
    batchId: request.batchId,
    requestHash: request.requestHash,
    authorizationHash: input.authorization.authorizationHash,
    entries: input.accessLog,
    recordedAt: input.createdAt,
  };
  const accessLog = { ...accessLogBody, accessLogHash: stableHash(accessLogBody) };
  const captureIndexBody = {
    schemaVersion: "stage15-shadow-alt-review-capture-index.v1",
    batchId: request.batchId,
    requestHash: request.requestHash,
    captures: input.captures.map((capture) => ({
      productKey: capture.productKey,
      sourceId: capture.sourceId,
      sourceUrl: capture.sourceUrl,
      relativePath: capture.sourceCapture.relativePath,
      fileSha256: capture.sourceCapture.fileSha256,
      capturedAt: capture.sourceCapture.capturedAt,
      captureHash: capture.captureHash,
    })),
  };
  const captureIndex = { ...captureIndexBody, captureIndexHash: stableHash(captureIndexBody) };
  const readinessBody = {
    schemaVersion: "stage15-shadow-alt-review-readiness.v1",
    batchId: request.batchId,
    requestHash: request.requestHash,
    evidenceHash: evidence.evidenceHash,
    ...evidence.readiness,
    createdAt: input.createdAt,
  };
  const readiness = { ...readinessBody, readinessHash: stableHash(readinessBody) };
  const values = [
    { relativePath: "stage15-shadow-alt-review-access-authorization.v1.json", value: input.authorization },
    { relativePath: "stage15-shadow-alt-review-access-log.v1.json", value: accessLog },
    { relativePath: "stage15-shadow-alt-review-capture-index.v1.json", value: captureIndex },
    { relativePath: "stage15-shadow-alt-review-evidence-package.v1.json", value: evidence },
    { relativePath: "stage15-shadow-alt-review-readiness.v1.json", value: readiness },
  ];
  const summaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-alt-review-result.v1",
    batchId: request.batchId,
    requestHash: request.requestHash,
    registryHash: registry.registryHash,
    authorizationHash: input.authorization.authorizationHash,
    evidenceHash: evidence.evidenceHash,
    status: evidence.readiness.status,
    counts: { captures: input.captures.length, eligibleProducts: evidence.readiness.eligibleProducts, terminalProducts: evidence.readiness.terminalProducts },
    outputs: values.map(({ relativePath, value }) => ({ relativePath, sha256: sha256(jsonContent(value)) })),
    boundary: { humanEvaluationAllowed: false, batchVUnlocked: false, policyCandidateGenerated: false, databaseWritten: false, productionEffect: false },
    createdAt: input.createdAt,
  };
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts = artifactPairs([...values, {
    relativePath: "generation-summary.stage15-shadow-alt-review-result.v1.json",
    value: summary,
  }]);
  const directoryName = `execution-${request.requestHash.slice(0, 12)}`;
  const write = writeArtifactSetAtomically(
    join(batchDirectory, "alternative-review-probe-v1"),
    directoryName,
    artifacts,
    "STAGE15_SHADOW_ALT_REVIEW_RESULT_CONFLICT",
  );
  return { directory: write.directory, evidence, files: artifacts.map((artifact) => artifact.relativePath), write };
}
