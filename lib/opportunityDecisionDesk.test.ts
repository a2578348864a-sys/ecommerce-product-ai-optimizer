import { describe, expect, it } from "vitest";
import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";
import {
  buildDecisionDeskSummary,
  createLatestRequestGuard,
  getDecisionDeskEvidencePresentation,
  getDecisionDeskMarketPresentation,
  getDecisionDeskRiskPresentation,
  getDecisionDeskScorePresentation,
  runLatestRequest,
  resolveDecisionDeskSelection,
} from "@/lib/opportunityDecisionDesk";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

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

    expect(getDecisionDeskRiskPresentation(candidate("legacy-green", {
      riskLevel: "green",
      riskLabel: "低风险",
      evidenceSnapshot: evidenceWithFlags([]),
    }))).toEqual({
      label: "未确认",
      tone: "neutral",
    });
  });

  it("accepts only the newest server refresh result", () => {
    const guard = createLatestRequestGuard();
    const olderRequest = guard.begin();
    const newerRequest = guard.begin();

    expect(guard.isCurrent(olderRequest)).toBe(false);
    expect(guard.isCurrent(newerRequest)).toBe(true);
  });

  it("keeps a newer success when an older success resolves later", async () => {
    const guard = createLatestRequestGuard();
    const older = deferred<string>();
    const newer = deferred<string>();
    const visible: string[] = [];
    const run = (promise: Promise<string>) => runLatestRequest(guard, () => promise, {
      onSuccess: (value) => visible.push(value),
    });

    const olderRun = run(older.promise);
    const newerRun = run(newer.promise);
    newer.resolve("newer");
    await newerRun;
    older.resolve("older");
    await olderRun;
    expect(visible).toEqual(["newer"]);
  });

  it("does not let an older failure roll back a newer success", async () => {
    const guard = createLatestRequestGuard();
    const older = deferred<string>();
    const newer = deferred<string>();
    const states: string[] = [];
    const run = (promise: Promise<string>) => runLatestRequest(guard, () => promise, {
      onSuccess: (value) => states.push(`success:${value}`),
      onError: () => states.push("fallback"),
    });

    const olderRun = run(older.promise);
    const newerRun = run(newer.promise);
    newer.resolve("newer");
    await newerRun;
    older.reject(new Error("old failure"));
    await olderRun;
    expect(states).toEqual(["success:newer"]);
  });

  it("keeps the newest failure when an older success resolves later", async () => {
    const guard = createLatestRequestGuard();
    const older = deferred<string>();
    const newer = deferred<string>();
    const states: string[] = [];
    const run = (promise: Promise<string>) => runLatestRequest(guard, () => promise, {
      onSuccess: (value) => states.push(`success:${value}`),
      onError: () => states.push("newest-failure"),
    });

    const olderRun = run(older.promise);
    const newerRun = run(newer.promise);
    newer.reject(new Error("new failure"));
    await newerRun;
    older.resolve("older");
    await olderRun;
    expect(states).toEqual(["newest-failure"]);
  });

  it("ignores success, failure, and finally callbacks after unmount", async () => {
    const guard = createLatestRequestGuard();
    const pending = deferred<string>();
    const callbacks: string[] = [];
    const running = runLatestRequest(guard, () => pending.promise, {
      onSuccess: () => callbacks.push("success"),
      onError: () => callbacks.push("error"),
      onSettled: () => callbacks.push("settled"),
    });
    guard.invalidate();
    pending.resolve("late");
    await running;
    expect(callbacks).toEqual([]);
  });

  it("does not let an older request end loading while the newest request is pending", async () => {
    const guard = createLatestRequestGuard();
    const older = deferred<string>();
    const newer = deferred<string>();
    let loading = false;
    const run = (promise: Promise<string>) => runLatestRequest(guard, () => promise, {
      onStart: () => { loading = true; },
      onSettled: () => { loading = false; },
    });

    const olderRun = run(older.promise);
    const newerRun = run(newer.promise);
    older.resolve("older");
    await olderRun;
    expect(loading).toBe(true);
    newer.resolve("newer");
    await newerRun;
    expect(loading).toBe(false);
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
