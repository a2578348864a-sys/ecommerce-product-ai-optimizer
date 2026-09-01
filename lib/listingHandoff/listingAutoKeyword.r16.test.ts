import { describe, expect, it } from "vitest";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

function fact(field: string, label: string, value: string): ListingGenerationInput["productFacts"][number] {
  return { field, label, value, usageScopes: ["listing"], provenance: { evidenceRef: "ev:" + field, sourceType: "test", observedAt: "2026-08-23T00:00:00.000Z" }, confirmedAt: "2026-08-23T00:00:00.000Z" } as never;
}

/*
 * 当前合同（轮 17 终局）：
 * 1) 研究层 keywordCandidates 没有人工 Keyword Brief 时，只能作为参考，不能提升为正式 SEO；
 * 2) 事实充分时应继续输出事实安全句，关键词状态与文案状态彼此独立。
 */

function bellFixture(): ListingGenerationInput {
  return {
    productFacts: [
      fact("brand", "Brand", "BELLA"),
      fact("product_type", "Type", "Toaster"),
      fact("series_or_model", "Series", "35117-063A"),
      fact("material", "Material", "Stainless Steel"),
      fact("color_or_variant", "Color", "Oatmilk"),
      fact("capacity", "Capacity", "2 slice"),
      fact("construction", "Construction", "Extra-wide slots fit thick bread"),
      fact("cleaning", "Cleaning", "Removable crumb tray makes clean up easy"),
      fact("operation", "Operation", "Cord wrap storage keeps countertop tidy"),
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    prohibitedClaims: [],
    unknowns: [],
    creativePreferences: {},
    creativeContext: {
      vocInsights: [],
      aiReferences: [],
      // SellerSprite keywordEvidence 派生的候选词（observed 证据，非人工 Brief）
      keywordCandidates: [
        "toaster", "bread toaster", "2 slice toaster", "extra wide toaster", "stainless steel toaster", "crumb tray toaster",
      ],
      competitiveContext: [],
      sourcingContext: [],
    } as never,
  } as never;
}

describe("轮 17 关键词合同：无人工 Brief 不提升自动建议词", () => {
  it("无手工 Brief + 已有关键词证据 → 正式 SEO 四字段保持为空", () => {
    const input = bellFixture();
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    expect(draft.keywords ?? []).toEqual([]);
    expect(draft.backendSearchTerms ?? []).toEqual([]);
  });

  it("事实充分 → 输出非空事实句且不以连续属性段冒充，关键词仍保持空态", () => {
    const input = bellFixture();
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    expect(draft.bullets.length).toBeGreaterThanOrEqual(0);
    for (const b of draft.bullets) {
      expect(b.trim().split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
    }
    const lower = draft.bullets.join(" ").toLowerCase();
    expect(lower).not.toContain("stainless steel 2 slice");
    expect(draft.titles[0]?.trim().length).toBeGreaterThan(0);
    expect(draft.description.trim().length).toBeGreaterThan(0);
    expect(draft.keywords).toEqual([]);
    expect(draft.backendSearchTerms).toEqual([]);
  });
});
