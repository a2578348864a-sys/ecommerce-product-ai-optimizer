import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { buildStage15ShadowEvaluationBridge } from "./stage15-shadow-evaluation-bridge";
import { buildStage15ShadowPublicSource, parseAmazonBestSellersMarkdown } from "./stage15-shadow-public-source";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(directory: string, name: string) {
  const text = readFileSync(join(directory, name), "utf8");
  return { text, sha256: sha256(text), value: JSON.parse(text) as Record<string, any> };
}

export function generateStage15ShadowEvaluationBridge(input: {
  batchDirectory: string;
  role: "calibration" | "validation";
  createdAt: string;
}) {
  const directory = resolve(input.batchDirectory);
  const manifestFile = readJson(directory, "stage15-shadow-upstream-manifest.v1.json");
  const briefFile = readJson(directory, "selection-brief.v1.json");
  const collectionFile = readJson(directory, "collection-run.v2.json");
  const sourceAdapterFile = readJson(directory, "source-adapter-result.v1.json");
  const importFile = readJson(directory, "import-package.v1.json");
  const rankingFile = readJson(directory, "ranking-run.v1.json");
  const packetFile = readJson(directory, "stage15-shadow-combined-human-evaluation-packet.v1.json");
  const bindingsFile = readJson(directory, "stage15-shadow-combined-human-evaluation-bindings.private.v1.json");
  const sourceMarkdown = readFileSync(join(directory, "source-capture.amazon-bestsellers.md"), "utf8");
  const manifest = manifestFile.value;
  const { manifestHash, ...manifestBody } = manifest;
  if (manifest.schemaVersion !== "stage15-shadow-upstream-manifest.v1" || manifest.role !== input.role
    || stableHash(manifestBody) !== manifestHash || Number.isNaN(Date.parse(input.createdAt))
    || manifest.sourceFile?.sha256 !== sha256(sourceMarkdown)) {
    throw new Error("SHADOW_EVALUATION_BRIDGE_MANIFEST_INVALID");
  }
  const brief = briefFile.value;
  const collection = collectionFile.value;
  const records = parseAmazonBestSellersMarkdown(sourceMarkdown, { maxSamples: 20 });
  if (records.length !== 20) throw new Error("SHADOW_EVALUATION_BRIDGE_SOURCE_COUNT_INVALID");
  const ranks = records.map((record) => record.rank);
  const page = ranks.every((rank) => rank > 50) ? 2 as const : ranks.every((rank) => rank <= 50) ? 1 as const : null;
  if (page === null || typeof brief.query !== "string" || typeof brief.category !== "string"
    || typeof brief.targetScenario !== "string" || typeof collection.sourceUrl !== "string"
    || typeof brief.targetPriceRange?.min !== "number" || typeof brief.targetPriceRange?.max !== "number") {
    throw new Error("SHADOW_EVALUATION_BRIDGE_SOURCE_CONTEXT_INVALID");
  }
  const source = buildStage15ShadowPublicSource({
    role: input.role,
    batchId: manifest.batchId,
    briefId: brief.briefId,
    collectionRunId: collection.collectionRunId,
    query: brief.query,
    category: brief.category,
    targetScenario: brief.targetScenario,
    targetPriceRange: { min: brief.targetPriceRange.min, max: brief.targetPriceRange.max },
    sourceUrl: collection.sourceUrl,
    sourceMarkdown,
    sourceFileSha256: sha256(sourceMarkdown),
    page,
    capturedAt: collection.capturedAt,
  });
  const savedAdapter = sourceAdapterFile.value;
  const adapterBindingsMatch = savedAdapter.sourceBatchId === source.sourceAdapterResult.sourceBatchId
    && savedAdapter.sourceInputHash === source.sourceAdapterResult.sourceInputHash
    && savedAdapter.acceptedCount === source.sourceAdapterResult.acceptedCount
    && stableHash(savedAdapter.qualitySummary) === stableHash(source.sourceAdapterResult.qualitySummary);
  if (stableHash(source.brief) !== stableHash(brief)
    || stableHash(source.collectionRun) !== stableHash(collection)
    || stableHash(source.importPackage) !== stableHash(importFile.value)
    || stableHash(source.rankingRun) !== stableHash(rankingFile.value)
    || !adapterBindingsMatch) {
    throw new Error("SHADOW_EVALUATION_BRIDGE_REPLAY_DRIFT");
  }
  const bridge = buildStage15ShadowEvaluationBridge({
    source,
    combinedPacket: packetFile.value as never,
    combinedBindings: bindingsFile.value as never,
    sourceUpstreamManifestHash: manifest.manifestHash,
    createdAt: input.createdAt,
  });
  const bridgeContent = json(bridge);
  const bridgeFileSha256 = sha256(bridgeContent);
  const sidecar = `${bridgeFileSha256}  stage15-shadow-evaluation-bridge.private.v1.json\n`;
  const supplementBody = {
    schemaVersion: "stage15-shadow-evaluation-bridge-supplement.v1" as const,
    batchId: manifest.batchId,
    role: input.role,
    sourceUpstreamManifest: {
      manifestId: manifest.manifestId,
      manifestHash: manifest.manifestHash,
      fileSha256: manifestFile.sha256,
    },
    sourceArtifacts: {
      selectionBriefSha256: briefFile.sha256,
      collectionRunSha256: collectionFile.sha256,
      sourceAdapterResultSha256: sourceAdapterFile.sha256,
      importPackageSha256: importFile.sha256,
      rankingRunSha256: rankingFile.sha256,
      combinedPacketSha256: packetFile.sha256,
      combinedBindingsSha256: bindingsFile.sha256,
      sourceCaptureSha256: sha256(sourceMarkdown),
    },
    privateBridge: {
      relativePath: "stage15-shadow-evaluation-bridge.private.v1.json",
      fileSha256: bridgeFileSha256,
      canonicalHash: bridge.bridgeHash,
    },
    status: input.role === "calibration"
      ? "ready_for_completed_human_result" as const
      : "bridge_frozen_waiting_policy_and_human_result" as const,
    boundary: {
      frozenUpstreamManifestModified: false as const,
      externalWebsiteAccessedDuringGeneration: false as const,
      humanAnswersPresent: false as const,
      databaseWritten: false as const,
      candidateGenerated: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  const supplement = { ...supplementBody, supplementHash: stableHash(supplementBody) };
  const artifacts: VersionedArtifact[] = [
    { relativePath: "stage15-shadow-evaluation-bridge.private.v1.json", content: bridgeContent },
    { relativePath: "stage15-shadow-evaluation-bridge.private.v1.sha256", content: sidecar },
    { relativePath: "evaluation-bridge-supplement.v1.json", content: json(supplement) },
  ];
  const artifactWrite = writeArtifactsIdempotently(directory, artifacts, "STAGE15_SHADOW_EVALUATION_BRIDGE_CONFLICT");
  return { bridge, supplement, files: artifacts.map((artifact) => artifact.relativePath), artifactWrite };
}
