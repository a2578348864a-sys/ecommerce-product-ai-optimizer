/**
 * Listing Product Identity 对抗测试（L13-L17/L8）
 *
 * 验证：Research 明确 THERMOS Water Bottle 时，
 * 最终 Listing Provider Prompt 的身份（类别/品牌/容量）只能来自 confirmedFacts；
 * Competitor/Sourcing/VOC/Keyword 参考层永不能覆盖身份（低层不能覆盖高层，L6）。
 */
import { describe, expect, it } from "vitest";
import { buildTaskLinkedAiPrompt } from "@/lib/server/taskLinkedAiListing";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

const THERMOS_FACTS = [
  { factId: "f1", field: "brand", label: "品牌", value: "THERMOS" },
  { factId: "f2", field: "product_type", label: "商品类型", value: "Water Bottle" },
  { factId: "f3", field: "series_or_model", label: "系列/型号", value: "FUNTAINER Water" },
  { factId: "f4", field: "capacity", label: "容量", value: "12oz" },
];

function buildPrompt(overrides: {
  creativeContext?: ListingGenerationInput["creativeContext"];
  prohibitedClaims?: string[];
} = {}) {
  return buildTaskLinkedAiPrompt({
    facts: THERMOS_FACTS,
    plan: {
      schema: "listing-plan.v1",
      primaryKeyword: "water bottle",
      supportingKeywords: ["kids bottle"],
      titlePlan: ["title plan"],
      bulletPlans: [{ featureFactIds: ["f2"], shopperAngle: "angle", keywordIds: [] }],
      descriptionPlan: "description plan",
      backendSearchTerms: [],
      missingFacts: [],
      prohibitedClaims: overrides.prohibitedClaims ?? [],
      planQuality: "safe_fact_draft",
    },
    keywordBrief: null,
    listingBrief: null,
    prohibitedClaims: overrides.prohibitedClaims ?? ["Do not make absolute claims."],
    creativeContext: overrides.creativeContext,
  });
}

describe("LISTING provider prompt identity（L8：真实 provider request 含 THERMOS 身份）", () => {
  it("CONFIRMED_FACTS 分区包含类别/品牌/系列/容量", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("CONFIRMED_FACTS_START");
    expect(prompt).toContain('"value":"Water Bottle"');
    expect(prompt).toContain('"value":"THERMOS"');
    expect(prompt).toContain('"value":"FUNTAINER Water"');
    expect(prompt).toContain('"value":"12oz"');
  });

  it("只允许 confirmed facts 作为产品事实（identity 强约束）", () => {
    const prompt = buildPrompt();
    expect(prompt).toContain("Only confirmed facts may be stated as product facts");
    expect(prompt).toContain("Every attribute value must be one of the exact confirmed values");
  });
});

describe("LISTING 参考层污染对抗（L14-L17：低层不能覆盖身份）", () => {
  it("Competitor 参考（Stanley Quencher 40oz）只在参考层，不进入 facts 分区", () => {
    const prompt = buildPrompt({
      creativeContext: {
        vocInsights: [],
        aiReferences: [],
        keywordCandidates: [],
        competitiveContext: ["Stanley Quencher 40oz is the market leader; different positioning."],
        sourcingContext: [],
      },
    });
    const factsStart = prompt.indexOf("CONFIRMED_FACTS_START");
    const factsEnd = prompt.indexOf("CONFIRMED_FACTS_END");
    const factsSection = prompt.slice(factsStart, factsEnd);
    expect(factsSection).toContain("Water Bottle");
    expect(factsSection).not.toContain("Stanley");
    expect(factsSection).not.toContain("40oz");
    expect(factsSection).not.toContain("Quencher");
    // 参考层独立分区 + NOT FACT 语义
    expect(prompt).toContain("RESEARCH_REFERENCE_LAYERS_START");
    expect(prompt).toContain("COMPETITIVE_CONTEXT_START");
    expect(prompt).toContain("COMPETITIVE_CONTEXT_END");
    expect(prompt).toContain("Stanley Quencher 40oz");
    expect(prompt).toContain("RESEARCH_REFERENCE_LAYERS_END");
  });

  it("Sourcing 参考（不锈钢保温杯 600ml）不能成为目标商品事实", () => {
    const prompt = buildPrompt({
      creativeContext: {
        vocInsights: [],
        aiReferences: [],
        keywordCandidates: [],
        competitiveContext: [],
        sourcingContext: ["1688 供应线索：不锈钢保温杯 600ml，供应商自有品牌"],
      },
    });
    const factsSection = prompt.slice(prompt.indexOf("CONFIRMED_FACTS_START"), prompt.indexOf("CONFIRMED_FACTS_END"));
    expect(factsSection).not.toContain("600ml");
    expect(factsSection).not.toContain("不锈钢");
    expect(prompt).toContain("SOURCING_CONTEXT_START");
    expect(prompt).toContain("SOURCING_CONTEXT_END");
    expect(prompt).toContain("不锈钢保温杯 600ml");
    expect(prompt).toContain("RESEARCH_REFERENCE_LAYERS_END");
  });

  it("VOC 参考（用户比较另一款精华液）不能写入当前商品事实", () => {
    const prompt = buildPrompt({
      creativeContext: {
        vocInsights: ["某用户比较了另一款维生素 C 精华液（serum），与本商品无关"],
        aiReferences: [],
        keywordCandidates: [],
        competitiveContext: [],
        sourcingContext: [],
      },
    });
    const factsSection = prompt.slice(prompt.indexOf("CONFIRMED_FACTS_START"), prompt.indexOf("CONFIRMED_FACTS_END"));
    expect(factsSection).not.toContain("serum");
    expect(factsSection).not.toContain("精华液");
    expect(prompt).toContain("VOC_INSIGHTS_START");
  });

  it("Keyword 只影响搜索表达，不能决定类别（L17）", () => {
    const prompt = buildPrompt({
      creativeContext: {
        vocInsights: [],
        aiReferences: [],
        keywordCandidates: ["vitamin c serum bottle 12oz", "face serum pump"],
        competitiveContext: [],
        sourcingContext: [],
      },
    });
    const factsSection = prompt.slice(prompt.indexOf("CONFIRMED_FACTS_START"), prompt.indexOf("CONFIRMED_FACTS_END"));
    expect(factsSection).not.toContain("serum");
    expect(prompt).toContain("KEYWORD_CANDIDATES_START");
    expect(prompt).toContain("KEYWORD_CANDIDATES_END");
    expect(prompt).toContain("vitamin c serum bottle 12oz");
    expect(prompt).toContain("RESEARCH_REFERENCE_LAYERS_END");
  });
});

describe("LISTING claim gate 保持（L5/L13）", () => {
  it("prohibitedClaims 进入 PROHIBITED_CLAIMS 分区且 RULES 禁止输出", () => {
    const prompt = buildPrompt({ prohibitedClaims: ["100% leakproof guarantee", "BPA free certified"] });
    expect(prompt).toContain("PROHIBITED_CLAIMS_START");
    expect(prompt).toContain("100% leakproof guarantee");
    expect(prompt).toContain("BPA free certified");
    expect(prompt).toContain("prohibitedClaims must not appear anywhere in the output");
  });

  it("身份锁定不放松 claim safety：facts 无 leakproof/BPA → 不能成为事实", () => {
    const prompt = buildPrompt();
    const factsSection = prompt.slice(prompt.indexOf("CONFIRMED_FACTS_START"), prompt.indexOf("CONFIRMED_FACTS_END"));
    expect(factsSection).not.toContain("leakproof");
    expect(factsSection).not.toContain("BPA");
  });
});
