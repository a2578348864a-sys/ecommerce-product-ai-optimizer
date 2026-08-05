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

function baseDraft(overrides: Partial<AiListingPackDraft>): AiListingPackDraft {
  return {
    source: "mock_ai_draft", version: 1, generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock", humanReviewRequired: true,
    titles: ["Test title"], bullets: ["Confirmed fact."], description: "Draft description.",
    keywords: [], sellingPoints: [], riskNotes: [],
    complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
    ...overrides,
  };
}

// ═══ 跨字段全输出覆盖（第十八节）═══

describe("输出字段覆盖 — 非法 Claim 在任意字段均被拒绝", () => {
  it("F1. title 中的非法 Claim（环保 ABS）", () => {
    const r = verifyListingClaims(baseDraft({ titles: ["环保 ABS 收纳盒"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
    expect(listingClaimsHaveEvidence(r)).toBe(false);
  });

  it("F2. 第二个 bullet 中的非法 Claim（超耐用）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["合法事实", "超耐用设计"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F3. description 末尾的非法 Claim（美国制造）", () => {
    const r = verifyListingClaims(baseDraft({ description: "Draft description. 美国制造工艺" }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F4. keywords 中的非法 Claim（兼容 iPhone）", () => {
    const r = verifyListingClaims(baseDraft({ keywords: ["兼容 iPhone", "portable"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F5. sellingPoints 中的非法 Claim（高强度）", () => {
    const r = verifyListingClaims(baseDraft({ sellingPoints: ["高强度设计"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F6. riskNotes 中的非法 Claim（guaranteed effective）", () => {
    const r = verifyListingClaims(baseDraft({ riskNotes: ["guaranteed effective performance"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });
});

describe("输出字段覆盖 — 变形与混合", () => {
  it("F7. 同一非法 Claim 拆成相邻两段（防摔 + 防水 分句）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["防摔设计", "防水处理"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThanOrEqual(1);
  });

  it("F8. 大小写变化（Guaranteed Effective）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["Guaranteed Effective!"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F9. Unicode 空白（超 耐 用）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["超 耐 用"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F10. 中英文标点变化（环保、ABS）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["环保、ABS"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F11. % 和文字百分比（提升100% / 百分百提升）", () => {
    const r1 = verifyListingClaims(baseDraft({ bullets: ["提升 100%"] }), matrixInput());
    expect(r1.unsupportedClaims.length).toBeGreaterThan(0);
    const r2 = verifyListingClaims(baseDraft({ bullets: ["百分百提升"] }), matrixInput());
    expect(r2.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F12. 合法事实与非法修饰混合（ABS 环保材质）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["ABS 环保材质"] }), matrixInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F13. 合法事实与中性文案混合（ABS 材质，简洁实用）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["ABS 材质，简洁实用"] }), matrixInput());
    // "简洁实用"不在冻结允许集 → 默认拒绝（保守）
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("F14. 合法事实与冻结中性文案（ABS 材质，日常使用的实用选择）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["ABS 材质", "日常使用的实用选择"] }), matrixInput());
    expect(r.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(r)).toBe(true);
  });
});
