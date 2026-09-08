import { describe, expect, it } from "vitest";
import { claimEvidenceFilteredKeywordBrief } from "./listingGenerationService";
import { buildFinalizablePlannerCatalog, renderPlannerListing } from "./listingPlanner";
import { composeOptimizedListingDraft } from "./listingComposition";
import type { ListingGenerationInput } from "./listingGenerationInput";
import type { ListingPlan } from "./listingPlan";

const input: ListingGenerationInput = {
  schema: "listing-generation-input.v1",
  source: { handoffRevision: 2, researchRevision: 3 },
  productFacts: [
    { field: "brand", label: "Brand", value: "John Boos" },
    { field: "product_type", label: "Product type", value: "Cutting Board" },
    { field: "material", label: "Material", value: "Wood" },
    { field: "dimensions", label: "Dimensions", value: '16"L x 10"W x 1"Th' },
    { field: "weight", label: "Weight", value: "16 ounces" },
    { field: "included_components", label: "Included components", value: "Juice groove" },
    { field: "care", label: "Care", value: "Hand wash and dry thoroughly" },
    { field: "functional_feature", label: "Feature", value: "Reversible" },
  ],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: [],
  unknowns: [],
  humanReviewRequired: true,
  researchMode: "market_research_only",
  promotionEligible: false,
  englishRenderings: {
    schema: "english-rendering-pack.v1",
    version: 1,
    renderings: [
      { factId: "functional_feature", field: "functional_feature", sourceValue: "Reversible", english: "It features reversible.", method: "deterministic", confidence: "high", factRef: "functional_feature" },
    ],
  } as never,
};

const plan: ListingPlan = {
  schema: "listing-plan.v2",
  status: "ready",
  primaryKeyword: null,
  supportingKeywords: [],
  backendSearchTerms: [],
  missingFacts: [],
  prohibitedClaims: [],
  planQuality: "optimized",
  titlePlan: ["brand", "product_type", "material"],
  bulletPlans: [
    { role: "core_outcome", shopperNeed: "core", shopperAngle: "material", featureFactIds: ["material"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "pain_relief", shopperNeed: "fit", shopperAngle: "dimensions", featureFactIds: ["dimensions"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "use_scenario", shopperNeed: "feature", shopperAngle: "feature", featureFactIds: ["functional_feature"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "ease_of_use", shopperNeed: "included", shopperAngle: "included", featureFactIds: ["included_components"], keywordIds: [], claimMode: "verified", cannotSay: [] },
    { role: "proof_or_fit", shopperNeed: "care", shopperAngle: "care", featureFactIds: ["care"], keywordIds: [], claimMode: "verified", cannotSay: [] },
  ],
  descriptionPlan: "brand, product type, material and care",
};

describe("Listing finalization recovery", () => {
  it("filters unsupported and prohibited Brief terms before finalizable planning", () => {
    const brief = {
      schema: "listing-keyword-brief.v1" as const,
      primaryKeyword: "maple cutting board",
      supportingKeywords: ["cutting boards non toxic", "wood cutting boards for kitchen"],
      backendSearchTerms: [],
      source: "sellersprite" as const,
      capturedAt: "2026-09-09T00:00:00.000Z",
    };
    expect(claimEvidenceFilteredKeywordBrief(brief, input)).toBeNull();
  });

  it("keeps a finalizable catalog with safe facts and repairs malformed feature rendering", () => {
    const plannerInput = {
      facts: input.productFacts.map((fact) => ({ ...fact, factId: fact.field })),
      plan,
      keywordBrief: null,
      listingBrief: null,
      prohibitedClaims: [],
      creativeContext: undefined,
      englishRenderings: input.englishRenderings,
    };
    const catalog = buildFinalizablePlannerCatalog(plannerInput, 5);
    expect(catalog.plans.length).toBeGreaterThan(0);
    const rendered = renderPlannerListing(input, catalog.plans[0]!.plan, null);
    expect(rendered.titles[0]).toBeTruthy();
    expect(rendered.bullets.length).toBeGreaterThanOrEqual(3);
    expect(rendered.description).toBeTruthy();
    expect(rendered.bullets.join(" ")).not.toContain("It features reversible.");

    const composed = composeOptimizedListingDraft(input, plan, null);
    expect(composed.bullets.length).toBeGreaterThanOrEqual(3);
    expect(composed.bullets.join(" ")).not.toContain("It features reversible.");
    expect(composed.bullets.every((bullet) => bullet.trim().split(/\s+/).length >= 5)).toBe(true);
  });
});
