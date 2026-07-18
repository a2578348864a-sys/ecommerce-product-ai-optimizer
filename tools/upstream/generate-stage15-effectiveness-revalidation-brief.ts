import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import {
  buildStage15EffectivenessPilot,
  buildStage15EffectivenessRevalidationBrief,
} from "./stage15-effectiveness-pilot";

type PilotArtifacts = ReturnType<typeof buildStage15EffectivenessPilot>;

type GenerateInput = {
  protocolFile: string;
  blindPacketFile: string;
  outputDirectory: string;
  createdAt: string;
};

function readJson(path: string, errorCode: string) {
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

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function generateStage15EffectivenessRevalidationBrief(input: GenerateInput) {
  const protocol = readJson(input.protocolFile, "STAGE15_REVALIDATION_PROTOCOL_JSON_INVALID");
  const blindPacket = readJson(input.blindPacketFile, "STAGE15_REVALIDATION_PACKET_JSON_INVALID");
  const brief = buildStage15EffectivenessRevalidationBrief(
    protocol.value as PilotArtifacts["protocol"],
    blindPacket.value as PilotArtifacts["blindPacket"],
    input.createdAt,
  );
  const files = [
    "stage15-effectiveness-revalidation-brief.v1.json",
    "01-用户授权交接.md",
    "generation-summary.stage15-effectiveness-revalidation-brief.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage15-effectiveness-revalidation-brief-generation-summary.v1",
    createdAt: input.createdAt,
    sourceFiles: [protocol, blindPacket].map(({ name, sha256 }) => ({ name, sha256 })),
    briefHash: brief.briefHash,
    status: brief.status,
    targetCount: brief.targets.length,
    productDetailNavigationBudget: brief.accessBudget.productDetailNavigations,
    retryBudget: brief.accessBudget.retries,
    userAuthorizationPresent: false,
    externalWebsiteAccessed: false,
    stage2FieldsConsumed: false,
    productionDatabaseWritten: false,
    externalAiApiCalled: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const handoff = `# Stage 1.5 A 独立证据复验授权交接\n\n`
    + `当前状态：\`pending_user_authorization\`，本文件不是访问授权。\n\n`
    + `固定范围：独立临时Chrome；Amazon.com；已绑定10个商品详情路径；每项最多1次导航；搜索页0；重试0。\n`
    + `只采集协议中的6类新时点公开商品事实，不保存完整HTML、Cookie、Token、账号或私人数据。\n`
    + `遇到Captcha、登录墙、访问拒绝、异常跳转、unknown页面或清理失败立即停止，不自动重试。\n`
    + `只生成Evidence，不自动判定continue/stop，不修改Stage 1/1.5，不进入Stage 2、Candidate或数据库。\n\n`
    + `若同意，可回复：\`我确认按 stage15-effectiveness-revalidation-brief.v1 固定范围执行一次 A 独立证据复验。\`\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: json(brief) },
    { relativePath: files[1], content: handoff },
    { relativePath: files[2], content: json(summary) },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_REVALIDATION_BRIEF_OUTPUT_CONFLICT",
  );
  return { brief, summary, files, artifactWrite };
}
