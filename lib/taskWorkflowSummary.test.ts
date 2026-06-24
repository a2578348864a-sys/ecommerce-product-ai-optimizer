import { describe, expect, it } from "vitest";
import { deriveTaskWorkflowSummary, getTaskBatchMeta, getTaskSourceMeta } from "@/lib/taskWorkflowSummary";

describe("deriveTaskWorkflowSummary", () => {
  it("extracts workflow final report into operation summary", () => {
    const summary = deriveTaskWorkflowSummary({
      type: "workflow",
      title: "手机支架 一键分析",
      materialText: "手机支架",
      oneLineSummary: "适合继续",
      level: "A",
      decisionStatus: "pending",
      result: {
        productName: "桌面手机支架",
        finalReport: {
          finalVerdict: "可以继续小单测试",
          riskLevel: "green",
          beginnerFit: "适合新手",
          canTestSmallBatch: true,
          nextSteps: ["联系供应商", "核算成本"],
        },
      },
    });

    expect(summary.productName).toBe("桌面手机支架");
    expect(summary.verdictLabel).toBe("可以继续小单测试");
    expect(summary.riskLabel).toBe("低风险");
    expect(summary.riskTone).toBe("emerald");
    expect(summary.priorityLabel).toBe("可跟进");
    expect(summary.primaryNextAction).toBe("联系供应商");
    expect(summary.missingFields).toEqual([]);
  });

  it("marks high risk workflow as cautious", () => {
    const summary = deriveTaskWorkflowSummary({
      type: "workflow",
      title: "高风险商品",
      materialText: "高风险商品",
      oneLineSummary: "",
      level: "C",
      decisionStatus: "pending",
      result: {
        productName: "高风险商品",
        finalReport: {
          finalVerdict: "不建议继续",
          riskLevel: "red",
          beginnerFit: "不适合新手",
          canTestSmallBatch: false,
          nextSteps: ["先查平台规则"],
        },
      },
    });

    expect(summary.riskLabel).toBe("高风险");
    expect(summary.priorityLabel).toBe("暂缓/谨慎");
    expect(summary.priorityTone).toBe("rose");
  });

  it("degrades safely when workflow fields are missing", () => {
    const summary = deriveTaskWorkflowSummary({
      type: "workflow",
      title: "缺字段商品",
      materialText: "缺字段商品",
      oneLineSummary: "",
      level: "",
      decisionStatus: "pending",
      result: { productName: "缺字段商品" },
    });

    expect(summary.verdictLabel).toBe("暂无");
    expect(summary.riskLabel).toBe("暂无");
    expect(summary.beginnerLabel).toBe("暂无");
    expect(summary.nextActions[0]).toContain("联系供应商");
    expect(summary.missingFields).toContain("finalReport");
  });

  it("uses decision status as a strong priority signal", () => {
    const summary = deriveTaskWorkflowSummary({
      type: "workflow",
      title: "已淘汰商品",
      materialText: "已淘汰商品",
      oneLineSummary: "可以继续小单测试",
      level: "A",
      decisionStatus: "rejected",
      result: {
        finalReport: {
          finalVerdict: "可以继续小单测试",
          riskLevel: "green",
          beginnerFit: "适合新手",
          canTestSmallBatch: true,
          nextSteps: ["联系供应商"],
        },
      },
    });

    expect(summary.priorityLabel).toBe("已放弃");
    expect(summary.priorityTone).toBe("rose");
  });
});

describe("getTaskBatchMeta", () => {
  it("extracts valid batch metadata", () => {
    expect(getTaskBatchMeta({
      batchMeta: {
        batchId: "batch-1",
        batchName: "批量分析",
        batchIndex: 2,
        batchTotal: 3,
        source: "workflow_batch_mvp",
      },
    })).toEqual({
      batchId: "batch-1",
      batchName: "批量分析",
      batchIndex: 2,
      batchTotal: 3,
      source: "workflow_batch_mvp",
    });
  });
});

describe("getTaskSourceMeta", () => {
  it("extracts opportunity source metadata from workflow result", () => {
    expect(getTaskSourceMeta({
      productName: "桌面手机支架",
      sourceMeta: {
        source: "opportunity",
        opportunityTitle: "桌面手机支架",
        opportunitySource: "机会雷达候选品",
        opportunityScore: 86.4,
        keyword: "phone stand",
        importedAt: "2026-06-24T10:00:00.000Z",
      },
    })).toEqual({
      source: "opportunity",
      opportunityTitle: "桌面手机支架",
      opportunitySource: "机会雷达候选品",
      opportunityScore: 86,
      keyword: "phone stand",
      importedAt: "2026-06-24T10:00:00.000Z",
    });
  });

  it("ignores unsupported or incomplete source metadata", () => {
    expect(getTaskSourceMeta({ sourceMeta: { source: "manual" } })).toBeNull();
    expect(getTaskSourceMeta({ sourceMeta: { source: "opportunity" } })).toBeNull();
  });
});
