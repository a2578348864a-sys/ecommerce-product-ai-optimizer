import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5WriterDraft } from "./types";

/**
 * Model / series code evidence regressions (V5.6.7 production change).
 *
 * Two rules, nothing else:
 *  - a confirmed `series_or_model` value is evidence for its own exact token, so a
 *    confirmed code is no longer reported as an unsupported attribute (the copula
 *    detector used to read "BF140" as the adjective "bf");
 *  - a model-shaped code that no confirmed value covers is reported as
 *    `unsupported_model_code` instead of passing silently.
 *
 * A confirmed code legalises the code and NOTHING else: a promotion clause in the same
 * sentence ("so you can check the exact variant") stays an offender, which is what
 * keeps the real C7 / C1 sentences failing exactly as before.
 */

const BASE_FACTS = [
  { factId: "type-1", field: "product_type", label: "Product type", value: "Sticker" },
  { factId: "qty-1", field: "quantity", label: "Quantity", value: "140Pcs" },
  { factId: "color-1", field: "color_or_variant", label: "Color", value: "Black" },
  { factId: "weight-1", field: "weight", label: "Weight", value: "0.17 kg" },
];

function factsWithModel(value: string, field = "series_or_model") {
  return [...BASE_FACTS, { factId: "model-1", field, label: "Series", value }];
}

const BENIGN_DESCRIPTION = "This product fits everyday routines. A straightforward build keeps the routine simple.";

function context(confirmedFacts: Array<{ factId: string; field: string; label: string; value: string }>) {
  return buildListingV5Context({
    taskId: "task-model-code",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Test Product",
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

function detailsFor(facts: Array<{ factId: string; field: string; label: string; value: string }>, text: string, factIds: string[]) {
  const ctx = context(facts);
  const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), probeDraft(text, factIds));
  return report.claims.unsupportedDetails ?? [];
}

function codesFor(facts: Array<{ factId: string; field: string; label: string; value: string }>, text: string, factIds: string[]) {
  return detailsFor(facts, text, factIds).map((detail) => detail.issueCode);
}

describe("Listing V5 model code evidence", () => {
  it("accepts a confirmed model code as evidence for its own token", () => {
    const codes = codesFor(factsWithModel("BF140"), "The model number is BF140.", ["model-1"]);
    expect(codes).not.toContain("unsupported_model_code");
    expect(codes).not.toContain("unsupported_attribute_assertion");
  });

  it("accepts a confirmed hyphenated series value", () => {
    const codes = codesFor(factsWithModel("YYJ-Lineshading-1305"), "The model number is YYJ-Lineshading-1305.", ["model-1"]);
    expect(codes).not.toContain("unsupported_model_code");
    expect(codes).not.toContain("unsupported_attribute_assertion");
  });

  it("does not treat a code-looking value under another canonical field as model evidence", () => {
    // Only `canonicalField === "series_or_model"` is evidence. The earlier fallback
    // ("any confirmed value that looks like a code") was removed, so a code filed as a
    // feature is not evidence and the token is reported instead of being excused.
    const codes = codesFor(factsWithModel("GT035", "functional_feature"), "The model number is GT035.", ["model-1"]);
    expect(codes).toContain("unsupported_model_code");
  });

  it("never treats ordinary SKU-like, size-like or word-like tokens as model codes", () => {
    const tokens = ["SKU123", "SKU-123", "ABC123", "PRO5", "V2", "A100", "XL2", "B0F831L31B", "Black2", "Plastic5"];
    for (const token of tokens) {
      const codes = codesFor(factsWithModel("BF140"), `The set includes ${token} pieces for the display.`, ["type-1"]);
      expect(codes, `${token} must not be reported as unsupported_model_code`).not.toContain("unsupported_model_code");
    }
  });

  it("reports a model-shaped code that no confirmed value covers", () => {
    for (const fake of ["BF999", "GT035X", "YYJ-Lineshading-1305X"]) {
      const details = detailsFor(factsWithModel("BF140"), `The model number is ${fake}.`, []);
      expect(details.map((detail) => detail.issueCode)).toContain("unsupported_model_code");
      expect(details.some((detail) => detail.offendingSpans.includes(fake))).toBe(true);
    }
  });

  it("keeps the real C7 sentence failing although its model code is confirmed", () => {
    const text = "Each strand weighs 0.17 kg, and the model is GT035, so you can check the exact variant before you buy.";
    const details = detailsFor(factsWithModel("GT035"), text, ["weight-1", "model-1"]);
    expect(details.length).toBeGreaterThan(0);
    expect(details.map((detail) => detail.issueCode)).not.toContain("unsupported_model_code");
  });

  it("keeps the real C1 framing sentence failing", () => {
    const text = "If you are checking the exact variant, this set carries the model number YYJ-Lineshading-1305.";
    const details = detailsFor(factsWithModel("YYJ-Lineshading-1305"), text, ["model-1"]);
    expect(details.length).toBeGreaterThan(0);
    expect(details.map((detail) => detail.issueCode)).not.toContain("unsupported_model_code");
  });

  it("never treats an ASIN, a size, a brand, a colour or a material word as a model code", () => {
    const text = "B0F831L31B fits a 10cm shelf in 2XL Black Sticker, ready for the season, and the material is Plastic.";
    const codes = codesFor(factsWithModel("BF140"), text, ["type-1", "color-1"]);
    expect(codes).not.toContain("unsupported_model_code");
  });

  it("does not let a confirmed model code excuse a promotion clause it appears next to", () => {
    const withClause = detailsFor(factsWithModel("GT035"), "The model is GT035, so you have plenty of options.", ["model-1"]);
    expect(withClause.length).toBeGreaterThan(0);
    const withoutClause = codesFor(factsWithModel("GT035"), "The model is GT035.", ["model-1"]);
    expect(withoutClause).not.toContain("unsupported_attribute_assertion");
  });
});
