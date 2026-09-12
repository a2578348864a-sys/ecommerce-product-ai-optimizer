import { describe, expect, it } from "vitest";
import { buildListingDecisionEngine, LISTING_V5_DECISION_ENGINE_VERSION } from "./decisionEngine";
import { validateListingV5Draft } from "./validation";
import type { ListingV5Context, ListingV5Fact, ListingV5Strategy, ListingV5WriterDraft } from "./types";

const THERMOS_FACTS: ListingV5Fact[] = [
  { id: "f-brand", canonicalField: "brand", label: "Brand", value: "THERMOS", sourceRefs: [] },
  { id: "f-mat", canonicalField: "material", label: "Material", value: "Stainless Steel", sourceRefs: [] },
  { id: "f-cap", canonicalField: "capacity", label: "Capacity", value: "10 oz", sourceRefs: [] },
  { id: "f-care", canonicalField: "care", label: "Care", value: "Dishwasher Safe", sourceRefs: [] },
  { id: "f-feat", canonicalField: "functional_feature", label: "Feature", value: "Vacuum Insulated", sourceRefs: [] },
  { id: "f-comp", canonicalField: "included_components", label: "Components", value: "Food Jar with Unfolding Spoon", sourceRefs: [] },
  { id: "f-dims", canonicalField: "dimensions", label: "Dimensions", value: '3.5"L x 3.5"W x 5.3"H', sourceRefs: [] },
  { id: "f-weight", canonicalField: "weight", label: "Weight", value: "4 ounces", sourceRefs: [] },
  { id: "f-op", canonicalField: "operation", label: "Operation", value: "Push-button latch lid", sourceRefs: [] },
];

const mockContext: ListingV5Context = {
  version: "listing-v5.context.v1",
  taskId: "task-thermos",
  researchRevision: 1,
  handoffRevision: 1,
  contextFingerprint: "fp-thermos",
  marketplace: "Amazon US",
  productIdentity: "THERMOS FUNTAINER Kids Food Jar 10 oz Pink",
  confirmedFacts: THERMOS_FACTS,
  prohibitedClaims: [],
  unknowns: [],
  references: {
    voc: [
      { text: "Hard to clean narrow bottles", sourceType: "VOC", marker: "UNTRUSTED_REFERENCE_DATA", notProductFact: true },
      { text: "Spills in backpack if latch is loose", sourceType: "VOC", marker: "UNTRUSTED_REFERENCE_DATA", notProductFact: true },
    ],
    keywords: [],
    competitors: [],
    sourcing: [],
  },
  manualDirection: null,
};

const mockStrategy: ListingV5Strategy = {
  version: "listing-v5.strategy.v1",
  referenceOnly: true,
  researchRevision: 1,
  targetAudience: ["Parents packing school lunch for kids", "Busy working professionals"],
  purchaseMotivations: ["Keep food warm until school lunch", "Easy dishwasher cleanup at night"],
  painPoints: ["Tired of hand washing every evening", "Kids losing loose plastic spoons"],
  useCases: ["School cafeteria", "Morning prep rush", "Backpack transport"],
  primaryAngle: "Effortless warm school lunch with all-in-one folding spoon",
  secondaryAngles: ["Top-rack dishwasher safe cleanup"],
  tone: ["practical", "warm", "reassuring"],
  keywordIntent: {
    primary: ["kids insulated food jar"],
    secondary: ["thermos lunch box for kids", "toddler soup thermos", "small food thermos"],
    backendOnly: ["stainless steel soup container"],
  },
  bulletAngles: [
    { role: "core_outcome", shopperValue: "keep meals warm for school lunch" },
    { role: "pain_relief", shopperValue: "dishwasher safe cleanup" },
    { role: "use_scenario", shopperValue: "compact fit in lunch bag" },
    { role: "ease_of_use", shopperValue: "spoon unfolds from lid" },
    { role: "proof_or_fit", shopperValue: "sturdy stainless steel build" },
  ],
  avoidClaims: ["unverified hourly heat claims"],
};

describe("Listing Decision Engine", () => {
  it("generates a valid, deterministic Marketing Brief", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);

    expect(brief.version).toBe(LISTING_V5_DECISION_ENGINE_VERSION);
    expect(brief.referenceOnly).toBe(true);
    expect(brief.personaProfile.primaryPersona.roleName).toContain("Parents packing school lunch");
    expect(brief.personaProfile.primaryPersona.decisionDrivers.length).toBeGreaterThan(0);
  });

  it("builds lifestyle scenarios anchored to confirmed facts", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);

    expect(brief.scenarioMatrix.length).toBeGreaterThanOrEqual(3);
    for (const sc of brief.scenarioMatrix) {
      expect(sc.scenarioId).toBeTruthy();
      expect(sc.name).toBeTruthy();
      expect(sc.vividMoment).toBeTruthy();
      expect(sc.relevantFactIds.length).toBeGreaterThan(0);
      for (const factId of sc.relevantFactIds) {
        expect(THERMOS_FACTS.some((f) => f.id === factId)).toBe(true);
      }
    }
  });

  it("builds a pain point battleboard mapping pains to verified facts", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);

    expect(brief.painPointBattleboard.length).toBeGreaterThan(0);
    const carePain = brief.painPointBattleboard.find((p) => /clean|wash/i.test(p.vocTheme));
    expect(carePain).toBeDefined();
    expect(carePain?.factBacked).toBe(true);
    expect(carePain?.proofFactIds).toContain("f-care");
    expect(carePain?.marketingGuidance.action).toBe("preemptive_strike");
  });

  it("produces 5 structured bullet blueprints with compliant [HOOK]: directives", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);

    expect(brief.bulletBlueprints.length).toBe(5);
    const roles = brief.bulletBlueprints.map((b) => b.strategicMission);
    expect(roles).toEqual(["core_outcome", "pain_relief", "use_scenario", "ease_of_use", "proof_or_fit"]);

    for (const bullet of brief.bulletBlueprints) {
      expect(bullet.bracketHookDirective).toMatch(/^\[.+\]:$/);
      expect(bullet.anchoredFactIds.length).toBeGreaterThan(0);
      for (const factId of bullet.anchoredFactIds) {
        expect(THERMOS_FACTS.some((f) => f.id === factId)).toBe(true);
      }
      expect(bullet.persuasionBlueprint.shopperBenefitClause).toBeTruthy();
      expect(bullet.persuasionBlueprint.reasonToBelieve).toBeTruthy();
      expect(bullet.keywordDirective.targetKeyword).toBeTruthy();
    }
  });

  it("sanitizes hooks so unconfirmed hard tokens are stripped", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);
    const allHooks = brief.bulletBlueprints.map((b) => b.bracketHookDirective).join(" ");
    // Leakproof and durable are not in THERMOS_FACTS, so they must not be in the hooks
    expect(allHooks.toLowerCase()).not.toContain("leakproof");
    expect(allHooks.toLowerCase()).not.toContain("durable");
    // But Vacuum Insulated and Dishwasher are confirmed, so they are allowed
    expect(allHooks).toContain("VACUUM INSULATED");
  });

  it("generates brand and formula guided title blueprint", () => {
    const brief = buildListingDecisionEngine(mockContext, mockStrategy);

    expect(brief.titleBlueprint.brand).toBe("THERMOS");
    expect(brief.titleBlueprint.primaryKeyword).toBe("kids insulated food jar");
    expect(brief.titleBlueprint.coreSpecFactIds.length).toBeGreaterThan(0);
    expect(brief.titleBlueprint.recommendedTitle).toContain("THERMOS");
  });

  it("passes validateListingV5Draft when validating an Amazon top-seller draft with [HOOK]: bullets", () => {
    const draft: ListingV5WriterDraft = {
      version: "listing-v5.writer-draft.v1",
      title: {
        text: "THERMOS FUNTAINER Kids Insulated Food Jar 10 oz Stainless Steel with Unfolding Spoon",
        factIds: ["f-brand", "f-mat", "f-cap"],
      },
      bullets: [
        {
          text: "[VACUUM INSULATED]: Vacuum Insulated construction helps support daily meals, keeping lunchbox prep straightforward.",
          factIds: ["f-feat"],
          strategyRole: "core_outcome",
        },
        {
          text: "[DISHWASHER SAFE CARE]: Dishwasher Safe care simplifies daily cleaning routines after school, saving a step on busy weeknights.",
          factIds: ["f-care"],
          strategyRole: "pain_relief",
        },
        {
          text: '[MEASURED DIMENSIONS]: At 3.5"L x 3.5"W x 5.3"H, it provides verified dimensions for everyday lunch bags and packs.',
          factIds: ["f-dims"],
          strategyRole: "use_scenario",
        },
        {
          text: "[INCLUDED FOLDING SPOON]: The set includes a Food Jar with Unfolding Spoon, so you pack one less loose item in the morning.",
          factIds: ["f-comp"],
          strategyRole: "ease_of_use",
        },
        {
          text: "[VERIFIED WEIGHT]: Stainless Steel construction and a 4 ounces weight offer clear physical specifications for everyday backpack carry.",
          factIds: ["f-mat", "f-weight"],
          strategyRole: "proof_or_fit",
        },
      ],
      description: {
        text: "The THERMOS FUNTAINER 10 oz food jar brings together stainless steel construction and vacuum insulated technology for dependable everyday school lunch packing. Dishwasher Safe care simplifies cleanup after daily routines, while the compact 3.5\"L x 3.5\"W x 5.3\"H size and included unfolding spoon fit easily into lunch bags.",
        factIds: ["f-brand", "f-mat", "f-cap"],
      },
      backendSearchTerms: ["soup thermos", "toddler lunch container"],
      humanReviewRequired: true,
    };

    const report = validateListingV5Draft(mockContext, mockStrategy, draft);
    expect(report.status).toBe("PASS");
    expect(report.title.valid).toBe(true);
    expect(report.bullets.every((b) => b.valid)).toBe(true);
    expect(report.description.valid).toBe(true);
    expect(report.claims.allHaveEvidence).toBe(true);
  });

  it("rejects unsupported semantic extensions such as unconfirmed component expansion, spatial crowding claims, and circular closure guarantees", () => {
    const draftWithViolations: ListingV5WriterDraft = {
      version: "listing-v5.writer-draft.v1",
      title: {
        text: "THERMOS FUNTAINER Kids Insulated Food Jar 10 oz Stainless Steel with Unfolding Spoon",
        factIds: ["f-brand", "f-mat", "f-cap"],
      },
      bullets: [
        {
          text: "[VACUUM INSULATION]: Vacuum Insulated construction supports temperature retention for daily meals.",
          factIds: ["f-feat"],
          strategyRole: "core_outcome",
        },
        {
          // "bottle and lid" is unconfirmed for a food jar that does not have "bottle" confirmed
          text: "[CARE]: Dishwasher Safe care means you can load the bottle and lid after school.",
          factIds: ["f-care"],
          strategyRole: "pain_relief",
        },
        {
          // "without crowding" is an unbacked spatial assertion
          text: '[DIMENSIONS]: At 3.5"L x 3.5"W x 5.3"H, it fits into a lunch bag without crowding the space.',
          factIds: ["f-dims"],
          strategyRole: "use_scenario",
        },
        {
          text: "[SPOON]: The set includes a Food Jar with Unfolding Spoon.",
          factIds: ["f-comp"],
          strategyRole: "ease_of_use",
        },
        {
          // "keeps the lid closed until you open it" is tautological closure guarantee
          text: "[LATCH]: Push-button latch lid keeps the lid closed until you open it.",
          factIds: ["f-op"],
          strategyRole: "proof_or_fit",
        },
      ],
      description: {
        text: "The THERMOS FUNTAINER 10 oz food jar brings together stainless steel construction and vacuum insulated technology for everyday lunch packing.",
        factIds: ["f-brand", "f-mat", "f-cap"],
      },
      backendSearchTerms: ["soup thermos"],
      humanReviewRequired: true,
    };

    const report = validateListingV5Draft(mockContext, mockStrategy, draftWithViolations);
    expect(report.status).not.toBe("PASS");
    expect(report.claims.allHaveEvidence).toBe(false);
    expect(report.claims.unsupportedClaims.length).toBeGreaterThanOrEqual(3);
  });

  it("strictly rejects each of the 8 canonical unbacked semantic extension sentences", () => {
    const eightTargetSentences = [
      'At 3.5"L x 3.5"W x 5.3"H, it fits into a lunch box kids carry to school.',
      'Designed for a lunch box for girls.',
      'Latch operation keeps the lid secure.',
      'Solid construction supports daily use.',
      'Practical size fits into a lunch bag.',
      'Stainless steel material makes it durable.',
      'A 4 ounce weight makes it easier to carry.',
      'Vacuum insulated construction supports temperature retention.',
    ];

    for (const sentence of eightTargetSentences) {
      const draft: ListingV5WriterDraft = {
        version: "listing-v5.writer-draft.v1",
        title: {
          text: "THERMOS FUNTAINER Kids Food Jar 10 oz",
          factIds: ["f-brand", "f-cap"],
        },
        bullets: [
          { text: sentence, factIds: ["f-mat"], strategyRole: "core_outcome" },
          { text: "Dishwasher Safe care simplifies daily cleaning.", factIds: ["f-care"], strategyRole: "pain_relief" },
          { text: 'Measuring 3.5"L x 3.5"W x 5.3"H provides clear dimensions.', factIds: ["f-dims"], strategyRole: "use_scenario" },
        ],
        description: {
          text: "The THERMOS FUNTAINER is a 10 oz food jar for school days. Dishwasher Safe care simplifies cleanup.",
          factIds: ["f-brand", "f-cap"],
        },
        backendSearchTerms: [],
        humanReviewRequired: true,
      };

      const result = validateListingV5Draft(mockContext, mockStrategy, draft);
      expect(result.status).not.toBe("PASS");
      expect(result.claims.allHaveEvidence).toBe(false);
      expect(result.claims.unsupportedClaims.length).toBeGreaterThan(0);
      expect(result.claims.unsupportedClaims.some((c) => c.includes(sentence) || sentence.includes(c))).toBe(true);
    }
  });

  it("enforces Copy Quality Contract by rejecting meta-shopping language in copy", () => {
    const metaShoppingPhrases = [
      "gives you clear details to confidently compare before you buy",
      "helps shoppers understand the product at a glance",
      "gives shoppers a clear detail to compare",
      "brings specifications into a simple product choice",
      "for shoppers comparing practical options",
      "helps guide a purchase decision",
    ];

    for (const metaText of metaShoppingPhrases) {
      const draftWithMeta: ListingV5WriterDraft = {
        version: "listing-v5.writer-draft.v1",
        title: {
          text: "THERMOS FUNTAINER Kids Food Jar 10 oz",
          factIds: ["f-brand", "f-cap"],
        },
        bullets: [
          { text: `[SPECIFICATION]: Stainless Steel material ${metaText}.`, factIds: ["f-mat"], strategyRole: "proof_or_fit" },
          { text: "[DISHWASHER SAFE]: Dishwasher Safe care simplifies daily cleaning.", factIds: ["f-care"], strategyRole: "pain_relief" },
          { text: '[DIMENSIONS]: Measuring 3.5"L x 3.5"W x 5.3"H provides clear dimensions.', factIds: ["f-dims"], strategyRole: "use_scenario" },
        ],
        description: {
          text: "The THERMOS FUNTAINER is a 10 oz food jar for school days.",
          factIds: ["f-brand", "f-cap"],
        },
        backendSearchTerms: [],
        humanReviewRequired: true,
      };

      const result = validateListingV5Draft(mockContext, mockStrategy, draftWithMeta);
      // Meta shopping language either fails unsupported claim or is rejected by copy quality rules
      expect(result.status !== "PASS" || result.quality.mechanicalTemplate === true || result.claims.unsupportedClaims.length > 0).toBe(true);
    }
  });
});
