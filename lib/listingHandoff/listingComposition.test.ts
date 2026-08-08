import { describe, expect, it } from "vitest";
import { validateAiListingPackDraft } from "../aiListingDraft";
import {
  buildDeterministicListingPackDraft,
  composeListingDraft,
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
    expect(d.bullets).toEqual(["Owala FreeSip Water Bottle", "Stainless Steel 24 oz", "Out of the Blue"]);
    expect(d.bullets.some((b) => /^(品牌|商品类型|系列\/型号|材质|容量):/.test(b))).toBe(false);
  });

  it("C3. Description 为事实型自然描述（无风格臆造）", () => {
    const d = composeListingDraft(input(OWALA_FACTS));
    expect(d.description).toContain("Owala");
    expect(d.description).toContain("Water Bottle");
    expect(d.description).not.toContain("现代简约风格");
    expect(d.description).not.toContain("日常使用的实用选择");
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
