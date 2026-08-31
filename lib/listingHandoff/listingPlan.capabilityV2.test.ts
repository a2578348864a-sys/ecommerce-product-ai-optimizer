/**
 * buildListingPlanFromCapability（Capability 驱动的 Listing Plan 出口）测试。
 *
 * 合同：
 * - 只消费 capability.eligibleGroups 中的核心组；identity / secondary_variant 永不生成 Bullet；
 * - 按 CORE_CLAIM_GROUPS 固定顺序选择；bulletPlans.length 精确等于 targetBulletCount（最多 5）；
 * - 每条 plan 的 claimGroup 绑定该组全部去重 factId；不得跨组借事实、空绑定、换词凑数；
 * - role 按固定 5 角色顺序分配且正式 3-5 条时唯一；claimGroup 承担事实语义，role 只承担表达角度；
 * - target=0 → 0 条；target=2 → 2 条 + status=needs_facts；isBlocked → needs_review；
 *   正式能力缺关键词 → needs_keywords，否则 ready；
 * - planQuality：canCallProvider=true → optimized，否则 safe_fact_draft。
 */
import { describe, expect, it } from "vitest";
import { buildListingPlan, buildListingPlanFromCapability } from "@/lib/listingHandoff/listingPlan";
import { evaluateListingCapability, type ListingCapabilityFact, type ListingCapabilityResult } from "@/lib/listingHandoff/listingCapabilityV2";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

function makeInput(productFacts: Array<{ field: string; value: string }>): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: productFacts.map((f) => ({ field: f.field, label: f.field, value: f.value })),
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

function fact(factId: string, field: string, value: string, tier: ListingCapabilityFact["tier"] = "verified"): ListingCapabilityFact {
  return { factId, field, value, tier };
}

function capabilityOf(facts: ListingCapabilityFact[], hasBlockingIssue = false): ListingCapabilityResult {
  return evaluateListingCapability({ facts, hasBlockingIssue });
}

function makeBrief(): ListingKeywordBrief {
  return {
    schema: "listing-keyword-brief.v1",
    primaryKeyword: "kids lunch box",
    supportingKeywords: ["thermos food jar"],
    backendSearchTerms: ["insulated food jar"],
    source: "manual",
    capturedAt: "2026-08-30T00:00:00.000Z",
  } as unknown as ListingKeywordBrief;
}

describe("buildListingPlanFromCapability Capability 驱动 Plan", () => {
  it("target=0 → 输出 0 条；status=needs_facts；planQuality=safe_fact_draft", () => {
    const input = makeInput([{ field: "brand", value: "ThermoBrand" }]);
    const capability = capabilityOf([fact("brand", "brand", "ThermoBrand")]); // 仅身份 → 0 核心组
    const plan = buildListingPlanFromCapability(input, null, capability);
    expect(plan.status).toBe("needs_facts");
    expect(plan.bulletPlans.length).toBe(0);
    expect(plan.planQuality).toBe("safe_fact_draft");
  });

  it("target=2 → 输出 2 条；status=needs_facts；canCallProvider=false 时 planQuality=safe_fact_draft", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
    ]);
    const plan = buildListingPlanFromCapability(input, null, capability);
    expect(plan.bulletPlans.length).toBe(2);
    expect(plan.status).toBe("needs_facts");
    expect(plan.planQuality).toBe("safe_fact_draft");
    expect(plan.bulletPlans.map((b) => b.claimGroup)).toEqual(["material_construction", "size_capacity_fit"]);
  });

  it("target=3 → 3 条；有 Brief 且 canCallProvider=true → status=ready；planQuality=optimized", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
    ]);
    const plan = buildListingPlanFromCapability(input, makeBrief(), capability);
    expect(plan.bulletPlans.length).toBe(3);
    expect(plan.status).toBe("ready");
    expect(plan.planQuality).toBe("optimized");
  });

  it("target=4 → 4 条；无 Brief → needs_keywords", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
      { field: "usage", value: "School Lunch" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
      fact("usage", "usage", "School Lunch"),
    ]);
    const plan = buildListingPlanFromCapability(input, null, capability);
    expect(plan.bulletPlans.length).toBe(4);
    expect(plan.status).toBe("needs_keywords");
  });

  it("target=5 → 5 条（封顶）；6 组也精确 5 条", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
      { field: "usage", value: "School Lunch" },
      { field: "care", value: "Dishwasher Safe" },
      { field: "included_components", value: "Folding Spoon" }, // 6 组
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
      fact("usage", "usage", "School Lunch"),
      fact("care", "care", "Dishwasher Safe"),
      fact("included_components", "included_components", "Folding Spoon"),
    ]);
    const plan = buildListingPlanFromCapability(input, makeBrief(), capability);
    expect(plan.bulletPlans.length).toBe(5); // 封顶 5（6 组按 CORE_CLAIM_GROUPS 顺序取前 5）
    expect(plan.status).toBe("ready");
  });

  it("身份/颜色不进计划：identity 与 secondary_variant 从不生成 Bullet", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "color_or_variant", value: "Pink" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" }, // 加 capacity → 形成 2 组（material_construction + size_capacity_fit）
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("color_or_variant", "color_or_variant", "Pink"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
    ]);
    const plan = buildListingPlanFromCapability(input, null, capability);
    expect(plan.bulletPlans.length).toBe(2); // material_construction + size_capacity_fit
    expect(plan.bulletPlans.map((b) => b.claimGroup)).toEqual(["material_construction", "size_capacity_fit"]);
    expect(plan.bulletPlans[0].featureFactIds).toEqual(["material"]);
    // 身份/颜色不在任何 bullet plan 中
    expect(plan.bulletPlans.some((b) => b.featureFactIds.includes("brand"))).toBe(false);
    expect(plan.bulletPlans.some((b) => b.featureFactIds.includes("color_or_variant"))).toBe(false);
  });

  it("每组只一条且 factId 准确绑定全组去重事实", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "construction", value: "Double Wall" }, // 与 material 同组
      { field: "capacity", value: "10 oz" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("construction", "construction", "Double Wall"),
      fact("capacity", "capacity", "10 oz"),
    ]);
    const plan = buildListingPlanFromCapability(input, null, capability);
    expect(plan.bulletPlans.length).toBe(2); // material_construction + size_capacity_fit
    const matPlan = plan.bulletPlans.find((b) => b.claimGroup === "material_construction");
    expect(matPlan).toBeTruthy();
    expect([...matPlan!.featureFactIds].sort()).toEqual(["construction", "material"]); // 全组去重 factId
    const capPlan = plan.bulletPlans.find((b) => b.claimGroup === "size_capacity_fit");
    expect(capPlan!.featureFactIds).toEqual(["capacity"]);
  });

  it("角色唯一（正式 3-5 条时 5 角色不重复）且 claimGroup 承担事实语义", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
      { field: "usage", value: "School Lunch" },
      { field: "care", value: "Dishwasher Safe" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
      fact("usage", "usage", "School Lunch"),
      fact("care", "care", "Dishwasher Safe"),
    ]);
    const plan = buildListingPlanFromCapability(input, makeBrief(), capability);
    const roles = plan.bulletPlans.map((b) => b.role).filter(Boolean);
    expect(new Set(roles).size).toBe(roles.length); // 唯一
    expect(plan.bulletPlans.length).toBe(5); // 6 facts → 5 核心组（material/构造、size、function、usage、care）→ 5 条
  });

  it("isBlocked → status=needs_review；仍返回如实可用组", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
    ], true);
    const plan = buildListingPlanFromCapability(input, makeBrief(), capability);
    expect(plan.status).toBe("needs_review");
    expect(plan.bulletPlans.length).toBe(3); // 如实返回
  });

  it("旧 buildListingPlan 特征仍可用（不回归）", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
    ]);
    const plan = buildListingPlan(input, makeBrief());
    expect(plan.schema).toBe("listing-plan.v2");
    expect(plan.bulletPlans.length).toBeGreaterThan(0);
  });
});

describe("buildListingPlanFromCapability shopperNeed 差异化（TDD 红→绿）", () => {
  function make4Group() {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
      { field: "care", value: "Dishwasher Safe" },
    ]);
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
      fact("care", "care", "Dishwasher Safe"),
    ]);
    return { input, capability };
  }

  it("4 组 Plan：bulletPlans=4，role 唯一，shopperNeed 非空且唯一（不为全部同一硬编码）", () => {
    const { input, capability } = make4Group();
    const plan = buildListingPlanFromCapability(input, makeBrief(), capability);
    expect(plan.bulletPlans.length).toBe(4);
    const roles = plan.bulletPlans.map((b) => b.role).filter(Boolean);
    expect(new Set(roles).size).toBe(roles.length);
    const needs = plan.bulletPlans.map((b) => b.shopperNeed ?? "");
    expect(needs.every((n) => n.trim().length > 0)).toBe(true);
    expect(new Set(needs).size).toBe(plan.bulletPlans.length);
    expect(needs.some((n) => n === "由已确认事实支撑的表达角度")).toBe(false);
  });

  it("相同输入重复调用深度相等（纯函数）", () => {
    const { input, capability } = make4Group();
    expect(buildListingPlanFromCapability(input, makeBrief(), capability))
      .toEqual(buildListingPlanFromCapability(input, makeBrief(), capability));
  });

  it("VOC 文本不得进入 featureFactIds/factIds 或事实数量", () => {
    const input = makeInput([
      { field: "brand", value: "ThermoBrand" },
      { field: "material", value: "Stainless Steel" },
      { field: "capacity", value: "10 oz" },
      { field: "functional_feature", value: "Vacuum Insulated" },
      { field: "care", value: "Dishwasher Safe" },
    ]);
    const inputWithVoc = { ...input, creativeContext: { vocInsights: ["客户语言: 保温一整天"], aiReferences: [], keywordCandidates: [], competitiveContext: [], sourcingContext: [] } };
    const capability = capabilityOf([
      fact("brand", "brand", "ThermoBrand"),
      fact("material", "material", "Stainless Steel"),
      fact("capacity", "capacity", "10 oz"),
      fact("functional_feature", "functional_feature", "Vacuum Insulated"),
      fact("care", "care", "Dishwasher Safe"),
    ]);
    const plan = buildListingPlanFromCapability(inputWithVoc, makeBrief(), capability);
    expect(plan.bulletPlans.length).toBe(4);
    for (const bp of plan.bulletPlans) {
      expect(bp.featureFactIds.some((id) => id.includes("保温") || id.includes("客户"))).toBe(false);
    }
  });
});
