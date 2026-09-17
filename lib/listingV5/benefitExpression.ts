import type { ListingV5BenefitCandidate, ListingV5Fact } from "./types";
import { HARD_OR_ESCALATION_TOKENS } from "./claimVocabulary";

/**
 * Listing V5.8 Phase 4 — Safe Benefit Expression Layer.
 *
 * Phase 2 gave the Strategy an evidence-derived candidate layer, but Phase 3
 * measured the result on 18 real products and found the bottleneck moved: the
 * highest-frequency concepts had the LOWEST expression rates
 * (`durability` 12 candidates → 8.3% expressed; `value_for_money` 8 → 0%;
 * `portability` 5 → 0%). The reason was not the candidate layer. The words that
 * naturally express those concepts (durable, leakproof, tough, heavy-duty) are
 * exactly the words the Validator rejects and the Writer prompt bans, so a
 * candidate could be produced correctly and still never reach the copy.
 *
 * This layer converts a candidate into framing the Writer can actually use,
 * WITHOUT relaxing anything:
 *
 * - `safeExpressions` are built from exactly two approved sources: the verbatim
 *   value of a Confirmed Fact, and a clause composed only of the Writer prompt's
 *   own closed persuasion vocabulary (easier / simpler / quicker / tidier /
 *   one less thing to think about / confidently compare / ready for / matches /
 *   avoids / saves a step). Nothing else is invented, so no new specification,
 *   certification, duration or performance attribute can be introduced.
 * - The layer can never emit a hard-claim token in its own wording: the clause
 *   table is filtered through `HARD_OR_ESCALATION_TOKENS` — the single source of
 *   truth the Validator itself uses — at module load, and a clause that would
 *   contain one is dropped rather than emitted.
 * - A concept with no Confirmed Fact able to carry it produces NO expression.
 *   The layer reports the concept with an empty `safeExpressions` and an explicit
 *   `no_supporting_fact` block instead of inventing a benefit.
 * - `blockedExpressions` name the tempting wording that must NOT be used, so the
 *   Writer is told what to avoid rather than left to guess.
 *
 * It is a pure function: no provider call, no clock, no randomness, no I/O.
 * It does not touch the Validator, the fallback draft or the writer prompt.
 */

export const LISTING_V5_BENEFIT_EXPRESSION_VERSION = "listing-v5.benefit-expression.v1" as const;
/** Only this Blueprint contract may activate executable Benefit projection. */
export const LISTING_V5_SUPPORTED_BLUEPRINT_VERSION = "listing-v5.conversion-blueprint.v2" as const;

/** Why a tempting wording must not be used. */
export type ListingV5BlockedReason =
  /** The frozen context lists it as a prohibited claim. */
  | "prohibited_claim"
  /** It is a hard-claim / escalation token the Validator rejects. */
  | "hard_claim_token"
  /** No Confirmed Fact supports it for this product. */
  | "no_supporting_fact";

export type ListingV5BlockedExpression = {
  text: string;
  reason: ListingV5BlockedReason;
};

/** A conservative, fact-only shopper explanation admitted to the Writer. */
export type ListingV5ApprovedFactBenefit = {
  id: string;
  text: string;
  factIds: string[];
  kind: "semantic_benefit";
  source: "confirmed_fact";
  referenceOnly: true;
};

export type ListingV5BenefitExpression = {
  concept: string;
  /** The candidate's evidence ids, carried through untouched. */
  evidenceIds: string[];
  /**
   * Fact-anchored framing the Writer may use. Empty when no Confirmed Fact can
   * carry the concept — the layer never invents one.
   */
  safeExpressions: string[];
  /** Wording this concept tempts but must not use. */
  blockedExpressions: ListingV5BlockedExpression[];
  /** The Confirmed Facts the safe expressions are anchored to. */
  factIds: string[];
};

export type ListingV5BenefitExpressionSet = {
  version: typeof LISTING_V5_BENEFIT_EXPRESSION_VERSION;
  /** `candidates` when built from an evidence-backed candidate set, else `none`. */
  source: "candidates" | "none";
  expressions: ListingV5BenefitExpression[];
};

/* ── Concept tables ─────────────────────────────────────────────────────── */

/**
 * Concept → the Confirmed Fact fields that can honestly carry it. Mirrors the
 * existing `PAIN_RELIEF_FIELDS` / `ROLE_FIELD_PREFERENCE` convention: a concept
 * is only expressible through a fact that is actually about it.
 */
const CONCEPT_FACT_FIELDS: Record<string, readonly string[]> = {
  organization: ["included_components", "quantity_or_pack_size", "dimensions", "functional_feature", "product_type"],
  sipping: ["operation", "functional_feature", "included_components"],
  portability: ["weight", "dimensions", "operation", "included_components"],
  leak_resistance: ["construction", "material", "care", "certification_or_standard"],
  // Material alone describes what a product is made from; it does not prove
  // durability. Require an explicit construction or standard fact instead.
  durability: ["construction", "certification_or_standard"],
  size_fit: ["dimensions", "capacity", "compatibility"],
  // A pack count tells shoppers how many pieces arrive; it does not prove size,
  // volume or coverage. Keep quantity out of capacity framing.
  capacity: ["capacity", "dimensions"],
  ease_of_cleaning: ["care", "material", "construction"],
  // A component list cannot prove no assembly, no installation or readiness.
  ease_of_setup: ["operation"],
  appearance: ["color_or_variant", "material", "product_type"],
  color_accuracy: ["color_or_variant", "series_or_model"],
  value_for_money: ["quantity_or_pack_size", "included_components", "material"],
  gift_readiness: ["product_type", "included_components", "color_or_variant"],
};

/**
 * Concept → clause, composed ONLY from the Writer prompt's closed persuasion
 * vocabulary. Every entry is validated against `HARD_OR_ESCALATION_TOKENS` below
 * and dropped if it would introduce a hard-claim token.
 */
const CONCEPT_CLAUSE: Record<string, string> = {
  organization: "one less thing to think about",
  sipping: "simpler to use",
  portability: "easier to take along",
  leak_resistance: "confidently compare the details",
  durability: "gives a construction detail to compare",
  size_fit: "matches the space",
  capacity: "less guesswork",
  ease_of_cleaning: "tidier to keep up",
  ease_of_setup: "quicker to get started",
  appearance: "matches the look",
  color_accuracy: "matches the chosen colour",
  value_for_money: "saves a step when comparing",
  gift_readiness: "ready for giving",
};

/**
 * Concept → wording that would express it but that the copy must not reach for.
 * Whether an entry is actually blocked is decided per product: wording that the
 * Confirmed Facts already state verbatim is allowed, exactly as the Writer prompt
 * specifies for its own banned list.
 */
const CONCEPT_RISKY_WORDING: Record<string, readonly string[]> = {
  organization: ["clutter-free", "mess-free"],
  sipping: ["drip-free"],
  portability: ["ultra-light", "lightweight"],
  leak_resistance: ["leakproof", "spillproof", "waterproof", "leak", "spill", "sealed"],
  durability: ["durable", "durability", "lasting", "tough", "unbreakable", "heavy-duty", "sturdy"],
  size_fit: ["perfect fit", "universal fit", "sized for", "fits", "coverage", "covers"],
  capacity: ["maximum", "large"],
  ease_of_cleaning: ["dishwasher", "stain", "odor"],
  ease_of_setup: ["tool-free", "instant", "no setup", "no installation", "ready to use", "ready to place"],
  appearance: ["premium", "perfect", "matches every room", "fits every room"],
  color_accuracy: ["exact match", "matches every room", "fits every room"],
  value_for_money: ["cheap", "best value"],
  gift_readiness: ["perfect gift"],
};

const MAX_CONCEPTS = 12;
const MAX_EXPRESSIONS_PER_CONCEPT = 3;
const MAX_BLOCKED_PER_CONCEPT = 8;

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when the wording would introduce a hard-claim token the Validator rejects. */
function containsHardToken(value: string): boolean {
  return tokens(value).some((token) => HARD_OR_ESCALATION_TOKENS.has(token));
}

/**
 * Module-load guard: the clause table can only ever contain approved wording.
 * A clause that would carry a hard-claim token is removed, so the layer cannot
 * emit one even if the table above is edited carelessly.
 */
const SAFE_CLAUSES: ReadonlyMap<string, string> = new Map(
  Object.entries(CONCEPT_CLAUSE).filter(([, clause]) => !containsHardToken(clause)),
);

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function fieldsOf(fact: ListingV5Fact): string {
  return text(fact.canonicalField, 80).toLowerCase();
}

/** Wording the product's own Confirmed Facts already state verbatim. */
function factCorpus(facts: readonly ListingV5Fact[]): string {
  return facts.map((fact) => `${fact.canonicalField} ${fact.value}`).join(" ").toLowerCase();
}

/**
 * The only fact-to-benefit vocabulary admitted by the contract. These clauses
 * describe what a shopper can compare or understand from the confirmed value;
 * they do not assert performance, fit, setup, coverage or compatibility.
 */
const FACT_BENEFIT_BY_FIELD: Record<string, string> = {
  // These phrases are deliberately neutral. They are executable Writer
  // vocabulary, not explanations of the contract itself. Internal terms such
  // as "confirmed", "compare", and "gives shoppers" must stay out of the
  // serialized Provider projection.
  brand: "names the maker",
  product_type: "names the item type",
  material: "states the material",
  construction: "states the construction detail",
  capacity: "states the capacity",
  dimensions: "states the measured size",
  weight: "states the listed weight",
  color_or_variant: "states the visual variant",
  quantity_or_pack_size: "states the pack quantity",
  included_components: "lists what is included",
  functional_feature: "states the feature",
  compatibility: "states the compatibility detail",
  operation: "states the operation detail",
  care: "states the care detail",
  series_or_model: "identifies the model or series",
  certification_or_standard: "states the listed standard",
};

function factBenefitClause(field: string): string {
  return FACT_BENEFIT_BY_FIELD[field] ?? "states the product detail";
}

/**
 * Build one approved semantic benefit directly from a Confirmed Fact. This is
 * intentionally separate from reference-derived concepts: no strategy text is
 * copied and no product capability is inferred from a field value.
 */
export function buildApprovedFactBenefit(fact: ListingV5Fact): ListingV5ApprovedFactBenefit {
  const factId = text(fact.id, 120);
  const value = text(fact.value, 160) || "the product detail";
  const field = fieldsOf(fact);
  const benefit = {
    id: `fact-benefit:${factId}`,
    text: `${value} — ${factBenefitClause(field)}`,
    factIds: factId ? [factId] : [],
    kind: "semantic_benefit",
    source: "confirmed_fact",
    referenceOnly: true,
  } as ListingV5ApprovedFactBenefit;

  // Keep the full contract available to the in-memory Validator and Blueprint
  // adapters, while ensuring the Writer only receives executable projection
  // fields. JSON.stringify invokes toJSON before enumerating the object, so
  // internal metadata (source, kind, referenceOnly) and contract prose cannot
  // leak into the Provider payload.
  Object.defineProperty(benefit, "toJSON", {
    enumerable: false,
    value: () => ({ id: benefit.id, text: benefit.text, factIds: benefit.factIds }),
  });
  return benefit;
}

/** Stable id used when a Blueprint points at an approved fact benefit. */
export function approvedFactBenefitId(factId: string): string {
  return `fact-benefit:${text(factId, 120)}`;
}

/** Runtime guard used by every Provider-facing path before consuming a Blueprint. */
export function isSupportedListingV5Blueprint(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === LISTING_V5_SUPPORTED_BLUEPRINT_VERSION);
}

/**
 * One shared Provider payload projection. It deliberately starts from
 * Confirmed Facts rather than Strategy or Blueprint shopper text. A legacy or
 * malformed Blueprint receives no executable Benefits, so its old shopperValue
 * cannot be trusted by Recovery or Rewrite.
 */
export function buildApprovedBenefitsForPrompt(
  confirmedFacts: readonly ListingV5Fact[] | undefined,
  blueprint: unknown,
): ListingV5ApprovedFactBenefit[] {
  if (!isSupportedListingV5Blueprint(blueprint) || !Array.isArray(confirmedFacts)) return [];
  const seen = new Set<string>();
  return confirmedFacts
    .filter((fact): fact is ListingV5Fact => {
      if (!fact || typeof fact !== "object") return false;
      const id = text(fact?.id, 120);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(buildApprovedFactBenefit);
}

export type BenefitExpressionInput = {
  candidates: readonly ListingV5BenefitCandidate[] | undefined;
  confirmedFacts: readonly ListingV5Fact[];
  prohibitedClaims: readonly string[];
};

/**
 * Converts evidence-backed candidates into Writer-usable safe framing.
 *
 * A candidate is only converted when it still carries a resolvable evidence id
 * (acceptance: no evidence, no expression) and a Confirmed Fact can carry the
 * concept. Everything else is reported as blocked rather than invented.
 */
export function buildBenefitExpressions(input: BenefitExpressionInput): ListingV5BenefitExpressionSet {
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const facts = Array.isArray(input.confirmedFacts) ? input.confirmedFacts : [];
  const prohibited = (Array.isArray(input.prohibitedClaims) ? input.prohibitedClaims : [])
    .map((claim) => text(claim, 80).toLowerCase())
    .filter(Boolean);
  const corpus = factCorpus(facts);

  const expressions: ListingV5BenefitExpression[] = [];
  for (const candidate of candidates) {
    if (expressions.length >= MAX_CONCEPTS) break;
    const concept = text(candidate.concept, 60);
    const evidenceIds: string[] = (Array.isArray(candidate.evidenceIds) ? candidate.evidenceIds : []).filter(
      (id: unknown): id is string => typeof id === "string" && id.trim().length > 0,
    );
    // No citable evidence means no expression: this layer never manufactures one.
    if (!concept || evidenceIds.length === 0) continue;

    const clause = SAFE_CLAUSES.get(concept);
    const wantedFields = CONCEPT_FACT_FIELDS[concept] ?? [];
    const carryingFacts = clause
      ? facts.filter((fact) => wantedFields.includes(fieldsOf(fact)) && text(fact.value).length > 0)
      : [];

    const safeExpressions = carryingFacts
      .slice(0, MAX_EXPRESSIONS_PER_CONCEPT)
      .map((fact) => {
        // Keep the candidate concept's approved connective clause only when it
        // is itself conservative; the fact field still remains the authority.
        return `${text(fact.value, 160)} — ${clause}`;
      });

    const blockedExpressions: ListingV5BlockedExpression[] = [];
    for (const wording of CONCEPT_RISKY_WORDING[concept] ?? []) {
      if (blockedExpressions.length >= MAX_BLOCKED_PER_CONCEPT) break;
      const normalized = wording.toLowerCase();
      // Already stated verbatim by a Confirmed Fact → not blocked (writer-prompt rule).
      if (corpus.includes(normalized)) continue;
      const reason: ListingV5BlockedReason = prohibited.some((claim) => claim.includes(normalized))
        ? "prohibited_claim"
        : containsHardToken(normalized) ? "hard_claim_token" : "no_supporting_fact";
      blockedExpressions.push({ text: normalized, reason });
    }
    // A concept no fact can carry is reported explicitly instead of silently dropped.
    if (safeExpressions.length === 0 && blockedExpressions.length === 0) {
      blockedExpressions.push({ text: concept, reason: "no_supporting_fact" });
    }

    expressions.push({
      concept,
      evidenceIds,
      safeExpressions,
      blockedExpressions,
      factIds: carryingFacts.slice(0, MAX_EXPRESSIONS_PER_CONCEPT).map((fact) => fact.id),
    });
  }

  return {
    version: LISTING_V5_BENEFIT_EXPRESSION_VERSION,
    source: expressions.length > 0 ? "candidates" : "none",
    expressions,
  };
}

/** True when an expression set carries anything the Writer may actually use. */
export function hasUsableExpression(set: ListingV5BenefitExpressionSet | undefined): boolean {
  return (set?.expressions ?? []).some((entry) => entry.safeExpressions.length > 0);
}
