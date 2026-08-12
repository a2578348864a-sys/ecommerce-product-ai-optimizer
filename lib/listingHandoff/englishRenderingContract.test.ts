import { describe, expect, it } from "vitest";
import {
  buildDeterministicListingPackDraft,
  composeOptimizedListingDraft,
} from "@/lib/listingHandoff/listingComposition";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { EnglishRenderingPack } from "@/lib/listingHandoff/listingEnglishRendering";

const HAS_CJK = /[一-鿿㐀-䶿]/;
const HAS_CJK_PUNCT = /[。，；：、！？]/;

const OWALA_FACTS = [
  { field: "brand", label: "品牌", value: "Owala" },
  { field: "product_type", label: "商品类型", value: "Water Bottle" },
  { field: "series_or_model", label: "系列/型号", value: "FreeSip" },
  { field: "material", label: "材质", value: "Stainless Steel" },
  { field: "capacity", label: "容量", value: "24 oz" },
  { field: "color_or_variant", label: "颜色", value: "Very, Very Dark" },
  { field: "functional_feature", label: "功能特性", value: "convenient carry loop doubles as a lock Double-wall insulation keeps drinks cold for up to 24 hours" },
  { field: "compatibility", label: "兼容性", value: "cup holder-friendly base" },
  { field: "dimensions", label: "尺寸", value: "3.24\"W × 10.68\"H（约 8.23 × 27.13 cm）" },
  { field: "weight", label: "重量", value: "13.6 oz（约 385.55 g）" },
  { field: "care", label: "保养", value: "宽口设计，便于清洁和加冰。" },
  { field: "construction", label: "结构", value: "双层隔热不锈钢结构，宽口设计。" },
  { field: "included_components", label: "随附组件", value: "FreeSip 吸嘴（内置吸管）、按钮式上盖、提环。" },
  { field: "operation", label: "操作", value: "按键打开上盖；可通过内置吸管直立吸饮，也可倾斜瓶身从吸嘴开口直接饮用；提环可兼作锁扣。" },
  { field: "other", label: "其他", value: "饮品最长可保冷 24 小时。瓶身比标准杯架更宽，可能仅适配超大或特殊杯架。" },
];

const OWALA_RENDERINGS: EnglishRenderingPack = {
  schema: "listing-english-rendering.v1",
  renderings: [
    { factId: "dimensions", field: "dimensions", sourceValue: "3.24\"W × 10.68\"H（约 8.23 × 27.13 cm）", english: "3.24\"W x 10.68\"H (approx. 8.23 x 27.13 cm)" },
    { factId: "weight", field: "weight", sourceValue: "13.6 oz（约 385.55 g）", english: "13.6 oz (approx. 385.55 g)" },
    { factId: "care", field: "care", sourceValue: "宽口设计，便于清洁和加冰。", english: "Wide-mouth design for easy cleaning and adding ice." },
    { factId: "construction", field: "construction", sourceValue: "双层隔热不锈钢结构，宽口设计。", english: "Double-wall insulated stainless steel construction with a wide mouth." },
    { factId: "included_components", field: "included_components", sourceValue: "FreeSip 吸嘴（内置吸管）、按钮式上盖、提环。", english: "Includes FreeSip spout with built-in straw, push-button lid, and carry loop." },
    { factId: "operation", field: "operation", sourceValue: "按键打开上盖；可通过内置吸管直立吸饮，也可倾斜瓶身从吸嘴开口直接饮用；提环可兼作锁扣。", english: "Push-button lid opens easily; sip upright through the built-in straw or tilt to drink from the spout; the loop doubles as a lock." },
    { factId: "other", field: "other", sourceValue: "饮品最长可保冷 24 小时。瓶身比标准杯架更宽，可能仅适配超大或特殊杯架。", english: "Keeps drinks cold for up to 24 hours. The bottle is wider than standard cup holders and may only fit oversized or specialty holders." },
  ],
  generatedAt: null,
  source: "llm",
};

function makeInput(): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 2, researchRevision: 1 },
    productFacts: OWALA_FACTS,
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: ["Do not make absolute claims."],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    englishRenderings: OWALA_RENDERINGS,
  };
}

function checkEnglish(draft: { titles: string[]; bullets: string[]; description: string; keywords: string[] }): string[] {
  const violations: string[] = [];
  for (const t of draft.titles) if (HAS_CJK.test(t) || HAS_CJK_PUNCT.test(t)) violations.push(`title: ${t}`);
  for (const b of draft.bullets) if (HAS_CJK.test(b) || HAS_CJK_PUNCT.test(b)) violations.push(`bullet: ${b}`);
  if (HAS_CJK.test(draft.description) || HAS_CJK_PUNCT.test(draft.description)) violations.push(`description: ${draft.description}`);
  for (const k of draft.keywords) if (HAS_CJK.test(k) || HAS_CJK_PUNCT.test(k)) violations.push(`keyword: ${k}`);
  return violations;
}

describe("R3.2 English rendering contract", () => {
  it("R32-1: Owala 中文 facts 全部保留并转英文（无信息损失）", () => {
    const input = makeInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    const all = [...draft.titles, ...draft.bullets, draft.description].join(" ");
    // 关键事实必须保留
    const lower = all.toLocaleLowerCase();
    expect(lower).toContain("wide-mouth design");
    expect(lower).toContain("double-wall insulated");
    expect(lower).toContain("built-in straw");
    expect(lower).toContain("push-button lid");
    expect(lower).toContain("carry loop");
    expect(all).toContain("385.55 g");
    expect(all).toContain("27.13 cm");
    // 全英文（无中文 + 无中文标点）
    expect(checkEnglish(draft)).toEqual([]);
  });

  it("R32-2: deterministic 草稿 schema 通过", () => {
    const input = makeInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    const schema = validateAiListingPackDraft(draft);
    expect(schema.ok).toBe(true);
  });

  it("R32-3: 无属性碎片（bullets 不含 'X,Y' 粘连）", () => {
    const input = makeInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    for (const b of draft.bullets) {
      // 禁止两个独立事实用逗号直接粘连（如 "Stainless Steel,24 oz"）
      expect(b).not.toMatch(/^[A-Za-z]+,[A-Za-z0-9]/);
    }
  });

  it("R32-4: 无模板填充语", () => {
    const input = makeInput();
    const draft = buildDeterministicListingPackDraft(input, new Date().toISOString());
    const all = [...draft.titles, ...draft.bullets, draft.description].join(" ");
    expect(all).not.toContain("适合日常使用的实用选择");
    expect(all).not.toContain("A practical everyday choice");
  });

  it("R32-5: optimized 草稿也全英文且保留事实", () => {
    const input = makeInput();
    const plan = buildListingPlan(input, null);
    const optimized = composeOptimizedListingDraft(input, plan, null);
    const all = [...optimized.titles, ...optimized.bullets, optimized.description].join(" ");
    expect(all).toContain("Wide-mouth");
    expect(all).toContain("Double-wall");
    expect(checkEnglish(optimized)).toEqual([]);
  });
});
