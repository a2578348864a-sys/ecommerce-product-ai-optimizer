import { describe, expect, it } from "vitest";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { classifyBackendTerm, filterBackendSearchTerms, normalizeBackendTermForMatch } from "@/lib/listingHandoff/listingBackendTermSafety";

const NOW = "2026-08-10T00:00:00.000Z";

function brief(backend: string[]) {
  const built = buildListingKeywordBrief({
    primaryKeyword: "insulated water bottle",
    supportingKeywords: ["stainless steel bottle", "24 oz bottle"],
    backendSearchTerms: backend,
    source: "synthetic",
    capturedAt: NOW,
  });
  if (!built.ok) throw new Error("brief build failed");
  return built.brief;
}

const FACTS_NO_LEAK = [
  { field: "brand", value: "Owala", usageScopes: ["listing"] },
  { field: "product_type", value: "Water Bottle", usageScopes: ["listing"] },
  { field: "material", value: "Stainless Steel", usageScopes: ["listing"] },
  { field: "capacity", value: "24 oz", usageScopes: ["listing"] },
  { field: "construction", value: "double-wall vacuum insulation", usageScopes: ["listing"] },
  { field: "care", value: "dishwasher-safe removable parts", usageScopes: ["listing"] },
];

const FACTS_LEAK_RESISTANT = [
  ...FACTS_NO_LEAK,
  { field: "functional_feature", value: "leak-resistant lid with straw", usageScopes: ["listing"] },
];

const FACTS_LEAKPROOF = [
  ...FACTS_NO_LEAK,
  { field: "functional_feature", value: "leakproof lid", usageScopes: ["listing"] },
];

const FACTS_WATER_RESISTANT = [
  ...FACTS_NO_LEAK,
  { field: "material", value: "water-resistant material", usageScopes: ["listing"] },
];

describe("normalizeBackendTermForMatch", () => {
  it("NFC + lowercase + collapse whitespace + hyphen normalization", () => {
    expect(normalizeBackendTermForMatch("Vacuum   Flask")).toBe("vacuum flask");
    expect(normalizeBackendTermForMatch("leak-proof")).toBe("leak proof");
    expect(normalizeBackendTermForMatch("  DishWasher-Safe  ")).toBe("dishwasher safe");
  });
});

describe("classifyBackendTerm（方向性证据）", () => {
  it("leak-resistant fact 不支持 leakproof（claim strengthening 禁止）", () => {
    expect(classifyBackendTerm("leakproof tumbler", FACTS_LEAK_RESISTANT).classification).toBe("fact_bearing");
  });

  it("leakproof fact 支持 leakproof", () => {
    expect(classifyBackendTerm("leakproof tumbler", FACTS_LEAKPROOF).classification).toBe("safe_fact_bearing");
  });

  it("water-resistant fact 不支持 waterproof", () => {
    expect(classifyBackendTerm("waterproof bottle", FACTS_WATER_RESISTANT).classification).toBe("fact_bearing");
  });

  it("insulation fact 支持 insulated（词形变化）", () => {
    expect(classifyBackendTerm("insulated bottle", FACTS_NO_LEAK).classification).toBe("safe_fact_bearing");
  });

  it("dishwasher-safe fact 支持 dishwasher safe（词形变化）", () => {
    expect(classifyBackendTerm("dishwasher safe bottle", FACTS_NO_LEAK).classification).toBe("safe_fact_bearing");
  });

  it("generic 词不受事实约束", () => {
    expect(classifyBackendTerm("water bottle", FACTS_NO_LEAK).classification).toBe("generic");
    expect(classifyBackendTerm("vacuum flask", FACTS_NO_LEAK).classification).toBe("generic");
  });

  it("always_blocked 不因事实豁免", () => {
    expect(classifyBackendTerm("best seller bottle", FACTS_LEAKPROOF).classification).toBe("always_blocked");
    expect(classifyBackendTerm("guaranteed quality", FACTS_LEAKPROOF).classification).toBe("always_blocked");
  });
});

describe("filterBackendSearchTerms（Brief Authority + Fact Safety）", () => {
  it("CASE 1：Brief 没有 'sports hydration bottle' → REMOVE（AI 自造词）", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum flask", "sports hydration bottle"],
      keywordBrief: brief(["vacuum flask", "carry water bottle"]),
      confirmedFacts: FACTS_NO_LEAK,
    });
    expect(result.terms).toEqual(["vacuum flask"]);
    expect(result.warnings.some((w) => w.includes("sports hydration bottle") && w.includes("未在关键词资料中"))).toBe(true);
  });

  it("CASE 2：Brief 有 'Vacuum Flask'，AI 输出 'vacuum   flask' → normalized match → ALLOW", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum   flask"],
      keywordBrief: brief(["Vacuum Flask", "carry water bottle"]),
      confirmedFacts: FACTS_NO_LEAK,
    });
    expect(result.terms).toEqual(["vacuum   flask"]);
    expect(result.warnings).toEqual([]);
  });

  it("CASE 3：Brief 有 leakproof tumbler，facts 仅 leak-resistant → REMOVE（方向性证据）", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      keywordBrief: brief(["vacuum flask", "leakproof tumbler", "carry water bottle"]),
      confirmedFacts: FACTS_LEAK_RESISTANT,
    });
    expect(result.terms).toEqual(["vacuum flask", "carry water bottle"]);
    expect(result.warnings.some((w) => w.includes("leakproof tumbler") && w.includes("缺少足够商品事实依据"))).toBe(true);
  });

  it("CASE 4：Brief 有 leakproof tumbler，facts 有 leakproof lid → ALLOW", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum flask", "leakproof tumbler"],
      keywordBrief: brief(["vacuum flask", "leakproof tumbler"]),
      confirmedFacts: FACTS_LEAKPROOF,
    });
    expect(result.terms).toEqual(["vacuum flask", "leakproof tumbler"]);
    expect(result.warnings).toEqual([]);
  });

  it("CASE 5：Brief 有 waterproof bottle，facts 仅 water-resistant → REMOVE", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["waterproof bottle"],
      keywordBrief: brief(["waterproof bottle"]),
      confirmedFacts: FACTS_WATER_RESISTANT,
    });
    expect(result.terms).toEqual([]);
    expect(result.warnings.length).toBe(1);
  });

  it("CASE 6：Brief 有 dishwasher safe bottle，facts 有 dishwasher-safe parts → ALLOW（词形变化）", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["dishwasher safe bottle"],
      keywordBrief: brief(["dishwasher safe bottle"]),
      confirmedFacts: FACTS_NO_LEAK,
    });
    expect(result.terms).toEqual(["dishwasher safe bottle"]);
    expect(result.warnings).toEqual([]);
  });

  it("CASE 7：Brief 有 best seller bottle，即使人工 confirmed → ALWAYS BLOCK", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["best seller bottle"],
      keywordBrief: brief(["best seller bottle"]),
      confirmedFacts: FACTS_LEAKPROOF,
    });
    expect(result.terms).toEqual([]);
    expect(result.warnings.some((w) => w.includes("best seller bottle") && w.includes("禁止词"))).toBe(true);
  });

  it("CASE 8：过滤后 provenance 只含安全 terms（K1 保留、K2/K3 消失）", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "sports bottle"],
      keywordBrief: brief(["vacuum flask", "leakproof tumbler"]),
      confirmedFacts: FACTS_LEAK_RESISTANT,
    });
    // vacuum flask（K1 brief+generic）保留；leakproof（K2 无证据）删除；sports bottle（K3 不在 brief）删除
    expect(result.terms).toEqual(["vacuum flask"]);
  });

  it("generic term 仍需在 Brief 中（不因合理而放行）", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["carry bottle", "reusable drink bottle"],
      keywordBrief: brief(["carry bottle"]),
      confirmedFacts: FACTS_NO_LEAK,
    });
    expect(result.terms).toEqual(["carry bottle"]);
    expect(result.warnings.length).toBe(1);
  });

  it("去重保持", () => {
    const result = filterBackendSearchTerms({
      backendSearchTerms: ["vacuum flask", "Vacuum   Flask", "carry bottle"],
      keywordBrief: brief(["vacuum flask", "carry bottle"]),
      confirmedFacts: FACTS_NO_LEAK,
    });
    expect(result.terms).toEqual(["vacuum flask", "carry bottle"]);
  });
});
