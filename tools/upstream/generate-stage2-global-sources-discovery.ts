import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildStage2AlternativeSourceSelection,
  buildStage2GlobalSourcesDiscoveryBrief,
  validateStage2GlobalSourcesDiscoveryPackage,
} from "./stage2-global-sources-discovery";

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function handoff(): string {
  return `# Global Sources C1A 来源发现授权交接\n\n`
    + `用户已选择 Decision Brief-03 的 C，并确认 C1A 离线方案。历史 Made-in-China Probe-01/02 失败证据保持不变。\n\n`
    + `## 重要边界\n\n`
    + `本文件不是授权，也不证明 Global Sources 当前可访问或具备公开商品能力。\n\n`
    + `后续如获一次性明确授权，固定预算为：robots 1 次、精确公开页面主导航最多 2 次、商品页 0、供应商字段 0、自动重试 0。\n\n`
    + `任何 robots unknown/disallow、重定向、未知 Origin 或路径、注册/登录、Captcha、访问拒绝、错误页或 unknown 页面均立即停止。\n\n`
    + `## 下一安全任务\n\n`
    + `重新申请一次 Global Sources C1A 来源发现授权；未授权前不得访问真实网站。\n`;
}

export function generateStage2GlobalSourcesDiscoveryMaterials(input: {
  decisionBriefFile: string;
  researchFile: string;
  probe1RunFile: string;
  probe2RunFile: string;
  outputDirectory: string;
  approvedAt: string;
  createdAt: string;
}) {
  const decisionBrief = readJson(input.decisionBriefFile);
  const research = readJson(input.researchFile);
  const probe1Run = readJson(input.probe1RunFile);
  const probe2Run = readJson(input.probe2RunFile);
  const selection = buildStage2AlternativeSourceSelection({
    decisionBrief,
    research,
    probe1Run,
    probe2Run,
    approvedAt: input.approvedAt,
    approvedBy: "project_owner",
  });
  const discoveryBrief = buildStage2GlobalSourcesDiscoveryBrief({
    selection,
    createdAt: input.createdAt,
  });
  const validation = validateStage2GlobalSourcesDiscoveryPackage({
    decisionBrief,
    research,
    probe1Run,
    probe2Run,
    selection,
    discoveryBrief,
  });
  if (validation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_GLOBAL_SOURCES_DISCOVERY_PACKAGE_INVALID");
  }
  const files = [
    "stage2-alternative-source-selection.v1.json",
    "stage2-global-sources-discovery-brief.v1.json",
    "stage2-global-sources-discovery-validation.v1.json",
    "01-Global-Sources来源发现授权交接.md",
    "generation-summary.stage2-global-sources-discovery.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-global-sources-discovery-generation-summary.v1" as const,
    status: discoveryBrief.status,
    selectionId: selection.selectionId,
    selectionHash: selection.selectionHash,
    briefId: discoveryBrief.briefId,
    briefHash: discoveryBrief.briefHash,
    validationInputHash: validation.inputHash,
    realWebsiteAccessedDuringGeneration: false as const,
    externalAuthorizationGranted: false as const,
    productPagesAccessed: 0 as const,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    historicalEvidenceReclassified: false as const,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const artifactWrite = writeArtifactsIdempotently(input.outputDirectory, [
    { relativePath: files[0], content: jsonContent(selection) },
    { relativePath: files[1], content: jsonContent(discoveryBrief) },
    { relativePath: files[2], content: jsonContent(validation) },
    { relativePath: files[3], content: handoff() },
    { relativePath: files[4], content: jsonContent(summary) },
  ], "STAGE2_GLOBAL_SOURCES_DISCOVERY_OUTPUT_CONFLICT");
  return { selection, discoveryBrief, validation, summary, artifactWrite };
}
