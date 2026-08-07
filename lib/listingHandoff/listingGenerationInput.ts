import { createHash } from "node:crypto";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";

/**
 * PR2-2: 从当前有效 Creative Handoff 构造安全 Listing 生成输入。
 *
 * 边界：
 * - confirmedFacts 中 usageScopes 允许 listing 的字段 → productFacts
 * - stableSourceFacts 合同数组不直接存在；来源快照经人工确认后已进入
 *   confirmedFacts（confirmedBy 转换，usageScopes 含 listing）。
 *   未确认的来源快照（issues 层 human_confirmation_required_for_claim）不得作为 Listing 事实。
 * - aiCreativeReferences → creativeReferences（仅措辞，不能当事实）
 * - prohibitedClaims → 禁止约束；issues(missing/conflict) → unknowns（不得推断）
 * - 内部主体 / Hash / Ledger / SourceReference 原始对象 / VisualReference → 永不进入
 *
 * 纯函数：无 DB/文件/网络/env/Date.now/随机；不修改输入；同输入同输出。
 */

export type ListingGenerationInput = {
  schema: "listing-generation-input.v1";
  source: {
    handoffRevision: number;
    researchRevision: number;
  };
  productFacts: Array<{ field: string; label: string; value: string }>;
  stableSourceFacts: Array<{ field: string; label: string; value: string }>;
  creativeReferences: string[];
  creativePreferences: Record<string, string>;
  prohibitedClaims: string[];
  unknowns: string[];
  humanReviewRequired: true;
  researchMode: "market_research_only";
  promotionEligible: false;
};

export type ListingHandoffGateResult =
  | { ok: true; input: ListingGenerationInput; generationInputFingerprint: string; handoffRevision: number; researchRevision: number }
  | { ok: false; code: string; message: string };

const LISTING_USAGE = "listing";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFC").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).join("; ");
  return "";
}

/**
 * Listing Handoff 门禁：只有 active Handoff 且至少有一个允许 Listing 的事实才放行。
 * 纯函数；stale/revoked/blocking/revision 均由调用方（服务层锁内）用最新权威数据复核。
 */
export function buildListingInputFromCreativeHandoff(
  handoff: ProductCreativeHandoffV1,
  researchRevision: number,
): ListingHandoffGateResult {
  if (!isRecord(handoff)) {
    return { ok: false, code: "handoff_required", message: "没有可用的创作交接。" };
  }
  if (handoff.schema !== "product-creative-handoff.v1") {
    return { ok: false, code: "handoff_required", message: "创作交接合同结构异常。" };
  }
  if (handoff.controlState === "revoked") {
    return { ok: false, code: "handoff_revoked", message: "创作交接已撤回，不能用于生成 Listing。" };
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
    return { ok: false, code: "listing_input_empty", message: "交接未完成人工审核。" };
  }
  if (handoff.researchMode !== "market_research_only") {
    return { ok: false, code: "listing_input_empty", message: "当前研究模式不允许生成 Listing。" };
  }
  if (handoff.promotionEligible !== false) {
    return { ok: false, code: "listing_input_empty", message: "当前交接不允许用于上架相关内容。" };
  }
  const blockingIssue = version.issues.find((issue) => issue.risk === "blocking");
  if (blockingIssue) {
    return { ok: false, code: "handoff_required", message: `存在阻断问题：${blockingIssue.summary}` };
  }

  // 已确认事实（明确允许 Listing 用途）
  // V2.1.2：市场信号字段（价格/评分/评论数/类目）即使被确认也绝不进入 Listing——
  // 双保险：① usageScopes 含 listing（确认逻辑已按 factCategory 收敛）；② 已知市场字段硬排除。
  const MARKET_SIGNAL_FIELDS = new Set(["price_usd", "rating", "review_count", "category"]);
  const productFacts = version.confirmedFacts
    .filter((fact) => fact.usageScopes.includes(LISTING_USAGE))
    .filter((fact) => !MARKET_SIGNAL_FIELDS.has(fact.field))
    .map((fact) => ({ field: fact.field, label: fact.label, value: textOf(fact.value).slice(0, 500) }))
    .filter((fact) => fact.value.length > 0);

  // 稳定来源事实：合同 stableSourceFacts 为 internal-only 且当前不产生；
  // 来源快照经人工确认后已进入 confirmedFacts。此处保守为空，绝不把未确认来源当事实。
  const stableSourceFacts: Array<{ field: string; label: string; value: string }> = [];
  const confirmedFields = new Set(productFacts.map((fact) => fact.field));

  // AI 参考 → 仅创意参考（永不进入 facts）
  const creativeReferences = version.aiCreativeReferences
    .map((ref) => ref.summary.slice(0, 500))
    .filter((s) => s.length > 0);

  // 禁止声明 → 禁止约束
  const prohibitedClaims = version.prohibitedClaims.map((claim) => claim.summary.slice(0, 500));

  // unknown / conflict → 未知项（不得推断、不得补全）
  const unknowns = version.issues
    .filter((issue) => issue.kind === "conflict" || issue.kind === "missing")
    .map((issue) => issue.summary.slice(0, 300))
    .filter((s) => s.length > 0);

  if (productFacts.length < 1 && stableSourceFacts.length < 1) {
    return { ok: false, code: "listing_input_empty", message: "当前交接没有可用于 Listing 的事实。" };
  }

  const creativePreferences: Record<string, string> = {};
  const prefs = version.creativePreferences;
  if (isRecord(prefs)) {
    // additionalRequirements：仅影响语气/结构/表达方式，不作为商品事实（材质/尺寸/性能/认证等禁止从偏好注入）
    for (const key of ["targetMarket", "language", "tone", "targetAudiencePreference", "imageStyle", "backgroundPreference", "compositionPreference", "additionalRequirements"] as const) {
      const value = prefs[key];
      if (typeof value === "string" && value.trim()) creativePreferences[key] = value.normalize("NFC").trim().slice(0, key === "additionalRequirements" ? 200 : 300);
    }
  }

  const input: ListingGenerationInput = {
    schema: "listing-generation-input.v1",
    source: {
      handoffRevision: handoff.currentRevision,
      researchRevision,
    },
    productFacts,
    stableSourceFacts,
    creativeReferences,
    creativePreferences,
    prohibitedClaims,
    unknowns,
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };

  const generationInputFingerprint = createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");

  return { ok: true, input, generationInputFingerprint, handoffRevision: handoff.currentRevision, researchRevision };
}

/** 供测试/证据使用的已验证事实字段摘要（不含值，仅字段级安全摘要） */
export function safeListingInputSummary(input: ListingGenerationInput) {
  return {
    schema: input.schema,
    source: input.source,
    factFieldCount: input.productFacts.length + input.stableSourceFacts.length,
    productFactFields: input.productFacts.map((f) => f.field),
    stableSourceFactFields: input.stableSourceFacts.map((f) => f.field),
    creativeReferenceCount: input.creativeReferences.length,
    prohibitedClaimCount: input.prohibitedClaims.length,
    unknownCount: input.unknowns.length,
    creativePreferenceKeys: Object.keys(input.creativePreferences),
    humanReviewRequired: input.humanReviewRequired,
    researchMode: input.researchMode,
    promotionEligible: input.promotionEligible,
  };
}

/** 内部字段泄漏防护：确认哪些 key 绝不能出现在输入中 */
export const LISTING_INPUT_FORBIDDEN_KEYS = Object.freeze([
  "actorRef", "subjectFingerprint", "candidateId", "requestId", "requestLedger",
  "researchHash", "handoffFingerprint", "candidateSnapshotFingerprint",
  "sellerSpriteSnapshotFingerprint", "researchResultFingerprint", "confirmationReference",
  "resultJson", "sourceRef", "assetFingerprint", "createdBy", "confirmedBy", "approvedBy",
]);

/** 确保稳定字段不被未知 key 覆盖（exact keys 防护） */
export function hasForbiddenInputKey(input: Record<string, unknown>): boolean {
  return LISTING_INPUT_FORBIDDEN_KEYS.some((key) => Object.prototype.hasOwnProperty.call(input, key));
}
