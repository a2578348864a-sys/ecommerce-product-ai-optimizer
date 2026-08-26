import { describe, expect, it } from "vitest";
import { buildListingPlan, safeListingPlanSummary } from "./listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

/** THERMOS 夹具（与生产任务一致）：已确认 listing 事实（代表性 12 条） */
function thermosInput(overrides: Partial<ListingGenerationInput> = {}): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 5, researchRevision: 1 },
    productFacts: [
      { field: "brand", label: "品牌", value: "THERMOS" },
      { field: "product_type", label: "商品类型", value: "THERMOS" },
      { field: "series_or_model", label: "系列/型号", value: "FUNTAINER Kids" },
      { field: "capacity", label: "容量", value: "10oz" },
      { field: "color_or_variant", label: "颜色/款式", value: "Pink" },
      { field: "material", label: "材质", value: "Stainless Steel" },
      { field: "functional_feature", label: "功能特性", value: "Vacuum Insulated" },
      { field: "care", label: "清洁保养", value: "Dishwasher Safe" },
      { field: "included_components", label: "随附组件", value: "food jar with unfolding spoon" },
      { field: "operation", label: "操作方式", value: "Latch" },
      { field: "usage", label: "使用场景", value: "office, home" },
      { field: "dimensions", label: "尺寸", value: '3.5"L x 3.5"W x 5.3"H' },
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    creativeContext: {
      vocInsights: [
        "买家提到适合学校午餐、保温、防漏、质量好、超值",
        "痛点：不能全天保温、交付延迟",
      ],
      aiReferences: [],
      keywordCandidates: [],
      competitiveContext: [
        "competitor B0DIR01: LunchBots Thermal Food Jar for Kids (direct)",
        "competitor B0IRR01: Glass Storage Containers (irrelevant)",
      ],
      sourcingContext: [],
    },
    ...overrides,
  };
}

function brief(overrides: Partial<ListingKeywordBrief> = {}): ListingKeywordBrief {
  return {
    schema: "listing-keyword-brief.v1",
    primaryKeyword: "thermos for hot food kids",
    supportingKeywords: ["bento box for kids", "lunch box kids", "kids lunch box"],
    backendSearchTerms: ["thermos", "kids food jar"],
    source: "sellersprite",
    capturedAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("ListingPlan.v2：角色与状态", () => {
  it("v2：3-5 角色选择 + 每个 bulletPlan 有 role/shopperNeed/angle/facts/keywords/claimMode/cannotSay", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    expect(plan.schema).toBe("listing-plan.v2");
    expect(plan.status).toBe("ready");
    expect(plan.bulletPlans.length).toBeGreaterThanOrEqual(3);
    expect(plan.bulletPlans.length).toBeLessThanOrEqual(5);
    const roles = plan.bulletPlans.map((b) => b.role);
    expect(new Set(roles).size).toBe(roles.length); // 角色不重复
    for (const b of plan.bulletPlans) {
      expect(["core_outcome", "pain_relief", "use_scenario", "ease_of_use", "proof_or_fit"]).toContain(b.role);
      expect(b.featureFactIds.length).toBeGreaterThanOrEqual(1);
      expect((b.shopperNeed ?? "").length).toBeGreaterThan(0);
      expect(b.shopperAngle.length).toBeGreaterThan(0);
      expect(b.claimMode).toMatch(/^(verified|review)$/);
      expect(Array.isArray(b.cannotSay)).toBe(true);
    }
  });

  it("VOC 只进 shopperNeed（客户语言），不成为事实；featureFactIds 只引用确认字段", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    const factFields = plan.bulletPlans.flatMap((b) => b.featureFactIds);
    expect(factFields.every((fid) => thermosInput().productFacts.some((f) => f.field === fid))).toBe(true);
    expect(JSON.stringify(plan)).toContain("shopperNeed");
  });

  it("无有效关键词方案 → status=needs_keywords（仍生成安全计划但不得 ai_optimized）", () => {
    const plan = buildListingPlan(thermosInput(), null);
    expect(plan.status).toBe("needs_keywords");
    expect(plan.primaryKeyword).toBeNull();
  });

  it("事实不足（仅身份）→ status=needs_facts 且 bulletPlans < 3", () => {
    const input = thermosInput({
      productFacts: [
        { field: "brand", label: "品牌", value: "THERMOS" },
        { field: "product_type", label: "商品类型", value: "THERMOS" },
        { field: "series_or_model", label: "系列/型号", value: "FUNTAINER Kids" },
      ],
    });
    const plan = buildListingPlan(input, brief());
    expect(plan.status).toBe("needs_facts");
    expect(plan.bulletPlans.length).toBeLessThan(3);
  });

  it("未确认性能/时长/认证进入 cannotSay；已确认事实值不进入 cannotSay", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    for (const b of plan.bulletPlans) {
      expect(b.cannotSay).toContain("leakproof");
      expect(b.cannotSay).toContain("12 hours");
      expect(b.cannotSay).toContain("BPA-free");
      expect(JSON.stringify(b.cannotSay)).not.toContain("Dishwasher Safe");
    }
  });

  it("VOC/竞品内容不成为 factValue；irrelevant 竞品不进任何 bullet 参考", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    expect(JSON.stringify(plan).indexOf("Glass Storage Containers")).toBe(-1);
  });

  it("safeListingPlanSummary（公开 DTO）只暴露安全 label/value/业务说明，不泄露内部 id/hash/runId", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    const sum = safeListingPlanSummary(plan);
    expect(sum.status).toBeDefined();
    expect(JSON.stringify(sum).indexOf("runId")).toBe(-1);
    expect(JSON.stringify(sum).indexOf("Hash")).toBe(-1);
  });
});

// ── LISTING_COPY_QUALITY：卖点卡 shopperNeed 去重 + /s+/g 修复 ──
describe("ListingPlan Copy Quality 红测", () => {
  it("红：四张卖点卡 shopperNeed 不得重复（按角色差分）", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    expect(plan.planQuality).toBe("optimized");
    const needs = plan.bulletPlans.map((b) => String(b.shopperNeed ?? "").trim());
    const seen = new Set<string>();
    for (const n of needs) {
      expect(seen.has(n)).toBe(false);
      seen.add(n);
    }
  });

  it("红：同一非身份事实只支撑一个核心卖点（featureFactIds 不跨卡复用）", () => {
    const plan = buildListingPlan(thermosInput(), brief());
    const seenIds = new Set<string>();
    for (const bp of plan.bulletPlans) {
      for (const fid of bp.featureFactIds) {
        expect(seenIds.has(fid)).toBe(false);
        seenIds.add(fid);
      }
    }
  });

  it("红：数据不足时允许少计划并标 needs_facts，不填充重复卡", () => {
    // 只有 2 个功能事实（无 material/care 等），预期 bullets < 3 或 status=needs_facts
    const input2 = thermosInput({
      productFacts: [
        { field: "brand", label: "品牌", value: "THERMOS" },
        { field: "product_type", label: "商品类型", value: "THERMOS" },
        { field: "functional_feature", label: "功能特性", value: "Vacuum Insulated" },
        { field: "usage", label: "使用场景", value: "office, home" },
      ],
    });
    const plan = buildListingPlan(input2, null);
    expect(plan.status).toBe("needs_facts");
    expect(plan.bulletPlans.length).toBeLessThan(3);
  });

  it("红：/s+/g 修复 — 连续空白折叠正确（VOC 用真实空白而非字面 s）", () => {
    // 通过有 vocInsights 的输入验证：shopperNeed 不含字面 "s" 粘连且为自然文本
    const plan = buildListingPlan(thermosInput(), brief());
    const need = plan.bulletPlans[0]?.shopperNeed ?? "";
    expect(need).toContain("日常");
    expect(need).not.toMatch(/[a-zA-Z]s[a-zA-Z]/);
  });
});
