import { describe, expect, it } from "vitest";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

/** R1 规格矩阵的允许事实集合 */
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

function baseDraft(bullets: string[], overrides: Partial<AiListingPackDraft> = {}): AiListingPackDraft {
  return {
    source: "mock_ai_draft", version: 1, generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock", humanReviewRequired: true,
    titles: ["Test title"], bullets, description: "Draft description.",
    keywords: [], sellingPoints: [], riskNotes: [],
    complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
    ...overrides,
  };
}

function resultFor(bullets: string[], overrides: Partial<AiListingPackDraft> = {}) {
  return verifyListingClaims(baseDraft(bullets, overrides), matrixInput());
}

function expectReject(bullets: string[], reasonContains?: string) {
  const r = resultFor(bullets);
  expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  if (reasonContains) expect(r.reasonCode).toContain(reasonContains);
  expect(listingClaimsHaveEvidence(r)).toBe(false);
  return r;
}

function expectPass(bullets: string[]) {
  const r = resultFor(bullets);
  expect(r.unsupportedClaims).toEqual([]);
  expect(listingClaimsHaveEvidence(r)).toBe(true);
  return r;
}

// ═══ R1 55 项矩阵（第十五节，原样重跑）═══

describe("R1 55 项矩阵 — 合法事实", () => {
  it("1. 品牌 TestBrand", () => expectPass(["TestBrand"]));
  it("2. 类目 Kitchen", () => expectPass(["Kitchen"]));
  it("3. ABS 材质外壳", () => expectPass(["ABS 材质外壳"]));
  it("4. 长度 20cm", () => expectPass(["长度 20cm"]));
  it("5. 重量 500g", () => expectPass(["重量 500g"]));
  it("6. 等价单位（500 克）", () => expectPass(["重量 500 克"]));
});

describe("R1 55 项矩阵 — 数字新增（全部拒绝）", () => {
  it("7. 重量 800g", () => expectReject(["重量 800g"], "unsupported_numeric"));
  it("8. 长度 25cm", () => expectReject(["长度 25cm"], "unsupported_numeric"));
  it("9. 耐温 200℃", () => expectReject(["耐温 200℃"], "unsupported_numeric"));
  it("10. 提升 50%", () => expectReject(["提升 50%"], "unsupported"));
  it("11. 使用寿命 10 年", () => expectReject(["使用寿命 10 年"], "unsupported_numeric"));
});

describe("R1 55 项矩阵 — 材质扩大（全部拒绝）", () => {
  it("12. 航空级 ABS", () => expectReject(["航空级 ABS"], "unsupported_material"));
  it("13. 食品级 ABS", () => expectReject(["食品级 ABS"], "unsupported_material"));
  it("14. 医疗级 ABS", () => expectReject(["医疗级 ABS"], "prohibited"));
  it("15. ABS 复合材料", () => expectReject(["ABS 复合材料"], "unsupported_material"));
  it("16. 环保 ABS", () => expectReject(["环保 ABS"], "unsupported_material"));
});

describe("R1 55 项矩阵 — 尺寸模糊（全部拒绝）", () => {
  it("17. 超大尺寸", () => expectReject(["超大尺寸"], "unsupported_dimension"));
  it("18. 加长款设计", () => expectReject(["加长款设计"], "unsupported_dimension"));
  it("19. 轻量化设计", () => expectReject(["轻量化设计"], "unsupported_dimension"));
  it("20. 超轻", () => expectReject(["超轻"], "unsupported_dimension"));
});

describe("R1 55 项矩阵 — 认证（全部拒绝）", () => {
  it("21. 官方认证", () => expectReject(["官方认证"], "prohibited"));
  it("22. 国际认证", () => expectReject(["国际认证"], "unsupported_certification"));
  it("23. 安全认证", () => expectReject(["安全认证"], "unsupported_certification"));
  it("24. 符合 ISO 标准", () => expectReject(["符合 ISO 标准"], "unsupported_certification"));
  it("25. certified product", () => expectReject(["certified product"], "unsupported_certification"));
});

describe("R1 55 项矩阵 — 兼容性（全部拒绝）", () => {
  it("26. 兼容 iPhone", () => expectReject(["兼容 iPhone"], "unsupported_compatibility"));
  it("27. 适用于 Android", () => expectReject(["适用于 Android"], "unsupported_compatibility"));
  it("28. 通用所有型号", () => expectReject(["通用所有型号"], "unsupported_compatibility"));
  it("29. works with all devices", () => expectReject(["works with all devices"], "unsupported_compatibility"));
});

describe("R1 55 项矩阵 — 性能（全部拒绝）", () => {
  it("30. 高强度设计", () => expectReject(["高强度设计"], "unsupported_performance"));
  it("31. 超耐用", () => expectReject(["超耐用"], "unsupported_performance"));
  it("32. 防水", () => expectReject(["防水"], "unsupported_performance"));
  it("33. 防摔", () => expectReject(["防摔"], "unsupported_performance"));
  it("34. 高性能", () => expectReject(["高性能"], "unsupported_performance"));
  it("35. 提升效率", () => expectReject(["提升效率"], "unsupported_performance"));
  it("36. 更快更强更持久", () => expectReject(["更快更强更持久"], "unsupported_performance"));
});

describe("R1 55 项矩阵 — AI Reference 事实化（全部拒绝）", () => {
  it("37. 专为户外设计", () => expectReject(["专为户外设计"], "ai_reference"));
  it("38. 专为通勤人士研发", () => expectReject(["专为通勤人士研发"], "ai_reference"));
  it("39. 经久耐用", () => expectReject(["经久耐用"], "unsupported_performance"));
});

describe("R1 55 项矩阵 — Unknown / Conflict（全部拒绝）", () => {
  it("40. 防水等级 IPX7", () => expectReject(["防水等级 IPX7"], "unknown"));
  it("41. 美国制造", () => expectReject(["美国制造"], "unsupported_origin"));
  it("42. 输出宽度 20cm（冲突未解决）", () => expectReject(["宽度 20cm"], "conflict"));
  it("43. 输出宽度 22cm（冲突未解决）", () => expectReject(["宽度 22cm"], "conflict"));
  it("44. 输出约 21cm（冲突未解决）", () => expectReject(["宽度约 21cm"], "conflict"));
});

describe("R1 55 项矩阵 — Prohibited 变形（全部拒绝）", () => {
  it("45. 100% 有效", () => expectReject(["100% 有效"], "unsupported_absolute"));
  it("46. 百分百有效", () => expectReject(["百分百有效"], "unsupported_effect"));
  it("47. guaranteed effective", () => expectReject(["guaranteed effective"], "unsupported_effect"));
  it("48. 官方权威认证", () => expectReject(["官方权威认证"], "unsupported_certification"));
  it("49. 永久不会损坏", () => expectReject(["永久不会损坏"], "unsupported_absolute"));
  it("50. 医用级材质", () => expectReject(["医用级材质"], "unsupported_material"));
});

describe("R1 55 项矩阵 — 合法非事实文案（允许）", () => {
  it("51. 简洁标题结构", () => expectPass(["简洁标题结构"]));
  it("52. 轻松融入日常使用", () => expectPass(["轻松融入日常使用"]));
  it("53. 现代简约风格", () => expectPass(["现代简约风格"]));
  it("54. 日常使用的实用选择", () => expectPass(["日常使用的实用选择"]));
  it("55. 值得信赖的优质之选", () => expectPass(["值得信赖的优质之选"]));
});
