import { describe, expect, it } from "vitest";
import {
  classifyKeyword,
  extractBrandLikeTokensFromKeywords,
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
    expect(listingKeywordPolicyVersion).toBe("listing-keyword-policy.v2");
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

describe("Listing V2 关键词品牌证据规则（品牌必须有证据）", () => {
  it("普通关键词候选不升级为 knownBrands；已确认事实（dishwasher-safe/straw cap）不误报为品牌", () => {
    const keywordCandidates = [
      "kids water bottle",
      "straw cap bottle",
      "dishwasher safe bottle",
      "insulated bottle",
      "12 oz kids bottle",
    ];
    const brands = extractBrandLikeTokensFromKeywords(keywordCandidates, { ownBrand: "YETI" });
    // 关键：无 brand/series 标记的裸关键词不得被提取为品牌
    expect(brands).not.toContain("straw");
    expect(brands).not.toContain("dishwasher");
    expect(brands).not.toContain("safe");
    expect(brands).not.toContain("insulated");
    expect(brands).not.toContain("kids");
    expect(brands).not.toContain("water");
    // 用其结果构造 knownBrands 后：合规正文（已确认事实值）不得被误判为竞品品牌
    const knownBrands = [...new Set([...brands])];
    expect(findCompetitorBrandMentions([
      "Stainless Steel is the material of this Bottle.",
      "dishwasher-safe bottle and lid is the care of this Bottle.",
      "straw cap is a feature of this Bottle.",
    ], { ownBrand: "YETI", knownBrands })).toEqual([]);
  });

  it("真实竞品标题仍提取品牌；正文命中仍拦截；`acme brand tumbler` 仍拒绝；ownBrand 不误报", () => {
    const knownBrands = extractKnownBrandsFromCompetitorTitles([
      "Stanley Quencher Tumbler 40 oz",
      "Owala FreeSip Stainless Steel Water Bottle",
    ], { ownBrand: "YETI" });
    expect(knownBrands).toContain("stanley");
    expect(knownBrands).toContain("owala");
    expect(findCompetitorBrandMentions(["A Stanley-style tumbler for travel."], { ownBrand: "YETI", knownBrands })).toEqual(["stanley"]);
    const filtered = filterKeywordsForListing(["acme brand tumbler", "water bottle"], { ownBrand: "YETI", knownBrands });
    expect(filtered.rejected).toContainEqual({ keyword: "acme brand tumbler", reason: "unknown_brand" });
    // 显式 "stanley brand bottle" 可提取 stanley（带明显 brand 标记）；ownBrand 不提取；
    // 精确数组：只允许标记单侧候选，普通类目词 bottle 不得混入
    const explicit = extractBrandLikeTokensFromKeywords(["stanley brand bottle"], { ownBrand: "YETI" });
    expect(explicit).toEqual(["stanley"]);
    expect(extractBrandLikeTokensFromKeywords(["yeti brand bottle"], { ownBrand: "YETI" })).toEqual([]);
  });
});

describe("品牌标记单侧提取精确合同（listing-keyword-policy.v2）", () => {
  const CASES: Array<{ input: string; ownBrand: string; expected: string[] }> = [
    { input: "stanley brand bottle", ownBrand: "YETI", expected: ["stanley"] },
    { input: "brand stanley bottle", ownBrand: "YETI", expected: ["stanley"] },
    { input: "stanley series tumbler", ownBrand: "YETI", expected: ["stanley"] },
    { input: "series stanley tumbler", ownBrand: "YETI", expected: ["stanley"] },
    { input: "brand bottle", ownBrand: "YETI", expected: [] },
    { input: "bottle brand series", ownBrand: "YETI", expected: [] },
    { input: "hydro brand bottle", ownBrand: "Hydro Jug", expected: [] },
  ];
  for (const c of CASES) {
    it(`${c.input} (ownBrand=${c.ownBrand}) 精确返回 ${JSON.stringify(c.expected)}`, () => {
      expect(extractBrandLikeTokensFromKeywords([c.input], { ownBrand: c.ownBrand })).toEqual(c.expected);
    });
  }

  it("普通无标记关键词全部返回空数组（精确）", () => {
    const keywords = ["kids water bottle", "straw cap bottle", "dishwasher safe bottle", "insulated bottle", "12 oz kids bottle"];
    expect(extractBrandLikeTokensFromKeywords(keywords, { ownBrand: "YETI" })).toEqual([]);
  });

  it("提取结果构造 knownBrands 后，正文含已确认事实值不得命中 bottle/dishwasher/safe", () => {
    const brands = extractBrandLikeTokensFromKeywords(["stanley brand bottle"], { ownBrand: "YETI" });
    const knownBrands = [...new Set([...brands])];
    expect(findCompetitorBrandMentions([
      "This Bottle has dishwasher-safe parts.",
    ], { ownBrand: "YETI", knownBrands })).toEqual([]);
    expect(knownBrands).not.toContain("bottle");
    expect(knownBrands).not.toContain("dishwasher");
    expect(knownBrands).not.toContain("safe");
  });
});

describe("R2 关键词形态：句子型/动词开头/句末标点/机械追加产品名的词必须被拒（红）", () => {
  it("红：句子型垃圾词不得进入正式关键词（当前会被当 long_tail 放行）", () => {
    const input = { ownBrand: "ukeetap", knownBrands: [] as string[] };
    const sentenceLike = [
      "Holds approximately 40-50 pieces of cutlery Organizer",
      "Can hold about 40-50 pieces of common cutlery",
      "Expand or contract to fit the drawer width",
      "Plastic organizer with expandable compartments, Organizer",
      "This is a kitchen drawer organizer for cutlery.",
    ];
    for (const s of sentenceLike) {
      const r = filterKeywordsForListing([s], input);
      expect(r.accepted, `句子型词应被拒: ${s}`).toEqual([]);
    }
  });

  it("不误杀 2-6 词自然名词短语（作为实现约束，始终应通过）", () => {
    const input = { ownBrand: "ukeetap", knownBrands: [] as string[] };
    const natural = ["drawer organizer", "kitchen drawer organizer", "silverware organizer", "expandable drawer organizer"];
    const r = filterKeywordsForListing(natural, input);
    expect(r.accepted).toEqual(natural);
  });

  it("风险词/竞品品牌即便出现在 Brief 也不得进入正式关键词（锁定）", () => {
    const input = { ownBrand: "ukeetap", knownBrands: ["stanley"] as string[] };
    const r = filterKeywordsForListing(
      ["best seller organizer", "guaranteed organizer", "stanley cup", "drawer organizer"],
      input,
    );
    expect(r.accepted).toEqual(["drawer organizer"]);
    expect(r.rejected).toContainEqual({ keyword: "best seller organizer", reason: "risk" });
    expect(r.rejected).toContainEqual({ keyword: "stanley cup", reason: "competitor_brand" });
  });
});
