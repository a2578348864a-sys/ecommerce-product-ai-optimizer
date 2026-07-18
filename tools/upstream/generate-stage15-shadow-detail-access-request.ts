import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildStage15ShadowDetailAccessRequest } from "./stage15-shadow-detail-access";

type Manifest = {
  schemaVersion: string;
  manifestId: string;
  batchId: string;
  role: string;
  manifestHash: string;
  createdAt: string;
  artifacts: Array<{ relativePath: string; sha256: string; canonicalStableHash: string | null }>;
};

type Bindings = {
  schemaVersion: string;
  batchId: string;
  packetHash: string;
  bindings: Array<{ productKey: string; platformProductId: string; sourceUrl: string }>;
  bindingHash: string;
};

type Packet = {
  schemaVersion: string;
  packetHash: string;
  items: Array<{ evaluationItemId: string }>;
};

type AccessBudget = {
  schemaVersion: string;
  batchId: string;
  maxDetailPageRequests: number;
  detailPagesAccessed: number;
  maxAutomaticRetries: number;
  maxImageDownloads: number;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson<T>(directory: string, relativePath: string) {
  const text = readFileSync(join(directory, relativePath), "utf8");
  return { text, fileSha256: sha256(text), value: JSON.parse(text) as T };
}

function withoutHash<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const body = { ...value };
  delete body[key];
  return body;
}

function verifyManifestArtifact(manifest: Manifest, relativePath: string, text: string, value: unknown): void {
  const entry = manifest.artifacts.find((artifact) => artifact.relativePath === relativePath);
  if (!entry || entry.sha256 !== sha256(text)
    || (entry.canonicalStableHash !== null && entry.canonicalStableHash !== stableHash(value))) {
    throw new Error(`SHADOW_DETAIL_REQUEST_SOURCE_HASH_DRIFT:${relativePath}`);
  }
}

export function generateStage15ShadowDetailAccessRequest(input: {
  batchDirectory: string;
  createdAt: string;
}) {
  const directory = resolve(input.batchDirectory);
  const manifestFile = readJson<Manifest>(directory, "stage15-shadow-upstream-manifest.v1.json");
  const bindingsFile = readJson<Bindings>(directory, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json");
  const packetFile = readJson<Packet>(directory, "stage15-shadow-combined-human-evaluation-packet.v1.json");
  const budgetFile = readJson<AccessBudget>(directory, "stage15-shadow-access-budget.v1.json");
  const manifest = manifestFile.value;
  const bindings = bindingsFile.value;
  const packet = packetFile.value;
  const budget = budgetFile.value;
  if (manifest.role !== "calibration") throw new Error("SHADOW_DETAIL_REQUEST_CALIBRATION_ONLY");
  const manifestBody = withoutHash(manifest as unknown as Record<string, unknown>, "manifestHash");
  const bindingsBody = withoutHash(bindings as unknown as Record<string, unknown>, "bindingHash");
  const packetBody = withoutHash(packet as unknown as Record<string, unknown>, "packetHash");
  if (manifest.schemaVersion !== "stage15-shadow-upstream-manifest.v1"
    || stableHash(manifestBody) !== manifest.manifestHash || !/^[a-f0-9]{64}$/u.test(manifestFile.fileSha256)
    || bindings.schemaVersion !== "stage15-shadow-combined-human-evaluation-bindings.private.v1"
    || bindings.batchId !== manifest.batchId || stableHash(bindingsBody) !== bindings.bindingHash
    || packet.schemaVersion !== "stage15-shadow-combined-human-evaluation-packet.v1"
    || stableHash(packetBody) !== packet.packetHash || bindings.packetHash !== packet.packetHash
    || bindings.bindings.length !== 20 || packet.items.length !== 20
    || budget.schemaVersion !== "stage15-shadow-access-budget.v1" || budget.batchId !== manifest.batchId
    || budget.maxDetailPageRequests !== 0 || budget.detailPagesAccessed !== 0
    || budget.maxAutomaticRetries !== 0 || budget.maxImageDownloads !== 0
    || Number.isNaN(Date.parse(input.createdAt)) || Date.parse(input.createdAt) < Date.parse(manifest.createdAt)) {
    throw new Error("SHADOW_DETAIL_REQUEST_SOURCE_INVALID");
  }
  verifyManifestArtifact(manifest, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json", bindingsFile.text, bindings);
  verifyManifestArtifact(manifest, "stage15-shadow-combined-human-evaluation-packet.v1.json", packetFile.text, packet);
  verifyManifestArtifact(manifest, "stage15-shadow-access-budget.v1.json", budgetFile.text, budget);

  const request = buildStage15ShadowDetailAccessRequest({
    schemaVersion: "stage15-shadow-detail-access-request-input.v1",
    batchId: manifest.batchId,
    role: "calibration",
    sourceManifest: {
      manifestId: manifest.manifestId,
      manifestHash: manifest.manifestHash,
      fileSha256: manifestFile.fileSha256,
    },
    targets: bindings.bindings.map((binding) => ({
      productKey: binding.productKey,
      platformProductId: binding.platformProductId,
      sourceUrl: binding.sourceUrl,
    })),
    proposedBudget: {
      maxDetailPageRequests: 20,
      maxRequestsPerProduct: 1,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
    },
    createdAt: input.createdAt,
  });
  const requestContent = json(request);
  const requestFileSha256 = sha256(requestContent);
  const requestSidecar = `${requestFileSha256}  stage15-shadow-detail-access-request.v1.json\n`;
  const startGateBody = {
    schemaVersion: "stage15-shadow-human-evaluation-start-gate.v1" as const,
    batchId: manifest.batchId,
    sourceManifestHash: manifest.manifestHash,
    sourcePacketHash: packet.packetHash,
    sourceDetailAccessRequestHash: request.requestHash,
    status: "hold_pending_detail_access_decision" as const,
    humanEvaluationAllowed: false as const,
    existingWorkbenchInvalidated: false as const,
    existingWorkbenchUse: "descriptive_stage15_only_if_user_declines_detail_enrichment" as const,
    policyCandidateCanFreeze: false as const,
    reasonCodes: [
      "detail_access_budget_pending_user_approval",
      "exact_variant_review_coverage_0_of_10",
      "packet_regeneration_required_if_detail_access_approved",
    ],
    boundary: {
      frozenUpstreamManifestModified: false as const,
      externalWebsiteAccessed: false as const,
      humanAnswersPresent: false as const,
      databaseWritten: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  const startGate = { ...startGateBody, gateHash: stableHash(startGateBody) };
  const primaryArtifacts: VersionedArtifact[] = [
    { relativePath: "stage15-shadow-detail-access-request.v1.json", content: requestContent },
    { relativePath: "stage15-shadow-detail-access-request.v1.sha256", content: requestSidecar },
    { relativePath: "stage15-shadow-human-evaluation-start-gate.v1.json", content: json(startGate) },
  ];
  const summaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-detail-access-request.v1" as const,
    batchId: manifest.batchId,
    status: "pending_user_approval" as const,
    sourceFiles: {
      upstreamManifestSha256: manifestFile.fileSha256,
      bindingsSha256: bindingsFile.fileSha256,
      packetSha256: packetFile.fileSha256,
      currentAccessBudgetSha256: budgetFile.fileSha256,
    },
    outputs: primaryArtifacts.map((artifact) => ({ relativePath: artifact.relativePath, sha256: sha256(artifact.content) })),
    boundary: startGate.boundary,
    createdAt: input.createdAt,
  };
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts: VersionedArtifact[] = [
    ...primaryArtifacts,
    { relativePath: "generation-summary.stage15-shadow-detail-access-request.v1.json", content: json(summary) },
  ];
  const artifactWrite = writeArtifactsIdempotently(directory, artifacts, "STAGE15_SHADOW_DETAIL_ACCESS_REQUEST_CONFLICT");
  return { request, startGate, summary, files: artifacts.map((artifact) => artifact.relativePath), artifactWrite };
}
