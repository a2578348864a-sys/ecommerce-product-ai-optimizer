/**
 * Listing V5 — Listing Quality Evaluation (Phase 4).
 *
 * A reporting layer on top of the existing pipeline. It scores five shopper-facing
 * dimensions (Safety, Keyword relevance, Benefit clarity, Differentiation,
 * Conversion strength) from artefacts that already exist:
 *
 *   Validator result (unchanged) + Confirmed Facts + Strategy + Conversion Blueprint + final draft
 *
 * Deliberate boundaries:
 * - It NEVER decides pass/fail and never replaces the Validator. `safety` only
 *   reports what the Validator already found; a listing can score a low quality
 *   grade while remaining a Validator PASS, and that is the point: quality and
 *   factual safety are separate signals.
 * - It is deterministic and provider-free, so it can run in CI and in the UI.
 * - It reads nothing from sourcing references.
 */
import type { ListingV5ConversionBlueprint } from "./conversionBlueprint";
import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

export const LISTING_V5_QUALITY_EVALUATION_VERSION = "listing-v5.quality-evaluation.v1" as const;

export type ListingV5QualityDimension = {
  id: "safety" | "keyword_relevance" | "benefit_clarity" | "differentiation" | "conversion_strength";
  label: string;
  score: number;
  max: number;
  evidence: string[];
};

export type ListingV5QualityEvaluation = {
  version: typeof LISTING_V5_QUALITY_EVALUATION_VERSION;
  total: number;
  max: 100;
  grade: "A" | "B" | "C" | "D";
  dimensions: ListingV5QualityDimension[];
  /** True when the shipped copy is the deterministic fallback draft, not AI copy. */
  deterministicFallback: boolean;
  notes: string[];
};

export type ListingV5QualityEvaluationInput = {
  context: ListingV5Context;
  strategy: ListingV5Strategy;
  blueprint: ListingV5ConversionBlueprint;
  draft: ListingV5WriterDraft;
  validation: ListingV5ValidationResult;
  deterministicFallback: boolean;
};

const CONNECTORS = /\b(?:for|helps?|helping|so|means|makes?|easier|simplif\w*|supports?|keeps?|lets?|gives?|avoids?)\b/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function draftText(draft: ListingV5WriterDraft): { title: string; bullets: string[]; description: string; backend: string; all: string } {
  const title = normalize(draft.title.text);
  const bullets = draft.bullets.map((bullet) => normalize(bullet.text));
  const description = normalize(draft.description.text);
  const backend = normalize((draft.backendSearchTerms ?? []).join(" "));
  return { title, bullets, description, backend, all: [title, ...bullets, description, backend].join(" \n ") };
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function safetyDimension(validation: ListingV5ValidationResult, deterministicFallback: boolean): ListingV5QualityDimension {
  const evidence: string[] = [];
  let score = 25;
  const unsupported = (validation.claims?.unsupportedClaims ?? []).length;
  const prohibited = (validation.claims?.prohibitedClaims ?? []).length;
  const overlap = (validation.claims?.competitorOverlap ?? []).length;
  if (unsupported > 0) {
    score -= Math.min(16, unsupported * 4);
    evidence.push(`${unsupported} unsupported claim(s) reported by the Validator`);
  }
  if (prohibited > 0) {
    score -= Math.min(12, prohibited * 6);
    evidence.push(`${prohibited} prohibited claim(s) reported by the Validator`);
  }
  if (overlap > 0) {
    score -= Math.min(8, overlap * 4);
    evidence.push(`${overlap} competitor-overlap claim(s) reported by the Validator`);
  }
  if (validation.status !== "PASS") {
    score = Math.min(score, 12);
    evidence.push(`Validator status is ${validation.status}`);
  }
  const invalidSegments = (validation.title.valid ? 0 : 1)
    + validation.bullets.filter((bullet) => !bullet.valid).length
    + (validation.description.valid ? 0 : 1);
  if (invalidSegments > 0) {
    score -= Math.min(9, invalidSegments * 3);
    evidence.push(`${invalidSegments} segment(s) failed a structural check`);
  }
  if (deterministicFallback) evidence.push("copy shipped from the deterministic fallback path");
  if (evidence.length === 0) evidence.push("Validator reports no unsupported, prohibited or overlapping claims");
  return { id: "safety", label: "Safety", score: clamp(score, 25), max: 25, evidence };
}

function keywordDimension(context: ListingV5Context, strategy: ListingV5Strategy, validation: ListingV5ValidationResult, text: ReturnType<typeof draftText>): ListingV5QualityDimension {
  const terms = Array.from(new Set([
    ...(strategy.keywordIntent?.primary ?? []),
    ...(strategy.keywordIntent?.secondary ?? []),
    ...(context.references?.keywords ?? []).map((reference) => reference.text),
  ].map((term) => normalize(term)).filter((term) => term.length >= 3))).slice(0, 14);
  const evidence: string[] = [];
  if (terms.length === 0) {
    return { id: "keyword_relevance", label: "Keyword relevance", score: 10, max: 20, evidence: ["no keyword intent available in the frozen context"] };
  }
  const covered = terms.filter((term) => text.all.includes(term));
  let score = (covered.length / terms.length) * 20;
  evidence.push(`${covered.length}/${terms.length} intent term(s) present in the listing`);
  if (validation.quality.keywordStuffing) {
    score = Math.min(score, 10);
    evidence.push("Validator flagged keyword stuffing");
  }
  const missing = terms.filter((term) => !covered.includes(term)).slice(0, 3);
  if (missing.length > 0) evidence.push(`not covered: ${missing.join(", ")}`);
  return { id: "keyword_relevance", label: "Keyword relevance", score: clamp(score, 20), max: 20, evidence };
}

function benefitDimension(blueprint: ListingV5ConversionBlueprint, draft: ListingV5WriterDraft, text: ReturnType<typeof draftText>): ListingV5QualityDimension {
  const evidence: string[] = [];
  const values = blueprint.proofPoints.map((point) => ({ factId: point.factId, value: normalize(point.value) }));
  let withBenefit = 0;
  draft.bullets.forEach((bullet, index) => {
    const anchored = bullet.factIds.length > 0;
    const bulletText = text.bullets[index] ?? "";
    const mentionsAnchoredFact = bullet.factIds.some((id) => {
      const match = values.find((entry) => entry.factId === id);
      return match ? bulletText.includes(match.value) : false;
    });
    if (anchored && (mentionsAnchoredFact || CONNECTORS.test(bulletText))) withBenefit += 1;
  });
  const ratio = draft.bullets.length > 0 ? withBenefit / draft.bullets.length : 0;
  evidence.push(`${withBenefit}/${draft.bullets.length} bullet(s) pair a confirmed fact with a shopper benefit`);
  const roles = new Set(draft.bullets.map((bullet) => bullet.strategyRole));
  if (roles.size === draft.bullets.length) evidence.push("every bullet carries a distinct strategy role");
  else evidence.push(`${draft.bullets.length - roles.size} bullet(s) repeat a strategy role`);
  const score = ratio * 16 + (draft.bullets.length > 0 ? (roles.size / draft.bullets.length) * 4 : 0);
  return { id: "benefit_clarity", label: "Benefit clarity", score: clamp(score, 20), max: 20, evidence };
}

function differentiationDimension(blueprint: ListingV5ConversionBlueprint, context: ListingV5Context, text: ReturnType<typeof draftText>): ListingV5QualityDimension {
  const evidence: string[] = [];
  const factsById = new Map((context.confirmedFacts ?? []).map((fact) => [fact.id, normalize(fact.value)]));
  if (blueprint.competitorGaps.length === 0) {
    evidence.push("no comparable competitor attribute found in reference data");
    return { id: "differentiation", label: "Differentiation", score: 8, max: 15, evidence };
  }
  let covered = 0;
  for (const gap of blueprint.competitorGaps) {
    const mentioned = gap.ourFactIds.some((id) => {
      const value = factsById.get(id);
      return value ? text.all.includes(value) : false;
    });
    if (mentioned) covered += 1;
    else evidence.push(`gap not stated in copy: ${gap.dimension}`);
  }
  evidence.push(`${covered}/${blueprint.competitorGaps.length} competitor-comparable attribute(s) stated with our own confirmed fact`);
  return { id: "differentiation", label: "Differentiation", score: clamp((covered / blueprint.competitorGaps.length) * 15, 15), max: 15, evidence };
}

function conversionDimension(blueprint: ListingV5ConversionBlueprint, strategy: ListingV5Strategy, draft: ListingV5WriterDraft, text: ReturnType<typeof draftText>, deterministicFallback: boolean): ListingV5QualityDimension {
  const evidence: string[] = [];
  let score = 0;
  const primaryIntent = normalize(blueprint.buyerIntent.primary);
  if (primaryIntent && text.title.includes(primaryIntent)) {
    score += 6;
    evidence.push("title carries the primary buyer-intent phrase");
  } else {
    evidence.push("title does not carry the primary buyer-intent phrase");
  }
  const expectedRoles = blueprint.benefitOrder.map((item) => item.role);
  const actualRoles = draft.bullets.map((bullet) => bullet.strategyRole);
  const ordered = expectedRoles.length > 0 && expectedRoles.every((role, index) => actualRoles[index] === role);
  if (ordered) {
    score += 6;
    evidence.push("bullet order follows the blueprint benefit order");
  } else {
    const matched = expectedRoles.filter((role, index) => actualRoles[index] === role).length;
    score += (expectedRoles.length > 0 ? matched / expectedRoles.length : 0) * 6;
    evidence.push(`${matched}/${expectedRoles.length} bullet(s) sit in the planned conversion position`);
  }
  const backedPains = blueprint.painPoints.filter((pain) => pain.factBacked);
  const addressed = backedPains.filter((pain) => pain.proofFactIds.some((id) => draft.bullets.some((bullet) => bullet.factIds.includes(id))));
  if (backedPains.length > 0) {
    score += (addressed.length / backedPains.length) * 4;
    evidence.push(`${addressed.length}/${backedPains.length} fact-backed pain point(s) addressed by a bullet`);
  } else {
    evidence.push("no fact-backed pain point available to address");
  }
  const scenario = (strategy.useCases ?? []).map((useCase) => normalize(useCase)).find((useCase) => useCase.length >= 6 && text.description.includes(useCase.slice(0, 24)));
  if (scenario) {
    score += 4;
    evidence.push("description states a real use scenario from the strategy");
  } else {
    evidence.push("description does not state a strategy use scenario");
  }
  if (deterministicFallback) {
    score = Math.min(score, 8);
    evidence.push("deterministic fallback copy cannot express a conversion angle");
  }
  return { id: "conversion_strength", label: "Conversion strength", score: clamp(score, 20), max: 20, evidence };
}

function gradeFor(total: number): ListingV5QualityEvaluation["grade"] {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  return "D";
}

export function evaluateListingV5Quality(input: ListingV5QualityEvaluationInput): ListingV5QualityEvaluation {
  const text = draftText(input.draft);
  const dimensions: ListingV5QualityDimension[] = [
    safetyDimension(input.validation, input.deterministicFallback),
    keywordDimension(input.context, input.strategy, input.validation, text),
    benefitDimension(input.blueprint, input.draft, text),
    differentiationDimension(input.blueprint, input.context, text),
    conversionDimension(input.blueprint, input.strategy, input.draft, text, input.deterministicFallback),
  ];
  const total = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const notes: string[] = [];
  if ((input.validation.claims?.unsupportedClaims ?? []).length > 0) notes.push("Validator reported unsupported claims; fix facts or wording, never the Validator.");
  if (input.deterministicFallback) notes.push("This listing shipped from the deterministic fallback path and is a quality regression signal, not a factual failure.");
  if (dimensions[3]?.evidence.some((line) => line.startsWith("no comparable competitor"))) notes.push("Differentiation could not be measured: no comparable competitor attribute in the research references.");
  return {
    version: LISTING_V5_QUALITY_EVALUATION_VERSION,
    total: clamp(total, 100),
    max: 100,
    grade: gradeFor(total),
    dimensions,
    deterministicFallback: input.deterministicFallback,
    notes,
  };
}
