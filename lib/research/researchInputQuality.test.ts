import { describe, expect, it } from "vitest";
import { scoreKeywordRelevance, pickBestKeyword, classifyCompetitorRelation } from "./researchInputQuality";

// THERMOS 夹具（任务 cmt0lmsqa000272kny9labi54：THERMOS FUNTAINER Kids Food Jar with Spoon, 10oz, Pink）
const THERMOS_PRODUCT = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
const THERMOS_ROWS = [
  { keyword: "lunch box", searchVolume: 1_481_183, relevance: 0.6 },
  { keyword: "thermos for hot food kids", searchVolume: 54_915, relevance: 0.8 },
  { keyword: "insulated food container", searchVolume: 281_596, relevance: 0.7 },
  { keyword: "kids lunch jar", searchVolume: 139_673, relevance: 0.5 },
];

describe("scoreKeywordRelevance（确定性相关度，无搜索量优先级）", () => {
  it("品牌/ASIN/容量不单独构成相关", () => {
    expect(scoreKeywordRelevance("THERMOS", THERMOS_PRODUCT, ["THERMOS"])).toBe(0);
    expect(scoreKeywordRelevance("B08NCVT244", THERMOS_PRODUCT, ["THERMOS"])).toBe(0);
    expect(scoreKeywordRelevance("10oz", THERMOS_PRODUCT, ["THERMOS"])).toBe(0);
  });

  it("商品标题关键词重合优先（thermos / kids / food jar 全部命中）", () => {
    const scoreThermos = scoreKeywordRelevance("thermos for hot food kids", THERMOS_PRODUCT);
    const scoreLunch = scoreKeywordRelevance("lunch box", THERMOS_PRODUCT);
    expect(scoreThermos).toBeGreaterThan(scoreLunch);
  });

  it("相关度为 0 的输入返回 0（fail-closed）", () => {
    expect(scoreKeywordRelevance("kitchen towels", THERMOS_PRODUCT, ["THERMOS"])).toBe(0);
  });
});

describe("pickBestKeyword（THERMOS 夹具必须选 thermos for hot food kids）", () => {
  it("当前夹具绝不允许选 lunch box（首行宽词）", () => {
    const best = pickBestKeyword(THERMOS_ROWS as never, THERMOS_PRODUCT);
    expect(best).not.toBeNull();
    expect(best?.keyword).toBe("thermos for hot food kids");
  });

  it("最大相关度为 0 → null（不从标题编造关键词）", () => {
    const best = pickBestKeyword([
      { keyword: "kitchen towels", searchVolume: 999_000 },
      { keyword: "bathroom mat", searchVolume: 500 },
    ] as never, THERMOS_PRODUCT);
    expect(best).toBeNull();
  });

  it("相关度相同时才以搜索量排序", () => {
    const best = pickBestKeyword([
      { keyword: "food jar", searchVolume: 1_000 },
      { keyword: "food jar", searchVolume: 99_000 },
    ] as never, "THERMOS FUNTAINER Kids Food Jar");
    expect(best?.keyword).toBe("food jar");
  });
});

describe("classifyCompetitorRelation（竞品三分类）", () => {
  const PRODUCT = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
  it("direct：核心商品词 ≥2 或命中产品短语", () => {
    expect(classifyCompetitorRelation("LunchBots Thermal Food Jar for Kids", PRODUCT, ["THERMOS"])).toBe("direct");
    expect(classifyCompetitorRelation("Food Jar", PRODUCT, ["THERMOS"])).toBe("direct");
  });
  it("adjacent：仅 1 个核心词", () => {
    expect(classifyCompetitorRelation("Silicone Lunch Box", PRODUCT, ["THERMOS"])).toBe("irrelevant");
  });
  it("irrelevant：0 个核心词", () => {
    expect(classifyCompetitorRelation("Glass Storage Containers", PRODUCT, ["THERMOS"])).toBe("irrelevant");
    expect(classifyCompetitorRelation("Thermal Lunch Jar", PRODUCT, ["THERMOS"])).toBe("adjacent");
  });
});

describe("真实业务数据相关度（第3轮：THERMOS 实际关键词）", () => {
  const REAL_ROWS = [
    { keyword: "lunch box", searchVolume: 1481183 },
    { keyword: "lunch bag", searchVolume: 564373 },
    { keyword: "bento box for kids", searchVolume: 281596 },
    { keyword: "lunch box kids", searchVolume: 426434 },
    { keyword: "thermos for hot food", searchVolume: 114244 },
    { keyword: "kids lunch box", searchVolume: 161302 },
  ];
  const PRODUCT = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
  it("真实数据：主词必须为 thermos for hot food（产品语义词胜过通用宽词）", () => {
    const best = pickBestKeyword(REAL_ROWS as never, PRODUCT, ["THERMOS"]);
    expect(best?.keyword).toBe("thermos for hot food");
  });
  it("thermos for hot food 相关度 > lunch box kids 相关度", () => {
    const s1 = scoreKeywordRelevance("thermos for hot food", PRODUCT, ["THERMOS"]);
    const s2 = scoreKeywordRelevance("lunch box kids", PRODUCT, ["THERMOS"]);
    expect(s1).toBeGreaterThan(s2);
  });
});
