import { describe, expect, it } from "vitest";
import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";
import {
  buildDecisionDeskSummary,
  getDecisionDeskEvidencePresentation,
  getDecisionDeskMarketPresentation,
  getDecisionDeskRiskPresentation,
  getDecisionDeskScorePresentation,
  resolveDecisionDeskSelection,
} from "@/lib/opportunityDecisionDesk";

function marketSnapshot(
  candidateId: string,
  marketDecision: "market_shortlisted" | "market_watch" | "market_reject" | "insufficient_market_data",
) {
  const insufficient = marketDecision === "insufficient_market_data";
  return {
    schemaVersion: "r22-market-decision-v1" as const,
    evidenceVersion: "r22-evidence-semantics-v1" as const,
    candidateId,
    asin: `ASIN-${candidateId}`,
    briefId: "A" as const,
    frozenRank: 1,
    marketDecision,
    decisionReasons: ["fixture_reason"],
    supportingEvidenceRefs: insufficient ? [] : ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: insufficient ? ["customerProof"] : [],
    dataCompleteness: insufficient ? 0.5 : 1,
    confidence: insufficient ? "low" as const : "high" as const,
    stabilityStatus: "stable" as const,
    ruleVersion: "r22-stage1-market-v1" as const,
    inputHash: "a".repeat(64),
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

function evidenceWithFlags(riskFlags: string[]) {
  return {
    version: 1 as const,
    sourceType: "public_page",
    sourceName: "fixture",
    sourceUrl: "https://example.com/item",
    evidenceItems: ["product_page"],
    extractionSignals: ["url_available"],
    qualityScore: 80,
    confidence: "high" as const,
    riskFlags,
    decision: "cautious" as const,
    decisionReason: "fixture",
    nextAction: "review",
    generatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function candidate(
  id: string,
  overrides: Partial<OpportunityCandidatePoolItem> = {},
): OpportunityCandidatePoolItem {
  return {
    id,
    identitySource: "server",
    sourceIntegrity: "unverified",
    name: `Candidate ${id}`,
    rawInput: `Candidate ${id}`,
    link: `https://example.com/${id}`,
    score: 60,
    source: "Amazon",
    keyword: "organizer",
    riskLevel: "",
    riskLabel: "",
    summaryLabel: "市场信号待复核",
    candidateStatus: "pending",
    createdAt: 1,
    updatedAt: 2,
    lastActionAt: null,
    ...overrides,
  };
}

describe("opportunity decision desk presentation", () => {
  it("counts queue states without treating converted candidates as analyzing", () => {
    const items = [
      candidate("pending"),
      candidate("analysis", { candidateStatus: "worth_analyzing" }),
      candidate("converted", { candidateStatus: "analyzed", convertedTaskId: "task-1" }),
    ];

    expect(buildDecisionDeskSummary(items)).toEqual({
      all: 3,
      pending: 1,
      worthAnalyzing: 1,
      analyzing: 0,
      converted: 1,
    });
  });

  it("keeps explicit high risk even when the snapshot has no risk flags", () => {
    expect(getDecisionDeskRiskPresentation(candidate("risk", {
      riskLevel: "red",
      riskLabel: "高风险",
    }))).toEqual({ label: "高风险", tone: "danger" });
  });

  it("uses the frozen Stage 1 snapshot instead of Candidate lifecycle status", () => {
    expect(getDecisionDeskMarketPresentation(candidate("shortlisted", {
      candidateStatus: "pending",
      r22MarketDecisionSnapshot: marketSnapshot("shortlisted", "market_shortlisted"),
    }))).toEqual({ label: "晋级", tone: "positive" });
    expect(getDecisionDeskMarketPresentation(candidate("watch", {
      candidateStatus: "worth_analyzing",
      r22MarketDecisionSnapshot: marketSnapshot("watch", "market_watch"),
    }))).toEqual({ label: "观察", tone: "warning" });
    expect(getDecisionDeskMarketPresentation(candidate("reject", {
      candidateStatus: "analyzed",
      r22MarketDecisionSnapshot: marketSnapshot("reject", "market_reject"),
    }))).toEqual({ label: "拒绝", tone: "danger" });
    expect(getDecisionDeskMarketPresentation(candidate("insufficient", {
      r22MarketDecisionSnapshot: marketSnapshot("insufficient", "insufficient_market_data"),
    }))).toEqual({ label: "数据不足", tone: "neutral" });
    expect(getDecisionDeskMarketPresentation(candidate("missing"))).toEqual({
      label: "尚未评估",
      tone: "neutral",
    });
  });

  it("promotes explicit high-risk flags to the highest deterministic risk", () => {
    expect(getDecisionDeskRiskPresentation(candidate("flagged", {
      evidenceSnapshot: evidenceWithFlags(["missing_price", "ip_risk"]),
    }))).toEqual({ label: "高风险", tone: "danger" });
    expect(getDecisionDeskRiskPresentation(candidate("caution", {
      evidenceSnapshot: evidenceWithFlags(["battery"]),
    }))).toEqual({ label: "待核对", tone: "warning" });
  });

  it("does not turn missing risk evidence into a low-risk claim", () => {
    expect(getDecisionDeskRiskPresentation(candidate("unknown"))).toEqual({
      label: "未确认",
      tone: "neutral",
    });
  });

  it("distinguishes a legitimate zero score from missing or invalid scores", () => {
    expect(getDecisionDeskScorePresentation(candidate("zero", {
      score: 0,
      scoreAvailable: true,
    }))).toBe("0");
    expect(getDecisionDeskScorePresentation(candidate("missing", {
      score: 0,
      scoreAvailable: false,
    }))).toBe("—");
    expect(getDecisionDeskScorePresentation(candidate("invalid", {
      score: Number.NaN,
      scoreAvailable: true,
    }))).toBe("—");
  });

  it("shows verified and unverified source evidence distinctly", () => {
    expect(getDecisionDeskEvidencePresentation(candidate("verified", {
      sourceIntegrity: "verified_public",
    })).label).toBe("可追溯");
    expect(getDecisionDeskEvidencePresentation(candidate("unverified")).label).toBe("来源待复核");
  });

  it("keeps the selected visible candidate and otherwise selects the first visible row", () => {
    const items = [candidate("a"), candidate("b")];
    expect(resolveDecisionDeskSelection(items, "b")?.id).toBe("b");
    expect(resolveDecisionDeskSelection(items, "missing")?.id).toBe("a");
    expect(resolveDecisionDeskSelection([], "a")).toBeNull();
  });
});
