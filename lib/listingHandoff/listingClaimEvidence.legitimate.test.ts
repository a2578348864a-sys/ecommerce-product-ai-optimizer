import { describe, expect, it } from "vitest";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

function matrixInput(): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "brand", label: "品牌", value: "TestBrand" },
      { field: "category", label: "类目", value: "Kitchen" },
      { field: "material", label: "材质", value: "ABS" },
      { field: "length", label: "长度", value: "20cm" },
      { field: "weight", label: "重量", value: "500g" },
      { field: "color", label: "颜色", value: "黑色" },
    ],
    stableSourceFacts: [],
    creativeReferences: ["适合户外风格", "强调简洁耐用的表达", "面向通勤人群", "现代科技感"],
    creativePreferences: {},
    prohibitedClaims: ["100%有效", "官方认证", "永不损坏", "医疗级", "绝对安全"],
    unknowns: ["防水等级未知", "产地未知", "宽度20cm与22cm冲突"],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

function baseDraft(bullets: string[]): AiListingPackDraft {
  return {
    source: "mock_ai_draft", version: 1, generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock", humanReviewRequired: true,
    titles: ["Test title"], bullets, description: "Draft description.",
    keywords: [], sellingPoints: [], riskNotes: [],
    complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
  };
}

function expectPass(bullets: string[]) {
  const r = verifyListingClaims(baseDraft(bullets), matrixInput());
  expect(r.unsupportedClaims).toEqual([]);
  expect(listingClaimsHaveEvidence(r)).toBe(true);
  return r;
}

// ═══ 合法表达矩阵（第十七节，≥30 项）═══

describe("合法表达 — 精确事实", () => {
  it("L1. 品牌 TestBrand", () => expectPass(["TestBrand"]));
  it("L2. 类目 Kitchen", () => expectPass(["Kitchen"]));
  it("L3. 材质 ABS", () => expectPass(["ABS"]));
  it("L4. 颜色 黑色", () => expectPass(["黑色"]));
  it("L5. 长度 20cm", () => expectPass(["长度 20cm"]));
  it("L6. 重量 500g", () => expectPass(["重量 500g"]));
  it("L7. 材质为 ABS", () => expectPass(["材质为 ABS"]));
  it("L8. ABS 材质", () => expectPass(["ABS 材质"]));
  it("L9. 尺寸为 20cm", () => expectPass(["尺寸为 20cm"]));
  it("L10. Brand: TestBrand", () => expectPass(["Brand: TestBrand"]));
  it("L11. Made of ABS", () => expectPass(["Made of ABS"]));
  it("L12. 品牌为 TestBrand", () => expectPass(["品牌为 TestBrand"]));
  it("L13. 产品类别为 Kitchen", () => expectPass(["产品类别为 Kitchen"]));
  it("L14. 重量为 500g", () => expectPass(["重量为 500g"]));
  it("L15. 长度 20 cm（单位空格）", () => expectPass(["长度 20 cm"]));
});

describe("合法表达 — 保守模板", () => {
  it("L16. TestBrand 品牌", () => expectPass(["TestBrand 品牌"]));
  it("L17. Kitchen 类目", () => expectPass(["Kitchen 类目"]));
  it("L18. 黑色款", () => expectPass(["黑色款"]));
  it("L19. 重量 500 克", () => expectPass(["重量 500 克"]));
  it("L20. ABS 材质外壳", () => expectPass(["ABS 材质外壳"]));
});

describe("合法表达 — 中性文案（无事实承诺）", () => {
  it("L21. 日常使用的实用选择", () => expectPass(["日常使用的实用选择"]));
  it("L22. 简洁实用的选择", () => expectPass(["简洁实用的选择"]));
  it("L23. 清晰呈现产品特点", () => expectPass(["清晰呈现产品特点"]));
  it("L24. 现代简约风格", () => expectPass(["现代简约风格"]));
  it("L25. 简洁现代的设计", () => expectPass(["简洁现代的设计"]));
  it("L26. 值得信赖的优质之选", () => expectPass(["值得信赖的优质之选"]));
  it("L27. 轻松融入日常使用", () => expectPass(["轻松融入日常使用"]));
  it("L28. 实用之选", () => expectPass(["实用之选"]));
  it("L29. 设计简约大方", () => expectPass(["设计简约大方"]));
  it("L30. 一款实用的产品", () => expectPass(["一款实用的产品"]));
  it("L31. 适用于日常场景", () => expectPass(["适用于日常场景"]));
  it("L32. 为生活增添便利", () => expectPass(["为生活增添便利"]));
  it("L33. 简单好用的选择", () => expectPass(["简单好用的选择"]));
  it("L34. 满足日常需求", () => expectPass(["满足日常需求"]));
  it("L35. 结构清晰", () => expectPass(["结构清晰"]));
  it("L36. 外观简洁", () => expectPass(["外观简洁"]));
  it("L37. 使用方便", () => expectPass(["使用方便"]));
});
