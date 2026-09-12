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

  it("keeps rating, review count and customer feedback as display-only social proof", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/SOCIAL PROOF BOUNDARY/i);
    expect(prompt).toMatch(/confirmed rating and review count are display-only information/i);
    expect(prompt).toMatch(/state the exact rating and exact review count/i);
    expect(prompt).toMatch(/customer-feedback observation as an attributed reference/i);
    expect(prompt).toMatch(/never turn social proof into a product-quality judgment, trust signal, ranking, recommendation/i);
    expect(prompt).toMatch(/Social proof is not an approved benefit and cannot license a product claim/i);
    for (const phrase of [
      "straightforward pick",
      "great choice",
      "smart choice",
      "trusted option",
      "customer favorite",
      "recommended choice",
    ]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toMatch(/Rated 4\.7 from 48,559 reviews/i);
  });

  it("keeps social proof display-only and blocks readiness wording from included components", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);

    // A rating may be shown only as an exact, standalone display sentence; it
    // cannot be attached to a feature or turned into a benefit or recommendation.
    expect(prompt).toMatch(/SOCIAL PROOF OUTPUT FORM \(strict\)/i);
    expect(prompt).toMatch(/one standalone display-only sentence/i);
    expect(prompt).toMatch(/4\.7 rating from 48,559 reviews/i);
    expect(prompt).toMatch(/Do not write "it is rated \.{3}"/i);
    expect(prompt).toMatch(/Never place social proof in approvedBenefits, shopperValue, pain relief, or scenario framing/i);
    for (const phrase of ["trusted", "recommended", "great choice"]) {
      expect(prompt).toContain(phrase);
    }

    // Included components can support a packing action, but may not be
    // inflated into a product readiness state that the facts do not state.
    expect(prompt).toMatch(/READY-WORDING BOUNDARY \(strict\)/i);
    for (const phrase of ["ready to grab", "ready to use", "ready for school", "ready for lunch"]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toMatch(/unless that exact state is a Confirmed Fact/i);
  });

  it("does not infer usage state or result from an included component and lunch scenario", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/COMPONENT ACTION BOUNDARY \(strict\)/i);
    expect(prompt).toMatch(/describe pack contents and the shopper's packing action only/i);
    for (const phrase of ["opened at lunch", "when opened", "during use", "after opening", "eating", "has a spoon"]) {
      expect(prompt).toContain(phrase);
    }
    expect(prompt).toMatch(/A confirmed usage scenario may frame when the shopper packs or carries the product/i);
    expect(prompt).toMatch(/The set includes a food jar with unfolding spoon/i);
    expect(prompt).toMatch(/cannot turn an included component into a claim about what happens when the product is opened or used/i);
  });

  /**
   * Measured on the real Case-D chain (2026-09-12, deepseek-v4-flash): the provider
   * strategy phrased a bullet angle as an outcome ("designed for small desks where the
   * lamp should stay put and not slide"), the Writer copied the outcome into bullet 5
   * ("A weighted base helps the lamp stay in place ..."), the Validator rejected it as an
   * unsupported dimension claim, and because that reason is not locally repairable the
   * whole AI draft was discarded — the shipped Listing became the deterministic fallback
   * and every strategy-derived sentence was lost. The benefit boundary below is what the
   * Validator already enforced; stating it in the prompt removes the contradiction instead
   * of relaxing the rule.
   */
  it("states the benefit boundary the Validator enforces (fact meaning, never an outcome)", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/A benefit states what the fact means for the shopper's task/i);
    expect(prompt).toMatch(/never a physical outcome the fact does not itself state/i);
    expect(prompt).toMatch(/never "the base keeps the lamp in place"/i);
    expect(prompt).toMatch(/rather than an adjective no fact states such as "compact"/i);
  });

  it("stops the Writer copying a strategy phrase that promises an outcome", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/When the strategy itself phrases a value as an outcome/i);
    expect(prompt).toMatch(/do not copy that promise/i);
    expect(prompt).toMatch(/re-state it through the confirmed facts/i);
  });

  it("keeps strategy framing inside the supplied fact vocabulary", async () => {
    await analyzeListingV5Strategy(context, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/FRAMING VOCABULARY/i);
    expect(prompt).toMatch(/Never phrase a value as a physical outcome or a promise/i);
    expect(prompt).toMatch(/never "the base keeps the lamp in place", "stays put" or "does not slide"/i);
    expect(prompt).toMatch(/never introduce an adjective the supplied facts do not state/i);
    expect(prompt).toMatch(/instead of a word such as compact/i);
  });

  /**
   * v7 quality contract: the strategy stops being context and becomes an executed
   * contract, every bullet carries fact + benefit + scenario, the placeholder
   * sentences the deterministic fallback uses are banned from AI copy, the purchase
   * reason leads instead of the product name, and keyword intent is distributed
   * across the shopper-visible copy.
   */
  it("requires the Writer to execute buyerIntent, painPoints, primaryAngle and keywordIntent", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/STRATEGY EXECUTION \(required, not optional\)/i);
    expect(prompt).toMatch(/bullet 1 leads with conversionAngle \/ strategy\.primaryAngle/i);
    expect(prompt).toMatch(/at least two bullets relieve a painPoint whose factBacked is true/i);
    expect(prompt).toMatch(/bullet n carries benefitOrder\[n-1\]\.role/i);
    expect(prompt).toMatch(/the title carries conversionBlueprint\.buyerIntent\.primary and keywordIntent\.primary/i);
    expect(prompt).toMatch(/targetAudience and useCases framing supplied in `strategy`/i);
  });

  it("requires every bullet to carry a fact, a benefit and a usage scenario", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/EVERY BULLET = FACT \+ BENEFIT \+ SCENARIO \(all three, in every bullet\)/i);
    expect(prompt).toMatch(/restate at least one Confirmed Fact value/i);
    expect(prompt).toMatch(/place it in one concrete use moment/i);
    expect(prompt).toMatch(/The moment is what the shopper is DOING/i);
    // Measured: "for a desk where space is limited" was flagged by the Validator as an
    // unsupported attribute ("limited"), so the scenario contract names that failure.
    expect(prompt).toMatch(/never "for a desk where space is limited" or "for a small desk"/i);
    expect(prompt).toMatch(/an adjective about the place is a product claim with no Confirmed Fact behind it/i);
    expect(prompt).toMatch(/Take the moment from strategy\.useCases or the blueprint's use_scenario material/i);
    expect(prompt).toMatch(/Vary the moment between bullets/i);
  });

  it("bans the low-conversion placeholder sentences", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/BANNED TEMPLATE SENTENCES/i);
    for (const placeholder of [
      "helps shoppers understand the product at a glance",
      "shoppers can compare a clear product detail",
      "brings ... into a simple product choice",
      "a clear ... detail helps shoppers decide",
      "allows users to ...",
      "helping shoppers ...",
      "gives shoppers a clear detail to compare",
    ]) {
      expect(prompt).toContain(placeholder);
    }
    expect(prompt).toMatch(/If a sentence could be pasted onto any other listing unchanged, delete it/i);
  });

  it("leads with the purchase reason instead of the product name", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/PURCHASE REASONS FIRST/i);
    expect(prompt).toMatch(/lead each bullet and the description with the reason to buy/i);
    expect(prompt).toMatch(/Do not open a bullet with the product name/i);
    expect(prompt).toMatch(/do not repeat the full product name inside bullets/i);
  });

  it("distributes keyword intent across the visible copy without stuffing", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/KEYWORD PLACEMENT \(natural, never stuffed\)/i);
    expect(prompt).toMatch(/the title carries keywordIntent\.primary/i);
    expect(prompt).toMatch(/spread the keywordIntent\.secondary terms and the keyword candidates supplied in the references/i);
    expect(prompt).toMatch(/Cover at least four supplied terms in total beyond the title/i);
    expect(prompt).toMatch(/a term never appears more than twice in the whole listing/i);
  });

  it("forbids one bullet skeleton across the whole listing", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/VARY THE OPENING/i);
    expect(prompt).toMatch(/never use a label-style opener followed by a colon/i);
    expect(prompt).toMatch(/Mix a direct benefit sentence, a question the shopper asks/i);
    expect(prompt).toMatch(/Five bullets that share one skeleton read as a template/i);
  });

  /**
   * Measured on the v7 samples: the Validator's copula rule reads "you are still
   * reading" / "you are not reaching" / "when you are arranging" as an unsupported
   * attribute ("still", "not", "arranging"), and "works with the cable you already
   * own" as an unsupported compatibility claim. Naming those constructions keeps the
   * prompt inside the rule instead of asking the rule to relax.
   */
  it("keeps the copy inside the sentence shapes the copy rules accept", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/SAFE SENTENCE SHAPES/i);
    expect(prompt).toMatch(/never "while you are still reading", "so you are not reaching for a switch" or "when you are arranging a home office"/i);
    expect(prompt).toMatch(/never that the lamp "works with" or is "compatible with" a cable or device/i);
  });

  it("bounds the bullet length so the copy stays scannable", async () => {
    await generateListingV5Draft(context, strategy, { useProvider: true });
    const prompt = systemPromptOf(0);
    expect(prompt).toMatch(/ONE SENTENCE PER BULLET, 12 to 30 words/i);
    expect(prompt).toMatch(/Never chain two sentences/i);
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

  it("keeps claim wording from research references out of the blueprint handed to the Writer", async () => {
    // Security regression: the blueprint shares one prompt with the copy rules.
    // Reference text such as "durable, leakproof premium lid" used to reach the
    // prompt verbatim, so the model read a rule banning those words and a
    // blueprint using them in the same request.
    const riskyContext = {
      ...context,
      references: {
        voc: [{ text: "durability: the lid is durable and leakproof premium quality", sourceType: "VOC", marker: "UNTRUSTED_REFERENCE_DATA", notProductFact: true }],
        keywords: [],
        competitors: [{ text: "leakproof premium tumbler with durable shell", sourceType: "competitor", marker: "UNTRUSTED_REFERENCE_DATA", notProductFact: true }],
        sourcing: [],
      },
    } as ListingV5Context;
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        title: { text: "Stainless steel bottle", factIds: ["fact-material"] },
        bullets: [
          { text: "Stainless steel body suits daily carrying.", factIds: ["fact-material"], strategyRole: "core_outcome" },
          { text: "dishwasher-safe bottle and lid helps cleanup.", factIds: ["fact-care"], strategyRole: "pain_relief" },
          { text: "A 24 oz size fits commuting.", factIds: ["fact-material"], strategyRole: "use_scenario" },
        ],
        description: { text: "Stainless steel with a dishwasher-safe lid for commuting.", factIds: ["fact-material"] },
        backendSearchTerms: [],
        humanReviewRequired: true,
      },
    });
    const result = await generateListingV5Draft(riskyContext, strategy, { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    const payload = JSON.parse(userPayloadOf(0)) as { conversionBlueprint?: Record<string, unknown> };
    const blueprint = payload.conversionBlueprint ?? {};
    // Reference-derived text must not carry claim wording into the prompt. The
    // prohibition list itself is allowed to name the forbidden words.
    expect(JSON.stringify(blueprint.painPoints ?? [])).not.toMatch(/durable|leakproof|premium/i);
    expect(JSON.stringify(blueprint.competitorGaps ?? [])).not.toMatch(/durable|leakproof|premium/i);
    expect(JSON.stringify(blueprint.buyerIntent ?? {})).not.toMatch(/durable|leakproof|premium/i);
  });

  it("falls back explicitly when the provider strategy is not viable instead of mixing templates", async () => {
    callAiJson.mockResolvedValueOnce({ ok: true, providerCallStarted: true, data: { targetAudience: ["someone"], primaryAngle: "" } });
    const result = await analyzeListingV5Strategy(context, { useProvider: true });
    expect(result.providerSucceeded).toBe(false);
    expect(result.trace.failureReason).toBe("schema_normalization_failed");
    expect(result.strategy.referenceOnly).toBe(true);
  });
});
