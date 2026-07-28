import { describe, expect, it } from "vitest";
import { deriveProductResearchPresentation } from "./productResearchPresentation";

describe("deriveProductResearchPresentation", () => {
  it("does not present a technical completed status as completed research without business facts", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-001",
      type: "workflow",
      decisionStatus: "pending",
      result: { status: "completed" },
    });

    expect(presentation.stage).toEqual({
      key: "pending_research",
      label: "待研究",
    });
    expect(presentation.artifacts).toEqual([]);
  });

  it.each([
    {
      name: "an abandoned lifecycle",
      input: {
        id: "task-archived",
        type: "workflow",
        decisionStatus: "pending",
        result: { productLifecycle: { status: "abandoned" } },
      },
      expected: ["archived", "已归档"],
    },
    {
      name: "an explicit human continue decision",
      input: {
        id: "task-completed",
        type: "workflow",
        decisionStatus: "continue",
        result: {
          humanDecision: {
            status: "continue",
            source: "user",
            confirmedItems: ["商品信息", "市场风险"],
          },
        },
      },
      expected: ["awaiting_human_confirmation", "待人工确认"],
    },
    {
      name: "a human request for more information",
      input: {
        id: "task-review",
        type: "workflow",
        decisionStatus: "need_info",
        result: { finalReport: { finalVerdict: "需要继续核实" } },
      },
      expected: ["awaiting_human_confirmation", "待人工确认"],
    },
    {
      name: "a real listing draft",
      input: {
        id: "task-creative",
        type: "workflow",
        decisionStatus: "pending",
        result: {
          listingPrepSnapshot: {
            titleStructure: { recommendedTitle: "Reusable storage organizer" },
          },
        },
      },
      expected: ["creative_preparation", "创作准备中"],
    },
    {
      name: "a real market conclusion",
      input: {
        id: "task-market",
        type: "workflow",
        decisionStatus: "pending",
        result: { finalReport: { finalVerdict: "谨慎研究" } },
      },
      expected: ["market_research", "市场研究中"],
    },
    {
      name: "normalized product facts",
      input: {
        id: "task-understanding",
        type: "workflow",
        decisionStatus: "pending",
        result: { product: { productName: "Desk organizer" } },
      },
      expected: ["product_understanding", "商品理解中"],
    },
    {
      name: "an unknown legacy shape",
      input: {
        id: "task-unknown",
        type: "mystery",
        decisionStatus: "pending",
        result: { legacyState: "finished_somehow" },
      },
      expected: ["unknown", "状态待确认"],
    },
  ])("maps $name to a deterministic user stage", ({ input, expected }) => {
    const presentation = deriveProductResearchPresentation(input);

    expect([presentation.stage.key, presentation.stage.label]).toEqual(expected);
  });

  it("only exposes artifacts backed by meaningful saved content", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task/artifacts",
      type: "workflow",
      title: "Desk organizer",
      decisionStatus: "need_info",
      result: {
        finalReport: {
          finalVerdict: "市场信息可继续研究",
          nextSteps: ["核对尺寸和竞品差异"],
        },
        listingPrepSnapshot: {
          titleStructure: { recommendedTitle: "Reusable desk organizer" },
          imageMaterialNeeds: ["白底主图"],
        },
        humanDecision: {
          status: "need_info",
          reason: "先补充真实采购和物流信息",
          source: "user",
          confirmedItems: ["商品信息", "市场风险"],
        },
        profitSnapshot: {
          purchaseCost: 12,
          salePrice: 30,
        },
        riskReviewSnapshot: {
          riskLevel: "medium",
        },
      },
    });

    expect(presentation.artifacts.map((artifact) => artifact.key)).toEqual([
      "market_analysis",
      "listing_draft",
      "image_plan",
      "human_conclusion",
    ]);
    expect(presentation.researchConclusions).toContain("市场信息可继续研究");
    expect(presentation.manualChecks).toEqual([
      {
        key: "sourcing",
        label: "供货与供应商",
        status: "unverified",
        statusLabel: "未验证",
        message: "当前没有可靠供应商数据，需要人工寻找和确认。",
      },
      {
        key: "profit",
        label: "成本与利润",
        status: "needs_human_confirmation",
        statusLabel: "需人工确认",
        message: "已有人工估算输入，仍需补充并核对采购、物流、平台费用和广告预算。",
      },
      {
        key: "compliance",
        label: "合规与知识产权",
        status: "needs_human_confirmation",
        statusLabel: "需人工确认",
        message: "当前仅提供风险提示，不能替代专业合规或知识产权审核。",
      },
    ]);
    expect(presentation.actions).toEqual(expect.arrayContaining([
      {
        label: "打开 Listing Studio",
        href: "/listing-studio?taskId=task%2Fartifacts",
      },
      {
        label: "打开 Image Studio",
        href: "/image-studio?taskId=task%2Fartifacts",
      },
    ]));
  });

  it("does not create artifacts from empty placeholders or pending technical state", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-empty",
      type: "workflow",
      decisionStatus: "pending",
      result: {
        finalReport: {},
        listingPrepSnapshot: {},
        aiImageDraftSnapshot: { items: [] },
        humanDecision: { status: "pending" },
      },
    });

    expect(presentation.artifacts).toEqual([]);
    expect(presentation.researchConclusions).toEqual([]);
    expect(presentation.manualChecks.map((item) => item.statusLabel)).toEqual([
      "未验证",
      "待补充",
      "未验证",
    ]);
  });

  it("does not treat an unknown legacy status as a human conclusion", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-legacy-status",
      type: "workflow",
      decisionStatus: "legacy_completed",
      result: {},
    });

    expect(presentation.stage).toEqual({
      key: "pending_research",
      label: "待研究",
    });
    expect(presentation.artifacts).toEqual([]);
  });

  it("recognizes the saved AI Listing snapshot contract", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-ai-listing",
      type: "workflow",
      decisionStatus: "pending",
      result: {
        aiListingPackSnapshot: {
          snapshotType: "ai_listing_pack",
          source: "mock_ai_draft",
          model: "mock",
          version: 1,
          generatedAt: "2026-07-28T00:00:00.000Z",
          savedAt: "2026-07-28T00:01:00.000Z",
          savedBy: "owner",
          humanReviewRequired: true,
          titles: ["Reusable desk organizer"],
          bullets: ["Keeps daily items together"],
          description: "A reviewable draft.",
          keywords: ["desk organizer"],
          sellingPoints: ["Keeps reviewed items together"],
          riskNotes: ["All product claims need manual verification."],
          complianceWarnings: [],
          blockedClaims: [],
          reviewChecklist: ["Verify every claim before publishing."],
        },
      },
    });

    expect(presentation.artifacts.map((artifact) => artifact.key)).toContain("listing_draft");
    expect(presentation.actions).toEqual(expect.arrayContaining([
      {
        label: "打开 Listing Studio",
        href: "/listing-studio?taskId=task-ai-listing",
      },
    ]));
  });

  it("does not treat an unvalidated Listing-like object as a saved Listing artifact", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-unvalidated-listing",
      type: "workflow",
      decisionStatus: "pending",
      result: {
        aiListingPackSnapshot: {
          titles: ["Unvalidated draft"],
          bullets: ["Missing the saved snapshot contract"],
        },
      },
    });

    expect(presentation.artifacts.map((artifact) => artifact.key)).not.toContain("listing_draft");
    expect(presentation.actions).not.toContainEqual(expect.objectContaining({
      href: expect.stringContaining("/listing-studio"),
    }));
  });

  it("rejects a snapshotType-only Listing object without the saved content contract", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-snapshot-type-only",
      type: "workflow",
      decisionStatus: "pending",
      result: {
        aiListingPackSnapshot: {
          snapshotType: "ai_listing_pack",
          titles: ["Looks saved but is incomplete"],
        },
      },
    });

    expect(presentation.artifacts.map((artifact) => artifact.key)).not.toContain("listing_draft");
  });

  it("does not invent a human conclusion or unsafe resume action from status alone", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-status-only",
      type: "workflow",
      title: "Desk organizer",
      decisionStatus: "need_info",
      result: {
        humanDecision: {
          status: "need_info",
          reason: "Generated fallback reason",
          nextAction: "Generated fallback next action",
          source: "user",
          confirmedItems: [],
        },
      },
    });

    expect(presentation.artifacts.map((artifact) => artifact.key)).not.toContain("human_conclusion");
    expect(presentation.actions).not.toContainEqual(expect.objectContaining({
      href: expect.stringContaining("/agent/run?productName="),
    }));
  });

  it("does not present ready-to-test as completed research before human confirmation", () => {
    const presentation = deriveProductResearchPresentation({
      id: "task-ready-to-test",
      type: "workflow",
      decisionStatus: "pending",
      result: {
        productLifecycle: { status: "ready_to_test" },
        finalReport: { finalVerdict: "可以进入人工核验" },
      },
    });

    expect(presentation.stage).toEqual({
      key: "awaiting_human_confirmation",
      label: "待人工确认",
    });
  });
});
