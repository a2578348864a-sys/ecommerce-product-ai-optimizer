import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";
import {
  buildStage15ShadowBlindEvaluation,
  buildStage15ShadowBlindEvaluationReadme,
} from "./stage15-shadow-blind-evaluation";

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateStage15ShadowPreparation(input: {
  batch: Stage15ShadowBatch;
  presentationByProductKey: Record<string, {
    titleZh: string;
    purposeZh: string;
    image: { status: "available" | "not_cached"; dataUrl: string | null; missingReason: string | null };
    price: unknown;
    dimensions: unknown;
    material: unknown;
  }>;
  outputDirectory: string;
  createdAt: string;
}) {
  const material = buildStage15ShadowBlindEvaluation({
    batch: input.batch,
    packetVersion: "stage15-shadow-blind-evaluation-packet.v1",
    presentationByProductKey: input.presentationByProductKey,
    createdAt: input.createdAt,
  });
  const files = [
    "stage15-shadow-batch.v1.json",
    "stage15-shadow-observations.v1.json",
    "stage15-shadow-blind-evaluation-packet.v1.json",
    "stage15-shadow-blind-evaluation-bindings.private.v1.json",
    "stage15-shadow-blind-evaluation-result-template.v1.json",
    "README-影子校准盲化评价说明.md",
    "generation-summary.stage15-shadow-revalidation.v1.json",
  ];
  const bindings = {
    schemaVersion: "stage15-shadow-blind-evaluation-bindings.private.v1",
    batchHash: input.batch.batchHash,
    packetHash: material.packet.packetHash,
    bindings: material.bindings,
    bindingHash: stableHash(material.bindings),
  };
  const observations = {
    schemaVersion: "stage15-shadow-observations.v1",
    batchId: input.batch.batchId,
    observations: input.batch.observations,
    observationsHash: stableHash(input.batch.observations),
  };
  const summaryBody = {
    schemaVersion: "stage15-shadow-revalidation-generation-summary.v1",
    batchId: input.batch.batchId,
    batchRole: input.batch.role,
    batchHash: input.batch.batchHash,
    packetHash: material.packet.packetHash,
    bindingHash: bindings.bindingHash,
    itemCount: material.packet.itemCount,
    readiness: input.batch.readiness,
    status: "pending_human_evaluation",
    createdAt: input.createdAt,
    externalWebsiteAccessedDuringGeneration: false,
    aiOrPaidApiCalled: false,
    databaseWritten: false,
    stage1OrStage15Mutated: false,
    candidateGenerated: false,
    productionEffect: false,
    effectivenessConclusion: "screening_effectiveness_not_validated",
    files,
  } as const;
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: json(input.batch) },
    { relativePath: files[1], content: json(observations) },
    { relativePath: files[2], content: json(material.packet) },
    { relativePath: files[3], content: json(bindings) },
    { relativePath: files[4], content: json(material.resultTemplate) },
    { relativePath: files[5], content: buildStage15ShadowBlindEvaluationReadme() },
    { relativePath: files[6], content: json(summary) },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_SHADOW_OUTPUT_CONFLICT",
  );
  return { ...material, observations, bindings, summary, files, artifactWrite };
}
