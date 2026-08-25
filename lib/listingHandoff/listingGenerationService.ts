import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import {
  buildListingInputFromCreativeHandoff,
  computeListingGenerationFingerprint,
  LISTING_COMPOSER_VERSION,
} from "@/lib/listingHandoff/listingGenerationInput";
import { withListingBrief, type ListingBrief } from "@/lib/listingHandoff/listingBrief";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingHandoffBinding, parseListingHandoffBinding, computeListingStatus, isHandoffListedDraftShape, type ListingHandoffBindingV1, type ListingStatus } from "@/lib/listingHandoff/listingBinding";
import type { MockListingProvider } from "@/lib/listingHandoff/mockListingProvider";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { classifyClaimTier } from "@/lib/listingHandoff/listingClaimTier";
import { buildDeterministicListingPackDraft, composeBullets as composeSafeBullets, composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { RUNTIME_QUALITY_LIMITS, type RuntimeFact, validateRuntimeQualityContract, type RuntimeIssue } from "@/lib/listingHandoff/listingRuntimeSkill";
import { pickBestKeyword } from "@/lib/research/researchInputQuality";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { parseListingKeywordBrief, buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { buildAutoKeywordPlan } from "@/lib/listingHandoff/listingAutoKeywordPlan";
import { deriveUsedKeywordIds } from "@/lib/listingHandoff/listingKeywordProvenance";
import { filterBackendSearchTerms } from "@/lib/listingHandoff/listingBackendTermSafety";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { getProductResearchRecord, getProductResearchVerification, verifyProductResearchHash } from "@/lib/productResearchRecord";

export class ListingHandoffError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "ListingHandoffError";
  }
}

export type ListingGenerateInput = {
  requestId: string;
  expectedStorageVersion: TaskResultJsonStorageVersionHash;
  expectedHandoffRevision: number;
  /** Request-scoped marketing direction; never persisted as a Creative Handoff fact. */
  listingBrief?: ListingBrief | null;
};

export type ListingDraftSafeSummary = {
  generatedAt: string | null;
  source: string | null;
  version: number | null;
  composerVersion: string | null;
  generationPolicyVersion: string | null;
  polishApplied: boolean;
  polishModel: string | null;
  titles: string[];
  bullets: string[];
  description: string | null;
  keywords: string[];
  backendSearchTerms?: string[];
  /** R1.6：被安全过滤的 backend term 人工可读警告（不暴露内部 id） */
  backendTermWarnings?: string[];
  /** Draft-level audit metadata, not per-claim citations. */
  /** 轮 21：实际使用的已确认商品事实（仅 label/value；不返回内部 field） */
  usedFactTrace?: Array<{ label: string; value: string }>;
  /** R2：实际采用的关键词文本（由 usedKeywordIds + brief 确定性映射） */
  usedKeywordTrace?: string[];
  /** R2：生成时提供给 AI 的研究参考（有界、业务语言、去内部前缀） */
  researchReferenceTrace?: string[];
  /** 服务端三级判定保留的低风险表达（待人工确认；有界返回，不暴露内部字段） */
  humanReviewClaims?: string[];
  /** 服务端派生的关键词溯源 id（有界返回） */
  /** 关键词方案来源：人工方案 / 自动方案 / 无有效方案 */
  keywordPlanSource?: "manual" | "auto_suggested" | "none";
  draftKind?: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft";
  qualityIssues?: string[];
  providerAttempted?: boolean;
  providerSucceeded?: boolean;
  fallbackApplied?: boolean;
  fallbackReason?: string | null;
  sellingPoints: string[];
  riskNotes: string[];
  reviewChecklist: string[];
  blockedClaims: string[];
  complianceWarnings: string[];
  /** R6：Listing 质量不合格（碎片/数量不足）；前端只显示「暂无合格草稿」 */
  listingUnqualified?: boolean;
  /** R6：被拒绝的具体句子 + 中文原因（有界 ≤5，无内部 id/hash/runId） */
  rejectedListingSentences?: Array<{ text: string; reason: string }>;
};

export type ListingGenerateResult = {
  listingStatus: ListingStatus;
  currentHandoffRevision: number | null;
  sourceHandoffRevision: number | null;
  staleReasonCode?: string;
  idempotentReplay: boolean;
  listingSaved: boolean;
  draft: ListingDraftSafeSummary | null;
  /** V2 Listing 稳定落库：AI 输出未通过事实校验时系统生成保守草稿 */
  safeFallbackApplied: boolean;
  handoffState: { controlState: string; stale: boolean } | null;
};

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function storageTime(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

/** 与 taskResultJsonMutation 一致的 storageVersion 校验（expected 为 hash 形式） */
function snapshotVersionMatches(
  snapshot: { resultJson: string; updatedAt: Date | string },
  expected: TaskResultJsonStorageVersionHash,
): boolean {
  if (storageTime(snapshot.updatedAt) !== storageTime(expected.updatedAt)) return false;
  const hash = sha256(snapshot.resultJson);
  return hash === expected.resultJsonHash;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 20)
    : [];
}

function safeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

/** Keyword Brief 是 SEO 输入，不是事实来源；最终草稿中的每个 keyword 仍须能通过正式 Claim Evidence。 */
function filterKeywordsByClaimEvidence(keywords: string[], generationInput: ListingGenerationInput, traceableTerms: string[] = []): string[] {
  // 轮 16：来自已保存 SellerSprite keywordEvidence 的 auto_suggested 词是可追溯 SEO 资料
  // （非 AI 自造、非商品事实声明），与"无证据的 brief 词不得进入草稿"不冲突。
  const traceable = new Set(traceableTerms.map((k) => k.trim().toLowerCase()));
  return keywords.filter((keyword) => {
    if (traceable.has(keyword.trim().toLowerCase())) return true;
    return listingClaimsHaveEvidence(verifyListingClaims({
    source: "deterministic_composition_v1",
    version: 1,
    generatedAt: "1970-01-01T00:00:00.000Z",
    model: "claim-evidence-keyword-filter",
    humanReviewRequired: true,
    titles: [],
    bullets: [],
    description: "",
    keywords: [keyword],
    sellingPoints: [],
    riskNotes: [],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [],
  }, generationInput));
  });
}

/** 最终输出边界稳定去重（大小写不敏感，保留首次出现顺序；不改变选词算法） */
function dedupeTerms(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = String(item).trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** 从草稿提取安全摘要（不含事实原始对象/内部引用） */
/** 轮 21：usedFactIds（field 名）→ 安全事实标签+值（生成依据展示；仅白名单事实）。 */
function buildUsedFactTrace(
  facts: Array<{ field: string; label: string; value: string }>,
  usedIds: string[] | undefined,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(usedIds)) return [];
  const out: Array<{ label: string; value: string }> = [];
  for (const id of usedIds) {
    const match = facts.find((f) => f.field === id);
    if (match) out.push({ label: match.label, value: match.value });
  }
  return out;
}

/** R2：usedKeywordIds + brief → 具体关键词文本（确定性、有界） */
function deriveUsedKeywordTrace(
  usedKeywordIds: string[] | undefined,
  brief: { primaryKeyword: string; supportingKeywords: string[]; backendSearchTerms: string[] } | null,
): string[] {
  if (!Array.isArray(usedKeywordIds) || usedKeywordIds.length === 0 || !brief) return [];
  const byId = new Map<string, string>();
  const seen = new Set<string>();
  if (brief.primaryKeyword) {
    byId.set("kw:primary", brief.primaryKeyword);
    seen.add(brief.primaryKeyword.toLowerCase());
  }
  brief.supportingKeywords.forEach((kw, i) => {
    if (!seen.has(kw.toLowerCase())) { byId.set(`kw:${i}`, kw); seen.add(kw.toLowerCase()); }
  });
  brief.backendSearchTerms.forEach((term, j) => {
    if (!seen.has(term.toLowerCase())) { byId.set(`kw:backend:${j}`, term); seen.add(term.toLowerCase()); }
  });
  const out: string[] = [];
  for (const id of usedKeywordIds) {
    const text = byId.get(id);
    if (text) out.push(text);
  }
  return out.slice(0, 20);
}

/** R2：AI 研究参考 → 业务语言文本（去 "AI REFERENCE (NOT FACT): " 内部前缀；有界） */
function deriveResearchReferenceTrace(
  context: { aiReferences?: string[] } | undefined,
): string[] {
  const refs = context?.aiReferences ?? [];
  return refs.slice(0, 6).map((ref) => String(ref).replace(/^AI REFERENCE \(NOT FACT\):\s*/i, "").slice(0, 140));
}
/** R6：从 bullets 派生质量状态（碎片/数量不足 → 不合格 + 逐条中文原因；有界） */
function computeUnqualifiedFields(input: { bullets: string[] }): {
  listingUnqualified: boolean;
  rejectedListingSentences: Array<{ text: string; reason: string }>;
} {
  const bullets = input.bullets;
  const rejected: Array<{ text: string; reason: string }> = [];
  for (const b of bullets) {
    const wc = b.trim().split(/\s+/).filter(Boolean).length;
    if (wc < 8) {
      rejected.push({ text: b.slice(0, 140), reason: "该条不足 8 个英文词（属性碎片/过短），不是合格句。" });
    } else if (wc > 30) {
      rejected.push({ text: b.slice(0, 140), reason: "该条超过 30 个英文词，不是合格句。" });
    } else if (!/[.!?]$/.test(b.trim())) {
      rejected.push({ text: b.slice(0, 140), reason: "该条不是完整句（缺少句末标点）。" });
    }
  }
  return {
    listingUnqualified: bullets.length < 3 || rejected.length > 0,
    rejectedListingSentences: rejected.slice(0, 5),
  };
}

export function draftSafeSummary(value: unknown): ListingDraftSafeSummary | null {
  if (!isRecord(value) || !isHandoffListedDraftShape(value)) return null;
  return {
    generatedAt: safeString(value.generatedAt),
    source: safeString(value.source),
    version: safeInt(value.version),
    composerVersion: safeString(value.composerVersion),
    generationPolicyVersion: safeString(value.generationPolicyVersion),
    polishApplied: value.polishApplied === true,
    polishModel: safeString(value.polishModel),
    titles: safeStringArray(value.titles).slice(0, 3),
    bullets: safeStringArray(value.bullets).slice(0, 5),
    description: safeString(value.description),
    keywords: safeStringArray(value.keywords).slice(0, 12),
    backendSearchTerms: Array.isArray(value.backendSearchTerms)
      ? value.backendSearchTerms.filter((item): item is string => typeof item === "string").slice(0, 50)
      : undefined,
    backendTermWarnings: Array.isArray(value.backendTermWarnings)
      ? value.backendTermWarnings.filter((item): item is string => typeof item === "string").slice(0, 10)
      : undefined,
    usedFactTrace: Array.isArray(value.usedFactTrace)
      ? value.usedFactTrace
          .filter((item): item is { label: string; value: string } =>
            isRecord(item) && typeof item.label === "string" && typeof item.value === "string")
          .map((item) => ({ label: item.label.slice(0, 80), value: item.value.slice(0, 200) }))
          .slice(0, 30)
      : undefined,
    usedKeywordTrace: Array.isArray(value.usedKeywordTrace)
      ? value.usedKeywordTrace.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 120))
          .slice(0, 20)
      : undefined,
    researchReferenceTrace: value.providerAttempted === true
      ? (Array.isArray(value.researchReferenceTrace)
          ? value.researchReferenceTrace.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              .map((item) => item.trim().slice(0, 160))
              .slice(0, 6)
          : undefined)
      : undefined,
    humanReviewClaims: Array.isArray(value.humanReviewClaims)
      ? value.humanReviewClaims.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim().slice(0, 120))
          .slice(0, 5)
      : undefined,
    keywordPlanSource: value.keywordPlanSource === "manual" || value.keywordPlanSource === "auto_suggested" || value.keywordPlanSource === "none"
      ? value.keywordPlanSource
      : undefined,
    draftKind: value.draftKind === "ai_optimized_listing" || value.draftKind === "structured_listing_draft" || value.draftKind === "safe_fact_draft"
      ? value.draftKind
      : undefined,
    qualityIssues: Array.isArray(value.qualityIssues)
      ? value.qualityIssues.filter((item): item is string => typeof item === "string").slice(0, 10)
      : undefined,
    providerAttempted: typeof value.providerAttempted === "boolean" ? value.providerAttempted : undefined,
    providerSucceeded: typeof value.providerSucceeded === "boolean" ? value.providerSucceeded : undefined,
    fallbackApplied: value.fallbackApplied === true,
    fallbackReason: typeof value.fallbackReason === "string" && value.fallbackReason ? value.fallbackReason : null,
    // R6：历史/既有快照亦诚实标注（检测碎片句），不把低质量快照当可用成果
    ...computeUnqualifiedFields({ bullets: safeStringArray(value.bullets).slice(0, 5) }),
    // 已有明确拒绝原因时保留执行期结果（fallback 写入的 rejectedListingSentences 优先于纯粹的碎片推导）
    rejectedListingSentences: (Array.isArray(value.rejectedListingSentences) && value.rejectedListingSentences.length > 0)
      ? value.rejectedListingSentences.slice(0, 5)
      : (computeUnqualifiedFields({ bullets: safeStringArray(value.bullets).slice(0, 5) }).rejectedListingSentences),
    sellingPoints: safeStringArray(value.sellingPoints).slice(0, 6),
    riskNotes: safeStringArray(value.riskNotes),
    reviewChecklist: safeStringArray(value.reviewChecklist),
    blockedClaims: safeStringArray(value.blockedClaims),
    complianceWarnings: safeStringArray(value.complianceWarnings),
  };
}

/**
 * 锁内快照语义：在 mutate 回调内不得再读数据库。
 * 所有二次验证基于 CAS/Store 锁内的 current（resultJson 快照）解析：
 * creativeHandoff 严格解析 + research 记录 hash 校验 + evaluateHandoffStatus 语义。
 */
function revalidateHandoffFromSnapshot(current: Record<string, unknown>, expectedHandoffRevision: number) {
  const handoffRaw = current.creativeHandoff;
  const handoff = handoffRaw !== undefined ? parseProductCreativeHandoff(handoffRaw) : null;
  if (!handoff || handoff.controlState !== "active") {
    throw new ListingHandoffError("handoff_stale", 409, "交接内容已经更新，请重新生成。");
  }
  if (handoff.currentRevision !== expectedHandoffRevision) {
    throw new ListingHandoffError("handoff_revision_conflict", 409, "交接内容已经更新，请重新生成。");
  }
  const record = getProductResearchRecord(current);
  const verification = getProductResearchVerification(current);
  if (!record || !verification || !verifyProductResearchHash(record, verification)) {
    throw new ListingHandoffError("handoff_stale", 409, "研究记录状态异常，请刷新后重新生成。");
  }
  const version = handoff.versions[handoff.versions.length - 1];
  if (!version || version.revision !== handoff.currentRevision) {
    throw new ListingHandoffError("handoff_stale", 409, "交接版本无效，请刷新后重新生成。");
  }
  return { handoff, version, researchRevision: record.revision };
}

export type ListingGenerationOptions = {
  /** V2.1.6 基础路径不会调用 Provider；保留注入形态仅兼容既有调用与证明零调用。 */
  provider?: MockListingProvider;
  /** 仅用于并发测试制造 Composition 与保存之间的窗口；生产路由不传入。 */
  providerOptions?: Parameters<MockListingProvider["generate"]>[1];
};

/**
 * PR2-2: 从 active Handoff 生成 Listing 草稿并保存绑定。
 * 阶段A（锁外）：Gate 验证 + 构造安全输入 + 幂等预检。
 * 阶段B（锁外）：确定性 Composition + Schema + Claim Evidence（不调用 Provider）。
 * 阶段C（锁内）：基于锁内快照二次验证（handoff active/revision/fingerprint/research）→
 *                幂等确认 → Claim Filter → 原子保存 aiListingPackSnapshot + listingHandoffBinding。
 */
export async function generateListingDraftFromHandoff(
  taskId: string,
  context: AccessContext,
  input: ListingGenerateInput,
  options: ListingGenerationOptions = {},
): Promise<ListingGenerateResult> {
  // ── 阶段A：生成前快照（锁外验证）──
  const gateA = await checkCreativeHandoffGate(taskId, context);
  if (gateA.reason === "research_hash_invalid" || gateA.reason === "verification_invalid") {
    // 研究基础已变化（如 Decision Writer 并发更新）→ 过期，需刷新后重新生成
    throw new ListingHandoffError("handoff_stale", 409, "研究记录状态已变化，请刷新后重新生成。");
  }
  if (gateA.handoffContractInvalid) {
    throw new ListingHandoffError("handoff_required", 422, "创作交接合同结构异常。");
  }
  if (gateA.ledgerInvalid) {
    throw new ListingHandoffError("handoff_required", 422, "创作交接状态异常。");
  }
  const handoffA = gateA.currentHandoff;
  if (!handoffA) {
    throw new ListingHandoffError("handoff_required", 422, "请先完成创作交接并进行人工确认。");
  }
  if (handoffA.controlState === "revoked") {
    throw new ListingHandoffError("handoff_revoked", 422, "创作交接已撤回，不能用于生成 Listing。");
  }
  if (handoffA.currentRevision !== input.expectedHandoffRevision) {
    throw new ListingHandoffError("handoff_revision_conflict", 409, "创作交接版本已变化，请刷新后重新生成。");
  }
  if (!gateA.candidate) {
    throw new ListingHandoffError("handoff_required", 422, "创作交接证据缺失。");
  }
  const researchRevision = gateA.candidate.sourceResearch.researchRevision;
  // V3 Evidence → Creative Context Bridge：研究 Evidence 参考层随 Listing 输入进入（参考 only，非事实）。
  // 第3轮：irrelevant 竞品（design 注释：数据不删除但不进入 Listing 依据）必须在进入生成输入前过滤；
  // adjacent 仅作定位参考，direct 作为竞品定位参考（均非商品事实）。
  const creativeContextForListing = gateA.creativeContext
    ? {
        ...gateA.creativeContext,
        competitiveContext: gateA.creativeContext.competitiveContext.filter((c) => c.relation !== "irrelevant"),
      }
    : null;
  const buildResult = buildListingInputFromCreativeHandoff(handoffA, researchRevision, {
    creativeContext: creativeContextForListing,
  });
  if (!buildResult.ok) {
    throw new ListingHandoffError(buildResult.code, 422, buildResult.message);
  }
  const generationInputBase = withListingBrief(buildResult.input, input.listingBrief);

  // R3.2 English rendering：中文 confirmed facts 转英文（factRef 溯源），不跳过、不丢事实。
  // 逐事实 fail-closed（渲染器文档：无法安全英文化的事实不进入最终 Listing）。
  const { buildEnglishRenderingPack, ENGLISH_RENDERING_VERSION } = await import("@/lib/listingHandoff/listingEnglishRendering");
  const renderingResult = await buildEnglishRenderingPack({
    facts: buildResult.input.productFacts.map((f) => ({
      factId: f.field,
      field: f.field,
      sourceValue: f.value,
    })),
  });
  let generationInput: ListingGenerationInput;
  if (renderingResult.ok) {
    generationInput = { ...generationInputBase, englishRenderings: renderingResult.pack };
  } else if (renderingResult.code === "integrity_failed" && renderingResult.message.includes("cannot render to English")) {
    // Provider 关闭 / AI 翻译不可用时的确定性降级（与渲染器“该 fact 不进入最终 Listing”的
    // 逐事实 fail-closed 契约一致）：不调外部 Provider；仅无法英文化（含 CJK/粘连）事实不进入
    // 组合输入，其余 already-English 事实保持原样；Claim Evidence / Runtime 门禁零放宽。
    generationInput = {
      ...generationInputBase,
      englishRenderings: { schema: ENGLISH_RENDERING_VERSION, renderings: [], generatedAt: null, source: "literal" },
    };
  } else {
    throw new ListingHandoffError("listing_english_rendering_failed", 422, `事实英文化失败：${renderingResult.message}`);
  }
  const generationInputFingerprint = computeListingGenerationFingerprint(generationInput);

  // ── 阶段B：Composition first（锁外，不持锁，不调用 Provider）──
  const generatedAt = new Date().toISOString();

  const deterministicDraft = buildDeterministicListingPackDraft(generationInput, generatedAt);
  const deterministicSchema = validateAiListingPackDraft(deterministicDraft);
  if (!deterministicSchema.ok) {
    throw new ListingHandoffError("listing_schema_invalid", 422, "组合草稿未通过结构校验。");
  }
  const deterministicFiltered = filterListingClaims(deterministicSchema.data, {
    prohibitedClaims: generationInput.prohibitedClaims,
    customClaimLabel: "Handoff prohibited claim",
  });
  const deterministicEvidence = verifyListingClaims(deterministicFiltered.cleaned, generationInput);
  if (!listingClaimsHaveEvidence(deterministicEvidence)) {
    throw new ListingHandoffError("listing_claims_unsupported", 422, "组合草稿未通过事实校验，请补充确认事实后重试。");
  }
  const safeDraft = deterministicFiltered.cleaned as unknown as Record<string, unknown>;

  // ── 幂等预检（阶段A，Provider 调用之前）──
  // 同 requestId 同 fingerprint → 不调用 Provider，直接进入锁内重放确认；
  // 同 requestId 不同语义 → 409（不调用 Provider）。
  let idempotentPrefetchHit = false;
  const existingBindingRawA = gateA.listingHandoffBindingRaw;
  if (existingBindingRawA !== undefined) {
    const existingA = parseListingHandoffBinding(existingBindingRawA);
    if (existingA && existingA.requestIdHash === sha256(input.requestId)) {
      if (existingA.generationInputFingerprint === generationInputFingerprint) {
        idempotentPrefetchHit = true;
      } else {
        throw new ListingHandoffError("listing_idempotency_conflict", 409, "相同请求标识内容不一致。");
      }
    }
  }

  if (!idempotentPrefetchHit && options.providerOptions?.delayMs && options.providerOptions.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.providerOptions!.delayMs));
  }

  // ── 阶段C：保存前重新验证（锁内）──
  const binding = buildListingHandoffBinding({
    sourceHandoffId: handoffA.handoffId,
    sourceHandoffRevision: handoffA.currentRevision,
    sourceHandoffFingerprint: handoffA.versions[handoffA.versions.length - 1].handoffFingerprint,
    sourceResearchRevision: researchRevision,
    generationInputFingerprint,
    generatedAt,
    model: LISTING_COMPOSER_VERSION,
    requestId: input.requestId,
  });

  const result = await mutateTaskResultJson<{ listingStatus: ListingStatus; idempotentReplay: boolean; staleReasonCode?: string }>({
    context,
    taskId,
    writer: "ai-listing",
    // expectedStorageVersion 不在外层传 — 幂等重放必须先命中 Binding（与 PR2-1 Ledger 顺序一致），
    // storageVersion 校验在回调内、幂等查找之后执行（同一 CAS 快照内）。
    async mutate(current, snapshot) {
      // ── 锁内二次验证（快照内解析，无数据库读）──
      // 1) Handoff revision / fingerprint 优先验证（规格：Revision 变化 → 409 优先于 sv 冲突）
      const validated = revalidateHandoffFromSnapshot(current, input.expectedHandoffRevision);
      const { handoff: handoffC, version: versionC } = validated;
      if (sha256(versionC.handoffFingerprint) !== binding.sourceHandoffFingerprintHash) {
        throw new ListingHandoffError("handoff_stale", 409, "交接内容已经更新，请重新生成。");
      }

      // ── 幂等检查（锁内，同 requestId 语义；先于 storageVersion 校验）──
      const existingRaw = current.listingHandoffBinding;
      let existing: ListingHandoffBindingV1 | null = null;
      if (existingRaw !== undefined) {
        existing = parseListingHandoffBinding(existingRaw);
        if (existing && existing.requestIdHash === binding.requestIdHash) {
          // 同 requestId 同 fingerprint（含同 input）→ 重放，不增加版本、不覆盖
          if (existing.generationInputFingerprint === binding.generationInputFingerprint) {
            return {
              result: current as Record<string, unknown>,
              value: { listingStatus: "active", idempotentReplay: true },
            };
          }
          // 同 requestId 不同语义 → 409
          throw new ListingHandoffError("listing_idempotency_conflict", 409, "相同请求标识内容不一致。");
        }
        // 同 fingerprint 不同 requestId → 已有相同草稿（返回现有，不重复生成）
        if (existing && existing.generationInputFingerprint === binding.generationInputFingerprint) {
          return {
            result: current as Record<string, unknown>,
            value: { listingStatus: "active", idempotentReplay: true },
          };
        }
      }

      // ── storageVersion 校验（非重放请求才执行；与 PR2-1 第十节顺序一致）──
      if (!snapshotVersionMatches(snapshot, input.expectedStorageVersion)) {
        throw new TaskResultJsonMutationError(
          "task_result_conflict",
          409,
          "任务已在其他页面更新，请刷新后重试。",
        );
      }

      const status: ListingStatus = computeListingStatus({
        binding,
        currentHandoff: { handoffId: handoffC.handoffId, currentRevision: handoffC.currentRevision, controlState: handoffC.controlState, stale: false },
        researchRevision: validated.researchRevision,
      });

      // Quality.1（锁内）：读 keyword brief → readiness → plan → 决定草稿类型
      const keywordBrief = parseListingKeywordBrief(current.listingKeywordBrief);
      // 轮 16：无人工 Brief 时从 keywordEvidence 派生 auto_suggested 计划（同源传给主链），
      // 不关闭 SEO 优化；人工 Brief 存在时人工优先。
      const autoBrief = keywordBrief
        ? null
        : (() => {
            const auto = buildAutoKeywordPlan({
              keywordCandidates: generationInput.creativeContext?.keywordCandidates ?? [],
              confirmedFacts: generationInput.productFacts.map((f) => ({ field: f.field, label: f.label, value: f.value })),
              ownBrand: generationInput.productFacts.find((f) => f.field === "brand")?.value ?? "",
              knownBrands: [],
            });
            if (!auto.primaryKeyword) return null;
            const built = buildListingKeywordBrief({
              primaryKeyword: auto.primaryKeyword,
              supportingKeywords: auto.supportingKeywords,
              backendSearchTerms: auto.backendSearchTerms,
              source: "auto_suggested",
              capturedAt: new Date().toISOString(),
              evidenceRef: "ev:keyword:auto_suggested",
              reportHash: undefined,
            });
            return built.ok ? built.brief : null;
          })();
      // 第1轮：已保存 Brief 主词相关度不足 → 标记"需重新确认"，不进入 effectiveKeywordBrief（数据不删除）
      const productNameForRelevance = [
        generationInput.productFacts.find((f) => f.field === "brand")?.value ?? "",
        generationInput.productFacts.find((f) => f.field === "series_or_model")?.value ?? "",
        generationInput.productFacts.find((f) => f.field === "product_type")?.value ?? "",
      ].filter(Boolean).join(" ");
      let keywordBriefNeedsConfirm = false;
      if (keywordBrief && productNameForRelevance.trim()) {
        const best = pickBestKeyword([{ keyword: keywordBrief.primaryKeyword }], productNameForRelevance);
        if (!best) {
          keywordBriefNeedsConfirm = true;
        }
      }
      const effectiveKeywordBrief = keywordBrief && !keywordBriefNeedsConfirm ? keywordBrief : autoBrief;
      // 轮 16：auto_suggested 计划的全部词可追溯到已保存 keywordEvidence（同源安全集），
      // 通过 Claim Evidence 关键词过滤时放行；人工 Brief 词维持原有证据校验（零回归）。
      const autoTraceableTerms = effectiveKeywordBrief && effectiveKeywordBrief.source === "auto_suggested"
        ? [effectiveKeywordBrief.primaryKeyword, ...effectiveKeywordBrief.supportingKeywords, ...effectiveKeywordBrief.backendSearchTerms].filter(Boolean)
        : [];
      const withoutKeywordOptimization = (draft: Record<string, unknown>): Record<string, unknown> => effectiveKeywordBrief
        ? draft
        : { ...draft, keywords: [], backendSearchTerms: [] };
      const readiness = buildListingReadiness({
        confirmedFacts: handoffC.versions[handoffC.versions.length - 1].confirmedFacts,
        listingEligibleFacts: generationInput.productFacts.length,
        hasBlockingIssue: false,
        keywordBrief: effectiveKeywordBrief,
      });
      const plan = buildListingPlan(generationInput, effectiveKeywordBrief);
      const copyReady = readiness.copyReady && plan.planQuality === "optimized";
      const keywordReady = readiness.keywordReady;
      let finalDraft: Record<string, unknown> = safeDraft;
      let draftKind: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft" = "safe_fact_draft";
      let qualityIssues: string[] = [];
      let providerAttempted = false;
      let providerSucceeded = false;
      let fallbackApplied = false;
      let fallbackReason: string | null = null;
      let fallbackReasonCode: "listing_claims_unsupported" | "provider_failed" | "listing_output_invalid" | null = null;


  /** 运行时 Skill 合同所需事实（已确认事实原值；id = field） */
  const runtimeFacts = generationInput.productFacts.map((f): RuntimeFact => ({ factId: f.field, field: f.field, label: f.label, value: String(f.value ?? "").trim() }));
  const runtimeUsedIds = runtimeFacts.map((f) => f.factId);
  const asRejected = (issues: RuntimeIssue[], bullets: string[]): Array<{ text: string; reason: string }> => {
    const out: Array<{ text: string; reason: string }> = [];
    const seen = new Set<string>();
    for (const issue of issues) {
      if (issue.target !== "bullets") continue;
      const idx = Number(String(issue.code).length ? String(issue.code) : "") || 0;
      const bullet = bullets[Math.min(Math.max(Number((issue.message.match(/Bullet (\d+)/) || [])[1] ?? "0") - 1, 0), bullets.length - 1)] ?? "";
      const key = bullet.slice(0, 80);
      if (!bullet || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: bullet.slice(0, RUNTIME_QUALITY_LIMITS.rejectedTextMax), reason: issue.message.slice(0, 80) });
    }
    return out.slice(0, RUNTIME_QUALITY_LIMITS.rejectedDisplayMax);
  };
  const runtimeQualityInputOf = (draft: Record<string, unknown>, filtered: Record<string, unknown> | null, bullets: string[], description: string): Parameters<typeof validateRuntimeQualityContract>[0] => {
    const title = String((filtered?.titles as string[] ?? draft.titles as string[] ?? [])[0] ?? "");
    return {
      title,
      bullets,
      description,
      keywords: dedupeTerms(((filtered?.keywords ?? draft.keywords ?? []) as string[])),
      facts: runtimeFacts,
      usedFactIds: runtimeUsedIds,
    };
  };
            const applyStructuredFallback = (publicReason: string, reasonCode: typeof fallbackReasonCode, issue: string) => {
          const optimized = composeOptimizedListingDraft(generationInput, plan, effectiveKeywordBrief);
          const optimizedKeywords = filterKeywordsByClaimEvidence(optimized.keywords, generationInput, autoTraceableTerms);
          const primaryKeyword = effectiveKeywordBrief ? plan.primaryKeyword : null;
          const primaryHasEvidence = !primaryKeyword
            || filterKeywordsByClaimEvidence([primaryKeyword], generationInput, autoTraceableTerms).length === 1;
          const optimizedTitles = primaryHasEvidence
            ? optimized.titles
            : composeOptimizedListingDraft(generationInput, plan, effectiveKeywordBrief).titles;
          const optimizedDraft = {
            ...safeDraft,
            titles: optimizedTitles,
            bullets: optimized.bullets,
            description: optimized.description,
            keywords: dedupeTerms(optimizedKeywords),
            backendSearchTerms: dedupeTerms(optimized.backendSearchTerms),
            riskNotes: ["结构化草稿基于已确认事实生成；所有表述仍需人工复核。"],
            reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
          };
          const optimizedSchema = validateAiListingPackDraft(optimizedDraft);
          const optimizedFiltered = optimizedSchema.ok
            ? filterListingClaims(optimizedSchema.data, {
                prohibitedClaims: generationInput.prohibitedClaims,
                customClaimLabel: "Handoff prohibited claim",
              })
            : null;
          const optimizedEvidence = optimizedFiltered
            ? verifyListingClaims(optimizedFiltered.cleaned, generationInput)
            : null;
          // R6：结构化回退与 AI 路径同跑运行时 Skill 质量合同（8-30 词完整句+事实锚点+品牌去重+关键词去重+描述句数）
          const optimizedContract = validateRuntimeQualityContract(runtimeQualityInputOf(optimizedDraft, (optimizedFiltered?.cleaned ?? null) as unknown as Record<string, unknown> | null, (optimizedFiltered ? optimizedFiltered.cleaned.bullets : optimizedDraft.bullets) ?? [], String(optimizedFiltered ? optimizedFiltered.cleaned.description : optimizedDraft.description ?? "")));
          const optimizedQuality = optimizedFiltered && optimizedContract.ok ? { ok: true, blockingIssues: [], issues: [], advisories: [] } : { ok: false, blockingIssues: optimizedContract.issues, issues: optimizedContract.issues, advisories: [] };

          fallbackApplied = true;
          fallbackReason = publicReason;
          fallbackReasonCode = reasonCode;
          if (optimizedSchema.ok && optimizedFiltered && optimizedEvidence && listingClaimsHaveEvidence(optimizedEvidence) && optimizedQuality?.ok && optimizedContract.ok) {
            draftKind = "structured_listing_draft";
            finalDraft = withoutKeywordOptimization({ ...optimizedFiltered.cleaned });
            qualityIssues = [issue];
            return;
          }

          // R6：碎片兜底已删除——safe_fact_draft 只允许安全模板完整句；质量不达标 → 无合格草稿
          const safeBullets = composeSafeBullets(generationInput);
          const removedFragments: Array<{ text: string; reason: string }> = optimizedContract.ok || !optimizedFiltered
            ? []
            : asRejected(optimizedContract.issues, optimizedFiltered.cleaned.bullets);
          const safeContract = validateRuntimeQualityContract({
            title: String((safeDraft.titles as unknown as string[] ?? [])[0] ?? ""),
            bullets: safeBullets,
            description: String(safeDraft.description ?? ""),
            keywords: dedupeTerms((safeDraft.keywords ?? []) as string[]),
            facts: runtimeFacts,
            usedFactIds: runtimeUsedIds,
          });
          const safeQualified = safeBullets.length >= 3 && safeContract.ok;
          draftKind = "safe_fact_draft";
          finalDraft = withoutKeywordOptimization({
            ...safeDraft,
            bullets: safeQualified ? safeBullets.slice(0, 5) : [],
            keywords: dedupeTerms((safeDraft.keywords ?? []) as string[]),
          });
          qualityIssues = Array.from(new Set([
            issue,
            ...(!optimizedSchema.ok ? ["结构化回退未通过 schema 校验"] : []),
            ...(optimizedEvidence && !listingClaimsHaveEvidence(optimizedEvidence) ? ["结构化回退未通过 Claim Evidence"] : []),
            ...(optimizedContract.ok ? [] : optimizedContract.issues.map((item) => item.message)),
            ...(optimizedQuality?.issues.map((item) => item.message) ?? []),
            ...(safeQualified ? [] : ["确认事实不足以组成至少 3 条合格句。"]),
          ])).slice(0, 8);
          finalDraft.rejectedListingSentences = (removedFragments.length > 0 ? removedFragments : asRejected(safeContract.issues, safeBullets)).slice(0, 5);
          finalDraft.listingUnqualified = !safeQualified;
        };

      if (copyReady) {
        // Quality.2（v2.2.14）：copyReady=true 即允许真实 AI 正文优化；
        // Keyword Brief 只决定是否做搜索词优化（keywordReady），不阻断正文生成。
        providerAttempted = true;
        const { generateTaskLinkedAiListing } = await import("@/lib/server/taskLinkedAiListing");
        const aiInput = {
          facts: generationInput.productFacts.map((f) => ({
            factId: f.field,
            field: f.field,
            label: f.label,
            value: f.value,
          })),
          plan,
          keywordBrief: effectiveKeywordBrief,
          listingBrief: generationInput.listingBrief ?? null,
          prohibitedClaims: generationInput.prohibitedClaims,
          creativeContext: generationInput.creativeContext,
        };
        const aiResult = await generateTaskLinkedAiListing(aiInput);
        if (aiResult.ok) {
          // v2.2.14：无 Keyword Brief 时 backend terms 必须为空（AI 不得自造关键词）；
          // 有 Brief 时经 R1.6 backend term fact safety 过滤。
          const backendSafety = effectiveKeywordBrief
            ? filterBackendSearchTerms({
                backendSearchTerms: aiResult.data.backendSearchTerms,
                keywordBrief: effectiveKeywordBrief,
                confirmedFacts: generationInput.productFacts.map((f) => ({
                  field: f.field,
                  value: f.value,
                  usageScopes: ["listing"],
                })),
              })
            : null;
          const safeBackendTerms = backendSafety?.terms ?? [];
          // AI 成功：映射到 draft + 服务器派生 keyword provenance + Claim Evidence + Quality
          const aiKeywords = [
            ...(plan.primaryKeyword ? [plan.primaryKeyword] : []),
            ...(effectiveKeywordBrief?.supportingKeywords ?? []),
            ...(effectiveKeywordBrief?.primaryKeyword ? [effectiveKeywordBrief.primaryKeyword] : []),
          ].filter(Boolean);
          const fallbackKeywords = filterKeywordsByClaimEvidence(aiKeywords, generationInput, autoTraceableTerms);
          const aiDraft = {
            ...safeDraft,
            titles: [aiResult.data.title],
            bullets: aiResult.data.bullets,
            description: aiResult.data.description,
            keywords: fallbackKeywords,
            backendSearchTerms: safeBackendTerms,
            model: "real-ai-provider",
            source: "real_ai_draft",
            riskNotes: effectiveKeywordBrief
              ? ["AI 优化草稿基于已确认事实生成；所有表述需人工复核。"]
              : ["AI 优化草稿基于已确认事实生成；未进行关键词优化，所有表述需人工复核。"],
            reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
            usedFactIds: aiResult.data.usedFactIds,
    usedFactTrace: buildUsedFactTrace(generationInput.productFacts, aiResult.data.usedFactIds),
            usedKeywordIds: deriveUsedKeywordIds({
              title: aiResult.data.title,
              bullets: aiResult.data.bullets,
              description: aiResult.data.description,
              backendSearchTerms: safeBackendTerms,
              keywordBrief: effectiveKeywordBrief,
            }),
            ...(backendSafety && backendSafety.warnings.length > 0
              ? { backendTermWarnings: backendSafety.warnings }
              : {}),
          };
          // 轮 16 末：服务端三级判定（verified/review/blocked）——blocked 从可复制内容移除，
          // review 保留并写入 humanReviewClaims（AI 起草、人工判断），verified 直接保留。
          // 轮 16 收口：锚点只认功能/属性/规格值（身份值如品牌/类目不作"已确认依据"）
          const IDENTITY_TIER_FIELDS = new Set(["brand", "product_type", "series_or_model"]);
          const tierInput = generationInput.productFacts
            .filter((f) => !IDENTITY_TIER_FIELDS.has(f.field))
            .map((f) => ({ field: f.field, label: f.label, value: f.value }));
          const aiAllText = [aiResult.data.title, ...aiResult.data.bullets, aiResult.data.description];
          const aiTiered = classifyClaimTier(aiAllText, tierInput.map((f) => f.value));
          const blockedTexts = aiTiered.filter((r) => r.tier === "blocked").map((r) => r.text);
          const reviewTexts = aiTiered.filter((r) => r.tier === "review").map((r) => r.text);
          const safeTitle = aiResult.data.title;
          const safeBullets = aiResult.data.bullets.filter((b: string) => !blockedTexts.some((x) => b.includes(x)));
          const safeDescription = aiResult.data.description && !blockedTexts.some((x) => String(aiResult.data.description).includes(x))
            ? aiResult.data.description
            : "";
          const safeAiDraft = {
            ...aiDraft,
            titles: [safeTitle],
            bullets: safeBullets,
            description: safeDescription,
            humanReviewClaims: reviewTexts,
          };
          const aiSchema = validateAiListingPackDraft(safeAiDraft);
          const aiFiltered = aiSchema.ok ? filterListingClaims(aiSchema.data, {
            prohibitedClaims: generationInput.prohibitedClaims,
            customClaimLabel: "Handoff prohibited claim",
          }) : null;
          const aiEvidence = aiFiltered
            ? verifyListingClaims(aiFiltered.cleaned, generationInput)
            : null;
          // 轮 16 末：服务端门禁 = Claim Evidence + 三级判定交集——
          // unsupported 中属于 blocked（无事实硬属性/承诺）才失败；review（依附已确认功能）降为人工确认。
          const unresolvedBlocked = aiEvidence
            ? aiEvidence.unsupportedClaims.filter((u) =>
                blockedTexts.some((b) => u.text.includes(b) || b.includes(u.text)),
              )
            : null;
          const claimsAcceptable = Boolean(aiSchema.ok && aiFiltered && aiEvidence && unresolvedBlocked !== null && unresolvedBlocked.length === 0);
          const aiRuntimeContract = aiFiltered
            ? validateRuntimeQualityContract({
                title: safeTitle,
                bullets: safeBullets,
                description: safeDescription,
                keywords: dedupeTerms(fallbackKeywords),
                facts: runtimeFacts,
                usedFactIds: aiResult.data.usedFactIds,
              })
            : null;
          const aiQuality = aiFiltered && claimsAcceptable && aiRuntimeContract?.ok ? { ok: true, blockingIssues: [], issues: [], advisories: [] } : { ok: false, blockingIssues: (aiRuntimeContract?.issues ?? []), issues: (aiRuntimeContract?.issues ?? []), advisories: [] };
          if (aiSchema.ok && aiFiltered && aiEvidence && unresolvedBlocked !== null && unresolvedBlocked.length === 0 && aiQuality?.ok && aiRuntimeContract?.ok) {
            // R1.6：filterListingClaims 重建对象不含后端元数据字段 → 显式补回
            draftKind = "ai_optimized_listing";
            finalDraft = {
              ...aiFiltered.cleaned,
              draftKind,
              usedFactIds: aiResult.data.usedFactIds,
    usedFactTrace: buildUsedFactTrace(generationInput.productFacts, aiResult.data.usedFactIds),
              usedKeywordIds: aiDraft.usedKeywordIds,
              humanReviewClaims: reviewTexts,
              ...(aiDraft.backendTermWarnings ? { backendTermWarnings: aiDraft.backendTermWarnings } : {}),
            };
            // 轮 16 收口：最终输出边界稳定去重（keywords/backendTerms，大小写不敏感）
            finalDraft.keywords = dedupeTerms((finalDraft.keywords as string[] | undefined) ?? []);
            finalDraft.backendSearchTerms = dedupeTerms((finalDraft.backendSearchTerms as string[] | undefined) ?? []);
            providerSucceeded = true;
          } else {
            // 轮 16 收口：claim 失败 = 有内容被三级判定拦截（无依据硬属性/无锚点话术被移除）。
            // 纯结构/质量不达标（无内容被拦）按结构/质量回退；两者兼具优先报 claim。
            const contractFailed = aiRuntimeContract !== null && !aiRuntimeContract.ok;
            const claimFailed = blockedTexts.length > 0;
            applyStructuredFallback(
              claimFailed
                ? "AI 文案包含未经确认的信息，已保留安全草稿。"
                : (contractFailed ? "AI 文案未通过运行时质量合同（8-30 词完整句/事实锚点/品牌去重）。" : "AI 文案未通过结构或质量校验，已保留安全草稿。"),
              claimFailed ? "listing_claims_unsupported" : "listing_output_invalid",
              claimFailed ? "AI 最终草稿未通过 Claim Evidence" : "AI 最终草稿未通过 Schema/Quality",
            );
            if (aiRuntimeContract && !aiRuntimeContract.ok) {
              const rejected = asRejected(aiRuntimeContract.issues, aiResult.data.bullets);
              if (rejected.length > 0) finalDraft.rejectedListingSentences = rejected.slice(0, 5);
            }
          }
        } else {
          // ai_schema_invalid = AI 输出不合规（含未知字段），不是 Provider 服务故障；
          // 保留 schema 拒绝的具体原因，避免把"输出不合规"误报为"服务不可用"。
          applyStructuredFallback(
            aiResult.error.code === "ai_schema_invalid"
              ? "AI 文案未通过结构校验，已保留安全草稿。"
              : "AI 服务暂时不可用，已保留安全草稿。",
            aiResult.error.code === "ai_schema_invalid" ? "listing_output_invalid" : "provider_failed",
            aiResult.error.message,
          );
        }
      } else {
        finalDraft = withoutKeywordOptimization({ ...safeDraft });
        qualityIssues = readiness.missingForQuality;
      }

      const keywordPlanSource: "manual" | "auto_suggested" | "none" = effectiveKeywordBrief
        ? (effectiveKeywordBrief.source === "auto_suggested" ? "auto_suggested" : "manual")
        : "none";
      const draftSnapshot = {
        ...finalDraft,
        draftKind,
        providerAttempted,
        providerSucceeded,
        fallbackApplied,
        fallbackReason,
        keywordPlanSource,
        usedKeywordTrace: deriveUsedKeywordTrace(finalDraft.usedKeywordIds as string[] | undefined, effectiveKeywordBrief),
        researchReferenceTrace: providerAttempted
          ? deriveResearchReferenceTrace(generationInput.creativeContext)
          : undefined,
        ...(fallbackReasonCode ? { fallbackReasonCode } : {}),
        qualityIssues: qualityIssues.slice(0, 10),
        savedAt: binding.generatedAt,
        savedBy: "owner" as const,
        snapshotType: "ai_listing_pack" as const,
      };

      return {
        result: {
          ...current,
          aiListingPackSnapshot: draftSnapshot as unknown as Record<string, unknown>,
          listingHandoffBinding: binding as unknown as Record<string, unknown>,
        },
        value: { listingStatus: status, idempotentReplay: false },
      };
    },
  });

  // result.resultJson 为已序列化字符串（mutateTaskResultJson 返回 string）
  const savedRaw = typeof result.resultJson === "string" ? JSON.parse(result.resultJson) : result.resultJson;
  const savedDraft = isRecord(savedRaw) ? draftSafeSummary(savedRaw.aiListingPackSnapshot) : null;
  return {
    listingStatus: result.value.listingStatus,
    currentHandoffRevision: handoffA.currentRevision,
    sourceHandoffRevision: binding.sourceHandoffRevision,
    staleReasonCode: result.value.staleReasonCode,
    idempotentReplay: result.value.idempotentReplay,
    listingSaved: !result.value.idempotentReplay,
    draft: savedDraft,
    safeFallbackApplied: savedDraft?.fallbackApplied === true,
    handoffState: { controlState: handoffA.controlState, stale: false },
  };
}
