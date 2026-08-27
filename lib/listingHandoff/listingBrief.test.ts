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

describe("LISTING_CREATION_BRIEF persisted contract", () => {
  const FIELDS = { coreSellingPoint: "便携补水", targetAudience: "通勤", useScenario: "旅行", differentiation: "轻量", contentEmphasis: "舒适" };
  it("round-trips with the single legal schema", () => {
    const first = buildListingBrief({ ...FIELDS });
    expect(first.ok).toBe(true);
    const second = buildListingBrief(first.ok ? first.brief : null);
    expect(second.ok).toBe(true);
    expect(second.ok && second.brief).toEqual(first.ok ? first.brief : null);
  });
  it("rejects any other schema", () => {
    const r = buildListingBrief({ schema: "listing-creation-brief.v2", ...FIELDS });
    expect(r.ok).toBe(false);
  });
  it("rejects unknown fields", () => {
    const r = buildListingBrief({ ...FIELDS, internalId: "secret" });
    expect(r.ok).toBe(false);
  });
  it("rejects non-string values", () => {
    const r = buildListingBrief({ ...FIELDS, coreSellingPoint: ["array"] });
    expect(r.ok).toBe(false);
  });
  it("rejects over-limit instead of silently truncating", () => {
    const r = buildListingBrief({ ...FIELDS, coreSellingPoint: "x".repeat(301) });
    expect(r.ok).toBe(false);
  });
  it("returns brief null for empty object", () => {
    const r = buildListingBrief({});
    expect(r.ok).toBe(true);
    expect(r.ok && r.brief).toBeNull();
  });
  it("rejects unsupported claims and never mutates input", () => {
    const input = { ...FIELDS, differentiation: "guaranteed best" };
    const snapshot = JSON.stringify(input);
    const r = buildListingBrief(input);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

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
