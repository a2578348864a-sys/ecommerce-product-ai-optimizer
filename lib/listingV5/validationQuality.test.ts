import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5Strategy, ListingV5WriterDraft } from "./types";

/**
 * Validator correctness. These cover the two false positives that were proven
 * on real AI output (abbreviation sentence split, substring keyword matching)
 * plus the fact-anchoring rules, without weakening any hard-claim detection.
 */

function context(facts: Array<{ factId: string; field: string; label: string; value: string }>) {
  return buildListingV5Context({
    taskId: "task-quality", researchRevision: 1, handoffRevision: 1, productIdentity: "Owala FreeSip Stainless Steel Water Bottle 24 oz Denim",
    generationInput: {
      schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [], stableSourceFacts: [], creativeReferences: [], creativePreferences: {},
      prohibitedClaims: [], unknowns: [], humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
    },
    confirmedFacts: facts,
  });
}

const care = { factId: "care-1", field: "care", label: "Care", value: "dishwasher-safe bottle and lid" };
const brand = { factId: "brand-1", field: "brand", label: "Brand", value: "Owala" };
const productType = { factId: "type-1", field: "product_type", label: "Product type", value: "Water Bottle" };
/** Every fixture keeps the title anchored so only the tested segment can be unsupported. */
const baseFacts = [brand, productType, care];

function draftWith(overrides: Partial<ListingV5WriterDraft> & { description?: { text: string; factIds: string[] } } = {}): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Owala Water Bottle", factIds: ["brand-1", "type-1"] },
    bullets: [{ text: "Dishwasher-safe bottle and lid support everyday cleanup.", factIds: ["care-1"], strategyRole: "core_outcome" }],
    description: { text: "A bottle for everyday hydration. Dishwasher-safe bottle and lid keep routines simple.", factIds: ["care-1"] },
    backendSearchTerms: [],
    humanReviewRequired: true,
    ...overrides,
  } as ListingV5WriterDraft;
}

function strategyWithKeyword(primary: string[]): ListingV5Strategy {
  const base = buildListingV5Strategy(context(baseFacts));
  return { ...base, keywordIntent: { primary, secondary: [], backendOnly: [] } };
}

describe("Listing V5 validator correctness", () => {
  it("does not treat an abbreviation as a sentence break", () => {
    const ctx = context(baseFacts);
    const strategy = buildListingV5Strategy(ctx);
    const withAbbreviations = draftWith({
      description: {
        text: "The Owala FreeSip Jr. 12 oz bottle fits everyday hydration routines. Mr. and Dr. Lee both use it in the car and at the office.",
        factIds: ["care-1"],
      },
    });
    const report = validateListingV5Draft(ctx, strategy, withAbbreviations);
    expect(report.description.issues).not.toContain("description_should_be_2_to_4_sentences");
  });

  it("still counts ordinary sentences at the documented boundaries", () => {
    const ctx = context(baseFacts);
    const strategy = buildListingV5Strategy(ctx);
    const count = (text: string) => validateListingV5Draft(ctx, strategy, draftWith({ description: { text, factIds: ["care-1"] } })).description.issues.includes("description_should_be_2_to_4_sentences");
    expect(count("One sentence only.")).toBe(true);
    expect(count("First sentence. Second sentence.")).toBe(false);
    expect(count("First. Second. Third.")).toBe(false);
    expect(count("First. Second. Third. Fourth.")).toBe(false);
    expect(count("First. Second. Third. Fourth. Fifth.")).toBe(true);
  });

  it("counts a unit abbreviation at the end of a sentence as a sentence end", () => {
    const ctx = context(baseFacts);
    const strategy = buildListingV5Strategy(ctx);
    const report = validateListingV5Draft(ctx, strategy, draftWith({
      description: { text: "It holds 12 oz. Dishwasher-safe bottle and lid keep the routine simple.", factIds: ["care-1"] },
    }));
    expect(report.description.issues).not.toContain("description_should_be_2_to_4_sentences");
  });

  it("never treats a single letter or a stopword keyword as stuffing", () => {
    const ctx = context(baseFacts);
    const strategy = strategyWithKeyword(["a"]);
    const report = validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [
        { text: "A practical bottle for a commute and a gym session.", factIds: ["care-1"], strategyRole: "core_outcome" },
        { text: "Dishwasher-safe bottle and lid support a simple routine.", factIds: ["care-1"], strategyRole: "pain_relief" },
        { text: "A compact shape fits a cup holder.", factIds: ["care-1"], strategyRole: "use_scenario" },
      ],
    }));
    expect(report.quality.keywordStuffing).toBe(false);
  });

  it("matches a keyword as a phrase instead of a loose substring", () => {
    const ctx = context(baseFacts);
    const strategy = strategyWithKeyword(["kids water bottle"]);
    // "kids" alone, or "bottle" alone, is not the keyword phrase.
    const notStuffed = validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [
        { text: "Kids can stay hydrated with this bottle.", factIds: ["care-1"], strategyRole: "core_outcome" },
        { text: "Dishwasher-safe bottle and lid support a simple routine.", factIds: ["care-1"], strategyRole: "pain_relief" },
        { text: "A compact bottle fits most cup holders.", factIds: ["care-1"], strategyRole: "use_scenario" },
      ],
    }));
    expect(notStuffed.quality.keywordStuffing).toBe(false);

    // The exact phrase repeated mechanically inside the body is still caught.
    const stuffed = validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [
        { text: "kids water bottle for kids water bottle use.", factIds: ["care-1"], strategyRole: "core_outcome" },
        { text: "kids water bottle with a dishwasher-safe lid.", factIds: ["care-1"], strategyRole: "pain_relief" },
        { text: "kids water bottle for daily routines.", factIds: ["care-1"], strategyRole: "use_scenario" },
      ],
    }));
    expect(stuffed.quality.keywordStuffing).toBe(true);
  });

  it("anchors a confirmed care fact written with a different but equivalent form", () => {
    const ctx = context(baseFacts);
    const strategy = buildListingV5Strategy(ctx);
    const report = validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [{ text: "The bottle and lid are dishwasher-safe for easy cleaning.", factIds: ["care-1"], strategyRole: "pain_relief" }],
    }));
    expect(report.claims.unsupportedClaims).toEqual([]);
    expect(report.status).not.toBe("BLOCK");
  });

  it("blocks an escalation of a confirmed fact", () => {
    const ctx = context(baseFacts);
    const strategy = buildListingV5Strategy(ctx);
    const report = validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [{ text: "Dishwasher-safe bottle and lid keep routines simple at high heat.", factIds: ["care-1"], strategyRole: "pain_relief" }],
    }));
    expect(report.claims.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("flags an unconfirmed performance adjective, a duration and a certification", () => {
    const ctx = context([...baseFacts, { factId: "mat-1", field: "material", label: "Material", value: "stainless steel" }]);
    const strategy = buildListingV5Strategy(ctx);
    const unsupported = (text: string) => validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [{ text, factIds: ["mat-1"], strategyRole: "core_outcome" }],
    })).claims.unsupportedClaims;

    expect(unsupported("Durable stainless steel construction for daily use.").length).toBeGreaterThan(0);
    expect(unsupported("Stainless steel keeps drinks cold for 24 hours.").length).toBeGreaterThan(0);
    expect(unsupported("FDA approved stainless steel construction.").length).toBeGreaterThan(0);
    // A plain restatement of the confirmed material is fine.
    expect(unsupported("The bottle is made with stainless steel.")).toEqual([]);
  });

  it("does not let a confirmed value vouch for an unrelated attribute", () => {
    const ctx = context([{ ...brand }, { ...productType }, { factId: "mat-1", field: "material", label: "Material", value: "Steel" }]);
    const strategy = buildListingV5Strategy(ctx);
    const unsupported = (text: string) => validateListingV5Draft(ctx, strategy, draftWith({
      bullets: [{ text, factIds: ["mat-1"], strategyRole: "core_outcome" }],
    })).claims.unsupportedClaims;

    expect(unsupported("Steel is red for a clear product choice.").length).toBeGreaterThan(0);
    expect(unsupported("Steel is lightweight for daily carry.").length).toBeGreaterThan(0);
    expect(unsupported("Steel helps shoppers compare a confirmed material detail.")).toEqual([]);
  });

  it("allows a confirmed brand relation phrased as from", () => {
    const ctx = context([{ ...brand }, { ...productType }]);
    const strategy = buildListingV5Strategy(ctx);
    const draft = draftWith({
      bullets: [{ text: "The product is from Example Brand, helping shoppers identify the confirmed brand.", factIds: ["brand-1"], strategyRole: "core_outcome" }],
    });
    expect(validateListingV5Draft(ctx, strategy, draft).claims.unsupportedClaims).toEqual([]);
  });
});
