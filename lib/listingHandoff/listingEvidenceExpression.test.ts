import { describe, expect, it } from "vitest";
import {
  buildListingClaimEvidenceIndex,
  verifyListingClaims,
  listingClaimsHaveEvidence,
} from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { EvidenceExpressionPack } from "@/lib/listingHandoff/listingEvidenceExpression";

function makeInput(productFacts: Array<{ field: string; label: string; value: string }>, pack?: EvidenceExpressionPack): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 2, researchRevision: 1 },
    productFacts,
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: ["Do not make absolute claims."],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...(pack ? { evidenceExpressions: pack } : {}),
  };
}

function makeDraft(titles: string[], bullets: string[], description = ""): Parameters<typeof verifyListingClaims>[0] {
  return {
    source: "real_ai_draft",
    version: 1,
    generatedAt: new Date().toISOString(),
    model: "real-ai-provider",
    composerVersion: "listing-composer-v1",
    generationPolicyVersion: "listing-generation-policy-v1",
    polishApplied: false,
    polishModel: null,
    humanReviewRequired: true,
    titles,
    bullets,
    description,
    keywords: [],
    sellingPoints: bullets.slice(0, 6),
    riskNotes: [],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: [],
  };
}

const SUNSCREEN_FACTS = [
  { field: "brand", label: "品牌", value: "Hawaiian Tropic" },
  { field: "product_type", label: "商品类型", value: "矿物防晒粉刷" },
  { field: "material", label: "材质", value: "塑料刷柄，合成纤维刷毛" },
  { field: "capacity", label: "容量", value: "0.15盎司" },
  { field: "functional_feature", label: "功能特性", value: "SPF 30 广谱防晒，防水防汗（80分钟），矿物粉质清爽不油腻，自带粉刷方便补涂。" },
  { field: "usage", label: "使用场景", value: "户外海滩游玩、日常通勤补涂防晒、旅行出差携带。" },
];

const EN_PACK: EvidenceExpressionPack = {
  schema: "listing-evidence-expression.v1",
  targetLanguage: "en",
  generatedAt: null,
  builder: "llm",
  expressions: [
    { factId: "brand", field: "brand", sourceValue: "Hawaiian Tropic", targetLanguage: "en", evidenceKind: "brand", approvedExpressions: ["Hawaiian Tropic"] },
    { factId: "product_type", field: "product_type", sourceValue: "矿物防晒粉刷", targetLanguage: "en", evidenceKind: "product_type", approvedExpressions: ["Mineral Sunscreen Brush"] },
    { factId: "material", field: "material", sourceValue: "塑料刷柄，合成纤维刷毛", targetLanguage: "en", evidenceKind: "material", approvedExpressions: ["plastic handle and synthetic bristles"] },
    { factId: "capacity", field: "capacity", sourceValue: "0.15盎司", targetLanguage: "en", evidenceKind: "capacity", approvedExpressions: ["0.15 oz", "0.15 ounce"] },
    { factId: "functional_feature", field: "functional_feature", sourceValue: "SPF 30 广谱防晒，防水防汗（80分钟），矿物粉质清爽不油腻，自带粉刷方便补涂。", targetLanguage: "en", evidenceKind: "feature", approvedExpressions: ["SPF 30 broad-spectrum protection", "water and sweat resistant for up to 80 minutes", "built-in brush for convenient reapplication"] },
    { factId: "usage", field: "usage", sourceValue: "户外海滩游玩、日常通勤补涂防晒、旅行出差携带。", targetLanguage: "en", evidenceKind: "usage", approvedExpressions: ["beach outings, daily commutes, and travel"] },
  ],
};

describe("Listing Evidence Expression Pack — index", () => {
  it("adds approved expressions as extra evidence entries", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const index = buildListingClaimEvidenceIndex(input);
    const ozEntries = index.filter((e) => e.normalizedValue === "0.15 oz");
    expect(ozEntries.length).toBeGreaterThan(0);
    const brushEntries = index.filter((e) => e.normalizedValue === "mineral sunscreen brush");
    expect(brushEntries.length).toBeGreaterThan(0);
  });
});

describe("Listing Evidence Expression Pack — validator", () => {
  it("Test A: product_type translation PASS", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const v = verifyListingClaims(makeDraft(["Hawaiian Tropic Mineral Sunscreen Brush SPF 30"], [], ""), input);
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("Test B: capacity unit conversion PASS, but compact alone FAIL", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const v = verifyListingClaims(makeDraft(["Hawaiian Tropic Mineral Sunscreen Brush SPF 30, 0.15 oz"], [], ""), input);
    expect(listingClaimsHaveEvidence(v)).toBe(true);
    // compact 无独立证据 → FAIL
    const v2 = verifyListingClaims(makeDraft(["compact 0.15 oz size"], [], ""), input);
    expect(listingClaimsHaveEvidence(v2)).toBe(false);
  });

  it("Test C: performance translation PASS", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const v = verifyListingClaims(
      makeDraft(
        ["Hawaiian Tropic Mineral Sunscreen Brush SPF 30, 0.15 oz"],
        ["Water and sweat resistant for up to 80 minutes"],
        "",
      ),
      input,
    );
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("Test D: absolute reinforcement FAIL", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    for (const claim of ["100% waterproof", "all-day waterproof", "guaranteed waterproof"]) {
      const v = verifyListingClaims(makeDraft([], [claim], ""), input);
      expect(listingClaimsHaveEvidence(v)).toBe(false);
    }
  });

  it("Test E: brief words without evidence FAIL", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    for (const claim of ["mess-free", "anywhere", "over makeup", "fits in a pocket", "portable"]) {
      const v = verifyListingClaims(makeDraft([], [claim], ""), input);
      expect(listingClaimsHaveEvidence(v)).toBe(false);
    }
  });

  it("Test F: mixed claim — supported part + unsupported part → FAIL", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const v = verifyListingClaims(
      makeDraft([], ["Water and sweat resistant for up to 80 minutes, perfect for all-day outdoor protection."], ""),
      input,
    );
    expect(listingClaimsHaveEvidence(v)).toBe(false);
  });

  it("Test G: Chinese exact fact still PASS (no regression)", () => {
    const input = makeInput(SUNSCREEN_FACTS, EN_PACK);
    const v = verifyListingClaims(
      makeDraft(
        ["Hawaiian Tropic 矿物防晒粉刷"],
        ["SPF 30 广谱防晒，防水防汗（80分钟），矿物粉质清爽不油腻，自带粉刷方便补涂。"],
        "",
      ),
      input,
    );
    expect(listingClaimsHaveEvidence(v)).toBe(true);
  });

  it("no pack → old behavior (Chinese verbatim PASS, English FAIL)", () => {
    const input = makeInput(SUNSCREEN_FACTS);
    const vZh = verifyListingClaims(
      makeDraft(["Hawaiian Tropic 矿物防晒粉刷"], ["SPF 30 广谱防晒，防水防汗（80分钟），矿物粉质清爽不油腻，自带粉刷方便补涂。"], ""),
      input,
    );
    expect(listingClaimsHaveEvidence(vZh)).toBe(true);
    const vEn = verifyListingClaims(makeDraft(["Hawaiian Tropic Mineral Sunscreen Brush SPF 30"], [], ""), input);
    expect(listingClaimsHaveEvidence(vEn)).toBe(false);
  });
});
