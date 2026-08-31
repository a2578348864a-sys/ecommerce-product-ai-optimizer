/**
 * Listing Capability Evaluation（共享 Policy 适配器）测试。
 *
 * 合同：
 * - evaluateListingCapabilityFromPolicy 把 generationInput.productFacts 逐个调用
 *   现有 classifyClaimPolicy（单一裁决出口），得到真实 tier 后交给
 *   evaluateListingCapability（ListingCapabilityV2）；
 * - explicitHighRiskConfirmed 仅当同字段 confirmedFact 满足
 *   evidenceTier="human_confirmed" 且 sourceRef.sourceKind="user_confirmation"；
 * - prohibited = 额外 prohibitedTerms 合并 generationInput.prohibitedClaims；
 * - 绝不读取 creativeContext（VOC/关键词/竞品/供应商参考不得生成事实）；
 * - 不修改输入；同输入同输出。
 */
import { describe, expect, it } from "vitest";
import {
  evaluateListingCapabilityFromPolicy,
  type CapabilityEvaluationInput,
} from "@/lib/listingHandoff/listingCapabilityEvaluation";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

function makeInput(overrides: Partial<ListingGenerationInput> = {}): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...overrides,
  };
}

type ConfirmedFactShape = {
  field: string;
  value: string;
  evidenceTier?: string;
  sourceRef?: { sourceKind?: string };
};

function makeConfirmedFacts(overrides: Partial<CapabilityEvaluationInput> = {}): CapabilityEvaluationInput {
  return {
    input: makeInput({
      productFacts: [
        { field: "brand", label: "品牌", value: "ThermoBrand" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "capacity", label: "容量", value: "10 oz" },
        { field: "functional_feature", label: "功能", value: "Vacuum Insulated" },
      ],
    }),
    confirmedFacts: [
      { field: "brand", value: "ThermoBrand", evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } },
      { field: "material", value: "Stainless Steel", evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } },
      { field: "capacity", value: "10 oz", evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } },
      { field: "functional_feature", value: "Vacuum Insulated", evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } },
    ] as Array<ConfirmedFactShape & Record<string, unknown>>,
    ...overrides,
  };
}

describe("evaluateListingCapabilityFromPolicy 共享适配器", () => {
  it("低风险字段（brand/material/capacity）无逐项确认元数据也 verified，能力合同正确", () => {
    const result = evaluateListingCapabilityFromPolicy(makeConfirmedFacts({
      confirmedFacts: [
        // brand 为非高风险字段（且 productFacts 含它）：无确认元数据也 verified
        { field: "functional_feature", value: "Vacuum Insulated" }, // 高风险无确认 → review（仅用于结构）
      ] as never,
    }));
    expect(result.capability.hasIdentity).toBe(true);
    expect(result.verifiedFacts.map((f) => f.field).sort()).toEqual(["brand", "capacity", "material"]);
    expect(result.reviewFacts.map((f) => f.field)).toEqual(["functional_feature"]);
  });

  it("高风险字段无逐项确认元数据 → review 且不增加 Bullet 数", () => {
    const result = evaluateListingCapabilityFromPolicy(makeConfirmedFacts({
      confirmedFacts: [
        // material/capacity 无确认（低风险 verified）；functional_feature 无确认元数据 → 高风险 → review
        { field: "material", value: "Stainless Steel" },
        { field: "functional_feature", value: "Vacuum Insulated" },
      ] as never,
    }));
    expect(result.reviewFacts.map((f) => f.field)).toEqual(["functional_feature"]);
    expect(result.capability.supportedBulletCount).toBe(2); // material+capacity 2 组（capacity 无确认仍 verified 低风险）
    const verdict = result.verdicts.find((v) => v.field === "functional_feature");
    expect(verdict?.tier).toBe("review");
  });

  it("高风险字段有人工逐项确认（human_confirmed + sourceRef.user_confirmation）→ verified", () => {
    const result = evaluateListingCapabilityFromPolicy(makeConfirmedFacts({
      confirmedFacts: [
        { field: "functional_feature", value: "Vacuum Insulated", evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } },
        { field: "material", value: "Stainless Steel" },
        { field: "capacity", value: "10 oz" },
      ] as never,
    }));
    expect(result.verifiedFacts.map((f) => f.field)).toContain("functional_feature");
    expect(result.capability.supportedBulletCount).toBe(3);
    expect(result.reviewFacts.length).toBe(0);
  });

  it("禁语命中 → prohibited，且不增加 Bullet 数；prohibited 合并 extra + input.prohibitedClaims", () => {
    const result = evaluateListingCapabilityFromPolicy(makeConfirmedFacts({
      input: makeInput({
        productFacts: [
          { field: "brand", label: "品牌", value: "ThermoBrand" },
          { field: "material", label: "材质", value: "Stainless Steel" },
          { field: "capacity", label: "容量", value: "100% BPA-Free" },
        ],
        prohibitedClaims: ["100%"], // 来自 input.prohibitedClaims
      }),
      confirmedFacts: [
        { field: "capacity", value: "100% BPA-Free", evidenceTier: "human_confirmed", sourceKind: "user_confirmation" },
      ] as never,
      extraProhibitedTerms: ["BPA-free"], // 额外禁语
    }));
    expect(result.verdicts.find((v) => v.field === "capacity")?.tier).toBe("prohibited");
    expect(result.prohibitedFacts.map((f) => f.field)).toEqual(["capacity"]);
    expect(result.capability.supportedBulletCount).toBe(1); // 只有 material 1 组
  });

  it("竞品五点/creativeContext 不参与：productFacts 只来自已确认事实", () => {
    const input = makeInput({
      productFacts: [
        { field: "material", label: "材质", value: "Stainless Steel" },
      ],
      creativeContext: {
        vocInsights: ["v1"],
        aiReferences: ["a1"],
        keywordCandidates: ["k1"],
        competitiveContext: ["competitor B09XYZ bullets: leakproof 12h"],
        sourcingContext: ["sourcing offer o1 displayedPrice=3.5"],
      },
    });
    const result = evaluateListingCapabilityFromPolicy({
      input,
      confirmedFacts: [
        { field: "material", value: "Stainless Steel" },
      ] as never,
    });
    // creativeContext 中竞品五点的 leakproof 12h 不应被当成事实 → 不在 productFacts/不在 verified/review/prohibited
    expect(result.verifiedFacts.map((f) => f.field)).toEqual(["material"]);
    expect(result.reviewFacts.length).toBe(0);
    expect(result.prohibitedFacts.length).toBe(0);
    expect(result.verdicts.length).toBe(1); // 只有 material 一个 productFact 被裁决
  });

  it("输入不可变 + 同输入同输出（确定性）", () => {
    const ctx = makeConfirmedFacts();
    JSON.stringify(ctx); // 确保可序列化
    const snapshot = JSON.stringify(ctx.input.productFacts);
    const r1 = evaluateListingCapabilityFromPolicy(ctx);
    const r2 = evaluateListingCapabilityFromPolicy(ctx);
    expect(r1).toEqual(r2); // 同输入同输出
    expect(JSON.stringify(ctx.input.productFacts)).toBe(snapshot); // 输入未被修改
    // verdicts 结构：field/tier/reason
    expect(r1.verdicts[0]).toMatchObject({ field: expect.any(String), tier: expect.any(String) });
    expect(typeof r1.verdicts[0].reason).toBe("string");
  });

  it("F. hasBlockingIssue=true → isBlocked=true（即使 5 个安全组；真正全局 blocking）", () => {
    // 5 个核心组 + 身份，无 prohibited → 唯一阻断来源 hasBlockingIssue=true
    const facts = [
      { field: "brand", value: "Acme" },
      { field: "product_type", value: "Organizer" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "12 compartments" },
      { field: "operation", value: "slide-out drawers" },
      { field: "usage", value: "daily kitchen storage" },
      { field: "care", value: "wipe clean" },
      { field: "included_components", value: "divider inserts" },
    ];
    const input = makeInput({
      productFacts: facts.map((f) => ({ field: f.field, label: f.field, value: f.value })),
      prohibitedClaims: [],
    });
    const confirmedFacts = facts.map((f) => ({
      field: f.field,
      value: f.value,
      evidenceTier: "human_confirmed" as const,
      sourceRef: { sourceKind: "user_confirmation" as const },
    }));
    const unblocked = evaluateListingCapabilityFromPolicy({ input, confirmedFacts, extraProhibitedTerms: [], hasBlockingIssue: false });
    const blocked = evaluateListingCapabilityFromPolicy({ input, confirmedFacts, extraProhibitedTerms: [], hasBlockingIssue: true });
    // 无阻断：5 组可 full_draft
    expect(unblocked.capability.level).toBe("full_draft");
    expect(unblocked.capability.isBlocked).toBe(false);
    // 同一输入 + hasBlockingIssue=true → isBlocked=true（canGenerate 必须因此关闭）
    expect(blocked.capability.level).toBe("full_draft");
    expect(blocked.capability.isBlocked).toBe(true);
  });
});
