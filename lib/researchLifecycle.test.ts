/**
 * V3 Final Interaction Correction — R5：classifyResearchLifecycle 测试
 */
import { describe, expect, it } from "vitest";
import { classifyResearchLifecycle, deriveProductProjectGroup, isActiveResearch, isHistoricalResearch } from "@/lib/researchLifecycle";

function versionedResult(decisionStatus: string) {
  return {
    researchRecord: {
      schema: "product-research-record.v1",
      revision: 1,
      researchHash: "a".repeat(64),
      candidateId: "candidate-x",
      runId: "run-1",
      contextHash: "b".repeat(64),
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:00:00.000Z",
      latestDecision: { decisionId: "d1", revision: 1, status: decisionStatus, reason: "r", nextAction: null, researchHash: "a".repeat(64), decidedAt: "2026-08-16T00:00:00.000Z", actor: { mode: "owner", actorRef: "owner:v1" } },
      decisionEvents: [],
    },
  };
}

describe("classifyResearchLifecycle（R5 统一分类器）", () => {
  it("新版 record：creative_ready / needs_information → active", () => {
    expect(classifyResearchLifecycle({ decisionStatus: "pending", result: versionedResult("creative_ready") }).lifecycle).toBe("active");
    expect(classifyResearchLifecycle({ decisionStatus: "pending", result: versionedResult("creative_ready") }).detail).toBe("active_creative");
    expect(classifyResearchLifecycle({ decisionStatus: "pending", result: versionedResult("needs_information") }).detail).toBe("active_need_info");
  });

  it("新版 record：abandoned → historical", () => {
    const classified = classifyResearchLifecycle({ decisionStatus: "pending", result: versionedResult("abandoned") });
    expect(classified.lifecycle).toBe("historical");
    expect(classified.detail).toBe("historical_abandoned");
  });

  it("旧版：pending/continue/need_info → active；rejected → historical", () => {
    expect(classifyResearchLifecycle({ decisionStatus: "pending", result: null }).lifecycle).toBe("active");
    expect(classifyResearchLifecycle({ decisionStatus: "continue", result: null }).lifecycle).toBe("active");
    expect(classifyResearchLifecycle({ decisionStatus: "need_info", result: null }).lifecycle).toBe("active");
    const rejected = classifyResearchLifecycle({ decisionStatus: "rejected", result: null });
    expect(rejected.lifecycle).toBe("historical");
    expect(rejected.detail).toBe("historical_abandoned");
  });

  it("无活跃决定语义的旧版历史批次 → historical（不污染 active 列表）", () => {
    const classified = classifyResearchLifecycle({ decisionStatus: "unknown_status", result: null, type: "candidate_research" });
    expect(classified.lifecycle).toBe("historical");
    expect(classified.detail).toBe("historical_legacy");
  });

  it("V3 Current Research Normalization：researchCompletion 完成标记优先 → historical_completed / historical_abandoned", () => {
    const completed = {
      ...versionedResult("creative_ready"),
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-08-17T00:00:00.000Z",
        decisionId: "d1",
        revision: 1,
        finalStatus: "creative_ready",
      },
    };
    expect(classifyResearchLifecycle({ decisionStatus: "continue", result: completed }).lifecycle).toBe("historical");
    expect(classifyResearchLifecycle({ decisionStatus: "continue", result: completed }).detail).toBe("historical_completed");
    expect(isHistoricalResearch({ decisionStatus: "continue", result: completed })).toBe(true);
    expect(isActiveResearch({ decisionStatus: "continue", result: completed })).toBe(false);

    const abandoned = {
      ...versionedResult("abandoned"),
      researchCompletion: {
        schema: "research-completion.v1",
        status: "abandoned",
        completedAt: "2026-08-17T00:00:00.000Z",
        decisionId: "d1",
        revision: 1,
        finalStatus: "abandoned",
      },
    };
    expect(classifyResearchLifecycle({ decisionStatus: "pending", result: abandoned }).detail).toBe("historical_abandoned");
  });

  it("isActiveResearch / isHistoricalResearch 便捷判定", () => {
    expect(isActiveResearch({ decisionStatus: "continue", result: null })).toBe(true);
    expect(isHistoricalResearch({ decisionStatus: "rejected", result: null })).toBe(true);
    expect(isActiveResearch({ decisionStatus: "rejected", result: null })).toBe(false);
  });
});


describe("轮 6 共享状态分类器（/ 与 /research 同一口径）", () => {
  const r = (over: Record<string, unknown>) => ({ aiRunStatus: undefined as string | undefined, decisionStatus: "pending" as const, result: {} as Record<string, unknown>, oneLineSummary: "", ...over }) as { aiRunStatus?: string | null; decisionStatus: "pending" | "continue" | "need_info" | "rejected"; result: unknown; oneLineSummary: string };
  const completedResult = {
    productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready", label: "研究已完成" },
  };

  it("not_started 绝不算 AI 研究中：缺资料/待决定/失败/取消全部落在需要我处理", () => {
    expect(deriveProductProjectGroup(r({ aiRunStatus: "not_started" })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: undefined })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "cancelled" })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "failed_terminal" })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "failed_recoverable" })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "waiting" })).group).toBe("needs_action");
  });

  it("running/waiting 之外的 run 状态：只有 running 归 AI 研究中", () => {
    expect(deriveProductProjectGroup(r({ aiRunStatus: "running" })).group).toBe("researching");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "completed", result: completedResult })).group).toBe("completed");
  });

  it("终态失败优先：即使已保存研究与人工决定也不落入已完成", () => {
    expect(deriveProductProjectGroup(r({ aiRunStatus: "failed_terminal", decisionStatus: "continue", result: completedResult })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ aiRunStatus: "cancelled", decisionStatus: "continue", result: completedResult })).group).toBe("needs_action");
  });

  it("stale 最高优先级", () => {
    expect(deriveProductProjectGroup(r({ aiRunStatus: "research_stale", result: completedResult })).group).toBe("needs_action");
  });

  it("待人工决定（已有研究但无正式决定）/ 缺资料 → 需要我处理；完整保存→已完成", () => {
    expect(deriveProductProjectGroup(r({ result: { finalReport: { finalVerdict: "x" } } })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ result: {} })).group).toBe("needs_action");
    expect(deriveProductProjectGroup(r({ result: completedResult })).group).toBe("completed");
  });
});
