import { describe, expect, it } from "vitest";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";

function baseInput(overrides: Partial<ListingGenerationInput> = {}): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "weight", label: "重量", value: "500g" },
      { field: "material", label: "材质", value: "ABS" },
      { field: "dimension", label: "尺寸", value: "20cm" },
    ],
    stableSourceFacts: [],
    creativeReferences: ["适合户外风格"],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...overrides,
  };
}

function baseDraft(overrides: Partial<AiListingPackDraft> = {}): AiListingPackDraft {
  return {
    source: "mock_ai_draft",
    version: 1,
    generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock",
    humanReviewRequired: true,
    titles: ["Draft title"],
    bullets: [],
    description: "Draft description.",
    keywords: [],
    sellingPoints: [],
    riskNotes: [],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [],
    ...overrides,
  };
}

/** 规格第六节：数字（weight=500g → 输出 500g 通过；输出 800g 拒绝） */
describe("Claim Evidence Mapping — 数字", () => {
  it("D1. 文本含事实中的数值 → 通过", () => {
    const draft = baseDraft({ bullets: ["重量 500g 便于携带"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(result)).toBe(true);
  });

  it("D2. 文本含事实中不存在的数值 → 拒绝（number_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["重量 800g 便于携带"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toHaveLength(1);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_numeric_claim");
    expect(listingClaimsHaveEvidence(result)).toBe(false);
  });

  it("D3. 无数字事实时文本发明数字 → 拒绝（number_invented_without_fact）", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["仅 9.9 美元"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_numeric_claim");
  });
});

/** 规格第六节：材质（ABS → ABS材质 通过；航空级ABS 拒绝） */
describe("Claim Evidence Mapping — 材质", () => {
  it("M1. 文本含事实材质 → 通过", () => {
    const draft = baseDraft({ bullets: ["ABS 材质外壳"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("M2. 材质被扩写（航空级 ABS）→ 拒绝（unsupported_material）", () => {
    const draft = baseDraft({ bullets: ["航空级 ABS 外壳"] });
    const result = verifyListingClaims(draft, baseInput());
    // "航空级"是材质等级扩写 → unsupported_material_claim
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_material_claim");
  });

  it("M3. 无材质事实时出现材质断言 → 拒绝", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["优质金属用料"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_material_claim");
  });
});

/** 规格第六节：尺寸（20cm 通过；超大尺寸 拒绝） */
describe("Claim Evidence Mapping — 尺寸", () => {
  it("S1. 文本含事实尺寸 → 通过", () => {
    const draft = baseDraft({ bullets: ["尺寸 20cm 适合桌面"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("S2. 无证据定性词（超大尺寸）→ 拒绝（unsupported_qualifier）", () => {
    const input = baseInput({ productFacts: [{ field: "productName", label: "商品名", value: "Stand" }] });
    const draft = baseDraft({ bullets: ["超大尺寸设计"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_dimension_claim");
  });
});

/** 规格第六节：认证（无认证事实 → 已认证 拒绝） */
describe("Claim Evidence Mapping — 认证", () => {
  it("C1. 无认证事实输出认证声称 → 拒绝（certification_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["已通过 CE 认证"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_certification_claim");
  });

  it("C2. 有认证事实时输出认证 → 通过（值原样）", () => {
    const input = baseInput({ productFacts: [
      { field: "certification", label: "认证", value: "CE" },
    ] });
    const draft = baseDraft({ bullets: ["CE 认证"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：性能（无性能事实 → 提升50% 拒绝） */
describe("Claim Evidence Mapping — 性能", () => {
  it("P1. 无性能事实输出性能声称 → 拒绝（performance_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["提升 50% 效果"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_performance_claim");
  });

  it("P2. 有性能事实时输出性能值 → 通过（仅值原样，性能修饰词拒绝）", () => {
    const input = baseInput({ productFacts: [
      { field: "performance", label: "性能", value: "50%" },
    ] });
    // 仅值原样 → 通过
    const r1 = verifyListingClaims(baseDraft({ bullets: ["50%"] }), input);
    expect(r1.unsupportedClaims).toEqual([]);
    // 性能修饰词（提升）+ 值 → 拒绝（修饰无依据）
    const r2 = verifyListingClaims(baseDraft({ bullets: ["性能提升 50%"] }), input);
    expect(r2.unsupportedClaims.length).toBeGreaterThan(0);
  });
});

/** 规格第六节：兼容性（无兼容事实 → 兼容iPhone 拒绝） */
describe("Claim Evidence Mapping — 兼容性", () => {
  it("CP1. 无兼容事实输出兼容声称 → 拒绝（compatibility_without_evidence）", () => {
    const draft = baseDraft({ bullets: ["兼容 iPhone 15"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("unsupported_compatibility_claim");
  });

  it("CP2. 有兼容事实时输出兼容 → 通过（值原样）", () => {
    const input = baseInput({ productFacts: [
      { field: "compatibility", label: "兼容性", value: "iPhone 15" },
    ] });
    const draft = baseDraft({ bullets: ["iPhone 15"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：AI Reference（适合户外风格 → 专为户外设计 拒绝） */
describe("Claim Evidence Mapping — AI Reference", () => {
  it("R1. 参考事实化改写 → 拒绝（ai_reference_factualized）", () => {
    const draft = baseDraft({ bullets: ["专为户外设计"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims[0].reason).toBe("ai_reference_fact_claim");
  });

  it("R2. 参考仅用于措辞（非事实化）→ 通过", () => {
    const draft = baseDraft({ titles: ["Draft title"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：Unknown（未知材质 → 输出具体材质 拒绝） */
describe("Claim Evidence Mapping — Unknown", () => {
  it("U1. 未知项被补全 → 拒绝（unknown_completed）", () => {
    const input = baseInput({ unknowns: ["材质待确认"] });
    const draft = baseDraft({ bullets: ["采用不锈钢材质"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("unknown_fact_claim");
  });
});

/** 规格第六节：Conflict（尺寸 A/B → 输出选择 A 拒绝） */
describe("Claim Evidence Mapping — Conflict", () => {
  it("CF1. 冲突项被单方裁定 → 拒绝（conflict_adjudicated）", () => {
    const input = baseInput({ unknowns: ["尺寸 A/B 冲突"] });
    const draft = baseDraft({ bullets: ["采用尺寸 A"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toBe("conflict_fact_claim");
  });

  it("CF2. 冲突项仅提示人工确认（说明性）→ 通过", () => {
    const input = baseInput({ unknowns: ["尺寸 A/B 冲突"] });
    const draft = baseDraft({ bullets: ["尺寸存在冲突，需人工确认"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims).toEqual([]);
  });
});

/** 规格第六节：文案调整（结构/语气/非事实营销表达允许） */
describe("Claim Evidence Mapping — 文案调整", () => {
  it("W1. 非事实营销表达（结构/语气调整）→ 通过", () => {
    const draft = baseDraft({ bullets: ["简洁现代的设计", "实用之选"] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("W2. 说明性文本（草稿未发布/需人工审核）→ 不触发证据检查", () => {
    const draft = baseDraft({ bullets: ["This is a draft for human review only; nothing is certified or approved."] });
    const result = verifyListingClaims(draft, baseInput());
    expect(result.unsupportedClaims).toEqual([]);
  });
});

describe("R3 confirmed facts 自然组合", () => {
  const brumateInput = baseInput({
    productFacts: [
      { field: "brand", label: "品牌", value: "BrüMate" },
      { field: "series_or_model", label: "系列/型号", value: "Rise" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "capacity", label: "容量", value: "18oz" },
      { field: "material", label: "材质", value: "Silicone" },
      { field: "color_or_variant", label: "颜色/款式", value: "Red" },
      {
        field: "functional_feature",
        label: "功能特性",
        value: "Leakproof SoftSip silicone straw with covered cap",
      },
    ],
  });

  it("多个 confirmed facts 与事实原文短语自然组合 → PASS", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
    }), brumateInput);
    expect(result.unsupportedClaims).toEqual([]);
  });

  it("事实组合后追加未确认兼容性 → FAIL", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
      bullets: ["Fits most cup holders"],
    }), brumateInput);
    expect(result.unsupportedClaims.some((claim) => claim.reason === "unsupported_compatibility_claim")).toBe(true);
  });

  it("事实组合后追加未确认性能 → FAIL", () => {
    const result = verifyListingClaims(baseDraft({
      titles: ["BrüMate Rise Water Bottle 18oz with SoftSip Silicone Straw, Red"],
      bullets: ["Easy to squeeze with a spill-resistant drinking experience"],
    }), brumateInput);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });
});

/** 纯函数性质 */
describe("Claim Evidence Mapping — 纯函数性质", () => {
  it("PF1. 同输入同输出（确定性）", () => {
    const draft = baseDraft({ bullets: ["重量 800g"] });
    const input = baseInput();
    const a = verifyListingClaims(draft, input);
    const b = verifyListingClaims(draft, input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("PF2. 不修改输入", () => {
    const draft = baseDraft({ bullets: ["重量 800g"] });
    const input = baseInput();
    const draftBefore = JSON.stringify(draft);
    const inputBefore = JSON.stringify(input);
    verifyListingClaims(draft, input);
    expect(JSON.stringify(draft)).toBe(draftBefore);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });
});

/** 规格第六节：prohibitedClaims 原样与同义改写 */
describe("Claim Evidence Mapping — Prohibited Claims", () => {
  it("PR1. 禁止声明原样输出 → 拒绝（prohibited_claim）", () => {
    const input = baseInput({ prohibitedClaims: ["不承诺任何销量"] });
    const draft = baseDraft({ bullets: ["本产品不承诺任何销量表现"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("prohibited_claim");
  });

  it("PR2. 禁止声明同义改写（token 全含但乱序）→ 拒绝（prohibited_claim）", () => {
    // 乱序改写：两个 token 都完整出现但顺序颠倒（不会原样命中整句）
    const input = baseInput({ prohibitedClaims: ["保证盈利，稳赚不赔"] });
    const draft = baseDraft({ bullets: ["稳赚不赔，保证盈利的选择"] });
    const result = verifyListingClaims(draft, input);
    expect(result.unsupportedClaims[0].reason).toContain("prohibited_claim");
  });
});
