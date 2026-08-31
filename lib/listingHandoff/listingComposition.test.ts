import { describe, expect, it } from "vitest";
import { validateAiListingPackDraft } from "../aiListingDraft";
import {
  buildDeterministicListingPackDraft,
  composeListingDraft,
  composeOptimizedListingDraft,
  composeControlledBullets,
} from "./listingComposition";
import {
  LISTING_COMPOSER_VERSION,
  LISTING_GENERATION_POLICY_VERSION,
} from "./listingGenerationInput";
import type { ListingGenerationInput } from "./listingGenerationInput";

function input(facts: Array<{ field: string; label: string; value: string }>): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: facts,
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

const OWALA_FACTS = [
  { field: "brand", label: "品牌", value: "Owala" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "series_or_model", label: "系列/型号", value: "FreeSip" },
  { field: "material", label: "材质", value: "Stainless Steel" },
  { field: "capacity", label: "容量", value: "24 oz" },
  { field: "color_or_variant", label: "颜色/款式", value: "Out of the Blue" },
];

describe("V2.1.5 Listing Composition Layer", () => {
  it("V2.1.6 基础草稿使用真实 Composition 来源元数据且通过 Schema", () => {
    const draft = buildDeterministicListingPackDraft(
      input(OWALA_FACTS),
      "2026-08-08T08:00:00.000Z",
    );

    expect(draft).toMatchObject({
      source: "deterministic_composition_v1",
      composerVersion: LISTING_COMPOSER_VERSION,
      generationPolicyVersion: LISTING_GENERATION_POLICY_VERSION,
      polishApplied: false,
      polishModel: null,
    });
    expect(draft.source).not.toBe("real_ai_draft");
    expect(validateAiListingPackDraft(draft).ok).toBe(true);
  });

  it("C1. 全事实组合成自然 Title（Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue）", () => {
    const d = composeListingDraft(input(OWALA_FACTS));
    expect(d.titles[0]).toBe("Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue");
  });

  it("C2. Bullets 为多事实组合（非字段打印）", () => {
    const d = composeListingDraft(input(OWALA_FACTS));
    expect(d.bullets).toEqual([
      "The Water Bottle with the Owala brand for everyday use.",
      "This Water Bottle with Stainless Steel for practical use.",
      "Standard 24 oz capacity for this Water Bottle product.",
      "The Out of the Blue color option for this Water Bottle for easy use.",
    ]);
    expect(d.bullets.some((b) => /^(品牌|商品类型|系列\/型号|材质|容量):/.test(b))).toBe(false);
  });

  it("C3. Description 为事实型自然描述（无风格臆造）", () => {
    const d = composeListingDraft(input(OWALA_FACTS));
    expect(d.description).toContain("Owala");
    expect(d.description).toContain("Water Bottle");
    // R3.1：English-only 合同——description 不含模板填充语，且用户可见字段无中文。
    expect(d.description).not.toContain("适合日常使用的实用选择");
    expect(/[一-鿿]/.test(d.description)).toBe(false);
    expect(d.description).not.toContain("现代简约风格");
    // Description 不再只是 Title 复述
    expect(d.description).not.toBe(`${d.titles[0]}。`);
  });

  it("C4. Keywords 纯值无字段标签", () => {
    const d = composeListingDraft(input(OWALA_FACTS));
    expect(d.keywords).toContain("Owala");
    expect(d.keywords).toContain("FreeSip");
    expect(d.keywords).toContain("Water Bottle");
    expect(d.keywords.some((k) => /^(品牌|商品类型|系列\/型号|容量|材质|颜色\/款式)$/.test(k))).toBe(false);
  });

  it("C5. 缺失字段时按已有字段组合，不补不存在信息", () => {
    const d = composeListingDraft(input([
      { field: "brand", label: "品牌", value: "Acme" },
      { field: "product_type", label: "商品类型", value: "Tumbler" },
    ]));
    expect(d.titles[0]).toBe("Acme Tumbler");
    expect(d.description).not.toContain("Stainless Steel");
    expect(d.keywords).not.toContain("Stainless Steel");
  });

  it("C6. 仅品牌时 Title 只用品牌", () => {
    const d = composeListingDraft(input([{ field: "brand", label: "品牌", value: "Acme" }]));
    expect(d.titles[0]).toBe("Acme");
  });

  it("C7. 市场信号（price/rating/review_count/category）不在输入中则绝不出现", () => {
    // 输入仅含 product_fact；market signal 由上游双保险排除，本层无 market 字段入口
    const d = composeListingDraft(input(OWALA_FACTS));
    const all = JSON.stringify(d);
    expect(all).not.toContain("23.99");
    expect(all).not.toContain("4.7");
    expect(all).not.toContain("132610");
    expect(all).not.toContain("Sports & Outdoors");
  });

  it("C8. 无任何事实时保底用第一个事实值（不崩溃）", () => {
    const d = composeListingDraft(input([{ field: "brand", label: "品牌", value: "Acme" }]));
    expect(d.titles.length).toBeGreaterThan(0);
    expect(d.bullets.length).toBeGreaterThan(0);
  });
});

describe("Organizer 自然文案终局：真实长事实不得套错模板", () => {
  it("红：标题只使用短字段，不吞入完整容量事实且不产生半词截断", async () => {
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "series_or_model", label: "系列/型号", value: "UTO001" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "color_or_variant", label: "颜色/款式", value: "Silver" },
      { field: "capacity", label: "容量", value: "Can hold about 40-50 pieces of common cutlery." },
    ];
    const li = input(facts);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const draft = composeOptimizedListingDraft(li, plan, null);
    expect(draft.titles[0]).not.toContain("Can hold about 40-50 pieces");
    expect(draft.titles[0]).not.toMatch(/Plasti\b|Plasti[^c]/i);
    expect(draft.titles[0]).not.toMatch(/\.{3}$/);
  });

  it("红：标题超长时必须在完整词边界结束，不得用省略号切断", () => {
    const draft = composeOptimizedListingDraft(input([
      { field: "brand", label: "品牌", value: "A".repeat(220) },
      { field: "product_type", label: "商品类型", value: "Organizer" },
    ]), { primaryKeyword: null, bulletPlans: [] } as never, null);
    expect(draft.titles[0]).not.toMatch(/\.{3}$/);
    expect(draft.titles[0].length).toBeLessThanOrEqual(200);
  });

  it("红：Organizer 长事实渲染不得出现四类重复谓语/引导短语", async () => {
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "capacity", label: "容量", value: "Can hold about 40-50 pieces of common cutlery." },
      { field: "operation", label: "操作方式", value: "After placing in the drawer, expand or contract to the sides according to the drawer width mechanism." },
      { field: "usage", label: "使用场景", value: "For storing knives, forks, spoons, and other cutlery in a kitchen drawer." },
      { field: "care", label: "清洁保养", value: "Wipe with a damp cloth; if necessary, clean with warm water and mild detergent." },
    ];
    const li = input(facts);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const draft = composeOptimizedListingDraft(li, plan, null);
    const corpus = [draft.titles[0], ...draft.bullets, draft.description].join(" ");
    for (const bad of ["has a capacity of Can hold", "opens through its After placing", "suitable for use at For storing", "For care, Wipe"]) {
      expect(corpus, corpus).not.toContain(bad);
    }
    const quality = validateCopyQualityContract({ title: draft.titles[0], bullets: draft.bullets, description: draft.description, cannotSay: [], facts: facts.map((f) => ({ factId: f.field, ...f })), bulletPlans: plan.bulletPlans, typeLabel: "Organizer" });
    expect(quality.ok, JSON.stringify(quality.issues)).toBe(true);
  });
});

describe("中文事实 English-safe 渲染（V2 关闭假阻断）", () => {
  const CN_FACTS = [
    { field: "brand", label: "品牌", value: "YETI" },
    { field: "product_type", label: "商品类型", value: "Bottle" },
    { field: "series_or_model", label: "系列", value: "Rambler Jr" },
    { field: "material", label: "材质", value: "Stainless Steel" },
    { field: "capacity", label: "容量", value: "可收纳约 40–50 件常用餐具" },
    { field: "usage", label: "用途", value: "适合日常厨房收纳与外出携带" },
    { field: "care", label: "保养", value: "可用清水冲洗并擦干" },
    { field: "construction", label: "结构", value: "采用不锈钢与塑料组合结构" },
  ];
  const CN_RENDERINGS = CN_FACTS.map((f) => ({
    factId: f.field,
    field: f.field,
    sourceValue: f.value,
    english: f.field === "capacity"
      ? "stores about 40 to 50 pieces of cutlery"
      : f.field === "care"
        ? "rinse with clean water and wipe dry"
        : f.field === "usage"
          ? "suitable for daily kitchen storage and carrying"
          : f.value,
  }));

  it("注入英文渲染：基础 Title 使用英文值且无 CJK，validateAiListingPackDraft.ok=true", () => {
    const input2 = {
      ...input(CN_FACTS),
      englishRenderings: { renderings: CN_RENDERINGS },
    } as ListingGenerationInput;
    const draft = buildDeterministicListingPackDraft(input2, "2026-08-10T08:00:00.000Z");
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
    if (schema.ok) {
      expect(/[一-鿿]/.test(schema.data.titles[0])).toBe(false);
      expect(/[一-鿿]/.test(schema.data.keywords.join(" "))).toBe(false);
      expect(schema.data.titles[0]).toContain("stores about 40 to 50 pieces of cutlery");
    }
  });

  it("注入英文渲染：optimized Title/Keywords 不泄漏原始中文", () => {
    const input2 = {
      ...input(CN_FACTS),
      englishRenderings: { renderings: CN_RENDERINGS },
    } as ListingGenerationInput;
    const plan = {
      status: "ready",
      schema: "listing-plan.v2",
      primaryKeyword: "kitchen organizer",
      bulletPlans: [
        { role: "core_outcome", shopperNeed: "收纳", featureFactIds: ["capacity"], cannotSay: [] },
        { role: "use_scenario", shopperNeed: "携带", featureFactIds: ["usage"], cannotSay: [] },
        { role: "ease_of_use", shopperNeed: "清洁", featureFactIds: ["care"], cannotSay: [] },
      ],
    } as never;
    const d = composeOptimizedListingDraft(input2, plan, null);
    const all = [d.titles[0], ...d.bullets, d.description, ...d.keywords, ...d.backendSearchTerms].join(" ");
    expect(/[一-鿿]/.test(all)).toBe(false);
    expect(all).not.toContain("可收纳约");
    expect(all).not.toContain("适合日常厨房收纳");
    expect(d.titles[0]).toContain("Stainless Steel");
    expect(d.titles[0]).not.toContain("suitable for daily kitchen storage and carrying");
  });
});

describe("第1轮：品牌==商品类型身份去重", () => {
  it("THERMOS 夹具：brand==type 时合成主语为 series+product，禁止 FUNTAINER Kids THERMOS", () => {
    const input = {
      productFacts: [
        { field: "brand", label: "品牌", value: "THERMOS" },
        { field: "product_type", label: "类型", value: "THERMOS" },
        { field: "series_or_model", label: "系列", value: "FUNTAINER Kids" },
        { field: "capacity", label: "容量", value: "10oz" },
      ],
      englishRenderings: { renderings: [] },
    } as never;
    const d = composeListingDraft(input);
    const all = [...d.bullets, ...d.titles].join(" ");
    expect(all).not.toContain("FUNTAINER Kids THERMOS");
    // 主语应为 series + product 或 product
    expect(d.bullets.some((b) => b.includes("FUNTAINER Kids product"))).toBe(true);
  });
});


import { verifyListingClaims, listingClaimsHaveEvidence } from "./listingClaimEvidenceResolver";
import { filterListingClaims } from "@/lib/listingClaimFilter";
import { validateRuntimeQualityContract } from "./listingRuntimeSkill";

const THERMOS_REAL_FACTS = [
  { field: "brand", label: "品牌", value: "THERMOS" },
  { field: "product_type", label: "商品类型", value: "THERMOS" },
  { field: "series_or_model", label: "系列/型号", value: "FUNTAINER Kids" },
  { field: "capacity", label: "容量", value: "10oz" },
  { field: "color_or_variant", label: "颜色/款式", value: "Pink" },
  { field: "category", label: "类目", value: "Kitchen & Dining" },
  { field: "price_usd", label: "参考价格 (USD)", value: "14.69" },
  { field: "rating", label: "评分", value: "4.7" },
  { field: "review_count", label: "评论数", value: "48474" },
  { field: "bsr", label: "大类 BSR", value: "8" },
  { field: "material", label: "材质", value: "Stainless Steel" },
  { field: "dimensions", label: "尺寸", value: '3.5"L x 3.5"W x 5.3"H' },
  { field: "weight", label: "重量", value: "4 ounces" },
  { field: "quantity_or_pack_size", label: "数量/包装", value: "1 Count" },
  { field: "functional_feature", label: "功能特性", value: "Vacuum Insulated" },
  { field: "care", label: "清洁保养", value: "Dishwasher Safe" },
  { field: "included_components", label: "随附组件", value: "food jar with unfolding spoon" },
  { field: "operation", label: "操作方式", value: "Latch" },
  { field: "usage", label: "使用场景", value: "办公场所，家庭" },
  { field: "other", label: "其他确定商品事实", value: "含替换吸管" },
];

describe("真实业务数据（THERMOS FUNTAINER Kids）全链路门禁", () => {
  it("组合草稿通过 Schema + Claim Evidence + 运行时质量合同（不放松任何门禁）", () => {
    const input2 = {
      ...input(THERMOS_REAL_FACTS),
      englishRenderings: {
        schema: "listing-english-rendering.v1",
        renderings: [
          { factId: "usage", field: "usage", sourceValue: "办公场所，家庭", english: "Office, home" },
          { factId: "other", field: "other", sourceValue: "含替换吸管", english: "Replacement straw" },
        ],
        generatedAt: null,
        source: "llm",
      },
    } as unknown as ListingGenerationInput;
    const draft = composeListingDraft(input2);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(3);
    expect(draft.bullets.length).toBeLessThanOrEqual(5);

    const pack = buildDeterministicListingPackDraft(input2, "2026-08-25T12:00:00.000Z");
    const schema = validateAiListingPackDraft(pack);
    expect(schema.ok, JSON.stringify(schema.ok ? null : schema)).toBe(true);

    const filtered = schema.ok
      ? filterListingClaims(schema.data, { prohibitedClaims: [], customClaimLabel: "Handoff prohibited claim" })
      : null;
    expect(filtered, "schema must be ok before filter").not.toBeNull();
    const verified = filtered ? verifyListingClaims(filtered.cleaned, input2) : null;
    expect(verified, "verify must run").not.toBeNull();
    expect(listingClaimsHaveEvidence(verified!), JSON.stringify(verified!.unsupportedClaims)).toBe(true);

    // 与生成服务同源：runtimeFacts = 原始值，usedFactIds = 全部字段
    const quality = validateRuntimeQualityContract({
      title: String(pack.titles[0]),
      bullets: pack.bullets,
      description: pack.description,
      keywords: pack.keywords,
      facts: THERMOS_REAL_FACTS.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: (input2.englishRenderings?.renderings?.find((r) => r.field === f.field)?.english ?? String(f.value)).trim() })),
      usedFactIds: THERMOS_REAL_FACTS.map((f) => f.field),
    });
    expect(quality.ok, JSON.stringify(quality.issues)).toBe(true);
    // 全链门禁通过后：无重复、碎片、锚定缺失
    expect(quality.issues.filter((i) => ["bullet_duplicate", "fragment", "no_fact_anchor", "description_fragments"].includes(i.code))).toEqual([]);
  });

  it("描述含小数尺寸（3.5\"L）时按自然句计数，不拆成伪句", () => {
    const q = validateRuntimeQualityContract({
      title: "THERMOS FUNTAINER Kids 10oz Stainless Steel, Pink",
      bullets: [
        "The Vacuum Insulated option fits this FUNTAINER Kids product for everyday use.",
        "Easy cleaning with the Dishwasher Safe option for this FUNTAINER Kids product.",
        "This FUNTAINER Kids product pairs with the food jar with unfolding spoon for easy use.",
      ],
      description: "This FUNTAINER Kids with the THERMOS brand. The FUNTAINER Kids product with Dimensions: 3.5\"L x 3.5\"W x 5.3\"H and Weight: 4 ounces for everyday use.",
      keywords: ["THERMOS", "FUNTAINER Kids", "10oz", "Stainless Steel", "Pink"],
      facts: THERMOS_REAL_FACTS.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: String(f.value).trim() })),
      usedFactIds: THERMOS_REAL_FACTS.map((f) => f.field),
    });
    expect(q.ok, JSON.stringify(q.issues)).toBe(true);
  });
});

// ─── ListingPlan.v2：计划必须真实驱动生成（第2轮新增） ───

import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { validateCopyQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";

const V2_INPUT = {
  schema: "listing-generation-input.v1" as const,
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
  ],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: [],
  unknowns: [],
  humanReviewRequired: true as const,
  researchMode: "market_research_only" as const,
  promotionEligible: false as const,
  creativeContext: {
    vocInsights: ["买家提到适合学校午餐、保温、防漏、质量好、超值"],
    aiReferences: [],
    keywordCandidates: [],
    competitiveContext: ["competitor B0DIR01: LunchBots Thermal Food Jar for Kids (direct)"],
    sourcingContext: [],
  },
};
const V2_BRIEF = {
  schema: "listing-keyword-brief.v1" as const,
  primaryKeyword: "thermos for hot food kids",
  supportingKeywords: ["bento box for kids", "kids lunch jar"],
  backendSearchTerms: ["thermos", "kids food jar"],
  source: "sellersprite" as const,
  capturedAt: "2026-08-25T00:00:00.000Z",
};

describe("ListingPlan.v2 消费（Composition）", () => {
  it("plan 角色/顺序变化 → 五点顺序与表达随之变化（plan 真被消费，禁止无差别返回 composeBullets）", () => {
    const input = V2_INPUT as never;
    const planA = buildListingPlan(input, V2_BRIEF as never);
    const planB = buildListingPlan(input, V2_BRIEF as never);
    // 打乱 planB 的 bulletPlans 顺序
    planB.bulletPlans = [...planB.bulletPlans].reverse();
    const draftA = composeOptimizedListingDraft(input, planA, V2_BRIEF as never);
    const draftB = composeOptimizedListingDraft(input, planB, V2_BRIEF as never);
    expect(draftA.bullets.length).toBeGreaterThanOrEqual(3);
    expect(draftA.bullets.length).toBeLessThanOrEqual(5);
    // 顺序不同 → 五点应不同（至少一条位置发生变化）
    const same = draftA.bullets.every((b, i) => b === draftB.bullets[i]);
    expect(same, "plan 顺序变化但五点完全一致 = plan 未被消费").toBe(false);
  });

  it("每条正式 bullet 唯一映射一个 bulletPlan 并命中其确认事实", () => {
    const input = V2_INPUT as never;
    const plan = buildListingPlan(input, V2_BRIEF as never);
    const draft = composeOptimizedListingDraft(input, plan, V2_BRIEF as never);
    expect(draft.bullets.length).toBe(plan.bulletPlans.length);
    for (let i = 0; i < draft.bullets.length; i++) {
      const planFacts = plan.bulletPlans[i].featureFactIds;
      const factValues = planFacts.map((fid) => {
        const f = V2_INPUT.productFacts.find((x) => x.field === fid);
        return f ? f.value.toLowerCase() : fid.toLowerCase();
      });
      const hit = factValues.some((v) => draft.bullets[i].toLowerCase().includes(v));
      expect(hit, "bullet " + i + " 未锚定其计划事实: " + draft.bullets[i]).toBe(true);
    }
  });

  it("无有效关键词 → status=needs_keywords 且不能 ai_optimized（只有安全草稿）", () => {
    const input = V2_INPUT as never;
    const plan = buildListingPlan(input, null);
    expect(plan.status).toBe("needs_keywords");
    const draft = composeOptimizedListingDraft(input, plan, null);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(3);
  });
});


describe("ListingPlan.v2：关键词实际上采用（安全事实词 vs 类目词）", () => {
  it("事实安全关键词（材质+商品类型全词来自已确认事实）→ 标题自然使用一次，并进入 keywords 字段", () => {
    const input = V2_INPUT as never;
    // brief 主词为事实安全组合
    const briefSafe = {
      ...V2_BRIEF,
      primaryKeyword: "Stainless Steel Food Jar",
      supportingKeywords: ["stainless steel food jar", "10oz food jar"],
    };
    const plan = buildListingPlan(input, briefSafe as never);
    const draft = composeOptimizedListingDraft(input, plan, briefSafe as never);
    const title = draft.titles[0] ?? "";
    expect(title.toLowerCase()).toContain("stainless");
    expect(title.toLowerCase()).toContain("food");
    expect(title.toLowerCase()).toContain("jar");
    expect(draft.keywords.join(" ").toLowerCase()).toContain("stainless steel food jar");
  });

  it("计划关键词出现在任意正式文本 → usedKeywordTrace 语义为实际采用；不出现在正文的（类目词）不冒充已采用", () => {
    const input = V2_INPUT as never;
    const briefMixed = {
      ...V2_BRIEF,
      primaryKeyword: "Stainless Steel Food Jar",
      supportingKeywords: ["bento box for kids"],
    };
    const plan = buildListingPlan(input, briefMixed as never);
    const draft = composeOptimizedListingDraft(input, plan, briefMixed as never);
    const corpus = [draft.titles[0] ?? "", ...draft.bullets, draft.description].join(" ").toLowerCase();
    // 类目词（商品未证明是 bento box）不得进入正式正文
    const unsafe = "bento box for kids";
    expect(corpus).not.toContain(unsafe);
    // 事实安全词进入正文
    expect(corpus).toContain("food jar");
  });
});

/* ──────────────────────────────────────────────────────────────
 * 多商品类型表驱动：受控句型必须泛化，不能只对 Organizer 成立。
 * 每条断言同一份质量合同：句法结构 + Claim Evidence + 事实锚点 + 禁用句型。
 * ────────────────────────────────────────────────────────────── */

/** 任何商品类型都不得出现的句型（万能帧病句的形态特征） */
const FORBIDDEN_SENTENCE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "available with 拼接", pattern: /\bavailable with\b/i },
  // 「The … with …」且整句无任何主句谓语 —— 才是无谓语骨架；
  // 含真实谓语的句子（works with / is made with）必须放行。
  { name: "无谓语 with 骨架", pattern: /^(?!.*\b(?:is|are|was|were|has|have|had|includes?|contains?|holds?|stores?|fits?|measures?|weighs?|works?|features?|expands?|collapses?|comes?|uses?|provides?|offers?|supports?|organizes?|accommodates?|carries|seals?|opens?|closes?|locks?|slides?|rotates?|adjusts?|helps?|allows?|prevents?|reduces?|resists?|doubles?|keeps?|sits?|stands?|hangs?|rests?|spans?)\b)The\b[^.]*\bwith\b[^.]*\.$/i },
  { name: "for everyday/practical/standard/easy use 填充尾", pattern: /\bfor\s+(?:everyday|practical|standard|easy)\s+use\b/i },
  { name: "has a <数量/复数> feature", pattern: /\bhas\s+(?:a|an)\s+\d+[^.]*\bfeature\./i },
  { name: "has a ... operation", pattern: /\bhas\s+(?:a|an)\b[^.]*\boperation\./i },
];

type ProductFixture = {
  name: string;
  facts: Array<{ field: string; label: string; value: string }>;
  /** 必须出现在正式输出中的渲染原文（事实锚点不得被改写） */
  mustKeepVerbatim: string[];
};

const PRODUCT_FIXTURES: ProductFixture[] = [
  {
    name: "Trash Can（商品名含 Can —— 不得被当成谓语）",
    facts: [
      { field: "brand", label: "品牌", value: "Simplehuman" },
      { field: "product_type", label: "商品类型", value: "Trash Can" },
      { field: "material", label: "材质", value: "Brushed Stainless Steel" },
      { field: "capacity", label: "容量", value: "45 liters" },
      { field: "dimensions", label: "尺寸", value: '15"L x 12"W x 25"H' },
      { field: "weight", label: "重量", value: "12 pounds" },
      { field: "functional_feature", label: "功能特性", value: "3 compartments for sorting waste" },
      { field: "operation", label: "操作方式", value: "Step pedal mechanism" },
      { field: "care", label: "保养", value: "wipe with a damp cloth" },
      { field: "included_components", label: "随附组件", value: "1 removable inner bucket liner" },
    ],
    mustKeepVerbatim: ["3 compartments for sorting waste", "Step pedal mechanism", "Brushed Stainless Steel"],
  },
  {
    name: "Water Bottle（名词规格值 + 真实谓语）",
    facts: [
      { field: "brand", label: "品牌", value: "Owala" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "series_or_model", label: "系列", value: "FreeSip" },
      { field: "material", label: "材质", value: "Stainless Steel" },
      { field: "capacity", label: "容量", value: "24 oz" },
      { field: "functional_feature", label: "功能特性", value: "push-button opening" },
      { field: "operation", label: "操作方式", value: "Flip-top lid mechanism" },
      { field: "care", label: "保养", value: "hand wash only" },
    ],
    mustKeepVerbatim: ["push-button opening", "Flip-top lid mechanism", "Stainless Steel"],
  },
  {
    name: "Tumbler（分词/形容词补语 + 祈使护理）",
    facts: [
      { field: "brand", label: "品牌", value: "HydroJug" },
      { field: "product_type", label: "商品类型", value: "Tumbler" },
      { field: "material", label: "材质", value: "Powder-coated stainless steel" },
      { field: "capacity", label: "容量", value: "40 oz" },
      { field: "construction", label: "构造", value: "built with a double-wall vacuum body" },
      { field: "usage", label: "适用场景", value: "suitable for hot and cold drinks" },
      { field: "operation", label: "操作方式", value: "sliding sip lid mechanism" },
      { field: "care", label: "保养", value: "rinse the lid and wipe the body" },
      { field: "compatibility", label: "兼容性", value: "most standard car cup holders" },
    ],
    mustKeepVerbatim: ["suitable for hot and cold drinks", "sliding sip lid mechanism", "rinse the lid and wipe the body"],
  },
];

describe("多商品类型：受控句型泛化（禁止万能帧病句）", () => {
  for (const fixture of PRODUCT_FIXTURES) {
    it("绿：" + fixture.name + " → ≥3 条自然句，通过结构合同 + Claim Evidence", () => {
      const gen = input(fixture.facts);
      const plan = buildListingPlan(gen, null);
      const draft = composeOptimizedListingDraft(gen, plan, null);
      expect(draft.bullets.length).toBeGreaterThanOrEqual(3);

      // 1) 禁用句型零命中
      for (const b of draft.bullets) {
        for (const fp of FORBIDDEN_SENTENCE_PATTERNS) {
          expect(fp.pattern.test(b), "命中禁用句型「" + fp.name + "」：" + b).toBe(false);
        }
      }
      // 2) 句首大写 + 主句谓语/合法祈使 + 无模板尾（与 bullets 同一质量合同，含 description）
      const copy = validateCopyQualityContract({
        title: draft.titles[0] ?? "",
        bullets: draft.bullets,
        description: draft.description,
        facts: fixture.facts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: f.value })),
        typeLabel: String(fixture.facts.find((f) => f.field === "product_type")?.value ?? ""),
      });
      expect(copy.ok, JSON.stringify(copy.issues)).toBe(true);
      // 3) Claim Evidence
      const verification = verifyListingClaims(
        { ...draft, sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [] } as never,
        gen,
      );
      expect(verification.unsupportedClaims, JSON.stringify(verification.unsupportedClaims)).toEqual([]);
      // 4) 渲染原文保留（不得为了语法改写事实值）
      const corpus = [...draft.bullets, draft.description].join(" ");
      for (const v of fixture.mustKeepVerbatim) {
        // 这里验证事实是否被采用；消费者正文的精确大小写由独立自然英语合同锁定。
        expect(corpus.toLowerCase(), "事实渲染值被改写或丢失：" + v).toContain(v.toLowerCase());
      }
      // 5) 每条 bullet 锚定至少一个已确认事实值
      for (const b of draft.bullets) {
        const anchored = fixture.facts.some((f) => b.toLowerCase().includes(f.value.toLowerCase()));
        expect(anchored, "bullet 未锚定任何已确认事实：" + b).toBe(true);
      }
    });
  }
});

describe("跨模块：Composition 正式输出必须整体通过权威 Runtime Quality（Latch 反例）", () => {
  it("红：Organizer 的 17 条确认事实应由可渲染材质/颜色/规格/随附组件组成至少 3 条安全五点", async () => {
    const facts = [
      { field: "brand", label: "品牌", value: "ukeetap" },
      { field: "product_type", label: "商品类型", value: "Organizer" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "color_or_variant", label: "颜色", value: "Silver" },
      { field: "dimensions", label: "尺寸", value: '16.5"D x 21"W x 1.77"H' },
      { field: "weight", label: "重量", value: "0.81 kg" },
      { field: "quantity_or_pack_size", label: "数量", value: "1 Count" },
      { field: "included_components", label: "随附组件", value: "1 Expandable Silverware Organizer" },
      { field: "functional_feature", label: "功能特性", value: "Extra Large Capacity, Expandable, Sturdy, Food Safe, Waterproof" },
    ];
    const li = input(facts);
    li.englishRenderings = {
      schema: "listing-english-rendering.v1",
      generatedAt: null,
      source: "literal",
      renderings: facts.map((f) => ({ factId: f.field, field: f.field, sourceValue: f.value, english: f.value })),
    };
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({
      input: li,
      confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })),
      extraProhibitedTerms: [],
      hasBlockingIssue: false,
    });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);
    const corpus = [opt.titles[0], ...opt.bullets].join(" ").toLowerCase();
    expect(cap.capability.supportedBulletCount).toBeGreaterThanOrEqual(3);
    expect(opt.bullets.length).toBeGreaterThanOrEqual(3);
    expect(opt.bullets.length).toBeLessThanOrEqual(5);
    expect(corpus).toContain("plastic");
    expect(corpus).toContain("silver");
    expect(corpus).toContain('16.5"d x 21"w x 1.77"h');
    expect(corpus).toContain("expandable silverware organizer");
    expect(corpus).not.toContain("food safe");
    expect(corpus).not.toContain("waterproof");
    expect(corpus).not.toContain("sturdy");
    expect(corpus).not.toContain("1 count");
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const copy = validateCopyQualityContract({
      title: opt.titles[0],
      bullets: opt.bullets,
      description: opt.description,
      cannotSay: [],
      facts: facts.map((fact) => ({ factId: fact.field, field: fact.field, label: fact.label, value: fact.value })),
      bulletPlans: plan.bulletPlans,
      typeLabel: "Organizer",
    });
    expect(copy.ok, copy.issues.map((issue) => issue.message).join(" | ")).toBe(true);
  });

  const LATCH_FACTS = [
    { field: "brand", label: "品牌", value: "Acme" },
    { field: "product_type", label: "商品类型", value: "Water Bottle" },
    { field: "material", label: "材质", value: "Plastic" },
    { field: "capacity", label: "容量", value: "12 oz" },
    { field: "operation", label: "操作方式", value: "Latch" },
  ];
  function latchInput(): ListingGenerationInput {
    return input(LATCH_FACTS);
  }


  it("红：Water Bottle + Plastic + 12 oz + Latch → 3 条全通过 Runtime/CE/CopyQuality（当前 Latch 句 7 词 too_short）", async () => {
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const li = latchInput();
    const cap = evaluateListingCapabilityFromPolicy({
      input: li,
      confirmedFacts: LATCH_FACTS.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })),
      extraProhibitedTerms: [], hasBlockingIssue: false,
    });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const { validateRuntimeQualityContract, validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const { verifyListingClaims } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
    // 1) Plan 3 条
    expect(plan.bulletPlans.length).toBe(3);
    // 2) 逐条消费 operation/material/capacity（顺序以 capability 组序为准：material/capacity/operation）
    const consumed = [...new Set(plan.bulletPlans.map((bp) => bp.featureFactIds[0]).filter(Boolean))];
    expect(consumed.sort()).toEqual(["capacity", "material", "operation"]);
    // 3) 3 条 Bullet
    const optimized = composeOptimizedListingDraft(li, plan, null);
    expect(optimized.bullets.length).toBe(3);
    // 12) 不得删除 operation Bullet（仍是 3 条不是 2 条）
    expect(optimized.bullets.length).not.toBe(2);
    // 10) operation 事实被采用；消费者正文使用自然小写
    expect(optimized.bullets.join(" ")).toContain("latch");
    // 4) 每条锚定对应事实值
    for (const b of optimized.bullets) {
      expect(LATCH_FACTS.some((f) => b.toLowerCase().includes(f.value.toLowerCase())), "bullet 未锚定事实: " + b).toBe(true);
    }
    // 5/6/7) 完整句 + 5-30 词 + Runtime ok
    const facts = LATCH_FACTS.map((f) => ({ factId: f.field, field: f.field, label: f.field, value: f.value }));
    const rt = validateRuntimeQualityContract({ title: optimized.titles[0], bullets: optimized.bullets, description: optimized.description, keywords: optimized.keywords, facts, usedFactIds: facts.map((f) => f.factId) });
    expect(rt.ok, JSON.stringify(rt.issues)).toBe(true);
    for (const b of optimized.bullets) {
      const wc = b.trim().split(/\s+/).filter(Boolean).length;
      expect(wc, "词数越界: " + b + "（" + wc + " 词）").toBeGreaterThanOrEqual(5);
      expect(wc, "词数越界: " + b + "（" + wc + " 词）").toBeLessThanOrEqual(30);
      expect(/[.!?]$/.test(b.trim())).toBe(true);
    }
    // 8) Claim Evidence 通过
    const ce = verifyListingClaims({ source: "deterministic_composition_v1", version: 1, generatedAt: "x", model: "composer", humanReviewRequired: true, titles: optimized.titles, bullets: optimized.bullets, description: optimized.description, keywords: optimized.keywords, sellingPoints: optimized.bullets.slice(0, 6), riskNotes: ["r"], complianceWarnings: [], blockedClaims: [], reviewChecklist: ["c"] }, li);
    expect(ce.unsupportedClaims, JSON.stringify(ce.unsupportedClaims)).toEqual([]);
    // Copy Quality 通过
    const cq = validateCopyQualityContract({ title: optimized.titles[0], bullets: optimized.bullets, description: optimized.description, cannotSay: [], facts, bulletPlans: plan.bulletPlans, typeLabel: "Water Bottle" });
    expect(cq.ok, JSON.stringify(cq.issues)).toBe(true);
    // 9) 无模板填充/病句
    const joined = optimized.bullets.join(" ");
    for (const bad of ["for everyday use", "for practical use", "for standard use", "for easy use", "available with", "has a latch operation"]) {
      expect(joined.toLowerCase()).not.toContain(bad);
    }
    expect(optimized.bullets.filter((b) => /\bwith\b/.test(b) && !/ (is|has|comes|features|fits|offers|opens|includes|measures|weighs|provides) /.test(b))).toEqual([]);
  });

  it("同组回退：组内第一短值不可成句 → 采用同组第二合格事实 + 第一被记录 unrenderable", async () => {
    // 组内 [material, construction]：material 长值使受控句 >30 词（词数门禁 fail-closed）
    // → 回退同组第二个可用事实 construction；material 记录 unrenderable。
    const { composeControlledBullets } = await import("@/lib/listingHandoff/listingComposition");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const longMaterial = "basic polypropylene material formulation with an additional inner core structure layer that provides the main structural framework for this particular container design and adds the overall shape";
    const fs = [
      { field: "brand", label: "品牌", value: "Acme" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "material", label: "材质", value: longMaterial },
      { field: "construction", label: "结构", value: "double-wall vacuum insulation" },
      { field: "capacity", label: "容量", value: "12 oz" },
    ];
    const li = input(fs);
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: fs.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const controlled = composeControlledBullets(li, plan);
    // 组内 [material, construction]：material 长值不可成句 → 回退 construction
    const constructionUsed = controlled.bullets.some((b) => b.toLowerCase().includes("double-wall vacuum insulation"));
    expect(constructionUsed, JSON.stringify(controlled)).toBe(true);
    expect(controlled.unrenderable.some((u) => u.field === "material"), JSON.stringify(controlled.unrenderable)).toBe(true);
  });
});

describe("短值事实表驱动交叉合同（5-30 词 / 事实原样 / 谓语 / 无模板尾 / 三合同通过）", () => {
  const CASES: Array<{ name: string; field: string; value: string; mustContain: string }> = [
    { name: "短 operation", field: "operation", value: "Latch", mustContain: "Latch" },
    { name: "短 material", field: "material", value: "Plastic", mustContain: "Plastic" },
    { name: "短 capacity", field: "capacity", value: "12 oz", mustContain: "12 oz" },
    { name: "短 dimensions", field: "dimensions", value: "5 in", mustContain: "5 in" },
    { name: "短 weight", field: "weight", value: "1 lb", mustContain: "1 lb" },
    { name: "短 functional_feature", field: "functional_feature", value: "Push Button", mustContain: "Push Button" },
    { name: "短 included_components", field: "included_components", value: "Lid", mustContain: "Lid" },
    { name: "短 usage", field: "usage", value: "Home", mustContain: "Home" },
  ];
  for (const c of CASES) {
    it(`${c.name}（${c.value}）→ 5-30 词自然句 + 三合同通过`, async () => {
      const facts = [
        { field: "brand", label: "品牌", value: "Acme" },
        { field: "product_type", label: "商品类型", value: "Water Bottle" },
        { field: "material", label: "材质", value: "Plastic" },
        ...(c.field === "usage" ? [] : [{ field: "usage", label: "使用场景", value: "Kitchen" }]),
        ...(["care", "cleaning"].includes(c.field) ? [] : [{ field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }]),
        { field: c.field, label: c.field, value: c.value },
      ];
      const li = input(facts);
      const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
      const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
      const { validateRuntimeQualityContract, validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
      const { verifyListingClaims } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
      const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
      const plan = buildListingPlanFromCapability(li, null, cap.capability);
      const opt = composeOptimizedListingDraft(li, plan, null);
      // ① Capability 分组正确：该字段进入对应核心组（真实 Capability→Plan→Composition，不伪造 Plan）
      const groupOf = await import("@/lib/listingHandoff/listingCapabilityV2").then((m) => m.claimGroupOfField);
      const expectGroup = groupOf(c.field);
      expect(expectGroup).not.toBeNull();
      expect(cap.capability.eligibleGroups.some((g) => g.group === expectGroup)).toBe(true);
      // ② Plan 真实消费该字段
      const allIds = plan.bulletPlans.flatMap((bp) => bp.featureFactIds);
      expect(allIds).toContain(c.field);
      // 组数≥2（该字段 + capacity）
      expect(plan.bulletPlans.length).toBeGreaterThanOrEqual(2);
      // ③ 事实值出现（大小写不敏感）
      const joined = opt.bullets.join(" ");
      expect(joined.toLowerCase()).toContain(c.mustContain.toLowerCase());
      // ④ 每条 5-30 + 完整句
      for (const b of opt.bullets) {
        const wc = b.trim().split(/\s+/).filter(Boolean).length;
        expect(wc, "词数越界:" + b + "（" + wc + " 词）").toBeGreaterThanOrEqual(5);
        expect(wc).toBeLessThanOrEqual(30);
        expect(/[.!?]$/.test(b.trim())).toBe(true);
      }
      // ⑤ 无模板尾
      for (const bad of ["for everyday use", "for practical use", "for standard use", "for easy use", "available with"]) {
        expect(joined.toLowerCase()).not.toContain(bad);
      }
      // ⑥ 无内部审计词
      const corpus = [opt.titles[0], ...opt.bullets, opt.description, ...opt.keywords].join(" ").toLowerCase();
      for (const auditWord of ["confirmed", "fact", "field", "factref", "listing eligible"]) {
        expect(corpus).not.toContain(auditWord);
      }
      // ⑦ Runtime + CopyQuality + Claim Evidence 三合同
      const factsRt = facts.map((f) => ({ factId: f.field, field: f.field, label: f.field, value: f.value }));
      const rt = validateRuntimeQualityContract({ title: opt.titles[0], bullets: opt.bullets, description: opt.description, keywords: opt.keywords, facts: factsRt, usedFactIds: factsRt.map((f) => f.factId) });
      expect(rt.ok, JSON.stringify(rt.issues)).toBe(true);
      const cq = validateCopyQualityContract({ title: opt.titles[0], bullets: opt.bullets, description: opt.description, cannotSay: [], facts: factsRt, bulletPlans: plan.bulletPlans, typeLabel: "Water Bottle" });
      expect(cq.ok, JSON.stringify(cq.issues)).toBe(true);
      const ce = verifyListingClaims({ source: "deterministic_composition_v1", version: 1, generatedAt: "x", model: "composer", humanReviewRequired: true, titles: opt.titles, bullets: opt.bullets, description: opt.description, keywords: opt.keywords, sellingPoints: opt.bullets.slice(0, 6), riskNotes: ["r"], complianceWarnings: [], blockedClaims: [], reviewChecklist: ["c"] }, li);
      expect(ce.unsupportedClaims, JSON.stringify(ce.unsupportedClaims)).toEqual([]);
    });
  }
});

describe("1 Count 假卖点隔离（Composition 层防守：即使旧 Plan 传入也不得生成正式句）", () => {
  const ONE_COUNT_INPUT = input([
    { field: "brand", label: "品牌", value: "Acme" },
    { field: "product_type", label: "商品类型", value: "Water Bottle" },
    { field: "material", label: "材质", value: "Plastic" },
    { field: "capacity", label: "容量", value: "12 oz" },
    { field: "quantity_or_pack_size", label: "数量", value: "1 Count" },
  ]);

  it("场景一：1 Count 不占正式卖点（capability→plan→compose 全链）", async () => {
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const li = ONE_COUNT_INPUT;
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: li.productFacts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    // 不进入 Plan featureFactIds
    const allIds = plan.bulletPlans.flatMap((bp) => bp.featureFactIds);
    expect(allIds).not.toContain("quantity_or_pack_size");
    expect(plan.bulletPlans.some((bp) => bp.claimGroup === "package_contents")).toBe(false);
    const opt = composeOptimizedListingDraft(li, plan, null);
    const corpus = [opt.titles[0], ...opt.bullets, opt.description, ...opt.keywords].join(" ");
    expect(corpus.toLowerCase()).not.toContain("1 count");
    // 旧 Plan（直接把 quantity_or_pack_size 当 featureFactIds）→ Composition 也不得生成正式句
    const legacyPlan = { bulletPlans: [{ role: "pain_relief", claimGroup: "package_contents", shopperNeed: "x", shopperAngle: "y", featureFactIds: ["quantity_or_pack_size"], evidenceRefs: [], keywordIds: [], claimMode: "verified", cannotSay: [] }] } as never;
    const controlled = composeControlledBullets(li, legacyPlan);
    expect(controlled.bullets.some((b) => b.toLowerCase().includes("1 count"))).toBe(false);
  });

  it("场景二：2-pack set 不误杀（capability 组可用；compose 输出锚定原事实）", async () => {
    const li = input([
      { field: "brand", label: "品牌", value: "Acme" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "capacity", label: "容量", value: "12 oz" },
      { field: "quantity_or_pack_size", label: "数量", value: "2-pack set" },
    ]);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: li.productFacts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const allIds = plan.bulletPlans.flatMap((bp) => bp.featureFactIds);
    expect(allIds).toContain("quantity_or_pack_size");
    const opt = composeOptimizedListingDraft(li, plan, null);
    const corpus = [opt.titles[0], ...opt.bullets, opt.description, ...opt.keywords].join(" ");
    // 若进入正式文案必须锚定原始值（大小写不敏感匹配）
    expect(corpus.toLowerCase()).toContain("2-pack set");
  });
});

describe("消费者自然英语精确合同（字段标签式拼接禁用）", () => {
  const BASE_FACTS = [
    { field: "brand", label: "品牌", value: "Acme" },
    { field: "product_type", label: "商品类型", value: "Water Bottle" },
    { field: "material", label: "材质", value: "Plastic" },
  ];
  const CASES: Array<{ name: string; field: string; value: string; target: string; oldCasing?: string; extra?: Array<{ field: string; label: string; value: string }> }> = [
    { name: "material Plastic", field: "material", value: "Plastic", target: "The Water Bottle is made of plastic.", oldCasing: "The Water Bottle is made of Plastic.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "material Stainless Steel", field: "material", value: "Stainless Steel", target: "The Water Bottle is made of stainless steel.", oldCasing: "The Water Bottle is made of Stainless Steel.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "dimensions 5 in", field: "dimensions", value: "5 in", target: "The Water Bottle measures 5 in.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "operation Latch", field: "operation", value: "Latch", target: "The Water Bottle opens through its latch mechanism.", oldCasing: "The Water Bottle opens through its Latch mechanism.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "included_components Lid", field: "included_components", value: "Lid", target: "A lid is included with the Water Bottle.", oldCasing: "A Lid is included with the Water Bottle.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "functional_feature Push Button", field: "functional_feature", value: "Push Button", target: "The Water Bottle uses a push button as a control.", oldCasing: "The Water Bottle uses a Push Button as a control.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "usage Home", field: "usage", value: "Home", target: "The Water Bottle is suitable for use at home.", oldCasing: "The Water Bottle is suitable for use at Home.", extra: [{ field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "capacity 12 oz", field: "capacity", value: "12 oz", target: "The Water Bottle has a capacity of 12 oz.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
    { name: "weight 1 lb", field: "weight", value: "1 lb", target: "The Water Bottle weighs 1 lb.", extra: [{ field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }] },
  ];
  for (const c of CASES) {
    it("红（当前旧句）：" + c.name + " → 必须输出 " + c.target, async () => {
      const facts = [...BASE_FACTS, ...(c.extra ?? [])];
      if (!facts.some((f) => f.field === c.field)) facts.push({ field: c.field, label: c.field, value: c.value });
      // 值原样（大小写不敏感）——避免 "Plastic" 与已有 material=Plastic 冲突：若同字段，覆盖值
      for (let i = 0; i < facts.length; i += 1) {
        if (facts[i].field === c.field) facts[i] = { field: c.field, label: c.field, value: c.value };
      }
      const li = input(facts);
      const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
      const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
      const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
      const plan = buildListingPlanFromCapability(li, null, cap.capability);
      const opt = composeOptimizedListingDraft(li, plan, null);
      const joined = opt.bullets.join(" ");
      // 不得出现旧机械句（字段标签式拼接）
      const forbidden = [
        "made of Plastic material",
        "made of plastic material",
        "measures 5 in dimensions",
        "opens with a Latch operation",
        "includes a Lid component",
        "includes 1 Count component",
        "is made for Home use",
        "has a Push Button feature",
      ];
      for (const bad of forbidden) {
        expect(joined.toLowerCase()).not.toContain(bad.toLowerCase());
      }
      // 最终消费者文案必须精确大小写；事实绑定是否成立由下方独立合同验证。
      expect(joined).toContain(c.target);
      if (c.oldCasing) expect(joined).not.toContain(c.oldCasing);
    });
  }

  it("普通名词自然小写，但品牌/型号/缩写/技术 token 保持原大小写", async () => {
    const facts = [
      { field: "brand", label: "品牌", value: "Owala" },
      { field: "series_or_model", label: "系列/型号", value: "SoftSip" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "material", label: "材质", value: "ABS Plastic" },
      { field: "capacity", label: "容量", value: "12 oz" },
      { field: "functional_feature", label: "功能特性", value: "SoftSip covered straw" },
      { field: "included_components", label: "随附组件", value: "USB-C Cable" },
      { field: "usage", label: "使用场景", value: "Home" },
    ];
    const li = input(facts);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);
    const joined = opt.bullets.join(" ");

    expect(opt.titles[0]).toContain("Owala SoftSip");
    expect(opt.titles[0]).not.toContain("owala softsip");
    expect(joined).toContain("The Water Bottle is made of ABS plastic.");
    expect(joined).toContain("SoftSip covered straw");
    expect(joined).not.toContain("softsip covered straw");
    expect(joined).toContain("A USB-C cable is included with the Water Bottle.");
    expect(joined).not.toContain("A usb-c cable");
  });

  it("只自然化短名词值；较长英文 rendering 保持原文大小写", async () => {
    const longRendering = "convenient carry loop doubles as a lock Double-wall insulation keeps drinks cold for up to 24 hours";
    const facts = [
      { field: "brand", label: "品牌", value: "Owala" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "material", label: "材质", value: "Stainless Steel" },
      { field: "capacity", label: "容量", value: "24 oz" },
      { field: "functional_feature", label: "功能特性", value: longRendering },
    ];
    const li = input(facts);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);
    expect(opt.bullets.join(" ")).toContain(longRendering);
  });

  it("零费用真实组合：5 条精确自然句、1 Count 隔离、三合同通过", async () => {
    const facts = [
      { field: "brand", label: "品牌", value: "Acme" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "material", label: "材质", value: "Plastic" },
      { field: "dimensions", label: "尺寸", value: "5 in" },
      { field: "capacity", label: "容量", value: "12 oz" },
      { field: "operation", label: "操作方式", value: "Latch" },
      { field: "functional_feature", label: "功能特性", value: "Push Button" },
      { field: "usage", label: "使用场景", value: "Home" },
      { field: "included_components", label: "随附组件", value: "Lid" },
      { field: "quantity_or_pack_size", label: "数量/包装", value: "1 Count" },
    ];
    const li = input(facts);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const { verifyListingClaims } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: facts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);

    expect(cap.capability).toMatchObject({ level: "full_draft", supportedBulletCount: 5, targetBulletCount: 5, canCallProvider: true });
    expect(plan.bulletPlans.flatMap((bp) => bp.featureFactIds)).not.toContain("quantity_or_pack_size");
    expect(opt.bullets).toEqual([
      "The Water Bottle is made of plastic.",
      "The Water Bottle measures 5 in.",
      "The Water Bottle opens through its latch mechanism.",
      "The Water Bottle is suitable for use at home.",
      "A lid is included with the Water Bottle.",
    ]);
    const corpus = [opt.titles[0], ...opt.bullets, opt.description, ...opt.keywords].join(" ");
    expect(corpus.toLowerCase()).not.toContain("1 count");

    const ce = verifyListingClaims({ source: "deterministic_composition_v1", version: 1, generatedAt: "x", model: "composer", humanReviewRequired: true, titles: opt.titles, bullets: opt.bullets, description: opt.description, keywords: opt.keywords, sellingPoints: opt.bullets, riskNotes: ["r"], complianceWarnings: [], blockedClaims: [], reviewChecklist: ["c"] }, li);
    expect(ce.unsupportedClaims, JSON.stringify(ce.unsupportedClaims)).toEqual([]);
    const factsRt = facts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: f.value }));
    const cq = validateCopyQualityContract({ title: opt.titles[0], bullets: opt.bullets, description: opt.description, cannotSay: [], facts: factsRt, bulletPlans: plan.bulletPlans, typeLabel: "Water Bottle" });
    expect(cq.ok, JSON.stringify(cq.issues)).toBe(true);
  });

  it("1 Count 不生成任何句子（即使 target 配置也不得输出）", async () => {
    const li = input([...BASE_FACTS, { field: "capacity", label: "容量", value: "12 oz" }, { field: "quantity_or_pack_size", label: "数量", value: "1 Count" }]);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: li.productFacts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);
    expect([...opt.bullets, opt.description, opt.titles[0], ...opt.keywords].join(" ").toLowerCase()).not.toContain("1 count");
  });

  it("内部审计词/空洞填充尾零命中", async () => {
    const li = input([...BASE_FACTS, { field: "capacity", label: "容量", value: "12 oz" }, { field: "usage", label: "使用场景", value: "Kitchen" }, { field: "care", label: "清洁保养", value: "rinse with clean water and wipe dry" }]);
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const cap = evaluateListingCapabilityFromPolicy({ input: li, confirmedFacts: li.productFacts.map((f) => ({ field: f.field, value: f.value, evidenceTier: "human_confirmed", sourceRef: { sourceKind: "user_confirmation" } })), extraProhibitedTerms: [], hasBlockingIssue: false });
    const plan = buildListingPlanFromCapability(li, null, cap.capability);
    const opt = composeOptimizedListingDraft(li, plan, null);
    const corpus = [opt.titles[0], ...opt.bullets, opt.description, ...opt.keywords].join(" ").toLowerCase();
    for (const bad of ["confirmed", "fact", "field", "factref", "listing eligible", "for everyday use", "for practical use", "for standard use", "for easy use", "every day", "busy routines"]) {
      expect(corpus).not.toContain(bad.toLowerCase());
    }
  });
});
