import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import type { RankingRun } from "../../lib/upstream/contracts";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import { validateStage15ShadowCombinedHumanEvaluationResult } from "./stage15-shadow-combined-human-evaluation";
import {
  finalizeStage15ShadowCombinedHumanEvaluation,
  type Stage15ShadowEvaluationBridge,
} from "./stage15-shadow-evaluation-bridge";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJsonFile(path: string): { path: string; fileName: string; fileSha256: string; value: unknown } {
  const absolutePath = resolve(path);
  const text = readFileSync(absolutePath, "utf8");
  return {
    path: absolutePath,
    fileName: basename(absolutePath),
    fileSha256: sha256(text),
    value: JSON.parse(text) as unknown,
  };
}

export function generateStage15ShadowCombinedHumanFinalization(input: {
  packetFile: string;
  bindingsFile: string;
  bridgeFile: string;
  rankingFile: string;
  completedResultFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const packetFile = readJsonFile(input.packetFile);
  const bindingsFile = readJsonFile(input.bindingsFile);
  const bridgeFile = readJsonFile(input.bridgeFile);
  const rankingFile = readJsonFile(input.rankingFile);
  const completedResultFile = readJsonFile(input.completedResultFile);
  const combinedResult = validateStage15ShadowCombinedHumanEvaluationResult(
    completedResultFile.value,
    packetFile.value as never,
    bindingsFile.value as never,
  );
  const finalization = finalizeStage15ShadowCombinedHumanEvaluation({
    bridge: bridgeFile.value as Stage15ShadowEvaluationBridge,
    rankingRun: rankingFile.value as RankingRun,
    combinedResult,
    createdAt: input.createdAt,
  });

  const primaryArtifacts: VersionedArtifact[] = [
    {
      relativePath: "stage15-shadow-combined-human-evaluation-result.v1.json",
      content: json(combinedResult),
    },
    {
      relativePath: "solo-novice-blind-review-responses.v1.json",
      content: json(finalization.noviceResponses),
    },
    {
      relativePath: "novice-market-screening-run.v1.json",
      content: json(finalization.screeningRun),
    },
    {
      relativePath: "novice-market-screening-acceptance.v1.json",
      content: json(finalization.acceptance),
    },
  ];
  const sourceFiles = [packetFile, bindingsFile, bridgeFile, rankingFile, completedResultFile]
    .map((file) => ({ fileName: file.fileName, fileSha256: file.fileSha256 }));
  const outputFiles = primaryArtifacts.map((artifact) => ({
    relativePath: artifact.relativePath,
    fileSha256: sha256(artifact.content),
  }));
  const summaryBody = {
    schemaVersion: "generation-summary.stage15-shadow-combined-finalization.v1" as const,
    batchId: finalization.batchId,
    status: "stage15_ready_shadow_packet_pending" as const,
    sourceFiles,
    outputFiles,
    canonicalHashes: {
      combinedResultHash: combinedResult.resultHash,
      screeningHash: finalization.screeningRun.screeningHash,
      acceptanceHash: finalization.acceptance.evidenceHash,
      finalizationHash: finalization.finalizationHash,
    },
    boundary: finalization.boundary,
    createdAt: input.createdAt,
  };
  const summary = { ...summaryBody, summaryHash: stableHash(summaryBody) };
  const artifacts: VersionedArtifact[] = [
    ...primaryArtifacts,
    {
      relativePath: "generation-summary.stage15-shadow-combined-finalization.v1.json",
      content: json(summary),
    },
  ];
  const directory = resolve(input.outputDirectory);
  const artifactWrite = writeArtifactsIdempotently(
    directory,
    artifacts,
    "STAGE15_SHADOW_COMBINED_FINALIZATION_CONFLICT",
  );
  return {
    combinedResult,
    ...finalization,
    summary,
    files: artifacts.map((artifact) => artifact.relativePath),
    artifactWrite,
  };
}
