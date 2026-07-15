import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { QualityGateResult, RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import {
  buildNoviceMarketScreeningAcceptance,
  buildNoviceMarketScreeningRun,
  type NoviceMarketScreeningInput,
  type NoviceScreeningMarketEvidence,
} from "./novice-market-screening";

type GenerateInput = {
  humanAssistedRunFile: string;
  rankingFile: string;
  blindReviewFile: string;
  novicePacketFile: string;
  responsesFile: string;
  outputDirectory: string;
  createdAt: string;
};

type HumanAssistedRun = {
  schemaVersion?: string;
  sourceAdapter?: {
    sourceBatchId?: string;
    qualitySummary?: Partial<QualityGateResult>;
    pipeline?: {
      contextGate?: Partial<QualityGateResult>;
      layoutGate?: Partial<QualityGateResult>;
      importPackage?: {
        candidates?: Array<{
          candidateId?: string;
          productKey?: string;
          evidenceSnapshot?: {
            evidenceSnapshotId?: string;
            inputHash?: string;
          };
          minimumEvidencePack?: {
            schemaVersion?: string;
            complete?: boolean;
            missingEvidence?: unknown[];
          };
        }>;
      };
    };
  };
};

function readJsonFile(path: string, errorCode: string) {
  const resolved = resolve(path);
  const bytes = readFileSync(resolved);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(errorCode);
  }
  return {
    name: basename(resolved),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

function qualityGate(value: Partial<QualityGateResult> | undefined): QualityGateResult {
  const status = value?.status === "passed" || value?.status === "failed" || value?.status === "quarantined"
    ? value.status
    : "failed";
  return {
    schemaVersion: "quality-gate-result.v1",
    status,
    errorCodes: Array.isArray(value?.errorCodes)
      ? value.errorCodes.filter((item): item is string => typeof item === "string")
      : ["unknown_quality_gate"],
    missingReasons: Array.isArray(value?.missingReasons)
      ? value.missingReasons.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function marketEvidenceFromRun(value: HumanAssistedRun): NoviceScreeningMarketEvidence {
  const adapter = value.sourceAdapter;
  const pipeline = adapter?.pipeline;
  const sourceBatchId = adapter?.sourceBatchId;
  if (value.schemaVersion !== "human-assisted-amazon-run.v2" || typeof sourceBatchId !== "string" || !sourceBatchId) {
    throw new Error("NOVICE_SCREENING_HUMAN_RUN_INVALID");
  }
  const candidates = pipeline?.importPackage?.candidates;
  if (!Array.isArray(candidates)) throw new Error("NOVICE_SCREENING_HUMAN_RUN_INVALID");

  return {
    schemaVersion: "novice-screening-market-evidence.v1",
    sourceBatchId,
    qualityGates: {
      source: qualityGate(adapter?.qualitySummary),
      context: qualityGate(pipeline?.contextGate),
      layout: qualityGate(pipeline?.layoutGate),
    },
    candidates: candidates.map((candidate) => {
      const minimum = candidate.minimumEvidencePack;
      if (typeof candidate.candidateId !== "string"
        || typeof candidate.productKey !== "string"
        || typeof candidate.evidenceSnapshot?.evidenceSnapshotId !== "string"
        || typeof candidate.evidenceSnapshot.inputHash !== "string"
        || minimum?.schemaVersion !== "minimum-evidence-pack.v1"
        || typeof minimum.complete !== "boolean") {
        throw new Error("NOVICE_SCREENING_CANDIDATE_BINDING_INVALID");
      }
      return {
        candidateId: candidate.candidateId,
        productKey: candidate.productKey,
        evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
        inputEvidenceHash: candidate.evidenceSnapshot.inputHash,
        minimumEvidencePack: {
          schemaVersion: "minimum-evidence-pack.v1",
          complete: minimum.complete,
          missingEvidence: Array.isArray(minimum.missingEvidence)
            ? minimum.missingEvidence.filter((item): item is string => typeof item === "string")
            : ["unknown_minimum_evidence"],
        },
      };
    }),
  };
}

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateNoviceMarketScreening(input: GenerateInput) {
  const humanRun = readJsonFile(input.humanAssistedRunFile, "NOVICE_SCREENING_HUMAN_RUN_JSON_INVALID");
  const ranking = readJsonFile(input.rankingFile, "NOVICE_SCREENING_RANKING_JSON_INVALID");
  const blindReview = readJsonFile(input.blindReviewFile, "NOVICE_SCREENING_BLIND_REVIEW_JSON_INVALID");
  const novicePacket = readJsonFile(input.novicePacketFile, "NOVICE_SCREENING_PACKET_JSON_INVALID");
  const responses = readJsonFile(input.responsesFile, "NOVICE_SCREENING_RESPONSES_JSON_INVALID");
  const screeningInput: NoviceMarketScreeningInput = {
    ranking: ranking.value as RankingRun,
    marketEvidence: marketEvidenceFromRun(humanRun.value as HumanAssistedRun),
    blindReview: blindReview.value as NoviceMarketScreeningInput["blindReview"],
    novicePacket: novicePacket.value as NoviceMarketScreeningInput["novicePacket"],
    responses: responses.value as NoviceMarketScreeningInput["responses"],
    createdAt: input.createdAt,
  };
  const run = buildNoviceMarketScreeningRun(screeningInput);
  const replay = buildNoviceMarketScreeningRun(screeningInput);
  const acceptance = buildNoviceMarketScreeningAcceptance(run, replay.screeningHash);
  const files = [
    "novice-market-screening-run.v1.json",
    "novice-market-screening-acceptance.v1.json",
    "generation-summary.novice-market-screening.v1.json",
    "README-调查短名单预览.md",
  ];
  const summaryBody = {
    schemaVersion: "novice-market-screening-generation-summary.v1",
    createdAt: input.createdAt,
    sourceFiles: [humanRun, ranking, blindReview, novicePacket, responses]
      .map(({ name, sha256 }) => ({ name, sha256 })),
    inputHash: run.inputHash,
    screeningHash: run.screeningHash,
    acceptanceEvidenceHash: acceptance.evidenceHash,
    itemCounts: run.summary,
    engineeringConclusion: acceptance.engineering.conclusion,
    effectivenessConclusion: acceptance.effectiveness.conclusion,
    selectionMechanism: run.selectionMechanism,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    externalWebsiteAccessed: false,
    externalAiApiCalled: false,
    stage2FieldsConsumed: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const guide = `# 调查短名单预览\n\n`
    + `- 输入：锁定的 20 条 Amazon Canary Stage 1、市场层证据和新手人工原始回答。\n`
    + `- 四态：advance=${run.summary.advance}、watch=${run.summary.watch}、reject=${run.summary.reject}、insufficient=${run.summary.insufficient}。\n`
    + `- advance 仅表示本批 Top-K 调查配额，不表示商品质量、盈利能力或商业验证通过。\n`
    + `- 工程结论：\`${acceptance.engineering.conclusion}\`。\n`
    + `- 有效性结论：\`${acceptance.effectiveness.conclusion}\`；当前只是确定性的机械 Top 5。\n`
    + `- 未读取 Stage 2 字段，未生成正式 Candidate，未写数据库，未访问网站，未调用 AI。\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: jsonContent(run) },
    { relativePath: files[1], content: jsonContent(acceptance) },
    { relativePath: files[2], content: jsonContent(summary) },
    { relativePath: files[3], content: guide },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "NOVICE_SCREENING_OUTPUT_CONFLICT",
  );
  return { files, run, acceptance, summary, artifactWrite };
}
