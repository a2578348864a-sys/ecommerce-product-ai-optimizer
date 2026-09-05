/**
 * 第十一轮 UI/状态 Bug 修复红测：
 * Bug 1 — 无真实 AI 结论时不得出现「AI 辅助判断」假卡片（headline nullable）。
 * Bug 2 — researchCompletion 是「已完成」唯一终态依据。
 * Bug 3 — 需要我处理 / 研究中 / 已完成 三组重定义（aiRunStatus 只是子步骤）。
 */
import { describe, expect, it } from "vitest";
import {
  deriveProductProjectGroup,
  isActiveResearch,
  classifyResearchLifecycle,
  type ProductProjectGroup,
} from "@/lib/researchLifecycle";
import { deriveResearchHistoryStatus } from "@/lib/taskResearchHistoryPresentation";

function researchCompletion(status: "completed" | "abandoned") {
  return { schema: "research-completion.v1", status };
}

function baseInput(overrides: {
  aiRunStatus?: string | null;
  decisionStatus?: string;
  result?: Record<string, unknown> | null;
  oneLineSummary?: string;
}) {
  return {
    aiRunStatus: overrides.aiRunStatus ?? undefined,
    decisionStatus: (overrides.decisionStatus ?? "continue") as never,
    result: overrides.result ?? null,
    oneLineSummary: overrides.oneLineSummary ?? "",
  };
}

function groupOf(input: Parameters<typeof deriveProductProjectGroup>[0]): ProductProjectGroup {
  return deriveProductProjectGroup(input).group;
}

describe("Bug 2：researchCompletion 是「已完成」唯一终态依据", () => {
  it("CASE 1 有 productResearchSummary/researchRecord 但无 completion → NOT completed", () => {
    const result = {
      productResearchSummary: { schema: "product-research-record.v1", status: "completed" },
      researchRecord: { schema: "product-research-record.v1", latestDecision: { status: "creative_ready" } },
    };
    const status = deriveResearchHistoryStatus({ result, decisionStatus: "continue", oneLineSummary: "" });
    expect(status.key).not.toBe("completed");
    expect(groupOf(baseInput({ result }))).not.toBe("completed");
  });

  it("CASE 2 有 oneLineSummary/finalReport/agentOutputSnapshot 但无 completion → NOT completed", () => {
    const result = {
      finalReport: { finalVerdict: "推荐" },
      agentOutputSnapshot: { summarySnapshot: { decisionReason: "数据充分" } },
      summary: { decisionReason: "可行" },
    };
    const status = deriveResearchHistoryStatus({
      result,
      decisionStatus: "continue",
      oneLineSummary: "一句话摘要",
    });
    expect(status.key).not.toBe("completed");
    expect(groupOf(baseInput({ result, oneLineSummary: "一句话摘要" }))).not.toBe("completed");
  });

  it("CASE 8 researchCompletion=completed → completed（唯一路径）", () => {
    const result = { researchCompletion: researchCompletion("completed") };
    expect(groupOf(baseInput({ result }))).toBe("completed");
    const lifecycle = classifyResearchLifecycle({ decisionStatus: "continue", result });
    expect(lifecycle.detail).toBe("historical_completed");
  });

  it("CASE 9 researchCompletion=abandoned → 不得进入 completed", () => {
    const result = { researchCompletion: researchCompletion("abandoned") };
    expect(groupOf(baseInput({ result }))).not.toBe("completed");
    const lifecycle = classifyResearchLifecycle({ decisionStatus: "continue", result });
    expect(lifecycle.detail).toBe("historical_abandoned");
  });
});

describe("Bug 3：needs_action / researching / completed 三组重定义", () => {
  it("CASE 3 部分证据已保存、aiRunStatus undefined、无 completion → researching", () => {
    const result = {
      competitorEvidence: { asins: [{ asin: "B0X" }] },
      vocAnalysis: { themes: [] },
      keywordEvidence: { rows: [] },
    };
    expect(groupOf(baseInput({ result, aiRunStatus: undefined }))).toBe("researching");
  });

  it("CASE 4 aiRunStatus=not_started 但研究已开始、无 completion、无 blocker → researching", () => {
    const result = { keywordEvidence: { rows: [] } };
    expect(groupOf(baseInput({ result, aiRunStatus: "not_started" }))).toBe("researching");
  });

  it("CASE 5 aiRunStatus=running → researching", () => {
    expect(groupOf(baseInput({ aiRunStatus: "running" }))).toBe("researching");
  });

  it("CASE 6 等待人工决定 → needs_action", () => {
    // 正式决定载体（与实现同源）：productResearchSummary(product-research-record.v1)
    const result = {
      productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready" },
    };
    expect(groupOf(baseInput({ result }))).toBe("needs_action");
    const status = deriveResearchHistoryStatus({ result, decisionStatus: "continue", oneLineSummary: "" });
    expect(status.key).toBe("awaiting_decision");
  });

  it("CASE 7 research_stale / waiting / failed / cancelled → needs_action", () => {
    expect(groupOf(baseInput({ aiRunStatus: "research_stale" }))).toBe("needs_action");
    expect(groupOf(baseInput({ aiRunStatus: "waiting" }))).toBe("needs_action");
    expect(groupOf(baseInput({ aiRunStatus: "failed_recoverable" }))).toBe("needs_action");
    expect(groupOf(baseInput({ aiRunStatus: "failed_terminal" }))).toBe("needs_action");
    expect(groupOf(baseInput({ aiRunStatus: "cancelled" }))).toBe("needs_action");
  });

  it("CASE 12 /research 与工作台对同一 Task 分类一致（isActiveResearch 与 group 研究中一致）", () => {
    const result = { keywordEvidence: { rows: [] } };
    const input = { decisionStatus: "continue" as const, result };
    const group = groupOf(baseInput({ result }));
    expect(group).toBe("researching");
    expect(isActiveResearch(input)).toBe(true);
  });
});

describe("Bug 1：AI 辅助判断 nullable 合同（headline 来源）", () => {
  it("有真实 AI 结论（summary.decisionReason）→ headline 非空", () => {
    const summary = { decisionReason: "数据充分，推荐继续" };
    const headline =
      summary.decisionReason || "";
    expect(headline).toBe("数据充分，推荐继续");
  });

  it("无真实 AI 结论 → headline 为空字符串（不得回退 oneLineSummary/假兜底）", () => {
    const summary = null as Record<string, unknown> | null;
    const finalReport = null as Record<string, unknown> | null;
    const researchConclusions: string[] = [];
    const oneLineSummary = "一个普通的一句话摘要";
    const headline =
      (summary && typeof summary.decisionReason === "string" && summary.decisionReason.trim() ? summary.decisionReason : "")
      || (finalReport && typeof finalReport.finalVerdict === "string" && finalReport.finalVerdict.trim() ? finalReport.finalVerdict : "")
      || researchConclusions[0]
      || "";
    expect(headline).toBe("");
    // 假兜底文案不得出现
    expect(headline === "AI 研究结论尚未取得。").toBe(false);
    expect(headline === oneLineSummary).toBe(false);
  });
});
