import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildNoviceBlindReviewPacket,
  buildSoloStage2CalibrationPacket,
  type BlindReviewMaterialInput,
} from "./solo-validation-materials";

type GeneratorInput = {
  rankingFile: string;
  blindReviewFile: string;
  outputDirectory: string;
};

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseRanking(path: string): RankingRun {
  const value = JSON.parse(readFileSync(path, "utf8")) as RankingRun;
  if (value.schemaVersion !== "ranking-run.v1" || !Array.isArray(value.results)) {
    throw new Error("RANKING_RUN_INVALID");
  }
  return value;
}

function parseBlindReview(path: string): BlindReviewMaterialInput {
  const value = JSON.parse(readFileSync(path, "utf8")) as BlindReviewMaterialInput;
  if (value.schemaVersion !== "blind-review-material.v1" || !Array.isArray(value.items)) {
    throw new Error("BLIND_REVIEW_MATERIAL_INVALID");
  }
  return value;
}

function noviceGuide(itemCount: number) {
  return `# 新手盲评：怎么开始\n\n`+
    `这不是专业运营考试。你只评价“当前证据是否看得懂、是否值得继续调查、判断用了多久”。\n\n`+
    `## 操作顺序\n\n`+
    `1. 不要打开旁边的“02-盲评完成后再打开”目录。\n`+
    `2. 回到 Codex 对话，输入：\`开始盲评\`。\n`+
    `3. Codex 会按固定盲序逐条展示 ${itemCount} 个商品，每次只问一条。\n`+
    `4. 不确定时直接回答“不确定”，不要猜利润、专利、物流或供应链。\n`+
    `5. 每条只回答：是否看懂、证据是否够、是否有明显疑问、是否愿意再调查 10 分钟、信心、耗时。\n\n`+
    `## 这次能证明什么\n\n`+
    `只能证明证据是否易懂、是否帮助缩小下一步调查范围，以及新手完成判断所需时间。不能证明商业机会、利润或专家认可。\n`;
}

function stage2Guide(sampleCount: number) {
  return `# Stage 2 客观取证清单（盲评完成后再打开）\n\n`+
    `本目录会揭示系统分层。必须先锁定新手盲评答案，再开始这里的 ${sampleCount} 个样本。\n\n`+
    `## 每个样本只收集可追溯事实\n\n`+
    `- 供应商页面 URL、采集时间、MOQ 和对应变体报价；\n`+
    `- 包装长宽高、重量及证据来源；\n`+
    `- BOM、头程、平台佣金、FBA、包装、仓储和退货准备金；\n`+
    `- 明显物流、监管、认证或知识产权待核实项；\n`+
    `- 是否仍值得继续，以及基于哪些已取得证据。\n\n`+
    `## 强制边界\n\n`+
    `缺少任一关键成本时保持 \`profit_insufficient_evidence\`，不得估一个数字凑齐。合规和知识产权只能记录“已验证／待验证／发现明确阻断”，不能由系统代替专业结论。Stage 2 结果不得反向修改本次 Stage 1 排名。\n`;
}

export function generateSoloValidationMaterials(input: GeneratorInput) {
  const ranking = parseRanking(resolve(input.rankingFile));
  const blindReview = parseBlindReview(resolve(input.blindReviewFile));
  const novice = buildNoviceBlindReviewPacket(blindReview);
  const stage2 = buildSoloStage2CalibrationPacket(ranking, blindReview);
  const output = resolve(input.outputDirectory);
  const noviceDirectory = resolve(output, "01-新手盲评-先填写");
  const stage2Directory = resolve(output, "02-盲评完成后再打开");
  mkdirSync(noviceDirectory, { recursive: true });
  mkdirSync(stage2Directory, { recursive: true });

  const files = [
    "01-新手盲评-先填写/novice-blind-review-packet.v1.json",
    "01-新手盲评-先填写/README-怎么开始.md",
    "02-盲评完成后再打开/stage2-objective-calibration-packet.v1.json",
    "02-盲评完成后再打开/README-客观取证清单.md",
    "generation-summary.v1.json",
  ];
  writeJson(resolve(output, files[0]), novice);
  writeFileSync(resolve(output, files[1]), noviceGuide(novice.items.length), "utf8");
  writeJson(resolve(output, files[2]), stage2);
  writeFileSync(resolve(output, files[3]), stage2Guide(stage2.samples.length), "utf8");

  const summaryBody = {
    schemaVersion: "solo-validation-generation-summary.v1" as const,
    generatedFromCapturedAt: ranking.createdAt,
    sourceRankingRunId: ranking.rankingRunId,
    sourceRankingInputHash: ranking.inputHash,
    sourceBlindReviewId: blindReview.blindReviewId,
    novicePacketHash: novice.packetHash,
    stage2PacketHash: stage2.packetHash,
    noviceItemCount: novice.items.length,
    stage2SampleCount: stage2.samples.length,
    files,
    deliveryMode: "guided_json_and_markdown" as const,
    systemRankingHiddenFromNovicePacket: true,
    humanReviewResultsRecorded: false,
    productionDatabaseWritten: false,
    aiCalled: false,
  };
  writeJson(resolve(output, files[4]), { ...summaryBody, evidenceHash: stableHash(summaryBody) });
  return { outputDirectory: output, files, noviceItemCount: novice.items.length, stage2SampleCount: stage2.samples.length };
}
