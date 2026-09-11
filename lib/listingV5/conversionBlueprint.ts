/**
 * Listing V5 — Conversion Intelligence Layer (Phase 2/3).
 *
 * Turns the material the pipeline already has (Confirmed Facts + Strategy +
 * reference-only VOC / keyword / competitor observations) into one bounded,
 * deterministic Conversion Blueprint that the Writer receives before it writes:
 * buyer intent, pain points (with an explicit "no fact backs this" flag),
 * competitor gaps, one conversion angle, fact-anchored proof points and the
 * bullet benefit order.
 *
 * Hard rules kept intact:
 * - Confirmed Facts remain the only factual authority. Every proof point is a
 *   pointer at a Confirmed Fact; this module never invents a specification.
 * - VOC / keyword / competitor material stays UNTRUSTED_REFERENCE_DATA: it can
 *   shape framing and ordering, never a fact.
 * - No new agent, no provider call, no hidden state: the blueprint is a pure
 *   function of the frozen context and the strategy.
 * - Sourcing references are never read here.
 */
import type { ListingV5BulletRole, ListingV5Context, ListingV5Fact, ListingV5Strategy } from "./types";
import { HARD_OR_ESCALATION_TOKENS } from "./claimVocabulary";

export const LISTING_V5_CONVERSION_BLUEPRINT_VERSION = "listing-v5.conversion-blueprint.v1" as const;

export type ConversionPainPoint = {
  /** Shopper pain, taken from VOC reference data or the strategy (framing only). */
  pain: string;
  source: "voc" | "strategy";
  /** This text is reference material, never a product fact. */
  marker: "UNTRUSTED_REFERENCE_DATA";
  /** Confirmed facts that can honestly relieve this pain. Empty means: do not claim relief. */
  proofFactIds: string[];
  factBacked: boolean;
};

export type ConversionCompetitorGap = {
  /** Attribute both the competitor material and one of our facts talk about. */
  dimension: string;
  ourFactIds: string[];
  /** Bounded excerpt of the competitor observation, reference-only. */
  competitorSignal: string;
  marker: "UNTRUSTED_REFERENCE_DATA";
};

export type ConversionProofPoint = {
  factId: string;
  field: string;
  value: string;
  /** Deterministic shopper-benefit framing for this field (never a new fact). */
  shopperBenefit: string;
};

export type ConversionBenefitOrderItem = {
  role: ListingV5BulletRole;
  shopperValue: string;
  primaryFactId: string | null;
};

/**
 * V5.1 — the "why people buy" half of the blueprint. Every entry still points at
 * Confirmed Facts; nothing here can introduce a specification.
 */
export type ConversionPurchaseTrigger = {
  trigger: string;
  factBacked: boolean;
  factIds: string[];
};

export type ConversionObjectionHandling = {
  objection: string;
  resolution: string;
  factIds: string[];
};

export type ConversionBenefitPriority = {
  benefit: string;
  priority: number;
  factIds: string[];
};

/** The order in which the copy should walk a shopper through the decision. */
export const LISTING_V5_DECISION_SEQUENCE = ["use_scenario", "core_benefit", "proof", "risk_reduction"] as const;

export type ListingV5ConversionBlueprint = {
  version: typeof LISTING_V5_CONVERSION_BLUEPRINT_VERSION;
  referenceOnly: true;
  buyerIntent: {
    primary: string;
    secondary: string[];
    stage: "discovery" | "comparison" | "purchase_ready";
  };
  painPoints: ConversionPainPoint[];
  competitorGaps: ConversionCompetitorGap[];
  conversionAngle: { angle: string; whyItConverts: string };
  proofPoints: ConversionProofPoint[];
  benefitOrder: ConversionBenefitOrderItem[];
  /** Words this product has no fact for; the Writer must not reach for them. */
  disallowedTemptations: string[];
  /** V5.1 additions — all deterministic and bound to confirmed facts. */
  purchaseTriggers: ConversionPurchaseTrigger[];
  objectionHandling: ConversionObjectionHandling[];
  benefitPriority: ConversionBenefitPriority[];
  decisionSequence: string[];
};

const MAX_PAIN_POINTS = 6;
const MAX_PROOF_POINTS = 12;
const MAX_COMPETITOR_GAPS = 4;
const MAX_SECONDARY_INTENT = 5;
const MAX_GAP_SIGNAL_CHARS = 140;

/** Shopper-benefit framing per canonical fact field. Framing only — no new facts. */
const BENEFIT_BY_FIELD: Record<string, string> = {
  brand: "brand recognition helps shoppers decide quickly",
  product_type: "clear product type keeps the listing comparable in search",
  material: "material clarity answers the most common comparison question",
  construction: "construction detail explains how it is built",
  capacity: "capacity sets the right expectation before purchase",
  dimensions: "measurements remove fit guesswork",
  weight: "weight sets handling expectations",
  color_or_variant: "colour and variant match the planned look",
  quantity_or_pack_size: "pack size tells shoppers how much arrives",
  included_components: "knowing what is included means it can be used right away",
  functional_feature: "capability detail shows what the product does",
  compatibility: "compatibility detail prevents a wrong purchase",
  operation: "operation detail shows how easy it is to use",
  care: "care instructions set maintenance expectations",
  series_or_model: "model reference helps shoppers verify the exact variant",
  certification_or_standard: "stated standard is the evidence shoppers look for",
};

/**
 * Which confirmed-fact fields can honestly answer which shopper pain.
 * A pain with no matching field is reported as factBacked=false and the Writer
 * is told not to claim relief for it.
 */
const PAIN_RELIEF_FIELDS: Array<{ match: RegExp; fields: string[] }> = [
  { match: /\b(?:fit|fits|too (?:big|small)|size|sizing|dimension|space|storage|cabinet|drawer)\b/i, fields: ["dimensions", "capacity", "weight", "compatibility"] },
  { match: /\b(?:clean|cleaning|wash|washing|dishwasher|maintenance|care|stain|smell|odor)\b/i, fields: ["care", "material", "construction"] },
  { match: /\b(?:missing|arrive|arrives|quantity|count|pack|pieces|enough|short)\b/i, fields: ["quantity_or_pack_size", "included_components"] },
  { match: /\b(?:break|broke|brittle|flimsy|thin|cheap|wear|last|lasting|crack)\b/i, fields: ["material", "construction", "certification_or_standard"] },
  { match: /\b(?:color|colour|shade|match|variant|look)\b/i, fields: ["color_or_variant", "series_or_model"] },
  { match: /\b(?:setup|assemble|assembly|instruction|install|confus|difficult to use)\b/i, fields: ["operation", "included_components"] },
  { match: /\b(?:wrong|compatible|compatibility|does not work|doesn't work|refill)\b/i, fields: ["compatibility", "series_or_model"] },
  { match: /\b(?:price|value|expensive|worth)\b/i, fields: ["quantity_or_pack_size", "material"] },
];

/** Attribute vocabulary shared by competitor observations and our own facts. */
const ATTRIBUTE_LEXICON: Array<{ dimension: string; match: RegExp }> = [
  { dimension: "material:stainless steel", match: /stainless steel/i },
  { dimension: "material:plastic", match: /\bplastic\b/i },
  { dimension: "material:latex", match: /\blatex\b/i },
  { dimension: "material:rubber", match: /\brubber\b/i },
  { dimension: "material:silicone", match: /\bsilicone\b/i },
  { dimension: "material:glass", match: /\bglass\b/i },
  { dimension: "material:wood", match: /\b(?:wood|bamboo)\b/i },
  { dimension: "material:ceramic", match: /\bceramic\b/i },
  { dimension: "material:fabric", match: /\b(?:fabric|fleece|cotton|polyester|microfiber)\b/i },
  { dimension: "capacity", match: /\b\d+(?:\.\d+)?\s?(?:oz|ounce|ounces|ml|l|liter|liters|litre|litres|gallon|gallons|qt|quart)\b/i },
  { dimension: "dimensions", match: /\b\d+(?:\.\d+)?\s?(?:inch|inches|in\.|cm|mm|ft|feet|foot)\b/i },
  { dimension: "quantity", match: /\b\d+\s?(?:pack|pcs|pieces|count|ct|set|sets)\b/i },
  { dimension: "care", match: /\b(?:dishwasher|hand wash|wipe clean|machine wash)\b/i },
  { dimension: "compatibility", match: /\b(?:compatible|fits?|refill)\b/i },
];

/**
 * Performance / certification wording the Writer commonly reaches for. The list
 * is derived from the Validator's own hard-claim vocabulary so the warning the
 * Writer receives can never drift away from what the Validator actually
 * rejects; only the words no Confirmed Fact supports for this product remain.
 */
function disallowedTemptations(context: ListingV5Context): string[] {
  const factTokens = new Set(
    context.confirmedFacts
      .flatMap((fact) => `${fact.canonicalField} ${fact.value}`.toLowerCase().split(/[^a-z0-9]+/))
      .filter(Boolean),
  );
  // Declaration order is the Validator's own priority order (performance and
  // certification wording first), so the bounded list cannot truncate the words
  // a writer is most likely to reach for.
  return Array.from(HARD_OR_ESCALATION_TOKENS)
    .filter((token) => !factTokens.has(token))
    .slice(0, 48);
}

function clean(value: string, max = 200): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max);
}

function fieldOf(fact: ListingV5Fact): string {
  return fact.canonicalField.toLowerCase();
}

function benefitFor(field: string): string {
  return BENEFIT_BY_FIELD[field] ?? "confirmed detail shoppers can compare";
}

/** Reference text is untrusted and must never be able to steer the model. */
function stripControlText(value: unknown): string {
  if (typeof value !== "string") return "";
  return clean(value.replace(/(?:\bignore\s+(?:all\s+)?previous\s+instructions?|\bsystem\s*:|\bdeveloper\s*:|\bassistant\s*:|\boutput\s+fake)/gi, ""), 240);
}

/** Small local helper: never assume an optional strategy/context array exists. */
function list<T>(value: readonly T[] | undefined | null): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function intentStage(keywordIntent: ListingV5Strategy["keywordIntent"]): "discovery" | "comparison" | "purchase_ready" {
  const joined = [...keywordIntent.primary, ...keywordIntent.secondary, ...keywordIntent.backendOnly].join(" ").toLowerCase();
  if (/\b(?:best|vs|versus|compare|comparison|review|reviews|top)\b/.test(joined)) return "comparison";
  if (keywordIntent.primary.length === 0) return "discovery";
  return "purchase_ready";
}

function painPoints(context: ListingV5Context, strategy: ListingV5Strategy): ConversionPainPoint[] {
  const factsByField = new Map<string, ListingV5Fact[]>();
  for (const fact of context.confirmedFacts) {
    const key = fieldOf(fact);
    const list = factsByField.get(key) ?? [];
    list.push(fact);
    factsByField.set(key, list);
  }
  const candidates: Array<{ pain: string; source: "voc" | "strategy" }> = [];
  for (const reference of list(context.references?.voc)) {
    const [theme, ...rest] = reference.text.split(":");
    const pain = stripControlText(rest.join(":") || theme);
    if (pain) candidates.push({ pain, source: "voc" });
  }
  for (const pain of list(strategy.painPoints)) {
    const value = stripControlText(pain);
    if (value) candidates.push({ pain: value, source: "strategy" });
  }
  const seen = new Set<string>();
  const out: ConversionPainPoint[] = [];
  for (const candidate of candidates) {
    const key = candidate.pain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const fields = new Set<string>();
    for (const rule of PAIN_RELIEF_FIELDS) {
      if (rule.match.test(candidate.pain)) for (const field of rule.fields) fields.add(field);
    }
    const proofFactIds: string[] = [];
    for (const field of fields) {
      for (const fact of factsByField.get(field) ?? []) {
        if (!proofFactIds.includes(fact.id)) proofFactIds.push(fact.id);
      }
    }
    out.push({ pain: candidate.pain, source: candidate.source, marker: "UNTRUSTED_REFERENCE_DATA", proofFactIds: proofFactIds.slice(0, 3), factBacked: proofFactIds.length > 0 });
    if (out.length >= MAX_PAIN_POINTS) break;
  }
  return out;
}

function competitorGaps(context: ListingV5Context): ConversionCompetitorGap[] {
  const factText = context.confirmedFacts.map((fact) => ({ fact, haystack: `${fact.canonicalField} ${fact.value}`.toLowerCase() }));
  const out: ConversionCompetitorGap[] = [];
  const seen = new Set<string>();
  for (const reference of list(context.references?.competitors)) {
    for (const attribute of ATTRIBUTE_LEXICON) {
      if (!attribute.match.test(reference.text)) continue;
      const ourFactIds = factText.filter((entry) => attribute.match.test(entry.haystack)).map((entry) => entry.fact.id);
      if (ourFactIds.length === 0) continue;
      if (seen.has(attribute.dimension)) continue;
      seen.add(attribute.dimension);
      out.push({ dimension: attribute.dimension, ourFactIds: ourFactIds.slice(0, 3), competitorSignal: stripControlText(reference.text).slice(0, MAX_GAP_SIGNAL_CHARS), marker: "UNTRUSTED_REFERENCE_DATA" });
      if (out.length >= MAX_COMPETITOR_GAPS) break;
    }
    if (out.length >= MAX_COMPETITOR_GAPS) break;
  }
  return out;
}

function proofPoints(context: ListingV5Context): ConversionProofPoint[] {
  return list(context.confirmedFacts).slice(0, MAX_PROOF_POINTS).map((fact) => ({
    factId: fact.id,
    field: fact.canonicalField,
    value: fact.value,
    shopperBenefit: benefitFor(fieldOf(fact)),
  }));
}

const ROLE_FIELD_PREFERENCE: Record<ListingV5BulletRole, string[]> = {
  core_outcome: ["functional_feature", "product_type", "material", "capacity"],
  pain_relief: ["care", "quantity_or_pack_size", "included_components", "dimensions"],
  use_scenario: ["dimensions", "capacity", "weight", "compatibility"],
  ease_of_use: ["included_components", "operation", "functional_feature"],
  proof_or_fit: ["material", "dimensions", "compatibility", "certification_or_standard", "series_or_model"],
};

function benefitOrder(strategy: ListingV5Strategy, facts: readonly ListingV5Fact[]): ConversionBenefitOrderItem[] {
  const used = new Set<string>();
  return list(strategy.bulletAngles).slice(0, 5).map((angle) => {
    const preferred = ROLE_FIELD_PREFERENCE[angle.role] ?? [];
    const pick = (pool: readonly ListingV5Fact[]) => pool.find((fact) => !used.has(fact.id)) ?? null;
    let fact = pick(preferred.flatMap((field) => facts.filter((candidate) => fieldOf(candidate) === field)));
    if (!fact) fact = pick(facts);
    if (fact) used.add(fact.id);
    return { role: angle.role, shopperValue: clean(angle.shopperValue, 160) || "shopper value", primaryFactId: fact ? fact.id : null };
  });
}

/**
 * Why a shopper buys: the strategy's motivations and the fact-backed VOC pains,
 * each resolved against the confirmed facts that can honestly carry it. A
 * motivation no fact supports is reported with factBacked=false and no ids, so
 * the Writer can frame it but never claim it.
 */
function purchaseTriggers(context: ListingV5Context, strategy: ListingV5Strategy, pains: ConversionPainPoint[]): ConversionPurchaseTrigger[] {
  const out: ConversionPurchaseTrigger[] = [];
  const seen = new Set<string>();
  const push = (trigger: string, factIds: string[]) => {
    const key = trigger.toLowerCase();
    if (!trigger || seen.has(key)) return;
    seen.add(key);
    out.push({ trigger, factBacked: factIds.length > 0, factIds: factIds.slice(0, 3) });
  };
  for (const pain of pains) push(stripControlText(pain.pain), pain.proofFactIds);
  for (const motivation of list(strategy.purchaseMotivations)) {
    const value = stripControlText(motivation);
    if (!value) continue;
    const fields = new Set<string>();
    for (const rule of PAIN_RELIEF_FIELDS) {
      if (rule.match.test(value)) for (const field of rule.fields) fields.add(field);
    }
    const factIds = list(context.confirmedFacts).filter((fact) => fields.has(fieldOf(fact))).map((fact) => fact.id);
    push(value, factIds);
  }
  return out.slice(0, MAX_PAIN_POINTS);
}

/**
 * Objection handling only exists where a confirmed fact can answer the worry.
 * A worry no fact answers is deliberately absent: the copy must stay silent
 * rather than invent reassurance.
 */
function objectionHandling(pains: ConversionPainPoint[], points: ConversionProofPoint[]): ConversionObjectionHandling[] {
  const byId = new Map(points.map((point) => [point.factId, point]));
  return pains
    .filter((pain) => pain.factBacked && pain.proofFactIds.length > 0)
    .slice(0, MAX_PAIN_POINTS)
    .map((pain) => {
      const first = byId.get(pain.proofFactIds[0]!);
      const resolution = first
        ? `answer it with the confirmed ${first.field.replace(/_/g, " ")} detail (${first.shopperBenefit})`
        : "answer it with the confirmed detail already stated in the listing";
      return { objection: pain.pain, resolution, factIds: pain.proofFactIds.slice(0, 3) };
    });
}

/** Priority order for the benefits: the plan order first, then the remaining proof points. */
function benefitPriority(order: ConversionBenefitOrderItem[], points: ConversionProofPoint[]): ConversionBenefitPriority[] {
  const out: ConversionBenefitPriority[] = [];
  const used = new Set<string>();
  for (const item of order) {
    if (!item.primaryFactId) continue;
    const point = points.find((candidate) => candidate.factId === item.primaryFactId);
    if (!point) continue;
    used.add(point.factId);
    out.push({ benefit: point.shopperBenefit, priority: out.length + 1, factIds: [point.factId] });
  }
  for (const point of points) {
    if (used.has(point.factId)) continue;
    out.push({ benefit: point.shopperBenefit, priority: out.length + 1, factIds: [point.factId] });
  }
  return out.slice(0, MAX_PROOF_POINTS);
}

function conversionAngle(strategy: ListingV5Strategy, points: ConversionProofPoint[]): { angle: string; whyItConverts: string } {  const angle = clean(strategy.primaryAngle, 200) || "lead with the most verifiable product detail";
  const strongest = points[0];
  const why = strongest
    ? `leads with a confirmed ${strongest.field.replace(/_/g, " ")} detail, so the promise is checkable on the page`
    : "leads with a confirmed detail, so the promise is checkable on the page";
  return { angle, whyItConverts: why };
}

/** Pure, bounded, deterministic. Same context + strategy always yields the same blueprint. */
export function buildListingV5ConversionBlueprint(
  context: ListingV5Context,
  strategy: ListingV5Strategy,
): ListingV5ConversionBlueprint {
  const points = proofPoints(context);
  const intent = strategy.keywordIntent ?? { primary: [], secondary: [], backendOnly: [] };
  const pains = painPoints(context, strategy);
  const order = benefitOrder(strategy, list(context.confirmedFacts));
  return {
    version: LISTING_V5_CONVERSION_BLUEPRINT_VERSION,
    referenceOnly: true,
    buyerIntent: {
      primary: stripControlText(intent.primary[0] ?? context.productIdentity).slice(0, 160) || stripControlText(context.productIdentity).slice(0, 160),
      secondary: intent.secondary.slice(0, MAX_SECONDARY_INTENT).map((item) => clean(item, 120)).filter(Boolean),
      stage: intentStage(intent),
    },
    painPoints: pains,
    competitorGaps: competitorGaps(context),
    conversionAngle: conversionAngle(strategy, points),
    proofPoints: points,
    benefitOrder: order,
    disallowedTemptations: disallowedTemptations(context),
    purchaseTriggers: purchaseTriggers(context, strategy, pains),
    objectionHandling: objectionHandling(pains, points),
    benefitPriority: benefitPriority(order, points),
    decisionSequence: [...LISTING_V5_DECISION_SEQUENCE],
  };
}
