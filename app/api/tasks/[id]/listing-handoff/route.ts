import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import { getDemoAccessById } from "@/lib/server/demoAccess";
import {
  requireAuthenticated,
  requireOwnerOnly,
  guardDemoProviderAction,
  finalizeDemoProviderAction,
  markVisitorStandaloneStudioProviderStarted,
  buildDemoAccessSnapshot,
  type DemoProviderActionToken,
} from "@/lib/server/demoGuard";
import { bindProviderCallStartBoundary } from "@/lib/server/aiClient";
import type { AccessContext } from "@/lib/server/accessPassword";
import { generateListingDraftFromHandoff, ListingHandoffError, draftSafeSummary, type ListingDraftSafeSummary } from "@/lib/listingHandoff/listingGenerationService";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { computeListingStatus, parseListingHandoffBinding, type ListingStatus } from "@/lib/listingHandoff/listingBinding";
import { TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import { evaluateHandoffStatus } from "@/lib/productCreativeHandoffStatus";
import { summarizeListingHandoffFacts } from "@/lib/listingHandoff/listingGenerationInput";
import { preflightListingClaimSafety } from "@/lib/listingHandoff/listingClaimPreflight";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { buildListingBrief } from "@/lib/listingHandoff/listingBrief";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

/** Guest 权威配额快照（响应体随生成/配额拒绝返回，供客户端横幅实时更新；Owner 不返回） */
function demoAccessSnapshotFor(ctx: AccessContext): Record<string, unknown> | undefined {
  if (ctx.mode !== "demo") return undefined;
  const record = getDemoAccessById(ctx.demoAccessId);
  return record ? (buildDemoAccessSnapshot(record) as unknown as Record<string, unknown>) : undefined;
}

const ALLOWED_GENERATE_FIELDS = new Set([
  "action",
  "requestId",
  "expectedStorageVersion",
  "expectedHandoffRevision",
  "confirmed",
  "keywordBrief",
  "listingBrief",
]);
const ALLOWED_KEYWORD_BRIEF_FIELDS = new Set([
  "action",
  "expectedStorageVersion",
  "confirmed",
  "keywordBrief",
]);
const FORBIDDEN_KEYS = new Set([
  "creativeHandoff", "creativeHandoffRequestLedger", "listingHandoffBinding", "aiListingPackSnapshot",
  "candidateId", "handoffId", "revision", "fingerprint", "requestKeyHash", "requestFingerprint",
  "resultJson", "writerKind", "ownedNamespaces", "createdBy", "confirmedBy", "approvedBy",
  "fact", "facts", "confirmedFacts", "prompt", "provider", "model", "listingTitle", "bullets", "__proto__", "constructor", "prototype",
]);

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function containsForbiddenKey(value: unknown, depth = 0): string | null {
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = containsForbiddenKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) return key;
      if (key.startsWith("_")) return key;
    }
    for (const key of Object.keys(value)) {
      const hit = containsForbiddenKey(value[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function parseStorageVersion(value: unknown): { resultJsonHash: string; updatedAt: string } | null {
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  if (typeof value.resultJsonHash !== "string" || !/^[a-f0-9]{64}$/.test(value.resultJsonHash)) return null;
  if (typeof value.updatedAt !== "string" || !value.updatedAt) return null;
  const parsed = new Date(value.updatedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  return { resultJsonHash: value.resultJsonHash, updatedAt: parsed.toISOString() };
}

function snapshotVersionMatchesRoute(
  snapshot: { resultJson: string; updatedAt: Date | string },
  expected: { resultJsonHash: string; updatedAt: string },
): boolean {
  const actual = snapshot.updatedAt instanceof Date ? snapshot.updatedAt.toISOString() : new Date(snapshot.updatedAt).toISOString();
  if (actual !== new Date(expected.updatedAt).toISOString()) return false;
  return createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex") === expected.resultJsonHash;
}

type AuthResult = { ctx: AccessContext | null; error: NextResponse | null };

function getAuth(req: NextRequest, id: string, bodyRecord: Record<string, unknown>): AuthResult {
  if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
    const auth = requireAuthenticated(req, bodyRecord);
    if (!auth.ok) {
      return { ctx: null, error: errorResponse(auth.status, auth.code === "not_found" ? "task_not_found" : auth.code, auth.message) };
    }
    if (auth.context!.mode !== "demo") {
      return { ctx: null, error: errorResponse(404, "task_not_found", "任务不存在。") };
    }
    return { ctx: auth.context!, error: null };
  }
  const auth = requireOwnerOnly(req, bodyRecord);
  if (!auth.ok) {
    return { ctx: null, error: errorResponse(auth.status, auth.code === "not_found" ? "task_not_found" : auth.code, auth.message) };
  }
  return { ctx: auth.context!, error: null };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = getAuth(req, id, {});
  if (auth.error) return auth.error;
  const ctx = auth.ctx!;

  try {
    const gate = await checkCreativeHandoffGate(id, ctx);
    if (gate.reason === "legacy_not_supported" && !gate.listingHandoffBindingRaw) {
      // 区分：任务不存在/跨主体不可见（404）vs 任务存在但无 Handoff（legacy_unbound）
      // Gate 的 legacy_not_supported 覆盖两类：任务不存在 / 主体不匹配 / 无研究记录
      // 对 sandbox（Visitor）任务：主体不匹配时必须 404，不得泄露 legacy_unbound
      if (isSandboxTaskId(id) || id.startsWith("demo-") || id.startsWith("sandbox-")) {
        // Visitor 无法访问（不存在或属于其他主体）→ 统一 404
        return errorResponse(404, "task_not_found", "任务不存在。");
      }
      return NextResponse.json({
        ok: true,
        data: {
          canGenerate: false,
          listingStatus: "legacy_unbound" as ListingStatus,
          currentHandoffRevision: null,
          sourceHandoffRevision: null,
          staleReasonCode: null,
          humanReviewRequired: true,
          researchRevision: null,
          factSummary: { confirmedFacts: 0, listingEligibleFacts: 0, prohibitedClaims: 0 },
          history: [],
        },
      });
    }
    const handoff = gate.currentHandoff;
    const factSummary = summarizeListingHandoffFacts(handoff);
    const researchRevision = gate.candidate?.sourceResearch.researchRevision ?? null;
    const bindingRaw = gate.listingHandoffBindingRaw;

    // 从 Gate 的 storageVersion 读取草稿（无需额外数据库读）
    const storageVersion = gate.storageVersion;
    let binding = null;
    let draft: ListingDraftSafeSummary | null = null;
    let listingStatus: ListingStatus = "ready";
    let staleReasonCode: string | null = null;

    if (gate.listingDraftRaw !== undefined) {
      draft = draftSafeSummary(gate.listingDraftRaw);
    }

    // Handoff 有效状态（stale/revoked/active 语义）
    const handoffEffectiveStatus = handoff
      ? (() => {
          try {
            return evaluateHandoffStatus({
              handoff,
              currentResearch: {
                candidateId: gate.candidate?.sourceResearch.candidateId || "",
                researchRevision: researchRevision ?? 1,
                researchHash: gate.candidate?.sourceResearch.researchHash || "0".repeat(64),
                candidateSourceFingerprint: gate.candidate?.sourceResearch.candidateSourceFingerprint || "0".repeat(64),
                verificationValid: true,
                workflowStatus: "completed" as const,
                decisionStatus: "creative_ready" as const,
              },
            });
          } catch {
            return null;
          }
        })()
      : null;

    if (bindingRaw !== undefined) {
      binding = parseListingHandoffBinding(bindingRaw);
      if (!binding) {
        listingStatus = "invalid";
      }
    }

    if (binding) {
      const statusInput = {
        binding,
        currentHandoff: handoff
          ? { handoffId: handoff.handoffId, currentRevision: handoff.currentRevision, controlState: handoff.controlState, stale: false }
          : null,
        researchRevision: researchRevision ?? 1,
      };
      listingStatus = computeListingStatus(statusInput);

      // stale 原因（服务端语义）
      if (listingStatus === "stale" && handoff) {
        if (binding.sourceHandoffRevision !== handoff.currentRevision) staleReasonCode = "handoff_revision_changed";
        else if (binding.sourceResearchRevision !== researchRevision) staleReasonCode = "research_revision_changed";
        else staleReasonCode = "handoff_updated";
      }
      if (listingStatus === "revoked") staleReasonCode = "handoff_revoked";
    } else if (handoff) {
      listingStatus = handoff.controlState === "revoked" ? "revoked" : "ready";
      if (listingStatus === "revoked") staleReasonCode = "handoff_revoked";
    }

    const history = binding
      ? [{
          sourceHandoffRevision: binding.sourceHandoffRevision,
          sourceResearchRevision: binding.sourceResearchRevision,
          generatedAt: binding.generatedAt,
          humanReviewRequired: binding.humanReviewRequired,
        }]
      : [];

    const staleDraftPresent = listingStatus === "stale" && draft !== null;

    // V3R（契约① LISTENING_READINESS）：canGenerate 与服务端 Generate 的事实校验同源——
    // 预演确定性校验链（buildListingInput → deterministic draft → filter → verify → haveEvidence）。
    // 仅当 handoff 可用时预演；不可用时不预演（canGenerate 已为 false）。
    const claimPreflight = handoff && handoff.controlState === "active"
      && listingStatus !== "revoked"
      && listingStatus !== "invalid"
      ? preflightListingClaimSafety({ handoff, researchRevision: researchRevision ?? 1 })
      : null;

    const canGenerate = handoff?.controlState === "active"
      && listingStatus !== "revoked"
      && listingStatus !== "invalid"
      && handoffEffectiveStatus?.status === "active"
      && factSummary.listingEligibleFacts > 0
      && (claimPreflight === null || claimPreflight.pass);

    // Quality.1：readiness（claimSafe / copyReady / keywordReady / missingForQuality）
    const { buildListingReadiness } = await import("@/lib/listingHandoff/listingReadiness");
    const { parseListingKeywordBrief } = await import("@/lib/listingHandoff/listingKeywordBrief");
    const keywordBrief = parseListingKeywordBrief(gate.keywordBriefRaw);
    const readiness = handoff
      ? buildListingReadiness({
          confirmedFacts: handoff.versions[handoff.versions.length - 1].confirmedFacts,
          listingEligibleFacts: factSummary.listingEligibleFacts,
          hasBlockingIssue: listingStatus === "revoked" || listingStatus === "invalid",
          keywordBrief,
        })
      : null;

    return NextResponse.json({
      ok: true,
      data: {
        canGenerate,
        listingStatus,
        currentHandoffRevision: handoff?.currentRevision ?? null,
        sourceHandoffRevision: binding?.sourceHandoffRevision ?? null,
        staleReasonCode,
        staleDraftPresent,
        handoffEffectiveStatus: handoffEffectiveStatus?.status ?? null,
        humanReviewRequired: true,
        researchRevision,
        storageVersion,
        factSummary,
        draft,
        history,
        readiness: readiness
          ? {
              claimSafe: readiness.claimSafe,
              copyReady: readiness.copyReady,
              keywordReady: readiness.keywordReady,
              missingForQuality: readiness.missingForQuality,
              counts: readiness.counts,
            }
          : null,
        // V3R（契约①）：claimPreflight 与服务端 Generate 校验同源；pass=false 时 reason 为
        // 面向用户的阻断原因（人话），UI 直接展示，不再让用户点击生成后才失败。
        claimPreflight: claimPreflight
          ? claimPreflight.pass
            ? { pass: true, reason: null }
            : { pass: false, reason: claimPreflight.reason }
          : null,
        keywordBriefSummary: keywordBrief
          ? { primaryKeyword: keywordBrief.primaryKeyword, source: keywordBrief.source, backendTermsCount: keywordBrief.backendSearchTerms.length }
          : null,
      },
    });
  } catch (err) {
    if (err instanceof ListingHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求格式无效。");
  }
  if (!isRecord(body)) return errorResponse(400, "invalid_json", "请求格式无效。");

  const forbidden = containsForbiddenKey(body);
  if (forbidden) return errorResponse(400, "forbidden_field", `禁止字段: ${forbidden}`);

  // Quality.1：保存 Keyword Brief（action=save_keyword_brief）
  if (body.action === "save_keyword_brief") {
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYWORD_BRIEF_FIELDS.has(key)) return errorResponse(400, "unknown_field", `未知字段: ${key}`);
    }
    if (body.confirmed !== true) return errorResponse(400, "confirmation_required", "请确认关键词资料后提交。");
    const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
    if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "内容刚在其他位置更新，请刷新后重试。");
    const briefInput = body.keywordBrief;
    if (!isRecord(briefInput)) return errorResponse(400, "invalid_keyword_brief", "关键词资料无效。");
    const briefResult = buildListingKeywordBrief({
      primaryKeyword: briefInput.primaryKeyword as string,
      supportingKeywords: Array.isArray(briefInput.supportingKeywords) ? briefInput.supportingKeywords as string[] : [],
      backendSearchTerms: Array.isArray(briefInput.backendSearchTerms) ? briefInput.backendSearchTerms as string[] : [],
      source: (briefInput.source as "manual" | "synthetic" | "sellersprite" | "amazon_search_query" | "ad_search_term_report" | "unknown") ?? "manual",
      capturedAt: new Date().toISOString(),
      // Phase 3/4：05 合同可追溯字段（旧客户端不传则缺失；非字符串由 build 忽略）
      reportType: briefInput.reportType as string | undefined,
      marketplace: briefInput.marketplace as string | undefined,
      month: briefInput.month as string | undefined,
      evidenceRef: briefInput.evidenceRef as string | undefined,
      reportHash: briefInput.reportHash as string | undefined,
      asin: briefInput.asin as string | undefined,
    });
    if (!briefResult.ok) return errorResponse(400, "invalid_keyword_brief", briefResult.message);
    const { ctx, error } = getAuth(req, id, body);
    if (error) return error;
    try {
      await mutateTaskResultJson({
        context: ctx!,
        taskId: id,
        writer: "keyword-brief",
        async mutate(current, snapshot) {
          if (!snapshotVersionMatchesRoute(snapshot, expectedStorageVersion)) {
            throw new TaskResultJsonMutationError("task_result_conflict", 409, "任务已在其他页面更新，请刷新后重试。");
          }
          return {
            result: { ...current, listingKeywordBrief: briefResult.brief as unknown as Record<string, unknown> },
            value: { saved: true },
          };
        },
      });
      return NextResponse.json({ ok: true, data: { saved: true } });
    } catch (err) {
      if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
      throw err;
    }
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_GENERATE_FIELDS.has(key)) return errorResponse(400, "unknown_field", `未知字段: ${key}`);
  }

  const requestId = body.requestId;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128) {
    return errorResponse(400, "invalid_request_id", "请求标识无效。");
  }
  const expectedStorageVersion = parseStorageVersion(body.expectedStorageVersion);
  if (!expectedStorageVersion) return errorResponse(400, "invalid_storage_version", "内容刚在其他位置更新，请刷新后重试。");
  const expectedHandoffRevision = body.expectedHandoffRevision;
  if (typeof expectedHandoffRevision !== "number" || !Number.isSafeInteger(expectedHandoffRevision) || expectedHandoffRevision < 1) {
    return errorResponse(400, "invalid_handoff_revision", "交接版本无效。");
  }
  if (body.confirmed !== true) return errorResponse(400, "confirmation_required", "请确认后提交。");

  const listingBriefResult = buildListingBrief(body.listingBrief);
  if (!listingBriefResult.ok) {
    return errorResponse(400, listingBriefResult.code, listingBriefResult.message);
  }

  const { ctx, error } = getAuth(req, id, body);
  if (error) return error;

  // D1（Phase 2）：Listing 生成统一 quota authority（§4，GUARD COVERAGE=100%）。
  // 顺序（§6）：scope → IP backstop → guest quota + global cap（同事务原子预留）→ provider call → 结算。
  let providerToken: DemoProviderActionToken | null = null;
  if (ctx!.mode === "demo") {
    const guarded = guardDemoProviderAction(ctx!, req, { kind: "listing", requestId, units: 1 });
    if (!guarded.ok) {
      const snap = demoAccessSnapshotFor(ctx!);
      return NextResponse.json({
        ok: false,
        error: { code: guarded.code, message: guarded.message },
        ...(snap ? { demoAccess: snap } : {}),
      }, { status: guarded.status });
    }
    providerToken = guarded.token;
    // Provider start boundary：真实 callAiJson 发生前记账（成功/失败均计费；未调用则下方回补）
    if (guarded.token.reservation) {
      bindProviderCallStartBoundary(() => {
        markVisitorStandaloneStudioProviderStarted(ctx!, guarded.token!.reservation!);
      });
    }
  }

  try {
    const result = await generateListingDraftFromHandoff(id, ctx!, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision,
      listingBrief: listingBriefResult.brief,
    });
    if (ctx!.mode === "demo") {
      finalizeDemoProviderAction(
        ctx!,
        providerToken,
        { kind: "listing", requestId, units: 1 },
        result.draft?.providerAttempted === true,
      );
    }
    const snap = demoAccessSnapshotFor(ctx!);
    return NextResponse.json({
      ok: true,
      data: {
        listingStatus: result.listingStatus,
        currentHandoffRevision: result.currentHandoffRevision,
        sourceHandoffRevision: result.sourceHandoffRevision,
        idempotentReplay: result.idempotentReplay,
        humanReviewRequired: true,
        // V2 Listing 稳定落库：AI 输出未通过事实校验时系统生成保守草稿（安全降级）
        safeFallbackApplied: result.safeFallbackApplied === true,
        draft: result.draft,
      },
      ...(snap ? { demoAccess: snap } : {}),
    });
  } catch (err) {
    // 失败路径：若 Provider 已记账（boundary 已触发）则 release 为 no-op；否则回补预留（§7）
    if (ctx!.mode === "demo") {
      finalizeDemoProviderAction(ctx!, providerToken, { kind: "listing", requestId, units: 1 }, false);
    }
    if (err instanceof ListingHandoffError) return errorResponse(err.status, err.code, err.message);
    if (err instanceof TaskResultJsonMutationError) return errorResponse(err.status, err.code, err.message);
    throw err;
  }
}