import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2EvidenceGapInventory } from "./stage2-evidence-intake";
import type { Stage2SourcePacket } from "./stage2-advancement";
import {
  buildStage2EvidenceCollectionBrief,
  validateStage2EvidenceCollectionBrief,
} from "./stage2-evidence-collection-brief";
import { writeArtifactsIdempotently } from "./artifact-writer";

type GeneratorInput = {
  inventoryFile: string;
  stage2PacketFile: string;
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

function buildGuide() {
  return `# Stage 2 high-01 公开证据取证授权材料\n\n`
    + `本文件不是授权，程序不会自动执行。它只把下一次最小真实取证范围写清楚，等你醒来后统一确认。\n\n`
    + `## 建议授权范围\n\n`
    + `- 样本：仅 stage2-high-01。\n`
    + `- 请求站点：仅 https://www.alibaba.com 的公开页面。\n`
    + `- 最多 4 次页面导航：搜索结果最多 1 页、供应商商品页最多 3 页。\n`
    + `- 只核验供应商链接、同一变体、采集时间、MOQ、单件采购成本，以及页面明确展示的包装长宽高和重量。\n`
    + `- 页面没有展示的值继续保持 null + missingReason，不推算、不换算、不补猜。\n\n`
    + `## 自动停止\n\n`
    + `遇到 Captcha、登录墙、访问拒绝、未知页面、非预期域名跳转、无法确认同一变体或访问预算耗尽，立即停止且不重试。\n\n`
    + `## 不会执行\n\n`
    + `不会登录、读取私人 Profile/Cookie、绕过风控、使用代理或反检测、调用付费 API/AI、写数据库、创建 Candidate、修改 Stage 1、Commit、Push 或部署。\n`;
}

export function generateStage2EvidenceCollectionBrief(input: GeneratorInput) {
  const inventory = readJson<Stage2EvidenceGapInventory>(input.inventoryFile);
  const stage2Packet = readJson<Stage2SourcePacket>(input.stage2PacketFile);
  const brief = buildStage2EvidenceCollectionBrief({
    inventory,
    stage2Packet,
    sampleId: input.sampleId,
    createdAt: input.createdAt,
  });
  const validation = validateStage2EvidenceCollectionBrief(brief);
  if (validation.status !== "valid_pending_authorization") {
    throw new Error("STAGE2_COLLECTION_BRIEF_GENERATION_INVALID");
  }
  const output = resolve(input.outputDirectory);
  const files = [
    "stage2-evidence-collection-brief.v1.json",
    "README-授权前请确认.md",
    "generation-summary.stage2-collection-brief.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-evidence-collection-brief-generation-summary.v1" as const,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    sampleId: brief.sample.sampleId,
    status: validation.status,
    boundary: {
      userAuthorizationGranted: false,
      externalWebsiteAccessed: false,
      evidenceCollected: false,
      candidateCreated: false,
      databaseWritten: false,
      externalAiApiCalled: false,
    },
    files,
  };
  const artifactWrite = writeArtifactsIdempotently(output, [
    { relativePath: files[0], content: jsonContent(brief) },
    { relativePath: files[1], content: buildGuide() },
    { relativePath: files[2], content: jsonContent({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_COLLECTION_BRIEF_OUTPUT_CONFLICT");
  return { outputDirectory: output, files, artifactWrite, status: validation.status, sampleId: brief.sample.sampleId };
}
