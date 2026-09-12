import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Listing V5.8 Phase 1 — evidence-ranked benefit priority.
 *
 * The contract these tests lock:
 *   1. the ORDER of the benefit lists is driven by the evidence behind each
 *      need (strength, observation volume, keyword demand, comparable
 *      competitor observation), not by the order the match rules are written in;
 *   2. every entry states an auditable reason, and only ever names evidence ids
 *      that resolve against the frozen context;
 *   3. Evidence Binding semantics are untouched: a deterministic template is
 *      still an `ai_suggestion` even when the need behind it is evidence-ranked,
 *      and no provider call is added.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { analyzeListingV5Strategy, buildListingV5Strategy } from "./strategy";
import type { ListingV5BenefitPriority, ListingV5Context } from "./types";

const GENERATION_INPUT = {
  schema: "listing-generation-input.v1" as const,
  source: { handoffRevision: 1, researchRevision: 1 },
  productFacts: [],
  stableSourceFacts: [],
  creativeReferences: [],
  creativePreferences: {},
  prohibitedClaims: [],
  unknowns: [],
  humanReviewRequired: true as const,
  researchMode: "market_research_only" as const,
  promotionEligible: false,
};

type VocInput = { insightId: string; theme: string; summary: string; reviewCount: number; strength: string };
type KeywordInput = { keyword: string; reportType: string; rowNumber: number };
type CompetitorInput = { asin: string; note: string };

function context(input: {
  voc?: VocInput[];
  keywords?: KeywordInput[];
  competitors?: CompetitorInput[];
  facts?: Array<{ factId: string; field: string; label: string; value: string }>;
} = {}): ListingV5Context {
  const vocInsights = input.voc ?? [];
  const keywordCandidates = input.keywords ?? [];
  const competitiveContext = input.competitors ?? [];
  return buildListingV5Context({
    taskId: "task-benefit-priority",
    researchRevision: 1,
    handoffRevision: 1,
    productIdentity: "Kitchen Organizer",
    generationInput: GENERATION_INPUT,
    creativeContext: {
      schema: "creative-context.v1",
      version: 1,
      generatedAt: "",
      source: { researchRevision: 1, candidateId: "candidate-1" },
      confirmedFacts: [],
      confirmableFactCandidates: [],
      vocInsights: vocInsights.map((item) => ({
        ...item,
        evidenceRefs: [],
        coverage: 0.2,
        sourceType: "voc_theme",
        provenance: { evidenceRef: `ev:${item.insightId}`, sourceType: "voc_theme", observedAt: "" },
      })),
      keywordCandidates: keywordCandidates.map((item) => ({
        ...item,
        evidenceRef: `ev:kw:${item.rowNumber}`,
        observedAt: "",
        provenance: { evidenceRef: `ev:kw:${item.rowNumber}`, sourceType: "keyword_evidence", observedAt: "" },
      })),
      competitiveContext: competitiveContext.map((item) => ({
        ...item,
        addedAt: "",
        relation: "direct",
        evidenceRef: `ev:${item.asin}`,
        provenance: { evidenceRef: `ev:${item.asin}`, sourceType: "competitor_evidence", observedAt: "" },
      })),
      sourcingContext: [],
      aiReferences: [],
      missingConflicts: [],
      counts: {
        confirmedFacts: 0,
        confirmableCandidates: 0,
        vocInsights: vocInsights.length,
        keywordCandidates: keywordCandidates.length,
        competitiveInsights: competitiveContext.length,
        sourcingEntries: 0,
        aiReferences: 0,
        missingConflicts: 0,
      },
    },
    confirmedFacts: input.facts ?? [{ factId: "fact-material", field: "material", label: "Material", value: "stainless steel" }],
  } as never);
}

function entriesOf(strategy: ReturnType<typeof buildListingV5Strategy>, field: ListingV5BenefitPriority["field"]) {
  return (strategy.benefitPriorityBasis?.entries ?? []).filter((entry) => entry.field === field);
}

beforeEach(() => {
  callAiJson.mockReset();
  callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
});

describe("Phase 1 — the benefit order is driven by evidence, not by rule order", () => {
  it("ranks a recurring need above an isolated one even when the rule table lists it last", () => {
    const value = context({
      voc: [
        // Matches rule 2 ("sipping") but carries almost no evidence.
        { insightId: "theme-sip", theme: "sipping", summary: "the straw is awkward", reviewCount: 1, strength: "isolated" },
        // Matches rule 4 ("leak") yet is the repeated, high-volume need.
        { insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 12, strength: "recurring" },
      ],
    });
    const strategy = buildListingV5Strategy(value);
    expect(strategy.painPoints).toEqual([
      "feel confident carrying the product",
      "make everyday sipping convenient",
    ]);
    const [first, second] = entriesOf(strategy, "painPoints");
    expect(first?.signal).toBe("recurring_need");
    expect(first?.strength).toBe("recurring");
    expect(first?.count).toBe(12);
    expect(second?.signal).toBe("weak_signal");
    expect(first!.score).toBeGreaterThan(second!.score);
  });

  it("reorders the same needs when only the evidence changes", () => {
    const isolatedLeak = context({
      voc: [
        { insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 1, strength: "isolated" },
        { insightId: "theme-sip", theme: "sipping", summary: "the straw is awkward", reviewCount: 9, strength: "recurring" },
      ],
    });
    // Same two needs, opposite evidence: the order must follow the evidence.
    expect(buildListingV5Strategy(isolatedLeak).painPoints[0]).toBe("make everyday sipping convenient");
  });

  it("keeps the previous rule order when no reference carries evidence", () => {
    const value = context({
      voc: [
        { insightId: "", theme: "organization", summary: "counters get messy", reviewCount: 0, strength: "unknown" },
        { insightId: "", theme: "sipping", summary: "the straw is awkward", reviewCount: 0, strength: "unknown" },
      ],
    });
    const strategy = buildListingV5Strategy(value);
    expect(strategy.painPoints).toEqual([
      "keep everyday spaces organized",
      "make everyday sipping convenient",
    ]);
    expect(entriesOf(strategy, "painPoints").every((entry) => entry.basis === "no_reference")).toBe(true);
    expect(entriesOf(strategy, "painPoints").every((entry) => entry.signal === "weak_signal")).toBe(true);
  });
});

describe("Phase 1 — the four signal classes", () => {
  it("calls it a strong purchase signal when repeated demand meets shopper search wording", () => {
    const value = context({
      voc: [{ insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 7, strength: "recurring" }],
      keywords: [{ keyword: "leaking lid for travel", reportType: "search", rowNumber: 1 }],
    });
    const strategy = buildListingV5Strategy(value);
    const [entry] = entriesOf(strategy, "painPoints");
    expect(entry?.signal).toBe("strong_purchase_signal");
    expect(entry?.basis).toBe("reference_backed");
    expect(entry?.evidenceIds).toEqual(["voc:theme:theme-leak", "kw:search:1"]);
    expect(entry?.rationale).toMatch(/corroborated by 1 keyword reference/i);
  });

  it("calls it a competitor gap when a competitor observation is answerable with our own fact", () => {
    const value = context({
      voc: [{ insightId: "theme-org", theme: "organization", summary: "counters get messy", reviewCount: 1, strength: "isolated" }],
      competitors: [{ asin: "B0RIVAL0001", note: "counter storage tray in stainless steel" }],
    });
    const strategy = buildListingV5Strategy(value);
    const [entry] = entriesOf(strategy, "painPoints");
    expect(entry?.signal).toBe("competitor_gap");
    expect(entry?.evidenceIds).toEqual(["voc:theme:theme-org", "competitor:B0RIVAL0001"]);
    expect(entry?.rationale).toContain("confirmed fact(s): fact-material");
    // The competitor text itself never enters the strategy.
    expect(JSON.stringify(strategy)).not.toContain("counter storage tray");
  });

  it("does not call a competitor a gap when it cannot be answered with a confirmed fact", () => {
    const value = context({
      voc: [{ insightId: "theme-org", theme: "organization", summary: "counters get messy", reviewCount: 1, strength: "isolated" }],
      competitors: [{ asin: "B0RIVAL0002", note: "counter storage tray in bamboo" }],
      facts: [{ factId: "fact-material", field: "material", label: "Material", value: "stainless steel" }],
    });
    const [entry] = entriesOf(buildListingV5Strategy(value), "painPoints");
    expect(entry?.signal).toBe("weak_signal");
    expect(entry?.evidenceIds).toEqual(["voc:theme:theme-org"]);
  });

  it("keeps an unbacked need as a no_reference weak signal", () => {
    // No upstream insightId: the reference cannot carry an identity, so nothing
    // may be cited for it — but its own grade is still used for the ordering.
    const value = context({ voc: [{ insightId: "", theme: "leaks", summary: "the lid leaks", reviewCount: 4, strength: "weak" }] });
    const [entry] = entriesOf(buildListingV5Strategy(value), "painPoints");
    expect(entry?.signal).toBe("weak_signal");
    expect(entry?.basis).toBe("no_reference");
    expect(entry?.evidenceIds).toEqual([]);
    expect(entry?.strength).toBe("weak");
    expect(entry?.count).toBe(4);
    expect(entry?.rationale).toMatch(/no citable evidence id/i);
  });
});

describe("Phase 1 — the audit trail", () => {
  it("explains every ordered list item, including the fixed framing constants", () => {
    const value = context({
      voc: [{ insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 4, strength: "recurring" }],
      keywords: [{ keyword: "leaking lid", reportType: "search", rowNumber: 1 }],
    });
    const strategy = buildListingV5Strategy(value);
    for (const [field, list] of [
      ["painPoints", strategy.painPoints],
      ["purchaseMotivations", strategy.purchaseMotivations],
      ["useCases", strategy.useCases],
    ] as const) {
      const entries = entriesOf(strategy, field);
      expect(entries.map((entry) => entry.index)).toEqual(list.map((_, index) => index));
      expect(entries.every((entry) => entry.rank === entry.index + 1)).toBe(true);
      expect(entries.every((entry) => entry.rationale.length > 0)).toBe(true);
    }
    // "clear everyday value" is a fixed template, so its position is explained as such.
    const seed = entriesOf(strategy, "purchaseMotivations")[0];
    expect(seed?.basis).toBe("no_reference");
    expect(seed?.rationale).toMatch(/fixed framing constant/i);
  });

  it("only ever names evidence ids that resolve against the frozen context", () => {
    const value = context({
      voc: [{ insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 6, strength: "recurring" }],
      keywords: [{ keyword: "leaking lid", reportType: "search", rowNumber: 1 }],
      competitors: [{ asin: "B0RIVAL0003", note: "leaking lid in stainless steel" }],
    });
    const known = new Set([
      ...value.references.voc,
      ...value.references.keywords,
      ...value.references.competitors,
    ].map((reference) => reference.evidenceId));
    const strategy = buildListingV5Strategy(value);
    for (const entry of strategy.benefitPriorityBasis?.entries ?? []) {
      for (const id of entry.evidenceIds) expect(known.has(id)).toBe(true);
      if (entry.basis === "no_reference") expect(entry.evidenceIds).toEqual([]);
    }
  });

  it("is deterministic and never mutates the frozen context", () => {
    const value = context({
      voc: [{ insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 6, strength: "recurring" }],
      keywords: [{ keyword: "leaking lid", reportType: "search", rowNumber: 1 }],
    });
    const before = JSON.stringify(value);
    expect(JSON.stringify(buildListingV5Strategy(value))).toBe(JSON.stringify(buildListingV5Strategy(value)));
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("Phase 1 — Evidence Binding and provider invariants are preserved", () => {
  it("keeps an evidence-ranked deterministic template an AI suggestion", () => {
    const value = context({
      voc: [{ insightId: "theme-leak", theme: "leaks", summary: "the lid leaks in the bag", reviewCount: 6, strength: "recurring" }],
      keywords: [{ keyword: "leaking lid", reportType: "search", rowNumber: 1 }],
    });
    const strategy = buildListingV5Strategy(value);
    // The ORDER knows the evidence...
    expect(entriesOf(strategy, "painPoints")[0]?.basis).toBe("reference_backed");
    // ...but the SENTENCE is still our template, so it is never promoted.
    expect(strategy.evidenceBindings?.source).toBe("deterministic");
    expect(strategy.evidenceBindings?.bound).toBe(0);
    expect(strategy.evidenceBindings?.conclusions.every((item) => item.status === "ai_suggestion")).toBe(true);
  });

  it("orders provider conclusions by the evidence they declare, without touching their ids", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        targetAudience: [{ text: "shoppers tidying counters", evidenceIds: [] }],
        purchaseMotivations: [
          { text: "feels tidy", evidenceIds: [] },
          { text: "counters stop getting messy", evidenceIds: ["voc:theme:theme-org"] },
        ],
        painPoints: [{ text: "counters get messy", evidenceIds: ["voc:theme:theme-org"] }],
        useCases: [],
        primaryAngle: { text: "Make the organizer easier to understand and use", evidenceIds: [] },
        secondaryAngles: [],
        tone: [],
        keywordIntent: { primary: ["kitchen organizer"], secondary: [] },
        bulletAngles: [
          { role: "core_outcome", shopperValue: "see the core benefit", evidenceIds: [] },
          { role: "pain_relief", shopperValue: "clear the clutter", evidenceIds: [] },
          { role: "use_scenario", shopperValue: "picture a tidy counter", evidenceIds: [] },
        ],
        avoidClaims: [],
      },
    });
    const value = context({
      voc: [{ insightId: "theme-org", theme: "organization", summary: "counters get messy", reviewCount: 6, strength: "recurring" }],
    });
    const result = await analyzeListingV5Strategy(value, { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    // The cited motivation moves ahead of the uncited one.
    expect(result.strategy.purchaseMotivations).toEqual(["counters stop getting messy", "feels tidy"]);
    expect(entriesOf(result.strategy, "purchaseMotivations")[0]?.signal).toBe("recurring_need");
    // Ranking must not strip the citation: Evidence Binding still binds it.
    const bound = result.strategy.evidenceBindings?.conclusions.find((item) => item.field === "painPoints");
    expect(bound?.status).toBe("evidence_bound");
    expect(bound?.evidenceIds).toEqual(["voc:theme:theme-org"]);
    // Ranking never adds a provider call.
    expect(callAiJson).toHaveBeenCalledTimes(1);
  });

  it("keeps a legacy provider response in the model's own order", async () => {
    callAiJson.mockResolvedValueOnce({
      ok: true,
      providerCallStarted: true,
      data: {
        targetAudience: ["commuters who sip on the go"],
        purchaseMotivations: [{ text: "first motivation" }, { text: "second motivation" }],
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
    const result = await analyzeListingV5Strategy(context(), { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    expect(result.strategy.purchaseMotivations).toEqual(["first motivation", "second motivation"]);
    expect(result.strategy.evidenceBindings?.bound).toBe(0);
    expect((result.strategy.benefitPriorityBasis?.entries ?? []).every((entry) => entry.basis === "no_reference")).toBe(true);
  });
});
