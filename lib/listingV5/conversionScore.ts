/**
 * Listing V5 — Conversion Benchmark v2 measurement instrument.
 *
 * An independent, deterministic reading of how well a shipped listing converts,
 * scored with the benchmark rubric (five dimensions x 20 points):
 * Buyer Intent / Benefit Clarity / Differentiation / Specificity / Naturalness.
 *
 * Why this is separate from `qualityEvaluation.ts`:
 * - The Studio panel answers "how good is this listing for the user right now".
 * - This module is the benchmark instrument. Keeping it separate means a change
 *   to the product's display scoring can never silently move a benchmark score,
 *   and the benchmark never needs a provider call or a human judge to reproduce.
 * - It reads the same frozen artefacts (context / strategy / blueprint / draft /
 *   validation) and never mutates them, never relaxes the Validator and never
 *   decides pass/fail.
 */
import type { ListingV5ConversionBlueprint } from "./conversionBlueprint";
import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

export const LISTING_V5_CONVERSION_SCORE_VERSION = "listing-v5.conversion-score.v1" as const;

export type ConversionScoreDimension = {
  id: "buyer_intent" | "benefit_clarity" | "differentiation" | "specificity" | "naturalness";
  label: string;
  score: number;
  max: 20;
  evidence: string[];
};

export type ListingV5ConversionScore = {
  version: typeof LISTING_V5_CONVERSION_SCORE_VERSION;
  total: number;
  max: 100;
  average: number;
  dimensions: ConversionScoreDimension[];
  deterministicFallback: boolean;
  notes: string[];
};

export type ConversionScoreInput = {
  context: ListingV5Context;
  strategy: ListingV5Strategy;
  blueprint: ListingV5ConversionBlueprint;
  draft: ListingV5WriterDraft;
  validation: ListingV5ValidationResult;
  deterministicFallback: boolean;
};

const BENCHMARK_PASS_AVERAGE = 75;

const MECHANICAL_TEMPLATE_FRAGMENTS = [
  "helping shoppers understand the product at a glance",
  "shoppers can compare a clear product detail",
  "brings together",
  "giving shoppers a clear detail to compare",
  "a clear detail helps shoppers decide",
  "for shoppers comparing practical options",
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sentences(value: string): string[] {
  return value.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function buyerIntentDimension(blueprint: ListingV5ConversionBlueprint, draft: ListingV5WriterDraft, title: string, bullets: string[]): ConversionScoreDimension {
  const evidence: string[] = [];
  let score = 0;
  const primary = normalize(blueprint.buyerIntent.primary);
  const intentTokens = primary.split(" ").filter((token) => token.length >= 4);
  const titleHits = intentTokens.filter((token) => title.includes(token)).length;
  if (intentTokens.length > 0 && titleHits / intentTokens.length >= 0.6) {
    score += 8;
    evidence.push(`title carries the buyer-intent phrase (${titleHits}/${intentTokens.length} tokens)`);
  } else {
    score += (intentTokens.length > 0 ? titleHits / intentTokens.length : 0) * 8;
    evidence.push(`title covers ${titleHits}/${intentTokens.length} buyer-intent tokens`);
  }
  const firstBullet = bullets[0] ?? "";
  const firstBulletIntent = intentTokens.some((token) => firstBullet.includes(token));
  if (firstBulletIntent || draft.bullets[0]?.strategyRole === "core_outcome") {
    score += 6;
    evidence.push("first bullet leads with the core outcome / buyer intent");
  } else {
    evidence.push("first bullet does not lead with the core outcome");
  }
  const secondaryIntent = blueprint.buyerIntent.secondary.map((item) => normalize(item));
  const secondaryCovered = secondaryIntent.filter((term) => term.length >= 4 && bullets.join(" ").includes(term));
  if (blueprint.buyerIntent.stage === "comparison") {
    const comparisonWording = /\b(?:compare|comparison|versus|vs\.?|option|choice)\b/.test(bullets.join(" "));
    score += comparisonWording ? 6 : 2;
    evidence.push(comparisonWording ? "comparison-stage intent reflected in the copy" : "comparison-stage intent not reflected");
  } else {
    score += secondaryIntent.length === 0 ? 4 : Math.min(6, (secondaryCovered.length / secondaryIntent.length) * 6);
    evidence.push(`${secondaryCovered.length}/${secondaryIntent.length} secondary intent term(s) present`);
  }
  return { id: "buyer_intent", label: "Buyer Intent", score: clamp(score, 20), max: 20, evidence };
}

function benefitClarityDimension(blueprint: ListingV5ConversionBlueprint, draft: ListingV5WriterDraft, bullets: string[]): ConversionScoreDimension {
  const evidence: string[] = [];
  const factValues = blueprint.proofPoints.map((point) => normalize(point.value)).filter((value) => value.length > 1);
  const connector = /\b(?:so|helps?|helping|makes?|easier|means|keeps?|lets?|gives?|avoids?|supports?|fits?|works?|instead of|without)\b/;
  /**
   * A bullet states a benefit when it names an attribute from one of its anchored
   * facts AND connects it to a shopper outcome. Word-level overlap is used on
   * purpose: demanding the full fact value verbatim is what Specificity measures,
   * and requiring it here scored genuinely benefit-led copy as a fact list.
   */
  const anchoredTokens = (factIds: string[]): Set<string> => {
    const tokens = new Set<string>();
    for (const id of factIds) {
      const point = blueprint.proofPoints.find((candidate) => candidate.factId === id);
      if (!point) continue;
      for (const word of normalize(`${point.field} ${point.value}`).split(/[^a-z0-9]+/)) {
        if (word.length >= 4) tokens.add(word);
      }
    }
    return tokens;
  };
  let paired = 0;
  draft.bullets.forEach((bullet, index) => {
    const text = bullets[index] ?? "";
    const tokens = anchoredTokens(bullet.factIds);
    const namesAttribute = [...tokens].some((token) => text.includes(token)) || factValues.some((value) => text.includes(value));
    if (namesAttribute && connector.test(text)) paired += 1;
  });
  const ratio = draft.bullets.length > 0 ? paired / draft.bullets.length : 0;
  const score1 = ratio * 12;
  evidence.push(`${paired}/${draft.bullets.length} bullet(s) pair a confirmed attribute with a shopper benefit`);
  const roles = new Set(draft.bullets.map((bullet) => bullet.strategyRole));
  const roleScore = draft.bullets.length > 0 ? (roles.size / draft.bullets.length) * 5 : 0;
  evidence.push(`${roles.size} distinct strategy role(s) across ${draft.bullets.length} bullet(s)`);
  const factDump = draft.bullets.filter((bullet, index) => {
    const text = bullets[index] ?? "";
    return !connector.test(text) && text.split(" ").length > 12;
  }).length;
  const dumpScore = Math.max(0, 3 - factDump);
  if (factDump > 0) evidence.push(`${factDump} bullet(s) read as a fact list without a benefit`);
  return { id: "benefit_clarity", label: "Benefit Clarity", score: clamp(score1 + roleScore + dumpScore, 20), max: 20, evidence };
}

function differentiationDimension(blueprint: ListingV5ConversionBlueprint, context: ListingV5Context, validation: ListingV5ValidationResult, all: string): ConversionScoreDimension {
  const evidence: string[] = [];
  let score = 0;
  if (blueprint.competitorGaps.length === 0) {
    evidence.push("no comparable competitor attribute available (neutral scoring)");
    score += 10;
  } else {
    const factsById = new Map(context.confirmedFacts.map((fact) => [fact.id, normalize(fact.value)]));
    const covered = blueprint.competitorGaps.filter((gap) => gap.ourFactIds.some((id) => {
      const value = factsById.get(id);
      return value ? all.includes(value) : false;
    }));
    score += (covered.length / blueprint.competitorGaps.length) * 12;
    evidence.push(`${covered.length}/${blueprint.competitorGaps.length} competitor-comparable attribute(s) stated with our own fact`);
  }
  const overlap = (validation.claims?.competitorOverlap ?? []).length;
  if (overlap === 0) {
    score += 8;
    evidence.push("no competitor-overlap claim reported by the Validator");
  } else {
    score += Math.max(0, 8 - overlap * 4);
    evidence.push(`${overlap} competitor-overlap claim(s) reported by the Validator`);
  }
  return { id: "differentiation", label: "Differentiation", score: clamp(score, 20), max: 20, evidence };
}

function specificityDimension(blueprint: ListingV5ConversionBlueprint, draft: ListingV5WriterDraft, title: string, bullets: string[]): ConversionScoreDimension {
  const evidence: string[] = [];
  const values = blueprint.proofPoints.map((point) => normalize(point.value)).filter((value) => value.length > 1);
  const bulletsWithValue = bullets.filter((text) => values.some((value) => text.includes(value))).length;
  const bulletScore = bullets.length > 0 ? (bulletsWithValue / bullets.length) * 12 : 0;
  evidence.push(`${bulletsWithValue}/${bullets.length} bullet(s) restate a confirmed fact value verbatim`);
  const measurable = /\d/.test(title) || /\b(?:steel|glass|latex|rubber|plastic|wood|ceramic|fabric|silicone|paper)\b/.test(title);
  const titleScore = measurable ? 8 : 0;
  evidence.push(measurable ? "title carries a measurable or material detail" : "title carries no measurable or material detail");
  const unusedFacts = blueprint.proofPoints.filter((point) => !bullets.join(" ").includes(normalize(point.value)));
  if (unusedFacts.length > 0) evidence.push(`${unusedFacts.length} confirmed fact(s) not used in the bullets`);
  return { id: "specificity", label: "Specificity", score: clamp(bulletScore + titleScore, 20), max: 20, evidence };
}

function naturalnessDimension(draft: ListingV5WriterDraft, bullets: string[], description: string, deterministicFallback: boolean): ConversionScoreDimension {
  const evidence: string[] = [];
  let score = 0;
  const lengths = bullets.map((text) => text.split(" ").length);
  const awkward = lengths.filter((length) => length < 8 || length > 45).length;
  score += Math.max(0, 8 - awkward * 3);
  evidence.push(awkward === 0 ? "bullet lengths sit in a natural range" : `${awkward} bullet(s) are unusually short or long`);
  const mechanical = MECHANICAL_TEMPLATE_FRAGMENTS.filter((fragment) => bullets.concat([description]).some((text) => text.includes(fragment)));
  score += Math.max(0, 8 - mechanical.length * 4);
  evidence.push(mechanical.length === 0 ? "no boilerplate template phrasing detected" : `boilerplate phrasing: ${mechanical.join(" | ")}`);
  const words = bullets.join(" ").split(" ").filter(Boolean);
  const trigrams = new Map<string, number>();
  for (let index = 0; index + 2 < words.length; index += 1) {
    const key = `${words[index]} ${words[index + 1]} ${words[index + 2]}`;
    trigrams.set(key, (trigrams.get(key) ?? 0) + 1);
  }
  const repeated = [...trigrams.values()].filter((count) => count > 1).length;
  score += repeated === 0 ? 4 : Math.max(0, 4 - repeated);
  evidence.push(repeated === 0 ? "no repeated three-word phrase" : `${repeated} repeated three-word phrase(s)`);
  if (deterministicFallback) {
    score = Math.min(score, 6);
    evidence.push("deterministic fallback copy caps naturalness");
  }
  if (sentences(description).length < 2) evidence.push("description has fewer than two sentences");
  return { id: "naturalness", label: "Naturalness", score: clamp(score, 20), max: 20, evidence };
}

export function scoreListingV5Conversion(input: ConversionScoreInput): ListingV5ConversionScore {
  const title = normalize(input.draft.title.text);
  const bullets = input.draft.bullets.map((bullet) => normalize(bullet.text));
  const description = normalize(input.draft.description.text);
  const all = [title, ...bullets, description].join(" \n ");
  const dimensions: ConversionScoreDimension[] = [
    buyerIntentDimension(input.blueprint, input.draft, title, bullets),
    benefitClarityDimension(input.blueprint, input.draft, bullets),
    differentiationDimension(input.blueprint, input.context, input.validation, all),
    specificityDimension(input.blueprint, input.draft, title, bullets),
    naturalnessDimension(input.draft, bullets, description, input.deterministicFallback),
  ];
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const notes: string[] = [];
  if (input.deterministicFallback) notes.push("Listing shipped from the deterministic fallback path; benchmark treats this as a conversion regression signal.");
  if (input.validation.claims.unsupportedClaims.length > 0) notes.push("Validator reported unsupported claims; benchmark score is not a safety signal.");
  return {
    version: LISTING_V5_CONVERSION_SCORE_VERSION,
    total: clamp(total, 100),
    max: 100,
    average: Math.round((total / dimensions.length) * 10) / 10,
    dimensions,
    deterministicFallback: input.deterministicFallback,
    notes,
  };
}

export const CONVERSION_BENCHMARK_PASS_AVERAGE = BENCHMARK_PASS_AVERAGE;
