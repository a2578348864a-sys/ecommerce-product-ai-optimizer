import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import {
  buildListingInputFromCreativeHandoff,
  LISTING_COMPOSER_VERSION,
} from "@/lib/listingHandoff/listingGenerationInput";
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
  const generationInput = buildResult.input;

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
      if (existingA.generationInputFingerprint === buildResult.generationInputFingerprint) {
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
    generationInputFingerprint: buildResult.generationInputFingerprint,
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
      const readiness = buildListingReadiness({
        confirmedFacts: handoffC.versions[handoffC.versions.length - 1].confirmedFacts,
        listingEligibleFacts: generationInput.productFacts.length,
        hasBlockingIssue: false,
        keywordBrief,
      });
      const plan = buildListingPlan(generationInput, keywordBrief);
      const copyReady = readiness.copyReady && plan.planQuality === "optimized";
      const keywordReady = readiness.keywordReady;
      let finalDraft: Record<string, unknown>;
      let draftKind: "ai_optimized_listing" | "structured_listing_draft" | "safe_fact_draft" = "safe_fact_draft";
      let qualityIssues: string[] = [];
      let providerAttempted = false;
      let providerSucceeded = false;
      let fallbackApplied = false;
      let fallbackReason: string | null = null;

      if (copyReady) {
        // Quality.2：copyReady + keywordReady → 允许真实 AI（AI SEO 优化模式）
        if (keywordReady) {
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
            prohibitedClaims: generationInput.prohibitedClaims,
          };
          const aiResult = await generateTaskLinkedAiListing(aiInput);
          if (aiResult.ok) {
            // R1.6：backend term fact safety（过滤后 provenance 基于安全 terms）
            const backendSafety = filterBackendSearchTerms({
              backendSearchTerms: aiResult.data.backendSearchTerms,
              keywordBrief,
              confirmedFacts: generationInput.productFacts.map((f) => ({
                field: f.field,
                value: f.value,
                usageScopes: ["listing"],
              })),
            });
            const safeBackendTerms = backendSafety.terms;
            // AI 成功：映射到 draft + 服务器派生 keyword provenance + Claim Evidence + Quality
            const aiDraft = {
              ...safeDraft,
              titles: [aiResult.data.title],
              bullets: aiResult.data.bullets,
              description: aiResult.data.description,
              keywords: [
                ...(plan.primaryKeyword ? [plan.primaryKeyword] : []),
                ...(keywordBrief?.supportingKeywords ?? []),
              ],
              ...(safeBackendTerms.length > 0
                ? { backendSearchTerms: safeBackendTerms }
                : {}),
              model: "real-ai-provider",
              source: "real_ai_draft",
              riskNotes: ["AI 优化草稿基于已确认事实生成；所有表述需人工复核。"],
              reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
              usedFactIds: aiResult.data.usedFactIds,
              usedKeywordIds: deriveUsedKeywordIds({
                title: aiResult.data.title,
                bullets: aiResult.data.bullets,
                description: aiResult.data.description,
                backendSearchTerms: safeBackendTerms,
                keywordBrief,
              }),
              ...(backendSafety.warnings.length > 0
                ? { backendTermWarnings: backendSafety.warnings }
                : {}),
            };
            const aiSchema = validateAiListingPackDraft(aiDraft);
            const aiFiltered = aiSchema.ok ? filterListingClaims(aiSchema.data, {
              prohibitedClaims: generationInput.prohibitedClaims,
              customClaimLabel: "Handoff prohibited claim",
            }) : null;
            const aiQuality = aiFiltered
              ? validateListingQuality({
                  titles: aiFiltered.cleaned.titles,
                  bullets: aiFiltered.cleaned.bullets,
                  description: aiFiltered.cleaned.description,
                  backendSearchTerms: safeBackendTerms,
                  planQuality: "optimized",
                })
              : null;
            if (aiSchema.ok && aiFiltered && aiQuality?.ok) {
              // R1.6：filterListingClaims 重建对象不含后端元数据字段 → 显式补回
              finalDraft = {
                ...aiFiltered.cleaned,
                draftKind,
                usedKeywordIds: aiDraft.usedKeywordIds,
                ...(backendSafety.warnings.length > 0 ? { backendTermWarnings: backendSafety.warnings } : {}),
              };
              providerSucceeded = true;
              draftKind = "ai_optimized_listing";
            } else {
              // AI 输出未通过 Schema/Claim/Quality → 不保存为 optimized
              fallbackApplied = true;
              fallbackReason = aiQuality && !aiQuality.ok
                ? aiQuality.issues.map((i) => i.message).join("；")
                : aiSchema.ok ? "AI 输出未通过 Claim Evidence/质量校验" : "AI 输出 schema 无效";
              finalDraft = { ...safeDraft };
              qualityIssues = fallbackReason ? [fallbackReason] : [];
            }
          } else {
            // Provider 失败 → fallback
            fallbackApplied = true;
            fallbackReason = aiResult.error.message;
            finalDraft = { ...safeDraft };
            qualityIssues = [fallbackReason];
          }
        } else {
          // copyReady 但无 keyword brief → 结构化草稿（deterministic，未做 SEO 优化）
          draftKind = "structured_listing_draft";
          const optimized = composeOptimizedListingDraft(generationInput, plan, keywordBrief);
          const optimizedDraft = {
            ...safeDraft,
            titles: optimized.titles,
            bullets: optimized.bullets,
            description: optimized.description,
            keywords: optimized.keywords,
            ...(optimized.backendSearchTerms.length > 0 ? { backendSearchTerms: optimized.backendSearchTerms } : {}),
            riskNotes: ["结构化草稿基于已确认事实生成；未进行搜索词优化。"],
            reviewChecklist: ["请人工核对事实、表达与搜索词后完善。"],
          };
          const quality = validateListingQuality({
            titles: optimized.titles,
            bullets: optimized.bullets,
            description: optimized.description,
            backendSearchTerms: optimized.backendSearchTerms,
            planQuality: "optimized",
          });
          if (quality.ok) {
            finalDraft = optimizedDraft;
          } else {
            finalDraft = { ...safeDraft };
            draftKind = "safe_fact_draft";
            qualityIssues = quality.issues.map((i) => i.message);
          }
        }
      } else {
        finalDraft = { ...safeDraft };
        qualityIssues = readiness.missingForQuality;
      }

      const draftSnapshot = {
        ...finalDraft,
        draftKind,
        providerAttempted,
        providerSucceeded,
        fallbackApplied,
        fallbackReason,
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
    safeFallbackApplied: false,
    handoffState: { controlState: handoffA.controlState, stale: false },
  };
}
