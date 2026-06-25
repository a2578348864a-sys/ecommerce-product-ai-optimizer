import { describe, it, expect } from "vitest";
import {
  buildAgentRunSnapshot,
  buildListingPrepSnapshot,
  isAgentRunTask,
  extractAgentRunSnapshot,
  extractListingPrepSnapshot,
} from "./agentRunSnapshot";

describe("buildAgentRunSnapshot", () => {
  const baseInput = {
    workflowResult: {
      steps: [
        { key: "normalize", label: "数据清洗", status: "completed", summary: "完成" },
        { key: "sourcing", label: "货源判断", status: "completed", summary: "已评估" },
        { key: "risk", label: "风险排查", status: "completed", summary: "低风险" },
        { key: "summary", label: "小白结论", status: "completed", summary: "可推进" },
        { key: "listing", label: "上架文案", status: "completed", summary: "已生成" },
        { key: "report", label: "最终报告", status: "completed", summary: "已生成" },
      ],
      finalReport: {
        finalVerdict: "可进入小单前评估",
        riskLevel: "yellow",
        beginnerFit: "适合有经验再做",
        canTestSmallBatch: true,
        nextSteps: ["查商标", "确认供应商"],
      },
      risk: { overallLevel: "yellow" },
    } as unknown as Record<string, unknown>,
    riskReviewSnapshot: { overallLevel: "yellow" },
    profitSnapshot: { estimatedProfit: 6.25 },
    manualChecked: { sourcing: true, profit: true, risk: true, listing: true },
    productName: "桌面手机支架",
  };

  it("builds complete snapshot from full data", () => {
    const snapshot = buildAgentRunSnapshot(baseInput);
    expect(snapshot.version).toBe(1);
    expect(snapshot.source).toBe("agent_run");
    expect(snapshot.productName).toBe("桌面手机支架");
    expect(snapshot.runMode).toBe("controlled_agent_workflow");
    expect(snapshot.steps).toHaveLength(8);
    expect(snapshot.finalVerdict).toBe("可进入小单前评估");
    expect(snapshot.riskLevel).toBe("yellow");
    expect(snapshot.manualConfirmed).toBe(true);
    expect(snapshot.profitSnapshot).toBeDefined();
    expect(snapshot.riskReviewSnapshot).toBeDefined();
  });

  it("handles minimal data gracefully", () => {
    const snapshot = buildAgentRunSnapshot({
      workflowResult: null,
      riskReviewSnapshot: null,
      profitSnapshot: null,
      manualChecked: { sourcing: false, profit: false, risk: false, listing: false },
      productName: "test",
    });
    expect(snapshot.steps).toHaveLength(8);
    expect(snapshot.manualConfirmed).toBe(false);
    expect(snapshot.finalVerdict).toBeUndefined();
  });
});

describe("buildListingPrepSnapshot", () => {
  it("builds from full listing data", () => {
    const snapshot = buildListingPrepSnapshot({
      listing: {
        title: "Test Product Title",
        keywords: ["kw1", "kw2", "kw3", "kw4"],
        complianceNotes: ["需要人工复核"],
      },
      productName: "Test",
    });
    expect(snapshot.keywordPool.coreWords).toHaveLength(3);
    expect(snapshot.keywordPool.longTailWords).toHaveLength(1);
    expect(snapshot.titleStructure.recommendedTitle).toBe("Test Product Title");
    expect(snapshot.bulletDrafts).toHaveLength(5);
    expect(snapshot.imageMaterialNeeds).toHaveLength(6);
    expect(snapshot.manualSupplementChecklist).toHaveLength(10);
    expect(snapshot.complianceExpressionReminders.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back with minimal data", () => {
    const snapshot = buildListingPrepSnapshot({});
    expect(snapshot.keywordPool.coreWords).toHaveLength(0);
    expect(snapshot.titleStructure.recommendedTitle).toBe("待分析商品");
    expect(snapshot.bulletDrafts).toHaveLength(5);
  });
});

describe("isAgentRunTask", () => {
  it("detects agent run task", () => {
    expect(isAgentRunTask({ agentRunSnapshot: { source: "agent_run" } })).toBe(true);
  });

  it("returns false for non-agent tasks", () => {
    expect(isAgentRunTask({})).toBe(false);
    expect(isAgentRunTask(null)).toBe(false);
    expect(isAgentRunTask({ agentRunSnapshot: { source: "other" } })).toBe(false);
  });
});

describe("extractAgentRunSnapshot", () => {
  it("extracts valid snapshot", () => {
    const snap = { version: 1, source: "agent_run" as const, steps: [], manualConfirmed: false, productName: "x", createdAt: "", runMode: "controlled_agent_workflow" as const };
    expect(extractAgentRunSnapshot({ agentRunSnapshot: snap })).toBeDefined();
  });

  it("returns null for missing snapshot", () => {
    expect(extractAgentRunSnapshot({})).toBeNull();
    expect(extractAgentRunSnapshot(null)).toBeNull();
  });
});

describe("extractListingPrepSnapshot", () => {
  it("extracts snapshot", () => {
    const snap = { keywordPool: { coreWords: [] } };
    expect(extractListingPrepSnapshot({ listingPrepSnapshot: snap })).toBeDefined();
  });

  it("returns null for missing", () => {
    expect(extractListingPrepSnapshot({})).toBeNull();
  });
});
