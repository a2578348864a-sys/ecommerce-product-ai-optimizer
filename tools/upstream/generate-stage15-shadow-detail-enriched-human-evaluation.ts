import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { renderStage15ShadowEvaluationWorkbench } from "./generate-stage15-shadow-evaluation-workbench";
import type { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import type { buildStage15ShadowDetailEnrichedHumanMaterials } from "./stage15-shadow-detail-enriched-human-materials";

type Materials = ReturnType<typeof buildStage15ShadowDetailEnrichedHumanMaterials>;
type SourceManifest = ReturnType<typeof generateStage15ShadowPublicUpstream>["manifest"];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function withoutHash<T extends Record<string, unknown>>(value: T, key: keyof T) {
  const body = { ...value };
  delete body[key];
  return body;
}

export function generateStage15ShadowDetailEnrichedHumanEvaluation(input: {
  materials: Materials;
  sourceManifest: SourceManifest;
  sourceManifestFileSha256: string;
  sourceBatchDirectory: string;
  createdAt: string;
}) {
  const sourceDirectory = resolve(input.sourceBatchDirectory);
  const outputDirectory = join(sourceDirectory, "detail-enriched-evaluation-v1");
  const materialsBody = withoutHash(input.materials as unknown as Record<string, unknown>, "materialsHash");
  const manifestBody = withoutHash(input.sourceManifest as unknown as Record<string, unknown>, "manifestHash");
  if (stableHash(materialsBody) !== input.materials.materialsHash
    || input.materials.readiness.status !== "ready_for_human_evaluation"
    || input.materials.readiness.exactVariantReviewCoverage < 10
    || input.sourceManifest.schemaVersion !== "stage15-shadow-upstream-manifest.v1"
    || input.sourceManifest.role !== "calibration"
    || input.sourceManifest.batchId !== input.materials.readiness.batchId
    || stableHash(manifestBody) !== input.sourceManifest.manifestHash
    || !/^[a-f0-9]{64}$/u.test(input.sourceManifestFileSha256)
    || Number.isNaN(Date.parse(input.createdAt))
    || Date.parse(input.createdAt) < Date.parse(input.materials.readiness.createdAt)) {
    throw new Error("SHADOW_DETAIL_ENRICHED_GENERATION_INPUT_INVALID");
  }
  const html = renderStage15ShadowEvaluationWorkbench({
    packet: input.materials.packet,
    resultTemplate: input.materials.resultTemplate,
    role: "calibration",
    locked: false,
  });
  const htmlSha256 = sha256(html);
  const primaryArtifacts: VersionedArtifact[] = [
    { relativePath: "stage15-shadow-combined-human-evaluation-packet.v1.json", content: json(input.materials.packet) },
    { relativePath: "stage15-shadow-combined-human-evaluation-bindings.private.v1.json", content: json(input.materials.bindings) },
    { relativePath: "stage15-shadow-combined-human-evaluation-result-template.v1.json", content: json(input.materials.resultTemplate) },
    { relativePath: "stage15-shadow-detail-enriched-human-readiness.v1.json", content: json(input.materials.readiness) },
    { relativePath: "human-evaluation-workbench.html", content: html },
    { relativePath: "human-evaluation-workbench.sha256", content: `${htmlSha256}  human-evaluation-workbench.html\n` },
  ];
  const summaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-detail-enriched-human-evaluation.v1" as const,
    batchId: input.sourceManifest.batchId,
    status: "ready_for_human_evaluation" as const,
    sourceManifest: {
      manifestId: input.sourceManifest.manifestId,
      manifestHash: input.sourceManifest.manifestHash,
      fileSha256: input.sourceManifestFileSha256,
    },
    sourceDetailEvidencePackageHash: input.materials.readiness.sourceDetailEvidencePackageHash,
    enrichedPacketHash: input.materials.packet.packetHash,
    materialsHash: input.materials.materialsHash,
    outputs: primaryArtifacts.map((artifact) => ({ relativePath: artifact.relativePath, sha256: sha256(artifact.content) })),
    sourceV1Overwritten: false as const,
    boundary: {
      externalWebsiteAccessedDuringGeneration: false as const,
      aiOrPaidApiCalled: false as const,
      databaseWritten: false as const,
      candidateGenerated: false as const,
      stage1OrStage15WeightsChanged: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts: VersionedArtifact[] = [
    ...primaryArtifacts,
    { relativePath: "generation-summary.stage15-shadow-detail-enriched-human-evaluation.v1.json", content: json(summary) },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    outputDirectory,
    artifacts,
    "STAGE15_SHADOW_DETAIL_ENRICHED_HUMAN_EVALUATION_CONFLICT",
  );
  return { html, htmlSha256, summary, outputDirectory, files: artifacts.map((artifact) => artifact.relativePath), artifactWrite };
}
