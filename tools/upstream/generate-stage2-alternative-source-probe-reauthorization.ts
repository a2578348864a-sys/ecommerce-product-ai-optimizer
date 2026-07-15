import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourceProbeReauthorizationRequest,
  validateStage2AlternativeSourceProbeReauthorizationRequest,
} from "./stage2-alternative-source-probe-reauthorization";

const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), "utf8")) as T;
const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function handoff(input: {
  phrase: string;
  requestId: string;
  briefHash: string;
  priorRunEvidenceHash: string;
  diagnosticEvidenceHash: string;
}): string {
  return `# Capability-Probe-02 单次真实能力探针授权交接\n\n`
    + `当前状态：\`pending_user_authorization\`。材料存在不代表已授权，程序不得因为本文件存在而访问网站。\n\n`
    + `## 为什么需要 Probe-02\n\n`
    + `Probe-01 已权威失败为 unknown_page；新增离线诊断只能在下一次单次真实导航中补充分离后的结构证据，不能追认旧运行。\n\n`
    + `## 固定范围\n\n`
    + `- 1 次公开 robots 请求、1 次 Made-in-China 搜索页导航。\n`
    + `- 0 次商品页、0 次自动重试、0 个供应商字段。\n`
    + `- 使用系统 Chrome、全新临时 Profile、动态 loopback CDP。\n`
    + `- unknown_page 诊断只记录白名单计数和安全路径；它不能自动放行采集。\n`
    + `- 不登录、不询盘、不处理 Captcha、不切代理、不写数据库、不生成 Candidate、不调用 AI。\n\n`
    + `## 如确认，请原样回复\n\n`
    + `\`${input.phrase}\`\n\n`
    + `这句话只授权一次 Probe-02，不授权商品页、供应商字段或 Stage 2 submission。\n\n`
    + `Authorization Request ID：\`${input.requestId}\`\n\n`
    + `Brief Hash：\`${input.briefHash}\`\n\n`
    + `Probe-01 Run Evidence Hash：\`${input.priorRunEvidenceHash}\`\n\n`
    + `Unknown-page Diagnostic Evidence Hash：\`${input.diagnosticEvidenceHash}\`\n`;
}

function checklist(): string {
  return `# Capability-Probe-02 执行前核对清单\n\n`
    + `- [ ] 用户在当前对话原样确认 Probe-02 授权短语。\n`
    + `- [ ] Brief、基础离线验证、Probe-01 已消费授权、Probe-01 失败运行和 unknown_page 诊断 Hash 全部一致。\n`
    + `- [ ] 输出目录全新，授权未消费；系统 Chrome 使用全新临时 Profile 和动态 loopback CDP。\n`
    + `- [ ] robots 最多1次、搜索页最多1次、商品页0次、自动重试0次。\n`
    + `- [ ] 任一政策、Origin、Captcha、登录/询盘、错误页、unknown 或清理异常立即 fail-closed。\n`
    + `- [ ] 结束后确认页面/浏览器关闭、端口释放、Profile 删除和进程基线恢复。\n`;
}

export function generateStage2AlternativeSourceProbeReauthorizationMaterials(input: {
  briefFile: string;
  baselineOfflineValidationFile: string;
  priorAuthorizationFile: string;
  priorRunFile: string;
  unknownPageDiagnosticValidationFile: string;
  outputDirectory: string;
  createdAt: string;
}) {
  const brief = readJson<Stage2AlternativeSourceBrief>(input.briefFile);
  const baselineOfflineValidation = readJson<Record<string, unknown>>(input.baselineOfflineValidationFile);
  const priorAuthorization = readJson<Record<string, unknown>>(input.priorAuthorizationFile);
  const priorRun = readJson<Record<string, unknown>>(input.priorRunFile);
  const unknownPageDiagnosticValidation = readJson<Record<string, unknown>>(
    input.unknownPageDiagnosticValidationFile,
  );
  const evidence = {
    brief,
    baselineOfflineValidation,
    priorAuthorization,
    priorRun,
    unknownPageDiagnosticValidation,
  };
  const request = buildStage2AlternativeSourceProbeReauthorizationRequest({
    ...evidence,
    createdAt: input.createdAt,
  });
  const validation = validateStage2AlternativeSourceProbeReauthorizationRequest({ request, ...evidence });
  if (validation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_REQUEST_INVALID");
  }
  const files = [
    "stage2-alternative-source-capability-probe-authorization-request.v2.json",
    "stage2-alternative-source-capability-probe-authorization-validation.v2.json",
    "01-用户授权交接.md",
    "02-执行范围核对清单.md",
    "generation-summary.stage2-alternative-source-probe-reauthorization.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-reauthorization-generation-summary.v1" as const,
    status: request.status,
    authorizationRequestId: request.authorizationRequestId,
    requestHash: request.requestHash,
    briefHash: request.briefHash,
    baselineOfflineValidationEvidenceHash: request.baselineOfflineValidationEvidenceHash,
    priorAuthorizationEvidenceHash: request.priorAuthorizationEvidenceHash,
    priorRunEvidenceHash: request.priorRunEvidenceHash,
    unknownPageDiagnosticValidationEvidenceHash: request.unknownPageDiagnosticValidationEvidenceHash,
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
    { relativePath: files[2], content: handoff({
      phrase: request.authorizationPhrase,
      requestId: request.authorizationRequestId,
      briefHash: request.briefHash,
      priorRunEvidenceHash: request.priorRunEvidenceHash,
      diagnosticEvidenceHash: request.unknownPageDiagnosticValidationEvidenceHash,
    }) },
    { relativePath: files[3], content: checklist() },
    { relativePath: files[4], content: jsonContent(summary) },
  ], "STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_OUTPUT_CONFLICT");
  return { request, validation, summary, artifactWrite };
}
