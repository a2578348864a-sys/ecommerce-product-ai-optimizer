/**
 * V3 Final Interaction Correction — R5：classifyResearchLifecycle 测试
 */
import { describe, expect, it } from "vitest";
import { classifyResearchLifecycle, isActiveResearch, isHistoricalResearch } from "@/lib/researchLifecycle";

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
