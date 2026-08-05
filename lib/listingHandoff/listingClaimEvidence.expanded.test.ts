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

function expectReject(bullets: string[]) {
  const r = verifyListingClaims(baseDraft(bullets), matrixInput());
  expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  expect(listingClaimsHaveEvidence(r)).toBe(false);
  return r;
}

function expectPass(bullets: string[]) {
  const r = verifyListingClaims(baseDraft(bullets), matrixInput());
  expect(r.unsupportedClaims).toEqual([]);
  expect(listingClaimsHaveEvidence(r)).toBe(true);
  return r;
}

// ═══ 扩展对抗矩阵（第十六节，≥40 项）═══

describe("扩展对抗 — 材质变形", () => {
  it("E1. 航空级 ABS", () => expectReject(["航空级 ABS"]));
  it("E2. 工程级 ABS", () => expectReject(["工程级 ABS"]));
  it("E3. 高品质 ABS", () => expectReject(["高品质 ABS"]));
  it("E4. 环保型 ABS", () => expectReject(["环保型 ABS"]));
  it("E5. ABS 混合材质", () => expectReject(["ABS 混合材质"]));
  it("E6. reinforced ABS", () => expectReject(["reinforced ABS"]));
});

describe("扩展对抗 — 尺寸和重量", () => {
  it("E7. 加大型", () => expectReject(["加大型"]));
  it("E8. 超轻", () => expectReject(["超轻"]));
  it("E9. lightweight", () => expectReject(["lightweight"]));
  it("E10. extra long", () => expectReject(["extra long"]));
  it("E11. compact size", () => expectReject(["compact size"]));
  it("E12. 比普通款更轻", () => expectReject(["比普通款更轻"]));
});

describe("扩展对抗 — 认证和标准", () => {
  it("E13. 品质认证", () => expectReject(["品质认证"]));
  it("E14. 安全认证", () => expectReject(["安全认证"]));
  it("E15. meets industry standards", () => expectReject(["meets industry standards"]));
  it("E16. certified quality", () => expectReject(["certified quality"]));
});

describe("扩展对抗 — 兼容性", () => {
  it("E17. 广泛适配", () => expectReject(["广泛适配"]));
  it("E18. universally compatible", () => expectReject(["universally compatible"]));
  it("E19. works with most devices", () => expectReject(["works with most devices"]));
  it("E20. 适配主流型号", () => expectReject(["适配主流型号"]));
});

describe("扩展对抗 — 性能和耐久", () => {
  it("E21. 经久使用", () => expectReject(["经久使用"]));
  it("E22. 持久耐用", () => expectReject(["持久耐用"]));
  it("E23. 抗冲击", () => expectReject(["抗冲击"]));
  it("E24. heavy duty", () => expectReject(["heavy duty"]));
  it("E25. enhanced durability", () => expectReject(["enhanced durability"]));
  it("E26. superior performance", () => expectReject(["superior performance"]));
});

describe("扩展对抗 — 产地", () => {
  it("E27. 原装进口", () => expectReject(["原装进口"]));
  it("E28. imported quality", () => expectReject(["imported quality"]));
  it("E29. locally made", () => expectReject(["locally made"]));
  it("E30. made in USA", () => expectReject(["made in USA"]));
});

describe("扩展对抗 — 效果和绝对承诺", () => {
  it("E31. 绝对可靠", () => expectReject(["绝对可靠"]));
  it("E32. 永不损坏", () => expectReject(["永不损坏"]));
  it("E33. 100 percent effective", () => expectReject(["100 percent effective"]));
  it("E34. guaranteed results", () => expectReject(["guaranteed results"]));
  it("E35. never fails", () => expectReject(["never fails"]));
});

describe("扩展对抗 — AI Reference 事实化", () => {
  it("E36. 专为户外打造", () => expectReject(["专为户外打造"]));
  it("E37. 专为通勤设计", () => expectReject(["专为通勤设计"]));
  it("E38. 为户外场景专门研发", () => expectReject(["为户外场景专门研发"]));
  it("E39. 为现代生活精心打造", () => expectReject(["为现代生活精心打造"]));
  it("E40. 专为简洁生活设计", () => expectReject(["专为简洁生活设计"]));
});

describe("扩展对抗 — Unknown / Conflict 补全", () => {
  it("E41. 防水等级 IPX8", () => expectReject(["防水等级 IPX8"]));
  it("E42. 产地为德国", () => expectReject(["产地为德国"]));
  it("E43. 中国制造", () => expectReject(["中国制造"]));
  it("E44. 宽度取 20cm", () => expectReject(["宽度取 20cm"]));
  it("E45. 尺寸为 22cm", () => expectReject(["尺寸为 22cm"]));
});

describe("扩展对抗 — 数字新增", () => {
  it("E46. 容量 1L", () => expectReject(["容量 1L"]));
  it("E47. 功率 100W", () => expectReject(["功率 100W"]));
  it("E48. 电压 220V", () => expectReject(["电压 220V"]));
  it("E49. 数量 2 件", () => expectReject(["数量 2 件"]));
  it("E50. 速度 10m/s", () => expectReject(["速度 10m/s"]));
});
