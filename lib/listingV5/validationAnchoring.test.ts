import { describe, expect, it } from "vitest";
import { buildListingV5Context, factAnchorValues } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5WriterDraft } from "./types";

/**
 * Claim-anchoring regressions.
 *
 * V2 fixed three defects exposed by the real frozen AI copy: the optional
 * article group backtracked so "is a" / "is the" was read as the adjective "a";
 * a confirmed "24oz" tokenized to one token so "24 oz" could never anchor; and
 * a copula complement already covered by a confirmed value was treated as new.
 *
 * V2b then narrowed the copula heuristic against three further false positives
 * the frozen re-validation exposed, without relaxing the safety gate:
 *  - a measurement participle ("is sized") that restates a confirmed number;
 *  - a noun homograph ("a clean look that fits") read as the verb "looks";
 *  - a relational idiom ("each have a place") read as an attribute.
 *
 * Layering note: the anchoring rule only ever sees segments the Claim Evidence
 * resolver already reported. Safety probes therefore inject the dangerous
 * wording into a sentence the resolver does flag.
 */

const OWALA_FACTS = [
  { factId: "brand-1", field: "brand", label: "Brand", value: "Owala" },
  { factId: "capacity-1", field: "capacity", label: "Capacity", value: "24oz" },
  { factId: "type-1", field: "product_type", label: "Product type", value: "Water Bottle" },
  { factId: "material-1", field: "material", label: "Material", value: "Stainless Steel" },
  { factId: "series-1", field: "series_or_model", label: "Series", value: "FreeSip Insulated Stainless Steel Water Bottle" },
  { factId: "dims-1", field: "dimensions", label: "Dimensions", value: '3.24"W x 10.68"H' },
  { factId: "weight-1", field: "weight", label: "Weight", value: "0.4 kg" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "Denim" },
  { factId: "feature-1", field: "functional_feature", label: "Features", value: "Carrying Loop, Insulated, Spout Cover" },
  { factId: "care-1", field: "care", label: "Care", value: "Hand Wash Only" },
];

const TAUCI_FACTS = [
  { factId: "brand-1", field: "brand", label: "Brand", value: "LE TAUCI" },
  { factId: "type-1", field: "product_type", label: "Product type", value: "Organizer" },
  { factId: "material-1", field: "material", label: "Material", value: "Ceramic" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "White" },
  { factId: "dims-1", field: "dimensions", label: "Dimensions", value: '9.8"L x 8.8"W x 7.4"H' },
  { factId: "weight-1", field: "weight", label: "Weight", value: "2.29 kg" },
];

const UKEETAP_FACTS = [
  { factId: "brand-1", field: "brand", label: "Brand", value: "ukeetap" },
  { factId: "type-1", field: "product_type", label: "Product type", value: "Organizer" },
  { factId: "material-1", field: "material", label: "Material", value: "Plastic" },
  { factId: "dims-1", field: "dimensions", label: "Dimensions", value: '16.5"D x 21"W x 1.77"H' },
  { factId: "feature-1", field: "functional_feature", label: "Features", value: "Extra Large Capacity, Expandable, Sturdy, Food Safe, Waterproof" },
];

/** A fact set where the "has a ..." attribute below IS confirmed. */
const BPA_CONFIRMED_FACTS = [
  { factId: "type-1", field: "product_type", label: "Product type", value: "Organizer" },
  { factId: "coating-1", field: "coating", label: "Coating", value: "BPA free coating" },
];

function context(confirmedFacts: Array<{ factId: string; field: string; label: string; value: string }>, identity = "Test Product") {
  return buildListingV5Context({
    taskId: "task-anchoring",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: identity,
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
    confirmedFacts,
  });
}

const BENIGN_DESCRIPTION = "This product fits everyday routines. A straightforward build keeps the routine simple.";

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

function reportedFor(
  facts: Array<{ factId: string; field: string; label: string; value: string }>,
  text: string,
  factIds: string[],
  identity?: string,
) {
  const ctx = context(facts, identity);
  const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), probeDraft(text, factIds));
  return [...report.claims.unsupportedClaims, ...report.claims.prohibitedClaims];
}

// ── the real frozen writer sentences ────────────────────────────────────────

const REAL_ARTICLE_SENTENCE =
  "The Owala FreeSip Insulated Stainless Steel Water Bottle is a 24 oz bottle made for everyday hydration";

const REAL_SIZED_SENTENCE =
  'At 3.24"W x 10.68"H and 0.4 kg, this stainless steel bottle is sized for daily carrying, and it is hand wash only';

const REAL_COVERED_COMPLEMENT =
  'The Denim colour and compact 3.24"W x 10.68"H shape make it easy to take along, and it is hand wash only';

const REAL_LOOK_NOUN_SENTENCE =
  'This white ceramic set measures 9.8"L x 8.8"W x 7.4"H and weighs 2.29 kg, with a clean look that fits kitchen counter decor and apartment aesthetics';

const REAL_HAVE_A_PLACE_SENTENCE =
  "Keeps silverware and utensils neatly arranged in kitchen drawers with an extra large capacity design, so spoons, forks, and knives each have a place";

describe("Listing V5 claim anchoring (V2)", () => {
  it("anchors an article copula that restates confirmed values", () => {
    expect(reportedFor(OWALA_FACTS, REAL_ARTICLE_SENTENCE, ["series-1", "capacity-1"])).toEqual([]);
  });

  it("treats a copula complement covered by a confirmed value as a restatement", () => {
    expect(reportedFor(OWALA_FACTS, REAL_COVERED_COMPLEMENT, ["dims-1", "care-1"])).toEqual([]);
  });
});

describe("Listing V5 copula narrowing (V2b)", () => {
  it("does not treat a measurement participle as new when the sentence carries a confirmed number", () => {
    expect(reportedFor(OWALA_FACTS, REAL_SIZED_SENTENCE, ["dims-1", "weight-1", "material-1", "care-1"])).toEqual([]);
  });

  it("does not let a measurement participle stand in for an unconfirmed number", () => {
    // Same shape, but the measurements are not confirmed facts.
    const unconfirmed = REAL_SIZED_SENTENCE.replace('3.24"W x 10.68"H and 0.4 kg', '12"W x 20"H and 1 kg');
    expect(reportedFor(OWALA_FACTS, unconfirmed, ["material-1", "care-1"])).not.toEqual([]);
  });

  it("still reports an absolute promise attached to the same participle", () => {
    const absolute = REAL_SIZED_SENTENCE.replace("is sized", "is perfectly sized");
    expect(reportedFor(OWALA_FACTS, absolute, ["dims-1", "weight-1", "material-1", "care-1"])).not.toEqual([]);
  });

  it("does not read the noun 'look' as the verb 'looks'", () => {
    expect(reportedFor(TAUCI_FACTS, REAL_LOOK_NOUN_SENTENCE, ["dims-1", "weight-1", "material-1"])).toEqual([]);
  });

  it("still reports an adjective asserted by the verb 'looks'", () => {
    const assertLook = REAL_ARTICLE_SENTENCE.replace("is a 24 oz bottle", "looks durable and is a 24 oz bottle");
    expect(reportedFor(OWALA_FACTS, assertLook, ["series-1", "capacity-1"])).not.toEqual([]);
  });

  it("does not read the idiom 'have a place' as a product attribute", () => {
    expect(reportedFor(UKEETAP_FACTS, REAL_HAVE_A_PLACE_SENTENCE, ["feature-1"])).toEqual([]);
  });

  it("still requires a fact for a real attribute asserted through 'has a ...'", () => {
    // Positive: the attribute is confirmed, so restating it anchors.
    expect(reportedFor(BPA_CONFIRMED_FACTS, "This product has a BPA free coating for daily use", ["coating-1"])).toEqual([]);
    // Negative: same shape, uncovered hard word, on a sentence the resolver
    // does flag so the anchoring rule actually sees it.
    const uncovered = REAL_ARTICLE_SENTENCE.replace("is a 24 oz bottle", "is a 24 oz bottle that has a durable coating");
    expect(reportedFor(OWALA_FACTS, uncovered, ["series-1", "capacity-1"])).not.toEqual([]);
  });
});

describe("Listing V5 factual enumeration atomization", () => {
  it("atomizes declared multi-value feature fields", () => {
    expect(factAnchorValues({ canonicalField: "functional_feature", value: "Extra Large Capacity, Expandable, Sturdy" }))
      .toEqual(["Extra Large Capacity", "Expandable", "Sturdy"]);
  });

  it("never splits measurement, material or care values", () => {
    expect(factAnchorValues({ canonicalField: "dimensions", value: '3.24"W x 10.68"H' })).toEqual(['3.24"W x 10.68"H']);
    expect(factAnchorValues({ canonicalField: "material", value: "18/8 Stainless Steel, BPA-Free" })).toEqual(["18/8 Stainless Steel, BPA-Free"]);
    expect(factAnchorValues({ canonicalField: "care", value: "Hand wash only, dry immediately" })).toEqual(["Hand wash only, dry immediately"]);
  });

  it("anchors a sentence that restates one atomic value of an enumerated fact", () => {
    expect(reportedFor(UKEETAP_FACTS, "The organizer is waterproof for everyday drawer use.", ["feature-1"])).toEqual([]);
    expect(reportedFor(UKEETAP_FACTS, "Its expandable design adjusts to different drawer sizes.", ["feature-1"])).toEqual([]);
  });
});

/**
 * The resolver reports a sentence only when its own (largely Chinese) risk
 * vocabulary fires, so English hard claims used to reach the validator
 * unflagged and PASS. Every sentence is now scanned by the validator itself,
 * with the same detectors, independently of what the resolver reported.
 */
describe("Listing V5 scans every sentence for uncovered hard claims", () => {
  function reportFor(
    facts: Array<{ factId: string; field: string; label: string; value: string }>,
    text: string,
    factIds: string[],
  ) {
    const ctx = context(facts);
    return validateListingV5Draft(ctx, buildListingV5Strategy(ctx), probeDraft(text, factIds));
  }

  it("flags claims the resolver never reports, with the offending span", () => {
    const cases: Array<[string, string]> = [
      ["Leakproof lid keeps drinks secure all day.", "Leakproof"],
      ["The bottle keeps drinks cold for hours.", "hours"],
      ["Dishwasher safe for easy cleaning.", "Dishwasher"],
      ["BPA free and non-toxic materials.", "BPA"],
      ["Odor resistant interior.", "resistant"],
    ];
    for (const [text, span] of cases) {
      const report = reportFor(OWALA_FACTS, text, ["material-1"]);
      expect(report.status, text).not.toBe("PASS");
      const spans = (report.claims.unsupportedDetails ?? []).flatMap((detail) => detail.offendingSpans);
      expect(spans, text).toContain(span);
    }
  });

  it("still passes covered hard words, hyphenated confirmed values and plain benefits", () => {
    // "Insulated" is part of a confirmed feature value.
    expect(reportFor(OWALA_FACTS, "The bottle is insulated for daily routines.", ["feature-1"]).status).toBe("PASS");
    // "dishwasher-safe" is the hyphenated form of the confirmed care value; the
    // token set holds the split form, so the compound must not read as new.
    expect(reportFor(
      [...OWALA_FACTS, { factId: "care-wash", field: "care", label: "Care", value: "dishwasher-safe bottle and lid" }],
      "The bottle and lid are dishwasher-safe for easy cleaning.",
      ["care-wash"],
    ).status).toBe("PASS");
    // Pure benefit framing with no hard token stays allowed.
    expect(reportFor(OWALA_FACTS, "The carrying loop makes the bottle easier to take along.", ["feature-1"]).status).toBe("PASS");
  });
});
