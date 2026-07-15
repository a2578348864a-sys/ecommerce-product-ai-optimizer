import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import type { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";
import {
  buildStage2PublicRevalidationBrief,
  validateStage2PublicRevalidationBrief,
} from "./stage2-public-revalidation-brief";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildHandoff(briefId: string, briefHash: string): string {
  return `# Stage2-high-01 单次重验授权交接\n\n`
    + `当前状态：\`pending_user_authorization\`。本文件不是授权，也不会触发真实网站访问。\n\n`
    + `## 为什么需要重验\n\n`
    + `上一轮真实运行已标记为 \`non_authoritative_failed_evidence\`：搜索页存在未允许的 HTTP 中间跳转，旧实现没有立即停止，后续页面证据又出现冲突。历史运行不会被覆盖或追认为成功。\n\n`
    + `## 已完成的离线修复\n\n`
    + `- 每个 redirect origin 都必须精确等于 \`https://www.alibaba.com\`，否则立即停止。\n`
    + `- Chrome 内部错误页有独立分类；诊断 final URL 使用实际 DOM location。\n`
    + `- Cookie、Local/Session Storage、凭据和密码值探针被拒绝。\n`
    + `- 标题相似不足以确认同一变体；价格区间不得写成 BOM。\n\n`
    + `## 固定范围\n\n`
    + `- 样本：\`stage2-high-01\`。\n`
    + `- 站点：仅 Alibaba 公开页面，允许 origin 只有 \`https://www.alibaba.com\`。\n`
    + `- 一次运行；最多1个搜索页、3个商品页、总计4次导航；自动重试0次。\n`
    + `- 不登录、不使用私人 Profile、不读取 Cookie/Storage、不处理验证码、不切换代理、不使用反检测。\n`
    + `- 不写数据库、不生成 Candidate、不修改 Stage 1、不调用 AI 或付费 API。\n`
    + `- 遇登录、Captcha、访问拒绝、未知页、内部错误、任一异常重定向或无法确认同一变体，立即失败并停止。\n\n`
    + `## 如决定继续，请回复\n\n`
    + `> 我明确授权按 stage2-public-revalidation-brief.v1 的固定范围，使用独立临时 Chrome 对 Alibaba 公开页面重验 stage2-high-01；仅一次运行，最多4次导航，不登录、不绕过、不重试。\n\n`
    + `Brief ID：\`${briefId}\`  \nBrief Hash：\`${briefHash}\`\n`;
}

export function generateStage2PublicRevalidationMaterials(input: {
  originalBriefFile: string;
  failedRunFile: string;
  failedReviewFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const brief = buildStage2PublicRevalidationBrief({
    originalBrief: readJson<Stage2EvidenceCollectionBrief>(input.originalBriefFile),
    failedRun: readJson<ReturnType<typeof buildStage2PublicRunEvidence>>(input.failedRunFile),
    failedReview: readJson<ReturnType<typeof reviewStage2PublicRunEvidence>>(input.failedReviewFile),
    createdAt: input.createdAt,
  });
  const validation = validateStage2PublicRevalidationBrief(brief);
  if (validation.status !== "valid_pending_authorization") throw new Error("STAGE2_REVALIDATION_GENERATION_INVALID");
  const summaryBody = {
    schemaVersion: "stage2-public-revalidation-generation-summary.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    validationInputHash: validation.inputHash,
    status: validation.status,
    realWebsiteAccessed: false,
    authorizationGranted: false,
    candidateGenerated: false,
    databaseWritten: false,
    files: [
      "stage2-public-revalidation-brief.v1.json",
      "stage2-public-revalidation-brief-validation.v1.json",
      "01-用户授权交接.md",
      "generation-summary.stage2-public-revalidation.v1.json",
    ],
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: summaryBody.files[0], content: jsonContent(brief) },
    { relativePath: summaryBody.files[1], content: jsonContent(validation) },
    { relativePath: summaryBody.files[2], content: buildHandoff(brief.briefId, brief.briefHash) },
    { relativePath: summaryBody.files[3], content: jsonContent(summary) },
  ], "STAGE2_REVALIDATION_OUTPUT_CONFLICT");
  return { brief, validation, summary, artifactWrite };
}
