import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceDecisionBrief,
  validateStage2AlternativeSourceDecisionBrief,
} from "./stage2-alternative-source-decision-brief";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), "utf8")) as T;
const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function handoff(): string {
  return `# Made-in-China Probe-02 后续来源决策\n\n`
    + `两次能力探针均未产生允许商品链接。Probe-02 新增诊断观察到通用商品结构、同 Origin 宽松路径和供应商子域名路径，但精确允许路径仍为0。\n\n`
    + `因此当前唯一工程结论是：不原样重试。供应商子域名的出现不等于允许访问，也不证明它是唯一商品路径。\n\n`
    + `## 需要你稍后选择\n\n`
    + `A. 停止 Made-in-China 当前策略。\n\n`
    + `B. 单独设计供应商子域名政策与安全探针；任何真实访问需重新授权。\n\n`
    + `C. 更换公开来源并重新冻结 Brief；任何真实调查需重新授权。\n\n`
    + `系统尚未替你选择，当前仍为 \`pending_user_decision\`。\n`;
}

export function generateStage2AlternativeSourceDecisionBriefMaterials(input: {
  briefFile: string;
  probe1RunFile: string;
  probe2RunFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const brief = readJson<Stage2AlternativeSourceBrief>(input.briefFile);
  const probe1Run = readJson<Record<string, unknown>>(input.probe1RunFile);
  const probe2Run = readJson<Record<string, unknown>>(input.probe2RunFile);
  const decisionBrief = buildStage2AlternativeSourceDecisionBrief({
    brief, probe1Run, probe2Run, createdAt: input.createdAt,
  });
  const validation = validateStage2AlternativeSourceDecisionBrief({
    decisionBrief, brief, probe1Run, probe2Run,
  });
  if (validation.status !== "valid_pending_user_decision") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_DECISION_BRIEF_INVALID");
  }
  const files = [
    "stage2-alternative-source-decision-brief.v1.json",
    "stage2-alternative-source-decision-brief-validation.v1.json",
    "01-用户来源决策交接.md",
    "generation-summary.stage2-alternative-source-decision-brief.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-decision-brief-generation-summary.v1" as const,
    status: decisionBrief.status,
    decisionBriefId: decisionBrief.decisionBriefId,
    decisionBriefEvidenceHash: decisionBrief.evidenceHash,
    validationInputHash: validation.inputHash,
    realWebsiteAccessedDuringGeneration: false as const,
    userDecisionRecorded: false as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(decisionBrief) },
    { relativePath: files[1], content: jsonContent(validation) },
    { relativePath: files[2], content: handoff() },
    { relativePath: files[3], content: jsonContent(summary) },
  ], "STAGE2_ALTERNATIVE_SOURCE_DECISION_BRIEF_OUTPUT_CONFLICT");
  return { decisionBrief, validation, summary, artifactWrite };
}
