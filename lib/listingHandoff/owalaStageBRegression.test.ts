import { describe, expect, it } from "vitest";
import {
  verifyListingClaims,
  listingClaimsHaveEvidence,
} from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

/**
 * Owala 回归：composer 将多个 functional facts 用顿号/逗号连接进 description 句2，
 * splitSegments 吞掉句尾标点后，带句号的 evidence 值无法匹配（"宽口设计,便于清洁和加冰." vs
 * "宽口设计,便于清洁和加冰"），导致组合草稿被 unclassified_factual_claim 误杀。
 *
 * 修复前：FAIL（unclassified_factual_claim）
 * 修复后：PASS
 */
const OWALA_INPUT: ListingGenerationInput = {
  schema: "listing-generation-input.v1",
  source: { handoffRevision: 2, researchRevision: 1 },
  productFacts: [
    { field: "brand", label: "品牌", value: "Owala" },
    { field: "product_type", label: "商品类型", value: "Water Bottle" },
    { field: "series_or_model", label: "系列/型号", value: "FreeSip" },
    { field: "material", label: "材质", value: "Stainless Steel" },
    { field: "capacity", label: "容量", value: "24 oz" },
    { field: "color_or_variant", label: "颜色", value: "Very, Very Dark" },
    { field: "functional_feature", label: "功能特性", value: "convenient carry loop doubles as a lock Double-wall insulation keeps drinks cold for up to 24 hours" },
    { field: "compatibility", label: "兼容性", value: "cup holder-friendly base This bottle is wider than standard cupholders and may only fit in oversized or specialty cupholders designed for larger containers" },
    { field: "care", label: "保养", value: "宽口设计，便于清洁和加冰。" },
    { field: "construction", label: "结构", value: "双层隔热不锈钢结构，宽口设计。" },
    { field: "included_components", label: "随附组件", value: "FreeSip 吸嘴（内置吸管）、按钮式上盖、提环。" },
    { field: "operation", label: "操作", value: "按键打开上盖；可通过内置吸管直立吸饮，也可倾斜瓶身从吸嘴开口直接饮用；提环可兼作锁扣。" },
    { field: "other", label: "其他", value: "饮品最长可保冷 24 小时。瓶身比标准杯架更宽，可能仅适配超大或特殊杯架。" },
  ],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: ["Do not make absolute claims."],
  unknowns: [],
  humanReviewRequired: true,
  researchMode: "market_research_only",
  promotionEligible: false,
};

function makeDraft(description: string): AiListingPackDraft {
  return {
    source: "deterministic_composition_v1",
    version: 1,
    generatedAt: "2026-08-12T00:00:00.000Z",
    model: "listing-composer-v1",
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    humanReviewRequired: true,
    titles: ["Owala FreeSip 24 oz Stainless Steel Water Bottle, Very, Very Dark"],
    bullets: ["Owala FreeSip Water Bottle", "Stainless Steel 24 oz", "Very, Very Dark"],
    description,
    keywords: ["Owala", "FreeSip", "24 oz", "Stainless Steel", "Water Bottle", "Very, Very Dark", "Owala Water Bottle"],
    sellingPoints: ["Owala FreeSip Water Bottle", "Stainless Steel 24 oz", "Very, Very Dark"],
    riskNotes: ["商品信息来自已人工确认的事实，未包含未经验证的声明。"],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: ["请人工核对事实字段与值后完善表达。"],
  };
}

describe("Owala stage-B claim validation regression", () => {
  it("OW-1: composer 组合 description（多 functional facts 顿号连接）→ PASS", () => {
    const description = "Owala FreeSip Water Bottle，适合日常使用的实用选择。convenient carry loop doubles as a lock Double-wall insulation keeps drinks cold for up to 24 hours、cup holder-friendly base This bottle is wider than standard cupholders and may only fit in oversized or specialty cupholders designed for larger containers、宽口设计,便于清洁和加冰。24 oz容量, Stainless Steel材质, Very, Very Dark颜色。";
    const v = verifyListingClaims(makeDraft(description), OWALA_INPUT);
    expect(v.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("OW-2: care fact 单独复述（带句号）→ PASS", () => {
    const v = verifyListingClaims(makeDraft("宽口设计，便于清洁和加冰。"), OWALA_INPUT);
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("OW-3: care fact 组合后无句号形态 → PASS（修复点）", () => {
    const v = verifyListingClaims(makeDraft("convenient carry loop doubles as a lock、宽口设计,便于清洁和加冰"), OWALA_INPUT);
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("OW-4: 非法强化仍拦截（unsupported 不被放行）", () => {
    const v = verifyListingClaims(makeDraft("100% waterproof"), OWALA_INPUT);
    expect(listingClaimsHaveEvidence(v)).toBe(false);
  });
});
