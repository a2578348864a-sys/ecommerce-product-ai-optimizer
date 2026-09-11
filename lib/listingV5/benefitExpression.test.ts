import { describe, expect, it, vi } from "vitest";

/**
 * Listing V5.8 Phase 4 — Safe Benefit Expression Layer.
 *
 * The contract these tests lock:
 *   1. an evidence-backed candidate becomes fact-anchored framing the Writer can
 *      use, and every expression stays traceable to the candidate's evidence id;
 *   2. a concept no Confirmed Fact can carry produces NOTHING (never an invented
 *      benefit), and a candidate without evidence is skipped entirely;
 *   3. the layer's own wording can never contain a hard-claim token — proven both
 *      by scanning the output and by running the REAL Validator, which rejects the
 *      tempting wording while accepting the safe expression;
 *   4. the tempting wording is reported as blocked, with a reason;
 *   5. the expressions actually reach the Writer payload, and the layer adds no
 *      provider call.
 *
 * The provider client is mocked throughout, so generation exercises its real
 * payload-building code path without any network call.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildBenefitExpressions, hasUsableExpression } from "./benefitExpression";
import { buildListingV5Context } from "./context";
import { buildListingV5Strategy } from "./strategy";
import { generateListingV5Draft } from "./generation";
import { validateListingV5Draft } from "./validation";
import { LISTING_V5_BENEFIT_CANDIDATE_VERSION } from "./types";
import type { ListingV5BenefitCandidate, ListingV5Context, ListingV5Fact } from "./types";

const GENERATION_INPUT = {
  schema: "listing-generation-input.v1" as const,
  source: { handoffRevision: 1, researchRevision: 1 },
  productFacts: [],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: [] as string[],
  unknowns: [] as string[],
  humanReviewRequired: true as const,
  researchMode: "market_research_only" as const,
  promotionEligible: false,
};

function context(prohibitedClaims: string[] = []): ListingV5Context {
  return buildListingV5Context({
    taskId: "task-benefit-expression",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Insulated Tumbler",
    generationInput: { ...GENERATION_INPUT, prohibitedClaims },
    confirmedFacts: [
      { factId: "fact-material", field: "material", label: "Material", value: "stainless steel" },
      { factId: "fact-dims", field: "dimensions", label: "Dimensions", value: "7.3 inch" },
      { factId: "fact-capacity", field: "capacity", label: "Capacity", value: "24 oz" },
      { factId: "fact-care", field: "care", label: "Care", value: "wipe clean" },
      { factId: "fact-color", field: "color_or_variant", label: "Colour", value: "Denim" },
    ],
  } as never);
}

function factsOf(ctx: ListingV5Context): ListingV5Fact[] {
  return ctx.confirmedFacts;
}

function candidate(concept: string, evidenceIds: string[] = ["voc:theme:theme-1"]): ListingV5BenefitCandidate {
  return {
    candidateId: `benefit:${concept}:${evidenceIds[0] ?? "none"}`,
    concept,
    kind: "buyer_concern",
    framing: concept,
    evidenceIds,
    strength: "recurring",
    count: 6,
    score: 112,
    marker: "UNTRUSTED_REFERENCE_DATA",
    notProductFact: true,
  };
}

describe("Phase 4 — candidates become safe, fact-anchored expressions", () => {
  it("turns an evidence-backed candidate into a safe expression anchored to a fact", () => {
    const ctx = context();
    const set = buildBenefitExpressions({
      candidates: [candidate("durability")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: ctx.prohibitedClaims,
    });
    const [entry] = set.expressions;
    expect(set.source).toBe("candidates");
    expect(entry?.concept).toBe("durability");
    expect(entry?.safeExpressions).toEqual(["stainless steel — ready for regular use"]);
    expect(entry?.factIds).toEqual(["fact-material"]);
    // Traceability: the candidate's evidence ids travel through untouched.
    expect(entry?.evidenceIds).toEqual(["voc:theme:theme-1"]);
    expect(hasUsableExpression(set)).toBe(true);
  });

  it("carries several concepts through and keeps each one attributable", () => {
    const ctx = context();
    const set = buildBenefitExpressions({
      candidates: [candidate("durability", ["voc:theme:a"]), candidate("size_fit", ["voc:theme:b"]), candidate("value_for_money", ["voc:theme:c"])],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    });
    expect(set.expressions.map((entry) => entry.concept)).toEqual(["durability", "size_fit", "value_for_money"]);
    expect(set.expressions.map((entry) => entry.evidenceIds[0])).toEqual(["voc:theme:a", "voc:theme:b", "voc:theme:c"]);
    expect(set.expressions.every((entry) => entry.safeExpressions.length > 0)).toBe(true);
  });
});

describe("Phase 4 — nothing is invented when the evidence or the fact is missing", () => {
  it("emits no expression when no Confirmed Fact can carry the concept", () => {
    const ctx = context();
    // `sipping` needs operation / functional_feature / included_components — none exist here.
    const set = buildBenefitExpressions({
      candidates: [candidate("sipping")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    });
    const [entry] = set.expressions;
    expect(entry?.safeExpressions).toEqual([]);
    expect(hasUsableExpression(set)).toBe(false);
    // Reported rather than silently dropped.
    expect(entry?.blockedExpressions.some((item) => item.reason === "no_supporting_fact")).toBe(true);
  });

  it("skips a candidate that carries no evidence id", () => {
    const ctx = context();
    const set = buildBenefitExpressions({
      candidates: [candidate("durability", [])],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    });
    expect(set.expressions).toEqual([]);
    expect(set.source).toBe("none");
  });

  it("produces nothing from an empty or absent candidate set", () => {
    const ctx = context();
    expect(buildBenefitExpressions({ candidates: [], confirmedFacts: factsOf(ctx), prohibitedClaims: [] }).source).toBe("none");
    expect(buildBenefitExpressions({ candidates: undefined, confirmedFacts: factsOf(ctx), prohibitedClaims: [] }).expressions).toEqual([]);
    // No facts at all: still nothing.
    expect(buildBenefitExpressions({ candidates: [candidate("durability")], confirmedFacts: [], prohibitedClaims: [] }).expressions[0]?.safeExpressions).toEqual([]);
  });
});

describe("Phase 4 — the layer cannot introduce a hard claim", () => {
  it("never writes a hard-claim token into its own wording", () => {
    const ctx = context();
    const set = buildBenefitExpressions({
      candidates: [
        candidate("durability"), candidate("leak_resistance"), candidate("ease_of_cleaning"),
        candidate("capacity"), candidate("portability"), candidate("organization"),
        candidate("size_fit"), candidate("appearance"), candidate("color_accuracy"),
        candidate("value_for_money"), candidate("gift_readiness"), candidate("ease_of_setup"), candidate("sipping"),
      ],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    });
    // Every clause is composed only from the Writer's approved persuasion vocabulary.
    for (const entry of set.expressions) {
      for (const expression of entry.safeExpressions) {
        const clause = expression.split("—").slice(1).join("—").trim();
        expect(clause.length).toBeGreaterThan(0);
        expect(clause).not.toMatch(/\b(durable|durability|lasting|leakproof|waterproof|leak|spill|tough|unbreakable|dishwasher|safe|insulated|maximum|heavy|professional|perfect|best|complete|total|always|never|every|all|high)\b/i);
      }
    }
  });

  it("safe expressions pass the REAL Validator while the tempting wording does not", () => {
    const ctx = context();
    const strategy = buildListingV5Strategy(ctx);
    const set = buildBenefitExpressions({
      candidates: [candidate("durability")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: ctx.prohibitedClaims,
    });
    const safe = set.expressions[0]!.safeExpressions[0]!;
    expect(safe).toBe("stainless steel — ready for regular use");

    const draftWith = (bulletText: string, factId: string) => ({
      version: "listing-v5.writer-draft.v1" as const,
      title: { text: "Insulated Tumbler", factIds: [factId] },
      bullets: [{ text: bulletText, factIds: [factId], strategyRole: "core_outcome" as const }],
      description: { text: "A tumbler for daily routines.", factIds: [factId] },
      backendSearchTerms: [],
      humanReviewRequired: true as const,
    });

    const safeReport = validateListingV5Draft(ctx, strategy, draftWith(safe, "fact-material"));
    expect(safeReport.claims.unsupportedClaims).not.toContain(safe);
    expect(safeReport.status).not.toBe("BLOCK");

    const riskyReport = validateListingV5Draft(ctx, strategy, draftWith("durable stainless steel construction", "fact-material"));
    expect(riskyReport.claims.unsupportedClaims.length).toBeGreaterThan(0);
    // The Validator refuses to pass it: the tempting wording never reaches copy.
    expect(riskyReport.status).not.toBe("PASS");
  });
});

describe("Phase 4 — blocked wording is reported, supported wording is not", () => {
  it("lists the tempting wording with a reason", () => {
    const ctx = context();
    const [entry] = buildBenefitExpressions({
      candidates: [candidate("durability")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    }).expressions;
    const blocked = entry?.blockedExpressions ?? [];
    expect(blocked.map((item) => item.text)).toContain("durable");
    expect(blocked.find((item) => item.text === "durable")?.reason).toBe("hard_claim_token");
  });

  it("does not block wording that a Confirmed Fact already states verbatim", () => {
    const ctx = buildListingV5Context({
      taskId: "task-verbatim",
      researchRevision: 1,
      handoffRevision: 1,
      productIdentity: "Tumbler",
      generationInput: GENERATION_INPUT,
      confirmedFacts: [{ factId: "fact-care", field: "care", label: "Care", value: "dishwasher safe" }],
    } as never);
    const [entry] = buildBenefitExpressions({
      candidates: [candidate("ease_of_cleaning")],
      confirmedFacts: ctx.confirmedFacts,
      prohibitedClaims: [],
    }).expressions;
    // The fact itself says it, so the word is not forbidden for this product.
    expect(entry?.blockedExpressions.map((item) => item.text)).not.toContain("dishwasher");
    expect(entry?.safeExpressions).toEqual(["dishwasher safe — tidier to keep up"]);
  });

  it("respects the frozen context's prohibited claims", () => {
    const ctx = context(["no waterproof wording"]);
    const [entry] = buildBenefitExpressions({
      candidates: [candidate("leak_resistance")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: ctx.prohibitedClaims,
    }).expressions;
    expect(entry?.blockedExpressions.find((item) => item.text === "waterproof")?.reason).toBe("prohibited_claim");
  });
});

describe("Phase 4 — the expressions reach the Writer", () => {
  it("hands the Writer the safe expressions and the blocked wording, adding no call", async () => {
    const ctx = context();
    const strategy = {
      ...buildListingV5Strategy(ctx),
      benefitCandidates: {
        version: LISTING_V5_BENEFIT_CANDIDATE_VERSION,
        source: "evidence" as const,
        candidates: [candidate("durability")],
      },
    };
    callAiJson.mockReset();
    callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });

    await generateListingV5Draft(ctx, strategy, { useProvider: true });

    // Exactly one provider call: the expression layer is pure and adds none.
    expect(callAiJson).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(
      (callAiJson.mock.calls[0]?.[0] as { messages: Array<{ content: string }> }).messages[1]!.content,
    ) as { benefitExpressions?: { expressions?: Array<{ safeExpressions?: string[]; blockedExpressions?: Array<{ text: string }> }> } };
    const sent = payload.benefitExpressions?.expressions?.[0];
    expect(sent?.safeExpressions).toEqual(["stainless steel — ready for regular use"]);
    expect(sent?.blockedExpressions?.map((item) => item.text)).toContain("durable");
  });
});

describe("Phase 4 — purity", () => {  it("is deterministic and never mutates its input", () => {
    const ctx = context();
    const candidates = [candidate("durability")];
    const before = JSON.stringify({ candidates, facts: factsOf(ctx) });
    const a = buildBenefitExpressions({ candidates, confirmedFacts: factsOf(ctx), prohibitedClaims: [] });
    const b = buildBenefitExpressions({ candidates, confirmedFacts: factsOf(ctx), prohibitedClaims: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify({ candidates, facts: factsOf(ctx) })).toBe(before);
  });

  it("never copies research reference wording into an expression", () => {
    const ctx = context();
    const set = buildBenefitExpressions({
      candidates: [candidate("durability")],
      confirmedFacts: factsOf(ctx),
      prohibitedClaims: [],
    });
    expect(JSON.stringify(set)).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
