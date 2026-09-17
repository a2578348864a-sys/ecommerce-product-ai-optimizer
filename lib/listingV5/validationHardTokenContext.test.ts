import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5WriterDraft } from "./types";

/**
 * Hard-token enumeration regressions.
 *
 * A hard-vocabulary word can be a count quantifier ("the pack holds four pieces in
 * total") or an absolute claim modifier ("total coverage"). The earlier token-level
 * check could not tell them apart, so benign quantity wording was reported as
 * `unsupported_hard_claim` - and, because a hard token also blocks fact anchoring, the
 * sentence lost its "confirmed fact" exemption too.
 */

const FACTS = [
  { factId: "type-1", field: "product_type", label: "Product type", value: "Table Decor" },
  { factId: "qty-1", field: "quantity_or_pack_size", label: "Quantity", value: "4 Pcs" },
  { factId: "mat-1", field: "material", label: "Material", value: "Wood" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "Multicolor" },
  { factId: "model-1", field: "series_or_model", label: "Series", value: "YYJ-Lineshading-1305" },
];

const BENIGN_DESCRIPTION = "This product fits everyday routines. A straightforward build keeps the routine simple.";

function context() {
  return buildListingV5Context({
    taskId: "task-hard-context",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Test Product",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [], stableSourceFacts: [], creativeReferences: [], creativePreferences: {},
      prohibitedClaims: [], unknowns: [], humanReviewRequired: true,
      researchMode: "market_research_only", promotionEligible: false,
    },
    confirmedFacts: FACTS,
  });
}

function probeDraft(text: string, factIds: string[]): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Test Product", factIds },
    bullets: [{ text, factIds, strategyRole: "core_outcome" }],
    description: { text: BENIGN_DESCRIPTION, factIds },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

function detailsFor(text: string, factIds: string[] = ["qty-1"]) {
  const ctx = context();
  const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), probeDraft(text, factIds));
  return report.claims.unsupportedDetails ?? [];
}
function hardTokensFor(text: string, factIds: string[] = ["qty-1"]): string[] {
  // offendingSpans keep the surface casing from the sentence; the vocabulary is lowercase.
  return [...new Set(detailsFor(text, factIds).filter((detail) => detail.issueCode === "unsupported_hard_claim").flatMap((detail) => detail.offendingSpans))]
    .map((span) => span.toLowerCase());
}

describe("Listing V5 hard-token enumeration context", () => {
  it("does not report a quantity enumeration as a hard claim", () => {
    const enumerations = [
      "The pack holds four pieces in total.",
      "A total of 4 Pcs arrives in the pack.",
      "Total: 4 Pcs in the pack.",
      "The total pack size is 4 Pcs.",
      "The total pieces count is 4.",
      "The total quantity is 4 Pcs.",
      "In total, the set includes 4 Pcs.",
    ];
    for (const sentence of enumerations) {
      expect(detailsFor(sentence).map((detail) => detail.issueCode), sentence).not.toContain("unsupported_hard_claim");
    }
  });

  it("still reports an absolute total claim", () => {
    const absolutes: [string, string][] = [
      ["This gives you total coverage of the shelf.", "total"],
      ["This offers total protection for the shelf.", "total"],
      ["You get total control over the display.", "total"],
      ["For total satisfaction, place it on the counter.", "total"],
      ["This gives you complete coverage of the shelf.", "complete"],
    ];
    for (const [sentence, token] of absolutes) {
      expect(hardTokensFor(sentence), sentence).toContain(token);
    }
  });

  it("leaves the other hard tokens' behaviour alone", () => {
    const unchanged: [string, string][] = [
      ["The display is always ready.", "always"],
      ["It never leaks on the table.", "never"],
      ["Only for indoor use on a shelf.", "only"],
      ["Fits every room in the house.", "every"],
      ["This suits all kitchens.", "all"],
    ];
    for (const [sentence, token] of unchanged) {
      expect(hardTokensFor(sentence), sentence).toContain(token);
    }
  });

  it("no longer reports the real C1 sentence because of total", () => {
    const sentence = "The pieces are made of wood and come in a multicolor finish, and the pack holds four pieces in total";
    const details = detailsFor(sentence, ["mat-1", "color-1", "qty-1"]);
    expect(details.map((detail) => detail.issueCode)).not.toContain("unsupported_hard_claim");
    expect(details, sentence).toEqual([]);
  });

  it("keeps a performance word hard even in front of a measure noun", () => {
    // The enumeration exemption is for count quantifiers only: a performance word
    // followed by a measure noun is still a claim.
    const stillHard: [string, string][] = [
      ["The set has a heavy weight for a small shelf.", "heavy"],
      ["It reaches maximum capacity on the counter.", "maximum"],
      ["The pack shows a high count of pieces.", "high"],
      ["This is a professional grade table set.", "professional"],
    ];
    for (const [sentence, token] of stillHard) {
      expect(hardTokensFor(sentence), sentence).toContain(token);
    }
  });

  it("keeps the attribute-assertion path unchanged", () => {
    const codes = detailsFor("The organizer is roomy for a small counter.", ["type-1"]).map((detail) => detail.issueCode);
    expect(codes).toContain("unsupported_attribute_assertion");
  });
});
