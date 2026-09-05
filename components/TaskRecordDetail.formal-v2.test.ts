import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  deriveFormalV2PrimaryAction,
  deriveFormalV2ResearchView,
  formalV2ImageCopy,
  applyLiveMaterialRows,
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
        researchCompletion: { schema: "research-completion.v1", status: "completed" },
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


describe("applyLiveMaterialRows（轮 13/18 实时同步）", () => {
  const base = [
    { key: "market", number: "01", title: "市场机会", conclusion: "市场机会的 AI 结论尚未取得。", evidence: [] as string[], missing: "市场销量、竞争和价格依据尚未取得。", nextLabel: "核对市场依据", nextHref: "#" },
    { key: "buyers", number: "02", title: "买家需求与差评", conclusion: "买家需求与差评的 AI 结论尚未取得。", evidence: [] as string[], missing: "买家评论与差评数据尚未取得。", nextLabel: "核对评论依据", nextHref: "#" },
    { key: "sourcing", number: "03", title: "货源与商品匹配", conclusion: "货源与商品匹配的 AI 结论尚未取得。", evidence: [] as string[], missing: "供应商、MOQ、报价与交期尚未取得。", nextLabel: "补充货源资料", nextHref: "#" },
    { key: "cost-risk", number: "04", title: "成本与风险", conclusion: "成本与风险的 AI 结论尚未取得。", evidence: [] as string[], missing: "采购、物流、平台费用和广告预算尚未取得。", nextLabel: "补充成本与风险资料", nextHref: "#" },
  ] as const;
  const rows = [
    { key: "productBasics", label: "商品基础资料", state: "已有" as const },
    { key: "competitor", label: "竞品资料", state: "已有" as const },
    { key: "keyword", label: "关键词", state: "已有" as const },
    { key: "browser", label: "Amazon 页面", state: "已有" as const },
    { key: "voc", label: "买家评论", state: "已有" as const },
    { key: "sourcing", label: "供应线索", state: "已有" as const },
  ];
  const live = { rows, counts: { productBasics: 23, competitor: 5, keyword: 10, browser: 1, voc: 13, sourcing: 1 }, hasAiSummary: true };
  it("实时同步：AI 小结已生成 → 四卡结论不再是「尚未取得」，关键依据按实时计数", () => {
    const out = applyLiveMaterialRows([...base] as never, live as never);
    expect(out[0].conclusion).toContain("AI 小结已生成");
    expect(out[1].conclusion).toContain("AI 小结已生成");
    expect(out[2].conclusion).toContain("AI 小结已生成");
    expect(out[3].conclusion).toContain("AI 小结已生成");
    expect(out[0].evidence.join("|")).toContain("商品概览 23 项");
    expect(out[0].evidence.join("|")).toContain("竞品 5 个");
    expect(out[1].evidence.join("|")).toContain("买家评论 13 条");
    expect(out[0].missing).toContain("销量与竞争证据已具备");
    expect(out[1].missing).toContain("评论数据已具备");
    expect(out[2].missing).toContain("供应线索已具备");
  });
  it("无 live 数据时保持原静态推导（不伪造）", () => {
    expect(applyLiveMaterialRows([...base] as never, null)).toEqual([...base]);
  });
  it("竞品仍缺时不覆盖市场「缺什么」，且无 AI 小结时不改结论", () => {
    const noComp = applyLiveMaterialRows([...base] as never, { rows: [rows[0], { key: "competitor", label: "竞品资料", state: "可选" as const }, rows[4]], counts: { productBasics: 23, competitor: 0, keyword: 10, browser: 1, voc: 13, sourcing: 0 }, hasAiSummary: false } as never);
    expect(noComp[0].missing).toBe("市场销量、竞争和价格依据尚未取得。");
    expect(noComp[0].conclusion).toBe("市场机会的 AI 结论尚未取得。");
    expect(noComp[1].missing).toContain("评论数据已具备");
  });
});});


describe("轮 19 Listing 与商品图片状态（信息已填全仍显示未取得/禁止使用）", () => {
  it("研究记录含 AI 图片草稿（无 accessMode 投影字段）时 hasImageDraft 必须为 true（红灯）", () => {
    const view = deriveFormalV2ResearchView({
      id: "task-img-1",
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
        aiImageDraftSnapshot: {
          version: 1,
          snapshotType: "ai_image_draft",
          provider: "openai_compatible_relay",
          humanReviewRequired: true,
          disclaimer: "x",
          updatedAt: "2026-08-20T17:58:45.529Z",
          items: [{ id: "img-1", imageType: "lifestyle_scene", width: 1536, height: 1024, reviewStatus: "needs_human_review" }],
        },
      },
    });
    expect(view.hasImageDraft).toBe(true);
  });
  it("formalV2ImageCopy(true)：标题不出现「尚未取得/尚未提供」，包含「AI 图片草稿」与「待人工确认」", () => {
    const copy = formalV2ImageCopy(true);
    expect(copy.headline).toContain("AI 图片草稿");
    expect(copy.headline).toContain("待人工确认");
    expect(copy.headline).toContain("参考图尚未提供");
  });
});
