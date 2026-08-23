import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  deriveFormalV2PrimaryAction,
  deriveFormalV2ResearchView,
  formalV2ImageCopy,
} from "@/components/TaskRecordDetail";

describe("formal v2 task result", () => {
  it("maps the safe formal task projection into the four confirmed business modules", () => {
    const view = deriveFormalV2ResearchView({
      id: "task-formal-1",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      type: "workflow",
      decisionStatus: "continue",
      title: "THERMOS Food Jar 商品研究",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "opportunity",
      score: 0,
      level: "",
      oneLineSummary: "",
      productImage: null,
      result: {
        productName: "THERMOS Food Jar",
        productResearchSummary: { schema: "product-research-record.v1", status: "creative_ready" },
        sourceMeta: {
          productBatchSnapshot: {
            marketplace: "US",
            category: "Kitchen & Dining",
            asin: "B08EXAMPLE",
            productFacts: { rating: 4.7, reviews: 13, subCategoryBsr: 2 },
          },
        },
        agentOutputSnapshot: {
          summarySnapshot: {
            decisionReason: "学校午餐场景有明确需求，但仍需人工核对保温时长。",
            concerns: ["有买家反馈不能全天保温。"],
          },
          sourcingSnapshot: {
            supplierConclusion: "现有资料不足以确认供应商匹配。",
            sourceSignals: ["已保存一个商品来源快照。"],
            missingInfo: ["供应商报价尚未取得。"],
          },
          riskSnapshot: {
            riskReason: "保温时长仍需核实。",
            riskFlags: ["长时间保温能力尚未证实。"],
          },
        },
        aiListingPackSnapshot: { version: 1 },
      },
    });

    expect(view).toMatchObject({
      productName: "THERMOS Food Jar",
      category: "Kitchen & Dining",
      market: "Amazon 美国站",
      asin: "B08EXAMPLE",
      status: { label: "研究已完成" },
      headline: "学校午餐场景有明确需求，但仍需人工核对保温时长。",
      hasListingDraft: true,
    });
    expect(view.modules.map((module) => module.title)).toEqual([
      "市场机会",
      "买家需求与差评",
      "货源与商品匹配",
      "成本与风险",
    ]);
    expect(view.modules[0].evidence).toEqual(["评分 4.7", "评论数 13", "子类目排名 #2"]);
    expect(view.modules[2].missing).toBe("供应商报价尚未取得。");
  });

  it("主操作推导考虑任务类型：非 workflow 不出现失效操作（每个 targetId 都真实存在）", () => {
    const workflowStale = deriveFormalV2PrimaryAction({ statusKey: "completed", researchStale: true, taskType: "workflow" });
    expect(workflowStale).toEqual({
      label: "重新确认研究资料",
      targetId: "product-research-decision",
      focusSelector: '[data-testid="research-stale-notice"] button',
    });
    const workflowCompleted = deriveFormalV2PrimaryAction({ statusKey: "completed", researchStale: false, taskType: "workflow" });
    expect(workflowCompleted).toEqual({
      label: "查看 Listing 与图片",
      targetId: "listing-and-images",
      focusSelector: "h2",
    });
    const workflowAwaiting = deriveFormalV2PrimaryAction({ statusKey: "awaiting_decision", researchStale: false, taskType: "workflow" });
    expect(workflowAwaiting).toEqual({
      label: "记录人工决定",
      targetId: "product-research-decision",
      focusSelector: "h2",
    });

    // 非 workflow：stale / awaiting_decision 都只能指向真实存在的目标（formal-v2-materials / listing-and-images）
    const nonWorkflowStale = deriveFormalV2PrimaryAction({ statusKey: "completed", researchStale: true, taskType: "viral" });
    expect(nonWorkflowStale.targetId).toBe("formal-v2-materials");
    expect(nonWorkflowStale.focusSelector).toBe("summary");
    const nonWorkflowAwaiting = deriveFormalV2PrimaryAction({ statusKey: "awaiting_decision", researchStale: false, taskType: "viral" });
    expect(nonWorkflowAwaiting.targetId).toBe("formal-v2-materials");
    const nonWorkflowCompleted = deriveFormalV2PrimaryAction({ statusKey: "completed", researchStale: false, taskType: "viral" });
    expect(nonWorkflowCompleted.targetId).toBe("listing-and-images");
  });

  it("does not show AI-image verification reasons when no image draft exists", () => {
    expect(formalV2ImageCopy(false)).toEqual({
      headline: "商品图片尚未取得。",
      guidance: "请补充清晰真实参考图。",
      verificationReasons: [],
    });
    expect(formalV2ImageCopy(true).verificationReasons).toEqual([
      "无法仅凭 AI 图片确认是不是同一个商品",
      "无法确认产品结构、颜色和数量与真实商品一致",
    ]);
  });
});
