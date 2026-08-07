import { describe, expect, it } from "vitest";
import { verifyListingClaims, listingClaimsHaveEvidence } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { AiListingPackDraft } from "@/lib/aiListingDraft";

function owalaInput(): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 3, researchRevision: 2 },
    productFacts: [
      { field: "brand", label: "品牌", value: "Owala" },
      { field: "product_type", label: "商品类型", value: "Water Bottle" },
      { field: "series_or_model", label: "系列/型号", value: "FreeSip" },
      { field: "material", label: "材质", value: "Stainless Steel" },
      { field: "capacity", label: "容量", value: "24 oz" },
      { field: "color_or_variant", label: "颜色/款式", value: "Out of the Blue" },
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
  };
}

function baseDraft(overrides: Partial<AiListingPackDraft>): AiListingPackDraft {
  return {
    source: "mock_ai_draft", version: 1, generatedAt: "2026-08-08T00:00:00.000Z",
    model: "mock", humanReviewRequired: true,
    titles: [], bullets: [], description: "", keywords: [], sellingPoints: [],
    riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
    ...overrides,
  };
}

describe("V2.1.4 组合事实 Claim Evidence", () => {
  it("C1. 组合 5 个 confirmed facts 的 Title 通过（Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue）", () => {
    const r = verifyListingClaims(
      baseDraft({ titles: ["Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue"] }),
      owalaInput(),
    );
    expect(r.unsupportedClaims).toEqual([]);
    expect(listingClaimsHaveEvidence(r)).toBe(true);
  });

  it("C2. 组合 Bullet（capacity+material+type）通过", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["24 oz Stainless Steel Water Bottle"] }), owalaInput());
    expect(r.unsupportedClaims).toEqual([]);
  });

  it("C3. 未确认 leakproof 的组合句子被拒绝（fail-closed）", () => {
    const r = verifyListingClaims(baseDraft({ bullets: ["Owala FreeSip leakproof 24 oz bottle"] }), owalaInput());
    expect(r.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("C4. 组合 Description 通过（无风格/功能臆造）", () => {
    const r = verifyListingClaims(
      baseDraft({ description: "Owala FreeSip 24 oz Stainless Steel Water Bottle in Out of the Blue." }),
      owalaInput(),
    );
    expect(r.unsupportedClaims).toEqual([]);
  });

  it("C5. 组合 Keywords 通过（Owala FreeSip 组合词）", () => {
    const r = verifyListingClaims(
      baseDraft({ keywords: ["Owala FreeSip", "24 oz Water Bottle", "Stainless Steel Bottle"] }),
      owalaInput(),
    );
    expect(r.unsupportedClaims).toEqual([]);
  });
});
