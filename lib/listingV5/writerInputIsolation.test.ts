import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V5.1 input isolation: the Writer prompt may only carry Confirmed Facts and the
 * fact-bound conversion blueprint. Research references (VOC / keyword /
 * competitor) and sourcing material must never reach it, so a competitor's
 * wording can never be echoed and a supplier's terms can never leak.
 */
const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { generateListingV5Draft, projectStrategyReferenceForProvider } from "./generation";

const MARKERS = {
  voc: "SHOPPERWORDFROMREVIEWS",
  keyword: "KEYWORDFROMSELLERSPRITE",
  competitor: "COMPETITORWORDINGMARKER",
  sourcing: "SUPPLIERMOQMARKER",
};

function context() {
  return buildListingV5Context({
    taskId: "task-isolation",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Isolation Fixture",
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
      vocInsights: [{ insightId: "v1", theme: "care", summary: MARKERS.voc, evidenceRefs: [], reviewCount: 5, coverage: 1, strength: "recurring", sourceType: "voc_theme", provenance: { evidenceRef: "ev:v1", sourceType: "voc", observedAt: "" } }],
      keywordCandidates: [{ keyword: MARKERS.keyword, reportType: "search", rowNumber: 1, evidenceRef: "ev:k1", observedAt: "", provenance: { evidenceRef: "ev:k1", sourceType: "keyword", observedAt: "" } }],
      competitiveContext: [{ asin: "B0MARKER", note: MARKERS.competitor, addedAt: "2026-09-11T00:00:00.000Z", evidenceRef: "ev:c1", provenance: { evidenceRef: "ev:c1", sourceType: "competitor", observedAt: "" } }],
      sourcingContext: [{ offerId: "offer-1", method: "image", title: MARKERS.sourcing, displayedPrice: "1.23", displayedMoq: "500", imageUrl: "", confirmed: false, evidenceRef: "ev:s1", observedAt: "", provenance: { evidenceRef: "ev:s1", sourceType: "sourcing", observedAt: "" } }],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 1, keywordCandidates: 1, competitiveInsights: 1, sourcingEntries: 1, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [{ factId: "fact-material", field: "material", label: "Material", value: "Steel" }],
  });
}

describe("Writer input isolation (V5.1)", () => {
  beforeEach(() => callAiJson.mockReset());

  it("projects Strategy as reference-only and removes free-text benefit fields", () => {
    const strategy = buildListingV5Strategy(context());
    const reference = projectStrategyReferenceForProvider(strategy);
    expect(reference.referenceOnly).toBe(true);
    expect(reference.targetAudience).toEqual(strategy.targetAudience);
    expect(reference.primaryAngle).toBe(strategy.primaryAngle);
    expect(reference.useCases).toEqual(strategy.useCases);
    expect(reference.tone).toEqual(strategy.tone);
    expect(reference.bulletRoles).toEqual(strategy.bulletAngles.map(({ role }) => ({ role })));
    for (const field of ["purchaseMotivations", "painPoints", "bulletAngles", "benefitCandidates", "evidenceBindings", "benefitPriorityBasis"]) {
      expect(reference).not.toHaveProperty(field);
    }
  });

  it("sends no VOC, keyword, competitor or sourcing text to the Writer", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Steel fixture for daily use", factIds: ["fact-material"] },
        bullets: [
          { text: "Steel construction suits daily use where a sturdy surface matters.", factIds: ["fact-material"], strategyRole: "core_outcome" },
          { text: "The steel body keeps the routine simple to maintain.", factIds: ["fact-material"], strategyRole: "pain_relief" },
          { text: "For everyday setups, steel holds up to repeated handling.", factIds: ["fact-material"], strategyRole: "use_scenario" },
        ],
        description: { text: "A steel fixture for daily use. It suits repeated handling.", factIds: ["fact-material"] },
        backendSearchTerms: [],
        humanReviewRequired: true,
      },
    });
    await generateListingV5Draft(context(), buildListingV5Strategy(context()), { useProvider: true });
    const params = callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    const payload = params.messages.map((message) => message.content).join("\n");
    // Competitor and sourcing material must be absent entirely. VOC / keyword
    // text may only appear as strategy framing (never in confirmedFacts).
    expect(payload).not.toContain(MARKERS.competitor);
    expect(payload).not.toContain(MARKERS.sourcing);
    const facts = (JSON.parse(params.messages.find((message) => message.role === "user")?.content ?? "{}") as { confirmedFacts?: unknown }).confirmedFacts;
    expect(JSON.stringify(facts ?? [])).not.toContain(MARKERS.voc);
    expect(JSON.stringify(facts ?? [])).not.toContain(MARKERS.competitor);
    expect(payload).not.toMatch(/1688|supplier|moq/i);
    expect(payload).toContain("fact-material");
  });

  it("sends the same reference projection rather than executable Strategy benefits", async () => {
    callAiJson.mockResolvedValueOnce({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
    const strategy = buildListingV5Strategy(context());
    const params = await generateListingV5Draft(context(), strategy, { useProvider: true });
    expect(params.providerAttempted).toBe(true);
    const payload = JSON.parse((callAiJson.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> }).messages.find((message) => message.role === "user")?.content ?? "{}") as { strategy?: Record<string, unknown>; approvedBenefits?: unknown };
    expect(payload.strategy?.referenceOnly).toBe(true);
    expect(payload.strategy).toHaveProperty("targetAudience");
    expect(payload.strategy).toHaveProperty("primaryAngle");
    expect(payload.strategy).toHaveProperty("tone");
    expect(payload.strategy).not.toHaveProperty("purchaseMotivations");
    expect(payload.strategy).not.toHaveProperty("painPoints");
    expect(payload.strategy).not.toHaveProperty("bulletAngles");
    expect(payload.strategy).not.toHaveProperty("benefitCandidates");
    expect(payload.approvedBenefits).toBeDefined();
  });
});
