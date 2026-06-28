import { describe, expect, it } from "vitest";
import { deriveAgentRunTimelineItems } from "./agentRunTimeline";

describe("deriveAgentRunTimelineItems", () => {
  it("derives seven timeline items from a complete agent run result", () => {
    const items = deriveAgentRunTimelineItems({
      decisionStatus: "continue",
      result: {
        productName: "桌面手机支架",
        sourceMeta: {
          candidateId: "cand_1",
          opportunitySource: "manual import",
        },
        agentRunSnapshot: {
          source: "agent_run",
          productName: "桌面手机支架",
          steps: [
            { key: "normalize", label: "数据清洗", status: "completed", summary: "输入已清洗" },
            { key: "sourcing", label: "货源判断", status: "completed", summary: "货源可评估" },
            { key: "risk", label: "风险预筛", status: "completed", summary: "低风险" },
            { key: "listing", label: "Listing 草稿", status: "completed", summary: "草稿已生成" },
          ],
          finalVerdict: "可小单测试",
          riskLevel: "green",
          manualConfirmed: true,
          nextSteps: ["复核关键词", "确认供应商"],
        },
        listingPrepSnapshot: {
          keywordPool: { coreWords: ["phone stand"] },
        },
        reviewState: { allReviewed: true },
      },
    });

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.key)).toEqual([
      "source",
      "normalize",
      "sourcing",
      "risk",
      "listing",
      "manual_review",
      "next_action",
    ]);
    expect(items.every((item) => item.status === "completed")).toBe(true);
    expect(items[0].evidence).toBe("cand_1");
  });

  it("handles old task result without agent snapshot safely", () => {
    const items = deriveAgentRunTimelineItems({
      decisionStatus: "pending",
      result: {
        title: "旧任务",
      },
    });

    expect(items).toHaveLength(7);
    expect(items[0]).toMatchObject({ key: "source", status: "completed" });
    expect(items.find((item) => item.key === "normalize")?.status).toBe("unavailable");
    expect(items.find((item) => item.key === "listing")?.status).toBe("pending");
    expect(items.find((item) => item.key === "manual_review")?.status).toBe("pending");
  });

  it("marks risky or failed stages as warning", () => {
    const items = deriveAgentRunTimelineItems({
      decisionStatus: "need_info",
      result: {
        sourceMeta: { candidateId: "cand_risky" },
        steps: [
          { key: "sourcing", status: "failed", summary: "供应商信息不足" },
          { key: "risk", status: "completed", summary: "发现侵权风险" },
        ],
        finalReport: {
          riskLevel: "red",
        },
      },
    });

    expect(items.find((item) => item.key === "sourcing")?.status).toBe("warning");
    expect(items.find((item) => item.key === "risk")?.status).toBe("warning");
    expect(items.find((item) => item.key === "manual_review")?.status).toBe("pending");
  });
});
