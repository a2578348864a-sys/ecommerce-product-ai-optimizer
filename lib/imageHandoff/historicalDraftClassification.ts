/**
 * Image Studio Historical Draft Classification（V3 Final Freeze）
 *
 * 历史草稿分类的单一事实源（deterministic，无 DB migration、无运行时 AI 猜测）：
 *
 * - 新格式草稿：item.handoffMode（product_visual_draft / composition_concept）为权威分类。
 * - 旧格式草稿（ProductIdentity fix 之前写入，无 handoffMode）：依据项目已知历史 incident
 *   白名单（draftId 全局唯一）分类；白名单之外的旧格式草稿一律 LEGACY_UNCLASSIFIED
 *   （fail-closed：不可作为正式商品图选择）。
 *
 * 用途：
 * - GET /image-handoff 的 draftHistory 投影（UI 历史区分组展示）；
 * - PATCH /image-handoff 的 final selection gate（INVALID / CONCEPT / UNCLASSIFIED 一律拒绝，
 *   只允许 PRODUCT_VISUAL_DRAFT）。
 */

export type ImageDraftClassification =
  | "product_visual_draft"
  | "composition_concept"
  | "invalid_product_identity"
  | "legacy_unclassified";

/** 已知历史错误商品身份草稿（ProductIdentity lock 修复前生成；Vitamin C / Serum 内容）。
 * 依据：generationBasis.productName="composition concept" + 生成时间早于 identity lock
 * 修复边界 + 用户/项目已确认的 incident 记录。禁止把任何 AI 生成 draft 升级为 target reference。 */
export const HISTORICAL_INVALID_IDENTITY_DRAFT_IDS: ReadonlySet<string> = new Set([
  "baa8bd0d-824c-47fd-8b00-3092bfa27597",
  "4a74ca28-ca79-4c47-a991-6e8ac80c71bf",
]);

/** 已知构图概念草稿（ProductIdentity lock 修复后生成；category 正确但非精确商品外观）。 */
export const HISTORICAL_COMPOSITION_CONCEPT_DRAFT_IDS: ReadonlySet<string> = new Set([
  "2b51c7d9-dc3c-4ab6-b576-78ada0001899",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 确定性分类：新格式按 handoffMode；旧格式按 incident 白名单；其余 fail-closed。
 */
export function classifyImageDraft(item: unknown): ImageDraftClassification {
  if (!isRecord(item)) return "legacy_unclassified";
  const mode = item.handoffMode;
  if (mode === "product_visual_draft") return "product_visual_draft";
  if (mode === "composition_concept") return "composition_concept";
  const id = typeof item.id === "string" ? item.id : "";
  if (HISTORICAL_INVALID_IDENTITY_DRAFT_IDS.has(id)) return "invalid_product_identity";
  if (HISTORICAL_COMPOSITION_CONCEPT_DRAFT_IDS.has(id)) return "composition_concept";
  // 旧格式且不在白名单：无法证明是当前商品的正式视觉草稿 → fail-closed
  return "legacy_unclassified";
}

/** 是否允许作为正式商品图最终选择（fail-closed：只有显式 product_visual_draft 允许） */
export function isFinalSelectableDraft(classification: ImageDraftClassification): boolean {
  return classification === "product_visual_draft";
}

export const IMAGE_DRAFT_CLASSIFICATION_LABELS: Record<ImageDraftClassification, string> = {
  product_visual_draft: "产品图片草稿",
  composition_concept: "构图概念",
  invalid_product_identity: "历史异常",
  legacy_unclassified: "历史草稿",
};
