import { describe, expect, it } from "vitest";
import {
  classifyKeyword,
  filterKeywordsForListing,
  extractKnownBrandsFromCompetitorTitles,
  findCompetitorBrandMentions,
  listingKeywordPolicyVersion,
} from "@/lib/listingHandoff/listingKeywordPolicy";

describe("listingKeywordPolicy（唯一关键词出口）", () => {
  it("分类：generic/attribute/scenario/long_tail/own_brand/competitor_brand/unknown_brand/risk", () => {
    expect(classifyKeyword("water bottle", { ownBrand: "thermos", knownBrands: ["stanley"] })).toBe("generic");
    expect(classifyKeyword("stainless steel bottle", { ownBrand: "thermos", knownBrands: [] })).toBe("attribute");
    expect(classifyKeyword("bottle for school", { ownBrand: "thermos", knownBrands: [] })).toBe("scenario");
    expect(classifyKeyword("kids stainless steel insulated water bottle with straw", { ownBrand: "thermos", knownBrands: [] })).toBe("long_tail");
    expect(classifyKeyword("thermos bottle", { ownBrand: "thermos", knownBrands: [] })).toBe("own_brand");
    expect(classifyKeyword("stanley cup", { ownBrand: "thermos", knownBrands: ["stanley"] })).toBe("competitor_brand");
    expect(classifyKeyword("xyzzy brand cup", { ownBrand: "thermos", knownBrands: [] })).toBe("unknown_brand");
    expect(classifyKeyword("best seller bottle", { ownBrand: "thermos", knownBrands: [] })).toBe("risk");
  });

  it("竞品品牌词永不出现在正式 Listing 字段（含人工 Brief 也不能绕过）", () => {
    const kw = ["stanley cup", "water bottle", "thermos bottle"];
    const r = filterKeywordsForListing(kw, { ownBrand: "thermos", knownBrands: ["stanley"] });
    expect(r.accepted).toEqual(["water bottle"]);
    expect(r.rejected).toContainEqual({ keyword: "stanley cup", reason: "competitor_brand" });
  });

  it("own_brand 可进标题但默认不塞后台搜索词；保序去重", () => {
    const r = filterKeywordsForListing(["water bottle", "Water Bottle", "thermos bottle"], { ownBrand: "thermos", knownBrands: [] });
    expect(r.accepted).toEqual(["water bottle"]);
    expect(r.ownBrandKeyword).toBe("thermos bottle");
  });

  it("knownBrands 从竞品标题确定性提取（大小写/标点归一，非硬编码 Stanley/Owala）", () => {
    const brands = extractKnownBrandsFromCompetitorTitles([
      "Stanley Quencher Tumbler 40 oz",
      "YETI Rambler 20 oz",
      "Generic Bottle",
    ], { ownBrand: "thermos" });
    expect(brands).toContain("stanley");
    expect(brands).toContain("yeti");
    expect(brands).not.toContain("generic");
    expect(brands).not.toContain("thermos");
    expect(listingKeywordPolicyVersion).toBe("listing-keyword-policy.v1");
  });

  it("过滤后无合格关键词 → 诚实空态（accepted=[] 且可见）", () => {
    const r = filterKeywordsForListing(["stanley cup", "thermos bottle"], { ownBrand: "thermos", knownBrands: ["stanley"] });
    expect(r.accepted).toEqual([]);
    expect(r.rejected.length).toBe(2);
  });

  it("未知品牌和竞品标题中提取的品牌都必须被隔离，手工方案不能放行", () => {
    const knownBrands = extractKnownBrandsFromCompetitorTitles([
      "Stanley Quencher Tumbler 40 oz",
      "Owala FreeSip Stainless Steel Water Bottle",
    ], { ownBrand: "HydroJug" });
    const r = filterKeywordsForListing([
      "stanley cup",
      "owala water bottle",
      "water bottle",
      "acme brand tumbler",
      "HydroJug tumbler",
    ], { ownBrand: "HydroJug", knownBrands });

    expect(r.accepted).toEqual(["water bottle"]);
    expect(r.rejected).toEqual(expect.arrayContaining([
      { keyword: "stanley cup", reason: "competitor_brand" },
      { keyword: "owala water bottle", reason: "competitor_brand" },
      { keyword: "acme brand tumbler", reason: "unknown_brand" },
      { keyword: "HydroJug tumbler", reason: "own_brand" },
    ]));
  });

  it("AI 正文若提及当前竞品品牌，必须在接受前被识别；自有品牌不受影响", () => {
    const input = { ownBrand: "HydroJug", knownBrands: ["stanley", "owala"] };
    expect(findCompetitorBrandMentions([
      "HydroJug 40oz Water Bottle",
      "A Stanley-style tumbler for travel.",
      "Owala is not part of this product.",
    ], input)).toEqual(["stanley", "owala"]);
    expect(findCompetitorBrandMentions(["HydroJug 40oz Water Bottle"], input)).toEqual([]);
  });
});
