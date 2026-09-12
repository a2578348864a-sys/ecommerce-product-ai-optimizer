import { verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import { factAnchorValues } from "./context";
import { buildApprovedFactBenefit, type ListingV5ApprovedFactBenefit } from "./benefitExpression";
import { LISTING_V5_VALIDATION_VERSION } from "./types";
import {
  ABSOLUTE_HEAD_NOUNS,
  COPULA_ALLOWED_COMPLEMENTS,
  COPULA_NON_COMPLEMENTS,
  HARD_OR_ESCALATION_TOKENS as SHARED_HARD_OR_ESCALATION_TOKENS,
  MEASUREMENT_PARTICIPLES,
  MEASURE_HEAD_NOUNS,
  QUANTITY_QUANTIFIER_TOKENS,
  RELATIONAL_COMPLEMENTS,
  RESIDUAL_FIELD_NOUNS,
  RESIDUAL_QUALIFIERS,
  STOPWORDS,
  writerVocabulary,
} from "./claimVocabulary";
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

// ── Model / series codes ────────────────────────────────────────────
// A confirmed series/model value (BF140, GT035, YYJ-Lineshading-1305) is evidence for
// that exact token. The copula detector below captures only the leading letters of such
// a token ("BF140" becomes "bf") and then read that fragment as an invented adjective,
// which is why a confirmed model code was reported as an unsupported attribute.
// The same detector runs in reverse: a code-shaped token that no confirmed value covers
// is reported as unsupported_model_code instead of passing silently.
//
// Two deliberate narrowings, both production-safety driven:
//  - evidence comes ONLY from a fact whose canonical field is `series_or_model`;
//    "any confirmed value that looks like a code" was removed because it let unrelated
//    facts (a colour, a feature list) vouch for a code.
//  - a token counts as code-shaped only when it is a short uppercase alphanumeric
//    cluster (BF140, GT035) or a hyphenated multi-part code (YYJ-Lineshading-1305).
//    Ordinary listing text is excluded: ASINs, digit-leading sizes (16.4ft, 2XL, 3D),
//    single-letter prefixes (A100), common abbreviations (SKU123, ABC123, PRO5) and a
//    plain capitalised word plus a digit (Black2, Plastic5).

const MODEL_CODE_PATTERN = /(?:^|[^A-Za-z0-9-])([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)/g;
const ASIN_TOKEN = /^B0[A-Z0-9]{8}$/i;

/**
 * Leading letter runs that make a token ordinary listing text rather than a code:
 * common abbreviations and the colour / material / size words that routinely sit next
 * to a number.
 */
const NON_MODEL_PREFIXES = new Set([
  "a", "sku", "abc", "pro", "ref", "item", "code", "model", "size", "pack", "set", "count", "pcs", "pc", "upc", "ean",
  "color", "colour", "black", "white", "red", "blue", "green", "yellow", "orange", "pink", "purple", "brown", "grey", "gray",
  "wood", "wooden", "metal", "glass", "steel", "plastic", "fabric", "paper", "latex", "rubber", "ceramic", "resin", "acrylic",
  "small", "medium", "large", "led", "watt", "volt",
]);

function isModelCodeToken(token: string): boolean {
  if (token.length < 4) return false;
  if (!/^[A-Za-z]/.test(token)) return false;
  if (!/[0-9]/.test(token)) return false;
  if (ASIN_TOKEN.test(token)) return false;
  const leading = /^([A-Za-z]+)/.exec(token)?.[1] ?? "";
  // A single leading letter is a size or a section label, never a code ("A100").
  if (leading.length < 2) return false;
  if (NON_MODEL_PREFIXES.has(leading.toLowerCase())) return false;
  // A plain capitalised English word plus a digit is ordinary text ("Black2", "Plastic5").
  if (/^[A-Z][a-z]+$/.test(leading)) return false;
  return true;
}

function modelCodeTokensIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(MODEL_CODE_PATTERN)) {
    const token = match[1] ?? "";
    if (isModelCodeToken(token) && !found.includes(token)) found.push(token);
  }
  return found;
}

/** Case, hyphen and spacing insensitive form used for every code comparison. */
function normalizeModelCode(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Confirmed model evidence. ONLY a fact whose canonical field is `series_or_model`
 * counts: a value that merely looks like a code but is filed under another canonical
 * field is not model evidence. (The earlier "any code-looking confirmed value" fallback
 * was removed - it let unrelated facts vouch for a code.)
 */
function confirmedModelCodes(context: ListingV5Context): string[] {
  const codes = new Set<string>();
  for (const fact of context.confirmedFacts) {
    if (fact.canonicalField !== "series_or_model") continue;
    const value = typeof fact.value === "string" ? fact.value : "";
    if (value.trim()) codes.add(normalizeModelCode(value));
    for (const token of modelCodeTokensIn(value)) codes.add(normalizeModelCode(token));
  }
  return [...codes].filter(Boolean);
}

/**
 * The one promotion clause this change has to guard: telling the shopper to verify the
 * exact variant. It promises an outcome rather than restating a fact, so a confirmed
 * model code must not make the sentence around it anchorable.
 *
 * Deliberately narrow. A broader promotion guard (it would also catch "so you can", 
 * "made for", "helps you") was evaluated during the V5.6.x spikes and is NOT adopted
 * here: it changes verdicts this change was not authorised to change. It remains a
 * separate proposal.
 */
const EXACT_VARIANT_PROMOTION_PATTERNS: RegExp[] = [
  /\b(?:check|checks|checking|confirm|confirms|confirming|verify|verifies|verifying)\s+the\s+exact\s+variant\b/i,
];

/**
 * A benefit is allowed to clear the resolver's generic unsupported-claim
 * finding only when it is the exact deterministic clause emitted by the
 * approved fact-benefit contract. These words are deliberately only grammar
 * words; the field-specific nouns (material, compare, variant, pieces, set)
 * remain required below.
 */
const APPROVED_BENEFIT_GRAMMAR = new Set([
  "a", "an", "the", "for", "to", "of", "and", "in", "on", "with", "from", "by", "as", "into", "onto",
  "you", "your", "shoppers", "shopper", "users", "user", "it", "this", "that", "these", "those",
  "can", "may", "will", "must", "should", "would", "could", "do", "does", "did", "be", "been", "being",
  "gives", "give", "shows", "show", "clarifies", "clarify", "sets", "set", "states", "state", "explains", "explain",
  "helps", "help", "means", "makes", "make", "lets", "let", "allows", "allow", "knowing",
]);

const APPROVED_BENEFIT_DENIALS: readonly RegExp[] = [
  /\bno\s+(?:setup|installation)\b/i,
  /\bready\s+to\s+place\b/i,
  /\bfits?\s+every\s+room\b/i,
  /\bcovers?\s+(?:a\s+)?large\s+area\b/i,
];

function canonicalApprovedBenefits(
  context: ListingV5Context,
  supplied: readonly ListingV5ApprovedFactBenefit[] | undefined,
): ListingV5ApprovedFactBenefit[] {
  const canonicalById = new Map(context.confirmedFacts.map((fact) => [fact.id, buildApprovedFactBenefit(fact)] as const));
  const candidates = supplied === undefined ? [...canonicalById.values()] : supplied;
  return candidates.filter((candidate) => {
    if (!candidate || candidate.referenceOnly !== true || candidate.source !== "confirmed_fact" || candidate.kind !== "semantic_benefit") return false;
    if (!Array.isArray(candidate.factIds) || candidate.factIds.length !== 1) return false;
    const canonical = canonicalById.get(candidate.factIds[0]!);
    return canonical !== undefined
      && candidate.id === canonical.id
      && normalize(candidate.text) === normalize(canonical.text);
  });
}

function approvedBenefitClauseTokens(benefit: ListingV5ApprovedFactBenefit): string[] {
  const clause = benefit.text.split(" — ").slice(1).join(" — ");
  return words(clause).filter((token) => !APPROVED_BENEFIT_GRAMMAR.has(token));
}

/**
 * Returns true only for a sentence that contains a canonical confirmed value
 * and the corresponding approved semantic clause. Hard claims, uncovered
 * attributes, unknown model codes and explicit overreach phrases always keep
 * the sentence in the normal failure path.
 */
function isApprovedBenefitSegment(
  segment: string,
  context: ListingV5Context,
  approvedBenefits: readonly ListingV5ApprovedFactBenefit[],
  allowedValues: readonly string[],
  modelCodes: readonly string[],
): boolean {
  if (APPROVED_BENEFIT_DENIALS.some((pattern) => pattern.test(segment))) return false;
  const segmentTokens = new Set(normalizeTokens(segment));
  const allConfirmedTokens = new Set(allowedValues.flatMap((value) => contentTokens(value)));
  if (uncoveredHardTokens(segment, segmentTokens, allConfirmedTokens).length > 0) return false;
  if (uncoveredAttributeAssertions(segment, segmentTokens, allConfirmedTokens, modelCodes).length > 0) return false;
  // The model-code detector may split a hyphenated value differently from the
  // fact token set. The approved benefit still has to carry that exact model
  // fact; use the benefit's own value as the authority for this check.
  const segmentModels = modelCodeTokensIn(segment);

  return approvedBenefits.some((benefit) => {
    const fact = context.confirmedFacts.find((candidate) => candidate.id === benefit.factIds[0]);
    if (!fact) return false;
    if (segmentModels.length > 0 && segmentModels.some((token) => normalizeModelCode(token) !== normalizeModelCode(fact.value))) return false;
    const factValues = factAnchorValues(fact).flatMap((value) => contentTokens(value));
    if (factValues.length === 0 || !factValues.every((token) => segmentTokens.has(token))) return false;
    const clauseTokens = approvedBenefitClauseTokens(benefit);
    return clauseTokens.length > 0 && clauseTokens.every((token) => segmentTokens.has(token));
  });
}

function unbackedPromotionClauses(segment: string): string[] {
  const found: string[] = [];
  for (const pattern of EXACT_VARIANT_PROMOTION_PATTERNS) {
    const match = segment.match(pattern);
    const phrase = (match?.[0] ?? "").toLowerCase();
    if (phrase && !found.includes(phrase)) found.push(phrase);
  }
  return found;
}

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

/** Language that either asserts performance/certification or escalates an existing fact. */
const HARD_OR_ESCALATION_TOKENS = SHARED_HARD_OR_ESCALATION_TOKENS;

/**
 * The same hard-claim vocabulary, exposed read-only so upstream stages (the
 * Conversion Blueprint) can warn the Writer with exactly the words this
 * Validator rejects. Deriving it here keeps the two from drifting apart; it
 * changes no validation behaviour.
 */
export const LISTING_V5_HARD_CLAIM_TOKENS: ReadonlySet<string> = HARD_OR_ESCALATION_TOKENS;

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
 * V5.9 candidate — words that sit in the resolver's content-free sets yet still
 * assert a real attribute: "the surface is level", "the size is standard",
 * "a regular fit". Excluding them from the copula exemption keeps those cases on
 * the original `unsupported_attribute_assertion` path.
 *
 * A converged CANDIDATE, not a shipped rule change: persisting it needs its own
 * holdout plus a `LISTING_V5_VALIDATION_VERSION` bump, and that bump also
 * invalidates every persisted `contextFingerprint`.
 */
const COPULA_ATTRIBUTE_STRICT: ReadonlySet<string> = new Set(["level", "standard", "regular"]);

/**
 * The Writer prompt's closed PERSUASION list, matched at PHRASE level.
 *
 * Attribution over 40 real Writer drafts found that 57 of the 71 remaining
 * `unsupported_attribute_assertion` findings were the Writer using wording that
 * `WRITER_SYSTEM_PROMPT` explicitly authorises ("ready for", "one less thing to think
 * about", "simpler") — reported only because the copula pattern captures the first word
 * after the copula. `RELATIONAL_COMPLEMENTS` and the content-free residual sets are
 * already exempted on the same reasoning.
 *
 * Exempting those WORDS individually would be unsafe: a bare "one" / "less" is a real
 * quantity statement ("the organizer has one compartment"). The exemption therefore
 * requires the COMPLETE authorised phrase to appear in the segment.
 */
const AUTHORIZED_PERSUASION_PHRASES: readonly string[] = writerVocabulary().persuasion.map((phrase) => phrase.toLowerCase());

/**
 * True only when `word` is used inside a complete authorised persuasion phrase present in
 * this segment. Deliberately not a word-level test.
 */
function isAuthorizedPersuasionUse(word: string, segment: string): boolean {
  const padded = ` ${segment.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  return AUTHORIZED_PERSUASION_PHRASES.some(
    (phrase) => phrase.split(" ").includes(word) && padded.includes(` ${phrase} `),
  );
}

/**
 * True when a copula asserts an attribute that no confirmed value covers.
 *
 * A complement already present in a confirmed value only restates a fact
 * ("and it is hand wash only" against the confirmed care value "Hand Wash
 * Only"). A measurement participle does the same once the sentence carries a
 * confirmed numeric value. Everything else still counts, which keeps
 * "Steel is red", "is lightweight" and "is durable" rejected.
 */
function hasUncoveredAttributeAssertion(segment: string, segmentTokens: Set<string>, allConfirmedTokens: Set<string>, modelCodes: readonly string[] = []): boolean {
  return uncoveredAttributeAssertions(segment, segmentTokens, allConfirmedTokens, modelCodes).length > 0;
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
function uncoveredAttributeAssertions(segment: string, segmentTokens: Set<string>, allConfirmedTokens: Set<string>, modelCodes: readonly string[] = []): string[] {
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
      // The claim resolver defines both sets as content-free grammar material
      // (qualifiers with no factual content; field-metadata nouns that describe a
      // field's role, not a product attribute), so a copula cannot assert anything
      // factual through them. `RELATIONAL_COMPLEMENTS` is already exempted on the
      // same reasoning. The tiny strict list keeps the exceptions that DO assert a
      // real attribute on the original reporting path.
      if (RESIDUAL_QUALIFIERS.has(word) && !COPULA_ATTRIBUTE_STRICT.has(word)) continue;
      if (RESIDUAL_FIELD_NOUNS.has(word) && !COPULA_ATTRIBUTE_STRICT.has(word)) continue;
      // The Writer is instructed to use the PERSUASION list; reading it back as an
      // unsupported attribute assertion made the prompt and the Validator contradict each
      // other. The whole phrase must be present, so a bare quantity word stays reported.
      if (isAuthorizedPersuasionUse(word, segment)) continue;
      // A fragment of a confirmed model code ("bf" inside "BF140") is not an invented
      // adjective: the code itself is confirmed evidence. Same for the code's own
      // hyphenated parts, which the copula pattern truncates at the first digit.
      const codeWord = normalizeModelCode(word);
      if (codeWord.length >= 2 && modelCodes.some((code) => code === codeWord || code.startsWith(codeWord))) continue;
      if (hasConfirmedNumber && MEASUREMENT_PARTICIPLES.has(word)) continue;
      offenders.push(word);
    }
  }
  return offenders;
}

/**
 * Enumeration vs absolute reading of a hard-vocabulary token.
 *
 * A hard word can be a count quantifier ("the pack holds four pieces in total") or an
 * absolute claim modifier ("total coverage"). The token list alone cannot tell them
 * apart, which is why benign quantity wording was reported as a hard claim.
 *
 * The reading is decided from the token's immediate context, so the rule is reusable
 * for any vocabulary token instead of being an exception for one word:
 *   enumeration <- "in <token>", "a <token> of", "<token> of", "<token>: 4", "<token> 4",
 *                  "<token> pack size / pieces / count / quantity / weight / ..."
 *   absolute    <- "<token> coverage / protection / control / satisfaction / ...": an
 *                  absolute head noun always wins, so real claims keep being reported.
 */

function isQuantityEnumerationContext(segment: string, token: string): boolean {
  const match = new RegExp(`\\b${token}\\b`, "i").exec(segment);
  if (!match || match.index === undefined) return false;
  const before = segment.slice(0, match.index).toLowerCase();
  const after = segment.slice(match.index + match[0].length).toLowerCase();
  const nextWord = /^[^a-z0-9]*([a-z]+)/.exec(after)?.[1] ?? "";
  const previousWord = /([a-z]+)[^a-z0-9]*$/.exec(before)?.[1] ?? "";
  // An absolute head noun always wins: "total coverage" stays a hard claim.
  if (ABSOLUTE_HEAD_NOUNS.has(nextWord)) return false;
  // "in total", "a total of", "total of 4"
  if (previousWord === "in" || previousWord === "of" || (previousWord === "a" && nextWord === "of")) return true;
  if (nextWord === "of") return true;
  // "Total: 4 Pcs", "total 4 Pcs"
  if (/^\s*:?\s*\d/.test(after)) return true;
  // "total pack size", "total pieces", "total count", "total quantity"
  if (QUANTITY_QUANTIFIER_TOKENS.has(token) && MEASURE_HEAD_NOUNS.has(nextWord)) return true;
  return false;
}

/**
 * Hard/escalation tokens this segment introduces that no confirmed value covers.
 * A token read as a count quantifier is not an absolute claim and is not reported.
 */
function uncoveredHardTokens(segment: string, segmentTokens: Set<string>, confirmedTokens: Set<string>): string[] {
  const offenders: string[] = [];
  for (const token of segmentTokens) {
    if (!HARD_OR_ESCALATION_TOKENS.has(token)) continue;
    if (confirmedTokens.has(token)) continue;
    if (isQuantityEnumerationContext(segment, token)) continue;
    offenders.push(token);
  }
  return offenders;
}

/** True when the segment introduces a hard/escalation token this fact value does not cover. */
function hasUncoveredHardToken(segment: string, segmentTokens: Set<string>, valueSet: Set<string>): boolean {
  return uncoveredHardTokens(segment, segmentTokens, valueSet).length > 0;
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

function surfaceSpansForModelCodes(segment: string, tokens: readonly string[]): string[] {
  const spans: string[] = [];
  for (const word of segment.match(/[A-Za-z0-9][A-Za-z0-9'\u2019-]*/g) ?? []) {
    if (spans.length >= MAX_OFFENDING_SPANS) break;
    if (!tokens.some((token) => normalizeModelCode(token) === normalizeModelCode(word))) continue;
    if (!spans.includes(word)) spans.push(word.slice(0, MAX_OFFENDING_SPAN_LENGTH));
  }
  return spans;
}

/**
 * Bounded violation evidence for one failing sentence: which code fired and
 * which surface words carried it. Falls back to an empty span list when the
 * failure is not attributable to a specific word, so the repair step still
 * learns that the sentence (not a word) is the problem.
 */
function describeUnsupportedSegment(segment: string, allowedValues: readonly string[], modelCodes: readonly string[] = []): { issueCode: ListingV5IssueCode; offendingSpans: string[] } {
  const segmentTokens = new Set(normalizeTokens(segment));
  const allConfirmedTokens = new Set(allowedValues.flatMap((value) => contentTokens(value)));
  const hard = uncoveredHardTokens(segment, segmentTokens, allConfirmedTokens);
  const attributes = uncoveredAttributeAssertions(segment, segmentTokens, allConfirmedTokens, modelCodes);
  // Reverse detection: a model-shaped code the confirmed facts do not carry.
  const uncoveredModels = modelCodeTokensIn(segment).filter((token) => !modelCodes.includes(normalizeModelCode(token)));
  const offenders = new Set([...hard, ...attributes]);
  const issueCode: ListingV5IssueCode = hard.length > 0
    ? "unsupported_hard_claim"
    : uncoveredModels.length > 0
      ? "unsupported_model_code"
      : attributes.length > 0 ? "unsupported_attribute_assertion" : "unsupported_claim";
  return {
    issueCode,
    offendingSpans: issueCode === "unsupported_model_code"
      ? surfaceSpansForModelCodes(segment, uncoveredModels)
      : surfaceSpansForOffenders(segment, offenders),
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
function isAnchoredToConfirmedValue(segment: string, factValues: readonly string[], modelCodes: readonly string[] = []): boolean {
  const segmentTokens = new Set(normalizeTokens(segment));
  const normalizedSegment = normalizeTokens(segment).join(" ");
  const allConfirmedTokens = new Set(factValues.flatMap((value) => contentTokens(value)));
  // A confirmed model code legalises the code, never the sentence around it. When the
  // segment states such a code AND tells the shopper to verify the exact variant, the
  // code must not make the sentence anchorable - otherwise supporting a model code
  // would silently excuse the rest of its sentence. Note this can also keep a sentence
  // the resolver reported but anchoring previously excused; that is the intended
  // direction (strictness), never a release.
  const hasCoveredModelCode = modelCodeTokensIn(segment).some((token) => modelCodes.includes(normalizeModelCode(token)));
  if (hasCoveredModelCode && unbackedPromotionClauses(segment).length > 0) return false;
  for (const value of factValues) {
    const valueTokens = contentTokens(value);
    if (valueTokens.length === 0) continue;
    const valueSet = new Set(valueTokens);
    const containsValuePhrase = normalizedSegment.includes(valueTokens.join(" "));
    const hasAllValueTokens = valueTokens.every((token) => segmentTokens.has(token));
    if (!containsValuePhrase && !hasAllValueTokens) continue;
    if (hasUncoveredHardToken(segment, segmentTokens, allConfirmedTokens)) continue;
    if (hasUncoveredAttributeAssertion(segment, segmentTokens, allConfirmedTokens, modelCodes)) continue;
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
 * stays repairable. Anything that touches certification, absolute promises,
 * conflicting facts, unknown fact ids, prohibited wording or competitor copy
 * stays blocking.
 *
 * 2026-09-12 (measured on the real Case-D chain): the single-sentence, single-field
 * families below used to BLOCK, so a draft whose only defect was one benefit clause was
 * discarded outright and the deterministic fallback shipped instead — every strategy-
 * derived sentence in that draft was lost with it. Both observed failures were exactly
 * one sentence in one field: a confirmed fact expressed as an outcome ("A weighted base
 * helps the lamp stay in place…" → `unsupported_dimension_claim`) and a confirmed power
 * source expressed as compatibility ("USB-C powered, so it works with the cable already
 * on hand" → `unsupported_compatibility_claim`). They now get the same bounded repair
 * chance the "invented adjective" family always had.
 *
 * The exit gate is unchanged: a repaired draft is re-validated with these same rules,
 * and a draft that still fails falls back exactly as before. Certification, absolute
 * promises, conflicting facts, unknown fact ids, AI-reference facts and prohibited
 * wording remain blocking, because those are not a one-sentence wording problem.
 */
const LOCALLY_REPAIRABLE_REASONS: ReadonlySet<string> = new Set([
  "unclassified_factual_claim",
  "unsupported_numeric_claim",
  "unsupported_dimension_claim",
  "unsupported_compatibility_claim",
]);

function isLocallyRepairableClaim(item: { text: string; reason: string }): boolean {
  return LOCALLY_REPAIRABLE_REASONS.has(item.reason);
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

export function validateListingV5Draft(
  context: ListingV5Context,
  strategy: ListingV5Strategy,
  draft: ListingV5WriterDraft,
  approvedBenefits?: readonly ListingV5ApprovedFactBenefit[],
): ListingV5ValidationResult {
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
  // Confirmed series/model codes: evidence for their own exact token, and the only
  // thing that may keep a model-shaped code from being reported as unsupported.
  const modelCodes = confirmedModelCodes(context);
  // The default is derived from Confirmed Facts so existing callers remain
  // safe. A supplied list is accepted only after canonical re-validation
  // against the same fact-only contract; arbitrary semantic text is ignored.
  const canonicalBenefits = canonicalApprovedBenefits(context, approvedBenefits);
  const unsupportedDetails: ListingV5UnsupportedDetail[] = evidence.unsupportedClaims
    .filter((item) => !isApprovedBenefitSegment(item.text, context, canonicalBenefits, allowedValues, modelCodes)
      && (item.reason !== "unclassified_factual_claim"
        || !isAnchoredToConfirmedValue(item.text, allowedValues, modelCodes)))
    .slice(0, MAX_UNSUPPORTED_DETAILS)
    .map((item) => {
      const violation = describeUnsupportedSegment(item.text, allowedValues, modelCodes);
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
      if (isApprovedBenefitSegment(segment, context, canonicalBenefits, allowedValues, modelCodes)) continue;
      const violation = describeUnsupportedSegment(segment, allowedValues, modelCodes);
      if (APPROVED_BENEFIT_DENIALS.some((pattern) => pattern.test(segment))) {
        // Keep the richer hard/attribute classification whenever one exists;
        // this branch only supplies a finding for phrases such as "no setup"
        // that the generic detectors intentionally do not tokenize as claims.
        if (violation.issueCode !== "unsupported_claim") {
          scannedDetails.push({ text: segment, reason: "unclassified_factual_claim", field: entry.field, ...violation });
          continue;
        }
        scannedDetails.push({
          text: segment,
          reason: "unclassified_factual_claim",
          field: entry.field,
          issueCode: "unsupported_claim",
          offendingSpans: [],
        });
        continue;
      }
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
