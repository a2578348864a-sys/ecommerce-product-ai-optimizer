import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5Strategy, ListingV5WriterDraft } from "./types";

/**
 * Copy-quality policy (Quality Flag Policy B1).
 *
 * `repetitive`, `keywordStuffing` and `mechanicalTemplate` are copy-quality
 * warnings. On their own - with facts safe, claims anchored and every field
 * structurally valid - they must NOT turn a draft into REPAIRABLE/BLOCK and
 * must NOT cause a fallback: there is no repair target for them, so doing so
 * could only ever throw away a usable AI listing.
 *
 * They must still be reported in `quality` for the snapshot, the review sheet
 * and the benchmark, and they must never mask a real fact-safety finding.
 */

const facts = [
  { factId: "material-1", field: "material", label: "Material", value: "stainless steel" },
  { factId: "capacity-1", field: "capacity", label: "Capacity", value: "24 oz" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "Black" },
  { factId: "type-1", field: "product_type", label: "Product type", value: "Water Bottle" },
  { factId: "care-1", field: "care", label: "Care", value: "hand wash only" },
];

function context() {
  return buildListingV5Context({
    taskId: "task-repair-coverage",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Hydro Bottle",
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
    confirmedFacts: facts,
  });
}

/** Bullets are anchored and distinct; four of five start with "The". */
function mechanicalBullets(): ListingV5WriterDraft["bullets"] {
  return [
    { text: "The stainless steel body suits everyday hydration routines.", factIds: ["material-1"], strategyRole: "core_outcome" },
    { text: "The 24 oz capacity supports daily routines without extra bulk.", factIds: ["capacity-1"], strategyRole: "pain_relief" },
    { text: "The Black finish fits everyday settings.", factIds: ["color-1"], strategyRole: "use_scenario" },
    { text: "The Water Bottle format suits everyday carrying.", factIds: ["type-1"], strategyRole: "ease_of_use" },
    { text: "Hand wash only care keeps the routine straightforward.", factIds: ["care-1"], strategyRole: "proof_or_fit" },
  ];
}

function draft(bullets: ListingV5WriterDraft["bullets"] = mechanicalBullets()): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Stainless Steel Water Bottle 24 oz Black", factIds: ["material-1", "capacity-1", "color-1"] },
    bullets,
    description: {
      text: "This bottle uses stainless steel and a 24 oz capacity for everyday hydration. Hand wash only care keeps the routine simple.",
      factIds: ["material-1", "capacity-1", "care-1"],
    },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

/** A draft whose only repeated phrase is a keyword, four times, in the bullets. */
function stuffedDraft(): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Water Bottle 24 oz Black", factIds: ["type-1", "capacity-1", "color-1"] },
    bullets: [
      { text: "Stainless steel body suits everyday hydration.", factIds: ["material-1"], strategyRole: "core_outcome" },
      { text: "The stainless steel build fits daily routines.", factIds: ["material-1"], strategyRole: "pain_relief" },
      { text: "For everyday carrying, stainless steel construction keeps things simple.", factIds: ["material-1"], strategyRole: "use_scenario" },
      { text: "A stainless steel finish suits everyday settings.", factIds: ["material-1"], strategyRole: "ease_of_use" },
      { text: "Stainless steel material with hand wash only care.", factIds: ["material-1", "care-1"], strategyRole: "proof_or_fit" },
    ],
    description: {
      text: "This bottle uses stainless steel and a 24 oz capacity for everyday hydration. Hand wash only care keeps the routine simple.",
      factIds: ["material-1", "capacity-1", "care-1"],
    },
    backendSearchTerms: [],
    humanReviewRequired: true,
  };
}

function strategyWithKeyword(primary: string[]): ListingV5Strategy {
  const base = buildListingV5Strategy(context());
  return { ...base, keywordIntent: { primary, secondary: [], backendOnly: [] } };
}

describe("Listing V5 copy-quality policy (B1)", () => {
  it("passes a mechanical-template-only draft with a warning instead of falling back", () => {
    const ctx = context();
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft());

    expect(report.quality.mechanicalTemplate).toBe(true);
    // Quality-only: this is a PASS with a warning, never REPAIRABLE/BLOCK.
    expect(report.status).toBe("PASS");
    expect(report.claims.unsupportedClaims).toEqual([]);
    expect(report.claims.prohibitedClaims).toEqual([]);
    // No repair is offered, and none is needed.
    expect(report.repair.targets).toEqual([]);
    expect(report.repair.allowed).toBe(false);
  });

  it("passes a repetitive-only draft with a warning", () => {
    const ctx = context();
    const bullets = mechanicalBullets();
    bullets[0] = { ...bullets[0]!, text: "Stainless steel construction suits everyday hydration." };
    bullets[4] = { ...bullets[4]!, text: "Stainless steel construction suits everyday hydration.", factIds: ["material-1"] };
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft(bullets));

    expect(report.quality.repetitive).toBe(true);
    expect(report.quality.mechanicalTemplate).toBe(false);
    expect(report.status).toBe("PASS");
    expect(report.repair.allowed).toBe(false);
  });

  it("passes a keyword-stuffing-only draft with a warning", () => {
    const ctx = context();
    const report = validateListingV5Draft(ctx, strategyWithKeyword(["stainless steel"]), stuffedDraft());

    expect(report.quality.keywordStuffing).toBe(true);
    expect(report.status).toBe("PASS");
    expect(report.repair.allowed).toBe(false);
  });

  it("still repairs a mixed draft: quality warning plus a locally unsupported claim", () => {
    const ctx = context();
    const bullets = mechanicalBullets();
    bullets[0] = { ...bullets[0]!, text: "The stainless steel bottle is dishwasher safe." };
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft(bullets));

    expect(report.quality.mechanicalTemplate).toBe(true);
    // The quality warning must not swallow the claim repair target.
    expect(report.status).toBe("REPAIRABLE");
    expect(report.repair.allowed).toBe(true);
    expect(report.repair.targets).toEqual(["bullets[0]"]);
  });

  it("still blocks a mixed draft: quality warning plus a prohibited claim", () => {
    const ctx = context();
    const bullets = mechanicalBullets();
    bullets[0] = { ...bullets[0]!, text: "The FDA approved stainless steel bottle suits daily use." };
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft(bullets));

    // A quality warning must never launder a prohibited claim into PASS.
    expect(report.status).toBe("BLOCK");
    expect(report.claims.prohibitedClaims.length + report.claims.unsupportedClaims.length).toBeGreaterThan(0);
  });
});
