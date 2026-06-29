import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import {
  getOpportunityDisplayRiskLevel,
  runOpportunitiesPipeline,
  type OpportunitiesResult,
  type ProductCandidate,
} from "@/lib/agents/orchestrator";
import {
  consumeDemoAiCalls,
  ensureDemoAiQuota,
  requireAuthenticated,
  type DemoAccessSnapshot,
} from "@/lib/server/demoGuard";
import { createSandboxTask, sandboxTaskToListItem } from "@/lib/server/demoSandbox";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for batch processing

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function candidateSummary(candidate: ProductCandidate) {
  return {
    name: candidate.name,
    rawInput: candidate.rawInput,
    status: candidate.status,
    score: candidate.score,
    level: candidate.level,
    levelLabel: candidate.levelLabel,
    displayRiskLevel: candidate.displayRiskLevel ?? getOpportunityDisplayRiskLevel(candidate),
    reasons: candidate.reasons,
    risks: candidate.risks,
    nextAction: candidate.nextAction,
    sourcingSummary: candidate.sourcing?.summary,
    riskSummary: candidate.risk?.summary,
    summaryVerdict: candidate.summary?.verdict,
  };
}

function buildTaskData(result: OpportunitiesResult, rawText: string) {
  const topCandidate = result.candidates[0];
  const leaderboardSummary = result.candidates.slice(0, 10).map((candidate, index) => {
    const reason = candidate.reasons.slice(0, 2).join("; ") || "No summary";
    return `${index + 1}. [${candidate.levelLabel}] ${candidate.name} (${candidate.score}) - ${reason}`;
  }).join("\n");

  return {
    type: "opportunities",
    title: `Opportunity Radar - ${result.totalCount} candidates`,
    platform: "manual",
    productUrl: null,
    materialText: rawText.slice(0, 2000),
    source: "ai",
    score: topCandidate?.score ?? 0,
    level: topCandidate?.levelLabel ?? "Unrated",
    oneLineSummary: `Analyzed ${result.totalCount} candidates, ${result.completedCount} completed, ${result.failedCount} failed. Top candidate: ${topCandidate?.name ?? "none"} (${topCandidate?.score ?? 0}).`,
    resultJson: JSON.stringify({
      leaderboard: leaderboardSummary,
      candidates: result.candidates.map(candidateSummary),
    }),
  };
}

function responseCandidate(candidate: ProductCandidate) {
  return {
    index: candidate.index,
    name: candidate.name,
    rawInput: candidate.rawInput,
    link: candidate.link,
    status: candidate.status,
    errorMessage: candidate.errorMessage,
    score: candidate.score,
    level: candidate.level,
    levelLabel: candidate.levelLabel,
    reasons: candidate.reasons,
    risks: candidate.risks,
    nextAction: candidate.nextAction,
    sourcing: candidate.sourcing ? {
      feasibility: candidate.sourcing.feasibility,
      summary: candidate.sourcing.summary,
      searchKeywords: candidate.sourcing.searchKeywords,
      moqEstimate: candidate.sourcing.moqEstimate,
      beginnerFriendly: candidate.sourcing.beginnerFriendly,
      beginnerFit: candidate.sourcing.beginnerFit,
    } : null,
    risk: candidate.risk ? {
      overallLevel: candidate.risk.overallLevel,
      displayLevel: candidate.displayRiskLevel ?? getOpportunityDisplayRiskLevel(candidate),
      summary: candidate.risk.summary,
      blacklistMatches: candidate.risk.blacklistMatches,
    } : null,
    summary: candidate.summary ? {
      verdict: candidate.summary.verdict,
      confidence: candidate.summary.confidence,
      summary: candidate.summary.summary,
      reasons: candidate.summary.reasons,
      risks: candidate.summary.risks,
      nextSteps: candidate.summary.nextSteps,
      beginnerTip: candidate.summary.beginnerTip,
      downgraded: candidate.summary.downgraded,
      downgradeReasons: candidate.summary.downgradeReasons,
    } : null,
  };
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > REQUEST_BODY_LIMIT_BYTES) {
    return jsonResponse({ ok: false, error: { code: "body_too_large", message: "Request body is too large." } }, 413);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "Request body must be valid JSON." } }, 400);
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: { code: "invalid_body", message: "Request body must be a JSON object." } }, 400);
  }

  const bodyObj = body as Record<string, unknown>;
  const auth = requireAuthenticated(request, bodyObj);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }

  const rawText = asString(bodyObj.rawText);
  if (!rawText) {
    return jsonResponse({ ok: false, error: { code: "missing_input", message: "Please provide candidate products." } }, 400);
  }

  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length > 30) {
    return jsonResponse({
      ok: false,
      error: { code: "too_many", message: `Analyze at most 30 candidates per run. Current input has ${lines.length}.` },
    }, 400);
  }

  if (auth.context.mode === "demo") {
    const quota = ensureDemoAiQuota(auth.context, 1);
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
  }

  let result: OpportunitiesResult;
  try {
    result = await runOpportunitiesPipeline(rawText);
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: {
        code: "pipeline_error",
        message: error instanceof Error ? error.message : "Opportunity radar analysis failed.",
      },
    }, 500);
  }

  let demoAccess: DemoAccessSnapshot | null = null;
  if (auth.context.mode === "demo") {
    demoAccess = consumeDemoAiCalls(auth.context, 1);
  }

  const taskData = buildTaskData(result, rawText);
  let savedTask: Record<string, unknown> | null = null;

  try {
    if (auth.context.mode === "demo") {
      const sandboxTask = createSandboxTask(auth.context.demoAccessId, taskData);
      savedTask = sandboxTaskToListItem(sandboxTask) as unknown as Record<string, unknown>;
    } else {
      await prisma.viralAnalysisRecord.create({ data: taskData });
    }
  } catch {
    // Task save failure is non-fatal. Still return analysis results.
  }

  return jsonResponse({
    ok: true,
    data: {
      candidates: result.candidates.map(responseCandidate),
      totalCount: result.totalCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      ...(auth.context.mode === "demo" ? {
        isSandbox: true,
        sourceMode: "demo_sandbox",
        savedTask,
      } : {}),
    },
    ...(demoAccess ? { demoAccess } : {}),
  });
}
