import { NextRequest, NextResponse } from "next/server";

import { requireAuthenticated } from "@/lib/server/accessContext";
import {
  analyzeOpportunities,
  type OpportunityAnalysisErrorCode,
  type OpportunityAutoSignalInfo,
} from "@/lib/server/opportunityAnalysis";
import type { MarketSignalStats } from "@/lib/marketSignal";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * V1 请求体包含真实市场信号原文（上限 12000 字符，中文按 UTF-8 约 36KB），
 * 因此比 V0 的 8KB 放宽到 64KB。
 */
const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

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
      /** V1：真实市场信号是否提供 + 服务端 deterministic 统计（不含 AI 生成的数字） */
      marketSignal: { provided: boolean; stats: MarketSignalStats };
      /** V2：自动信号的来源与检索范围（服务端 deterministic，供前端如实展示） */
      autoSignal: OpportunityAutoSignalInfo;
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
 * 输入：{ category, marketplace?, constraints?, marketSignalText?, autoSignal?, candidateId? }
 * 输出：{ ok: true, category, marketplace, generatedAt, marketSignal, autoSignal, candidates }
 *
 * V1：marketSignalText 为用户提供的真实市场信号（评论 / 竞品反馈 / 关键词），
 * 服务端解析为带编号的信号集合并注入提示词；为空时退化为 V0 行为。
 * V2：autoSignal=true 时，服务端从**已有研究任务**的证据（reviewEvidence /
 * vocAnalysis / keywordEvidence / competitorEvidence）自动读取信号并与手动信号合并。
 * 不抓取外部数据，不写数据库。
 */
export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return json({
      ok: false,
      error: { code: "invalid_category", message: "请求体过大，请缩短商品方向、限制条件或市场信号。", recoverable: false },
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
      error: { code: "invalid_category", message: "请求体过大，请缩短商品方向、限制条件或市场信号。", recoverable: false },
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
    marketSignal: { provided: outcome.marketSignal.provided, stats: outcome.marketSignal.stats },
    autoSignal: outcome.autoSignal,
    candidates: outcome.candidates,
  });
}
