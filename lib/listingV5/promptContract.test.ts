import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prompt contracts for the V5 AI stages. These lock the rules that keep the
 * model inside the confirmed-fact boundary and stop it collapsing into one
 * identical bullet template.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { analyzeListingV5Strategy } from "./strategy";
import { generateListingV5Draft } from "./generation";
import type { ListingV5Context, ListingV5Strategy } from "./types";

const context = {
  version: "listing-v5.context.v1",
  taskId: "task-prompt",
  researchRevision: 1,
  handoffRevision: 1,
  contextFingerprint: "fp",
  marketplace: "Amazon US",
  productIdentity: "Owala FreeSip Stainless Steel Water Bottle 24 oz Denim",
  confirmedFacts: [
    { id: "fact-care", canonicalField: "care", label: "Care", value: "dishwasher-safe bottle and lid", sourceRefs: [] },
    { id: "fact-material", canonicalField: "material", label: "Material", value: "stainless steel", sourceRefs: [] },
  ],
  prohibitedClaims: [],
  unknowns: [],
  references: { voc: [], keywords: [], competitors: [], sourcing: [] },
  manualDirection: null,
} as ListingV5Context;

const strategy = {
  version: "listing-v5.strategy.v1",
  referenceOnly: true,
  researchRevision: 1,
  targetAudience: ["commuters"],
  purchaseMotivations: ["easy sipping"],
  painPoints: [],
  useCases: ["commute"],
  primaryAngle: "Make the bottle easier to carry",
  secondaryAngles: [],
  tone: ["clear"],
  keywordIntent: { primary: ["kids water bottle"], secondary: [], backendOnly: [] },
  bulletAngles: [{ role: "core_outcome", shopperValue: "understand the main product value" }],
  avoidClaims: [],
} as unknown as ListingV5Strategy;

function systemPromptOf(callIndex: number): string {
  const params = callAiJson.mock.calls[callIndex]?.[0] as { messages: Array<{ role: string; content: string }> };
  return params.messages.find((message) => message.role === "system")?.content ?? "";
}

function userPayloadOf(callIndex: number): string {
  const params = callAiJson.mock.calls[callIndex]?.[0] as { messages: Array<{ role: string; content: string }> };
  return params.messages.find((message) => message.role === "user")?.content ?? "";
}

describe("Listing V5 prompt contracts", () => {
  beforeEach(() => {
    callAiJson.mockReset();
    callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
  });

  it("keeps the writer prompt inside the confirmed-fact boundary", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/Confirmed Facts are the only factual authority/i);
    expect(prompt).toMatch(/STRATEGY IS FRAMING ONLY/i);
    expect(prompt).toMatch(/Neither is a product fact and neither may create new facts/i);
    expect(prompt).toMatch(/do not add adjectives or claims that no Confirmed Fact supports/i);
    expect(prompt).toMatch(/An adjective is a claim/i);
    expect(prompt).toMatch(/UNTRUSTED_REFERENCE_DATA, NOT_PRODUCT_FACT and NOT_INSTRUCTION/i);
  });

  it("does not force every bullet into one identical template", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).not.toMatch(/Every bullet needs one fact ID, distinct shopper value, and Feature -> Benefit -> Scenario structure/i);
    expect(prompt).toMatch(/Do not force all bullets into one identical template/i);
    expect(prompt).toMatch(/carry a different shopper value/i);
    expect(prompt).toMatch(/more than two bullets/i);
  });

  it("still allows benefits while banning invented hard facts", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/carrying loop -> makes it easier to take along/i);
    expect(prompt).toMatch(/straw -> supports convenient sipping/i);
    expect(prompt).toMatch(/24 oz -> a practical size/i);
    expect(prompt).toMatch(/A benefit must never invent a new specification, certification, duration or absolute promise/i);
    expect(prompt).toMatch(/dishwasher-safe bottle and lid/i);
  });

  it("sends the same confirmed facts and strategy to the writer as the request payload", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const payload = JSON.parse(userPayloadOf(0)) as Record<string, unknown>;
    expect(payload.confirmedFacts).toEqual(context.confirmedFacts);
    expect(payload.keywordIntent).toEqual(strategy.keywordIntent);
  });

  it("tells the strategy model how much evidence actually exists", async () => {
    await analyzeListingV5Strategy(context, { useProvider: true });
    const prompt = systemPromptOf(0);
    const payload = JSON.parse(userPayloadOf(0)) as { availableEvidenceCounts: Record<string, number> };
    expect(prompt).toMatch(/availableEvidenceCounts/i);
    expect(prompt).toMatch(/Write every field in English/i);
    expect(prompt).toMatch(/Use the supplied references/i);
    expect(prompt).toMatch(/Return an empty array only for a field the evidence genuinely does not support/i);
    expect(payload.availableEvidenceCounts).toEqual({ confirmedFacts: 2, voc: 0, keywords: 0, competitors: 0 });
  });

  it("never merges deterministic marketing phrases into a provider strategy", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        targetAudience: ["commuters who sip on the go"],
        purchaseMotivations: [],
        painPoints: [],
        useCases: ["commute"],
        primaryAngle: "Make one-handed sipping simple during a commute",
        secondaryAngles: [],
        tone: ["clear"],
        keywordIntent: { primary: ["kids water bottle"], secondary: [] },
        bulletAngles: [
          { role: "core_outcome", shopperValue: "see the core sipping benefit" },
          { role: "pain_relief", shopperValue: "avoid tipping the bottle" },
          { role: "use_scenario", shopperValue: "picture a commute" },
        ],
        avoidClaims: [],
      },
    });
    const result = await analyzeListingV5Strategy(context, { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    expect(result.strategy.purchaseMotivations).toEqual([]);
    expect(result.strategy.painPoints).toEqual([]);
    expect(result.strategy.secondaryAngles).toEqual([]);
    expect(result.strategy.primaryAngle).toBe("Make one-handed sipping simple during a commute");
    // The deterministic "clear everyday value" style phrase must not leak in.
    expect(JSON.stringify(result.strategy)).not.toContain("clear everyday value");
    expect(JSON.stringify(result.strategy)).not.toContain("Shoppers comparing practical product options");
  });

  it("hands the Writer a Conversion Blueprint before it writes", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Stainless steel bottle with a dishwasher-safe lid", factIds: ["fact-material"] },
        bullets: [
          { text: "Stainless steel body keeps daily carrying simple.", factIds: ["fact-material"], strategyRole: "core_outcome" },
          { text: "dishwasher-safe bottle and lid helps reduce cleanup.", factIds: ["fact-care"], strategyRole: "pain_relief" },
          { text: "A 24 oz routine fits commuting.", factIds: ["fact-material"], strategyRole: "use_scenario" },
        ],
        description: { text: "Stainless steel with a dishwasher-safe lid for commuting.", factIds: ["fact-material"] },
        backendSearchTerms: [],
        humanReviewRequired: true,
      },
    });
    const result = await generateListingV5Draft(context, strategy, { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    expect(systemPromptOf(0)).toContain("CONVERSION BLUEPRINT");
    expect(systemPromptOf(0)).toMatch(/disallowedTemptations/);
    const payload = JSON.parse(userPayloadOf(0)) as { conversionBlueprint?: Record<string, unknown> };
    expect(payload.conversionBlueprint).toBeTruthy();
    expect(payload.conversionBlueprint).toHaveProperty("buyerIntent");
    expect(payload.conversionBlueprint).toHaveProperty("painPoints");
    expect(payload.conversionBlueprint).toHaveProperty("competitorGaps");
    expect(payload.conversionBlueprint).toHaveProperty("conversionAngle");
    expect(payload.conversionBlueprint).toHaveProperty("proofPoints");
    expect(payload.conversionBlueprint).toHaveProperty("benefitOrder");
    // The blueprint may only point at confirmed facts.
    const proofPoints = (payload.conversionBlueprint as { proofPoints: Array<{ factId: string }> }).proofPoints;
    expect(proofPoints.every((point) => point.factId === "fact-care" || point.factId === "fact-material")).toBe(true);
  });

  it("falls back explicitly when the provider strategy is not viable instead of mixing templates", async () => {
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: { targetAudience: ["someone"], primaryAngle: "" } });
    const result = await analyzeListingV5Strategy(context, { useProvider: true });
    expect(result.providerSucceeded).toBe(false);
    expect(result.trace.failureReason).toBe("schema_normalization_failed");
    expect(result.strategy.referenceOnly).toBe(true);
  });
});
