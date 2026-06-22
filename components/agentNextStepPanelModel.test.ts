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

describe("deriveAgentNextStepPanelState", () => {
  it("未完成人工复核时不提示直接推进", () => {
    const state = deriveAgentNextStepPanelState({
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
    expect(state.primarySuggestion).toContain("先完成 4 步人工复核");
    expect(state.nextActions.join("\n")).not.toContain("小单测试计划");
  });

  it("高风险结果不提示小单测试", () => {
    const state = deriveAgentNextStepPanelState({
      decisionStatus: "continue",
      result: {
        finalReport: {
          riskLevel: "red",
          canTestSmallBatch: true,
          nextSteps: ["小单测试（10-30 件）"],
          manualReviewChecklist: ["复核侵权风险"],
        },
        reviewState: {
          sourcingReviewed: true,
          riskReviewed: true,
          summaryReviewed: true,
          listingReviewed: true,
          totalReviewSteps: 4,
        },
      },
    });

    expect(state.riskLevel).toBe("red");
    expect(state.primarySuggestion).toContain("高风险结果不建议小单测试");
    expect(state.nextActions.join("\n")).toContain("不要做小单测试");
  });

  it("低风险且复核完成时只提示人工决定小单测试", () => {
    const state = deriveAgentNextStepPanelState({
      decisionStatus: "pending",
      result: {
        ...baseResult,
        reviewState: {
          sourcingReviewed: true,
          riskReviewed: true,
          summaryReviewed: true,
          listingReviewed: true,
          totalReviewSteps: 4,
        },
      },
    });

    expect(state.stageLabel).toBe("待人工决策");
    expect(state.primarySuggestion).toContain("可人工决定是否做小单测试");
    expect(state.primarySuggestion).not.toContain("系统会自动");
  });
});
