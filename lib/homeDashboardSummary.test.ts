import { describe, expect, it } from "vitest";
import {
  getRecommendedNextAction,
  parseRecentSingleRun,
  summarizeCandidatePool,
  summarizeTaskFollowUp,
} from "@/lib/homeDashboardSummary";
import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";

function candidate(overrides: Partial<OpportunityCandidatePoolItem>): OpportunityCandidatePoolItem {
  return {
    id: "c-1",
    identitySource: "local_draft",
    sourceIntegrity: "unverified",
    name: "桌面手机支架",
    rawInput: "桌面手机支架",
    link: null,
    score: 88,
    source: "机会雷达",
    keyword: "",
    riskLevel: "green",
    riskLabel: "低风险",
    summaryLabel: "可继续",
    candidateStatus: "pending",
    createdAt: 1,
    updatedAt: 1,
    lastActionAt: null,
    ...overrides,
  };
}

describe("homeDashboardSummary", () => {
  it("summarizes candidate pool statuses", () => {
    const summary = summarizeCandidatePool([
      candidate({ id: "a", candidateStatus: "worth_analyzing" }),
      candidate({ id: "b", candidateStatus: "paused" }),
      candidate({ id: "c", candidateStatus: "pending", riskLevel: "red" }),
      candidate({ id: "d", candidateStatus: "analyzed" }),
    ]);

    expect(summary).toEqual({
      total: 4,
      worthAnalyzing: 1,
      pausedOrHighRisk: 2,
      pending: 1,
      analyzed: 1,
      rejected: 0,
    });
  });

  it("summarizes pending review and followable tasks", () => {
    const summary = summarizeTaskFollowUp([
      {
        type: "workflow",
        title: "收纳盒",
        decisionStatus: "pending",
        result: { finalReport: { riskLevel: "green", finalVerdict: "可小单测试", beginnerFit: "适合新手", canTestSmallBatch: true, nextSteps: ["复核供应商"] } },
      },
      {
        type: "workflow",
        title: "桌面灯",
        decisionStatus: "continue",
        result: { finalReport: { riskLevel: "green", finalVerdict: "可继续", beginnerFit: "适合新手", canTestSmallBatch: true, nextSteps: ["核价"] } },
      },
    ]);

    expect(summary.total).toBe(2);
    expect(summary.pendingReview).toBe(1);
    expect(summary.followable).toBe(2);
  });

  it("parses recent unsaved single run safely", () => {
    const recent = parseRecentSingleRun(JSON.stringify({
      version: 1,
      updatedAt: 100,
      value: {
        completedAt: 90,
        productName: "折叠收纳盒",
        result: { productName: "折叠收纳盒" },
        savedTaskId: null,
      },
    }), 100);

    expect(recent).toEqual({
      productName: "折叠收纳盒",
      completedAt: 90,
      hasResult: true,
      savedTaskId: null,
    });
    expect(parseRecentSingleRun("{bad json")).toBeNull();
  });

  it("ignores expired recent single run storage", () => {
    const now = 10 * 60 * 60 * 1000;
    const recent = parseRecentSingleRun(JSON.stringify({
      version: 1,
      updatedAt: 1,
      value: {
        completedAt: 1,
        productName: "很久以前的商品",
        result: { productName: "很久以前的商品" },
        savedTaskId: null,
      },
    }), now);

    expect(recent).toBeNull();
  });

  it("prioritizes candidate pool, then tasks, then unsaved recent analysis, then new user", () => {
    const emptyCandidate = summarizeCandidatePool([]);
    const emptyTasks = summarizeTaskFollowUp([]);

    expect(getRecommendedNextAction({
      candidatePool: { ...emptyCandidate, worthAnalyzing: 2 },
      tasks: { ...emptyTasks, pendingReview: 3 },
      recentSingleRun: { productName: "灯", completedAt: 1, hasResult: true, savedTaskId: null },
    }).priority).toBe("candidate_pool");

    expect(getRecommendedNextAction({
      candidatePool: emptyCandidate,
      tasks: { ...emptyTasks, pendingReview: 1 },
      recentSingleRun: { productName: "灯", completedAt: 1, hasResult: true, savedTaskId: null },
    }).priority).toBe("tasks");

    expect(getRecommendedNextAction({
      candidatePool: emptyCandidate,
      tasks: emptyTasks,
      recentSingleRun: { productName: "灯", completedAt: 1, hasResult: true, savedTaskId: null },
    }).priority).toBe("recent_analysis");

    expect(getRecommendedNextAction({
      candidatePool: emptyCandidate,
      tasks: null,
      recentSingleRun: null,
    }).priority).toBe("new_user");
  });
});
