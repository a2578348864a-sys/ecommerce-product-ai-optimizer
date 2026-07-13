import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  createSandboxTask,
  createSandboxTaskAndLinkCandidate,
  SandboxCandidateTaskLinkError,
} from "@/lib/server/demoSandbox";
import { isCandidateReadyForAgent } from "@/lib/opportunityCandidatePool";
import { createInitialProductLifecycle } from "@/lib/workflowLifecycle";
import { normalizeRiskReviewSnapshot } from "@/lib/riskReview";
import { normalizeProfitSnapshot } from "@/lib/profitSnapshot";
import { parseCandidateEvidenceSnapshot, type CandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import { normalizeAgentOutputSnapshot } from "@/lib/agentOutputSnapshot";
import { buildDecisionEvidenceSnapshot, normalizeHumanDecision } from "@/lib/decisionEvidence";
import { isDecisionStatus, normalizeDecisionStatus } from "@/lib/tasks/decisionStatus";
import { buildListingPrepSnapshot } from "@/lib/agentRunSnapshot";
import {
  getAuthoritativeCandidate,
  type AuthoritativeCandidate,
} from "@/lib/server/candidateAuthority";
import {
  buildWorkflowRunSubject,
  createWorkflowInputHash,
  createWorkflowResultHash,
  normalizeWorkflowRunInput,
  verifyWorkflowRunProof,
  type WorkflowRunInput,
  type WorkflowRunStatus,
} from "@/lib/server/workflowRunProof";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
  type CandidateAnalysisContextV1,
} from "@/lib/server/candidateAnalysisContext";
import {
  evaluateR22StoredCandidateStage2Gate,
  parseR22CommercialRunSnapshot,
  type R22CommercialRunSnapshot,
} from "@/lib/r22CommercialValidation";
import {
  parseR22MarketDecisionFromAnalysisJson,
  type R22MarketDecisionSnapshot,
} from "@/lib/r22DecisionModel";

export const runtime = "nodejs";

/* ── Types ─────────────────────────────────────── */

type ApiResponse =
  | { ok: true; data: { id: string; title: string; type: string; allReviewed: boolean; isSandbox?: boolean; sourceMode?: string } }
  | { ok: false; error: { code: string; message: string } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

/* ── Helpers ───────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns true if the snapshot has meaningful Listing content (non-empty title or at least one real keyword). */
function hasListingPrepContent(snapshot: Record<string, unknown>): boolean {
  const ts = isRecord(snapshot.titleStructure) ? snapshot.titleStructure : null;
  const kp = isRecord(snapshot.keywordPool) ? snapshot.keywordPool : null;

  const hasTitle =
    ts !== null &&
    typeof ts.recommendedTitle === "string" &&
    ts.recommendedTitle.trim().length > 0;

  const hasCoreWords =
    kp !== null &&
    Array.isArray(kp.coreWords) &&
    kp.coreWords.some((w: unknown) => typeof w === "string" && w.trim().length > 0);

  const hasLongTailWords =
    kp !== null &&
    Array.isArray(kp.longTailWords) &&
    kp.longTailWords.some((w: unknown) => typeof w === "string" && w.trim().length > 0);

  return hasTitle || hasCoreWords || hasLongTailWords;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function workflowScoreFromRiskLevel(riskLevel: string): number {
  if (riskLevel === "green") return 85;
  if (riskLevel === "red") return 25;
  return 55; // yellow / unknown
}

const REVIEW_STEP_KEYS = ["sourcing", "risk", "summary", "listing"] as const;
const TOTAL_REVIEW_STEPS = 4;

type ReviewState = {
  sourcingReviewed: boolean;
  riskReviewed: boolean;
  summaryReviewed: boolean;
  listingReviewed: boolean;
  reviewedCount: number;
  totalReviewSteps: number;
  allReviewed: boolean;
  reviewedAt: string | null;
};

type BatchMeta = {
  batchId: string;
  batchName: string;
  batchIndex: number;
  batchTotal: number;
  source: "workflow_batch_mvp";
};

type SourceMeta = {
  source: "opportunity";
  from?: "opportunity";
  entry?: "candidate_to_agent_m1" | "candidate_to_agent_run";
  opportunityTitle: string;
  opportunitySource?: string;
  opportunityScore?: number;
  keyword?: string;
  importedAt: string;
  /** Phase 4-E.1: enhanced candidate context */
  candidateType?: string;
  sourceUrl?: string;
  candidateId?: string;
  /** Phase Candidate-To-Agent-M.1: candidate pool handoff context */
  sourceTitle?: string;
  originalName?: string;
  analyzedName?: string;
  evidenceSnapshot?: CandidateEvidenceSnapshot;
  r22MarketDecisionSnapshot?: R22MarketDecisionSnapshot;
  candidateSnapshot?: {
    version: 1;
    id: string;
    name: string;
    rawInput: string;
    status: string;
    source: string;
    score: number;
    link: string | null;
    keyword: string;
    riskLevel: string;
    riskLabel: string;
    summaryLabel: string;
    capturedAt: string;
  };
};

/**
 * Parse and validate reviewState from the request body.
 * Server always recomputes allReviewed and reviewedCount to prevent client-side forgery.
 */
function parseReviewState(raw: unknown): ReviewState | null {
  if (!isRecord(raw)) return null;

  const sourcingReviewed = asBoolean(raw.sourcingReviewed);
  const riskReviewed = asBoolean(raw.riskReviewed);
  const summaryReviewed = asBoolean(raw.summaryReviewed);
  const listingReviewed = asBoolean(raw.listingReviewed);

  const confirmedSteps = REVIEW_STEP_KEYS.filter((k) => {
    switch (k) {
      case "sourcing": return sourcingReviewed;
      case "risk": return riskReviewed;
      case "summary": return summaryReviewed;
      case "listing": return listingReviewed;
      default: return false;
    }
  });

  const reviewedCount = confirmedSteps.length;
  const allReviewed = reviewedCount === TOTAL_REVIEW_STEPS;

  return {
    sourcingReviewed,
    riskReviewed,
    summaryReviewed,
    listingReviewed,
    reviewedCount,
    totalReviewSteps: TOTAL_REVIEW_STEPS,
    allReviewed,
    reviewedAt: allReviewed ? new Date().toISOString() : null,
  };
}

function asBoundedInteger(value: unknown, min: number, max: number): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const normalized = Math.trunc(numberValue);
  if (normalized < min || normalized > max) return null;
  return normalized;
}

function parseBatchMeta(raw: unknown): BatchMeta | null {
  if (!isRecord(raw)) return null;

  const batchId = asString(raw.batchId).slice(0, 80);
  if (!/^batch-[a-zA-Z0-9_-]{4,72}$/.test(batchId)) return null;

  const batchTotal = asBoundedInteger(raw.batchTotal, 1, 3);
  if (!batchTotal) return null;

  const batchIndex = asBoundedInteger(raw.batchIndex, 1, batchTotal);
  if (!batchIndex) return null;

  if (asString(raw.source) !== "workflow_batch_mvp") return null;

  const batchName = asString(raw.batchName, "批量一键分析").slice(0, 40) || "批量一键分析";

  return {
    batchId,
    batchName,
    batchIndex,
    batchTotal,
    source: "workflow_batch_mvp",
  };
}

function parseSourceMeta(raw: unknown, fallbackTitle: string): SourceMeta | null {
  if (!isRecord(raw)) return null;
  if (asString(raw.source) !== "opportunity") return null;

  const opportunityTitle = asString(raw.opportunityTitle, fallbackTitle).slice(0, 120);
  if (!opportunityTitle) return null;

  const opportunitySource = asString(raw.opportunitySource).slice(0, 180);
  const keyword = asString(raw.keyword).slice(0, 80);
  const score = asBoundedInteger(raw.opportunityScore, 0, 100);
  const importedAt = asString(raw.importedAt).slice(0, 40) || new Date().toISOString();
  // Phase 4-E.1: enhanced context
  const candidateType = asString(raw.candidateType).slice(0, 40);
  const sourceUrl = asString(raw.sourceUrl).slice(0, 500);
  const candidateId = asString(raw.candidateId).slice(0, 80);
  // Phase Candidate-To-Agent-M.1: candidate pool handoff context
  const from = asString(raw.from);
  const entry = asString(raw.entry);
  const sourceTitle = asString(raw.sourceTitle).slice(0, 160);
  const originalName = asString(raw.originalName).slice(0, 200);
  const analyzedName = asString(raw.analyzedName).slice(0, 120);
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(raw.evidenceSnapshot);

  return {
    source: "opportunity",
    ...(from === "opportunity" ? { from } : {}),
    ...(entry === "candidate_to_agent_m1" || entry === "candidate_to_agent_run" ? { entry } : {}),
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(score !== null ? { opportunityScore: score } : {}),
    ...(keyword ? { keyword } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(originalName ? { originalName } : {}),
    ...(analyzedName ? { analyzedName } : {}),
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    importedAt,
  };
}

type CandidateConversionErrorCode =
  | "candidate_not_found"
  | "candidate_not_ready_for_conversion"
  | "candidate_already_converted"
  | "candidate_conversion_conflict"
  | "candidate_changed_since_analysis"
  | "candidate_context_changed_since_analysis"
  | "candidate_r22_stage2_blocked";

class CandidateConversionError extends Error {
  constructor(
    public readonly code: CandidateConversionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CandidateConversionError";
  }
}

function candidateConversionStatus(code: CandidateConversionErrorCode): number {
  return code === "candidate_not_found" ? 404 : 409;
}

function parseStoredCandidateMeta(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildAuthoritativeSourceMeta(candidate: AuthoritativeCandidate, capturedAt: string): SourceMeta {
  const storedMeta = parseStoredCandidateMeta(candidate.sourceMetaJson);
  const evidenceSnapshot = parseCandidateEvidenceSnapshot(storedMeta.evidenceSnapshot);
  const candidateType = asString(storedMeta.candidateType).slice(0, 40);
  const sourceUrl = sanitizeCandidateSourceUrl(candidate.link);
  const r22MarketDecisionSnapshot = parseR22MarketDecisionFromAnalysisJson(candidate.analysisJson);

  return {
    source: "opportunity",
    from: "opportunity",
    entry: "candidate_to_agent_run",
    opportunityTitle: candidate.name,
    opportunitySource: candidate.source,
    opportunityScore: Math.min(100, Math.max(0, Math.round(candidate.score))),
    keyword: candidate.keyword,
    importedAt: capturedAt,
    candidateId: candidate.id,
    sourceTitle: candidate.summaryLabel || candidate.name,
    originalName: candidate.rawInput,
    analyzedName: candidate.name,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    candidateSnapshot: {
      version: 1,
      id: candidate.id,
      name: candidate.name,
      rawInput: candidate.rawInput,
      status: candidate.status,
      source: candidate.source,
      score: Math.min(100, Math.max(0, Math.round(candidate.score))),
      link: sourceUrl,
      keyword: candidate.keyword,
      riskLevel: candidate.riskLevel,
      riskLabel: candidate.riskLabel,
      summaryLabel: candidate.summaryLabel,
      capturedAt,
    },
  };
}

function normalizeComparableProductName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function sanitizeCandidateSourceUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      const normalized = key.toLowerCase();
      if (["token", "key", "secret", "password", "cookie", "session"].some((item) => normalized.includes(item))) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString().slice(0, 500);
  } catch {
    return value.slice(0, 500);
  }
}

/* ── POST handler ──────────────────────────────── */

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  // Demo-Sandbox.1-B: Allow both Owner and Demo
  const auth = requireAuthenticated(request, body as Record<string, unknown>);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }

  // Validate workflow result
  const workflowResult = body.workflowResult;
  if (!isRecord(workflowResult)) {
    return jsonResponse({ ok: false, error: { code: "missing_workflow_result", message: "请先完成一键分析后再保存。" } }, 400);
  }

  if (!workflowResult.ok) {
    return jsonResponse({ ok: false, error: { code: "workflow_not_ok", message: "工作流未成功完成，无法保存。请重新分析后再试。" } }, 400);
  }

  const finalReport = workflowResult.finalReport;
  if (!isRecord(finalReport)) {
    return jsonResponse({ ok: false, error: { code: "missing_final_report", message: "工作流结果缺少最终报告，无法保存。" } }, 400);
  }

  const productName = asString(workflowResult.productName);
  if (!productName) {
    return jsonResponse({ ok: false, error: { code: "missing_product_name", message: "工作流结果缺少商品名，无法保存。" } }, 400);
  }

  const runProof = asString(body.runProof);
  if (!runProof) {
    return jsonResponse({ ok: false, error: { code: "missing_run_proof", message: "分析结果缺少服务端可信凭证，请重新分析后再保存。" } }, 400);
  }
  const runId = asString(workflowResult.runId);
  const workflowId = asString(workflowResult.workflowId);
  const workflowStatus = asString(workflowResult.status) as WorkflowRunStatus;
  const rawWorkflowInput = workflowResult.input;
  if (!runId || runId !== workflowId || !isRecord(rawWorkflowInput)) {
    return jsonResponse({ ok: false, error: { code: "invalid_run_binding", message: "分析运行标识无效，请重新分析后再保存。" } }, 400);
  }
  const inputSource = asString(rawWorkflowInput.source);
  if (inputSource !== "manual" && inputSource !== "opportunity" && inputSource !== "task") {
    return jsonResponse({ ok: false, error: { code: "invalid_run_input", message: "分析输入来源无效，请重新分析后再保存。" } }, 400);
  }
  const rawCandidateId = rawWorkflowInput.candidateId;
  if (rawCandidateId !== null && typeof rawCandidateId !== "string") {
    return jsonResponse({ ok: false, error: { code: "invalid_run_input", message: "分析候选绑定无效，请重新分析后再保存。" } }, 400);
  }
  const rawContextHash = rawWorkflowInput.contextHash;
  if (rawContextHash !== undefined
    && (typeof rawContextHash !== "string" || !/^[a-f0-9]{64}$/i.test(rawContextHash.trim()))) {
    return jsonResponse({ ok: false, error: { code: "invalid_run_input", message: "分析证据上下文无效，请重新分析后再保存。" } }, 400);
  }
  const workflowInput: WorkflowRunInput = normalizeWorkflowRunInput({
    productName: asString(rawWorkflowInput.productName),
    source: inputSource,
    candidateId: rawCandidateId,
    ...(typeof rawContextHash === "string" ? { contextHash: rawContextHash } : {}),
  });
  const normalizedResultProductName = normalizeWorkflowRunInput({
    productName,
    source: inputSource,
    candidateId: rawCandidateId,
  }).productName;
  if (!workflowInput.productName || workflowInput.productName !== normalizedResultProductName) {
    return jsonResponse({ ok: false, error: { code: "input_product_mismatch", message: "分析输入与结果商品不一致，无法保存。" } }, 409);
  }
  if (workflowInput.source === "opportunity" && !workflowInput.candidateId) {
    return jsonResponse({ ok: false, error: { code: "candidate_id_required", message: "机会候选分析缺少 Candidate 绑定，请从候选品池重新进入。" } }, 409);
  }
  if (!workflowInput.candidateId && workflowInput.contextHash) {
    return jsonResponse({ ok: false, error: { code: "invalid_run_input", message: "手工分析不能附加 Candidate 证据上下文。" } }, 400);
  }

  const clientSourceMeta = parseSourceMeta(body.sourceMeta, productName);
  const clientSourceCandidateId = clientSourceMeta?.candidateId ?? null;
  if (clientSourceCandidateId && clientSourceCandidateId !== workflowInput.candidateId) {
    return jsonResponse({ ok: false, error: { code: "candidate_binding_mismatch", message: "候选商品与可信分析结果不一致，无法保存。" } }, 409);
  }

  const verifiedProof = verifyWorkflowRunProof(runProof);
  if (!verifiedProof.ok) {
    const code = verifiedProof.reason === "expired" ? "run_proof_expired" : "invalid_run_proof";
    const message = verifiedProof.reason === "expired"
      ? "分析结果凭证已过期，请重新分析后再保存。"
      : "分析结果可信凭证无效，请重新分析后再保存。";
    return jsonResponse({ ok: false, error: { code, message } }, 403);
  }

  const expectedSubject = buildWorkflowRunSubject(auth.context);
  const inputHash = createWorkflowInputHash(workflowInput);
  const resultHash = createWorkflowResultHash(workflowResult);
  const proofPayload = verifiedProof.payload;
  if (proofPayload.subject !== expectedSubject) {
    return jsonResponse({ ok: false, error: { code: "run_subject_mismatch", message: "该分析结果不属于当前访问主体。" } }, 403);
  }
  if (proofPayload.runId !== runId
    || proofPayload.candidateId !== workflowInput.candidateId
    || proofPayload.inputHash !== inputHash
    || proofPayload.resultHash !== resultHash
    || proofPayload.status !== workflowStatus) {
    return jsonResponse({ ok: false, error: { code: "run_proof_mismatch", message: "分析结果已发生变化，无法保存。" } }, 409);
  }
  if (workflowStatus !== "completed" && workflowStatus !== "partial_failed") {
    return jsonResponse({ ok: false, error: { code: "workflow_status_not_savable", message: "当前分析未达到可保存状态，请重新分析或补充证据。" } }, 409);
  }

  const candidateCapturedAt = new Date().toISOString();
  let sourceMeta: SourceMeta | null = null;
  let candidateAnalysisContext: CandidateAnalysisContextV1 | null = null;
  let r22CommercialValidation: R22CommercialRunSnapshot | null = null;
  if (workflowInput.candidateId) {
    const candidate = await getAuthoritativeCandidate(auth.context, workflowInput.candidateId);
    if (!candidate) {
      return jsonResponse({ ok: false, error: { code: "candidate_not_found", message: "候选商品不存在或不属于当前访问主体。" } }, 404);
    }
    if (normalizeComparableProductName(candidate.name) !== normalizeComparableProductName(workflowInput.productName)) {
      return jsonResponse({ ok: false, error: { code: "candidate_changed_since_analysis", message: "候选商品在分析后已发生变化，请重新分析后再保存。" } }, 409);
    }
    const r22Stage2Gate = evaluateR22StoredCandidateStage2Gate({
      candidateId: candidate.id,
      analysisJson: candidate.analysisJson,
    });
    if (!r22Stage2Gate.allowed) {
      const gateCode = r22Stage2Gate.reasons.includes("invalid_analysis_json")
        ? "candidate_context_changed_since_analysis"
        : "candidate_r22_stage2_blocked";
      return jsonResponse({
        ok: false,
        error: {
          code: gateCode,
          message: "该候选未通过 R2.2 市场晋级门禁，不能保存为商业深挖任务。",
        },
      }, 409);
    }
    candidateAnalysisContext = buildCandidateAnalysisContext(candidate);
    if (workflowInput.contextHash !== createCandidateAnalysisBindingHash(candidate, candidateAnalysisContext)) {
      return jsonResponse({
        ok: false,
        error: {
          code: "candidate_context_changed_since_analysis",
          message: "候选来源证据在分析后已发生变化，请重新分析后再保存。",
        },
      }, 409);
    }
    const r22MarketDecision = parseR22MarketDecisionFromAnalysisJson(candidate.analysisJson);
    if (r22MarketDecision) {
      const commercialSnapshot = parseR22CommercialRunSnapshot(workflowResult.r22CommercialValidation);
      if (!commercialSnapshot
        || commercialSnapshot.runId !== runId
        || commercialSnapshot.candidateId !== candidate.id
        || commercialSnapshot.stage1InputHash !== r22MarketDecision.inputHash
        || commercialSnapshot.ruleVersion !== r22MarketDecision.ruleVersion
        || commercialSnapshot.evidenceVersion !== r22MarketDecision.evidenceVersion
        || commercialSnapshot.marketDecision !== r22MarketDecision.marketDecision
        || Date.parse(commercialSnapshot.createdAt) <= Date.parse(r22MarketDecision.createdAt)) {
        return jsonResponse({
          ok: false,
          error: {
            code: "candidate_r22_commercial_snapshot_invalid",
            message: "R2.2 商业验证运行快照缺失或与服务端候选不一致，不能保存任务。",
          },
        }, 409);
      }
      r22CommercialValidation = commercialSnapshot;
    } else if (workflowResult.r22CommercialValidation !== undefined) {
      return jsonResponse({
        ok: false,
        error: {
          code: "candidate_r22_commercial_snapshot_invalid",
          message: "非 R2.2 候选不能附加 R2.2 商业验证快照。",
        },
      }, 409);
    }
    sourceMeta = buildAuthoritativeSourceMeta(candidate, candidateCapturedAt);
  } else if (clientSourceMeta) {
    return jsonResponse({ ok: false, error: { code: "candidate_binding_mismatch", message: "手工分析不能附加未签名候选关系。" } }, 409);
  }

  const finalVerdict = asString(finalReport.finalVerdict, "未评级");
  const riskLevel = asString(finalReport.riskLevel, "yellow");
  const score = workflowScoreFromRiskLevel(riskLevel);

  // Parse and validate reviewState
  const reviewState = parseReviewState(body.reviewState);
  if (workflowInput.candidateId && (body.humanConfirmed !== true || !reviewState?.allReviewed)) {
    return jsonResponse({
      ok: false,
      error: {
        code: "candidate_human_confirmation_required",
        message: "候选商品必须完成全部人工复核并明确确认后，才能创建任务。",
      },
    }, 409);
  }
  const batchMeta = parseBatchMeta(body.batchMeta);
  const profitSnapshot = normalizeProfitSnapshot(body.profitSnapshot);
  const riskReviewSnapshot = normalizeRiskReviewSnapshot(body.riskReviewSnapshot);
  const agentRunSnapshot = isRecord(body.agentRunSnapshot) ? body.agentRunSnapshot : null;

  // Listing-Persistence-Fix.1-Meaningful-Content-Guard: only treat
  // listingPrepSnapshot as valid if it contains actual Listing content
  // (non-empty title, non-empty keywords, or non-empty longTailWords).
  // Empty nested objects like { titleStructure: {} } or blank-only fields
  // must NOT block the workflowResult.listing fallback.
  const rawListingPrep = isRecord(body.listingPrepSnapshot) ? body.listingPrepSnapshot : null;
  const listingPrepIsValid =
    rawListingPrep !== null &&
    isRecord(rawListingPrep) &&
    hasListingPrepContent(rawListingPrep as Record<string, unknown>);
  let listingPrepSnapshot = listingPrepIsValid ? rawListingPrep : null;

  // Listing-Persistence-Fix.1: if caller did not pass a valid listingPrepSnapshot
  // but the workflow result has valid listing output, auto-generate a fallback
  // snapshot so Listing data is never silently dropped.
  if (!listingPrepSnapshot && isRecord(workflowResult.listing)) {
    const listingOut = workflowResult.listing as Record<string, unknown>;
    const hasListingContent =
      (typeof listingOut.title === "string" && listingOut.title.trim().length > 0) ||
      (Array.isArray(listingOut.keywords) && listingOut.keywords.length > 0);
    if (hasListingContent) {
      listingPrepSnapshot = buildListingPrepSnapshot({
        listing: listingOut,
        finalReport: finalReport as Record<string, unknown> | undefined,
        productName,
      });
    }
  }
  const requestedDecisionStatus = isDecisionStatus(body.decisionStatus) ? body.decisionStatus : "pending";
  const decisionStatus = workflowStatus === "partial_failed" ? "need_info" : requestedDecisionStatus;
  const humanDecisionInput = isRecord(body.humanDecision) ? body.humanDecision : {
    status: decisionStatus,
    reason: "",
    nextAction: "",
    confirmedItems: [],
    unconfirmedItems: [],
  };
  const humanDecision = normalizeHumanDecision({
    ...humanDecisionInput,
    status: decisionStatus,
    ...(workflowStatus === "partial_failed"
      ? { nextAction: "补充失败步骤所需证据并重新分析，当前任务不得进入正常推进流程。" }
      : {}),
  });
  const agentOutputSnapshot = normalizeAgentOutputSnapshot({
    workflowResult,
    sourceMeta,
    profitSnapshot,
    riskReviewSnapshot,
  });
  const decisionEvidence = buildDecisionEvidenceSnapshot({
    workflowResult,
    sourceMeta,
    profitSnapshot,
    riskReviewSnapshot,
    reviewState,
    humanDecision,
  });

  // Build a structured result for the task record
  const taskResult = {
    type: "workflow",
    workflowId,
    runId,
    productName,
    status: workflowStatus,
    finalReport,
    steps: Array.isArray(workflowResult.steps) ? workflowResult.steps : [],
    costGuard: isRecord(workflowResult.costGuard) ? workflowResult.costGuard : {},
    reviewState: reviewState || {
      sourcingReviewed: false,
      riskReviewed: false,
      summaryReviewed: false,
      listingReviewed: false,
      reviewedCount: 0,
      totalReviewSteps: 4,
      allReviewed: false,
      reviewedAt: null,
    },
    ...(batchMeta ? { batchMeta } : {}),
    ...(sourceMeta ? { sourceMeta } : {}),
    ...(workflowInput.candidateId ? {
      candidateToTask: {
        version: 1,
        candidateId: workflowInput.candidateId,
        analysisRunId: runId,
        confirmation: "human_review",
        confirmedAt: candidateCapturedAt,
      },
    } : {}),
    ...(candidateAnalysisContext ? { candidateAnalysisContext } : {}),
    ...(r22CommercialValidation ? { r22CommercialValidation } : {}),
    // Phase 4-E.2.1: initialize product lifecycle
    productLifecycle: createInitialProductLifecycle(),
    // Phase Profit-M.1: optional profit snapshot from in-line estimate card
    ...(profitSnapshot ? { profitSnapshot } : {}),
    // Phase Risk-Review-M.1: optional manual compliance / IP review snapshot
    ...(riskReviewSnapshot ? { riskReviewSnapshot } : {}),
    // Phase B2: stable Agent output contract for replay and task summary
    agentOutputSnapshot,
    // Phase V2-Internal-Use.1: decision evidence metadata for fact/inference separation
    decisionEvidence,
    ...(humanDecision ? { humanDecision } : {}),
    // Phase Agent-Save-M.1: agent run snapshot for task replay
    ...(agentRunSnapshot ? { agentRunSnapshot } : {}),
    // Phase Listing-Prep-M.1: listing preparation snapshot
    ...(listingPrepSnapshot ? { listingPrepSnapshot } : {}),
  };

  // Demo-Sandbox.1-B: Demo writes to sandbox, Owner writes to Prisma
  if (auth.context.mode === "demo") {
    try {
      const sandboxInput = {
        type: "workflow",
        title: `${productName} 一键分析`,
        platform: "manual",
        source: typeof body.source === "string" ? body.source : "ai",
        score,
        level: riskLevel,
        oneLineSummary: finalVerdict,
        decisionStatus: normalizeDecisionStatus(decisionStatus),
        resultJson: JSON.stringify(taskResult),
        productLifecycle: JSON.stringify(body.productLifecycle || createInitialProductLifecycle()),
      };
      const sandboxTask = workflowInput.candidateId
        ? createSandboxTaskAndLinkCandidate(
          auth.context.demoAccessId,
          workflowInput.candidateId,
          sandboxInput,
          {
            expectedProductName: workflowInput.productName,
            expectedContextHash: workflowInput.contextHash!,
          },
        )
        : createSandboxTask(auth.context.demoAccessId, sandboxInput);

      return jsonResponse({
        ok: true,
        data: {
          id: sandboxTask.id,
          title: sandboxTask.title || productName,
          type: "workflow",
          isSandbox: true,
          sourceMode: "demo_sandbox",
          allReviewed: taskResult.reviewState.allReviewed,
        },
      });
    } catch (error) {
      if (error instanceof SandboxCandidateTaskLinkError) {
        return jsonResponse({
          ok: false,
          error: { code: error.code, message: error.message },
        }, candidateConversionStatus(error.code));
      }
      return jsonResponse({
        ok: false,
        error: { code: "sandbox_write_error", message: "访客任务保存失败，请稍后重试。" },
      }, 500);
    }
  }

  const ownerTaskData = {
    type: "workflow",
    title: `${productName} 一键分析`,
    platform: "manual",
    productUrl: null,
    materialText: productName,
    source: typeof body.source === "string" ? body.source : "ai",
    score,
    level: riskLevel,
    oneLineSummary: finalVerdict,
    decisionStatus: normalizeDecisionStatus(decisionStatus),
    resultJson: JSON.stringify(taskResult),
  };

  // Owner Candidate conversion is one transaction; manual Tasks remain a single create.
  try {
    const record = workflowInput.candidateId
      ? await prisma.$transaction(async (tx) => {
        const currentCandidate = await tx.opportunityCandidate.findUnique({
          where: { id: workflowInput.candidateId! },
          select: {
            id: true,
            name: true,
            link: true,
            status: true,
            sourceMetaJson: true,
            analysisJson: true,
            convertedTaskId: true,
          },
        });
        if (!currentCandidate) {
          throw new CandidateConversionError(
            "candidate_not_found",
            "候选商品不存在或不属于当前访问主体。",
          );
        }
        if (currentCandidate.convertedTaskId) {
          throw new CandidateConversionError(
            "candidate_already_converted",
            "该候选已经转为任务，不能重复创建。",
          );
        }
        if (!isCandidateReadyForAgent(currentCandidate.status)) {
          throw new CandidateConversionError(
            "candidate_not_ready_for_conversion",
            "候选状态已变化，当前不能创建任务。",
          );
        }
        const currentR22Stage2Gate = evaluateR22StoredCandidateStage2Gate({
          candidateId: currentCandidate.id,
          analysisJson: currentCandidate.analysisJson,
        });
        if (!currentR22Stage2Gate.allowed) {
          throw new CandidateConversionError(
            currentR22Stage2Gate.reasons.includes("invalid_analysis_json")
              ? "candidate_context_changed_since_analysis"
              : "candidate_r22_stage2_blocked",
            "R2.2 市场晋级状态已变化，当前不能创建商业验证任务。",
          );
        }
        if (normalizeComparableProductName(currentCandidate.name)
          !== normalizeComparableProductName(workflowInput.productName)) {
          throw new CandidateConversionError(
            "candidate_changed_since_analysis",
            "候选商品在分析后已发生变化，请重新分析后再保存。",
          );
        }
        const currentContext = buildCandidateAnalysisContext(currentCandidate);
        if (createCandidateAnalysisBindingHash(currentCandidate, currentContext) !== workflowInput.contextHash) {
          throw new CandidateConversionError(
            "candidate_context_changed_since_analysis",
            "候选来源证据在分析后已发生变化，请重新分析后再保存。",
          );
        }

        const task = await tx.viralAnalysisRecord.create({ data: ownerTaskData });
        const linked = await tx.opportunityCandidate.updateMany({
          where: {
            id: workflowInput.candidateId!,
            convertedTaskId: null,
            status: { in: ["worth_analyzing", "analyzed"] },
          },
          data: {
            convertedTaskId: task.id,
            lastActionAt: new Date(),
          },
        });
        if (linked.count !== 1) {
          throw new CandidateConversionError(
            "candidate_conversion_conflict",
            "候选状态刚刚发生变化，请刷新后重试。",
          );
        }
        return task;
      })
      : await prisma.viralAnalysisRecord.create({ data: ownerTaskData });

    return jsonResponse({
      ok: true,
      data: {
        id: record.id,
        title: record.title || productName,
        type: "workflow",
        allReviewed: taskResult.reviewState.allReviewed,
      },
    });
  } catch (error) {
    if (error instanceof CandidateConversionError) {
      return jsonResponse({
        ok: false,
        error: { code: error.code, message: error.message },
      }, candidateConversionStatus(error.code));
    }
    return jsonResponse({
      ok: false,
      error: {
        code: "database_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用，请稍后重试。"
          : "保存任务失败，请稍后重试。",
      },
    }, 500);
  }
}
