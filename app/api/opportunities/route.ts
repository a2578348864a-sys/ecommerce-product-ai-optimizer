import { NextRequest, NextResponse } from "next/server";
import {
  getOpportunityDisplayRiskLevel,
  OPPORTUNITY_AI_CALLS_PER_CANDIDATE,
  OPPORTUNITY_AI_CALL_TIMEOUT_MS,
  runOpportunitiesPipeline,
  type OpportunitiesResult,
  type ProductCandidate,
} from "@/lib/agents/orchestrator";
import {
  reserveDemoAiCalls,
  markDemoAiProviderCallStarted,
  requireAuthenticated,
  settleDemoAiCalls,
  type DemoAiQuotaReservation,
  type DemoAccessSnapshot,
} from "@/lib/server/demoGuard";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for batch processing

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const QUOTA_LEASE_BUFFER_MS = 60 * 1000;

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
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

  let quotaReservation: DemoAiQuotaReservation | null = null;
  if (auth.context.mode === "demo") {
    const plannedCount = lines.length * OPPORTUNITY_AI_CALLS_PER_CANDIDATE;
    const quota = reserveDemoAiCalls(auth.context, plannedCount, {
      leaseMs: plannedCount * OPPORTUNITY_AI_CALL_TIMEOUT_MS + QUOTA_LEASE_BUFFER_MS,
    });
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
    quotaReservation = quota.reservation;
  }

  let result: OpportunitiesResult;
  let providerCallStartedBeforeFailure = 0;
  try {
    result = await runOpportunitiesPipeline(rawText, {
      onProviderCallStarted: async () => {
        const nextStartedCount = providerCallStartedBeforeFailure + 1;
        const marked = markDemoAiProviderCallStarted(auth.context, quotaReservation, nextStartedCount);
        if (!marked.ok) throw new Error(marked.code);
        providerCallStartedBeforeFailure = nextStartedCount;
      },
    });
  } catch (error) {
    if (auth.context.mode === "demo") {
      const settlement = settleDemoAiCalls(
        auth.context,
        quotaReservation,
        providerCallStartedBeforeFailure,
      );
      if (!settlement.ok) {
        return jsonResponse(
          { ok: false, error: { code: settlement.code, message: settlement.message } },
          settlement.status,
        );
      }
    }
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
    const settlement = settleDemoAiCalls(
      auth.context,
      quotaReservation,
      result.providerCallStartedCount,
    );
    if (!settlement.ok) {
      return jsonResponse(
        { ok: false, error: { code: settlement.code, message: settlement.message } },
        settlement.status,
      );
    }
    demoAccess = settlement.snapshot;
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
      } : {}),
    },
    ...(demoAccess ? { demoAccess } : {}),
  });
}
