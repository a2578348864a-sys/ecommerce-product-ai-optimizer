import { describe, expect, it } from "vitest";
import { deriveAgentNextStepPanelState } from "@/components/agentNextStepPanelModel";

const baseResult = {
  finalReport: {
    riskLevel: "green",
    canTestSmallBatch: true,
    nextSteps: ["联系 2-3 家供应商对比样品和报价", "小单测试（10-30 件）"],
    manualReviewChecklist: ["确认平台规则", "确认认证文件"],
  },
};

const completedReviewState = {
  sourcingReviewed: true,
  riskReviewed: true,
  summaryReviewed: true,
  listingReviewed: true,
  totalReviewSteps: 4,
};

describe("deriveAgentNextStepPanelState", () => {
  it("未完成人工复核时不提示直接推进", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "pending",
      result: {
        ...baseResult,
        reviewState: {
          sourcingReviewed: true,
          riskReviewed: false,
          summaryReviewed: false,
          listingReviewed: false,
          totalReviewSteps: 4,
        },
      },
    });

    expect(state.stageLabel).toBe("待人工复核");
    expect(state.agentStatus.key).toBe("needs_review");
    expect(state.agentStatus.label).toBe("待复核");
    expect(state.primarySuggestion).toContain("先完成 4 步人工复核");
    expect(state.nextActions.join("\n")).not.toContain("小单测试计划");
  });

  it("高风险结果不提示小单测试", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "continue",
      result: {
        finalReport: {
          riskLevel: "red",
          canTestSmallBatch: true,
          nextSteps: ["小单测试（10-30 件）"],
          manualReviewChecklist: ["复核侵权风险"],
        },
        reviewState: completedReviewState,
      },
    });

    expect(state.riskLevel).toBe("red");
    expect(state.stageLabel).toBe("高风险需复查");
    expect(state.agentStatus.key).toBe("needs_info");
    expect(state.agentStatus.label).not.toContain("推进");
    expect(state.primarySuggestion).toContain("高风险结果不建议小单测试");
    expect(state.nextActions.join("\n")).toContain("不要做小单测试");
  });

  it("低风险且复核完成时只提示人工决定小单测试", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "pending",
      result: {
        ...baseResult,
        reviewState: completedReviewState,
      },
    });

    expect(state.stageLabel).toBe("待人工决策");
    expect(state.agentStatus.key).toBe("needs_decision");
    expect(state.primarySuggestion).toContain("可人工决定是否做小单测试");
    expect(state.primarySuggestion).not.toContain("系统会自动");
  });

  it("复核完成且人工标记继续时显示可人工推进", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "continue",
      result: {
        ...baseResult,
        reviewState: completedReviewState,
      },
    });

    expect(state.stageLabel).toBe("可人工推进");
    expect(state.agentStatus.key).toBe("can_continue");
    expect(state.agentStatus.label).toBe("可人工推进");
    expect(state.agentStatus.description).toContain("不会自动执行");
  });

  it("人工标记需补资料时归为需补资料", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "need_info",
      result: {
        ...baseResult,
        reviewState: completedReviewState,
      },
    });

    expect(state.agentStatus.key).toBe("needs_info");
    expect(state.agentStatus.label).toBe("需补资料");
  });

  it("人工标记淘汰时归为已淘汰", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "rejected",
      result: {
        ...baseResult,
        reviewState: completedReviewState,
      },
    });

    expect(state.agentStatus.key).toBe("rejected");
    expect(state.agentStatus.label).toBe("已淘汰");
  });

  it("缺少 reviewState 时显示缺少复核状态", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "workflow",
      decisionStatus: "pending",
      result: baseResult,
    });

    expect(state.reviewState.exists).toBe(false);
    expect(state.agentStatus.key).toBe("missing_review_state");
    expect(state.agentStatus.label).toBe("缺少复核状态");
  });

  it("非 workflow 类型不包装成完整 Agent 状态", () => {
    const state = deriveAgentNextStepPanelState({
      taskType: "risk",
      decisionStatus: "pending",
      result: {
        ...baseResult,
        reviewState: completedReviewState,
      },
    });

    expect(state.agentStatus.key).toBe("non_agent");
    expect(state.agentStatus.label).toBe("普通任务");
  });
});
