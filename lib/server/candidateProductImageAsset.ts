import "server-only";

/**
 * SellerSprite 候选商品图片资产（P1-1 图片资产化）
 *
 * 资产载体：OpportunityCandidate.analysisJson.productImageSnapshot。
 *
 * 为什么放 analysisJson 而不是 sourceMetaJson：
 *   - sellerSprite_candidate_source_v1 是冻结的 source schema（16 KiB 上限，
 *     不含图片字段）；market-screening 候选则把快照放 sourceMetaJson（含
 *     marketScreeningIdentity 绑定）。
 *   - analysisJson 是候选的「分析侧」存储：r22MarketDecision 等既有权威
 *     命名空间都在其中，新增 productImageSnapshot 字段不破坏既有解析
 *     （parseR22MarketDecisionFromAnalysisJson 只读 r22MarketDecision）。
 *   - 图片快照以 dataUrl 内嵌（与 product-batch 候选一致），contentHash
 *     可验证；单图 ≤2 MiB 受 PRODUCT_RESEARCH_IMAGE_MAX_BYTES 约束。
 *
 * 读取顺序（解析侧统一）：
 *   sourceMetaJson.productImageSnapshot（market-screening / product-batch 既有）
 *   → analysisJson.productImageSnapshot（SellerSprite 导入新增）
 * 双层回退保证旧数据（sourceMetaJson 路径）与新数据（analysisJson 路径）
 * 全部可读，且冲突时以既有 sourceMetaJson 为权威。
 */

import { parseProductImageSnapshot, type ProductResearchImageSnapshot } from "@/lib/productResearchImage";

export const CANDIDATE_IMAGE_ASSET_JSON_KEY = "productImageSnapshot";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 从候选 analysisJson 读取商品图片快照（SellerSprite 导入写入） */
export function readCandidateAnalysisImageSnapshot(
  analysisJson: string,
): ProductResearchImageSnapshot | null {
  if (!analysisJson || !analysisJson.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(analysisJson);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed[CANDIDATE_IMAGE_ASSET_JSON_KEY] === undefined) return null;
  return parseProductImageSnapshot(parsed[CANDIDATE_IMAGE_ASSET_JSON_KEY]);
}

/**
 * 把商品图片快照写入候选 analysisJson（保留既有字段，原子替换）。
 * 已存在同 contentHash 快照 → 返回原值（changed=false）。
 * 已存在冲突 contentHash → 抛错（不静默覆盖既有资产）。
 */
export function writeCandidateAnalysisImageSnapshot(
  analysisJson: string,
  image: ProductResearchImageSnapshot,
): { changed: boolean; analysisJson: string } {
  let parsed: Record<string, unknown> = {};
  if (analysisJson && analysisJson.trim()) {
    try {
      const candidate = JSON.parse(analysisJson) as unknown;
      if (!isRecord(candidate)) {
        throw new Error("analysis_json_invalid");
      }
      parsed = candidate;
    } catch {
      throw new Error("candidate_analysis_json_invalid");
    }
  }
  const existing = parsed[CANDIDATE_IMAGE_ASSET_JSON_KEY];
  if (existing !== undefined) {
    const existingSnapshot = parseProductImageSnapshot(existing);
    if (existingSnapshot && existingSnapshot.contentHash === image.contentHash) {
      return { changed: false, analysisJson };
    }
    throw new Error("candidate_image_asset_conflict");
  }
  return {
    changed: true,
    analysisJson: JSON.stringify({
      ...parsed,
      [CANDIDATE_IMAGE_ASSET_JSON_KEY]: image,
    }),
  };
}
