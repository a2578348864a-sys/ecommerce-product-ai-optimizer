import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticated } from "@/lib/server/accessContext";
import {
  analyzeOpportunities,
  type OpportunityAnalysisErrorCode,
} from "@/lib/server/opportunityAnalysis";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Spike 输入很小：方向 + 市场 + 限制条件。 */
const REQUEST_BODY_LIMIT_BYTES = 8 * 1024;

type ApiError = {
  code: OpportunityAnalysisErrorCode;
  message: string;
  /** AI 失败一律可重试；前端据此显示「重试」而不是死路。 */
  recoverable: boolean;
};

type ApiResponse =
  | {
      ok: true;
      category: string;
      marketplace: string;
      generatedAt: string;
      candidates: unknown[];
    }
  | { ok: false; error: ApiError };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorStatus(code: OpportunityAnalysisErrorCode): number {
  if (code === "ai_unavailable") return 502;
  if (code === "insufficient_candidates") return 502;
  return 400;
}

/**
 * POST /api/opportunity-analysis
 * 输入：{ category, marketplace?, constraints? }
 * 输出：{ ok: true, category, marketplace, generatedAt, candidates: [{ title, reason, painPoints, validationNeeded }] }
 *
 * V0：不接任何外部数据源，只调用现有 AI Provider 生成"值得研究的候选方向"。
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return json({
      ok: false,
      error: { code: "invalid_category", message: "请求体过大，请缩短商品方向或限制条件。", recoverable: false },
    }, 400);
  }

  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    return json({
      ok: false,
      error: { code: "invalid_category", message: "无法读取请求体，请刷新页面后重试。", recoverable: true },
    }, 400);
  }

  if (new TextEncoder().encode(rawText).length > REQUEST_BODY_LIMIT_BYTES) {
    return json({
      ok: false,
      error: { code: "invalid_category", message: "请求体过大，请缩短商品方向或限制条件。", recoverable: false },
    }, 400);
  }

  let rawBody: unknown = {};
  try {
    rawBody = rawText ? JSON.parse(rawText) : {};
  } catch {
    return json({
      ok: false,
      error: { code: "invalid_category", message: "请求体不是合法 JSON。", recoverable: false },
    }, 400);
  }

  const auth = requireAuthenticated(request, isRecord(rawBody) ? rawBody : undefined);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_category", message: auth.message, recoverable: true } },
      { status: auth.status },
    );
  }

  const outcome = await analyzeOpportunities(rawBody);
  if (!outcome.ok) {
    return json(
      { ok: false, error: { code: outcome.code, message: outcome.message, recoverable: true } },
      errorStatus(outcome.code),
    );
  }

  return json({
    ok: true,
    category: outcome.input.category,
    marketplace: outcome.input.marketplace,
    generatedAt: new Date().toISOString(),
    candidates: outcome.candidates,
  });
}
