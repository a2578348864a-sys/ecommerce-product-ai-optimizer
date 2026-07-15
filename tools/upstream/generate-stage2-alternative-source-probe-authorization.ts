import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceProbeAuthorizationRequest,
  validateStage2AlternativeSourceProbeAuthorizationRequest,
} from "./stage2-alternative-source-probe-authorization";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildHandoff(input: {
  requestId: string;
  phrase: string;
  briefHash: string;
  offlineValidationEvidenceHash: string;
}): string {
  return `# Made-in-China 单次真实能力探针授权交接\n\n`
    + `当前状态：\`pending_user_authorization\`。材料存在不代表已授权，程序不得因为本文件存在而访问网站。\n\n`
    + `## 固定范围\n\n`
    + `- 1 次公开 robots 请求。\n`
    + `- 1 次 Made-in-China 搜索页导航。\n`
    + `- 0 次商品页导航，0 次自动重试。\n`
    + `- 只验证页面能力和最多 2 个白名单商品链接，不采集供应商字段。\n`
    + `- 使用系统 Chrome、全新临时 Profile、动态 loopback CDP；异常时 fail-closed 并清理。\n`
    + `- 不登录、不询盘、不处理 Captcha、不切代理、不写数据库、不生成 Candidate、不调用 AI。\n\n`
    + `## 如确认，请原样回复\n\n`
    + `\`${input.phrase}\`\n\n`
    + `这句话只授权一次能力探针，不授权商品取证、供应商字段采集或 Stage 2 submission。\n\n`
    + `Authorization Request ID：\`${input.requestId}\`\n\n`
    + `Brief Hash：\`${input.briefHash}\`\n\n`
    + `Offline Validation Evidence Hash：\`${input.offlineValidationEvidenceHash}\`\n`;
}

function buildChecklist(): string {
  return `# 单次真实能力探针执行范围核对清单\n\n`
    + `执行前必须同时满足：\n\n`
    + `- [ ] 用户在当前对话原样确认授权短语。\n`
    + `- [ ] 授权 Request ID、Brief Hash 和离线验证 Hash 与本包一致。\n`
    + `- [ ] 使用全新临时 Profile、动态 loopback CDP 和系统 Chrome。\n`
    + `- [ ] 输出目录是新的，未消费过同一授权。\n\n`
    + `运行中必须保持：\n\n`
    + `- [ ] robots 请求最多 1 次；搜索页导航最多 1 次；商品页 0 次；重试 0 次。\n`
    + `- [ ] 只保存脱敏页面诊断和白名单商品 URL，不采集价格、MOQ、包装或供应商字段。\n`
    + `- [ ] robots unknown/disallow、异常 origin、Captcha、登录/询盘、403/503、浏览器错误页或 unknown 页面立即停止。\n\n`
    + `结束时必须确认页面/浏览器关闭、动态端口释放、临时 Profile 删除和 Chrome 进程基线恢复。任一清理项失败不得报告探针成功。\n`;
}

export function generateStage2AlternativeSourceProbeAuthorizationMaterials(input: {
  briefFile: string;
  offlineValidationFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const brief = readJson<Stage2AlternativeSourceBrief>(input.briefFile);
  const offlineValidation = readJson<Record<string, unknown>>(input.offlineValidationFile);
  const request = buildStage2AlternativeSourceProbeAuthorizationRequest({
    brief,
    offlineValidation,
    createdAt: input.createdAt,
  });
  const validation = validateStage2AlternativeSourceProbeAuthorizationRequest({
    request,
    brief,
    offlineValidation,
  });
  if (validation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_REQUEST_INVALID");
  }
  const files = [
    "stage2-alternative-source-capability-probe-authorization-request.v1.json",
    "stage2-alternative-source-capability-probe-authorization-validation.v1.json",
    "01-用户授权交接.md",
    "02-执行范围核对清单.md",
    "generation-summary.stage2-alternative-source-probe-authorization.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization-generation-summary.v1" as const,
    status: request.status,
    authorizationRequestId: request.authorizationRequestId,
    requestHash: request.requestHash,
    briefId: request.briefId,
    briefHash: request.briefHash,
    offlineValidationEvidenceHash: request.offlineValidationEvidenceHash,
    validationInputHash: validation.inputHash,
    authorizationGranted: false as const,
    realWebsiteAccessedDuringGeneration: false as const,
    runtimeProbeExecuted: false as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(request) },
    { relativePath: files[1], content: jsonContent(validation) },
    { relativePath: files[2], content: buildHandoff({
      requestId: request.authorizationRequestId,
      phrase: request.authorizationPhrase,
      briefHash: request.briefHash,
      offlineValidationEvidenceHash: request.offlineValidationEvidenceHash,
    }) },
    { relativePath: files[3], content: buildChecklist() },
    { relativePath: files[4], content: jsonContent(summary) },
  ], "STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_OUTPUT_CONFLICT");
  return { request, validation, summary, artifactWrite };
}
