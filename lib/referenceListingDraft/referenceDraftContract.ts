/**
 * Reference Listing Draft Contract (v1)
 *
 * “按现有资料生成参考初稿”
 * 契约规范：
 * - 仅基于当前商品已保存的确定性采集资料；
 * - 产物严格标识为“研究对象参考初稿 · 基于采集资料，待人工复核”；
 * - 绝不自动标记为已确认事实、正式 Listing 或最终 SKU 文案；
 * - 1~5 条卖点均属于合法输出，不强制凑满 5 条，亦不被 3 条正式门禁阻断；
 * - 纯函数/无 DB/无网络/无付费调用。
 */

export const REFERENCE_LISTING_DRAFT_SCHEMA = "reference-listing-draft.v1" as const;
export const REFERENCE_LISTING_DRAFT_VERSION = 1 as const;

export type ReferenceDraftStatus = "ready" | "insufficient" | "blocked";

export type ReferenceMaterialSourceKind =
  | "amazon_browser_evidence"
  | "product_title"
  | "seller_sprite_product_facts"
  | "confirmed_fact";

export type ReferenceMaterialItem = {
  /** 稳定 ID，如 "product_title:product_type" */
  id: string;
  field: string;
  label: string;
  value: string;
  sourceKind: ReferenceMaterialSourceKind;
  sourceLabel: string;
  sourceRef?: string;
  isConfirmed: boolean;
};

export type ExcludedMaterialItem = {
  field: string;
  label: string;
  value: string;
  reason: string;
};

export type ReferenceDraftReadiness = {
  status: ReferenceDraftStatus;
  reason?: string;
  productName: string;
  market: string;
  asin: string | null;
  adoptedCount: number;
  excludedCount: number;
  adoptedMaterials: ReferenceMaterialItem[];
  excludedMaterials: ExcludedMaterialItem[];
  sourceFingerprint: string;
  accessSubject?: string;
};

export type DraftGenerationSnapshot = {
  productName: string;
  market: string;
  asin: string | null;
  sourceFingerprint: string;
  adoptedMaterials: ReferenceMaterialItem[];
  excludedMaterials: ExcludedMaterialItem[];
  generatedBy: "local_rules" | "ai";
  generatedAt: string;
};

export type DraftAnchorCitation = {
  text: string;
  field: string;
  value: string;
};

export type ReferenceListingDraft = {
  schema: typeof REFERENCE_LISTING_DRAFT_SCHEMA;
  version: typeof REFERENCE_LISTING_DRAFT_VERSION;
  status: "ready" | "insufficient";
  taskId: string;
  productName: string;
  market: string;
  asin: string | null;
  title: string;
  bullets: string[];
  description: string;
  adoptedMaterials: ReferenceMaterialItem[];
  excludedMaterials: ExcludedMaterialItem[];
  generationSnapshot: DraftGenerationSnapshot;
  anchoredCitations: DraftAnchorCitation[];
  generatedBy: "local_rules" | "ai";
  humanReviewRequired: true;
  badgeLabel: "研究对象参考初稿 · 基于采集资料，待人工复核";
  sourceFingerprint: string;
  generatedAt: string;
  warningNotice?: string;
  accessSubject?: string;
};

export const STORED_DRAFT_SCHEMA_VERSION = 2 as const;

export type StoredReferenceDraftState = {
  schemaVersion: typeof STORED_DRAFT_SCHEMA_VERSION;
  subject: string;
  taskId: string;
  asin: string | null;
  productName: string;
  title: string;
  bullets: string[];
  description: string;
  isManuallyEdited: boolean;
  generationSnapshot: DraftGenerationSnapshot | null;
  savedAt: string;
};
