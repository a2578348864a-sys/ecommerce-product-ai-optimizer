import { describe, expect, it } from "vitest";
import { buildAutoKeywordPlan } from "@/lib/listingHandoff/listingAutoKeywordPlan";

const facts = [
  { field: "brand", label: "Brand", value: "BELLA" },
  { field: "product_type", label: "Type", value: "Toaster" },
  { field: "material", label: "Material", value: "Stainless Steel" },
  { field: "capacity", label: "Capacity", value: "2 slice" },
];

describe("轮 16：自动关键词计划（auto_suggested）", () => {
  it("无 Brief 时：选主词 + 辅助词 + 后台词，来源可追溯", () => {
    const plan = buildAutoKeywordPlan({
      keywordCandidates: ["toaster", "bread toaster", "2 slice toaster", "extra wide toaster", "stainless steel toaster", "crumb tray toaster", "compact toaster"],
      confirmedFacts: facts,
      ownBrand: "bella",
      knownBrands: ["owala", "brumate"],
    });
    expect(plan.primaryKeyword).toBe("toaster");
    expect(plan.supportingKeywords.length).toBeGreaterThanOrEqual(2);
    expect(plan.supportingKeywords.length).toBeLessThanOrEqual(5);
    expect(plan.backendSearchTerms.length).toBeLessThanOrEqual(10);
    expect(plan.provenance.length).toBeGreaterThan(0);
  });

  it("属性词需对应 confirmed fact：无材质事实时 stainless steel 拒绝", () => {
    const plan = buildAutoKeywordPlan({
      keywordCandidates: ["stainless steel toaster", "toaster"],
      confirmedFacts: facts.filter((f) => f.field !== "material"),
      ownBrand: "bella",
      knownBrands: [],
    });
    expect(plan.rejected.some((r) => r.keyword === "stainless steel toaster")).toBe(true);
    expect(plan.primaryKeyword).toBe("toaster");
  });

  it("品牌词（自身+竞品）与最高级/疗效承诺拒绝", () => {
    const plan = buildAutoKeywordPlan({
      keywordCandidates: ["bella toaster", "owala bottle", "best toaster", "guaranteed toaster", "toaster"],
      confirmedFacts: facts,
      ownBrand: "bella",
      knownBrands: ["owala"],
    });
    expect(plan.rejected.some((r) => r.keyword === "bella toaster")).toBe(true);
    expect(plan.rejected.some((r) => r.keyword === "owala bottle")).toBe(true);
    expect(plan.rejected.some((r) => r.keyword === "best toaster")).toBe(true);
    expect(plan.rejected.some((r) => r.keyword === "guaranteed toaster")).toBe(true);
    expect(plan.primaryKeyword).toBe("toaster");
  });

  it("普通类目词可用（无属性词也能进计划）", () => {
    const plan = buildAutoKeywordPlan({
      keywordCandidates: ["kitchen toaster", "toaster"],
      confirmedFacts: facts,
      ownBrand: "bella",
      knownBrands: [],
    });
    expect(plan.supportingKeywords).toContain("kitchen toaster");
  });
});
