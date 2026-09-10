import { verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5Context, ListingV5Strategy, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

const words = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const normalize = (value: string) => words(value).join(" ");
const overlap = (candidate: string, reference: string) => {
  const a = words(candidate);
  const b = words(reference);
  for (let i = 0; i <= a.length - 12; i += 1) {
    const phrase = a.slice(i, i + 12).join(" ");
    if (normalize(reference).includes(phrase)) return phrase;
  }
  return null;
};

// ── Sentence counting ───────────────────────────────────────────────
// A naive split on [.!?] counted "YETI Rambler Jr. 12 oz ..." as two sentences,
// which made an otherwise valid description fail description_should_be_2_to_4_sentences.
// Intl.Segmenter already keeps "Jr." attached, but still breaks after title
// abbreviations such as "Mr." / "Dr.", so those fragments are merged back.

const NON_TERMINAL_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "jr", "sr", "st", "mt", "vs", "etc", "no", "inc", "ltd", "co", "corp", "dept", "est", "approx", "fig", "al",
]);

function endsWithNonTerminalAbbreviation(segment: string): boolean {
  const match = segment.match(/([A-Za-z][A-Za-z.]*)\.\s*$/);
  if (!match) return false;
  return NON_TERMINAL_ABBREVIATIONS.has(match[1]!.replace(/\./g, "").toLowerCase());
}

function segmentSentences(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const raw = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(trimmed)].map((item) => item.segment.trim()).filter(Boolean)
    : trimmed.split(/(?<=[.!?])\s+/).map((item) => item.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const part of raw) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && endsWithNonTerminalAbbreviation(previous)) merged[merged.length - 1] = `${previous} ${part}`;
    else merged.push(part);
  }
  return merged;
}

const sentenceCount = (value: string) => segmentSentences(value).length;

// ── Fact anchoring ─────────────────────────────────────────────────
// A confirmed fact value such as "dishwasher-safe bottle and lid" must still be
// anchored when the model writes "the bottle and lid are dishwasher-safe", and
// "dishwasher safe" must be accepted as a safe formatting variant. The same
// allowance must NOT let an escalation through ("dishwasher-safe at high heat")
// or an invented adjective that no confirmed fact supports ("durable steel").

const STOPWORDS = new Set(["a", "an", "the", "of", "for", "to", "and", "in", "on", "with", "is", "are", "that", "this", "it", "its", "as", "at", "by", "or", "be", "from"]);

/** Language that either asserts performance/certification or escalates an existing fact. */
const HARD_OR_ESCALATION_TOKENS = new Set([
  "durable", "durability", "lasting", "leakproof", "leak", "spillproof", "spill", "waterproof", "rustproof", "rust",
  "certified", "certification", "fda", "approved", "nontoxic", "toxic", "bpa", "scratch", "odor", "resistant", "resistance",
  "guarantee", "guaranteed", "unbreakable", "shatterproof", "tough", "strongest", "dishwasher", "safe", "foodsafe", "nonstick",
  "cold", "hot", "warm", "hour", "hours", "minute", "minutes", "overnight", "freeze", "frozen", "boil", "microwave",
  "bacteria", "mold", "insulated", "insulation",
  "high", "higher", "highest", "maximum", "max", "extreme", "ultra", "super", "heavy", "duty", "professional", "industrial",
  "perfect", "best", "most", "complete", "total", "fully", "always", "never", "only", "every", "all",
]);

const normalizeTokens = (value: string) => value
  .normalize("NFC")
  .toLowerCase()
  .replace(/[\u2010-\u2015\u2212]/g, "-")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(" ")
  .filter(Boolean);

const contentTokens = (value: string) => normalizeTokens(value).filter((token) => !STOPWORDS.has(token));

/** True when the segment introduces a hard/escalation token this fact value does not cover. */
function hasUncoveredHardToken(segmentTokens: Set<string>, valueSet: Set<string>): boolean {
  for (const token of segmentTokens) {
    if (!HARD_OR_ESCALATION_TOKENS.has(token)) continue;
    if (valueSet.has(token)) continue;
    return true;
  }
  return false;
}

/**
 * Anchored iff the segment restates a confirmed fact value — either the exact
 * (normalized) value appears or every token of the value appears — AND no hard
 * or escalation token is introduced that the value does not already cover.
 * That accepts "dishwasher safe" as a formatting variant of a confirmed
 * "dishwasher-safe bottle and lid" while still rejecting "durable stainless
 * steel" and "dishwasher-safe at high heat".
 */
function isAnchoredToConfirmedValue(segment: string, factValues: readonly string[]): boolean {
  const segmentTokens = new Set(normalizeTokens(segment));
  const normalizedSegment = normalizeTokens(segment).join(" ");
  for (const value of factValues) {
    const valueTokens = contentTokens(value);
    if (valueTokens.length === 0) continue;
    const valueSet = new Set(valueTokens);
    const containsValuePhrase = normalizedSegment.includes(valueTokens.join(" "));
    const hasAllValueTokens = valueTokens.every((token) => segmentTokens.has(token));
    if (!containsValuePhrase && !hasAllValueTokens) continue;
    if (hasUncoveredHardToken(segmentTokens, valueSet)) continue;
    return true;
  }
  return false;
}

// ── Keyword stuffing ───────────────────────────────────────────────
// The previous matcher used substring containment, so the single letter "a"
// matched inside "kids water bottle" and any normal listing looked stuffed.
// Matching is now phrase/token based.

const STOPWORD_ONLY = new Set([...STOPWORDS]);

function keywordPhrases(strategy: ListingV5Strategy): string[][] {
  const raw = [...strategy.keywordIntent.primary, ...strategy.keywordIntent.secondary];
  const phrases: string[][] = [];
  for (const term of raw) {
    const tokens = normalizeTokens(term);
    if (tokens.length === 0) continue;
    // A keyword made only of stopwords or single characters carries no stuffing signal.
    if (tokens.length === 1 && (STOPWORD_ONLY.has(tokens[0]!) || tokens[0]!.length < 3)) continue;
    phrases.push(tokens);
  }
  return phrases;
}

function countPhraseMatches(textTokens: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > textTokens.length) return 0;
  let count = 0;
  for (let i = 0; i + phrase.length <= textTokens.length; i += 1) {
    let matched = true;
    for (let j = 0; j < phrase.length; j += 1) {
      if (textTokens[i + j] !== phrase[j]) { matched = false; break; }
    }
    if (matched) count += 1;
  }
  return count;
}

function hasKeywordStuffing(strategy: ListingV5Strategy, draft: ListingV5WriterDraft): boolean {
  const titleTokens = normalizeTokens(draft.title.text);
  const phrases = keywordPhrases(strategy)
    // A keyword that is part of the product's own title (for example "water
    // bottle" inside the product identity) is expected in every bullet and is
    // not a stuffing signal.
    .filter((phrase) => countPhraseMatches(titleTokens, phrase) === 0);
  if (phrases.length === 0) return false;
  const titleBullets = normalizeTokens([draft.title.text, ...draft.bullets.map((item) => item.text)].join(" "));
  const bulletsOnly = normalizeTokens(draft.bullets.map((item) => item.text).join(" "));
  let total = 0;
  for (const phrase of phrases) {
    const inBullets = countPhraseMatches(bulletsOnly, phrase);
    // Repeating the same phrase four or more times inside the body is mechanical.
    if (inBullets >= 4) return true;
    total += countPhraseMatches(titleBullets, phrase);
  }
  return total > 8;
}

/**
 * A claim that sits in one text field and can be fixed by rewriting that field
 * (an invented adjective such as "durable") stays repairable. Anything that
 * touches certification, absolute promises, conflicting facts, unknown fact
 * ids, prohibited wording or competitor copy stays blocking.
 */
function isLocallyRepairableClaim(item: { text: string; reason: string }): boolean {
  return item.reason === "unclassified_factual_claim";
}

function locateDraftField(draft: ListingV5WriterDraft, segment: string): string {
  if (draft.title.text.includes(segment)) return "title";
  for (let index = 0; index < draft.bullets.length; index += 1) {
    if (draft.bullets[index]!.text.includes(segment)) return `bullets[${index}]`;
  }
  if (draft.description.text.includes(segment)) return "description";
  return "unknown";
}

const MAX_REPAIRABLE_CLAIMS = 4;
const MAX_REPAIRABLE_FIELDS = 3;
const MAX_REPAIR_TARGETS = 3;

export function validateListingV5Draft(context: ListingV5Context, strategy: ListingV5Strategy, draft: ListingV5WriterDraft): ListingV5ValidationResult {
  const allowed = new Set(context.confirmedFacts.map((fact) => fact.id));
  const titleIssues: string[] = [];
  if (!draft.title.text.trim()) titleIssues.push("title_empty");
  if (draft.title.factIds.some((id) => !allowed.has(id))) titleIssues.push("title_fact_id_not_allowed");
  const bulletResults = draft.bullets.map((bullet, index) => {
    const issues: string[] = [];
    if (!bullet.text.trim()) issues.push("empty_bullet");
    if (bullet.factIds.length === 0) issues.push("missing_confirmed_fact_anchor");
    if (bullet.factIds.some((id) => !allowed.has(id))) issues.push("bullet_fact_id_not_allowed");
    if (index > 0 && strategy.bulletAngles[index - 1]?.shopperValue === strategy.bulletAngles[index]?.shopperValue) issues.push("repeated_shopper_value");
    if (/\b(?:brand|material|color|quantity|product type)\s*:/i.test(bullet.text)) issues.push("field_label_stacking");
    return { valid: issues.length === 0, factIds: bullet.factIds, strategyRole: bullet.strategyRole, issues };
  });
  const descriptionIssues: string[] = [];
  if (!draft.description.text.trim()) descriptionIssues.push("description_empty");
  if (sentenceCount(draft.description.text) < 2 || sentenceCount(draft.description.text) > 4) descriptionIssues.push("description_should_be_2_to_4_sentences");
  if (normalize(draft.description.text) === normalize(draft.title.text)) descriptionIssues.push("description_repeats_title");
  const generationInput: ListingGenerationInput = {
    schema: "listing-generation-input.v1",
    source: { handoffRevision: context.handoffRevision, researchRevision: context.researchRevision },
    productFacts: context.confirmedFacts.map((fact) => ({ field: fact.id, label: fact.label, value: fact.value })),
    stableSourceFacts: [], creativeReferences: [], creativePreferences: {}, prohibitedClaims: context.prohibitedClaims,
    unknowns: context.unknowns, humanReviewRequired: true, researchMode: "market_research_only", promotionEligible: false,
  };
  const evidence = verifyListingClaims({
    source: "real_ai_draft", version: 1, generatedAt: new Date(0).toISOString(), model: "listing-v5-validator",
    humanReviewRequired: true, titles: [draft.title.text], bullets: draft.bullets.map((item) => item.text), description: draft.description.text,
    keywords: [], sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [],
  }, generationInput);
  const competitorOverlap = context.references.competitors.flatMap((ref) => {
    const hit = overlap([draft.title.text, ...draft.bullets.map((item) => item.text), draft.description.text].join(" "), ref.text);
    return hit ? [hit] : [];
  });
  // Existing Claim Evidence remains the authority for hard claims. V5 permits
  // only bounded connective shopper language: a segment is accepted when it
  // restates a confirmed value (normalized for case / hyphen / spacing
  // differences) or when every token of a confirmed value is present and no
  // unconfirmed hard / escalation token was introduced. Unknown, performance,
  // certification and prohibited reasons are never softened.
  // A fact anchor cannot vouch for every additional assertion in its sentence.
  const allowedValues = context.confirmedFacts.map((fact) => fact.value).filter(Boolean);
  const unsupportedDetails = evidence.unsupportedClaims
    .filter((item) => item.reason !== "unclassified_factual_claim"
      || !isAnchoredToConfirmedValue(item.text, allowedValues))
    .slice(0, 10)
    .map((item) => ({ text: item.text, reason: item.reason, field: locateDraftField(draft, item.text) }));
  const unsupportedClaims = unsupportedDetails.map((item) => item.text);
  const prohibitedClaims = evidence.prohibitedClaims.slice(0, 10);
  const keywordStuffing = hasKeywordStuffing(strategy, draft);
  const repetitive = new Set(draft.bullets.map((item) => normalize(item.text))).size !== draft.bullets.length;
  const mechanicalTemplate = draft.bullets.filter((item) => /^(?:with|this|the)\s/i.test(item.text)).length >= 4;
  const structuralIssues = titleIssues.length + bulletResults.filter((item) => !item.valid).length + descriptionIssues.length;

  // Blocking reasons are the ones that cannot be confined to one text field.
  const blockingClaims = prohibitedClaims.length + competitorOverlap.length
    + unsupportedDetails.filter((item) => !isLocallyRepairableClaim(item) || item.field === "unknown").length;
  const locallyRepairable = unsupportedDetails.filter((item) => isLocallyRepairableClaim(item) && item.field !== "unknown");
  const repairableFields = new Set(locallyRepairable.map((item) => item.field));
  const repairScopeTooBroad = locallyRepairable.length > MAX_REPAIRABLE_CLAIMS || repairableFields.size > MAX_REPAIRABLE_FIELDS;

  const structuralRepairTargets: string[] = [];
  bulletResults.forEach((result, index) => { if (!result.valid) structuralRepairTargets.push(`bullets[${index}]`); });
  if (titleIssues.length > 0) structuralRepairTargets.push("title");
  if (descriptionIssues.length > 0) structuralRepairTargets.push("description");
  const claimRepairTargets = locallyRepairable.map((item) => item.field).filter((field) => field !== "unknown");
  // One repair pass, at most three text fields, structural problems first.
  const repairTargets = [...new Set([...structuralRepairTargets, ...claimRepairTargets])].slice(0, MAX_REPAIR_TARGETS);

  const status = blockingClaims > 0 || repairScopeTooBroad
    ? "BLOCK"
    : locallyRepairable.length > 0 || structuralIssues > 0 || repetitive || keywordStuffing || mechanicalTemplate
      ? "REPAIRABLE"
      : "PASS";
  return {
    version: LISTING_V5_VALIDATION_VERSION, status,
    title: { valid: titleIssues.length === 0, issues: titleIssues }, bullets: bulletResults,
    description: { valid: descriptionIssues.length === 0, issues: descriptionIssues },
    claims: { allHaveEvidence: unsupportedClaims.length === 0 && prohibitedClaims.length === 0, unsupportedClaims, prohibitedClaims, competitorOverlap },
    quality: { repetitive, keywordStuffing, mechanicalTemplate },
    repair: { allowed: status === "REPAIRABLE" && repairTargets.length > 0, reason: status === "REPAIRABLE" ? "仅允许一次结构化修复" : null, targets: status === "REPAIRABLE" ? repairTargets : [] },
  };
}
