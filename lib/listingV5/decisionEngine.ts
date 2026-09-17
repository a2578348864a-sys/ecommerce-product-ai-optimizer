/**
 * Listing Decision Engine (营销决策引擎) — Pure Deterministic Conversion Layer.
 *
 * Sits between Upstream Evidence/Context and the Listing Writer.
 * Translates Confirmed Facts, Strategy framing, and reference VOC/competitor observations
 * into an actionable, structured Marketing Brief for the LLM Writer:
 *   1. Persona Profile (买家立体画像)
 *   2. Scenario Matrix (生活微场景切片)
 *   3. Pain Point Battleboard (痛点反击看板与事实归因)
 *   4. CVP Architecture (核心价值主张与差异化护城河)
 *   5. Bullet Blueprints (5条五点【HOOK】战术蓝图与事实归因)
 *   6. Title & Search Term Blueprints
 *
 * Hard invariants:
 * - Confirmed Facts remain the only factual authority.
 * - Every blueprint element anchors directly to existing Confirmed Fact IDs.
 * - Zero provider calls, zero state, 100% deterministic pure function.
 * - Reference VOC and Competitor data remain UNTRUSTED_REFERENCE_DATA for framing only.
 */

import type { ListingV5BulletRole, ListingV5Context, ListingV5Fact, ListingV5Strategy } from "./types";
import { HARD_OR_ESCALATION_TOKENS } from "./claimVocabulary";
import { approvedFactBenefitId, buildApprovedFactBenefit } from "./benefitExpression";

export const LISTING_V5_DECISION_ENGINE_VERSION = "listing-decision-engine.v1" as const;

export interface DecisionPersonaProfile {
  primaryPersona: {
    roleName: string;
    coreMotivation: string;
    contextOfUse: string;
    decisionDrivers: string[];
  };
  secondaryPersonas: Array<{
    roleName: string;
    contextOfUse: string;
  }>;
}

export interface DecisionScenarioItem {
  scenarioId: string;
  name: string;
  vividMoment: string;
  relevantFactIds: string[];
}

export interface DecisionPainPointItem {
  painId: string;
  vocTheme: string;
  severity: "dealbreaker" | "friction" | "minor";
  factBacked: boolean;
  proofFactIds: string[];
  marketingGuidance: {
    action: "preemptive_strike" | "reassure" | "stay_silent";
    suggestedFraming: string;
    forbiddenPhrases: string[];
  };
}

export interface DecisionCvpArchitecture {
  heroAngle: {
    headline: string;
    whyItWins: string;
    anchoredFactIds: string[];
  };
  supportingPillars: Array<{
    pillarName: string;
    factIds: string[];
  }>;
  competitorDiffSignal: string;
}

export interface DecisionBulletBlueprintItem {
  bulletNumber: number;
  strategicMission: ListingV5BulletRole;
  bracketHookDirective: string;
  anchoredFactIds: string[];
  approvedBenefitId: string;
  scenarioId: string;
  persuasionBlueprint: {
    featureFactSummary: string;
    shopperBenefitClause: string;
    reasonToBelieve: string;
  };
  keywordDirective: {
    targetKeyword: string;
    placementRule: "in_hook" | "in_body" | "optional";
  };
  validationGuardrails: {
    bannedTokensForThisBullet: string[];
    sentenceStructureRule: string;
  };
}

export interface DecisionTitleBlueprint {
  structureFormula: string;
  brand: string;
  primaryKeyword: string;
  coreSpecFactIds: string[];
  recommendedTitle: string;
}

export interface DecisionBackendSearchStrategy {
  candidateTerms: string[];
}

export interface ListingDecisionEngineOutput {
  version: typeof LISTING_V5_DECISION_ENGINE_VERSION;
  referenceOnly: true;
  personaProfile: DecisionPersonaProfile;
  scenarioMatrix: DecisionScenarioItem[];
  painPointBattleboard: DecisionPainPointItem[];
  cvpArchitecture: DecisionCvpArchitecture;
  bulletBlueprints: DecisionBulletBlueprintItem[];
  titleBlueprint: DecisionTitleBlueprint;
  backendSearchStrategy: DecisionBackendSearchStrategy;
}

function clean(value: unknown, max = 240): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max);
}

function fieldOf(fact: ListingV5Fact): string {
  return fact.canonicalField.toLowerCase();
}

function factTokensSet(facts: readonly ListingV5Fact[]): Set<string> {
  return new Set(
    facts.flatMap((fact) => `${fact.canonicalField} ${fact.value}`.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean),
  );
}

/**
 * Filter out hard tokens that are not supported by confirmed facts.
 */
function sanitizeHookText(hook: string, confirmedTokens: Set<string>): string {
  const words = hook.split(/\s+/);
  const safeWords = words.filter((word) => {
    const lower = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!lower) return true;
    if (HARD_OR_ESCALATION_TOKENS.has(lower) && !confirmedTokens.has(lower)) {
      return false;
    }
    return true;
  });
  return safeWords.join(" ") || "FEATURE OVERVIEW";
}

/**
 * Heuristic mapping: which facts can honestly resolve common consumer pain points.
 */
const PAIN_MAPPING: Array<{ match: RegExp; fields: string[]; severity: "dealbreaker" | "friction" | "minor"; guidance: string }> = [
  { match: /\b(?:clean|wash|dishwasher|scrub|hygiene|care)\b/i, fields: ["care", "material"], severity: "dealbreaker", guidance: "Highlight confirmed dishwasher-safe or wash care instructions to alleviate cleaning hassles" },
  { match: /\b(?:leak|spill|mess|seal|lid|latch)\b/i, fields: ["operation", "functional_feature"], severity: "dealbreaker", guidance: "Anchor to confirmed lid or latch mechanism without over-promising unverified leakproof claims" },
  { match: /\b(?:size|fit|capacity|volume|small|large|bulky|space)\b/i, fields: ["capacity", "dimensions", "weight"], severity: "friction", guidance: "Provide exact volume and dimensions for clear sizing and placement expectations" },
  { match: /\b(?:missing|utensil|spoon|fork|accessory|pack)\b/i, fields: ["included_components", "quantity_or_pack_size"], severity: "friction", guidance: "Highlight confirmed included components so shoppers know exactly what is in the set" },
  { match: /\b(?:temperature|cold|hot|warm|insulat)\b/i, fields: ["functional_feature", "material"], severity: "dealbreaker", guidance: "State confirmed vacuum insulation features without fabricating hourly durations" },
  { match: /\b(?:heavy|carry|travel|commute|backpack)\b/i, fields: ["weight", "dimensions"], severity: "minor", guidance: "Highlight verified weight specifications for clear portability expectations" },
  { match: /\b(?:rust|metal|odor|taste|material)\b/i, fields: ["material", "construction"], severity: "friction", guidance: "Specify confirmed material build for clean food contact and everyday use" },
];

/**
 * Deterministic generator for realistic lifestyle scenarios based on product facts.
 */
function buildScenarioMatrix(facts: readonly ListingV5Fact[], strategy: ListingV5Strategy): DecisionScenarioItem[] {
  const hasFact = (field: string) => facts.find((f) => fieldOf(f) === field);

  const careFact = hasFact("care");
  const capacityFact = hasFact("capacity") || hasFact("dimensions");
  const componentFact = hasFact("included_components");
  const featureFact = hasFact("functional_feature") || hasFact("material");
  const weightFact = hasFact("weight");

  const useCases = (strategy.useCases || []).map((u) => clean(u, 100)).filter(Boolean);
  const scenarios: DecisionScenarioItem[] = [];

  // Scenario 1: Primary Everyday Routine
  const sc1Name = useCases[0] || "Primary Everyday Use";
  const sc1FactIds = [capacityFact?.id, featureFact?.id].filter((id): id is string => Boolean(id));
  scenarios.push({
    scenarioId: "sc-primary-use",
    name: sc1Name,
    vividMoment: `Using the product during ${sc1Name.toLowerCase()} routines`,
    relevantFactIds: sc1FactIds.length > 0 ? sc1FactIds : facts.slice(0, 2).map((f) => f.id),
  });

  // Scenario 2: Active Daily Routine
  const sc2Name = useCases[1] || "Active Daily Setting";
  const sc2FactIds = [componentFact?.id, featureFact?.id].filter((id): id is string => Boolean(id));
  scenarios.push({
    scenarioId: "sc-daily-setting",
    name: sc2Name,
    vividMoment: `Straightforward everyday utility during ${sc2Name.toLowerCase()}`,
    relevantFactIds: sc2FactIds.length > 0 ? sc2FactIds : facts.slice(1, 3).map((f) => f.id),
  });

  // Scenario 3: Practical Placement or Transit
  const sc3Name = useCases[2] || "Storage & Placement";
  const sc3FactIds = [weightFact?.id, capacityFact?.id].filter((id): id is string => Boolean(id));
  scenarios.push({
    scenarioId: "sc-storage-placement",
    name: sc3Name,
    vividMoment: `Convenient placement and storage during ${sc3Name.toLowerCase()} routines`,
    relevantFactIds: sc3FactIds.length > 0 ? sc3FactIds : facts.slice(0, 2).map((f) => f.id),
  });

  // Scenario 4: Routine Care & Maintenance
  if (careFact) {
    scenarios.push({
      scenarioId: "sc-care-cleanup",
      name: "Routine Care & Cleaning",
      vividMoment: `Simple maintenance following confirmed ${careFact.value} instructions`,
      relevantFactIds: [careFact.id],
    });
  }

  return scenarios;
}

/**
 * Builds the Pain Point Battleboard by mapping VOC themes/strategy pains to fact-backed solutions.
 */
function buildPainPointBattleboard(
  context: ListingV5Context,
  strategy: ListingV5Strategy,
  facts: readonly ListingV5Fact[],
): DecisionPainPointItem[] {
  const items: DecisionPainPointItem[] = [];
  const seenPains = new Set<string>();

  // Extract from VOC references
  const vocPains = (context.references.voc || []).map((v) => clean(v.text, 120)).filter(Boolean);
  const strategyPains = (strategy.painPoints || []).map((p) => clean(p, 120)).filter(Boolean);
  const candidatePains = [...vocPains, ...strategyPains];

  for (const pain of candidatePains) {
    if (items.length >= 5) break;
    const key = pain.toLowerCase();
    if (seenPains.has(key)) continue;
    seenPains.add(key);

    // Find rule match
    const matchedRule = PAIN_MAPPING.find((rule) => rule.match.test(pain));
    let proofFactIds: string[] = [];

    if (matchedRule) {
      proofFactIds = facts
        .filter((f) => matchedRule.fields.includes(fieldOf(f)))
        .map((f) => f.id);
    }

    const factBacked = proofFactIds.length > 0;
    items.push({
      painId: `pain-${items.length + 1}`,
      vocTheme: pain,
      severity: matchedRule ? matchedRule.severity : "minor",
      factBacked,
      proofFactIds: proofFactIds.slice(0, 3),
      marketingGuidance: {
        action: factBacked ? "preemptive_strike" : "stay_silent",
        suggestedFraming: matchedRule
          ? matchedRule.guidance
          : "Stay silent or address only through verified physical product attributes",
        forbiddenPhrases: ["guaranteed", "100%", "unbreakable", "leakproof"],
      },
    });
  }

  // Ensure at least 2 entries exist if facts exist
  if (items.length === 0 && facts.length > 0) {
    const careFact = facts.find((f) => fieldOf(f) === "care");
    if (careFact) {
      items.push({
        painId: "pain-care",
        vocTheme: "Tedious manual hand-scrubbing after long work or school days",
        severity: "dealbreaker",
        factBacked: true,
        proofFactIds: [careFact.id],
        marketingGuidance: {
          action: "preemptive_strike",
          suggestedFraming: "Reassure with dishwasher-safe parts to save evening chore time",
          forbiddenPhrases: ["guaranteed effortless"],
        },
      });
    }
  }

  return items;
}

/**
 * Constructs 5 distinct bullet blueprints executing the standard 5 conversion roles.
 */
function buildBulletBlueprints(
  facts: readonly ListingV5Fact[],
  strategy: ListingV5Strategy,
  scenarios: DecisionScenarioItem[],
): DecisionBulletBlueprintItem[] {
  const confirmedTokens = factTokensSet(facts);
  const usedFactIds = new Set<string>();

  const pickFact = (preferredFields: string[]): ListingV5Fact | null => {
    for (const field of preferredFields) {
      const hit = facts.find((f) => fieldOf(f) === field && !usedFactIds.has(f.id));
      if (hit) {
        usedFactIds.add(hit.id);
        return hit;
      }
    }
    const fallback = facts.find((f) => !usedFactIds.has(f.id)) || facts[0] || null;
    if (fallback) usedFactIds.add(fallback.id);
    return fallback;
  };

  const ROLES: ListingV5BulletRole[] = [
    "core_outcome",
    "pain_relief",
    "use_scenario",
    "ease_of_use",
    "proof_or_fit",
  ];

  const blueprints: DecisionBulletBlueprintItem[] = [];

  for (let i = 0; i < 5; i++) {
    const role = strategy.bulletAngles[i]?.role || ROLES[i] || "proof_or_fit";
    let preferredFields: string[] = [];

    switch (role) {
      case "core_outcome":
        preferredFields = ["functional_feature", "material", "capacity"];
        break;
      case "pain_relief":
        preferredFields = ["care", "included_components", "operation"];
        break;
      case "use_scenario":
        preferredFields = ["dimensions", "capacity", "weight"];
        break;
      case "ease_of_use":
        preferredFields = ["included_components", "operation", "functional_feature"];
        break;
      case "proof_or_fit":
        preferredFields = ["material", "weight", "dimensions", "series_or_model"];
        break;
    }

    const fact = pickFact(preferredFields);
    const factId = fact ? fact.id : facts[0]?.id || "fact-default";
    const field = fact ? fieldOf(fact) : "product_type";
    const val = fact ? fact.value : "quality construction";
    const approvedBenefit = fact ? buildApprovedFactBenefit(fact) : null;
    const benefitClause = approvedBenefit ? approvedBenefit.text : `${val} — states the product detail`;
    const reasonToBelieve = `Anchored to verified ${fact?.label || field} specification: ${val}`;

    let rawHook = "PRODUCT DETAIL";
    if (field === "care") {
      rawHook = /dishwasher/i.test(val) ? "DISHWASHER SAFE" : "CARE INSTRUCTIONS";
    } else if (field === "functional_feature") {
      rawHook = /insulat/i.test(val) ? "VACUUM INSULATED" : "FUNCTIONAL FEATURE";
    } else if (field === "material") {
      rawHook = /stainless steel/i.test(val)
        ? "STAINLESS STEEL"
        : /ceramic/i.test(val)
          ? "CERAMIC BUILD"
          : "VERIFIED MATERIAL";
    } else if (field === "capacity") {
      rawHook = /\d+\s*oz/i.test(val) ? val.toUpperCase() + " CAPACITY" : "CAPACITY";
    } else if (field === "dimensions") {
      rawHook = "PRODUCT DIMENSIONS";
    } else if (field === "included_components") {
      rawHook = /spoon/i.test(val) ? "INCLUDED SPOON" : "INCLUDED COMPONENTS";
    } else if (field === "operation") {
      rawHook = /latch/i.test(val) ? "PUSH-BUTTON LATCH" : "LID DESIGN";
    } else if (field === "weight") {
      rawHook = "ITEM WEIGHT";
    } else {
      rawHook = "VERIFIED SPECIFICATION";
    }

    const safeHook = sanitizeHookText(rawHook, confirmedTokens);
    const assignedScenario = scenarios[i % scenarios.length] || scenarios[0]!;
    const targetKeyword = strategy.keywordIntent.secondary[i] || strategy.keywordIntent.primary[0] || "product";

    blueprints.push({
      bulletNumber: i + 1,
      strategicMission: role,
      bracketHookDirective: `[${safeHook}]:`,
      anchoredFactIds: [factId],
      approvedBenefitId: approvedBenefit ? approvedBenefit.id : approvedFactBenefitId(factId),
      scenarioId: assignedScenario.scenarioId,
      persuasionBlueprint: {
        featureFactSummary: `${fact?.label || "Spec"}: ${val}`,
        shopperBenefitClause: benefitClause,
        reasonToBelieve,
      },
      keywordDirective: {
        targetKeyword,
        placementRule: i === 0 ? "in_hook" : "in_body",
      },
      validationGuardrails: {
        bannedTokensForThisBullet: Array.from(HARD_OR_ESCALATION_TOKENS)
          .filter((t) => !confirmedTokens.has(t))
          .slice(0, 16),
        sentenceStructureRule: "Lead with [CAPITALIZED HOOK]:, then state the verified product detail and its practical utility in 12-30 words with natural grammar.",
      },
    });
  }

  return blueprints;
}

/**
 * Main export: build deterministic decision engine brief.
 */
export function buildListingDecisionEngine(
  context: ListingV5Context,
  strategy: ListingV5Strategy,
): ListingDecisionEngineOutput {
  const facts = context.confirmedFacts || [];
  const primaryAudience = clean(strategy.targetAudience[0]) || "Shoppers looking for reliable everyday products";
  const primaryMotivation = clean(strategy.purchaseMotivations[0]) || clean(strategy.primaryAngle) || "Practical daily utility";
  const primaryUseCases = (strategy.useCases || []).slice(0, 3).map(clean).filter(Boolean);

  const brandFact = facts.find((f) => fieldOf(f) === "brand");
  const brand = brandFact ? brandFact.value : clean(context.productIdentity?.split(" ")[0]) || "Quality Brand";
  const primaryKw = clean(strategy.keywordIntent.primary[0]) || "Everyday Essential";

  const scenarios = buildScenarioMatrix(facts, strategy);
  const painPoints = buildPainPointBattleboard(context, strategy, facts);
  const bullets = buildBulletBlueprints(facts, strategy, scenarios);

  const topFactIds = facts.slice(0, 3).map((f) => f.id);
  const coreSpecsStr = facts.slice(0, 3).map((f) => f.value).join(", ");

  return {
    version: LISTING_V5_DECISION_ENGINE_VERSION,
    referenceOnly: true,
    personaProfile: {
      primaryPersona: {
        roleName: primaryAudience,
        coreMotivation: primaryMotivation,
        contextOfUse: primaryUseCases.join(", ") || "Daily home, school, and commute routines",
        decisionDrivers: [
          "Verified product specifications and materials",
          "Hassle-free daily maintenance and cleaning",
          "Compact, practical everyday portion sizing",
        ],
      },
      secondaryPersonas: (strategy.targetAudience || []).slice(1, 4).map((aud) => ({
        roleName: clean(aud),
        contextOfUse: "Everyday practical use",
      })),
    },
    scenarioMatrix: scenarios,
    painPointBattleboard: painPoints,
    cvpArchitecture: {
      heroAngle: {
        headline: clean(strategy.primaryAngle) || `Everyday practical convenience with verified ${brand} quality`,
        whyItWins: "Directly solves morning prep and evening cleanup hassles with verified physical specifications",
        anchoredFactIds: topFactIds,
      },
      supportingPillars: [
        { pillarName: "Verified Material & Build", factIds: facts.filter((f) => ["material", "functional_feature"].includes(fieldOf(f))).map((f) => f.id) },
        { pillarName: "Everyday Portability & Sizing", factIds: facts.filter((f) => ["capacity", "dimensions", "weight"].includes(fieldOf(f))).map((f) => f.id) },
        { pillarName: "Effortless Maintenance & Hygiene", factIds: facts.filter((f) => ["care", "included_components"].includes(fieldOf(f))).map((f) => f.id) },
      ],
      competitorDiffSignal: "Focuses on honest verified specifications rather than exaggerated claims",
    },
    bulletBlueprints: bullets,
    titleBlueprint: {
      structureFormula: "[Brand] + [Primary Keyword] + [Core Features/Specs] + [Intended Use]",
      brand,
      primaryKeyword: primaryKw,
      coreSpecFactIds: topFactIds,
      recommendedTitle: `${brand} ${primaryKw}${coreSpecsStr ? `, ${coreSpecsStr}` : ""}`,
    },
    backendSearchStrategy: {
      candidateTerms: [
        ...(strategy.keywordIntent.backendOnly || []),
        ...(strategy.keywordIntent.secondary || []),
      ].slice(0, 8).map(clean).filter(Boolean),
    },
  };
}
