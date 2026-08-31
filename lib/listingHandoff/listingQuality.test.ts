import { describe, expect, it } from "vitest";
import {
  buildListingKeywordBrief,
  normalizeBackendSearchTerms,
  parseListingKeywordBrief,
} from "@/lib/listingHandoff/listingKeywordBrief";
import {
  buildListingReadiness,
  listingFactRole,
} from "@/lib/listingHandoff/listingReadiness";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { validateListingQuality } from "@/lib/listingHandoff/listingQualityValidator";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

const NOW = "2026-08-10T00:00:00.000Z";

function makeFact(field: string, value: string, scopes: Array<"listing" | "internal"> = ["internal", "listing"]) {
  return { field, label: field, value, usageScopes: scopes } as never;
}

function makeInput(facts: Array<{ field: string; value: string }>): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: facts.map((f) => ({ field: f.field, label: f.field, value: f.value })),
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: ["Do not make absolute claims."],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

const OWALA_6_FACTS = [
  { field: "brand", value: "Owala" },
  { field: "series_or_model", value: "FreeSip" },
  { field: "product_type", value: "Water Bottle" },
  { field: "material", value: "Stainless Steel" },
  { field: "capacity", value: "24 oz" },
  { field: "color_or_variant", value: "Blue" },
];

const FUNCTIONAL_FACTS = [
  { field: "drinking_mechanism", value: "straw lid with push-open mechanism" },
  { field: "insulation", value: "double-wall vacuum insulation" },
  { field: "cleaning", value: "dishwasher-safe removable parts" },
];

describe("listingKeywordBrief", () => {
  it("合法 brief 构造 + 解析往返", () => {
    const result = buildListingKeywordBrief({
      primaryKeyword: "insulated water bottle",
      supportingKeywords: ["stainless steel bottle", "24 oz bottle"],
      backendSearchTerms: ["insulated water bottle", "vacuum flask", "leakproof tumbler"],
      source: "synthetic",
      capturedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseListingKeywordBrief(result.brief);
    expect(parsed?.primaryKeyword).toBe("insulated water bottle");
    expect(parsed?.supportingKeywords).toHaveLength(2);
    expect(parsed?.backendSearchTerms).toHaveLength(3);
  });

  it("无 primaryKeyword → 失败", () => {
    const result = buildListingKeywordBrief({ primaryKeyword: "", capturedAt: NOW });
    expect(result.ok).toBe(false);
  });

  it("backend terms ≤250 bytes 且去重", () => {
    const { terms, bytes } = normalizeBackendSearchTerms(["water bottle", "water bottle", "vacuum flask"]);
    expect(terms).toEqual(["water bottle", "vacuum flask"]);
    expect(bytes).toBeLessThanOrEqual(250);
    // 大量长词被 250 bytes 截断
    const long = normalizeBackendSearchTerms(Array.from({ length: 20 }, (_, i) => `term${i} `.repeat(8)));
    expect(long.bytes).toBeLessThanOrEqual(250);
  });
});

describe("listingReadiness", () => {
  it("CASE A：仅 6 个身份/规格 facts → claimSafe=true, copyReady=false, 缺功能事实", () => {
    const readiness = buildListingReadiness({
      confirmedFacts: OWALA_6_FACTS.map((f) => makeFact(f.field, f.value)),
      listingEligibleFacts: 6,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.claimSafe).toBe(true);
    expect(readiness.copyReady).toBe(false);
    expect(readiness.keywordReady).toBe(false);
    expect(readiness.missingForQuality.some((m) => m.includes("功能"))).toBe(true);
    expect(readiness.missingForQuality.some((m) => m.includes("关键词"))).toBe(true);
  });

  it("CASE B：6 facts + 功能 facts + keyword brief → copyReady=true, keywordReady=true", () => {
    const brief = buildListingKeywordBrief({ primaryKeyword: "insulated water bottle", capturedAt: NOW });
    const readiness = buildListingReadiness({
      confirmedFacts: [...OWALA_6_FACTS, ...FUNCTIONAL_FACTS].map((f) => makeFact(f.field, f.value)),
      listingEligibleFacts: 9,
      hasBlockingIssue: false,
      keywordBrief: brief.ok ? brief.brief : null,
    });
    expect(readiness.claimSafe).toBe(true);
    expect(readiness.copyReady).toBe(true);
    expect(readiness.keywordReady).toBe(true);
    expect(readiness.missingForQuality).toHaveLength(0);
  });

  it("对抗1：只有 brand/color → claimSafe=true 但 copyReady=false（缺类型/规格/功能）", () => {
    const readiness = buildListingReadiness({
      confirmedFacts: [makeFact("brand", "Owala"), makeFact("color_or_variant", "Blue")],
      listingEligibleFacts: 2,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.claimSafe).toBe(true);
    expect(readiness.copyReady).toBe(false);
  });

  it("对抗9：无 keyword brief → keywordReady=false", () => {
    const readiness = buildListingReadiness({
      confirmedFacts: [...OWALA_6_FACTS, ...FUNCTIONAL_FACTS].map((f) => makeFact(f.field, f.value)),
      listingEligibleFacts: 9,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.keywordReady).toBe(false);
  });

  it("fact role 分类：functional 字段不被误判", () => {
    expect(listingFactRole(makeFact("insulation", "double-wall"))).toBe("functional");
    expect(listingFactRole(makeFact("brand", "Owala"))).toBe("identity");
    expect(listingFactRole(makeFact("capacity", "24 oz"))).toBe("specification");
  });

  it("dimensions 精确合同：listingFactRole(dimensions) === specification", () => {
    expect(listingFactRole(makeFact("dimensions", "5 in"))).toBe("specification");
    // 历史兼容别名不变
    expect(listingFactRole(makeFact("dimension", "5 in"))).toBe("specification");
  });

  it("dimensions 构造：identity(product_type)+specification(material, dimensions)+functional(usage) → copyReady=true 且 specification=2", () => {
    const readiness = buildListingReadiness({
      confirmedFacts: [
        makeFact("product_type", "Water Bottle"),
        makeFact("material", "Plastic"),
        makeFact("dimensions", "5 in"),
        makeFact("usage", "Home"),
      ],
      listingEligibleFacts: 4,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.counts.specification).toBe(2);
    expect(readiness.counts.identity).toBe(1);
    expect(readiness.counts.functional).toBe(1);
    expect(readiness.copyReady).toBe(true);
  });
});

describe("listingPlan", () => {
  it("CASE A：仅身份/规格 facts → safe_fact_draft，bullet 只绑基础事实", () => {
    const plan = buildListingPlan(makeInput(OWALA_6_FACTS), null);
    expect(plan.planQuality).toBe("safe_fact_draft");
    expect(plan.bulletPlans.every((b) => b.featureFactIds.length > 0)).toBe(true);
    expect(plan.missingFacts.length).toBeGreaterThan(0);
  });

  it("CASE B：功能 facts + brief → optimized，每条 bullet 绑 factId", () => {
    const brief = buildListingKeywordBrief({
      primaryKeyword: "insulated water bottle",
      supportingKeywords: ["stainless steel", "24 oz"],
      backendSearchTerms: ["vacuum flask", "leakproof"],
      capturedAt: NOW,
    });
    const plan = buildListingPlan(makeInput([...OWALA_6_FACTS, ...FUNCTIONAL_FACTS]), brief.ok ? brief.brief : null);
    expect(plan.planQuality).toBe("optimized");
    expect(plan.bulletPlans.length).toBeGreaterThanOrEqual(3);
    expect(plan.bulletPlans.every((b) => b.featureFactIds.length > 0)).toBe(true);
    expect(plan.primaryKeyword).toBe("insulated water bottle");
  });
});

describe("listingQualityValidator", () => {
  it("对抗2：属性碎片 Bullet → 失败", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue"],
      bullets: ["Owala FreeSip Water Bottle", "Stainless Steel 24 oz", "Blue"],
      description: "Owala FreeSip 24 oz Stainless Steel Water Bottle Blue.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "fragment")).toBe(true);
  });

  it("对抗5：keyword stuffing Title → 失败", () => {
    const result = validateListingQuality({
      titles: ["water bottle water bottle water bottle bottle"],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "keyword_stuffing")).toBe(true);
  });

  it("对抗6：Bullet 只是属性词 → fragment 失败", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip Water Bottle"],
      bullets: ["Blue", "24 oz", "Steel"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.issues.some((i) => i.code === "fragment")).toBe(true);
  });

  it("对抗7：Description 复制 Title → 失败", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip 24 oz Stainless Steel Water Bottle"],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "Owala FreeSip 24 oz Stainless Steel Water Bottle",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.issues.some((i) => i.code === "title_duplicate" && i.target === "description")).toBe(true);
  });

  it("对抗8：backend terms 大量重复 Title 词 → 失败", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip Water Bottle Stainless Steel 24 oz Blue"],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: ["owala", "freesip", "water", "bottle", "stainless"],
      planQuality: "optimized",
    });
    expect(result.issues.some((i) => i.code === "title_repeat")).toBe(true);
  });

  it("对抗4：禁止词进入 bullets → price/promo 检测", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip Water Bottle"],
      bullets: ["Free shipping on all orders", "a b c d", "e f g h"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.issues.some((i) => i.code === "price_promo")).toBe(true);
  });

  it("正常 optimized 草稿通过校验", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip 24 oz Stainless Steel Insulated Water Bottle, Blue"],
      bullets: [
        "Straw lid with push-open mechanism，饮水方式更顺手。",
        "Double-wall vacuum insulation，保温/保冷场景。",
        "Dishwasher-safe removable parts，清洁保养便利。",
        "24 oz capacity with stainless steel construction，关键规格与选择依据。",
      ],
      description: "Owala FreeSip 24 oz Stainless Steel Water Bottle，适合日常使用。关键特性包括双壁真空保温与一键开盖吸管。规格：24 oz、Stainless Steel、Blue。",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry bottle"],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(true);
  });

  it("R1.4：55 字符 Title → PASS（仅 advisory，不 fallback）", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue"],
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(true);
    expect(result.blockingIssues.length).toBe(0);
    expect(result.issues.some((i) => i.code === "below_target" || i.message.includes("60-100"))).toBe(false);
    expect(result.advisories.some((i) => i.code === "titleLengthAdvisory")).toBe(true);
  });

  it("R1.4：60 字符 Title → PASS", () => {
    const title = "Owala FreeSip Insulated Water Bottle 24 oz Stainless Steel Blue";
    expect(title.length).toBeGreaterThanOrEqual(58);
    expect(title.length).toBeLessThanOrEqual(64);
    const result = validateListingQuality({
      titles: [title],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(true);
    expect(result.blockingIssues.length).toBe(0);
  });

  it("R1.4：75 字符 Title → PASS（hard max 边界内）", () => {
    const title = "Owala FreeSip Insulated Stainless Steel Water Bottle 24 oz Blue Push Straw";
    expect(title.length).toBeLessThanOrEqual(75);
    expect(title.length).toBeGreaterThanOrEqual(72);
    const result = validateListingQuality({
      titles: [title],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(true);
    expect(result.blockingIssues.length).toBe(0);
  });

  it("R1.4：76 字符 Title → BLOCK（超过 hard max 75）", () => {
    const title = "Owala FreeSip Insulated Stainless Steel Water Bottle 24 oz Blue Push Straw Lid";
    expect(title.length).toBeGreaterThanOrEqual(76);
    expect(title.length).toBeLessThanOrEqual(95);
    const result = validateListingQuality({
      titles: [title],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.blockingIssues.some((i) => i.code === "too_long")).toBe(true);
  });

  it("R1.4：90 字符 Title → BLOCK", () => {
    const title = "Owala FreeSip Insulated Stainless Steel Water Bottle 24 oz Blue with Push Open Straw Lid";
    expect(title.length).toBeGreaterThanOrEqual(85);
    const result = validateListingQuality({
      titles: [title],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.blockingIssues.some((i) => i.code === "too_long")).toBe(true);
  });

  it("R1.4：空 Title → BLOCK", () => {
    const result = validateListingQuality({
      titles: [""],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.blockingIssues.some((i) => i.code === "empty")).toBe(true);
  });

  it("R1.4：禁止字符 Title → BLOCK（现有 Amazon 规则保持）", () => {
    const result = validateListingQuality({
      titles: ["Owala FreeSip Water Bottle <Super> [Deal]"],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.blockingIssues.some((i) => i.code === "forbidden_chars")).toBe(true);
  });

  it("R1.4：keyword stuffing Title → BLOCK（现有规则保持）", () => {
    const result = validateListingQuality({
      titles: ["water bottle water bottle water bottle water bottle"],
      bullets: ["a b c d", "e f g h", "i j k l"],
      description: "a full description with enough words to be valid here.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(result.ok).toBe(false);
    expect(result.blockingIssues.some((i) => i.code === "keyword_stuffing")).toBe(true);
  });
});

describe("readiness functional facts classification", () => {
  it("9 facts（6 identity/spec + 3 functional）→ copyReady=true", () => {
    const readiness = buildListingReadiness({
      confirmedFacts: [
        ...OWALA_6_FACTS.map((f) => makeFact(f.field, f.value)),
        makeFact("functional_feature", "straw lid"),
        makeFact("construction", "double-wall"),
        makeFact("care", "dishwasher-safe"),
      ],
      listingEligibleFacts: 9,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.counts.identity).toBe(3);
    expect(readiness.counts.specification).toBe(3);
    expect(readiness.counts.functional).toBe(3);
    expect(readiness.copyReady).toBe(true);
  });
});
