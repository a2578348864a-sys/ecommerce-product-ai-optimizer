import { HARD_OR_ESCALATION_TOKENS } from "./claimVocabulary";
import type { ListingV5WriterDraft } from "./types";

/**
 * backendSearchTerms is the one Writer field no Validator rule inspects, and it
 * ships straight to the client, so every path that produces a draft must apply the
 * same boundary: a keyword list must not be able to smuggle a hard claim
 * (waterproof / leakproof / insulated / heavy-duty ...) past the copy rules.
 *
 * The rule was introduced in `conversionRewrite.ts` for the rewrite path only. The
 * 2026-09 closeout found the Writer normalization and the deterministic fallback
 * both bypassed it, so the check now lives here and every draft-producing path
 * imports it instead of re-implementing it.
 */
export function filterListingV5BackendSearchTerms(draft: ListingV5WriterDraft): ListingV5WriterDraft {
  const terms = (draft.backendSearchTerms ?? []).filter((term) => {
    // An empty entry has no tokens, so a token-only check would keep it and ship a
    // blank keyword. Blank entries carry no claim, but they are still field junk.
    const trimmed = term.trim();
    if (!trimmed) return false;
    const tokens = trimmed.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.every((token) => !HARD_OR_ESCALATION_TOKENS.has(token));
  });
  return { ...draft, backendSearchTerms: terms.slice(0, 12) };
}
