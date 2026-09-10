import { verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { factAnchorValues } from "./context";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import type { ListingV5Context, ListingV5IssueCode, ListingV5Strategy, ListingV5UnsupportedDetail, ListingV5ValidationResult, ListingV5WriterDraft } from "./types";

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
  // A measurement written without a space ("24oz") must tokenize exactly like
  // the spaced form ("24 oz"). Without this, a writer that restates a Confirmed
  // Fact verbatim could never anchor to it, because the fact tokenized to a
  // single "24oz" token while the copy produced "24" + "oz".
  .replace(/(\d)([a-z])/g, "$1 $2")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .split(" ")
  .filter(Boolean);

const contentTokens = (value: string) => normalizeTokens(value).filter((token) => !STOPWORDS.has(token));

// A confirmed value cannot vouch for an unrelated attribute. We retain normal
// shopper framing, but reject the common copular forms that introduce a new
// appearance, weight, size, compatibility or performance assertion (for
// example "Steel is red" or "Steel is lightweight").
//
// The article is a separate alternative, never an optional group: an optional
// "a|an|the" can backtrack and let the article itself be matched as the
// asserted adjective, which rejected every anchored sentence containing
// "is a" / "is the" (for example "... is a 24 oz bottle made for ...").
const COPULA_WORDS = "is|are|looks?|feels?|seems?|has|have";
const COPULA_ALLOWED_COMPLEMENTS = "made|designed|available|included|listed|shown|intended|suited|used|from";
/**
 * Function words that cannot be the adjective a copula asserts. A noun
 * homograph such as "a clean look that fits" would otherwise be read as the
 * verb "look" asserting "that"; the same shape covers "a look of the kitchen".
 */
const COPULA_NON_COMPLEMENTS = "that|which|who|whom|whose|of|for|in|on|at|and|or|but|with|to|as|by|near|over|under|into|onto|is|are|was|were|be|been|it|its|this|these|those|there";
/**
 * Relational nouns describe placement or purpose, not a product attribute, so
 * "each have a place" is idiomatic rather than a claim. Performance nouns
 * ("has a waterproof coating") are unaffected, and are additionally caught by
 * the hard-token rule.
 */
const RELATIONAL_COMPLEMENTS = new Set(["place", "places", "spot", "spots", "home", "role", "purpose", "use", "uses", "sense", "look", "looks", "feel", "way", "ways"]);
/**
 * Measurement participles only restate the size or weight the sentence has
 * already anchored to a confirmed numeric value. This is a deliberately tiny
 * closed set, not a general past-participle allowance.
 */
const MEASUREMENT_PARTICIPLES = new Set(["sized", "measured", "weighed"]);

/** Copula directly followed by a non-article adjective. */
const COPULA_BARE_ADJECTIVE = new RegExp(
  `\\b(?:${COPULA_WORDS})\\s+(?!(?:an?|the)\\b)(?!(?:${COPULA_ALLOWED_COMPLEMENTS})\\b)(?!(?:${COPULA_NON_COMPLEMENTS})\\b)([a-z][a-z-]*)`,
  "gi",
);
/** Copula followed by an article and then a non-allowed adjective. */
const COPULA_ARTICLE_ADJECTIVE = new RegExp(
  `\\b(?:${COPULA_WORDS})\\s+(?:an?|the)\\s+(?!(?:${COPULA_ALLOWED_COMPLEMENTS})\\b)(?!(?:${COPULA_NON_COMPLEMENTS})\\b)([a-z][a-z-]*)`,
  "gi",
);

/**
 * True when a copula asserts an attribute that no confirmed value covers.
 *
 * A complement already present in a confirmed value only restates a fact
 * ("and it is hand wash only" against the confirmed care value "Hand Wash
 * Only"). A measurement participle does the same once the sentence carries a
 * confirmed numeric value. Everything else still counts, which keeps
 * "Steel is red", "is lightweight" and "is durable" rejected.
 */
function hasUncoveredAttributeAssertion(segment: string, segmentTokens: Set<string>, allConfirmedTokens: Set<string>): boolean {
  return uncoveredAttributeAssertions(segment, segmentTokens, allConfirmedTokens).length > 0;
}

/**
 * The specific offenders, not just a yes/no verdict.
 *
 * Why this exists: a repair step that only receives the whole failing sentence
 * cannot tell which word actually failed, so it rewrites the sentence and keeps
 * the offending word (observed on a real case: "high-use" survived a repair
 * that had rewritten the rest of the sentence). The Validator already knows the
 * exact token, so it reports it instead of making the model guess.
 *
 * Deterministic and bounded: it is the same detector as the boolean verdict,
 * reading only the segment and the confirmed fact tokens.
 */
function uncoveredAttributeAssertions(segment: string, segmentTokens: Set<string>, allConfirmedTokens: Set<string>): string[] {
  const hasConfirmedNumber = [...segmentTokens].some((token) => /^\d+$/.test(token) && allConfirmedTokens.has(token));
  const offenders: string[] = [];
  for (const pattern of [COPULA_BARE_ADJECTIVE, COPULA_ARTICLE_ADJECTIVE]) {
    for (const match of segment.matchAll(pattern)) {
      const word = (match[1] ?? "").toLowerCase();
      if (!word) continue;
      if (allConfirmedTokens.has(word)) continue;
      // A hyphenated compound is covered when every part of it is a confirmed
      // token: "dishwasher-safe" restates the confirmed "dishwasher-safe bottle
      // and lid" even though the token set holds the split form.
      const parts = normalizeTokens(word);
      if (parts.length > 1 && parts.every((token) => allConfirmedTokens.has(token))) continue;
      if (RELATIONAL_COMPLEMENTS.has(word)) continue;
      if (hasConfirmedNumber && MEASUREMENT_PARTICIPLES.has(word)) continue;
      offenders.push(word);
    }
  }
  return offenders;
}

/** Hard/escalation tokens this segment introduces that no confirmed value covers. */
function uncoveredHardTokens(segmentTokens: Set<string>, confirmedTokens: Set<string>): string[] {
  const offenders: string[] = [];
  for (const token of segmentTokens) {
    if (!HARD_OR_ESCALATION_TOKENS.has(token)) continue;
    if (confirmedTokens.has(token)) continue;
    offenders.push(token);
  }
  return offenders;
}

/** True when the segment introduces a hard/escalation token this fact value does not cover. */
function hasUncoveredHardToken(segmentTokens: Set<string>, valueSet: Set<string>): boolean {
  return uncoveredHardTokens(segmentTokens, valueSet).length > 0;
}

const MAX_OFFENDING_SPANS = 6;
const MAX_OFFENDING_SPAN_LENGTH = 48;

/**
 * Maps offender tokens back onto the words that actually appear in the text, so
 * the repair step receives `high-use` rather than the bare token `high`.
 * Only words already present in the segment can be returned: the output is a
 * subset of the input text and can never introduce new content.
 */
function surfaceSpansForOffenders(segment: string, offenders: Set<string>): string[] {
  if (offenders.size === 0) return [];
  const spans: string[] = [];
  for (const word of segment.match(/[A-Za-z0-9][A-Za-z0-9'\u2019-]*/g) ?? []) {
    if (spans.length >= MAX_OFFENDING_SPANS) break;
    if (!normalizeTokens(word).some((token) => offenders.has(token))) continue;
    if (spans.includes(word)) continue;
    spans.push(word.slice(0, MAX_OFFENDING_SPAN_LENGTH));
  }
  return spans;
}

/**
 * Bounded violation evidence for one failing sentence: which code fired and
 * which surface words carried it. Falls back to an empty span list when the
 * failure is not attributable to a specific word, so the repair step still
 * learns that the sentence (not a word) is the problem.
 */
function describeUnsupportedSegment(segment: string, allowedValues: readonly string[]): { issueCode: ListingV5IssueCode; offendingSpans: string[] } {
  const segmentTokens = new Set(normalizeTokens(segment));
  const allConfirmedTokens = new Set(allowedValues.flatMap((value) => contentTokens(value)));
  const hard = uncoveredHardTokens(segmentTokens, allConfirmedTokens);
  const attributes = uncoveredAttributeAssertions(segment, segmentTokens, allConfirmedTokens);
  const offenders = new Set([...hard, ...attributes]);
  return {
    issueCode: hard.length > 0 ? "unsupported_hard_claim" : attributes.length > 0 ? "unsupported_attribute_assertion" : "unsupported_claim",
    offendingSpans: surfaceSpansForOffenders(segment, offenders),
  };
}

/**
 * Anchored iff the segment restates a confirmed fact value — either the exact
 * (normalized) value appears or every token of the value appears — AND no hard
 * or escalation token is introduced that the value does not already cover, AND
 * the copula does not assert an attribute no confirmed value covers.
 * That accepts "dishwasher safe" as a formatting variant of a confirmed
 * "dishwasher-safe bottle and lid" while still rejecting "durable stainless
 * steel" and "dishwasher-safe at high heat".
 */
function isAnchoredToConfirmedValue(segment: string, factValues: readonly string[]): boolean {
  const segmentTokens = new Set(normalizeTokens(segment));
  const normalizedSegment = normalizeTokens(segment).join(" ");
  const allConfirmedTokens = new Set(factValues.flatMap((value) => contentTokens(value)));
  for (const value of factValues) {
    const valueTokens = contentTokens(value);
    if (valueTokens.length === 0) continue;
    const valueSet = new Set(valueTokens);
    const containsValuePhrase = normalizedSegment.includes(valueTokens.join(" "));
    const hasAllValueTokens = valueTokens.every((token) => segmentTokens.has(token));
    if (!containsValuePhrase && !hasAllValueTokens) continue;
    if (hasUncoveredHardToken(segmentTokens, allConfirmedTokens)) continue;
    if (hasUncoveredAttributeAssertion(segment, segmentTokens, allConfirmedTokens)) continue;
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
/** Bound on the reported violation evidence, resolver-derived and scanned alike. */
const MAX_UNSUPPORTED_DETAILS = 10;

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
  const allowedValues = context.confirmedFacts.flatMap((fact) => factAnchorValues(fact)).filter(Boolean);
  const unsupportedDetails: ListingV5UnsupportedDetail[] = evidence.unsupportedClaims
    .filter((item) => item.reason !== "unclassified_factual_claim"
      || !isAnchoredToConfirmedValue(item.text, allowedValues))
    .slice(0, MAX_UNSUPPORTED_DETAILS)
    .map((item) => {
      const violation = describeUnsupportedSegment(item.text, allowedValues);
      return { text: item.text, reason: item.reason, field: locateDraftField(draft, item.text), ...violation };
    });
  // The upstream Claim Evidence resolver only reports a sentence when its own
  // (largely Chinese) risk vocabulary fires, so an English claim such as
  // "Leakproof lid keeps drinks secure all day." reached this validator
  // unflagged and passed: the hard-token / copula net below never saw it.
  // Every sentence of the draft is therefore scanned here, independently of
  // what the resolver reported, using the same detectors. Nothing about the
  // permission model changes - these are the validator's own findings.
  const alreadyFlagged = new Set(unsupportedDetails.map((item) => normalize(item.text)));
  const scannedDetails: ListingV5UnsupportedDetail[] = [];
  const draftSegments: Array<{ field: string; text: string }> = [
    { field: "title", text: draft.title.text },
    ...draft.bullets.map((bullet, index) => ({ field: `bullets[${index}]`, text: bullet.text })),
    { field: "description", text: draft.description.text },
  ];
  for (const entry of draftSegments) {
    for (const segment of segmentSentences(entry.text)) {
      if (scannedDetails.length >= MAX_UNSUPPORTED_DETAILS) break;
      const key = normalize(segment);
      if (!key || alreadyFlagged.has(key)) continue;
      alreadyFlagged.add(key);
      const violation = describeUnsupportedSegment(segment, allowedValues);
      // "unsupported_claim" means no offending word was identified, so the
      // sentence stays with the resolver-derived set only.
      if (violation.issueCode === "unsupported_claim") continue;
      scannedDetails.push({ text: segment, reason: "unclassified_factual_claim", field: entry.field, ...violation });
    }
  }
  const allDetails: ListingV5UnsupportedDetail[] = [...unsupportedDetails, ...scannedDetails].slice(0, MAX_UNSUPPORTED_DETAILS);
  const unsupportedClaims = allDetails.map((item) => item.text);
  const prohibitedClaims = evidence.prohibitedClaims.slice(0, 10);
  const keywordStuffing = hasKeywordStuffing(strategy, draft);
  const repetitive = new Set(draft.bullets.map((item) => normalize(item.text))).size !== draft.bullets.length;
  const mechanicalTemplate = draft.bullets.filter((item) => /^(?:with|this|the)\s/i.test(item.text)).length >= 4;
  const structuralIssues = titleIssues.length + bulletResults.filter((item) => !item.valid).length + descriptionIssues.length;

  // Blocking reasons are the ones that cannot be confined to one text field.
  const blockingClaims = prohibitedClaims.length + competitorOverlap.length
    + allDetails.filter((item) => !isLocallyRepairableClaim(item) || item.field === "unknown").length;
  const locallyRepairable = allDetails.filter((item) => isLocallyRepairableClaim(item) && item.field !== "unknown");
  const repairableFields = new Set(locallyRepairable.map((item) => item.field));
  const repairScopeTooBroad = locallyRepairable.length > MAX_REPAIRABLE_CLAIMS || repairableFields.size > MAX_REPAIRABLE_FIELDS;

  const structuralRepairTargets: string[] = [];
  bulletResults.forEach((result, index) => { if (!result.valid) structuralRepairTargets.push(`bullets[${index}]`); });
  if (titleIssues.length > 0) structuralRepairTargets.push("title");
  if (descriptionIssues.length > 0) structuralRepairTargets.push("description");
  const claimRepairTargets = locallyRepairable.map((item) => item.field).filter((field) => field !== "unknown");
  // One repair pass, at most three text fields, structural problems first.
  const repairTargets = [...new Set([...structuralRepairTargets, ...claimRepairTargets])].slice(0, MAX_REPAIR_TARGETS);

  // Copy-quality flags (repetitive / keywordStuffing / mechanicalTemplate) are
  // warnings, not fact-safety findings. They are still reported in `quality`
  // and surfaced for human review, but on their own they must not turn a
  // fact-safe, structurally valid draft into REPAIRABLE: there is no repair
  // target for them, so doing so could only ever force the honest fallback path
  // and throw away a usable AI listing. Only a locally repairable claim or a
  // structural problem makes a draft REPAIRABLE.
  const status = blockingClaims > 0 || repairScopeTooBroad
    ? "BLOCK"
    : locallyRepairable.length > 0 || structuralIssues > 0
      ? "REPAIRABLE"
      : "PASS";
  return {
    version: LISTING_V5_VALIDATION_VERSION, status,
    title: { valid: titleIssues.length === 0, issues: titleIssues }, bullets: bulletResults,
    description: { valid: descriptionIssues.length === 0, issues: descriptionIssues },
    claims: { allHaveEvidence: unsupportedClaims.length === 0 && prohibitedClaims.length === 0, unsupportedClaims, prohibitedClaims, competitorOverlap, unsupportedDetails: allDetails },
    quality: { repetitive, keywordStuffing, mechanicalTemplate },
    repair: { allowed: status === "REPAIRABLE" && repairTargets.length > 0, reason: status === "REPAIRABLE" ? "仅允许一次结构化修复" : null, targets: status === "REPAIRABLE" ? repairTargets : [] },
  };
}
