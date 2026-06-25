import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import { createInitialProductLifecycle } from "@/lib/workflowLifecycle";

export const runtime = "nodejs";

/* ── Types ─────────────────────────────────────── */

type ApiResponse =
  | { ok: true; data: { id: string; title: string; type: string; allReviewed: boolean } }
  | { ok: false; error: { code: string; message: string } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

/* ── Helpers ───────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  opportunityTitle: string;
  opportunitySource?: string;
  opportunityScore?: number;
  keyword?: string;
  importedAt: string;
  /** Phase 4-E.1: enhanced candidate context */
  candidateType?: string;
  sourceUrl?: string;
  candidateId?: string;
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

  return {
    source: "opportunity",
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(score !== null ? { opportunityScore: score } : {}),
    ...(keyword ? { keyword } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
    importedAt,
  };
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

  // Access password
  const passwordResult = checkAccessPassword(request, body as Record<string, unknown>);
  if (passwordResult) {
    return NextResponse.json(
      { ok: false, error: { code: "unauthorized", message: "访问密码错误或缺失。" } },
      { status: passwordResult.status },
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

  const finalVerdict = asString(finalReport.finalVerdict, "未评级");
  const riskLevel = asString(finalReport.riskLevel, "yellow");
  const score = workflowScoreFromRiskLevel(riskLevel);

  // Parse and validate reviewState
  const reviewState = parseReviewState(body.reviewState);
  const batchMeta = parseBatchMeta(body.batchMeta);
  const sourceMeta = parseSourceMeta(body.sourceMeta, productName);

  // Build a structured result for the task record
  const taskResult = {
    type: "workflow",
    workflowId: asString(workflowResult.workflowId),
    productName,
    status: asString(workflowResult.status),
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
    // Phase 4-E.2.1: initialize product lifecycle
    productLifecycle: createInitialProductLifecycle(),
    // Phase Profit-M.1: optional profit snapshot from in-line estimate card
    ...(isRecord(body.profitSnapshot) ? { profitSnapshot: body.profitSnapshot } : {}),
  };

  try {
    const record = await prisma.viralAnalysisRecord.create({
      data: {
        type: "workflow",
        title: `${productName} 一键分析`,
        platform: "manual",
        productUrl: null,
        materialText: productName,
        source: "ai",
        score,
        level: riskLevel,
        oneLineSummary: finalVerdict,
        resultJson: JSON.stringify(taskResult),
      },
    });

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
