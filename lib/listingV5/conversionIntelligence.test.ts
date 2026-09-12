import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V5.1 Listing Intelligence Layer contracts.
 *
 * Two things must hold or the layer is not safe: every "why people buy" field in
 * the blueprint points at Confirmed Facts, and the Writer prompt actually asks
 * for the decision sequence while still banning unsupported claims.
 */
const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { buildListingV5ConversionBlueprint, LISTING_V5_DECISION_SEQUENCE } from "./conversionBlueprint";
import { generateListingV5Draft } from "./generation";
import { HARD_OR_ESCALATION_TOKENS } from "./claimVocabulary";

function fixture() {
  return buildListingV5Context({
    taskId: "task-v51",
    researchRevision: 2,
    handoffRevision: 1,
    productIdentity: "Liquid Ant Bait Stations",
    generationInput: {
      schema: "listing-generation-input.v1",
      source: { handoffRevision: 1, researchRevision: 2 },
      productFacts: [{ field: "quantity_or_pack_size", label: "Quantity", value: "12 bait stations" }],
      stableSourceFacts: [],
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: ["bait performance over time"],
      humanReviewRequired: true,
      researchMode: "market_research_only",
      promotionEligible: false,
    },
    creativeContext: {
      schema: "creative-context.v1",
      version: 1,
      generatedAt: "",
      source: { researchRevision: 2, candidateId: "candidate-1" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: [{
        insightId: "v1",
        theme: "replacement",
        summary: "needs replacing often in a kitchen",
        evidenceRefs: [],
        reviewCount: 11,
        coverage: 1,
        strength: "recurring",
        sourceType: "voc_theme",
        provenance: { evidenceRef: "ev:v1", sourceType: "voc", observedAt: "" },
      }],
      keywordCandidates: [
        { keyword: "ant bait stations", reportType: "search", rowNumber: 1, evidenceRef: "ev:k1", observedAt: "", provenance: { evidenceRef: "ev:k1", sourceType: "keyword", observedAt: "" } },
        { keyword: "indoor ant killer", reportType: "search", rowNumber: 2, evidenceRef: "ev:k2", observedAt: "", provenance: { evidenceRef: "ev:k2", sourceType: "keyword", observedAt: "" } },
      ],
      competitiveContext: [],
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: 1, keywordCandidates: 2, competitiveInsights: 0, sourcingEntries: 0, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [
      { factId: "fact-qty", field: "quantity_or_pack_size", label: "Quantity", value: "12 bait stations" },
      { factId: "fact-care", field: "care", label: "Care", value: "Replace every 3 months" },
      { factId: "fact-type", field: "product_type", label: "Product type", value: "Liquid ant bait" },
    ],
  });
}

describe("Conversion Blueprint 2.0", () => {
  it("binds every purchase trigger, objection resolution and benefit priority to Confirmed Fact ids", () => {
    const context = fixture();
    const blueprint = buildListingV5ConversionBlueprint(context, buildListingV5Strategy(context));
    const allowed = new Set(context.confirmedFacts.map((fact) => fact.id));
    expect(blueprint.purchaseTriggers.length).toBeGreaterThan(0);
    for (const trigger of blueprint.purchaseTriggers) {
      expect(trigger.factBacked).toBe(trigger.factIds.length > 0);
      for (const id of trigger.factIds) expect(allowed.has(id)).toBe(true);
    }
    for (const objection of blueprint.objectionHandling) {
      expect(objection.factIds.length).toBeGreaterThan(0);
      for (const id of objection.factIds) expect(allowed.has(id)).toBe(true);
      expect(objection.resolution.length).toBeGreaterThan(0);
    }
    for (const benefit of blueprint.benefitPriority) {
      expect(benefit.factIds.length).toBeGreaterThan(0);
      for (const id of benefit.factIds) expect(allowed.has(id)).toBe(true);
      expect(benefit.priority).toBeGreaterThan(0);
    }
    expect(blueprint.benefitPriority.map((benefit) => benefit.priority)).toEqual(blueprint.benefitPriority.map((_, index) => index + 1));
  });

  it("never invents an objection resolution for a pain no fact can answer", () => {
    const context = fixture();
    const blueprint = buildListingV5ConversionBlueprint(context, buildListingV5Strategy(context));
    const unbacked = blueprint.purchaseTriggers.filter((trigger) => !trigger.factBacked);
    for (const trigger of unbacked) {
      expect(trigger.factIds).toEqual([]);
      expect(blueprint.objectionHandling.some((objection) => objection.objection === trigger.trigger)).toBe(false);
    }
  });

  it("exposes the decision sequence as a stable ordered contract", () => {
    const context = fixture();
    const blueprint = buildListingV5ConversionBlueprint(context, buildListingV5Strategy(context));
    expect(blueprint.decisionSequence).toEqual([...LISTING_V5_DECISION_SEQUENCE]);
    expect(blueprint.decisionSequence[0]).toBe("use_scenario");
    expect(blueprint.decisionSequence[blueprint.decisionSequence.length - 1]).toBe("risk_reduction");
  });

  it("exposes one conversion brief and fact pointer per planned bullet", () => {
    const context = fixture();
    const blueprint = buildListingV5ConversionBlueprint(context, buildListingV5Strategy(context));
    expect(blueprint.targetBuyer).toBeTruthy();
    expect(blueprint.primaryPurchaseReason).toBeTruthy();
    expect(blueprint.positioningAngle).toBeTruthy();
    expect(blueprint.bulletPlan.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(context.confirmedFacts.map((fact) => fact.id));
    for (const item of blueprint.bulletPlan) {
      expect(item.role).toBeTruthy();
      expect(item.shopperQuestion).toBeTruthy();
      expect(item.shopperValue).toBeTruthy();
      expect(item.evidenceId).toBeTruthy();
      expect(allowed.has(item.evidenceId)).toBe(true);
    }
  });

  it("changes the conversion brief with strategy direction while keeping fact anchors stable", () => {
    const context = fixture();
    const baseStrategy = buildListingV5Strategy(context);
    const changedStrategy = {
      ...baseStrategy,
      targetAudience: ["commuters who need a grab-and-go drink routine"],
      purchaseMotivations: ["make an everyday carry easier to choose"],
      primaryAngle: "lead with the carry-and-sip routine",
    };
    const base = buildListingV5ConversionBlueprint(context, baseStrategy);
    const changed = buildListingV5ConversionBlueprint(context, changedStrategy);
    expect(changed.targetBuyer).not.toBe(base.targetBuyer);
    expect(changed.positioningAngle).not.toBe(base.positioningAngle);
    expect(changed.bulletPlan.map((item) => item.evidenceId)).toEqual(base.bulletPlan.map((item) => item.evidenceId));
  });
});

describe("Writer v5.1 prompt contract", () => {
  beforeEach(() => callAiJson.mockReset());

  function promptsOf(index = 0) {
    const params = callAiJson.mock.calls[index]?.[0] as { messages: Array<{ role: string; content: string }> };
    const system = params.messages.find((message) => message.role === "system")?.content ?? "";
    const user = params.messages.find((message) => message.role === "user")?.content ?? "";
    return { system, user };
  }

  it("hands the Writer the blueprint 2.0 fields while keeping fact authority in the prompt", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Liquid ant bait stations for kitchens", factIds: ["fact-type"] },
        bullets: [
          { text: "For kitchens, 12 bait stations cover the spots you already watch.", factIds: ["fact-qty"], strategyRole: "core_outcome" },
          { text: "Replace every 3 months keeps the routine easy to remember.", factIds: ["fact-care"], strategyRole: "pain_relief" },
          { text: "Liquid ant bait suits indoor use where ants follow the same path.", factIds: ["fact-type"], strategyRole: "use_scenario" },
        ],
        description: { text: "Liquid ant bait in 12 bait stations for indoor use. Replace every 3 months.", factIds: ["fact-qty"] },
        backendSearchTerms: ["indoor ant killer"],
        humanReviewRequired: true,
      },
    });
    const result = await generateListingV5Draft(fixture(), buildListingV5Strategy(fixture()), { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    const { system, user } = promptsOf();
    expect(system).toContain("Confirmed Facts are the only factual authority");
    expect(system).toContain("CONVERSION BLUEPRINT");
    expect(system).toContain("disallowedTemptations");
    expect(system).toContain("factIds must be ids of Confirmed Facts");
    const payload = JSON.parse(user) as { conversionBlueprint?: Record<string, unknown> };
    const blueprint = payload.conversionBlueprint ?? {};
    for (const field of ["targetBuyer", "primaryPurchaseReason", "positioningAngle", "bulletPlan", "purchaseTriggers", "objectionHandling", "benefitPriority", "decisionSequence"]) {
      if (["targetBuyer", "primaryPurchaseReason", "positioningAngle"].includes(field)) {
        expect(typeof blueprint[field]).toBe("string");
        continue;
      }
      expect(Array.isArray(blueprint[field])).toBe(true);
    }
  });
  it("keeps hard-claim wording out of the prompt body", async () => {
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: {} });
    await generateListingV5Draft(fixture(), buildListingV5Strategy(fixture()), { useProvider: true });
    const { system } = promptsOf();
    // The prompt is allowed to name the forbidden words inside its two prohibition
    // lists; every other line must be free of them.
    const tokens = ["guaranteed", "waterproof", "leakproof", "premium", "fda"];
    const violations = system
      .split("\n")
      .filter((line) => !/NEVER INVENT|BANNED VOCABULARY/i.test(line))
      .filter((line) => tokens.some((token) => line.toLowerCase().includes(token)));
    expect(violations).toEqual([]);
    expect(HARD_OR_ESCALATION_TOKENS.has("waterproof")).toBe(true);
  });
});
