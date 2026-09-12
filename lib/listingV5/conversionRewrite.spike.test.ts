import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V5.2 Conversion Rewrite spike contract.
 *
 * This is the spike entry point: it drives the rewrite module directly and does
 * not touch the production generate chain. It proves the shape of the module's
 * behaviour under a stubbed provider, so the real-provider spike (Phase 3) can
 * spend its four calls on the two blocked cases instead of on wiring mistakes.
 */
const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint } from "./conversionBlueprint";
import { rewriteListingV5Draft } from "./conversionRewrite";
import { validateListingV5Draft } from "./validation";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

const MARKERS = { competitor: "COMPETITORWORDINGMARKER", sourcing: "SUPPLIERMOQMARKER" };

function context() {
  return buildListingV5Context({
    taskId: "task-rewrite-spike",
    researchRevision: 4,
    handoffRevision: 2,
    productIdentity: "Ant Bait Stations",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 2, researchRevision: 4 },
      productFacts: [{ field: "quantity_or_pack_size", label: "Quantity", value: "12 bait stations" }],
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
      source: { researchRevision: 4, candidateId: "candidate-1" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: [],
      keywordCandidates: [{ keyword: "ant bait stations", reportType: "search", rowNumber: 1, evidenceRef: "ev:k1", observedAt: "", provenance: { evidenceRef: "ev:k1", sourceType: "keyword", observedAt: "" } }],
      competitiveContext: [{ asin: "B0SPIKE", note: MARKERS.competitor, addedAt: "2026-09-11T00:00:00.000Z", evidenceRef: "ev:c1", provenance: { evidenceRef: "ev:c1", sourceType: "competitor", observedAt: "" } }],
      sourcingContext: [{ offerId: "offer-1", method: "image", title: MARKERS.sourcing, displayedPrice: "1.23", displayedMoq: "500", imageUrl: "", confirmed: false, evidenceRef: "ev:s1", observedAt: "", provenance: { evidenceRef: "ev:s1", sourceType: "sourcing", observedAt: "" } }],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 0, keywordCandidates: 1, competitiveInsights: 1, sourcingEntries: 1, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [
      { factId: "fact-qty", field: "quantity_or_pack_size", label: "Quantity", value: "12 bait stations" },
      { factId: "fact-type", field: "product_type", label: "Product type", value: "Liquid ant bait" },
      { factId: "fact-care", field: "care", label: "Care", value: "Replace every 3 months" },
    ],
  });
}

const failedListing: ListingV5WriterDraft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Leakproof liquid ant bait that kills every colony fast", factIds: ["fact-type"] },
  bullets: [{ text: "Leakproof stations stay sealed indoors.", factIds: ["fact-type"], strategyRole: "core_outcome" }],
  description: { text: "A leakproof ant bait solution.", factIds: ["fact-type"] },
  backendSearchTerms: [],
  humanReviewRequired: true,
};

function blockedValidation(): ListingV5ValidationResult {
  return {
    version: LISTING_V5_VALIDATION_VERSION,
    status: "BLOCK",
    title: { valid: true, issues: [] },
    bullets: [],
    description: { valid: true, issues: [] },
    claims: {
      allHaveEvidence: false,
      unsupportedClaims: ["leakproof", "kills every colony fast"],
      prohibitedClaims: [],
      competitorOverlap: [],
      unsupportedDetails: [{ text: "VALIDATORDETAILMARKER liquid ant bait", reason: "VALIDATORREASONMARKER no confirmed fact supports leakproof", field: "title", issueCode: "unsupported_hard_claim", offendingSpans: ["VALIDATORSPANMARKER"] }],
    },
    quality: { repetitive: false, keywordStufring: false, mechanicalTemplate: false } as never,
    repair: { allowed: false, reason: "blocked", targets: [] },
  };
}

function passingRewrite() {
  return {
    title: { text: "Liquid ant bait stations for indoor kitchens", factIds: ["fact-type"] },
    bullets: [
      { text: "For indoor kitchens, 12 bait stations cover the spots you already watch.", factIds: ["fact-qty"], strategyRole: "core_outcome" },
      { text: "Liquid ant bait suits the trails ants already follow indoors.", factIds: ["fact-type"], strategyRole: "use_scenario" },
      { text: "Replace every 3 months keeps the routine easy to remember.", factIds: ["fact-care"], strategyRole: "ease_of_use" },
    ],
    description: { text: "Liquid ant bait in 12 bait stations for indoor use. Replace every 3 months.", factIds: ["fact-qty"] },
    keywords: ["ant bait stations indoors"],
    humanReviewRequired: true,
  };
}

function run(overrides: Partial<Parameters<typeof rewriteListingV5Draft>[0]> = {}) {
  const ctx = context();
  const strategy = buildListingV5Strategy(ctx);
  return rewriteListingV5Draft(
    { context: ctx, strategy, blueprint: buildListingV5ConversionBlueprint(ctx, strategy), failedListing, validation: blockedValidation(), ...overrides },
    { useProvider: true },
  );
}

describe("Conversion Rewrite spike", () => {
  beforeEach(() => callAiJson.mockReset());

  it("returns a complete listing that survives the same Validator", async () => {
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: passingRewrite() });
    const result = await run();
    expect(result.attempted).toBe(true);
    expect(result.succeeded).toBe(true);
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    // Output went through the shared writer normaliser: 3+ bullets, allowed factIds.
    expect(result.draft?.bullets.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(ctx.confirmedFacts.map((fact) => fact.id));
    expect(result.draft?.bullets.every((bullet) => bullet.factIds.every((id) => allowed.has(id)))).toBe(true);
    // `keywords` from the provider is mapped onto the draft schema.
    expect(result.draft?.backendSearchTerms).toEqual(["ant bait stations indoors"]);
    // Second validation pass on the rewritten draft: the Validator is the judge.
    const validation = validateListingV5Draft(ctx, strategy, result.draft!);
    expect(validation.status).toBe("PASS");
    expect(validation.claims.unsupportedClaims.length).toBe(0);
  });

  it("does not add unsupported claims and never leaks competitor or sourcing text", async () => {
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: passingRewrite() });
    const result = await run();
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const validation = validateListingV5Draft(ctx, strategy, result.draft!);
    expect(validation.claims.unsupportedClaims).toEqual([]);
    expect(validation.claims.prohibitedClaims).toEqual([]);
    expect(validation.claims.competitorOverlap).toEqual([]);
    const messages = (callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role?: string; content: string }> }).messages;
    const prompt = messages.map((message) => message.content).join("\n");
    const userPayload = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}") as { approvedBenefits?: Array<{ factIds?: string[]; text?: string }>; strategy?: Record<string, unknown> };
    expect(userPayload.approvedBenefits?.length).toBeGreaterThan(0);
    expect(userPayload.approvedBenefits?.every((item) => (item.factIds ?? []).length > 0)).toBe(true);
    expect(userPayload.strategy?.referenceOnly).toBe(true);
    expect(userPayload.strategy).not.toHaveProperty("purchaseMotivations");
    expect(userPayload.strategy).not.toHaveProperty("painPoints");
    expect(userPayload.strategy).not.toHaveProperty("bulletAngles");
    expect(prompt).not.toContain(MARKERS.competitor);
    expect(prompt).not.toContain(MARKERS.sourcing);
    // V5.2 whitelist: only the issue *category* reaches the model. The Validator's
    // own detail text, its reason and its offending spans must never be sent, so a
    // rewrite can neither be steered by nor recycle the rejected wording from the
    // validation report. (The rejected listing itself is sent on purpose: the model
    // has to know what it must not repeat.)
    expect(prompt).toContain("unsupported_hard_claim");
    expect(prompt).not.toContain("VALIDATORDETAILMARKER");
    expect(prompt).not.toContain("VALIDATORREASONMARKER");
    expect(prompt).not.toContain("VALIDATORSPANMARKER");
    expect(prompt.replace(/NO NEW SOURCES:[^\n]*/i, "")).not.toMatch(/1688|supplier|moq/i);
    const serialized = JSON.stringify(result.draft);
    expect(serialized).not.toContain(MARKERS.competitor);
    expect(serialized).not.toContain(MARKERS.sourcing);
  });

  it("fails closed without confirmed facts, without reported issues, or on a bad provider response", async () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const blueprint = buildListingV5ConversionBlueprint(ctx, strategy);
    const noFacts = { ...ctx, confirmedFacts: [] };
    const withoutFacts = await rewriteListingV5Draft({ context: noFacts, strategy, blueprint, failedListing, validation: blockedValidation() }, { useProvider: true });
    expect(withoutFacts.attempted).toBe(false);
    expect(withoutFacts.draft).toBeNull();

    const clean = { ...blockedValidation(), status: "PASS" as const, claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] } };
    const noIssues = await rewriteListingV5Draft({ context: ctx, strategy, blueprint, failedListing, validation: clean }, { useProvider: true });
    expect(noIssues.attempted).toBe(false);
    expect(noIssues.draft).toBeNull();
    expect(callAiJson).not.toHaveBeenCalled();

    callAiJson.mockResolvedValueOnce({ ok: false, providerCallStarted: true, diagnostics: { reason: "provider_request_failed" } });
    const failed = await run();
    expect(failed.succeeded).toBe(false);
    expect(failed.draft).toBeNull();

    callAiJson.mockReset();
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: { title: { text: "only a title", factIds: ["fact-type"] } } });
    const unusable = await run();
    expect(unusable.succeeded).toBe(false);
    expect(unusable.draft).toBeNull();
  });

  it("does not consume shopper benefits from a legacy Blueprint", async () => {
    callAiJson.mockResolvedValueOnce({ ok: false, providerCallStarted: true, diagnostics: { reason: "provider_request_failed" } });
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const legacyBlueprint = { ...buildListingV5ConversionBlueprint(ctx, strategy), version: "listing-v5.conversion-blueprint.v1" } as never;
    await rewriteListingV5Draft({ context: ctx, strategy, blueprint: legacyBlueprint, failedListing, validation: blockedValidation() }, { useProvider: true });
    const messages = (callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role?: string; content: string }> }).messages;
    const payload = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}") as { conversionBlueprint?: unknown; approvedBenefits?: unknown };
    expect(payload.conversionBlueprint).toBeNull();
    expect(payload.approvedBenefits).toEqual([]);
  });
});
