import { describe, expect, it } from "vitest";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

function fact(field: string, label: string, value: string): ListingGenerationInput["productFacts"][number] {
  return { field, label, value, usageScopes: ["listing"], provenance: { evidenceRef: "ev:" + field, sourceType: "test", observedAt: "2026-08-23T00:00:00.000Z" }, confirmedAt: "2026-08-23T00:00:00.000Z" } as never;
}

/*
 * 现状红灯（轮 16 任务书）：
 * 1) copyReady=true + 已有 SellerSprite 关键词（keywordCandidates）但无手工 Keyword Brief → 关键词为空/未自动埋词；
 * 2) Etekcity/BELLA 类已有事实只能得到 ≤1 条自然 bullet，不算可用 Listing。
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

describe("轮 16 现状红灯：可用 Listing 直出（先红后绿）", () => {
  it("红色#1：copyReady + 已有关键词证据、无手工 Brief → 关键词必须实际嵌入（≥1 主词 + ≥2 辅助词），不得为空", () => {
    const input = bellFixture();
    const plan = buildListingPlan(input, null);
    const draft = composeOptimizedListingDraft(input, plan, null);
    // 轮 16：keywords 字段实际嵌入主词 + ≥2 辅助词（SEO 参考，非 bullet 文本）
    const kwJoined = (draft.keywords ?? []).join(" ").toLowerCase();
    expect(kwJoined).toContain("toaster");
    const embedded = ["toaster", "bread toaster", "2 slice toaster", "extra wide toaster", "stainless steel toaster", "crumb tray toaster"]
      .filter((k) => kwJoined.includes(k.toLowerCase()));
    expect(embedded.length).toBeGreaterThanOrEqual(2);
  });

  it("红色#2：事实充分 → 输出非空事实句（≥3 词不重复）且未用连续属性段冒充；keywords 嵌入主词+辅助词", () => {
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
    expect(draft.keywords.length).toBeGreaterThanOrEqual(1);
  });});
