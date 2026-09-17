import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V5.1 Safe Recovery boundaries. Recovery is the last step before the honest
 * fallback, so its prompt may only carry Confirmed Facts plus the fact-bound
 * blueprint, must refuse to run without a reported violation, and must fail
 * closed (no draft) whenever the provider does not return a usable draft.
 */
const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint } from "./conversionBlueprint";
import { recoverListingV5Draft } from "./conversionRecovery";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

const MARKERS = { competitor: "COMPETITORWORDINGMARKER", sourcing: "SUPPLIERMOQMARKER" };

function fixture() {
  return buildListingV5Context({
    taskId: "task-recovery",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Recovery Fixture",
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
      competitiveContext: [{ asin: "B0REC", note: MARKERS.competitor, addedAt: "2026-09-11T00:00:00.000Z", evidenceRef: "ev:c1", provenance: { evidenceRef: "ev:c1", sourceType: "competitor", observedAt: "" } }],
      sourcingContext: [{ offerId: "offer-1", method: "image", title: MARKERS.sourcing, displayedPrice: "1.23", displayedMoq: "500", imageUrl: "", confirmed: false, evidenceRef: "ev:s1", observedAt: "", provenance: { evidenceRef: "ev:s1", sourceType: "sourcing", observedAt: "" } }],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 0, keywordCandidates: 0, competitiveInsights: 1, sourcingEntries: 1, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [{ factId: "fact-material", field: "material", label: "Material", value: "Steel" }],
  });
}

const draft: ListingV5WriterDraft = {
  version: "listing-v5.writer-draft.v1",
  title: { text: "Steel fixture", factIds: ["fact-material"] },
  bullets: [{ text: "Steel body for daily handling.", factIds: ["fact-material"], strategyRole: "core_outcome" }],
  description: { text: "A steel fixture.", factIds: ["fact-material"] },
  backendSearchTerms: [],
  humanReviewRequired: true,
};

function failingValidation(): ListingV5ValidationResult {
  return {
    version: LISTING_V5_VALIDATION_VERSION,
    status: "REPAIRABLE",
    title: { valid: true, issues: [] },
    bullets: [],
    description: { valid: true, issues: [] },
    claims: {
      allHaveEvidence: false,
      unsupportedClaims: ["leakproof lid"],
      prohibitedClaims: [],
      competitorOverlap: [],
      unsupportedDetails: [{ text: "Steel construction is leakproof for daily use.", reason: "no confirmed fact supports leakproof", field: "bullets[0]", issueCode: "unsupported_hard_claim", offendingSpans: ["leakproof"] }],
    },
    quality: { repetitive: false, keywordStuffing: false, mechanicalTemplate: false },
    repair: { allowed: true, reason: "one bounded repair", targets: ["bullets[0]"] },
  };
}

function passingValidation(): ListingV5ValidationResult {
  return { ...failingValidation(), status: "PASS", claims: { allHaveEvidence: true, unsupportedClaims: [], prohibitedClaims: [], competitorOverlap: [] } };
}

function run(validation: ListingV5ValidationResult) {
  const context = fixture();
  const strategy = buildListingV5Strategy(context);
  return recoverListingV5Draft(
    { context, strategy, blueprint: buildListingV5ConversionBlueprint(context, strategy), failedDraft: draft, validation },
    { useProvider: true },
  );
}

describe("Safe Recovery boundaries", () => {
  beforeEach(() => callAiJson.mockReset());

  it("sends facts and the blueprint but no competitor or sourcing text, and does not run without a violation", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Steel fixture for daily use", factIds: ["fact-material"] },
        bullets: [
          { text: "Steel body for daily handling.", factIds: ["fact-material"], strategyRole: "core_outcome" },
          { text: "Steel suits repeated use in a workshop.", factIds: ["fact-material"], strategyRole: "use_scenario" },
          { text: "The steel surface keeps the routine simple.", factIds: ["fact-material"], strategyRole: "pain_relief" },
        ],
        description: { text: "A steel fixture for daily use. It suits repeated handling.", factIds: ["fact-material"] },
        backendSearchTerms: [],
        humanReviewRequired: true,
      },
    });
    const recovered = await run(failingValidation());
    expect(recovered.attempted).toBe(true);
    expect(recovered.succeeded).toBe(true);
    const messages = (callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }).messages;
    const payload = messages.map((message) => message.content).join("\n");
    const userPayload = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}") as { approvedBenefits?: Array<{ factIds?: string[]; text?: string }>; strategy?: Record<string, unknown> };
    expect(userPayload.approvedBenefits?.length).toBeGreaterThan(0);
    expect(userPayload.approvedBenefits?.every((item) => (item.factIds ?? []).length > 0)).toBe(true);
    expect(userPayload.strategy?.referenceOnly).toBe(true);
    expect(userPayload.strategy).not.toHaveProperty("purchaseMotivations");
    expect(userPayload.strategy).not.toHaveProperty("painPoints");
    expect(userPayload.strategy).not.toHaveProperty("bulletAngles");
    expect(payload).not.toContain(MARKERS.competitor);
    expect(payload).not.toContain(MARKERS.sourcing);
    // The prompt is allowed to *forbid* supplier data; no sourcing value may ride along.
    const withoutProhibition = payload.replace(/NO NEW SOURCES:[^\n]*/i, "");
    expect(withoutProhibition).not.toMatch(/1688|supplier|moq/i);
    expect(withoutProhibition).not.toContain("1.23");
    expect(withoutProhibition).not.toContain("500");
    expect(payload).toContain("fact-material");
    expect(payload).toContain("prohibitedVocabulary");
    expect(payload).toContain("UNTRUSTED_REFERENCE_DATA");
    // factIds of the recovered draft must stay inside the confirmed facts
    expect(recovered.draft?.bullets.every((bullet) => bullet.factIds.every((id) => id === "fact-material"))).toBe(true);

    callAiJson.mockReset();
    const noViolation = await run(passingValidation());
    expect(noViolation.attempted).toBe(false);
    expect(noViolation.succeeded).toBe(false);
    expect(noViolation.draft).toBeNull();
    expect(callAiJson).not.toHaveBeenCalled();
  });

  it("fails closed when the provider fails or returns an unusable draft", async () => {
    callAiJson.mockResolvedValueOnce({ ok: false, providerCallStarted: true, diagnostics: { reason: "provider_request_failed" } });
    const failed = await run(failingValidation());
    expect(failed.succeeded).toBe(false);
    expect(failed.draft).toBeNull();
    expect(failed.attempted).toBe(true);

    callAiJson.mockReset();
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: { title: { text: "only a title", factIds: ["fact-material"] } } });
    const unusable = await run(failingValidation());
    expect(unusable.succeeded).toBe(false);
    expect(unusable.draft).toBeNull();
  });

  it("does not consume shopper benefits from a legacy Blueprint", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Steel fixture for daily use", factIds: ["fact-material"] },
        bullets: [
          { text: "Steel body for daily handling.", factIds: ["fact-material"], strategyRole: "core_outcome" },
          { text: "Steel suits repeated use in a workshop.", factIds: ["fact-material"], strategyRole: "use_scenario" },
          { text: "The steel surface keeps the routine simple.", factIds: ["fact-material"], strategyRole: "pain_relief" },
        ],
        description: { text: "A steel fixture for daily use. It suits repeated handling.", factIds: ["fact-material"] },
        backendSearchTerms: [],
        humanReviewRequired: true,
      },
    });
    const ctx = fixture();
    const strategy = buildListingV5Strategy(ctx);
    const legacyBlueprint = { ...buildListingV5ConversionBlueprint(ctx, strategy), version: "listing-v5.conversion-blueprint.v1" } as never;
    await recoverListingV5Draft({ context: ctx, strategy, blueprint: legacyBlueprint, failedDraft: draft, validation: failingValidation() }, { useProvider: true });
    const messages = (callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }).messages;
    const payload = JSON.parse(messages.find((message) => message.role === "user")?.content ?? "{}") as { conversionBlueprint?: unknown; approvedBenefits?: unknown };
    expect(payload.conversionBlueprint).toBeNull();
    expect(payload.approvedBenefits).toEqual([]);
  });
});
