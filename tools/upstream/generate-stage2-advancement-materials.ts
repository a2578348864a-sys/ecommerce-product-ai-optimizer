import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage2CalibrationFromSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import {
  buildCandidateAdvancementPreview,
  buildStage2HumanDecisionTemplate,
  validateStage2HumanDecisionSubmission,
  type Stage2SourcePacket,
} from "./stage2-advancement";
import { writeArtifactsIdempotently } from "./artifact-writer";

type GeneratorInput = {
  inventoryFile: string;
  evidenceSubmissionFile: string;
  stage2PacketFile: string;
  rankingFile: string;
  outputDirectory: string;
  decidedAt: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildReadme(sampleCount: number, readySampleCount: number) {
  const blockedSampleCount = sampleCount - readySampleCount;
  return `# Stage 2 人工决定与 Candidate 导入前预览\n\n`
    + `当前 ${sampleCount} 条样本中，${readySampleCount} 条已具备客观证据资格，${blockedSampleCount} 条仍被证据门禁阻断。\n`
    + `本目录只为证据就绪样本等待人工决定；生成的 Candidate 始终只是未落库预览。\n\n`
    + `## 使用顺序\n\n`
    + `1. 先完成上一目录的真实客观证据录入与校验。\n`
    + `2. 只有校准状态为 real_evidence_ready_for_human_decision，才逐条填写 continue／stop／hold 和理由。\n`
    + `3. 新证据不会自动替你继续、恢复或淘汰；决定必须显式人工填写。\n`
    + `4. continue 只生成导入前预览，不会写数据库，也不会创建正式 Candidate。\n`
    + `5. 正式保存仍需要服务端来源证明、Owner／Visitor 鉴权和数据库事务验证。\n`;
}

export function generateStage2AdvancementMaterials(input: GeneratorInput) {
  const inventory = readJson<Stage2EvidenceGapInventory>(input.inventoryFile);
  const evidenceSubmission = readJson<Stage2EvidenceSubmission>(input.evidenceSubmissionFile);
  const stage2Packet = readJson<Stage2SourcePacket>(input.stage2PacketFile);
  const ranking = readJson<RankingRun>(input.rankingFile);
  const calibration = buildStage2CalibrationFromSubmission(inventory, evidenceSubmission);
  const decisions = buildStage2HumanDecisionTemplate(calibration, {
    decisionBatchId: "stage2-human-decision-template-01",
    decidedAt: input.decidedAt,
    decidedBy: "pending_project_owner_decision",
  });
  const decisionValidation = validateStage2HumanDecisionSubmission(calibration, decisions);
  const preview = buildCandidateAdvancementPreview({ ranking, stage2Packet, calibration, decisions });
  const output = resolve(input.outputDirectory);
  const objectiveEvidenceReadySampleCount = calibration.samples
    .filter((sample) => sample.evidenceStatus === "ready_for_calibration").length;
  const objectiveEvidenceBlockedSampleCount = calibration.samples.length - objectiveEvidenceReadySampleCount;

  const files = [
    "stage2-human-decision.template.v1.json",
    "stage2-human-decision-validation.blocked.v1.json",
    "candidate-advancement-preview.blocked.v1.json",
    "README-Stage2人工决定与Candidate预览.md",
    "generation-summary.stage2-advancement.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-advancement-generation-summary.v1" as const,
    sourceGapInventoryHash: inventory.packetHash,
    sourceEvidenceSubmissionHash: stableHash(evidenceSubmission),
    sourceCalibrationInputHash: calibration.inputHash,
    decisionStatus: decisionValidation.status,
    previewStatus: preview.status,
    sampleCount: decisions.decisions.length,
    candidatePreviewCount: preview.candidates.length,
    boundary: {
      objectiveEvidenceComplete: objectiveEvidenceReadySampleCount === calibration.samples.length,
      objectiveEvidencePartiallyReady: objectiveEvidenceReadySampleCount > 0
        && objectiveEvidenceReadySampleCount < calibration.samples.length,
      objectiveEvidenceReadySampleCount,
      objectiveEvidenceBlockedSampleCount,
      humanDecisionRecorded: false,
      candidateCreated: false,
      databaseWritten: false,
      apiCalled: false,
      authorizationProven: false,
      databaseTransactionProven: false,
      externalWebsiteAccessed: false,
      externalAiApiCalled: false,
      stage1RankingModified: false,
    },
    files,
  };
  const artifactWrite = writeArtifactsIdempotently(output, [
    { relativePath: files[0], content: jsonContent(decisions) },
    { relativePath: files[1], content: jsonContent(decisionValidation) },
    { relativePath: files[2], content: jsonContent(preview) },
    { relativePath: files[3], content: buildReadme(decisions.decisions.length, objectiveEvidenceReadySampleCount) },
    { relativePath: files[4], content: jsonContent({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_ADVANCEMENT_OUTPUT_CONFLICT");
  return {
    outputDirectory: output,
    files,
    artifactWrite,
    decisionStatus: decisionValidation.status,
    previewStatus: preview.status,
    candidatePreviewCount: preview.candidates.length,
  };
}
