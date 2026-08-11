import { describe, expect, it } from "vitest";
import {
  buildListingBrief,
  withListingBrief,
} from "@/lib/listingHandoff/listingBrief";
import {
  computeListingGenerationFingerprint,
  type ListingGenerationInput,
} from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingClaimEvidenceIndex, verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import { buildTaskLinkedAiPrompt } from "@/lib/server/taskLinkedAiListing";

function goldenInput(): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "brand", label: "品牌", value: "BrüMate" },
      { field: "capacity", label: "容量", value: "18 fluid ounces" },
      { field: "functional_feature", label: "功能特点", value: "Leakproof design with covered, SoftSip silicone straw" },
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

describe("v2.2.16 Listing Brief safety boundary", () => {
  it("normalizes a marketing-only brief and rejects unsupported absolute claims", () => {
    const accepted = buildListingBrief({
      coreSellingPoint: "  Covered straw for everyday carrying  ",
      targetAudience: " commuters ",
      useScenario: "daily commute",
      differentiation: "easy-to-use straw design",
      contentEmphasis: "comfort and everyday routine",
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.brief?.coreSellingPoint).toBe("Covered straw for everyday carrying");
      expect(accepted.brief?.targetAudience).toBe("commuters");
    }

    const rejected = buildListingBrief({ coreSellingPoint: "The best and 100% safe bottle" });
    expect(rejected).toMatchObject({ ok: false, code: "listing_brief_unsupported_claim" });
  });

  it("does not add a brief to confirmed product facts or Claim Evidence", () => {
    const base = goldenInput();
    const result = buildListingBrief({
      coreSellingPoint: "A perfect bottle for busy travel",
      targetAudience: "commuters",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const input = withListingBrief(base, result.brief);
    expect(input.productFacts).toEqual(base.productFacts);
    expect(input.productFacts.map((fact) => fact.value)).not.toContain("A perfect bottle for busy travel");
    expect(buildListingClaimEvidenceIndex(input).map((item) => item.normalizedValue)).not.toContain("a perfect bottle for busy travel");

    const verification = verifyListingClaims({
      version: 1,
      generatedAt: "2026-08-11T00:00:00.000Z",
      source: "real_ai_draft",
      model: "test",
      humanReviewRequired: true,
      titles: ["BrüMate Best Travel Bottle"],
      bullets: ["Leakproof design with covered, SoftSip silicone straw"],
      description: "18 fluid ounces for everyday carrying.",
      keywords: [],
      backendSearchTerms: [],
      sellingPoints: [],
      riskNotes: [],
      reviewChecklist: [],
      blockedClaims: [],
      complianceWarnings: [],
    }, input);
    expect(verification.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("keeps the no-brief input and fingerprint exactly compatible", () => {
    const base = goldenInput();
    expect(withListingBrief(base, null)).toBe(base);
    expect(computeListingGenerationFingerprint(withListingBrief(base, null))).toBe(computeListingGenerationFingerprint(base));
  });

  it("passes a brief to the AI as marketing guidance, never as confirmed facts", () => {
    const result = buildListingBrief({
      coreSellingPoint: "Emphasize the covered straw for everyday routines",
      useScenario: "commuting and travel",
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.brief) return;
    const prompt = buildTaskLinkedAiPrompt({
      facts: goldenInput().productFacts.map((fact) => ({ factId: fact.field, ...fact })),
      plan: {} as never,
      keywordBrief: null,
      listingBrief: result.brief,
      prohibitedClaims: [],
    });
    expect(prompt).toContain("LISTING_CREATION_BRIEF_START");
    expect(prompt).toContain("Emphasize the covered straw for everyday routines");
    expect(prompt).toContain("not a confirmed product fact");
    expect(prompt).toContain("CONFIRMED_FACTS_START");
    expect(prompt.split("CONFIRMED_FACTS_START")[1]?.split("CONFIRMED_FACTS_END")[0]).not.toContain("Emphasize the covered straw");
  });
});
