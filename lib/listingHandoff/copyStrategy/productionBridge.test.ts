import { describe, expect, it } from "vitest";
import { buildTaskLinkedAiPrompt } from "@/lib/server/taskLinkedAiListing";
import { generateTaskLinkedAiListing, setTaskLinkedAiListingClientForTests } from "@/lib/server/taskLinkedAiListing";
import { computeListingGenerationFingerprint, type ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { draftSafeSummary } from "@/lib/listingHandoff/listingGenerationService";
import { buildCopyStrategy } from "./analyzer";
import type { CopyStrategyV1 } from "./types";

const strategy: CopyStrategyV1 = buildCopyStrategy({
  confirmedFactSummary: { count: 3, labels: ["Brand", "Material", "Quantity"] },
  marketingInsight: {
    version: "marketing-insight.v1",
    referenceOnly: true,
    painPoints: [{ topic: "organization_need", summary: "Buyers mention clutter.", sourceType: "VOC", confidence: "high", referenceOnly: true }],
    customerNeeds: [{ topic: "organization_need", summary: "Keep everyday spaces organized.", sourceType: "VOC", confidence: "high", referenceOnly: true }],
    marketAngles: [{ topic: "organization", summary: "Organization", sourceType: "keyword", confidence: "medium", referenceOnly: true }],
    keywordThemes: [],
    competitorPatterns: [],
    recommendations: [],
  },
});

const plan = {
  schema: "listing-plan.v2" as const,
  status: "ready" as const,
  primaryKeyword: null,
  supportingKeywords: [],
  titlePlan: [],
  bulletPlans: [
    {
      role: "core_outcome" as const,
      shopperNeed: "Organization",
      shopperAngle: "Core outcome",
      featureFactIds: ["material"],
      evidenceRefs: [],
      keywordIds: [],
      claimMode: "verified" as const,
      cannotSay: [],
    },
    {
      role: "use_scenario" as const,
      shopperNeed: "Daily use",
      shopperAngle: "Use scenario",
      featureFactIds: ["quantity"],
      evidenceRefs: [],
      keywordIds: [],
      claimMode: "verified" as const,
      cannotSay: [],
    },
    {
      role: "proof_or_fit" as const,
      shopperNeed: "Fit",
      shopperAngle: "Fit",
      featureFactIds: ["brand"],
      evidenceRefs: [],
      keywordIds: [],
      claimMode: "verified" as const,
      cannotSay: [],
    },
  ],
  descriptionPlan: "Product and usage",
  backendSearchTerms: [],
  missingFacts: [],
  prohibitedClaims: [],
  planQuality: "optimized" as const,
};

function input(copyStrategy?: CopyStrategyV1): ListingGenerationInput {
  return {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: 1, researchRevision: 1 },
    productFacts: [
      { field: "brand", label: "Brand", value: "Acme" },
      { field: "material", label: "Material", value: "Steel" },
      { field: "quantity", label: "Quantity", value: "2 Count" },
    ],
    stableSourceFacts: [],
    creativeReferences: [],
    creativePreferences: {},
    prohibitedClaims: [],
    unknowns: [],
    humanReviewRequired: true,
    researchMode: "market_research_only",
    promotionEligible: false,
    ...(copyStrategy ? { copyStrategy } : {}),
  };
}

describe("Copy Strategy production bridge", () => {
  it("delivers the strategy to the active task-linked generator input", async () => {
    let received: CopyStrategyV1 | undefined;
    setTaskLinkedAiListingClientForTests(async (value) => {
      received = value.copyStrategy;
      return {
        title: "Acme Steel Hook",
        bullets: ["Steel construction supports an organized setup.", "Two hooks help keep items within reach.", "A simple hook format fits everyday spaces."],
        description: "This hook uses confirmed steel construction. Two hooks help keep everyday items within reach.",
        backendSearchTerms: [],
        usedFactIds: ["material", "quantity"],
        humanReviewRequired: true,
      };
    });
    try {
      const result = await generateTaskLinkedAiListing({
        facts: input().productFacts.map((fact) => ({ factId: fact.field, ...fact })),
        plan,
        keywordBrief: null,
        listingBrief: null,
        prohibitedClaims: [],
        copyStrategy: strategy,
      });
      expect(result.ok).toBe(true);
      expect(received?.mainAngle).toBe(strategy.mainAngle);
      expect(received?.referenceOnly).toBe(true);
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  });

  it("passes bounded strategy framing to the active task-linked prompt without facts", () => {
    const prompt = buildTaskLinkedAiPrompt({
      facts: input().productFacts.map((fact) => ({ factId: fact.field, ...fact })),
      plan,
      keywordBrief: null,
      listingBrief: null,
      prohibitedClaims: [],
      copyStrategy: strategy,
    });

    expect(prompt).toContain("COPY_STRATEGY_START");
    expect(prompt).toContain("targetBuyer");
    expect(prompt).toContain("Feature → Benefit → Scenario");
    expect(prompt).toContain("never a product fact, claim or evidence source");
    expect(prompt).toContain('"field":"material"');
    expect(prompt).toContain('"value":"Steel"');
  });

  it("changes the idempotency fingerprint when the consumed strategy changes", () => {
    const plain = input();
    const withStrategy = input(strategy);
    expect(computeListingGenerationFingerprint(plain)).not.toBe(computeListingGenerationFingerprint(withStrategy));
  });

  it("keeps strategy out of the confirmed fact collection", () => {
    const withStrategy = input(strategy);
    expect(withStrategy.productFacts).toEqual(input().productFacts);
    expect(JSON.stringify(withStrategy.productFacts)).not.toContain("organization_need");
  });

  it("whitelists strategy fields at the active prompt boundary", () => {
    const polluted = {
      ...strategy,
      factId: "material",
      claim: "Waterproof",
      confirmedFacts: [{ field: "material", value: "Steel" }],
    } as CopyStrategyV1 & { claim: string; confirmedFacts: unknown[]; factId: string };
    const prompt = buildTaskLinkedAiPrompt({
      facts: input().productFacts.map((fact) => ({ factId: fact.field, ...fact })),
      plan,
      keywordBrief: null,
      listingBrief: null,
      prohibitedClaims: [],
      copyStrategy: polluted,
    });

    expect(prompt).toContain("COPY_STRATEGY_START");
    const strategySection = prompt.split("COPY_STRATEGY_START\\n")[1]?.split("\\nCOPY_STRATEGY_END")[0] ?? "";
    expect(strategySection).not.toContain('"factId"');
    expect(strategySection).not.toContain('"claim"');
    expect(strategySection).not.toContain("Waterproof");
    expect(strategySection).not.toContain("confirmedFacts");
  });

  it("keeps historical draft reads compatible while stripping non-contract strategy fields", () => {
    const summary = draftSafeSummary({
      source: "real_ai_draft",
      humanReviewRequired: true,
      generatedAt: "2026-09-09T00:00:00.000Z",
      titles: ["Acme Steel Organizer"],
      bullets: [
        "Steel construction helps keep everyday items grouped in a drawer.",
        "The 2 Count set gives you two organizers for separating frequently used items.",
        "Use the organizers in a drawer when you want a clearer place for small tools.",
      ],
      description: "Acme Steel Organizer is a 2 Count set. Use it to group everyday items in a drawer.",
      factSafe: true,
      copyQuality: true,
      listingUnqualified: false,
      copyStrategy: {
        copyTone: "clear",
        targetBuyer: "Everyday organizers",
        claim: "Waterproof",
        factId: "material",
        bulletStrategies: [{ order: 1, structure: "feature_benefit_scenario", purpose: "Use supported facts." }],
      },
    });

    expect(summary).not.toBeNull();
    expect(summary?.copyStrategy).toMatchObject({
      copyTone: "clear",
      targetBuyer: "Everyday organizers",
    });
    expect(summary?.copyStrategy && "factId" in summary.copyStrategy).toBe(false);
    expect(summary?.copyStrategy && "claim" in summary.copyStrategy).toBe(false);
  });
});
