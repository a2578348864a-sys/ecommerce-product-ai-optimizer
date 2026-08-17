import { createHash } from "node:crypto";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";

/**
 * PR2-3: 从当前有效 Creative Handoff 构造安全 Image 生成输入。
 *
 * 边界（规格第十-十二节）：
 * - confirmedFacts 中 usageScopes 允许 image 的字段 → productFacts（仅明确结构化事实）
 * - approvedVisualReferences（humanApprovedForReference=true 且 identityBound=true）→ 视觉依据
 * - aiCreativeReferences → compositionReferences（仅风格/氛围/构图/色彩方向，非事实）
 * - creativePreferences → 构图偏好
 * - prohibitedClaims / issues(missing/conflict) → 约束
 * - 内部主体 / Hash / Ledger / SourceReference 原始对象 / VisualReference 内部对象 → 永不进入
 *
 * 纯函数：无 DB / 无网络 / 无环境变量 / 同输入同输出 / 不修改输入。
 * 模式：无批准视觉参考 → composition_concept；有批准参考 → product_visual_draft。
 */

export type ImageVisualMode = "composition_concept" | "product_visual_draft";

/**
 * V3 Image Product Identity — 目标商品身份（唯一权威，§7/§8）。
 * 从 Creative Handoff productIdentity + confirmedFacts（brand/product_type/series_or_model/capacity）
 * 确定性构建；productType 是构图概念模式的 HARD CONSTRAINT。
 */
export type TargetProductIdentity = {
  displayName: string;
  brand: string | null;
  productType: string | null;
  seriesOrModel: string | null;
  capacity: string | null;
};

export type ImageGenerationInput = {
  schema: "image-generation-input.v1";
  mode: ImageVisualMode;
  source: {
    handoffRevision: number;
    researchRevision: number;
  };
  /** V3 Image Product Identity：目标商品身份硬约束（provider 必须保持类别） */
  targetProduct: TargetProductIdentity;
  productFacts: Array<{ field: string; label: string; value: string }>;
  approvedVisualReferences: Array<{ referenceFingerprint: string; summary: string; selectionId: string; approvedAt: string | null }>;
  /** Final Capability: 批准参考的原始图片（dataUrl base64；仅服务端真实 Provider 使用；mock 与 fingerprint 忽略） */
  referenceImageDataUrl?: string;
  compositionReferences: string[];
  creativePreferences: Record<string, string>;
  prohibitedVisualClaims: string[];
  unknowns: string[];
  humanReviewRequired: true;
  researchMode: "market_research_only";
  promotionEligible: false;
  /**
   * V3 Evidence → Creative Context Bridge：研究 Evidence 参考层（VOC/AI/Competitive）。
   * 全部为参考 only（场景/方向/差异化参考）；视觉文案中的事实 claim 仍只能来自 confirmedFacts。
   */
  creativeContext?: {
    vocInsights: string[];
    aiReferences: string[];
    competitiveContext: string[];
  };
};

export type ImageHandoffGateResult =
  | { ok: true; input: ImageGenerationInput; generationInputFingerprint: string; mode: ImageVisualMode; handoffRevision: number; researchRevision: number }
  | { ok: false; code: string; message: string };

const IMAGE_USAGE = "image";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFC").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).join("; ");
  return "";
}

/** 视觉参考批准门禁：identityBound + humanApprovedForReference + approvedAt/approvedBy/confirmationReference 合法 */
function isApprovedVisualReference(value: unknown): value is { referenceFingerprint: string; summary: string } {
  if (!isRecord(value)) return false;
  if (value.identityBound !== true) return false;
  if (value.humanApprovedForReference !== true) return false;
  if (typeof value.approvedBy !== "object" || value.approvedBy === null) return false;
  if (typeof value.approvedAt !== "string" || Number.isNaN(Date.parse(value.approvedAt))) return false;
  if (typeof value.confirmationReference !== "string" || !value.confirmationReference) return false;
  if (typeof value.assetFingerprint !== "string" || !value.assetFingerprint) return false;
  return true;
}

/**
 * Image Handoff 门禁（纯函数）：只有 active Handoff 且视觉模式合法才放行。
 * stale/revoked/revision 均由调用方（服务层锁内）用最新权威数据复核。
 */
export function buildImageInputFromCreativeHandoff(
  handoff: ProductCreativeHandoffV1,
  researchRevision: number,
  options: { creativeContext?: import("@/lib/creativeContextBuilder").CreativeContextV1 | null } = {},
): ImageHandoffGateResult {
  if (!isRecord(handoff)) {
    return { ok: false, code: "handoff_required", message: "没有可用的创作交接。" };
  }
  if (handoff.schema !== "product-creative-handoff.v1") {
    return { ok: false, code: "handoff_required", message: "创作交接合同结构异常。" };
  }
  if (handoff.controlState === "revoked") {
    return { ok: false, code: "handoff_revoked", message: "创作交接已撤回，不能用于生成图片草稿。" };
  }
  if (handoff.controlState !== "active") {
    return { ok: false, code: "handoff_required", message: "创作交接不可用。" };
  }
  if (handoff.currentRevision < 1 || !Array.isArray(handoff.versions) || handoff.versions.length < 1) {
    return { ok: false, code: "handoff_required", message: "创作交接没有可用版本。" };
  }
  const version = handoff.versions[handoff.versions.length - 1];
  if (!version || version.revision !== handoff.currentRevision) {
    return { ok: false, code: "handoff_required", message: "创作交接版本无效。" };
  }
  if (version.sourceResearch.researchRevision !== researchRevision) {
    return { ok: false, code: "handoff_stale", message: "研究版本已更新，请刷新后重新确认。" };
  }
  if (version.humanReviewRequired !== true) {
    return { ok: false, code: "image_input_empty", message: "交接未完成人工审核。" };
  }
  if (handoff.researchMode !== "market_research_only") {
    return { ok: false, code: "image_input_empty", message: "当前研究模式不允许生成图片内容。" };
  }
  if (handoff.promotionEligible !== false) {
    return { ok: false, code: "image_input_empty", message: "当前交接不允许用于上架相关内容。" };
  }
  const blockingIssue = version.issues.find((issue) => issue.risk === "blocking");
  if (blockingIssue) {
    return { ok: false, code: "handoff_required", message: `存在阻断问题：${blockingIssue.summary}` };
  }

  // 已确认事实（明确允许 Image 用途）
  const productFacts = version.confirmedFacts
    .filter((fact) => fact.usageScopes.includes(IMAGE_USAGE))
    .map((fact) => ({ field: fact.field, label: fact.label, value: textOf(fact.value).slice(0, 500) }))
    .filter((fact) => fact.value.length > 0);

  // 已批准视觉参考（严格门禁）
  // V2 Final Integration: 每个批准参考生成服务端确定性 selectionId（binding 当前 Handoff + assetFingerprint），
  // Browser 在 Image Generate 时只能提交这些 selectionId 的子集（规格九节）。
  const approvedVisualReferences = version.visualReferences
    .filter(isApprovedVisualReference)
    .map((ref) => ({
      referenceFingerprint: ref.assetFingerprint.slice(0, 16),
      summary: `approved visual reference ${ref.assetFingerprint.slice(0, 8)}`,
      selectionId: `visual-ref:${sha256(`${handoff.handoffId}:${handoff.currentRevision}:${ref.assetFingerprint}`).slice(0, 24)}`,
      approvedAt: typeof ref.approvedAt === "string" ? ref.approvedAt : null,
    }));

  // AI 参考 → 仅构图参考（永不进入产品外观事实）
  const compositionReferences = version.aiCreativeReferences
    .map((ref) => ref.summary.slice(0, 500))
    .filter((s) => s.length > 0);

  // 禁止声明 → 约束
  const prohibitedVisualClaims = version.prohibitedClaims.map((claim) => claim.summary.slice(0, 500));

  // unknown / conflict → 约束
  const unknowns = version.issues
    .filter((issue) => issue.kind === "conflict" || issue.kind === "missing")
    .map((issue) => issue.summary.slice(0, 300))
    .filter((s) => s.length > 0);

  // 模式判定：无批准视觉参考 → composition_concept；有 → product_visual_draft
  const mode: ImageVisualMode = approvedVisualReferences.length > 0 ? "product_visual_draft" : "composition_concept";

  const creativePreferences: Record<string, string> = {};
  const prefs = version.creativePreferences;
  if (isRecord(prefs)) {
    // additionalRequirements：仅影响背景/构图/光影/风格，不得改变产品主体、Logo、结构、配件或已确认事实
    for (const key of ["targetMarket", "language", "tone", "targetAudiencePreference", "imageStyle", "backgroundPreference", "compositionPreference", "additionalRequirements"] as const) {
      const value = prefs[key];
      if (typeof value === "string" && value.trim()) creativePreferences[key] = value.normalize("NFC").trim().slice(0, key === "additionalRequirements" ? 200 : 300);
    }
  }

  // 构图概念模式不得包含产品外观数据（productFacts 仅含明确 image-scope 事实）。
  // 最小构图上下文：compositionReferences / 真实构图偏好 / image-scope 事实；
  // 均无时，composition_concept 允许使用 productIdentity.displayName（已确认的商品标识，
  // 非外观属性）作为非产品特定构图上下文 —— 不描绘商品外观。
  let inputDisplayName: string | undefined;
  const hasCompositionInput = compositionReferences.length > 0
    || Object.keys(creativePreferences).length > 0
    || productFacts.length > 0
    || (mode === "composition_concept" && typeof version.productIdentity.displayName === "string" && version.productIdentity.displayName.trim().length > 0);
  if (!hasCompositionInput) {
    return { ok: false, code: "image_input_empty", message: "当前交接没有可用于图片构图的事实或方向。" };
  }
  if (mode === "composition_concept" && productFacts.length === 0 && hasCompositionInput
    && compositionReferences.length === 0 && Object.keys(creativePreferences).length === 0) {
    // displayName 作为构图上下文（不进入 productFacts，避免被视为外观事实）
    inputDisplayName = version.productIdentity.displayName.trim().slice(0, 200);
  }

  // V3 Image Product Identity（§7/§8）：从 productIdentity + confirmedFacts 确定性构建唯一权威。
  // productType 来自确认事实（不可猜）；displayName 兜底（已确认商品标识，非外观属性）。
  const identityFact = (field: string): string | null => {
    const fact = productFacts.find((f) => f.field === field);
    return fact && fact.value.trim() ? fact.value.trim().slice(0, 120) : null;
  };
  const targetProduct: TargetProductIdentity = {
    displayName: (typeof version.productIdentity.displayName === "string" ? version.productIdentity.displayName.trim().slice(0, 240) : "")
      || identityFact("product_type") || "目标商品",
    brand: identityFact("brand"),
    productType: identityFact("product_type"),
    seriesOrModel: identityFact("series_or_model"),
    capacity: identityFact("capacity"),
  };

  const input: ImageGenerationInput = {
    schema: "image-generation-input.v1",
    mode,
    source: {
      handoffRevision: handoff.currentRevision,
      researchRevision,
    },
    targetProduct,
    productFacts,
    approvedVisualReferences,
    compositionReferences: inputDisplayName ? [...compositionReferences, inputDisplayName] : compositionReferences,
    creativePreferences,
    prohibitedVisualClaims,
    unknowns,
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...(projectCreativeContextReferences(options.creativeContext)
      ? { creativeContext: projectCreativeContextReferences(options.creativeContext) }
      : {}),
  };

  const generationInputFingerprint = createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");

  return { ok: true, input, generationInputFingerprint, mode, handoffRevision: handoff.currentRevision, researchRevision };
}

/** 内部字段泄漏防护：确认哪些 key 绝不能出现在 Image Input 中 */
export const IMAGE_INPUT_FORBIDDEN_KEYS = Object.freeze([
  "actorRef", "subjectFingerprint", "candidateId", "requestId", "requestLedger",
  "researchHash", "handoffFingerprint", "candidateSnapshotFingerprint",
  "sellerSpriteSnapshotFingerprint", "researchResultFingerprint", "confirmationReference",
  "sourceRef", "assetFingerprint", "createdBy", "confirmedBy", "approvedBy",
  "resultJson", "visualReference", "visualReferences",
]);

/** 确保稳定字段不被未知 key 覆盖（exact keys 防护） */
export function hasForbiddenImageInputKey(input: Record<string, unknown>): boolean {
  return IMAGE_INPUT_FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}

/**
 * V3 Evidence → Creative Context Bridge：Creative Context → Image 参考层（bounded，参考 only）。
 * - VOC insights → 场景优先级 / 用户关注点（§45）；
 * - AI references → 创意方向参考；
 * - competitive context → 差异化方向参考（禁止复制竞品属性）。
 * 视觉文案中的事实 claim 仍只能来自 confirmedFacts（§46）。
 */
export function projectCreativeContextReferences(
  context: import("@/lib/creativeContextBuilder").CreativeContextV1 | null | undefined,
): ImageGenerationInput["creativeContext"] {
  if (!context) return undefined;
  const vocInsights = context.vocInsights.slice(0, 6).map((v) =>
    `VOC: ${v.theme}${v.summary ? ` — ${v.summary.slice(0, 120)}` : ""}${v.reviewCount > 0 ? ` (${v.reviewCount} reviews)` : ""}`,
  );
  const aiReferences = context.aiReferences.slice(0, 6).map((r) =>
    `AI REFERENCE (NOT FACT): ${r.summary.slice(0, 140)}`,
  );
  const competitiveContext = context.competitiveContext.slice(0, 5).map((c) =>
    `competitor ${c.asin}${c.note ? `: ${c.note.slice(0, 100)}` : ""}`,
  );
  if (vocInsights.length === 0 && aiReferences.length === 0 && competitiveContext.length === 0) {
    return undefined;
  }
  return { vocInsights, aiReferences, competitiveContext };
}

/**
 * V2 Final Integration（规格九节）: 校验 Browser 提交的 approvedVisualReferenceSelectionIds。
 * 语义：Handoff 中的 visualReferences = 用户已批准的参考集合；
 *       Image Generate 的 selectionIds = 本次图片草稿从已批准集合中选择的子集。
 * 规则：
 *   - 未选择：composition_concept 允许；product_visual_draft 拒绝（image_visual_reference_required）。
 *   - 选择非当前 Handoff 参考（不存在的 selectionId）→ 拒绝（image_visual_reference_invalid）。
 *   - 选择过期/撤销参考（selectionId 不在当前批准集）→ 拒绝。
 *   - 选择集合法时返回该子集（参与 generationInputFingerprint / visualReferenceFingerprint）。
 * 失败返回 { ok: false, code, message }；成功返回 { ok: true, selected }。
 */
export function validateApprovedVisualSelection(
  input: ImageGenerationInput,
  browserSelectionIds: string[] | undefined,
): { ok: true; selected: Array<{ referenceFingerprint: string; selectionId: string }> }
  | { ok: false; code: string; message: string } {
  const approved = input.approvedVisualReferences;
  if (!browserSelectionIds || browserSelectionIds.length === 0) {
    // 未选择：composition 允许；product_visual 必须选择
    if (input.mode === "product_visual_draft") {
      return { ok: false, code: "image_visual_reference_required", message: "产品视觉草稿必须从已批准参考中选择。当前未选择任何视觉参考，只能生成构图概念。" };
    }
    return { ok: true, selected: [] };
  }
  const bySelectionId = new Map(approved.map((ref) => [ref.selectionId, ref]));
  const selected: Array<{ referenceFingerprint: string; selectionId: string }> = [];
  for (const id of browserSelectionIds) {
    const ref = bySelectionId.get(id);
    if (!ref) {
      return { ok: false, code: "image_visual_reference_invalid", message: "选择的视觉参考不属于当前交接的批准参考集合（可能已过期或已被撤销）。" };
    }
    selected.push({ referenceFingerprint: ref.referenceFingerprint, selectionId: ref.selectionId });
  }
  return { ok: true, selected };
}
