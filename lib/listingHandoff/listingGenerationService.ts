import "server-only";

import { createHash } from "node:crypto";
import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson, TaskResultJsonMutationError, type TaskResultJsonStorageVersionHash } from "@/lib/server/taskResultJsonMutation";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { buildListingInputFromCreativeHandoff, type ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingHandoffBinding, parseListingHandoffBinding, computeListingStatus, isHandoffListedDraftShape, type ListingHandoffBindingV1, type ListingStatus } from "@/lib/listingHandoff/listingBinding";
import { createMockListingProvider, type MockListingProvider } from "@/lib/listingHandoff/mockListingProvider";
import { createListingProviderByMode } from "@/lib/listingHandoff/realListingProvider";
import { buildListingPromptFromInput, assertPromptIsSafe } from "@/lib/listingHandoff/listingPrompt";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { buildSafeFallbackListingDraft } from "@/lib/listingHandoff/safeListingFallback";
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
  titles: string[];
  bullets: string[];
  description: string | null;
  keywords: string[];
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
    titles: safeStringArray(value.titles).slice(0, 3),
    bullets: safeStringArray(value.bullets).slice(0, 5),
    description: safeString(value.description),
    keywords: safeStringArray(value.keywords).slice(0, 12),
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

let injectedProviderForTests: { provider: MockListingProvider } | null = null;

export function setListingProviderForTests(provider: MockListingProvider | null) {
  injectedProviderForTests = provider ? { provider } : null;
}

function defaultProvider(): MockListingProvider {
  if (injectedProviderForTests) return injectedProviderForTests.provider;
  // V2 Final Integration: Provider 模式由服务端环境决定（LISTING_PROVIDER_MODE=mock|real，fail-closed）。
  // 测试默认 mock；生产候选配置 real。不重新实现 Service，仅替换阶段B Adapter。
  return createListingProviderByMode();
}

export type ListingGenerationOptions = {
  provider?: MockListingProvider;
  providerOptions?: Parameters<MockListingProvider["generate"]>[1];
};

/**
 * PR2-2: 从 active Handoff 生成 Listing 草稿并保存绑定。
 * 阶段A（锁外）：Gate 验证 + 构造安全输入 + 幂等预检。
 * 阶段B（锁外）：Mock Provider（本轮仅 Mock；不联网；不持锁）。
 * 阶段C（锁内）：基于锁内快照二次验证（handoff active/revision/fingerprint/research）→
 *                幂等确认 → Claim Filter → 原子保存 aiListingPackSnapshot + listingHandoffBinding。
 */
export async function generateListingDraftFromHandoff(
  taskId: string,
  context: AccessContext,
  input: ListingGenerateInput,
  options: ListingGenerationOptions = {},
): Promise<ListingGenerateResult> {
  const provider = options.provider ?? defaultProvider();

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

  // ── 阶段B（锁外，不持锁）：Mock Provider（仅非重放请求）──
  // 安全输入只含已过滤事实/AI参考/禁止约束；不含 requestId/Ledger/Hash/resultJson。
  // Prompt 五分区（已确认事实/稳定来源/创意参考/禁止声明/未知冲突），构造后断言无内部泄漏。
  const prompt = buildListingPromptFromInput(generationInput);
  if (!assertPromptIsSafe(prompt)) {
    throw new ListingHandoffError("listing_input_empty", 422, "Prompt 构造安全检查失败。");
  }
  let providerResult: unknown = null;
  if (!idempotentPrefetchHit) {
    providerResult = await provider.generate(generationInput, options.providerOptions);
  }
  const rawDraft = !idempotentPrefetchHit && isRecord(providerResult) ? providerResult : null;
  if (!idempotentPrefetchHit && !rawDraft) {
    throw new ListingHandoffError("listing_schema_invalid", 422, "生成的草稿未通过结构校验。");
  }

  // ── 阶段C：保存前重新验证（锁内）──
  const binding = buildListingHandoffBinding({
    sourceHandoffId: handoffA.handoffId,
    sourceHandoffRevision: handoffA.currentRevision,
    sourceHandoffFingerprint: handoffA.versions[handoffA.versions.length - 1].handoffFingerprint,
    sourceResearchRevision: researchRevision,
    generationInputFingerprint: buildResult.generationInputFingerprint,
    generatedAt: new Date().toISOString(),
    model: provider.model,
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

      // ── 新草稿：阶段B 的 Provider 输出在此复用；不重复调用 Provider。──
      // 安全降级（V2 Listing 稳定落库）：Provider 已成功响应但输出被 Schema 或
      // Claim Evidence 门禁拒绝时，不再调用 Provider，改由服务端根据 confirmedFacts
      // 生成确定性保守草稿（safeFallbackApplied=true）。Claim Evidence 规则零放宽：
      // 保守草稿本身只含已确认事实与中性文案，必然通过门禁。
      let safeDraft: { draft: Record<string, unknown>; safeFallbackApplied: boolean } | null = null;
      const schema = validateAiListingPackDraft(rawDraft);
      if (schema.ok) {
        // Claim Filter（既有逐字规则 + Handoff prohibitedClaims）
        const filtered = filterListingClaims(schema.data, {
          prohibitedClaims: generationInput.prohibitedClaims,
          customClaimLabel: "Handoff prohibited claim",
        });
        // Claim Evidence Mapping（P1-1）：结构化事实证据验证（数值/材质/尺寸/认证/性能/兼容性/AI参考/Unknown/Conflict）
        // 任一事实性声明无 Handoff 证据 → 不保存 AI 草稿，走安全降级（不覆盖旧草稿、不修改 Handoff）
        const evidence = verifyListingClaims(filtered.cleaned, generationInput);
        if (listingClaimsHaveEvidence(evidence)) {
          // 合法 AI 输出：原样保存
          safeDraft = { draft: filtered.cleaned as unknown as Record<string, unknown>, safeFallbackApplied: false as const };
        }
      }
      // AI 输出被拒绝（schema 非法 / claims 无证据）→ 确定性保守草稿
      if (!safeDraft) {
        const fallback = buildSafeFallbackListingDraft({
          generationInput,
          generatedAt: binding.generatedAt,
          model: provider.model,
        });
        if (!fallback) {
          // confirmedFacts 不足（无任何可引用事实）→ 稳定 422，不伪造内容
          throw new ListingHandoffError(
            "listing_claims_unsupported",
            422,
            "当前确认事实不足以生成可保存的 Listing 草稿，请补充确认后重试。",
          );
        }
        // 防御性门禁确认：保守草稿也必须通过 Schema 与 Claim Evidence（零放宽）
        const fallbackSchema = validateAiListingPackDraft(fallback.draft);
        if (!fallbackSchema.ok) {
          throw new ListingHandoffError("listing_schema_invalid", 422, "保守草稿未通过结构校验。");
        }
        const fallbackFiltered = filterListingClaims(fallbackSchema.data, {
          prohibitedClaims: generationInput.prohibitedClaims,
          customClaimLabel: "Handoff prohibited claim",
        });
        const fallbackEvidence = verifyListingClaims(fallbackFiltered.cleaned, generationInput);
        if (!listingClaimsHaveEvidence(fallbackEvidence)) {
          throw new ListingHandoffError(
            "listing_claims_unsupported",
            422,
            "保守草稿未通过事实校验，请补充确认事实后重试。",
          );
        }
        safeDraft = { draft: fallbackFiltered.cleaned as unknown as Record<string, unknown>, safeFallbackApplied: true };
      }

      const status: ListingStatus = computeListingStatus({
        binding,
        currentHandoff: { handoffId: handoffC.handoffId, currentRevision: handoffC.currentRevision, controlState: handoffC.controlState, stale: false },
        researchRevision: validated.researchRevision,
      });

      const draftSnapshot = {
        ...safeDraft.draft,
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
  // 安全降级标记：随响应返回（前端据此显示保守草稿提示；不进入 Browser 隐藏字段）
  const safeFallbackApplied = isRecord(savedRaw)
    && isRecord(savedRaw.aiListingPackSnapshot)
    && savedRaw.aiListingPackSnapshot.safeFallbackApplied === true;

  return {
    listingStatus: result.value.listingStatus,
    currentHandoffRevision: handoffA.currentRevision,
    sourceHandoffRevision: binding.sourceHandoffRevision,
    staleReasonCode: result.value.staleReasonCode,
    idempotentReplay: result.value.idempotentReplay,
    listingSaved: !result.value.idempotentReplay,
    draft: savedDraft,
    safeFallbackApplied,
    handoffState: { controlState: handoffA.controlState, stale: false },
  };
}
