import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint } from "./conversionBlueprint";
import { evaluateListingV5Quality } from "./qualityEvaluation";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

function context() {
  return buildListingV5Context({
    taskId: "task-quality",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Insulated Tumbler",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [{ field: "material", label: "Material", value: "Stainless steel" }],
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
      vocInsights: [{ insightId: "v1", theme: "cleaning", summary: "hard to clean the lid", evidenceRefs: [], reviewCount: 9, coverage: 1, strength: "recurring", sourceType: "voc_theme", provenance: { evidenceRef: "ev:v1", sourceType: "voc", observedAt: "" } }],
      keywordCandidates: [
        { keyword: "insulated tumbler", reportType: "search", rowNumber: 1, evidenceRef: "ev:k1", observedAt: "", provenance: { evidenceRef: "ev:k1", sourceType: "keyword", observedAt: "" } },
        { keyword: "travel mug", reportType: "search", rowNumber: 2, evidenceRef: "ev:k2", observedAt: "", provenance: { evidenceRef: "ev:k2", sourceType: "keyword", observedAt: "" } },
      ],
      competitiveContext: [{ asin: "B0COMP", note: "stainless steel tumbler with 24 oz capacity", evidenceRef: "ev:c1", addedAt: "2026-09-11T00:00:00.000Z", provenance: { evidenceRef: "ev:c1", sourceType: "competitor", observedAt: "" } }],
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 1, keywordCandidates: 2, competitiveInsights: 1, sourcingEntries: 0, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [
      { factId: "fact-material", field: "material", label: "Material", value: "Stainless steel" },
      { factId: "fact-care", field: "care", label: "Care", value: "Dishwasher safe lid" },
      { factId: "fact-capacity", field: "capacity", label: "Capacity", value: "24 oz" },
    ],
  });
}

const draft: ListingV5WriterDraft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Insulated Tumbler for daily commutes", factIds: ["fact-material"] },
  bullets: [
    { text: "Stainless steel body keeps the tumbler simple to live with.", factIds: ["fact-material"], strategyRole: "core_outcome" },
    { text: "Dishwasher safe lid helps reduce cleanup after daily use.", factIds: ["fact-care"], strategyRole: "pain_relief" },
    { text: "24 oz fits everyday commuting routines.", factIds: ["fact-capacity"], strategyRole: "use_scenario" },
  ],
  description: { text: "Insulated Tumbler brings stainless steel and 24 oz together for everyday commuting.", factIds: ["fact-material"] },
  backendSearchTerms: ["travel mug"],
  humanReviewRequired: true,
};

function validation(overrides: Partial<ListingV5ValidationResult> = {}): ListingV5ValidationResult {
  return {
    version: LISTING_V5_VALIDATION_VERSION,
    status: "PASS",
    title: { valid: true, issues: [] },
    bullets: draft.bullets.map((bullet) => ({ valid: true, factIds: [...bullet.factIds], strategyRole: bullet.strategyRole, issues: [] })),
    description: { valid: true, issues: [] },
    claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] },
    quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
    repair: { allowed: false, reason: null, targets: [] },
    ...overrides,
  };
}

function evaluate(input: { draft?: ListingV5WriterDraft; validation?: ListingV5ValidationResult; fallback?: boolean } = {}) {
  const ctx = context();
  const strategy = buildListingV5Strategy(ctx);
  return evaluateListingV5Quality({
    context: ctx,
    strategy,
    blueprint: buildListingV5ConversionBlueprint(ctx, strategy),
    draft: input.draft ?? draft,
    validation: input.validation ?? validation(),
    deterministicFallback: input.fallback ?? false,
  });
}

describe("Listing Quality Evaluation（附加评分，不替代 Validator）", () => {
  it("returns five bounded dimensions that sum to the total and never exceed their ceiling", () => {
    const result = evaluate();
    expect(result.dimensions.map((dimension) => dimension.id)).toEqual([
      "safety", "keyword_relevance", "benefit_clarity", "differentiation", "conversion_strength",
    ]);
    expect(result.dimensions.reduce((sum, dimension) => sum + dimension.score, 0)).toBe(result.total);
    for (const dimension of result.dimensions) {
      expect(dimension.score).toBeGreaterThanOrEqual(0);
      expect(dimension.score).toBeLessThanOrEqual(dimension.max);
    }
    expect(result.max).toBe(100);
  });

  it("lowers safety only from what the Validator reported and caps it when the status is not PASS", () => {
    const clean = evaluate();
    const withClaims = evaluate({
      validation: validation({
        status: "REPAIRABLE",
        claims: { allHaveEvidence: false, unsupportedClaims: ["leakproof"], prohibitedClaims: [], competitorOverlap: [] },
      }),
    });
    const cleanSafety = clean.dimensions.find((dimension) => dimension.id === "safety")!;
    const claimSafety = withClaims.dimensions.find((dimension) => dimension.id === "safety")!;
    expect(claimSafety.score).toBeLessThan(cleanSafety.score);
    expect(claimSafety.score).toBeLessThanOrEqual(12);
    expect(claimSafety.evidence.join(" ")).toMatch(/unsupported/i);
  });

  it("flags deterministic fallback copy as a conversion regression without pretending it is unsafe", () => {
    const fallback = evaluate({ fallback: true });
    expect(fallback.deterministicFallback).toBe(true);
    expect(fallback.notes.join(" ")).toMatch(/fallback/i);
    const conversion = fallback.dimensions.find((dimension) => dimension.id === "conversion_strength")!;
    expect(conversion.score).toBeLessThanOrEqual(8);
    const safety = fallback.dimensions.find((dimension) => dimension.id === "safety")!;
    expect(safety.score).toBeGreaterThanOrEqual(20);
  });

  it("rewards keyword coverage only for terms the shopper-visible copy actually carries", () => {
    const covered = evaluate();
    const uncovered = evaluate({
      draft: {
        ...draft,
        title: { text: "A practical daily item", factIds: ["fact-material"] },
        description: { text: "A practical daily item for everyday routines.", factIds: ["fact-material"] },
        backendSearchTerms: [],
      },
    });
    const score = (result: typeof covered) => result.dimensions.find((dimension) => dimension.id === "keyword_relevance")!.score;
    expect(score(covered)).toBeGreaterThan(score(uncovered));
  });

  it("does not let backend search terms raise the shopper-visible keyword coverage", () => {
    // Identical listing body; only the hidden search-terms field changes.
    const withoutBackend = evaluate({ draft: { ...draft, backendSearchTerms: [] } });
    const withBackend = evaluate({
      draft: { ...draft, backendSearchTerms: ["travel mug", "insulated tumbler", "vacuum flask"] },
    });
    const keyword = (result: typeof withoutBackend) =>
      result.dimensions.find((dimension) => dimension.id === "keyword_relevance")!;
    // "travel mug" is an intent term that appears only in backendSearchTerms, so it
    // must stay uncovered and must not move the score or the total.
    expect(withBackend.total).toBe(withoutBackend.total);
    expect(keyword(withBackend).score).toBe(keyword(withoutBackend).score);
    expect(keyword(withBackend).evidence.join(" ")).toContain("travel mug");
  });

  it("grades consistently with the total score", () => {
    const result = evaluate();
    const grade = result.grade;
    if (result.total >= 85) expect(grade).toBe("A");
    else if (result.total >= 70) expect(grade).toBe("B");
    else if (result.total >= 55) expect(grade).toBe("C");
    else expect(grade).toBe("D");
  });
});
