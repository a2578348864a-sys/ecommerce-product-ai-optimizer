import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import {
  buildListingInputFromCreativeHandoff,
  computeListingGenerationFingerprint,
  type KeywordBriefSemantics,
  LISTING_COMPOSER_VERSION,
} from "@/lib/listingHandoff/listingGenerationInput";
import { withListingBrief, type ListingBrief } from "@/lib/listingHandoff/listingBrief";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingHandoffBinding, parseListingHandoffBinding, computeListingStatus, isHandoffListedDraftShape, type ListingHandoffBindingV1, type ListingStatus } from "@/lib/listingHandoff/listingBinding";
import type { MockListingProvider } from "@/lib/listingHandoff/mockListingProvider";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { classifyClaimTier } from "@/lib/listingHandoff/listingClaimTier";
import type { ClaimPolicyVerdict } from "@/lib/listingHandoff/listingClaimPolicy";
import { DEFAULT_CANNOT_SAY, buildListingPlanFromCapability, type ListingPlan } from "@/lib/listingHandoff/listingPlan";
import { evaluateListingCapabilityFromPolicy } from "@/lib/listingHandoff/listingCapabilityEvaluation";
import { validateCopyQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";
import { buildDeterministicListingPackDraft, composeControlledBullets, composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { RUNTIME_QUALITY_LIMITS, type RuntimeFact, validateRuntimeQualityContract, type RuntimeIssue } from "@/lib/listingHandoff/listingRuntimeSkill";
import { pickBestKeyword } from "@/lib/research/researchInputQuality";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { parseListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { extractKnownBrandsFromCompetitorTitles, extractBrandLikeTokensFromKeywords, filterKeywordsForListing, findCompetitorBrandMentions, type KeywordPolicyInput } from "@/lib/listingHandoff/listingKeywordPolicy";
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
  /** ListingPlan.v2：仅进入搜索词字段（keywords/backendSearchTerms）、未进入正文的关键词（有界；与 usedKeywordTrace 互斥） */
  searchOnlyKeywordTrace?: string[];
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
  factSafe?: boolean;
  copyQuality?: boolean;
  /** R6：被拒绝的具体句子 + 中文原因（有界 ≤5，无内部 id/hash/runId） */
  rejectedListingSentences?: Array<{ text: string; reason: string }>;
  /** ListingPlan.v2：卖点策略（安全摘要，公开 DTO；无计划的历史草稿为 undefined） */
  sellingPointPlan?: Array<{
    role: string;
    shopperNeed: string;
    shopperAngle: string;
    factLabels: string[];
    keywordIds: string[];
    claimMode: string;
    cannotSay: string[];
  }>;
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

/** LISTING_FINAL_CLOSURE：竞品品牌/风险词在证据校验之前先被唯一策略出口过滤（人工 Brief 也不能绕过） */
function typeLabelOfListingInput(input: ListingGenerationInput): string {
  return String(input.productFacts.find((f) => f.field === "product_type")?.value ?? "").trim();
}

function keywordPolicyInputOf(generationInput: ListingGenerationInput): KeywordPolicyInput {
  const ownBrand = generationInput.productFacts.find((f) => f.field === "brand")?.value ?? "";
  const titles = (generationInput.creativeContext?.competitiveContext ?? []).map((entry) =>
    typeof entry === "string" ? entry : String((entry as { note?: string }).note ?? ""),
  );
  return {
    ownBrand,
    knownBrands: dedupeTerms([
      ...extractKnownBrandsFromCompetitorTitles(titles, { ownBrand }),
      ...extractBrandLikeTokensFromKeywords(
        (generationInput.creativeContext?.keywordCandidates ?? []).map((k) => typeof k === "string" ? k : String((k as { keyword?: string })?.keyword ?? "")),
        { ownBrand },
      ),
    ]),
  };
}

function policyFilterForListing(keywords: string[], generationInput: ListingGenerationInput): string[] {
  return filterKeywordsForListing(keywords, keywordPolicyInputOf(generationInput)).accepted;
}

/** 读取边界也执行关键词策略：手工保存的 Brief 不能凭持久化路径绕过竞品/风险词过滤。 */
function policyFilteredKeywordBrief<T extends { primaryKeyword: string; supportingKeywords: string[]; backendSearchTerms: string[] }>(
  brief: T | null,
  generationInput: ListingGenerationInput,
): T | null {
  if (!brief) return null;
  const acceptedMain = policyFilterForListing([brief.primaryKeyword, ...brief.supportingKeywords], generationInput);
  if (acceptedMain.length === 0) return null;
  const acceptedBackend = policyFilterForListing(brief.backendSearchTerms, generationInput);
  const [primaryKeyword, ...supportingKeywords] = acceptedMain;
  return { ...brief, primaryKeyword, supportingKeywords, backendSearchTerms: acceptedBackend };
}

/**
 * 第八轮根因修复：有效 Keyword Brief 的"生成语义"规范化（唯一函数，锁外与锁内共用）。
 * 链路与锁内生成链完全一致：parse → 主词相关度确认（不足 → 语义为空）→ 唯一政策出口过滤（清空 → 语义为空）。
 * capturedAt/报告元数据等非生成语义在此剔除（同语义不同元数据 → 同指纹，仍幂等）。
 * 返回 null 等价于"无有效 Brief"（指纹与旧版本字节兼容）。
 */
export function effectiveKeywordBriefSemanticsOf(
  briefRaw: unknown,
  generationInput: ListingGenerationInput,
): KeywordBriefSemantics | null {
  const keywordBrief = parseListingKeywordBrief(briefRaw);
  if (!keywordBrief) return null;
  const productNameForRelevance = [
    generationInput.productFacts.find((f) => f.field === "brand")?.value ?? "",
    generationInput.productFacts.find((f) => f.field === "series_or_model")?.value ?? "",
    generationInput.productFacts.find((f) => f.field === "product_type")?.value ?? "",
  ].filter(Boolean).join(" ");
  if (productNameForRelevance.trim()) {
    const best = pickBestKeyword([{ keyword: keywordBrief.primaryKeyword }], productNameForRelevance);
    if (!best) return null;
  }
  const effective = policyFilteredKeywordBrief(keywordBrief, generationInput);
  if (!effective) return null;
  return {
    primaryKeyword: effective.primaryKeyword,
    supportingKeywords: [...effective.supportingKeywords],
    backendSearchTerms: [...effective.backendSearchTerms],
    ...(effective.source === "auto_suggested" ? { source: "auto_suggested" as const } : {}),
  };
}

/** Keyword Brief 是 SEO 输入，不是事实来源；最终草稿中的每个 keyword 仍须能通过正式 Claim Evidence。 */
function filterKeywordsByClaimEvidence(keywords: string[], generationInput: ListingGenerationInput, traceableTerms: string[] = []): string[] {
  // 轮 16：来自已保存 SellerSprite keywordEvidence 的 auto_suggested 词是可追溯 SEO 资料
  // （非 AI 自造、非商品事实声明），与"无证据的 brief 词不得进入草稿"不冲突。
  const traceable = new Set(traceableTerms.map((k) => k.trim().toLowerCase()));
  // LISTING_FINAL_CLOSURE：唯一策略出口先行（竞品品牌/风险词直接拒绝；own_brand 不重复塞后台）
  const policyAccepted = new Set(policyFilterForListing(keywords, generationInput).map((k) => k.trim().toLowerCase()));
  return keywords.filter((keyword) => {
    if (!policyAccepted.has(keyword.trim().toLowerCase())) return false;
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
    if (wc < RUNTIME_QUALITY_LIMITS.bulletWordsMin) {
      rejected.push({ text: b.slice(0, 140), reason: "该条不足 " + RUNTIME_QUALITY_LIMITS.bulletWordsMin + " 个英文词（属性碎片/过短），不是合格句。" });
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

/**
 * LISTING_HISTORICAL_DRAFT_READ_GUARD：历史快照读取边界重校验（只读，不写库）。
 * 旧快照即使保存 listingUnqualified=false 或缺失 factSafe/copyQuality，也必须按当前
 * Fact Safety 语义 + Copy Quality 合同重新判定：不合格不得作为正式 Listing 暴露。
 * 纯函数：不修改传入 value；不读库；同输入同输出。
 */
export type HistoricalDraftReadVerdict = {
  factSafe: boolean;
  copyQuality: boolean;
  listingUnqualified: boolean;
  reason: string;
  rejected: Array<{ text: string; reason: string }>;
};

export function revalidateHistoricalDraftRead(value: Record<string, unknown>): HistoricalDraftReadVerdict {
  // 1) 安全解析正式字段（有界）
  const titles = safeStringArray(value.titles).slice(0, 3);
  const bullets = safeStringArray(value.bullets).slice(0, 5);
  const description = safeString(value.description) ?? "";
  // 2) cannotSay 从快照 sellingPointPlan 聚合（有界），无则用缺省保守集
  const cannotSay = new Set<string>(DEFAULT_CANNOT_SAY);
  if (Array.isArray(value.sellingPointPlan)) {
    for (const bp of value.sellingPointPlan) {
      if (isRecord(bp) && Array.isArray(bp.cannotSay)) {
        for (const c of bp.cannotSay) if (typeof c === "string" && c.trim()) cannotSay.add(c.trim().slice(0, 80));
      }
    }
  }
  // 3) 当前 Copy Quality 重校验（正文词面检测；不依赖 facts/typeLabel 上下文）
  const copy = validateCopyQualityContract({
    title: titles[0] ?? "",
    bullets,
    description,
    cannotSay: [...cannotSay],
  });
  // 4) factSafe：仅当持久化明确 true 且正文无禁止词面（读取侧矛盾）才 true；缺失→false
  const bodyText = [titles[0] ?? "", ...bullets, description].join(" ").toLowerCase();
  const persistedFactSafe = value.factSafe === true;
  const readSideConflics = [...cannotSay].some((c) => {
    const term = c.toLowerCase().replace(/[-_\s]+/g, "");
    return term && bodyText.replace(/[-_\s]+/g, "").includes(term);
  });
  const factSafe = persistedFactSafe && !readSideConflics;
  // 5) copyQuality = 当前重校验结果（绝不信任持久化）
  const copyQuality = copy.ok;
  // 6) listingUnqualified：任一不满足即不合格
  const stats = computeUnqualifiedFields({ bullets });
  const listingUnqualified = !factSafe || !copyQuality || stats.listingUnqualified;
  const reason = !factSafe
    ? "历史快照缺少可靠的事实安全证明或正文命中禁止声明，读取时未能通过当前 Fact Safety 判定。"
    : !copyQuality
      ? "历史快照正文未通过当前 Copy Quality 重校验（模板化/禁止词/自指等）。"
      : stats.listingUnqualified
        ? "历史快照正式结构化检查不合格（数量/词数/句法）。"
        : "";
  // rejected：合格句被拒的有界诊断（原坏句文本 + 中文原因）
  const rejected: Array<{ text: string; reason: string }> = copy.issues.slice(0, 5).map((issue) => {
    const text = issue.target === "bullets"
      ? (bullets[Number(String(issue.message.match(/Bullet (\d+)/)?.[1] ?? "0")) - 1] ?? "")
      : (titles[0] ?? "");
    return { text: String(text).slice(0, 140), reason: issue.message.slice(0, 80) };
  });
  return { factSafe, copyQuality, listingUnqualified, reason, rejected };
}

export function draftSafeSummary(value: unknown): ListingDraftSafeSummary | null {
  if (!isRecord(value) || !isHandoffListedDraftShape(value)) return null;
  const readGuard = revalidateHistoricalDraftRead(value);
  const BLOCKED_EMPTY = readGuard.listingUnqualified;
  const titlesOut = BLOCKED_EMPTY ? [] : safeStringArray(value.titles).slice(0, 3);
  const bulletsOut = BLOCKED_EMPTY ? [] : safeStringArray(value.bullets).slice(0, 5);
  const descriptionOut = BLOCKED_EMPTY ? "" : safeString(value.description);
  const keywordsOut = BLOCKED_EMPTY ? [] : safeStringArray(value.keywords).slice(0, 12);
  const backendOut = BLOCKED_EMPTY ? [] : (Array.isArray(value.backendSearchTerms) ? value.backendSearchTerms.filter((item): item is string => typeof item === "string").slice(0, 50) : undefined);
  const sellingPointsOut = BLOCKED_EMPTY ? [] : safeStringArray(value.sellingPoints).slice(0, 6);
  return {
    generatedAt: safeString(value.generatedAt),
    source: safeString(value.source),
    version: safeInt(value.version),
    composerVersion: safeString(value.composerVersion),
    generationPolicyVersion: safeString(value.generationPolicyVersion),
    polishApplied: value.polishApplied === true,
    polishModel: safeString(value.polishModel),
    titles: titlesOut,
    bullets: bulletsOut,
    description: descriptionOut,
    keywords: keywordsOut,
    backendSearchTerms: backendOut,
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
    searchOnlyKeywordTrace: Array.isArray(value.searchOnlyKeywordTrace)
      ? value.searchOnlyKeywordTrace.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
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
    factSafe: readGuard.factSafe,
    copyQuality: readGuard.copyQuality,
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
    listingUnqualified: readGuard.listingUnqualified,
    // 已有明确拒绝原因时保留执行期结果（fallback 写入的 rejectedListingSentences 优先于纯粹的碎片推导）
    rejectedListingSentences: readGuard.listingUnqualified && readGuard.rejected.length > 0
      ? readGuard.rejected
      : (Array.isArray(value.rejectedListingSentences) && value.rejectedListingSentences.length > 0 ? value.rejectedListingSentences.slice(0, 5) : computeUnqualifiedFields({ bullets: bulletsOut }).rejectedListingSentences),
    riskNotes: safeStringArray(value.riskNotes),
    reviewChecklist: safeStringArray(value.reviewChecklist),
    blockedClaims: safeStringArray(value.blockedClaims),
    complianceWarnings: safeStringArray(value.complianceWarnings),
    sellingPoints: sellingPointsOut,
    sellingPointPlan: Array.isArray(value.sellingPointPlan)
      ? value.sellingPointPlan
          .filter((item): item is { role: string; shopperNeed: string; shopperAngle: string; factLabels: string[]; keywordIds: string[]; claimMode: string; cannotSay: string[] } =>
            isRecord(item) && typeof item.role === "string" && typeof item.shopperNeed === "string" && typeof item.shopperAngle === "string" && typeof item.claimMode === "string" && Array.isArray(item.factLabels) && Array.isArray(item.keywordIds) && Array.isArray(item.cannotSay))
          .map((item) => ({
            role: String(item.role).slice(0, 40),
            shopperNeed: String(item.shopperNeed).slice(0, 160),
            shopperAngle: String(item.shopperAngle).slice(0, 160),
            factLabels: item.factLabels.filter((x): x is string => typeof x === "string").slice(0, 5),
            keywordIds: item.keywordIds.filter((x): x is string => typeof x === "string").slice(0, 3),
            claimMode: String(item.claimMode).slice(0, 20),
            cannotSay: item.cannotSay.filter((x): x is string => typeof x === "string").slice(0, 5),
          }))
          .slice(0, 5)
      : undefined,
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
/** ListingPlan.v2：AI 输出与计划绑定校验（唯一入口；复用现有 Runtime 合同，不复制阈值）
 * LISTING_FINAL_CLOSURE 加强：
 * - 每条命中自己的 planned fact（索引绑定不变）；
 * - role 不重复（每条五点承担不同购买理由）；
 * - 除品牌/商品类型等身份事实外，同一硬事实值不得成为两条五点的核心表达；
 * - 仍接受 3–5 条（范围由 plan.bulletPlans 数量与 Runtime 阈值双重保证），不强凑数量。
 */
const IDENTITY_BIND_FIELDS = new Set(["brand", "product_type", "series_or_model"]);
/** 导出仅供合同测试直测状态门禁语义（防御性状态 needs_facts/needs_review 的可达报警面）；行为与主链完全一致 */
export function aiBulletsBindToPlan(
  plan: ListingPlan,
  bullets: string[],
  facts: Array<{ field: string; label: string; value: string }>,
): { ok: boolean; issues: string[] } {
  // ListingPlan.v2.3：needs_keywords 表示“不能做关键词优化”，不再拒绝采用合格 AI 文案；needs_facts/needs_review 仍阻断。
  if (plan.status === "needs_facts" || plan.status === "needs_review") {
    return { ok: false, issues: ["plan.status " + plan.status + " 不可采用文案"] };
  }
  const used = plan.bulletPlans.length;
  if ((bullets ?? []).length !== used) return { ok: false, issues: ["bullets 数量与 bulletPlans 不一致：" + bullets.length + " vs " + used] };
  if (bullets.length < 3 || bullets.length > 5) return { ok: false, issues: ["bullets 数量超出 3-5 条：" + bullets.length] };
  const issues: string[] = [];
  const usedRoles = new Set<string>();
  const factToBullets = new Map<string, number[]>();
  bullets.forEach((b, idx) => {
    const bp = plan.bulletPlans[idx];
    if (!bp) return;
    const lower = b.toLowerCase();
    const role = bp.role ?? "core_outcome";
    if (plan.schema === "listing-plan.v2" && usedRoles.has(role)) {
      issues.push("bullet " + (idx + 1) + " 角色重复：" + role);
    }
    usedRoles.add(role);
    const factHit = bp.featureFactIds.some((fid) => {
      const f = facts.find((x) => x.field === fid);
      return f && f.value.trim() && lower.includes(f.value.trim().toLowerCase());
    });
    if (!factHit) issues.push("bullet " + (idx + 1) + " 未命中其计划事实");
    // 非身份硬事实只要真实出现在正文就计入，不能在另一条五点借用后再次成为核心表达。
    for (const f of facts) {
      if (IDENTITY_BIND_FIELDS.has(f.field)) continue;
      const value = String(f.value ?? "").trim();
      if (!value || !lower.includes(value.toLowerCase())) continue;
      const key = value.toLowerCase();
      const occurrences = factToBullets.get(key) ?? [];
      occurrences.push(idx + 1);
      factToBullets.set(key, occurrences);
    }
    for (const bad of bp.cannotSay ?? []) {
      if (bad && lower.includes(bad.toLowerCase())) issues.push("bullet " + (idx + 1) + " 含 cannotSay: " + bad);
    }
  });
  for (const [value, bulletIndexes] of factToBullets) {
    if (bulletIndexes.length > 1) {
      issues.push("核心事实重复：" + value + " 出现在第 " + bulletIndexes.join("、") + " 条五点");
    }
  }
  return { ok: issues.length === 0, issues };
}

/** ListingPlan.v2：有效方案关键词集合（主词 → 辅助词 → 后台搜索词；大小写不敏感去重、保序） */
function schemeKeywordList(plan: ListingPlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (kw: string | null | undefined) => {
    const k = (kw ?? "").trim();
    if (!k) return;
    const key = k.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(k);
  };
  push(plan.primaryKeyword);
  for (const s of plan.supportingKeywords ?? []) push(s);
  for (const b of plan.backendSearchTerms ?? []) push(b);
  return out;
}

/** ListingPlan.v2：关键词采用三态（与“计划关键词”分离，公开 DTO）——
 * usedKeywordTrace：仅统计最终 title/bullets/description 中真实出现的有效方案关键词（不扫描 keywords/搜索词字段）；
 * searchOnlyKeywordTrace：仅统计进入最终 keywords/backendSearchTerms 字段、但在 title/bullets/description 未出现的关键词；
 * 两者大小写不敏感、保序去重、有界(20)、互斥；无有效方案（无 primaryKeyword）→ 均空。
 */
export function deriveKeywordAdoptionTrace(
  plan: ListingPlan | null,
  bodyTexts: string[],
  searchFieldTexts: string[],
): { usedKeywordTrace: string[]; searchOnlyKeywordTrace: string[] } {
  if (!plan || !plan.primaryKeyword) return { usedKeywordTrace: [], searchOnlyKeywordTrace: [] };
  const scheme = schemeKeywordList(plan);
  const body = bodyTexts.join(" ").toLowerCase();
  const searchSet = new Set(searchFieldTexts.map((s) => s.trim().toLowerCase()).filter(Boolean));
  const usedKeywordTrace: string[] = [];
  const searchOnlyKeywordTrace: string[] = [];
  for (const kw of scheme) {
    const key = kw.toLowerCase();
    if (body.includes(key)) usedKeywordTrace.push(kw);
    else if (searchSet.has(key)) searchOnlyKeywordTrace.push(kw);
  }
  return { usedKeywordTrace: usedKeywordTrace.slice(0, 20), searchOnlyKeywordTrace: searchOnlyKeywordTrace.slice(0, 20) };
}

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

  // 事实安全裁决必须先于英文化和 Composition：review / prohibited 既不能进入正式字段，
  // 也不应消耗翻译 Provider。阶段 C 仍会在锁内按当前快照重新裁决，保留并发安全。
  const confirmedFactsA = handoffA.versions[handoffA.versions.length - 1]?.confirmedFacts ?? [];
  const capabilityEvalA = evaluateListingCapabilityFromPolicy({
    input: generationInputBase,
    confirmedFacts: confirmedFactsA.map((f) => ({
      field: String(f.field ?? ""),
      value: String(f.value ?? ""),
      evidenceTier: String(f.evidenceTier ?? ""),
      sourceRef: f.sourceRef as { sourceKind?: string } | undefined,
    })),
    extraProhibitedTerms: DEFAULT_CANNOT_SAY,
    hasBlockingIssue: false,
  });
  const verifiedFactKeysA = new Set(capabilityEvalA.verifiedFacts.map((f) => `${f.field}\u0000${f.value}`));
  const policySafeInputBase: ListingGenerationInput = {
    ...generationInputBase,
    productFacts: generationInputBase.productFacts.filter((f) => verifiedFactKeysA.has(`${f.field}\u0000${f.value}`)),
  };

  // R3.2 English rendering：中文 confirmed facts 转英文（factRef 溯源），不跳过、不丢事实。
  // 逐事实 fail-closed（渲染器文档：无法安全英文化的事实不进入最终 Listing）。
  const { buildEnglishRenderingPack, ENGLISH_RENDERING_VERSION } = await import("@/lib/listingHandoff/listingEnglishRendering");
  const renderingResult = await buildEnglishRenderingPack({
    facts: policySafeInputBase.productFacts.map((f) => ({
      factId: f.field,
      field: f.field,
      sourceValue: f.value,
    })),
  });
  let generationInput: ListingGenerationInput;
  if (renderingResult.ok) {
    generationInput = { ...policySafeInputBase, englishRenderings: renderingResult.pack };
  } else if (renderingResult.code === "integrity_failed" && renderingResult.message.includes("cannot render to English")) {
    // Provider 关闭 / AI 翻译不可用时的确定性降级（与渲染器“该 fact 不进入最终 Listing”的
    // 逐事实 fail-closed 契约一致）：无法英文化且仍含 CJK 的事实必须真正从生成输入移除；
    // 其余 already-English 事实保持原样，Claim Evidence / Runtime 门禁零放宽。
    generationInput = {
      ...policySafeInputBase,
      productFacts: policySafeInputBase.productFacts.filter((f) => !/[一-鿿㐀-䶿]/.test(String(f.value ?? ""))),
      englishRenderings: { schema: ENGLISH_RENDERING_VERSION, renderings: [], generatedAt: null, source: "literal" },
    };
  } else {
    throw new ListingHandoffError("listing_english_rendering_failed", 422, `事实英文化失败：${renderingResult.message}`);
  }
  // 第八轮根因修复：确认 Keyword Brief 会改变生成语义（keywords/keywordReady/计划关键词），
  // 必须纳入幂等指纹；锁内生成链使用同一规范化函数，两阶段语义不一致 → 语义冲突 409。
  const keywordBriefSemantics = effectiveKeywordBriefSemanticsOf(gateA.keywordBriefRaw, generationInput);
  const generationInputFingerprint = computeListingGenerationFingerprint(generationInput, undefined, keywordBriefSemantics);

  // ── 阶段B：Composition first（锁外，不持锁，不调用 Provider）──
  const generatedAt = new Date().toISOString();

  const deterministicDraft = buildDeterministicListingPackDraft(generationInput, generatedAt);
  const deterministicSchema = validateAiListingPackDraft(deterministicDraft);
  const deterministicFiltered = deterministicSchema.ok
    ? filterListingClaims(deterministicSchema.data, {
        prohibitedClaims: generationInput.prohibitedClaims,
        customClaimLabel: "Handoff prohibited claim",
      })
    : null;
  const deterministicEvidence = deterministicFiltered
    ? verifyListingClaims(deterministicFiltered.cleaned, generationInput)
    : null;
  // 旧组合器只提供一个候选种子，不能成为 Listing V2 的前置硬门禁。
  // 它若结构/事实校验失败，丢弃其用户可见字段，继续让 Provider/optimized 回退链
  // 按同一套 Claim Evidence + Copy Quality 合同生成；这样旧模板不会把新链路提前截断。
  const deterministicSeed = deterministicFiltered && deterministicEvidence && listingClaimsHaveEvidence(deterministicEvidence)
    ? deterministicFiltered.cleaned
    : {
        ...(deterministicFiltered?.cleaned ?? deterministicDraft),
        titles: ["Listing draft pending review"],
        bullets: ["Listing draft pending review"],
        description: "Human review required.",
        keywords: [],
        sellingPoints: ["Listing draft pending review"],
        riskNotes: ["商品信息来自已人工确认的事实，所有表述仍需人工复核。"],
        complianceWarnings: [],
        blockedClaims: [],
        reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
      };
  const safeDraft = deterministicSeed as unknown as Record<string, unknown>;

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

      // ── Keyword Brief 语义重验证（第八轮）：锁内实际语义必须与锁外指纹语义一致 ──
      // 不一致说明 Brief 在两阶段之间变化：按语义冲突 409（客户端刷新后自动重试），
      // 禁止静默用旧指纹命中旧草稿重放或保存语义不符的 binding。
      const lockKeywordBriefSemantics = effectiveKeywordBriefSemanticsOf(current.listingKeywordBrief, generationInput);
      if (JSON.stringify(lockKeywordBriefSemantics) !== JSON.stringify(keywordBriefSemantics)) {
        throw new TaskResultJsonMutationError("task_result_conflict", 409, "关键词方案刚发生更新，请刷新后重试。");
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
      // 无人工 Brief 时不把研究候选词提升为正式 SEO；自动建议只保留在研究资料层。
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
      const candidateKeywordBrief = keywordBrief && !keywordBriefNeedsConfirm ? keywordBrief : null;
      // 已保存的手工 Brief 也必须在读取边界经过同一策略，避免持久化路径绕过品牌/风险词门禁。
      const effectiveKeywordBrief = policyFilteredKeywordBrief(candidateKeywordBrief, generationInput);
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
      /**
       * LISTING_COPY_QUALITY：读取边界 fail-closed（单一 Claim Policy 出口）。
       * 新版逐项确认元数据 = confirmedFacts 中 evidenceTier="human_confirmed" 且
       * sourceRef.sourceKind="user_confirmation"（人工逐项确认）。历史快照无此字段 → 高风险字段默认 review。
       * V2：统一走共享 Policy 适配器（evaluateListingCapabilityFromPolicy），
       * 消除下方重复的高风险/tier 计算；无证据自动建议/竞品五点/VOC/关键词/供应商参考不参与事实。
       */
      const confirmedFactsCurrent = handoffC.versions[handoffC.versions.length - 1]?.confirmedFacts ?? [];
      const capabilityEval = evaluateListingCapabilityFromPolicy({
        input: generationInput,
        confirmedFacts: confirmedFactsCurrent.map((f) => ({
          field: String(f.field ?? ""),
          value: String(f.value ?? ""),
          evidenceTier: String(f.evidenceTier ?? ""),
          sourceRef: f.sourceRef as { sourceKind?: string } | undefined,
        })),
        extraProhibitedTerms: DEFAULT_CANNOT_SAY,
        hasBlockingIssue: false,
      });
      /** 事实安全基线：仅 verified 事实可进正式字段 */
      const verifiedFactKeys = new Set(capabilityEval.verifiedFacts.map((f) => `${f.field}\u0000${f.value}`));
      const claimSafeFacts = generationInput.productFacts.filter((gf) =>
        verifiedFactKeys.has(`${gf.field}\u0000${gf.value}`),
      );
      /** 生成链输入使用事实安全基线（plan/验证/锚点只认 verified） */
      generationInput = { ...generationInput, productFacts: claimSafeFacts };
      // English-safe 过滤可能移除无法渲染的事实；能力必须基于最终生成输入重算，
      // 否则 Plan 会按中文/不可渲染事实分配更多条，结构化回退随后被绑定门禁清空。
      const renderableCapabilityEval = evaluateListingCapabilityFromPolicy({
        input: generationInput,
        confirmedFacts: confirmedFactsCurrent.map((f) => ({
          field: String(f.field ?? ""),
          value: String(f.value ?? ""),
          evidenceTier: String(f.evidenceTier ?? ""),
          sourceRef: f.sourceRef as { sourceKind?: string } | undefined,
        })),
        extraProhibitedTerms: DEFAULT_CANNOT_SAY,
        hasBlockingIssue: false,
      });
      const capability = renderableCapabilityEval.capability;
      // V2：Capability 驱动的 Plan（计划条数与事实能力精确一致；target=2 时 needs_facts）
      const plan = buildListingPlanFromCapability(generationInput, effectiveKeywordBrief, capability);
      // V2：copyReady 只认 capability.canCallProvider（>=3 组 + 身份 + 无阻断）+ 精确条数
      const copyReady = capability.canCallProvider && plan.bulletPlans.length === capability.targetBulletCount;
      const keywordReady = readiness.keywordReady;
      let finalDraft: Record<string, unknown> = safeDraft;
      let draftKind: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft" = "safe_fact_draft";
      let qualityIssues: string[] = [];
      let providerAttempted = false;
      let providerSucceeded = false;
      let fallbackApplied = false;
      let fallbackReason: string | null = null;
      let fallbackReasonCode: "listing_claims_unsupported" | "provider_failed" | "listing_output_invalid" | null = null;


  /** 运行时 Skill 合同所需事实（已确认事实；id = field；值优先英文渲染——与正式 bullets 一致，锚定才能命中） */
  const runtimeFacts = generationInput.productFacts.map((f): RuntimeFact => {
    const rendered = generationInput.englishRenderings?.renderings.find((r) => r.field === f.field)?.english;
    const value = (rendered && rendered.trim() && !/[一-鿿㐀-䶿]/.test(rendered) ? rendered : String(f.value ?? "")).trim();
    return { factId: f.field, field: f.field, label: f.label, value };
  });
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
            || (effectiveKeywordBrief?.source !== "auto_suggested"
              && filterKeywordsByClaimEvidence([primaryKeyword], generationInput, autoTraceableTerms).length === 1);
          const optimizedTitles = primaryHasEvidence
            ? optimized.titles
            // 自动建议词若没有逐字事实证据，不得继续从同一 Brief 注入标题；
            // 仅重组已确认事实，避免“标题有自动词 → Claim Evidence 失败 → 整个安全回退被清空”。
            : composeOptimizedListingDraft(generationInput, plan, null).titles;
          const optimizedDraft = {
            ...safeDraft,
            titles: optimizedTitles,
            bullets: optimized.bullets,
            description: optimized.description,
            // LISTING_FINAL_CLOSURE：结构化回退同样经唯一关键词策略出口（竞品/未知品牌/风险词一律拒绝）
            keywords: dedupeTerms(policyFilterForListing(optimizedKeywords, generationInput)),
            backendSearchTerms: dedupeTerms(policyFilterForListing(optimized.backendSearchTerms, generationInput)),
            riskNotes: effectiveKeywordBrief
              ? ["结构化草稿基于已确认事实生成；所有表述仍需人工复核。"]
              : ["结构化草稿基于已确认事实生成；未进行关键词优化，所有表述仍需人工复核。"],
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
          /** LISTING_COPY_QUALITY：structured 回退稿同样必须通过 Copy Quality（事实安全 ≠ 文案质量） */
          const optimizedCopyQuality = validateCopyQualityContract({
            title: String((optimizedFiltered?.cleaned as { titles?: string[] } | null)?.titles?.[0] ?? (optimizedDraft.titles as string[] | undefined)?.[0] ?? ""),
            bullets: (optimizedFiltered?.cleaned?.bullets ?? optimizedDraft.bullets) ?? [],
            description: String(optimizedFiltered ? optimizedFiltered.cleaned.description : optimizedDraft.description ?? ""),
            cannotSay: [...DEFAULT_CANNOT_SAY, ...(generationInput.prohibitedClaims ?? [])],
            facts: runtimeFacts,
            bulletPlans: plan.bulletPlans,
            typeLabel: typeLabelOfListingInput(generationInput),
          });

          fallbackApplied = true;
          fallbackReason = publicReason;
          fallbackReasonCode = reasonCode;
          if (optimizedSchema.ok && optimizedFiltered && optimizedEvidence && listingClaimsHaveEvidence(optimizedEvidence) && optimizedQuality?.ok && optimizedContract.ok && optimizedCopyQuality.ok) {
            draftKind = "structured_listing_draft";
            finalDraft = withoutKeywordOptimization({ ...optimizedFiltered.cleaned });
            finalDraft.listingUnqualified = false;
            finalDraft.factSafe = true;
            finalDraft.copyQuality = true;
            qualityIssues = [issue];
            return;
          }

          // R6：碎片兜底已删除——safe_fact_draft 只允许安全模板完整句；质量不达标 → 无合格草稿
          // 安全回退仍需使用受控的身份/描述句；不能拿“待人工确认”占位种子去做
          // 事实锚点与句数门禁，否则即使安全五点合格也会被占位字段误判为空稿。
          const safeContent = composeOptimizedListingDraft(generationInput, plan, null);
          const safeTitle = safeContent.titles[0] ?? "";
          const safeDescription = safeContent.description;
          const safeBullets = composeControlledBullets(generationInput, plan).bullets;
          const removedFragments: Array<{ text: string; reason: string }> = optimizedContract.ok || !optimizedFiltered
            ? []
            : asRejected(optimizedContract.issues, optimizedFiltered.cleaned.bullets);
          const safeContract = validateRuntimeQualityContract({
            title: safeTitle,
            bullets: safeBullets,
            description: safeDescription,
            keywords: dedupeTerms((safeDraft.keywords ?? []) as string[]),
            facts: runtimeFacts,
            usedFactIds: runtimeUsedIds,
          });
          /** LISTING_COPY_QUALITY：safe 事实提纲同样必须通过 Copy Quality（自然、非模板腔） */
          const safeCopyQuality = validateCopyQualityContract({
            title: safeTitle,
            bullets: safeBullets,
            description: safeDescription,
            cannotSay: [...DEFAULT_CANNOT_SAY, ...(generationInput.prohibitedClaims ?? [])],
            facts: runtimeFacts,
            bulletPlans: plan.bulletPlans,
            typeLabel: typeLabelOfListingInput(generationInput),
          });
          const safeQualified = safeBullets.length >= 3 && safeContract.ok && safeCopyQuality.ok;
          draftKind = "safe_fact_draft";
          finalDraft = withoutKeywordOptimization({
            ...safeDraft,
            titles: [safeTitle],
            bullets: safeQualified ? safeBullets.slice(0, 5) : [],
            description: safeDescription,
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
          finalDraft.factSafe = true;
          finalDraft.copyQuality = safeCopyQuality.ok;
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
          // 后台搜索词同样受唯一策略出口约束（竞品品牌、未知品牌和风险词不进搜索词）。
          const safeBackendTerms = policyFilterForListing(backendSafety?.terms ?? [], generationInput);
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
          // LISTING_FINAL_CLOSURE：blocked 与 review 同待遇——任一条命中即从正式字段移除；
          // review 句只保留在 humanReviewClaims（待人工确认），不得停留在 title/bullets/description。
              const removedTierTexts = [...blockedTexts, ...reviewTexts];
          const safeTitle = !removedTierTexts.some((x) => String(aiResult.data.title ?? "").includes(x)) ? aiResult.data.title : "";
          const safeBullets = aiResult.data.bullets.filter((b: string) => !removedTierTexts.some((x) => b.includes(x)));
          const safeDescription = aiResult.data.description && !removedTierTexts.some((x) => String(aiResult.data.description).includes(x))
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
          // ListingPlan.v2：Claim Evidence 校验正文（keywords 属 SEO 引用；已由 filterKeywordsByClaimEvidence 过滤，
          // 未通过者只进入搜索词字段，不作为正文声明，不因 SEO 词拒绝整稿）
          const aiEvidence = aiFiltered
            ? verifyListingClaims({ ...aiFiltered.cleaned, keywords: [] }, generationInput)
            : null;
          // 轮 16 末：服务端门禁 = Claim Evidence + 三级判定交集——
          // unsupported 中属于 blocked（无事实硬属性/承诺）才失败；review（依附已确认功能）降为人工确认。
          const unresolvedBlocked = aiEvidence
            ? aiEvidence.unsupportedClaims.filter((u) =>
                blockedTexts.some((b) => u.text.includes(b) || b.includes(u.text)),
              )
            : null;
          const claimsAcceptable = Boolean(aiSchema.ok && aiFiltered && aiEvidence && unresolvedBlocked !== null && unresolvedBlocked.length === 0);
          // ListingPlan.v2：关键词不得绕过 Claim Evidence；unsupported 中属于 keyword 段的词只保留在搜索词字段（backendSearchTerms）
          const keywordUnsupported = new Set((aiEvidence?.unsupportedClaims ?? []).filter((u) => u.text.split(" ").length > 1).map((u) => u.text.toLowerCase()));
          const claimPassingKeywords = (fallbackKeywords ?? []).filter((k: string) => !keywordUnsupported.has(String(k).toLowerCase()));
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
          const planBind = aiBulletsBindToPlan(plan, safeBullets, generationInput.productFacts);
          const planBindAcceptable = planBind.ok;
          const competitorBrandMentions = findCompetitorBrandMentions(
            [safeTitle, ...safeBullets, safeDescription],
            keywordPolicyInputOf(generationInput),
          );
          const brandPolicyAcceptable = competitorBrandMentions.length === 0;
          /** LISTING_COPY_QUALITY：AI 稿同样必须通过 Copy Quality（事实安全 ≠ 文案质量） */
          const aiCopyQuality = validateCopyQualityContract({
            title: safeTitle,
            bullets: safeBullets,
            description: safeDescription,
            cannotSay: [...DEFAULT_CANNOT_SAY, ...(generationInput.prohibitedClaims ?? [])],
            facts: runtimeFacts,
            bulletPlans: plan.bulletPlans,
            typeLabel: typeLabelOfListingInput(generationInput),
          });
          if (aiSchema.ok && aiFiltered && aiEvidence && unresolvedBlocked !== null && unresolvedBlocked.length === 0 && aiQuality?.ok && aiRuntimeContract?.ok && planBindAcceptable && brandPolicyAcceptable && aiCopyQuality.ok) {
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
            finalDraft.keywords = dedupeTerms(claimPassingKeywords.length > 0 ? claimPassingKeywords : ((finalDraft.keywords as string[] | undefined) ?? []));
            finalDraft.backendSearchTerms = dedupeTerms((finalDraft.backendSearchTerms as string[] | undefined) ?? []);
            providerSucceeded = true;
            finalDraft.listingUnqualified = false;
            finalDraft.factSafe = true;
            finalDraft.copyQuality = true;
          } else {
            // ListingPlan.v2：Provider 是否成功如实反映调用结果；仅当 claim 硬失败时
            // 保持既有语义 providerSucceeded=false（R3 契约）；plan 绑定拒绝而 claim 通过时置 true。
            // claim 失败 = 采纳级：safeAiDraft 经 Claim Evidence 仍有 unsupported（不是原始 AI raw 文本被 tier 拦截）
            const adoptedClaimFailed = aiEvidence !== null && !listingClaimsHaveEvidence(aiEvidence);
            if (!adoptedClaimFailed) { providerSucceeded = true; }
            // 轮 16 收口：claim 失败 = 有内容被三级判定拦截（无依据硬属性/无锚点话术被移除）。
            // 纯结构/质量不达标（无内容被拦）按结构/质量回退；两者兼具优先报 claim。
            const contractFailed = aiRuntimeContract !== null && !aiRuntimeContract.ok;
            const claimFailed = blockedTexts.length > 0;
            const planBindFailed = !planBind.ok;
            const planBindIssue = planBind.issues.length > 0
              ? "AI 文案未匹配卖点策略：" + planBind.issues.join("；")
              : "AI 文案未匹配卖点策略。";
            applyStructuredFallback(
              claimFailed
                ? "AI 文案包含未经确认的信息，已保留安全草稿。"
                : (!brandPolicyAcceptable
                  ? "AI 文案包含当前竞品品牌，已保留安全草稿。"
                  : (planBindFailed
                  ? "AI 文案重复使用商品事实或未遵循卖点策略，已保留安全草稿。"
                  : (contractFailed ? "AI 文案未通过运行时质量合同（8-30 词完整句/事实锚点/品牌去重）。" : "AI 文案未通过结构或质量校验，已保留安全草稿。"))),
              claimFailed ? "listing_claims_unsupported" : "listing_output_invalid",
              claimFailed
                ? "AI 最终草稿未通过 Claim Evidence"
                : (!brandPolicyAcceptable
                  ? "AI 最终草稿包含竞品品牌：" + competitorBrandMentions.join("、")
                  : (planBindFailed ? planBindIssue : "AI 最终草稿未通过 Schema/Quality")),
            );
            // LISTING_FINAL_CLOSURE：回退稿同样保留确认前被移除的 review 句（仅待确认区展示）
            if (reviewTexts.length > 0) { finalDraft.humanReviewClaims = reviewTexts.slice(0, 5); }
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
      const sellingPointPlan = plan.bulletPlans.slice(0, 5).map((bp) => ({
        role: bp.role ?? "core_outcome",
        shopperNeed: bp.shopperNeed ?? "",
        shopperAngle: bp.shopperAngle,
        factLabels: bp.featureFactIds.map((id) => {
          const fact = generationInput.productFacts.find((f) => f.field === id);
          return fact ? fact.label : id;
        }),
        keywordIds: bp.keywordIds ?? [],
        claimMode: bp.claimMode ?? "verified",
        cannotSay: bp.cannotSay ?? [],
      }));
      const safeDraftWithPlan = {
        ...finalDraft,
        sellingPointPlan,
      };
      const draftSnapshot = {
        ...safeDraftWithPlan,
        draftKind,
        providerAttempted,
        providerSucceeded,
        fallbackApplied,
        fallbackReason,
        keywordPlanSource,
        ...deriveKeywordAdoptionTrace(
          plan,
          [
            String((finalDraft.titles as unknown as string[] ?? [])[0] ?? ""),
            ...((finalDraft.bullets as string[] | undefined) ?? []),
            String(finalDraft.description ?? ""),
          ],
          [
            ...(((finalDraft.keywords as string[] | undefined) ?? []).map((k) => String(k))),
            ...(((finalDraft.backendSearchTerms as string[] | undefined) ?? []).map((k) => String(k))),
          ],
        ),
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
