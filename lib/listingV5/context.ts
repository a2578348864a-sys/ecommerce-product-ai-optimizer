import { createHash } from "node:crypto";
import type {
  CreativeContextCompetitiveInsight,
  CreativeContextKeywordCandidate,
  CreativeContextV1,
  CreativeContextVocInsight,
} from "@/lib/creativeContextBuilder";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { LISTING_V5_STRATEGY_PROMPT_VERSION, LISTING_V5_VALIDATION_VERSION, LISTING_V5_WRITER_PROMPT_VERSION } from "./types";
import type { ListingV5Context, ListingV5EvidenceStrength, ListingV5Fact, ListingV5Reference } from "./types";

const MAX_FACTS = 40;
const MAX_REFERENCES = 20;
const MAX_REFERENCE_CHARS = 300;
const MAX_TOTAL_REFERENCE_CHARS = 7_000;
const PROMPT_CONTROL_TEXT = /(?:\bignore\s+(?:all\s+)?previous\s+instructions?|\bsystem\s*:|\bdeveloper\s*:|\bassistant\s*:|\boutput\s+fake)/gi;

/**
 * Fields whose value is a declared multi-value enumeration.
 *
 * Only these are atomized for claim anchoring. A comma-joined capability list
 * such as "Extra Large Capacity, Expandable, Sturdy, Food Safe, Waterproof" is
 * five independent claims, and demanding that one sentence restate all five
 * would make any single one impossible to anchor.
 *
 * Deliberately excluded: dimensions, product identity, material phrases and
 * care instructions. A comma inside those is part of one value, not a list, so
 * splitting them would invent claims the confirmed data never made.
 */
const MULTI_VALUE_FACT_FIELDS = new Set(["functional_feature", "feature", "features", "feature_list", "capabilities"]);

/**
 * The values a single confirmed fact may be anchored against. The fact id
 * contract is unchanged: the writer still cites one factId, and the validator
 * accepts a restatement of any one atomic value of that fact.
 */
export function factAnchorValues(fact: { canonicalField: string; value: string }): string[] {
  if (!MULTI_VALUE_FACT_FIELDS.has(fact.canonicalField)) return [fact.value];
  const parts = fact.value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [fact.value];
}

function text(value: unknown, max = MAX_REFERENCE_CHARS): string {
  return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * A confirmed fact value may be a string, a number, a boolean or a string list
 * (ProductCreativeHandoffFactValue). Only strings used to survive this far, so
 * an array fact such as ["Expandable", "Food Safe"] silently disappeared from
 * the fact set and could never anchor copy. The value is normalised the same way
 * the legacy listing input does instead of being dropped.
 */
function factValueText(value: unknown, max: number): string {
  if (Array.isArray(value)) {
    const parts = value
      .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
      .map((item) => String(item).normalize("NFC").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return text(parts.join(", "), max);
  }
  if (typeof value === "number" && Number.isFinite(value)) return text(String(value), max);
  if (typeof value === "boolean") return text(value ? "true" : "false", max);
  return text(value, max);
}

/**
 * One reference plus the evidence identity it carries from the Evidence layer.
 *
 * `evidenceId` is only ever set when the upstream Evidence object really has an
 * identity (a VOC `insightId`, a keyword report row, a competitor ASIN). When it
 * is missing the reference stays citable as framing but carries no id — nothing
 * invents one, and nothing substitutes a constant.
 */
type ReferenceSource = {
  text: string;
  evidenceId?: string;
  evidenceRef?: string;
  strength?: ListingV5EvidenceStrength;
  count?: number;
};

function reference(source: ReferenceSource, sourceType: ListingV5Reference["sourceType"]): ListingV5Reference | null {
  const value = source.text
    .normalize("NFC")
    .replace(PROMPT_CONTROL_TEXT, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return null;
  const capped = value.slice(0, MAX_REFERENCE_CHARS);
  return {
    text: capped,
    sourceType,
    marker: "UNTRUSTED_REFERENCE_DATA",
    notProductFact: true,
    // Evidence identity is carried through untouched. It is metadata about where
    // the text came from, so sanitising the text never changes it.
    ...(source.evidenceId ? { evidenceId: source.evidenceId } : {}),
    ...(source.evidenceRef ? { evidenceRef: source.evidenceRef } : {}),
    ...(source.strength ? { strength: source.strength } : {}),
    ...(typeof source.count === "number" && Number.isFinite(source.count) ? { count: source.count } : {}),
    ...(capped.length < value.length ? { textTruncated: true } : {}),
  };
}

/**
 * Owner-authored direction (`creativePreferences.additionalRequirements`) reaches
 * the strategy prompt as free text. It is untrusted input like any other, so the
 * same prompt-control stripping applies before it can steer the model. The
 * sanitized value is what both the fingerprint and the prompt see.
 */
function cleanDirection(value: string | null | undefined, max = 300): string {
  return text(value ?? "", max)
    .replace(PROMPT_CONTROL_TEXT, "")
    .replace(/^[\s.,;:!?\-–—]+/, "")
    .replace(/[\s.,;:!?\-–—]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedReferences(values: readonly ReferenceSource[], sourceType: ListingV5Reference["sourceType"], budget: { used: number }): ListingV5Reference[] {
  const out: ListingV5Reference[] = [];
  for (const value of values.slice(0, MAX_REFERENCES)) {
    if (budget.used >= MAX_TOTAL_REFERENCE_CHARS) break;
    const item = reference(value, sourceType);
    if (!item) continue;
    const room = MAX_TOTAL_REFERENCE_CHARS - budget.used;
    const clipped = item.text.slice(0, room);
    if (!clipped) break;
    // The total-budget clip is a second truncation path on top of the per-item cap.
    out.push(clipped.length < item.text.length ? { ...item, text: clipped, textTruncated: true } : { ...item, text: clipped });
    budget.used += clipped.length;
  }
  return out;
}

/**
 * Stable evidence ids. Each one is derived from the upstream Evidence object,
 * never from a loop index and never from a constant, so two different references
 * can never share an id and an id can never outlive its source.
 */
function vocEvidenceId(insight: CreativeContextVocInsight): string | undefined {
  const id = text(insight.insightId, 120);
  if (!id) return undefined;
  const kind = insight.sourceType === "voc_conflict" ? "conflict" : "theme";
  return `voc:${kind}:${id}`;
}

function keywordEvidenceId(candidate: CreativeContextKeywordCandidate): string | undefined {
  const reportType = text(candidate.reportType, 60);
  const rowNumber = typeof candidate.rowNumber === "number" && Number.isFinite(candidate.rowNumber) && candidate.rowNumber > 0
    ? Math.trunc(candidate.rowNumber)
    : null;
  if (reportType && rowNumber !== null) return `kw:${reportType}:${rowNumber}`;
  // Fall back to a content hash so a report without row numbers still gets a
  // stable, unique identity instead of colliding on the keyword text.
  const keyword = text(candidate.keyword, 120);
  return keyword ? `kw:${createHash("sha256").update(keyword, "utf8").digest("hex").slice(0, 16)}` : undefined;
}

function competitorEvidenceId(insight: CreativeContextCompetitiveInsight): string | undefined {
  const asin = text(insight.asin, 40);
  return asin ? `competitor:${asin}` : undefined;
}

/**
 * The Evidence layer does not grade keyword or competitor observations, so this
 * layer must not invent a grade for them either.
 */
const UNGRADED_STRENGTH: ListingV5EvidenceStrength = "unknown";

export type ListingV5ContextInput = {
  taskId: string;
  researchRevision: number;
  handoffRevision: number;
  marketplace?: string;
  productIdentity?: string;
  generationInput: ListingGenerationInput;
  creativeContext?: CreativeContextV1 | null;
  confirmedFacts: Array<{ factId: string; field: string; label: string; value: unknown; sourceRefs?: string[] }>;
  manualDirection?: string | null;
};

/** Builds a bounded, immutable V5 context. Research material is reference-only. */
export function buildListingV5Context(input: ListingV5ContextInput): ListingV5Context {
  const facts: ListingV5Fact[] = input.confirmedFacts.slice(0, MAX_FACTS).map((fact) => ({
    id: text(fact.factId, 120) || text(fact.field, 120),
    canonicalField: text(fact.field, 120),
    label: text(fact.label, 160) || text(fact.field, 120),
    value: factValueText(fact.value, 500),
    sourceRefs: (fact.sourceRefs ?? []).filter((ref): ref is string => typeof ref === "string").map((ref) => text(ref, 160)).filter(Boolean).slice(0, 4),
  })).filter((fact) => fact.id && fact.canonicalField && fact.value);

  const context = input.creativeContext;
  const budget = { used: 0 };
  const manualDirection = cleanDirection(input.manualDirection);
  const voc = boundedReferences((context?.vocInsights ?? []).map((item) => ({
    text: `${item.theme}: ${item.summary}`,
    evidenceId: vocEvidenceId(item),
    evidenceRef: item.provenance?.evidenceRef,
    strength: item.strength,
    count: item.reviewCount,
  })), "VOC", budget);
  const keywords = boundedReferences((context?.keywordCandidates ?? []).map((item) => ({
    text: item.keyword,
    evidenceId: keywordEvidenceId(item),
    evidenceRef: item.evidenceRef,
    strength: UNGRADED_STRENGTH,
    count: 1,
  })), "keyword", budget);
  const competitors = boundedReferences((context?.competitiveContext ?? []).map((item) => ({
    text: item.note || item.asin,
    evidenceId: competitorEvidenceId(item),
    evidenceRef: item.evidenceRef,
    strength: UNGRADED_STRENGTH,
    count: 1,
  })), "competitor", budget);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    taskId: input.taskId,
    researchRevision: input.researchRevision,
    handoffRevision: input.handoffRevision,
    strategyPromptVersion: LISTING_V5_STRATEGY_PROMPT_VERSION,
    writerPromptVersion: LISTING_V5_WRITER_PROMPT_VERSION,
    validatorVersion: LISTING_V5_VALIDATION_VERSION,
    marketplace: input.marketplace ?? "Amazon US",
    productIdentity: text(input.productIdentity, 240),
    facts,
    prohibitedClaims: input.generationInput.prohibitedClaims.slice(0, 20).map((item) => text(item)),
    unknowns: input.generationInput.unknowns.slice(0, 20).map((item) => text(item)),
    references: { voc, keywords, competitors },
    manualDirection,
  }), "utf8").digest("hex");
  return {
    version: "listing-v5.context.v1",
    taskId: text(input.taskId, 200),
    researchRevision: input.researchRevision,
    handoffRevision: input.handoffRevision,
    contextFingerprint: fingerprint,
    marketplace: text(input.marketplace, 80) || "Amazon US",
    productIdentity: text(input.productIdentity, 240),
    confirmedFacts: facts,
    prohibitedClaims: input.generationInput.prohibitedClaims.slice(0, 20).map((item) => text(item)).filter(Boolean),
    unknowns: input.generationInput.unknowns.slice(0, 20).map((item) => text(item)).filter(Boolean),
    references: { voc, keywords, competitors, sourcing: [] },
    manualDirection: manualDirection || null,
  };
}
