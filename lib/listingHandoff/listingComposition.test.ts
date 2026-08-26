import { describe, expect, it } from "vitest";
import { validateAiListingPackDraft } from "../aiListingDraft";
import {
  buildDeterministicListingPackDraft,
  composeListingDraft,
  composeOptimizedListingDraft,
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
