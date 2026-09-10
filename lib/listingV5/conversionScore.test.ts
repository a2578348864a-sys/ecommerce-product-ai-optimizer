import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint } from "./conversionBlueprint";
import { scoreListingV5Conversion, CONVERSION_BENCHMARK_PASS_AVERAGE } from "./conversionScore";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

/**
 * The benchmark instrument scores five conversion dimensions. These tests lock
 * the rubric's behaviour: a fact list must not earn benefit points, benefit-led
 * copy must, and fallback copy must be reported as a conversion regression.
 */
function fixtureContext() {
  return buildListingV5Context({
    taskId: "task-score",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Zinnia Seeds",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [{ field: "material", label: "Material", value: "Heirloom seed" }],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    },
    creativeContext: {
      schema: "creative-context.v1",
      version: 1,
      generatedAt: "",
      source: { researchRevision: 1, candidateId: "candidate-1" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: [],
      keywordCandidates: [
        { keyword: "zinnia seeds", reportType: "search", rowNumber: 1, evidenceRef: "ev:k1", observedAt: "", provenance: { evidenceRef: "ev:k1", sourceType: "keyword", observedAt: "" } },
      ],
      competitiveContext: [],
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 0, keywordCandidates: 1, competitiveInsights: 0, sourcingEntries: 0, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [
      { factId: "fact-title", field: "series_or_model", label: "Series", value: "Zinnia elegans" },
      { factId: "fact-quantity", field: "quantity_or_pack_size", label: "Quantity", value: "1 Count" },
      { factId: "fact-care", field: "care", label: "Care", value: "Low maintenance" },
    ],
  });
}

const validation: ListingV5ValidationResult = {
  version: LISTING_V5_VALIDATION_VERSION,
  status: "PASS",
  title: { valid: true, issues: [] },
  bullets: [],
  description: { valid: true, issues: [] },
  claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
  quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
  repair: { allowed: false, reason: null, targets: [] },
};

function score(draft: ListingV5WriterDraft, deterministicFallback = false) {
  const context = fixtureContext();
  const strategy = buildListingV5Strategy(context);
  return scoreListingV5Conversion({
    context,
    strategy,
    blueprint: buildListingV5ConversionBlueprint(context, strategy),
    draft,
    validation,
    deterministicFallback,
  });
}

const benefitLedDraft: ListingV5WriterDraft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Zinnia Seeds for Planting", factIds: ["fact-title"] },
  bullets: [
    { text: "Zinnia elegans brings tall colour to beds, so you can plan a border that keeps blooming.", factIds: ["fact-title"], strategyRole: "core_outcome" },
    { text: "Each order arrives as 1 Count, so you know how many packets to expect before you order.", factIds: ["fact-quantity"], strategyRole: "pain_relief" },
    { text: "Low maintenance care suits first-time gardeners who want an easy routine.", factIds: ["fact-care"], strategyRole: "use_scenario" },
  ],
  description: { text: "Zinnia seeds suit planting beds. They arrive as 1 Count with low maintenance care.", factIds: ["fact-title"] },
  backendSearchTerms: [],
  humanReviewRequired: true,
};

const factListDraft: ListingV5WriterDraft = {
  ...benefitLedDraft,
  bullets: [
    { text: "Zinnia elegans Zinnia elegans flower seeds planting packet garden bed outdoor space", factIds: ["fact-title"], strategyRole: "core_outcome" },
    { text: "1 Count packet quantity seed count package contents single order unit", factIds: ["fact-quantity"], strategyRole: "pain_relief" },
    { text: "Low maintenance care requirement gardening effort level routine daily weekly", factIds: ["fact-care"], strategyRole: "use_scenario" },
  ],
};

describe("Conversion Benchmark scoring instrument", () => {
  it("rewards benefit-led bullets over a fact list on the same facts", () => {
    const led = score(benefitLedDraft);
    const dump = score(factListDraft);
    const benefit = (result: typeof led) => result.dimensions.find((dimension) => dimension.id === "benefit_clarity")!.score;
    expect(benefit(led)).toBeGreaterThan(benefit(dump));
    expect(benefit(led)).toBeGreaterThanOrEqual(15);
  });

  it("reports deterministic fallback copy as a naturalness and conversion regression", () => {
    const fallback = score({ ...benefitLedDraft, bullets: [
      { text: "Zinnia Seeds is from Home Grown, helping shoppers understand the product at a glance.", factIds: ["fact-title"], strategyRole: "core_outcome" },
      { text: "With 1 Count, shoppers can compare a clear product detail for everyday routines.", factIds: ["fact-quantity"], strategyRole: "pain_relief" },
      { text: "For everyday routines, Zinnia Seeds brings Zinnia elegans into a simple product choice.", factIds: ["fact-title"], strategyRole: "use_scenario" },
    ] }, true);
    const naturalness = fallback.dimensions.find((dimension) => dimension.id === "naturalness")!;
    expect(naturalness.score).toBeLessThanOrEqual(6);
    expect(fallback.deterministicFallback).toBe(true);
    expect(fallback.notes.join(" ")).toMatch(/fallback/i);
  });

  it("keeps every dimension inside its ceiling and exposes the pass threshold", () => {
    const result = score(benefitLedDraft);
    for (const dimension of result.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(20);
    }
    expect(result.total).toBe(result.dimensions.reduce((sum, dimension) => sum + dimension.score, 0));
    expect(CONVERSION_BENCHMARK_PASS_AVERAGE).toBe(75);
  });
});
