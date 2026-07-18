import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently, type VersionedArtifact } from "./artifact-writer";
import {
  buildStage15EffectivenessPilot,
  type Stage15PilotVisualPacket,
} from "./stage15-effectiveness-pilot";
import type { NoviceMarketScreeningRun } from "./novice-market-screening";

type GenerateStage15EffectivenessPilotInput = {
  screeningRunFile: string;
  visualPacketFile: string;
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

export function generateStage15EffectivenessPilot(input: GenerateStage15EffectivenessPilotInput) {
  const screening = readJson(input.screeningRunFile, "STAGE15_PILOT_SCREENING_JSON_INVALID");
  const visual = readJson(input.visualPacketFile, "STAGE15_PILOT_VISUAL_JSON_INVALID");
  const built = buildStage15EffectivenessPilot({
    screeningRun: screening.value as NoviceMarketScreeningRun,
    visualPacket: visual.value as Stage15PilotVisualPacket,
    createdAt: input.createdAt,
  });
  const files = [
    "stage15-effectiveness-pilot-protocol.v1.json",
    "stage15-effectiveness-pilot-blind-packet.v1.json",
    "stage15-effectiveness-pilot-result-template.v1.json",
    "generation-summary.stage15-effectiveness-pilot.v1.json",
    "README-有效性Pilot说明.md",
  ];
  const summaryBody = {
    schemaVersion: "stage15-effectiveness-pilot-generation-summary.v1",
    createdAt: input.createdAt,
    sourceFiles: [screening, visual].map(({ name, sha256 }) => ({ name, sha256 })),
    sourceScreeningHash: built.protocol.sourceScreeningHash,
    protocolHash: built.protocol.protocolHash,
    blindPacketHash: built.blindPacket.packetHash,
    resultTemplateHash: built.resultTemplate.evidenceHash,
    sampleSummary: built.protocol.sampleSummary,
    status: "engineering_protocol_frozen_pilot_not_started",
    engineeringConclusion: "deterministic_comparable_sample_protocol_verified",
    effectivenessConclusion: "screening_effectiveness_not_validated",
    externalWebsiteAccessed: false,
    externalAiApiCalled: false,
    stage2FieldsConsumed: false,
    formalCandidateGenerated: false,
    productionDatabaseWritten: false,
    files,
  } as const;
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const readme = `# Stage 1.5 有效性 Pilot\n\n`
    + `- 固定样本：5 个 advance + 5 个只因 Top-K 配额不足的可比 watch。\n`
    + `- 对照抽样：固定 Hash 无放回抽样；不会使用人工门禁失败、reject 或 insufficient 作为容易失败的对照。\n`
    + `- 盲化：复验材料不显示 advance/control、Stage 1 排名/分数、锁定市场指标或原人工回答。\n`
    + `- 证据：当前全部为 missing，必须以后用新产生且可追溯的独立证据填写；本轮未访问网站。\n`
    + `- 结论：协议工程冻结，Pilot 尚未开始；仍为 screening_effectiveness_not_validated。\n`
    + `- 单批完成最多只能写 effectiveness_pilot_completed，不能宣布筛选有效、能赚钱或商业验证通过。\n`;
  const artifacts: VersionedArtifact[] = [
    { relativePath: files[0], content: json(built.protocol) },
    { relativePath: files[1], content: json(built.blindPacket) },
    { relativePath: files[2], content: json(built.resultTemplate) },
    { relativePath: files[3], content: json(summary) },
    { relativePath: files[4], content: readme },
  ];
  const artifactWrite = writeArtifactsIdempotently(
    input.outputDirectory,
    artifacts,
    "STAGE15_PILOT_OUTPUT_CONFLICT",
  );
  return { ...built, summary, files, artifactWrite };
}
