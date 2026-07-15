import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage2EvidenceGapInventory,
  type SoloStage2CalibrationPacket,
} from "./solo-validation-materials";

type GeneratorInput = {
  stage2PacketFile: string;
  outputDirectory: string;
};

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseStage2Packet(path: string): SoloStage2CalibrationPacket {
  const value = JSON.parse(readFileSync(path, "utf8")) as SoloStage2CalibrationPacket;
  if (value.schemaVersion !== "solo-stage2-objective-calibration-packet.v1"
    || !Array.isArray(value.samples)
    || typeof value.packetHash !== "string") {
    throw new Error("STAGE2_GAP_SOURCE_PACKET_INVALID");
  }
  return value;
}

function buildGuide(inventory: ReturnType<typeof buildStage2EvidenceGapInventory>) {
  const sampleLines = inventory.samples.map((sample) =>
    `- \`${sample.sampleId}\`：${sample.sourceEvidence.title ?? "标题缺失"}；缺 ${sample.evidenceGaps.length} 项客观证据；利润状态=${sample.currentProfitStatus}。`,
  ).join("\n");
  return `# Stage 2 证据缺口怎么填\n\n`
    + `你不需要先成为 Amazon 运营。这个清单只回答“还缺什么事实”，不要求你凭感觉判断商品能不能卖。\n\n`
    + `## 当前结论\n\n`
    + `- 样本数：${inventory.summary.sampleCount}\n`
    + `- 仍无法计算利润：${inventory.summary.samplesBlockedForProfit}\n`
    + `- 客观证据缺口：${inventory.summary.missingEvidenceFieldCount}\n`
    + `- 待人工决定字段：${inventory.summary.pendingHumanDecisionFieldCount}\n\n`
    + `## 建议取证顺序\n\n`
    + `1. 先确认供应商链接、同一变体、MOQ 和单件采购成本。\n`
    + `2. 再确认包装长宽高、毛重、运输方案和单件头程。\n`
    + `3. 再核对平台佣金、FBA、包装、仓储和退货准备金。\n`
    + `4. 最后记录合规来源、安装/质量/耐用性等执行风险。\n`
    + `5. 只有关键证据齐全后才计算利润并填写继续／停止决定。\n\n`
    + `不知道就保持 null；不要从售价、评分、评论数、图片或 AI 说明推算采购成本、物流费、耐用性和合规结论。\n\n`
    + `## 7 条样本\n\n${sampleLines}\n`;
}

export function generateStage2EvidenceGapInventory(input: GeneratorInput) {
  const source = parseStage2Packet(resolve(input.stage2PacketFile));
  const inventory = buildStage2EvidenceGapInventory(source);
  const output = resolve(input.outputDirectory);
  mkdirSync(output, { recursive: true });
  const files = [
    "stage2-evidence-gap-inventory.v1.json",
    "README-Stage2证据缺口怎么填.md",
    "generation-summary.stage2-gaps.v1.json",
  ];
  writeJson(resolve(output, files[0]), inventory);
  writeFileSync(resolve(output, files[1]), buildGuide(inventory), "utf8");
  const summaryBody = {
    schemaVersion: "solo-stage2-evidence-gap-generation-summary.v1" as const,
    sourcePacketHash: inventory.sourcePacketHash,
    inventoryPacketHash: inventory.packetHash,
    summary: inventory.summary,
    files,
    sourceStage2PacketModified: false,
    stage1RankingModified: false,
    externalWebsiteAccessed: false,
    productionDatabaseWritten: false,
    externalAiApiCalled: false,
  };
  writeJson(resolve(output, files[2]), { ...summaryBody, evidenceHash: stableHash(summaryBody) });
  return { outputDirectory: output, files, summary: inventory.summary };
}
