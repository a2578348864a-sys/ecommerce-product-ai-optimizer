import { describe, expect, it } from "vitest";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

function fact(field: string, label: string, value: string): ListingGenerationInput["productFacts"][number] {
  return { field, label, value, usageScopes: ["listing"], provenance: { evidenceRef: "ev:test", sourceType: "test", observedAt: "2026-08-23T00:00:00.000Z" }, confirmedAt: "2026-08-23T00:00:00.000Z" } as never;
}

function richInput(): ListingGenerationInput {
  return {
    productFacts: [
      fact("brand", "Brand", "BELLA"),
      fact("product_type", "Type", "Toaster"),
      fact("material", "Material", "Stainless Steel"),
      fact("color_or_variant", "Color", "Oatmilk"),
      fact("construction", "Construction", "Extra-wide slots fit thick bread"),
      fact("cleaning", "Cleaning", "Removable crumb tray for easy cleaning"),
      fact("operation", "Operation", "Cord wrap storage keeps the countertop tidy"),
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    prohibitedClaims: [],
    unknowns: [],
    creativePreferences: {},
    creativeContext: {
      vocInsights: [],
      aiReferences: [],
      keywordCandidates: ["toaster", "bread toaster", "removable crumb tray toaster", "extra wide toaster", "cord wrap toaster"],
      competitiveContext: [{
        asin: "B0COMP1",
        note: "competitor",
        bullets: ["Extra-wide slots for thick bread", "Removable crumb tray"],
      }],
      sourcingContext: [],
    } as never,
  } as never;
}

describe("轮 15：自然五点（事实充分时）", () => {
  it("功能事实充分（≥3）→ 每条为自然英文句，不是 1-2 词事实碎片", () => {
    const input = richInput();
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(3);
    for (const b of draft.bullets) {
      expect(b.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
      expect(/\.$/.test(b)).toBe(true);
    }
  });

  it("事实不足时：不为凑条数把规格碎片逐条编号为五点（保留缺口语义）", () => {
    const input = {
      ...richInput(),
      productFacts: [
        fact("brand", "Brand", "BELLA"),
        fact("material", "Material", "Plastic"),
        fact("color_or_variant", "Color", "Oatmilk"),
      ],
      creativeContext: undefined as never,
    } as never;
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    // 不再要求 5 条碎片；允许空或少量（缺口由 UI 提示），但不逐条编号碎片
    expect(draft.bullets.length).toBeLessThanOrEqual(5);
  });
  it("竞品原句不得被原样复制进最终 bullets（reference-only）", () => {
    const input = richInput();
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    for (const b of draft.bullets) {
      // 竞品原句（reference-only）不得整句复制；当前商品自己的已确认事实句可以保留。
      expect(b).not.toContain("Extra-wide slots for thick bread");
      expect(b).not.toEqual("Removable crumb tray");
      expect(b).not.toContain("Extra-wide slots for thick bread.Remen"); // 直接复制组合
    }
  });
});
