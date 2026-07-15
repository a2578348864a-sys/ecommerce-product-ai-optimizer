import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  validateStage2EvidenceSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import {
  buildStage2PublicCostResearchBrief,
  validateStage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";
import {
  buildStage2PublicCostDerivationPreview,
  buildStage2PublicCostEvidenceTemplate,
} from "./stage2-public-cost-evidence";
import { STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT } from "./stage2-public-cost-research-authorization";

type GeneratorInput = {
  inventoryFile: string;
  submissionFile: string;
  validationFile: string;
  sampleId: string;
  createdAt: string;
  outputDirectory: string;
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildAuthorizationGuide() {
  return `# Stage2-Public-Cost-Research-01 醒来后只需确认\n\n`
    + `本文件不是授权，当前不会访问任何网站。\n\n`
    + `## 固定研究范围\n\n`
    + `- 只处理 stage2-high-01。\n`
    + `- 只读取 Federal Reserve 的公开 CNY/USD 汇率证据，以及 Amazon 官方公开的 US Referral Fee 与 FBA Fulfillment Fee。\n`
    + `- 允许 Origin 仅为 https://www.federalreserve.gov 与 https://sell.amazon.com。\n`
    + `- 总导航最多 6 次、自动重试 0 次；遇到登录、Captcha、访问拒绝、非预期跳转、无法确认类目或生效日期立即停止。\n`
    + `- 不会查询头程、包装、仓储、退货准备金或合规结论；这些字段继续保持 null。\n`
    + `- 不会直接修改 Stage 2 submission、计算最终利润、生成 Candidate 或写数据库。\n\n`
    + `## 若要继续，请回复完整授权语句\n\n`
    + `${STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT}\n`;
}

export function generateStage2PublicCostResearchBrief(input: GeneratorInput) {
  const inventory = readJson<Stage2EvidenceGapInventory>(input.inventoryFile);
  const submission = readJson<Stage2EvidenceSubmission>(input.submissionFile);
  const sourceValidation = readJson<ReturnType<typeof validateStage2EvidenceSubmission>>(input.validationFile);
  const brief = buildStage2PublicCostResearchBrief({
    inventory,
    submission,
    sourceValidation,
    sampleId: input.sampleId,
    createdAt: input.createdAt,
  });
  const validation = validateStage2PublicCostResearchBrief(brief);
  if (validation.status !== "valid_pending_authorization") {
    throw new Error("STAGE2_PUBLIC_COST_BRIEF_GENERATION_INVALID");
  }
  const template = buildStage2PublicCostEvidenceTemplate(brief);
  const preview = buildStage2PublicCostDerivationPreview(brief, template);
  const files = [
    "stage2-public-cost-research-brief.v1.json",
    "stage2-public-cost-evidence.template.v1.json",
    "stage2-public-cost-derivation-preview.template.v1.json",
    "README-醒来后只需确认.md",
    "generation-summary.stage2-public-cost-research.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-public-cost-research-generation-summary.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    sampleId: brief.sample.sampleId,
    status: validation.status,
    unresolvedOutsideThisResearch: brief.unresolvedOutsideThisResearch,
    boundary: {
      userAuthorizationGranted: false,
      externalWebsiteAccessed: false,
      evidenceCollected: false,
      stage2SubmissionMutated: false,
      profitCalculated: false,
      candidateCreated: false,
      databaseWritten: false,
      externalAiApiCalled: false,
    },
    files,
  };
  const outputDirectory = resolve(input.outputDirectory);
  const artifactWrite = writeArtifactsIdempotently(outputDirectory, [
    { relativePath: files[0], content: jsonContent(brief) },
    { relativePath: files[1], content: jsonContent(template) },
    { relativePath: files[2], content: jsonContent(preview) },
    { relativePath: files[3], content: buildAuthorizationGuide() },
    { relativePath: files[4], content: jsonContent({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_PUBLIC_COST_BRIEF_OUTPUT_CONFLICT");
  return {
    outputDirectory,
    files,
    artifactWrite,
    status: validation.status,
    sampleId: brief.sample.sampleId,
  };
}
