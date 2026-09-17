import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint } from "./conversionBlueprint";
import { evaluateListingV5Quality } from "./qualityEvaluation";
import { scoreListingV5Conversion } from "./conversionScore";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

/**
 * V5.1 safety gates that must never move:
 * 1. the Validator is the only gate - reporting layers may not rewrite its verdict;
 * 2. sourcing material never reaches the blueprint or either scoring layer.
 */
const SOURCING_MARKER = "SUPPLIERMOQMARKER1688";

function context() {
  return buildListingV5Context({
    taskId: "task-gates",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Gate Fixture",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [{ field: "material", label: "Material", value: "Steel" }],
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
      keywordCandidates: [],
      competitiveContext: [{ asin: "B0GATE", note: "similar steel fixture", addedAt: "2026-09-11T00:00:00.000Z", evidenceRef: "ev:c1", provenance: { evidenceRef: "ev:c1", sourceType: "competitor", observedAt: "" } }],
      sourcingContext: [{ offerId: "offer-1", method: "image", title: SOURCING_MARKER, displayedPrice: "1.23", displayedMoq: "500", imageUrl: "", confirmed: false, evidenceRef: "ev:s1", observedAt: "", provenance: { evidenceRef: "ev:s1", sourceType: "sourcing", observedAt: "" } }],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 0, keywordCandidates: 0, competitiveInsights: 1, sourcingEntries: 1, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [{ factId: "fact-material", field: "material", label: "Material", value: "Steel" }],
  });
}

const draft: ListingV5WriterDraft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Steel gate fixture", factIds: ["fact-material"] },
  bullets: [
    { text: "Steel body suits daily handling where a stable surface matters.", factIds: ["fact-material"], strategyRole: "core_outcome" },
    { text: "Steel keeps the routine simple to maintain.", factIds: ["fact-material"], strategyRole: "pain_relief" },
    { text: "For everyday setups, steel handles repeated use.", factIds: ["fact-material"], strategyRole: "use_scenario" },
  ],
  description: { text: "A steel fixture for daily use. It handles repeated use.", factIds: ["fact-material"] },
  backendSearchTerms: [],
  humanReviewRequired: true,
};

function validation(status: ListingV5ValidationResult["status"]): ListingV5ValidationResult {
  return {
    version: LISTING_V5_VALIDATION_VERSION,
    status,
    title: { valid: true, issues: [] },
    bullets: draft.bullets.map((bullet) => ({ valid: true, factIds: [...bullet.factIds], strategyRole: bullet.strategyRole, issues: [] })),
    description: { valid: true, issues: [] },
    claims: { allHaveEvidence: status === "PASS", unsupportedClaims: status === "PASS" ? [] : ["leakproof lid"], prohibitedClaims: [], competitorOverlap: [] },
    quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
    repair: { allowed: false, reason: null, targets: [] },
  };
}

describe("V5.1 safety gates", () => {
  it("never lets a reporting layer rewrite the Validator verdict", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const blueprint = buildListingV5ConversionBlueprint(ctx, strategy);
    const failing = validation("REPAIRABLE");
    const snapshotOfInput = JSON.stringify(failing);
    const quality = evaluateListingV5Quality({ context: ctx, strategy, blueprint, draft, validation: failing, deterministicFallback: false });
    const score = scoreListingV5Conversion({ context: ctx, strategy, blueprint, draft, validation: failing, deterministicFallback: false });
    // The input verdict is untouched, and neither reporting layer exposes a status
    // field that the route could mistake for a validation result.
    expect(JSON.stringify(failing)).toBe(snapshotOfInput);
    expect(failing.status).toBe("REPAIRABLE");
    expect((quality as unknown as Record<string, unknown>).status).toBeUndefined();
    expect((score as unknown as Record<string, unknown>).status).toBeUndefined();
    // A failing verdict must still be visible in the safety score.
    const safety = quality.dimensions.find((dimension) => dimension.id === "safety");
    expect(safety?.score).toBeLessThanOrEqual(12);
  });

  it("keeps sourcing material out of the blueprint and both scoring layers", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const blueprint = buildListingV5ConversionBlueprint(ctx, strategy);
    const quality = evaluateListingV5Quality({ context: ctx, strategy, blueprint, draft, validation: validation("PASS"), deterministicFallback: false });
    const score = scoreListingV5Conversion({ context: ctx, strategy, blueprint, draft, validation: validation("PASS"), deterministicFallback: false });
    for (const layer of [blueprint, quality, score]) {
      const serialized = JSON.stringify(layer);
      expect(serialized).not.toContain(SOURCING_MARKER);
      expect(serialized).not.toMatch(/1688|supplier|moq/i);
    }
    expect(ctx.references.sourcing).toEqual([]);
  });
});
