import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildNoviceVisualBlindReviewPacket,
  type BlindReviewMaterialInput,
  type NoviceVisualPresentationInput,
} from "./solo-validation-materials";

type GeneratorInput = {
  blindReviewFile: string;
  presentationFile: string;
  assetRootDirectory: string;
  outputDirectory: string;
};

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseBlindReview(path: string): BlindReviewMaterialInput {
  const value = JSON.parse(readFileSync(path, "utf8")) as BlindReviewMaterialInput;
  if (value.schemaVersion !== "blind-review-material.v1" || !Array.isArray(value.items)) {
    throw new Error("BLIND_REVIEW_MATERIAL_INVALID");
  }
  return value;
}

function parsePresentation(path: string): NoviceVisualPresentationInput {
  const value = JSON.parse(readFileSync(path, "utf8")) as NoviceVisualPresentationInput;
  if (value.schemaVersion !== "solo-novice-visual-presentation-input.v1" || !Array.isArray(value.items)) {
    throw new Error("VISUAL_PRESENTATION_INPUT_INVALID");
  }
  return value;
}

function fileSha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validateLocalAssets(presentation: NoviceVisualPresentationInput, assetRootDirectory: string) {
  const root = resolve(assetRootDirectory);
  for (const item of presentation.items) {
    const asset = item.image.localAsset;
    if (asset.status !== "available" || asset.relativePath === null) continue;
    const target = resolve(root, asset.relativePath);
    const relativeTarget = relative(root, target);
    if (isAbsolute(asset.relativePath)
      || relativeTarget === ".."
      || relativeTarget.startsWith(`..${sep}`)
      || isAbsolute(relativeTarget)) {
      throw new Error("VISUAL_LOCAL_ASSET_PATH_INVALID");
    }
    let stat;
    try {
      stat = statSync(target);
    } catch {
      throw new Error("VISUAL_LOCAL_ASSET_MISMATCH");
    }
    if (!stat.isFile()
      || stat.size !== asset.bytes
      || fileSha256(target) !== asset.contentSha256) {
      throw new Error("VISUAL_LOCAL_ASSET_MISMATCH");
    }
  }
}

function visualGuide(localCount: number, totalCount: number) {
  return `# 视觉新手盲评 V2\n\n`
    + `本材料在原始标题和页面证据之外，增加商品图与中文“是什么／做什么”说明，降低英语和纯文字理解门槛。\n\n`
    + `## 当前完整度\n\n`
    + `- 本地可用商品图：${localCount}/${totalCount}\n`
    + `- 缺少本地图的条目会明确标记为 \`not_cached\`，不得当作已有图片。\n`
    + `- 中文说明的来源类型为 \`ai_generated\`，只帮助理解，不是 Amazon 页面事实，也不能证明尺寸、质量、耐用性、销量或利润。\n\n`
    + `## 使用边界\n\n`
    + `先看图片、中文用途、原始标题和页面证据，再回答是否看懂和是否愿意继续调查。不确定时保留“不确定”，不要补猜缺失的商业事实。\n`;
}

export function generateSoloVisualValidationMaterials(input: GeneratorInput) {
  const blindReview = parseBlindReview(resolve(input.blindReviewFile));
  const presentation = parsePresentation(resolve(input.presentationFile));
  validateLocalAssets(presentation, input.assetRootDirectory);
  const packet = buildNoviceVisualBlindReviewPacket(blindReview, presentation);
  const output = resolve(input.outputDirectory);
  mkdirSync(output, { recursive: true });
  const files = [
    "novice-visual-blind-review-packet.v2.json",
    "README-视觉盲评说明.md",
    "generation-summary.v2.json",
  ];
  writeJson(resolve(output, files[0]), packet);
  writeFileSync(
    resolve(output, files[1]),
    visualGuide(packet.visualSummary.localImageAvailableCount, packet.visualSummary.totalItemCount),
    "utf8",
  );
  const summaryBody = {
    schemaVersion: "solo-visual-validation-generation-summary.v2" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: packet.sourceEvidenceHash,
    sourceVisualEvidenceHash: packet.sourceVisualEvidenceHash,
    packetHash: packet.packetHash,
    visualSummary: packet.visualSummary,
    files,
    legacyV1ResponseModified: false,
    externalWebsiteAccessed: false,
    productionDatabaseWritten: false,
    externalAiApiCalled: false,
    presentationTextSourceType: "ai_generated" as const,
  };
  writeJson(resolve(output, files[2]), { ...summaryBody, evidenceHash: stableHash(summaryBody) });
  return {
    outputDirectory: output,
    files,
    visualSummary: packet.visualSummary,
  };
}
