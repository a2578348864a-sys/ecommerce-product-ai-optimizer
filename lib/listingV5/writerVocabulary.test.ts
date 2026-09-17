import { describe, expect, it } from "vitest";
import { HARD_OR_ESCALATION_TOKENS, writerVocabulary } from "./claimVocabulary";
import { LISTING_V5_VALIDATION_VERSION, LISTING_V5_WRITER_PROMPT_VERSION } from "./types";
import { LISTING_V5_HARD_CLAIM_TOKENS } from "./validation";

/**
 * M3a locks one invariant: **the Writer is told at least everything the Validator
 * enforces**. Before M3a the prompt listed a slightly different vocabulary than the
 * hard-token rule, so the model could write a word the Validator would reject without
 * ever having been warned about it.
 *
 * These assertions must never be relaxed to make a prompt change pass. Reconciling the
 * remaining *semantic* differences is M3b (authorised separately, with a real holdout).
 */

/** BANNED VOCABULARY exactly as it shipped at writer prompt v4 (generation.ts:106). */
const HISTORICAL_BANNED_TERMS = [
  "durable", "durability", "lasting", "leakproof", "spill-proof", "waterproof",
  "rustproof", "certified", "certification", "FDA", "approved", "non-toxic",
  "toxic", "BPA", "scratch", "odor", "resistant", "guaranteed",
  "unbreakable", "shatterproof", "tough", "strongest", "dishwasher", "safe",
  "cold", "hot", "warm", "hour", "hours", "minute",
  "minutes", "overnight", "freeze", "boil", "microwave", "bacteria",
  "mold", "insulated", "insulation", "high", "higher", "highest",
  "maximum", "extreme", "ultra", "super", "heavy", "duty",
  "professional", "industrial", "perfect", "best", "most", "complete",
  "total", "fully", "always", "never", "only", "every",
  "all",
] as const;

/**
 * The M3a completion, in `HARD_OR_ESCALATION_TOKENS` declaration order. Pinned here as
 * the expected *result* so the test fails loudly if the derivation silently changes;
 * the production derivation itself reads the hard-token set and is never hand-written.
 */
const M3A_EXPECTED_ADDITIONS = [
  "leak", "rust", "resistance", "guarantee", "foodsafe", "nonstick", "frozen", "max",
] as const;

/** Same normalisation the derivation uses: a term covers its whole and its word forms. */
function coverageKeys(term: string): string[] {
  return [term.toLowerCase().replace(/[-\s]+/g, ""), ...term.toLowerCase().split(/[-\s]+/)];
}

function coveredKeys(terms: readonly string[]): Set<string> {
  const covered = new Set<string>();
  for (const term of terms) for (const key of coverageKeys(term)) covered.add(key);
  return covered;
}

describe("writerVocabulary (M3a: Writer vocabulary ⊇ Validator hard tokens)", () => {
  it("announces every Validator hard token to the Writer (difference is empty)", () => {
    const covered = coveredKeys(writerVocabulary().bannedUnlessFactBacked);
    const unannounced = [...HARD_OR_ESCALATION_TOKENS].filter((token) => !covered.has(token));
    expect(unannounced).toEqual([]);
  });

  it("keeps every historical banned term, in its original order, ahead of the additions", () => {
    const banned = writerVocabulary().bannedUnlessFactBacked;
    expect(banned.length).toBeGreaterThanOrEqual(HISTORICAL_BANNED_TERMS.length);
    expect(banned.slice(0, HISTORICAL_BANNED_TERMS.length)).toEqual([...HISTORICAL_BANNED_TERMS]);
  });

  it("adds exactly the hard tokens the historical prompt was missing", () => {
    const added = writerVocabulary().bannedUnlessFactBacked.slice(HISTORICAL_BANNED_TERMS.length);
    expect(added).toEqual([...M3A_EXPECTED_ADDITIONS]);
    // Every addition must be a real registered hard token, never an invented one.
    for (const token of added) expect(HARD_OR_ESCALATION_TOKENS.has(token)).toBe(true);
    // …and the whole set must equal what an independent re-derivation produces.
    const covered = coveredKeys(HISTORICAL_BANNED_TERMS);
    expect(added).toEqual([...HARD_OR_ESCALATION_TOKENS].filter((token) => !covered.has(token)));
  });

  it("never promotes hyphen-split fragments (non / proof) into standalone hard tokens", () => {
    // "non-toxic" and "spill-proof" split into non/toxic and spill/proof, but only the
    // glued forms are registered hard tokens, so only those may be reasoned about.
    expect(HARD_OR_ESCALATION_TOKENS.has("non")).toBe(false);
    expect(HARD_OR_ESCALATION_TOKENS.has("proof")).toBe(false);
    expect(HARD_OR_ESCALATION_TOKENS.has("nontoxic")).toBe(true);
    expect(HARD_OR_ESCALATION_TOKENS.has("spillproof")).toBe(true);
    const added = writerVocabulary().bannedUnlessFactBacked.slice(HISTORICAL_BANNED_TERMS.length);
    expect(added).not.toContain("non");
    expect(added).not.toContain("proof");
  });

  it("keeps the Validator's hard-token view identical", () => {
    // M3a changed only what the Writer is told; the hard-token rule itself is untouched.
    // The Validator version has since moved to v5 for the copula exemption (V5.9 + A),
    // which changes verdicts but still leaves `HARD_OR_ESCALATION_TOKENS` alone.
    expect([...LISTING_V5_HARD_CLAIM_TOKENS]).toEqual([...HARD_OR_ESCALATION_TOKENS]);
    expect(LISTING_V5_HARD_CLAIM_TOKENS).toBe(HARD_OR_ESCALATION_TOKENS);
    expect(LISTING_V5_VALIDATION_VERSION).not.toBe("listing-v5.validation.v4");
  });

  it("moves the Writer prompt version off v4, because the prompt text changed", () => {
    expect(LISTING_V5_WRITER_PROMPT_VERSION).not.toBe("listing-v5-writer.v4");
  });

  it("exposes the persuasion and never-invent tables unchanged", () => {
    const vocab = writerVocabulary();
    expect(vocab.persuasion).toHaveLength(11);
    expect(vocab.neverInvent).toHaveLength(17);
    expect(Object.keys(vocab).sort()).toEqual(["bannedUnlessFactBacked", "neverInvent", "persuasion"]);
  });
});
