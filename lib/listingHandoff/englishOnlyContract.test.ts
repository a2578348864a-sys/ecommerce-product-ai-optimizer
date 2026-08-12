import { describe, expect, it } from "vitest";
import {
  buildDeterministicListingPackDraft,
  composeOptimizedListingDraft,
} from "@/lib/listingHandoff/listingComposition";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

const HAS_CJK = /[一-鿿㐀-䶿]/;

function makeInput(productFacts: Array<{ field: string; label: string; value: string }>): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts,
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

const EN_FACTS = [
  { field: "brand", label: "品牌", value: "Owala" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "capacity", label: "容量", value: "24 oz" },
  { field: "functional_feature", label: "功能特性", value: "convenient carry loop doubles as a lock" },
];

const ZH_FACTS = [
  { field: "brand", label: "品牌", value: "Owala" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "capacity", label: "容量", value: "24 oz" },
  { field: "functional_feature", label: "功能特性", value: "宽口设计，便于清洁和加冰。" },
  { field: "care", label: "保养", value: "双层隔热不锈钢结构。" },
];

const MIXED_FACTS = [
  { field: "brand", label: "品牌", value: "Owala" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "capacity", label: "容量", value: "24 oz" },
  { field: "functional_feature", label: "功能特性", value: "convenient carry loop doubles as a lock" },
  { field: "care", label: "保养", value: "宽口设计，便于清洁和加冰。" },
  { field: "construction", label: "结构", value: "双层隔热不锈钢结构。" },
];

function checkEnglish(draft: { titles: string[]; bullets: string[]; description: string; keywords: string[] }): string[] {
  const violations: string[] = [];
  for (const t of draft.titles) if (HAS_CJK.test(t)) violations.push(`title: ${t}`);
  for (const b of draft.bullets) if (HAS_CJK.test(b)) violations.push(`bullet: ${b}`);
  if (HAS_CJK.test(draft.description)) violations.push(`description: ${draft.description}`);
  for (const k of draft.keywords) if (HAS_CJK.test(k)) violations.push(`keyword: ${k}`);
  return violations;
}

describe("R3.1 English-only Listing contract", () => {
  it("EN-1: 英文 facts → 确定性草稿全英文", () => {
    const input = makeInput(EN_FACTS);
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(checkEnglish(draft)).toEqual([]);
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
  });

  it("EN-2: 中文 facts → 确定性草稿全英文（中文 functional facts 跳过）", () => {
    const input = makeInput(ZH_FACTS);
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(checkEnglish(draft)).toEqual([]);
    expect(draft.description).not.toContain("宽口设计");
    expect(draft.description).not.toContain("适合日常使用的实用选择");
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
  });

  it("EN-3: 中英混合 facts → 确定性草稿全英文", () => {
    const input = makeInput(MIXED_FACTS);
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    expect(checkEnglish(draft)).toEqual([]);
    expect(draft.description).toContain("convenient carry loop");
    expect(draft.description).not.toContain("宽口设计");
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
  });

  it("EN-4: 无模板填充语（适合日常使用的实用选择 不出现）", () => {
    const input = makeInput(MIXED_FACTS);
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    const all = [...draft.titles, ...draft.bullets, draft.description, ...draft.keywords].join(" ");
    expect(all).not.toContain("适合日常使用的实用选择");
    expect(all).not.toContain("A practical everyday choice");
  });

  it("EN-5: optimized 组合草稿也全英文", () => {
    const input = makeInput(MIXED_FACTS);
    const plan = buildListingPlan(input, null);
    const optimized = composeOptimizedListingDraft(input, plan, null);
    expect(checkEnglish(optimized)).toEqual([]);
  });
});
