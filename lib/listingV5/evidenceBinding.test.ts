import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Evidence Binding contract.
 *
 * These tests lock the two things the upgrade exists for:
 *   1. evidence identity survives the context projection, and
 *   2. a strategy conclusion is only called `evidence_bound` when it cites an id
 *      that resolves to a reference actually present in the frozen context.
 *
 * They also lock the negative guarantees: no constant/fake id, no silently
 * promoted claim, and no behaviour change for provider responses that predate
 * the evidence contract.
 */

const { callAiJson } = vi.hoisted(() => ({ callAiJson: vi.fn() }));
vi.mock("@/lib/server/aiClient", () => ({ callAiJson }));

import { buildListingV5Context } from "./context";
import { analyzeListingV5Strategy, buildListingV5Strategy } from "./strategy";
import { bindStrategyConclusions, buildEvidenceIndex } from "./evidenceBinding";
import type { ListingV5Context } from "./types";

const GENERATION_INPUT = {
  schema: "listing-generation-input.v1" as const,
  source: { handoffRevision: 1, researchRevision: 2 },
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

function buildContext(overrides: {
  vocInsights?: unknown[];
  keywordCandidates?: unknown[];
  competitiveContext?: unknown[];
} = {}) {
  const vocInsights = overrides.vocInsights ?? [
    { insightId: "theme-aaa", theme: "organization", summary: "counters get messy", evidenceRefs: ["r1"], reviewCount: 6, coverage: 0.4, strength: "recurring", sourceType: "voc_theme", provenance: { evidenceRef: "ev:voc:r1", sourceType: "voc_theme", observedAt: "" } },
    { insightId: "theme-bbb", theme: "setup", summary: "hard to mount", evidenceRefs: ["r2"], reviewCount: 1, coverage: 0.1, strength: "isolated", sourceType: "voc_theme", provenance: { evidenceRef: "ev:voc:r2", sourceType: "voc_theme", observedAt: "" } },
  ];
  const keywordCandidates = overrides.keywordCandidates ?? [
    { keyword: "kitchen organizer", reportType: "search", rowNumber: 1, evidenceRef: "ev:keyword:search:kitchen organizer", observedAt: "", provenance: { evidenceRef: "ev:keyword:search:kitchen organizer", sourceType: "keyword_evidence", observedAt: "" } },
    { keyword: "countertop storage", reportType: "search", rowNumber: 2, evidenceRef: "ev:keyword:search:countertop storage", observedAt: "", provenance: { evidenceRef: "ev:keyword:search:countertop storage", sourceType: "keyword_evidence", observedAt: "" } },
  ];
  const competitiveContext = overrides.competitiveContext ?? [
    { asin: "B0TEST00001", note: "rival tray", addedAt: "", evidenceRef: "ev:competitor:B0TEST00001", relation: "direct", provenance: { evidenceRef: "ev:competitor:B0TEST00001", sourceType: "competitor_evidence", observedAt: "" } },
  ];
  return buildListingV5Context({
    taskId: "task-binding", researchRevision: 2, handoffRevision: 1, productIdentity: "Organizer",
    generationInput: GENERATION_INPUT,
    creativeContext: {
      schema: "creative-context.v1", version: 1, generatedAt: "", source: { researchRevision: 2, candidateId: "candidate" },
      confirmedFacts: [], confirmableFactCandidates: [],
      vocInsights, keywordCandidates, competitiveContext,
      sourcingContext: [], aiReferences: [], missingConflicts: [],
      counts: { confirmedFacts: 0, confirmableCandidates: 0, vocInsights: vocInsights.length, keywordCandidates: keywordCandidates.length, competitiveInsights: competitiveContext.length, sourcingEntries: 0, aiReferences: 0, missingConflicts: 0 },
    },
    confirmedFacts: [{ factId: "material-1", field: "material", label: "Material", value: "Steel" }],
  } as never);
}

function providerStrategy(overrides: Record<string, unknown>) {
  return {
    ok: true,
    providerCallStarted: true,
    data: {
      targetAudience: [{ text: "shoppers tidying counters", evidenceIds: ["voc:theme:theme-aaa"] }],
      purchaseMotivations: [],
      painPoints: [{ text: "counters get messy", evidenceIds: ["voc:theme:theme-aaa"] }],
      useCases: [],
      primaryAngle: { text: "Make the organizer easier to understand and use", evidenceIds: ["voc:theme:theme-aaa"] },
      secondaryAngles: [],
      tone: [],
      keywordIntent: { primary: ["kitchen organizer"], secondary: [] },
      bulletAngles: [
        { role: "core_outcome", shopperValue: "see the core benefit", evidenceIds: ["voc:theme:theme-aaa"] },
        { role: "pain_relief", shopperValue: "clear the clutter", evidenceIds: ["voc:theme:theme-bbb"] },
        { role: "use_scenario", shopperValue: "picture a tidy counter", evidenceIds: [] },
      ],
      avoidClaims: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  callAiJson.mockReset();
  callAiJson.mockResolvedValue({ ok: false, providerCallStarted: true, error: { code: "provider_error", message: "stub" } });
});

describe("Evidence Binding — identity survives the context projection", () => {
  it("carries the upstream evidence id, strength and count onto each reference", () => {
    const context = buildContext();
    const [first, second] = context.references.voc;
    expect(first?.evidenceId).toBe("voc:theme:theme-aaa");
    expect(first?.strength).toBe("recurring");
    expect(first?.count).toBe(6);
    expect(first?.evidenceRef).toBe("ev:voc:r1");
    expect(second?.evidenceId).toBe("voc:theme:theme-bbb");
    expect(second?.strength).toBe("isolated");
    expect(second?.count).toBe(1);
    // The legacy fields every existing consumer reads are untouched.
    expect(first?.marker).toBe("UNTRUSTED_REFERENCE_DATA");
    expect(first?.notProductFact).toBe(true);
    expect(first?.sourceType).toBe("VOC");
  });

  it("derives keyword and competitor ids from the report row and the ASIN", () => {
    const context = buildContext();
    expect(context.references.keywords.map((item) => item.evidenceId)).toEqual(["kw:search:1", "kw:search:2"]);
    expect(context.references.competitors[0]?.evidenceId).toBe("competitor:B0TEST00001");
    expect(context.references.competitors[0]?.evidenceRef).toBe("ev:competitor:B0TEST00001");
  });

  it("never mints a shared or constant evidence id", () => {
    const context = buildContext();
    const ids = [...context.references.voc, ...context.references.keywords, ...context.references.competitors]
      .map((item) => item.evidenceId)
      .filter((id): id is string => typeof id === "string");
    // One id per reference, all distinct: a constant could not satisfy this.
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    // The historical fake-evidence constant this upgrade exists to prevent.
    expect(ids).not.toContain("ev:voc");
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
  });

  it("changes the ids when the upstream evidence changes", () => {
    const before = buildContext();
    const after = buildContext({
      vocInsights: [{ insightId: "theme-ccc", theme: "durability", summary: "lid cracked", evidenceRefs: [], reviewCount: 3, coverage: 0.2, strength: "weak", sourceType: "voc_theme", provenance: { evidenceRef: "ev:voc:r9", sourceType: "voc_theme", observedAt: "" } }],
    });
    expect(before.references.voc[0]?.evidenceId).not.toBe(after.references.voc[0]?.evidenceId);
    expect(after.references.voc[0]?.evidenceId).toBe("voc:theme:theme-ccc");
  });

  it("leaves the id absent when the upstream identity is missing", () => {
    const context = buildContext({
      vocInsights: [{ insightId: "", theme: "organization", summary: "counters get messy", evidenceRefs: [], reviewCount: 2, coverage: 0.1, strength: "weak", sourceType: "voc_theme", provenance: { evidenceRef: "ev:voc:x", sourceType: "voc_theme", observedAt: "" } }],
    });
    const reference = context.references.voc[0];
    expect(reference?.text).toContain("counters get messy");
    // No identity upstream means no id — nothing invents one.
    expect(reference?.evidenceId).toBeUndefined();
    const index = buildEvidenceIndex(context);
    // The identity-less VOC reference is simply not citable; the keyword and
    // competitor references in this context are unaffected.
    expect([...index.keys()].some((id) => id.startsWith("voc:"))).toBe(false);
    expect(index.size).toBe(3);
  });

  it("keeps sourcing out of the strategy evidence index", () => {
    const context = buildContext();
    expect(context.references.sourcing).toEqual([]);
    expect([...buildEvidenceIndex(context).values()].some((entry) => entry.sourceType === "sourcing")).toBe(false);
  });
});

describe("Evidence Binding — admission rules", () => {
  it("binds a conclusion only when a declared id resolves", () => {
    const index = buildEvidenceIndex(buildContext());
    const binding = bindStrategyConclusions(
      [{ field: "painPoints", text: "counters get messy", evidenceIds: ["voc:theme:theme-aaa"] }],
      index,
      "provider",
    );
    expect(binding.bound).toBe(1);
    expect(binding.suggestions).toBe(0);
    expect(binding.conclusions[0]?.status).toBe("evidence_bound");
    expect(binding.conclusions[0]?.evidenceIds).toEqual(["voc:theme:theme-aaa"]);
  });

  it("records an invented id without ever binding it", () => {
    const index = buildEvidenceIndex(buildContext());
    const binding = bindStrategyConclusions(
      [{ field: "painPoints", text: "counters get messy", evidenceIds: ["voc:theme:does-not-exist", "ev:voc"] }],
      index,
      "provider",
    );
    expect(binding.bound).toBe(0);
    expect(binding.suggestions).toBe(1);
    expect(binding.conclusions[0]?.status).toBe("ai_suggestion");
    // A fake id is reported as unresolved, never as a citation.
    expect(binding.conclusions[0]?.evidenceIds).toEqual([]);
    expect(binding.conclusions[0]?.unresolvedEvidenceIds).toEqual(["voc:theme:does-not-exist", "ev:voc"]);
  });

  it("treats a conclusion with no ids as an AI suggestion", () => {
    const index = buildEvidenceIndex(buildContext());
    const binding = bindStrategyConclusions([{ field: "tone", text: "clear", evidenceIds: [] }], index, "provider");
    expect(binding.conclusions[0]?.status).toBe("ai_suggestion");
    expect(binding.suggestions).toBe(1);
  });

  it("binds when at least one of several declared ids resolves", () => {
    const index = buildEvidenceIndex(buildContext());
    const binding = bindStrategyConclusions(
      [{ field: "painPoints", text: "counters get messy", evidenceIds: ["nope", "voc:theme:theme-aaa"] }],
      index,
      "provider",
    );
    expect(binding.conclusions[0]?.status).toBe("evidence_bound");
    expect(binding.conclusions[0]?.evidenceIds).toEqual(["voc:theme:theme-aaa"]);
    expect(binding.conclusions[0]?.unresolvedEvidenceIds).toEqual(["nope"]);
  });

  it("deduplicates repeated ids and never rewrites the conclusion text", () => {
    const index = buildEvidenceIndex(buildContext());
    const text = "counters get messy and stay messy";
    const binding = bindStrategyConclusions(
      [{ field: "painPoints", text, evidenceIds: ["voc:theme:theme-aaa", "voc:theme:theme-aaa"] }],
      index,
      "provider",
    );
    expect(binding.conclusions[0]?.evidenceIds).toEqual(["voc:theme:theme-aaa"]);
    expect(binding.conclusions[0]?.text).toBe(text);
  });
});

describe("Evidence Binding — strategy integration", () => {
  it("binds provider conclusions that cite supplied ids", async () => {
    callAiJson.mockResolvedValueOnce(providerStrategy({}));
    const result = await analyzeListingV5Strategy(buildContext(), { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    const bindings = result.strategy.evidenceBindings;
    expect(bindings?.source).toBe("provider");
    expect(bindings?.bound).toBeGreaterThan(0);
    expect(bindings?.conclusions.find((item) => item.field === "painPoints")?.status).toBe("evidence_bound");
    expect(bindings?.conclusions.find((item) => item.field === "painPoints")?.evidenceIds).toEqual(["voc:theme:theme-aaa"]);
    // A bullet with no declared evidence stays a suggestion.
    expect(bindings?.conclusions.find((item) => item.field === "bulletAngles.use_scenario")?.status).toBe("ai_suggestion");
  });

  it("downgrades an invented id to an AI suggestion instead of failing the stage", async () => {
    callAiJson.mockResolvedValueOnce(providerStrategy({
      painPoints: [{ text: "fabricated pain", evidenceIds: ["voc:theme:invented"] }],
      bulletAngles: [
        { role: "core_outcome", shopperValue: "a", evidenceIds: ["voc:theme:theme-aaa"] },
        { role: "pain_relief", shopperValue: "b", evidenceIds: ["voc:theme:theme-aaa"] },
        { role: "use_scenario", shopperValue: "c", evidenceIds: ["voc:theme:theme-aaa"] },
      ],
    }));
    const result = await analyzeListingV5Strategy(buildContext(), { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    const conclusion = result.strategy.evidenceBindings?.conclusions.find((item) => item.field === "painPoints");
    expect(conclusion?.status).toBe("ai_suggestion");
    expect(conclusion?.unresolvedEvidenceIds).toEqual(["voc:theme:invented"]);
    // The conclusion is labelled, not deleted: generation is unaffected.
    expect(result.strategy.painPoints).toContain("fabricated pain");
  });

  it("keeps a legacy provider response without evidence ids working unchanged", async () => {
    // The pre-upgrade output shape must still be accepted, otherwise the change
    // would turn previously valid generations into failures.
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
    const result = await analyzeListingV5Strategy(buildContext(), { useProvider: true });
    expect(result.providerSucceeded).toBe(true);
    expect(result.strategy.targetAudience).toEqual(["commuters who sip on the go"]);
    expect(result.strategy.primaryAngle).toBe("Make one-handed sipping simple during a commute");
    // Nothing is claimed as bound when the model declared nothing.
    expect(result.strategy.evidenceBindings?.bound).toBe(0);
    expect(result.strategy.evidenceBindings?.suggestions).toBeGreaterThan(0);
  });

  it("labels every deterministic template conclusion as an AI suggestion", () => {
    const result = buildListingV5Strategy(buildContext());
    const bindings = result.evidenceBindings;
    expect(bindings?.source).toBe("deterministic");
    expect(bindings?.bound).toBe(0);
    expect(bindings?.total).toBe(bindings?.suggestions);
    expect(bindings?.conclusions.every((item) => item.status === "ai_suggestion")).toBe(true);
    // The template still produces the same copy it always did.
    expect(result.primaryAngle).toContain("easier to understand and use");
  });

  it("issues no provider call for the binding layer", async () => {
    callAiJson.mockResolvedValueOnce(providerStrategy({}));
    await analyzeListingV5Strategy(buildContext(), { useProvider: true });
    expect(callAiJson).toHaveBeenCalledTimes(1);
  });
});
