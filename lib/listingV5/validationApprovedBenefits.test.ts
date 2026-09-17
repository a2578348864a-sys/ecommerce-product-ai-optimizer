import { describe, expect, it } from "vitest";
import { buildApprovedFactBenefit } from "./benefitExpression";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5Fact, ListingV5WriterDraft } from "./types";

const facts: ListingV5Fact[] = [
  { id: "material-1", canonicalField: "material", label: "Material", value: "Wood", sourceRefs: ["human_confirmation"] },
  { id: "series-1", canonicalField: "series_or_model", label: "Model", value: "YYJ-Lineshading-1305", sourceRefs: ["human_confirmation"] },
  { id: "quantity-1", canonicalField: "quantity_or_pack_size", label: "Quantity", value: "4 Pcs", sourceRefs: ["human_confirmation"] },
  { id: "components-1", canonicalField: "included_components", label: "Included components", value: "1 Ghost decoration, 3 Wooden book decorations", sourceRefs: ["human_confirmation"] },
];

function context() {
  return buildListingV5Context({
    taskId: "task-approved-benefits",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Lineshading Halloween Table Decor",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    },
    confirmedFacts: facts.map((fact) => ({
      factId: fact.id,
      field: fact.canonicalField,
      label: fact.label,
      value: fact.value,
      sourceRefs: fact.sourceRefs,
    })),
  });
}

function draft(text: string, factId = "material-1"): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Lineshading Wood Table Decor", factIds: [factId] },
    bullets: [{ text, factIds: [factId], strategyRole: "core_outcome" }],
    description: { text: "Wood table decor for seasonal styling. The confirmed set is made for a table.", factIds: [factId] },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

function report(text: string, factId = "material-1") {
  const ctx = context();
  return validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft(text, factId));
}

describe("Listing V5 approved benefit claim evaluation", () => {
  it("accepts conservative material, model, quantity and included-component benefits", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const approved = facts.map(buildApprovedFactBenefit);
    const cases: Array<[string, string]> = [
      ["Wood states the material while you shop fall decor.", "material-1"],
      ["The YYJ-Lineshading-1305 model identifies the model or series.", "series-1"],
      ["The 4 Pcs set states the pack quantity.", "quantity-1"],
      ["The package lists what is included: 1 Ghost decoration and 3 Wooden book decorations.", "components-1"],
    ];
    for (const [text, factId] of cases) {
      const result = validateListingV5Draft(ctx, strategy, draft(text, factId), approved);
      expect(result.claims.unsupportedClaims, text).toEqual([]);
    }
  });

  it("derives the same canonical benefits when callers omit the optional list", () => {
    const result = report("Wood states the material while you shop fall decor.");
    expect(result.claims.unsupportedClaims).toEqual([]);
    expect(result.status).toBe("PASS");
  });

  it("accepts the combined material and model benefits from the real B-arm wording", () => {
    const result = report(
      "Wood states the material while you shop fall decorations for home, and the YYJ-Lineshading-1305 model number identifies the model or series.",
    );
    expect(result.claims.unsupportedClaims).toEqual([]);
    expect(result.status).toBe("PASS");
  });

  it("does not trust a forged or mismatched approved benefit", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const forged = [{
      id: "fact-benefit:material-1",
      text: "Wood — durable and fits every room",
      factIds: ["material-1"],
      kind: "semantic_benefit" as const,
      source: "confirmed_fact" as const,
      referenceOnly: true as const,
    }];
    const result = validateListingV5Draft(ctx, strategy, draft("Wood is durable and fits every room."), forged);
    expect(result.claims.unsupportedClaims.length).toBeGreaterThan(0);
    expect(result.status).not.toBe("PASS");
  });

  it("keeps setup, placement, durability and coverage in the failure path", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const approved = facts.map(buildApprovedFactBenefit);
    const cases = [
      "Wood gives you a material detail to compare with no setup.",
      "Wood gives you a material detail to compare, ready to place.",
      "Wood gives you a material detail to compare; the finish is durable.",
      "Wood gives you a material detail to compare and fits every room.",
      "Wood gives you a material detail to compare and covers a large area.",
    ];
    for (const text of cases) {
      const result = validateListingV5Draft(ctx, strategy, draft(text), approved);
      expect(result.claims.unsupportedClaims, text).not.toEqual([]);
    }
  });
});
