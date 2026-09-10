/**
 * Listing V5 — shared hard-claim vocabulary.
 *
 * Single source of truth for the wording that asserts performance, duration or
 * certification. The Validator rejects it (validation.ts) and the Conversion
 * Blueprint warns the Writer about exactly the same words (conversionBlueprint.ts),
 * so the two can never drift apart.
 *
 * This module is deliberately dependency-free: the route tests replace the
 * Validator module with a partial mock, and the shared vocabulary must keep
 * working there.
 */
export const HARD_OR_ESCALATION_TOKENS: ReadonlySet<string> = new Set([
  "durable", "durability", "lasting", "leakproof", "leak", "spillproof", "spill", "waterproof", "rustproof", "rust",
  "certified", "certification", "fda", "approved", "nontoxic", "toxic", "bpa", "scratch", "odor", "resistant", "resistance",
  "guarantee", "guaranteed", "unbreakable", "shatterproof", "tough", "strongest", "dishwasher", "safe", "foodsafe", "nonstick",
  "cold", "hot", "warm", "hour", "hours", "minute", "minutes", "overnight", "freeze", "frozen", "boil", "microwave",
  "bacteria", "mold", "insulated", "insulation",
  "high", "higher", "highest", "maximum", "max", "extreme", "ultra", "super", "heavy", "duty", "professional", "industrial",
  "perfect", "best", "most", "complete", "total", "fully", "always", "never", "only", "every", "all",
]);
