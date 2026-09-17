import { describe, expect, it } from "vitest";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { validateListingV5Draft } from "./validation";
import type { ListingV5WriterDraft } from "./types";

/**
 * Repairability boundary of the V5 Validator.
 *
 * Measured on the real Case-D chain (2026-09-12, deepseek-v4-flash): the Writer
 * expressed a confirmed fact as an outcome ("A weighted base helps the lamp stay in
 * place鈥?) and as compatibility ("USB-C powered, so it works with the cable already on
 * hand"). Both are ONE sentence in ONE field, and both BLOCKED, so the entire AI draft 鈥? * including every strategy-derived sentence 鈥?was discarded for the deterministic
 * fallback. Those two families are now repairable; the blocking families must stay
 * blocking, and the bounded repair scope must keep holding.
 */

function context(facts: Array<{ factId: string; field: string; label: string; value: string }>, prohibitedClaims: string[] = []) {
  return buildListingV5Context({
    taskId: "task-repairability", researchRevision: 1, handoffRevision: 1, productIdentity: "Adjustable LED Desk Lamp",
    generationInput: {
      schema: "listing-generation-input.v1", source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: [], stableSourceFacts: [], creativeReferences: [], creativePreferences: {},
      prohibitedClaims, unknowns: [], humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
    },
    confirmedFacts: facts,
  });
}

const brand = { factId: "brand-1", field: "brand", label: "Brand", value: "Lumio" };
const productType = { factId: "type-1", field: "product_type", label: "Product type", value: "LED desk lamp" };
const base = { factId: "base-1", field: "base_type", label: "Base", value: "Weighted base" };
const power = { factId: "power-1", field: "power_source", label: "Power source", value: "USB-C powered" };
const facts = [brand, productType, base, power];

/** Every fixture stays anchored; only the segment under test can be unsupported. */
function draftWith(overrides: Partial<ListingV5WriterDraft> = {}): ListingV5WriterDraft {
  return {
    version: "listing-v5.writer-draft.v1",
    title: { text: "Lumio LED Desk Lamp", factIds: ["brand-1", "type-1"] },
    bullets: [
      { text: "The Lumio LED desk lamp is a USB-C powered desk lamp for everyday work.", factIds: ["brand-1", "type-1", "power-1"], strategyRole: "core_outcome" },
      { text: "The lamp has a weighted base and comes as a USB-C powered desk lamp.", factIds: ["base-1", "power-1"], strategyRole: "pain_relief" },
      { text: "A Lumio LED desk lamp for a home office desk.", factIds: ["brand-1", "type-1"], strategyRole: "use_scenario" },
    ],
    description: { text: "The Lumio LED desk lamp is USB-C powered. The base is weighted for a home office desk.", factIds: ["brand-1", "type-1", "base-1"] },
    backendSearchTerms: [],
    humanReviewRequired: true,
    ...overrides,
  } as ListingV5WriterDraft;
}

const outcomeBullet = () => ({
  text: "A weighted base helps the lamp stay in place on a lightweight desk.",
  factIds: ["base-1"],
  strategyRole: "proof_or_fit" as const,
});

const compatibilityBullet = () => ({
  text: "USB-C powered, so it works with the cable already on hand.",
  factIds: ["power-1"],
  strategyRole: "ease_of_use" as const,
});

describe("Listing V5 repairability boundary", () => {
  it("keeps a clean draft on PASS", () => {
    const ctx = context(facts);
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draftWith());
    expect(report.status).toBe("PASS");
    expect(report.repair.targets).toEqual([]);
  });

  it("makes a single-sentence dimension claim repairable instead of blocking", () => {
    const ctx = context(facts);
    const draft = draftWith({ bullets: [draftWith().bullets[0]!, outcomeBullet(), draftWith().bullets[2]!] });
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft);
    expect((report.claims.unsupportedDetails ?? []).map((detail) => detail.reason)).toContain("unsupported_dimension_claim");
    expect(report.status).toBe("REPAIRABLE");
    expect(report.repair.allowed).toBe(true);
    expect(report.repair.targets).toContain("bullets[1]");
  });

  it("makes a single-sentence compatibility claim repairable instead of blocking", () => {
    const ctx = context(facts);
    const draft = draftWith({ bullets: [draftWith().bullets[0]!, compatibilityBullet(), draftWith().bullets[2]!] });
    const report = validateListingV5Draft(ctx, buildListingV5Strategy(ctx), draft);
    expect((report.claims.unsupportedDetails ?? []).map((detail) => detail.reason)).toContain("unsupported_compatibility_claim");
    expect(report.status).toBe("REPAIRABLE");
    expect(report.repair.targets).toContain("bullets[1]");
  });

  it("still blocks certification, absolute-promise and prohibited wording families", () => {
    const ctx = context(facts);
    const prohibitedCtx = context(facts, ["lifetime warranty"]);
    const strategy = buildListingV5Strategy(ctx);
    const cases: Array<{ context: ReturnType<typeof context>; reason: string; text: string }> = [
      { context: ctx, reason: "unsupported_certification_claim", text: "This desk lamp is ETL certified for safety." },
      { context: ctx, reason: "unsupported_absolute_claim", text: "The desk lamp is guaranteed for life." },
      { context: prohibitedCtx, reason: "prohibited_claim", text: "Includes a lifetime warranty on the desk lamp." },
    ];
    for (const entry of cases) {
      const draft = draftWith({
        bullets: [draftWith().bullets[0]!, { text: entry.text, factIds: ["type-1"], strategyRole: "proof_or_fit" }, draftWith().bullets[2]!],
      });
      const report = validateListingV5Draft(entry.context, strategy, draft);
      expect((report.claims.unsupportedDetails ?? []).map((detail) => detail.reason)).toContain(entry.reason);
      expect(report.status).toBe("BLOCK");
      expect(report.repair.allowed).toBe(false);
    }
  });

  it("keeps the bounded repair scope: more claims than the ceiling is still BLOCK", () => {
    const ctx = context(facts);
    const strategy = buildListingV5Strategy(ctx);
    const withinScope = draftWith({
      bullets: [draftWith().bullets[0]!, outcomeBullet(), draftWith().bullets[2]!],
      description: { text: "USB-C powered, so it works with the cable already on hand. The base is weighted for a home office desk.", factIds: ["power-1", "base-1"] },
    });
    const withinReport = validateListingV5Draft(ctx, strategy, withinScope);
    expect(withinReport.status).toBe("REPAIRABLE");
    expect(withinReport.repair.targets.length).toBeLessThanOrEqual(3);

    const tooWide = draftWith({
      title: { text: "Lumio compact size LED Desk Lamp", factIds: ["brand-1", "type-1"] },
      bullets: [
        outcomeBullet(),
        compatibilityBullet(),
        { text: "A lightweight body for a compact size desk setup.", factIds: ["type-1"], strategyRole: "use_scenario" },
      ],
      description: { text: "The base is lightweight. It works with the cable already on hand.", factIds: ["base-1", "power-1"] },
    });
    expect(validateListingV5Draft(ctx, strategy, tooWide).status).toBe("BLOCK");
  });
});
