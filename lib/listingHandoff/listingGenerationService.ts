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
import { buildDeterministicListingPackDraft, composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { parseListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { deriveUsedKeywordIds } from "@/lib/listingHandoff/listingKeywordProvenance";
import { filterBackendSearchTerms } from "@/lib/listingHandoff/listingBackendTermSafety";
import { validateListingQuality } from "@/lib/listingHandoff/listingQualityValidator";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { getProductResearchRecord, getProductResearchVerification, verifyProductResearchHash } from "@/lib/productResearchRecord";
import { buildEvidenceExpressionPack } from "@/lib/listingHandoff/listingEvidenceExpression";

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
  usedFactIds?: string[];
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
function filterKeywordsByClaimEvidence(keywords: string[], generationInput: ListingGenerationInput): string[] {
  return keywords.filter((keyword) => listingClaimsHaveEvidence(verifyListingClaims({
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
  }, generationInput)));
}

/** 从草稿提取安全摘要（不含事实原始对象/内部引用） */
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
    usedFactIds: Array.isArray(value.usedFactIds)
      ? value.usedFactIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 50)
      : undefined,
    draftKind: value.draftKind === "ai_optimized_listing" || value.draftKind === "structured_listing_draft" || value.draftKind === "safe_fact_draft"
      ? value.draftKind
      : undefined,
    qualityIssues: Array.isArray(value.qualityIssues)
      ? value.qualityIssues.filter((item): item is string => typeof item === "string").slice(0, 10)
      : undefined,
    providerAttempted: value.providerAttempted === true,
    providerSucceeded: value.providerSucceeded === true,
    fallbackApplied: value.fallbackApplied === true,
    fallbackReason: typeof value.fallbackReason === "string" && value.fallbackReason ? value.fallbackReason : null,
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
  const buildResult = buildListingInputFromCreativeHandoff(handoffA, researchRevision);
  if (!buildResult.ok) {
    throw new ListingHandoffError(buildResult.code, 422, buildResult.message);
  }
  const generationInputBase = withListingBrief(buildResult.input, input.listingBrief);

  // Expression Pack（锁外构建，仅当 copyReady 才会真正用于 AI 优化路径）：
  // 目标语言 = creativePreferences.language（默认 en）。pack 内容进入 fingerprint。
  // fail-closed：builder 失败时不阻断基础生成，只标记 pack 缺失（validator 退回旧行为）。
  const targetLanguage = (buildResult.input.creativePreferences.language || "en").slice(0, 8);
  const packResult = await buildEvidenceExpressionPack({
    facts: buildResult.input.productFacts.map((f) => ({
      factId: f.field,
      field: f.field,
      label: f.label,
      sourceValue: f.value,
    })),
    targetLanguage,
  });
  const generationInput: ListingGenerationInput = packResult.ok
    ? { ...generationInputBase, evidenceExpressions: packResult.pack }
    : generationInputBase;


  const generationInputFingerprint = computeListingGenerationFingerprint(generationInput);

  // ── 阶段B：Composition first（锁外，不持锁，不调用 Provider）──
  // 确定性组合草稿是中文事实拼接，用无 pack 的 input 校验（pack 只用于 AI 优化路径）。
  const generatedAt = new Date().toISOString();

  const deterministicDraft = buildDeterministicListingPackDraft(generationInputBase, generatedAt);
  const deterministicSchema = validateAiListingPackDraft(deterministicDraft);
  if (!deterministicSchema.ok) {
    throw new ListingHandoffError("listing_schema_invalid", 422, "组合草稿未通过结构校验。");
  }
  const deterministicFiltered = filterListingClaims(deterministicSchema.data, {
    prohibitedClaims: generationInputBase.prohibitedClaims,
    customClaimLabel: "Handoff prohibited claim",
  });
  const deterministicEvidence = verifyListingClaims(deterministicFiltered.cleaned, generationInputBase);
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
      const withoutKeywordOptimization = (draft: Record<string, unknown>): Record<string, unknown> => keywordBrief
        ? draft
        : { ...draft, keywords: [], backendSearchTerms: [] };
      const readiness = buildListingReadiness({
        confirmedFacts: handoffC.versions[handoffC.versions.length - 1].confirmedFacts,
        listingEligibleFacts: generationInput.productFacts.length,
        hasBlockingIssue: false,
        keywordBrief,
      });
      const plan = buildListingPlan(generationInput, keywordBrief);
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

      const applyStructuredFallback = (publicReason: string, reasonCode: typeof fallbackReasonCode, issue: string) => {
        const optimized = composeOptimizedListingDraft(generationInput, plan, keywordBrief);
        // R3：structured fallback 与 AI 成功路径同规则——keywords 必须通过正式 Claim Evidence；
        // 无证据的 brief 词（如 primaryKeyword "insulated water bottle"）不得进入最终草稿。
        const optimizedKeywords = filterKeywordsByClaimEvidence(optimized.keywords, generationInput);
        // composeOptimizedTitle 只把 primaryKeyword 并入标题；primaryKeyword 无证据时标题
        // 回退为不并入 keyword 的组合（避免无证据词进标题且超长）。
        const primaryKeyword = keywordBrief ? plan.primaryKeyword : null;
        const primaryHasEvidence = !primaryKeyword
          || filterKeywordsByClaimEvidence([primaryKeyword], generationInput).length === 1;
        const optimizedTitles = primaryHasEvidence
          ? optimized.titles
          : composeOptimizedListingDraft(generationInput, plan, null).titles;
        const optimizedDraft = {
          ...safeDraft,
          titles: optimizedTitles,
          bullets: optimized.bullets,
          description: optimized.description,
          keywords: optimizedKeywords,
          backendSearchTerms: optimized.backendSearchTerms,
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
        const optimizedQuality = optimizedFiltered
          ? validateListingQuality({
              titles: optimizedFiltered.cleaned.titles,
              bullets: optimizedFiltered.cleaned.bullets,
              description: optimizedFiltered.cleaned.description,
              backendSearchTerms: optimized.backendSearchTerms,
              planQuality: "optimized",
            })
          : null;

        fallbackApplied = true;
        fallbackReason = publicReason;
        fallbackReasonCode = reasonCode;
        if (optimizedSchema.ok && optimizedFiltered && optimizedEvidence && optimizedQuality
          && listingClaimsHaveEvidence(optimizedEvidence) && optimizedQuality.ok) {
          draftKind = "structured_listing_draft";
          finalDraft = withoutKeywordOptimization({ ...optimizedFiltered.cleaned });
          qualityIssues = [issue];
          return;
        }

        draftKind = "safe_fact_draft";
        finalDraft = withoutKeywordOptimization({ ...safeDraft });
        qualityIssues = [
          issue,
          ...(!optimizedSchema.ok ? ["结构化回退未通过 schema 校验"] : []),
          ...(optimizedEvidence && !listingClaimsHaveEvidence(optimizedEvidence) ? ["结构化回退未通过 Claim Evidence"] : []),
          ...(optimizedQuality?.issues.map((item) => item.message) ?? []),
        ];
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
          keywordBrief,
          listingBrief: generationInput.listingBrief ?? null,
          prohibitedClaims: generationInput.prohibitedClaims,
          evidenceExpressions: generationInput.evidenceExpressions ?? null,
        };
        const aiResult = await generateTaskLinkedAiListing(aiInput);
        if (aiResult.ok) {
          // v2.2.14：无 Keyword Brief 时 backend terms 必须为空（AI 不得自造关键词）；
          // 有 Brief 时经 R1.6 backend term fact safety 过滤。
          const backendSafety = keywordBrief
            ? filterBackendSearchTerms({
                backendSearchTerms: aiResult.data.backendSearchTerms,
                keywordBrief,
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
            ...(keywordBrief?.supportingKeywords ?? []),
          ].filter(Boolean);
          // 无 Keyword Brief 时正文可继续生成，但不能从 confirmed facts 自动制造 SEO 关键词。
          const fallbackKeywords = filterKeywordsByClaimEvidence(aiKeywords, generationInput);
          const aiDraft = {
            ...safeDraft,
            titles: [aiResult.data.title],
            bullets: aiResult.data.bullets,
            description: aiResult.data.description,
            keywords: fallbackKeywords,
            backendSearchTerms: safeBackendTerms,
            model: "real-ai-provider",
            source: "real_ai_draft",
            riskNotes: keywordBrief
              ? ["AI 优化草稿基于已确认事实生成；所有表述需人工复核。"]
              : ["AI 优化草稿基于已确认事实生成；未进行关键词优化，所有表述需人工复核。"],
            reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
            usedFactIds: aiResult.data.usedFactIds,
            usedKeywordIds: deriveUsedKeywordIds({
              title: aiResult.data.title,
              bullets: aiResult.data.bullets,
              description: aiResult.data.description,
              backendSearchTerms: safeBackendTerms,
              keywordBrief,
            }),
            ...(backendSafety && backendSafety.warnings.length > 0
              ? { backendTermWarnings: backendSafety.warnings }
              : {}),
          };
          const aiSchema = validateAiListingPackDraft(aiDraft);
          const aiFiltered = aiSchema.ok ? filterListingClaims(aiSchema.data, {
            prohibitedClaims: generationInput.prohibitedClaims,
            customClaimLabel: "Handoff prohibited claim",
          }) : null;
          const aiEvidence = aiFiltered
            ? verifyListingClaims(aiFiltered.cleaned, generationInput)
            : null;
          const aiQuality = aiFiltered && aiEvidence && listingClaimsHaveEvidence(aiEvidence)
            ? validateListingQuality({
                titles: aiFiltered.cleaned.titles,
                bullets: aiFiltered.cleaned.bullets,
                description: aiFiltered.cleaned.description,
                backendSearchTerms: safeBackendTerms,
                planQuality: "optimized",
              })
            : null;
          if (aiSchema.ok && aiFiltered && aiEvidence && listingClaimsHaveEvidence(aiEvidence) && aiQuality?.ok) {
            // R1.6：filterListingClaims 重建对象不含后端元数据字段 → 显式补回
            draftKind = "ai_optimized_listing";
            finalDraft = {
              ...aiFiltered.cleaned,
              draftKind,
              usedFactIds: aiResult.data.usedFactIds,
              usedKeywordIds: aiDraft.usedKeywordIds,
              ...(aiDraft.backendTermWarnings ? { backendTermWarnings: aiDraft.backendTermWarnings } : {}),
            };
            providerSucceeded = true;
          } else {
            const claimFailed = Boolean(aiEvidence && !listingClaimsHaveEvidence(aiEvidence));
            applyStructuredFallback(
              claimFailed
                ? "AI 文案包含未经确认的信息，已保留安全草稿。"
                : "AI 文案未通过结构或质量校验，已保留安全草稿。",
              claimFailed ? "listing_claims_unsupported" : "listing_output_invalid",
              claimFailed ? "AI 最终草稿未通过 Claim Evidence" : "AI 最终草稿未通过 Schema/Quality",
            );
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

      const draftSnapshot = {
        ...finalDraft,
        draftKind,
        providerAttempted,
        providerSucceeded,
        fallbackApplied,
        fallbackReason,
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
