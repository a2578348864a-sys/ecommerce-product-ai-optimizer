import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { getOpportunityDisplayRiskLevel, runOpportunitiesPipeline } from "@/lib/agents/orchestrator";
import { requireAuthenticated } from "@/lib/server/demoGuard";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for batch processing

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({ ok: false, error: { code: "body_too_large", message: "请求体过大。" } }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求格式不正确。" } }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  const bodyObj = body as Record<string, unknown>;

  const auth = requireAuthenticated(request, bodyObj);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }

  const rawText = asString(bodyObj.rawText);
  if (!rawText) {
    return jsonResponse({ ok: false, error: { code: "missing_input", message: "请输入候选商品列表。" } }, 400);
  }

  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 30) {
    return jsonResponse({
      ok: false,
      error: { code: "too_many", message: `每次最多分析 30 个候选品，当前输入 ${lines.length} 个。` },
    }, 400);
  }

  // Run the pipeline
  let result;
  try {
    result = await runOpportunitiesPipeline(rawText);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: {
        code: "pipeline_error",
        message: error instanceof Error ? error.message : "机会雷达分析失败。",
      },
    }, 500);
  }

  // Save a summary task record
  try {
    const topCandidate = result.candidates[0];
    const leaderboardSummary = result.candidates.slice(0, 10).map((c, i) =>
      `${i + 1}. [${c.levelLabel}] ${c.name}（${c.score}分）- ${c.reasons.slice(0, 2).join("，") || "暂无摘要"}`
    ).join("\n");

    await prisma.viralAnalysisRecord.create({
      data: {
        type: "opportunities",
        title: `机会雷达 · ${result.totalCount} 个候选品`,
        platform: "manual",
        productUrl: null,
        materialText: rawText.slice(0, 2000),
        source: "ai",
        score: topCandidate?.score ?? 0,
        level: topCandidate?.levelLabel ?? "未评级",
        oneLineSummary: `分析 ${result.totalCount} 个候选品，${result.completedCount} 完成，${result.failedCount} 失败。最高分：${topCandidate?.name ?? "无"}（${topCandidate?.score ?? 0}分）`,
        resultJson: JSON.stringify({
          leaderboard: leaderboardSummary,
          candidates: result.candidates.map((c) => ({
            name: c.name,
            rawInput: c.rawInput,
            status: c.status,
            score: c.score,
            level: c.level,
            levelLabel: c.levelLabel,
            displayRiskLevel: c.displayRiskLevel ?? getOpportunityDisplayRiskLevel(c),
            reasons: c.reasons,
            risks: c.risks,
            nextAction: c.nextAction,
            sourcingSummary: c.sourcing?.summary,
            riskSummary: c.risk?.summary,
            summaryVerdict: c.summary?.verdict,
          })),
        }),
      },
    });
  } catch {
    // Task save failure is non-fatal — still return results
  }

  return jsonResponse({
    ok: true,
    data: {
      candidates: result.candidates.map((c) => ({
        index: c.index,
        name: c.name,
        rawInput: c.rawInput,
        link: c.link,
        status: c.status,
        errorMessage: c.errorMessage,
        score: c.score,
        level: c.level,
        levelLabel: c.levelLabel,
        reasons: c.reasons,
        risks: c.risks,
        nextAction: c.nextAction,
        sourcing: c.sourcing ? {
          feasibility: c.sourcing.feasibility,
          summary: c.sourcing.summary,
          searchKeywords: c.sourcing.searchKeywords,
          moqEstimate: c.sourcing.moqEstimate,
          beginnerFriendly: c.sourcing.beginnerFriendly,
          beginnerFit: c.sourcing.beginnerFit,
        } : null,
        risk: c.risk ? {
          overallLevel: c.risk.overallLevel,
          displayLevel: c.displayRiskLevel ?? getOpportunityDisplayRiskLevel(c),
          summary: c.risk.summary,
          blacklistMatches: c.risk.blacklistMatches,
        } : null,
        summary: c.summary ? {
          verdict: c.summary.verdict,
          confidence: c.summary.confidence,
          summary: c.summary.summary,
          reasons: c.summary.reasons,
          risks: c.summary.risks,
          nextSteps: c.summary.nextSteps,
          beginnerTip: c.summary.beginnerTip,
          downgraded: c.summary.downgraded,
          downgradeReasons: c.summary.downgradeReasons,
        } : null,
      })),
      totalCount: result.totalCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
    },
  });
}
