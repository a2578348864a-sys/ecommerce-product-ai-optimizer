import type {
  ListingV5BoundConclusion,
  ListingV5Context,
  ListingV5EvidenceBinding,
  ListingV5EvidenceStrength,
  ListingV5Reference,
} from "./types";
import { LISTING_V5_EVIDENCE_BINDING_VERSION } from "./types";

/**
 * Listing V5 — Evidence Binding (auditability layer, hard-bounded).
 *
 * Restores the link between a strategy conclusion and the research reference it
 * came from. It exists because the context projection used to flatten VOC /
 * keyword / competitor references into bare strings, which destroyed the
 * evidence identity and made "what is this claim based on?" unanswerable.
 *
 * Hard rules (do not relax):
 * - Pure function of the frozen context + the ids the provider declared.
 *   No provider call, no clock, no randomness, no I/O, no stored state.
 * - It NEVER participates in the Validator's PASS / REPAIRABLE / BLOCK decision
 *   and never touches listing copy. It only labels strategy conclusions.
 * - It can only DOWNGRADE a conclusion (`evidence_bound` -> `ai_suggestion`),
 *   never promote one, so it cannot make the pipeline more permissive.
 * - An id binds only when it resolves to a reference that is actually present in
 *   the frozen context. This is the specific defence against the fixed-string
 *   anti-pattern this repo already shipped once: `listingPlan.ts` wired an
 *   `evidenceRefs` field and then filled it with the constant `"ev:voc"`.
 */

/** A reference that carries a real, upstream-derived identity. */
export type ListingV5EvidenceIndexEntry = {
  evidenceId: string;
  sourceType: ListingV5Reference["sourceType"];
  evidenceRef: string;
  strength: ListingV5EvidenceStrength;
  count: number;
};

/** One strategy conclusion as produced by the strategy stage. */
export type StrategyConclusionInput = {
  field: string;
  text: string;
  evidenceIds: readonly string[];
};

/** Bounded so a pathological provider response cannot inflate the snapshot. */
const MAX_INDEX_ENTRIES = 64;
const MAX_CONCLUSIONS = 64;
const MAX_IDS_PER_CONCLUSION = 8;

function text(value: unknown, max = 240): string {
  return typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function normalizeStrength(value: unknown): ListingV5EvidenceStrength {
  return value === "isolated" || value === "weak" || value === "recurring" ? value : "unknown";
}

/**
 * Index of every reference in the frozen context that has a real evidence
 * identity. A reference without `evidenceId` (legacy context, or an upstream
 * value that was missing) simply cannot be cited — it does not get an invented
 * id here.
 *
 * `sourcing` is deliberately not indexed: sourcing candidates are excluded from
 * the marketing strategy input by contract (`listingV5.test.ts` asserts the
 * stream stays empty).
 */
export function buildEvidenceIndex(context: ListingV5Context): Map<string, ListingV5EvidenceIndexEntry> {
  const index = new Map<string, ListingV5EvidenceIndexEntry>();
  const streams: ReadonlyArray<readonly ListingV5Reference[]> = [
    context.references.voc,
    context.references.keywords,
    context.references.competitors,
  ];
  for (const stream of streams) {
    for (const reference of stream) {
      if (index.size >= MAX_INDEX_ENTRIES) break;
      const evidenceId = text(reference.evidenceId, 160);
      if (!evidenceId || index.has(evidenceId)) continue;
      index.set(evidenceId, {
        evidenceId,
        sourceType: reference.sourceType,
        evidenceRef: text(reference.evidenceRef, 200),
        strength: normalizeStrength(reference.strength),
        count: typeof reference.count === "number" && Number.isFinite(reference.count) && reference.count > 0
          ? Math.trunc(reference.count)
          : 0,
      });
    }
  }
  return index;
}

function resolveIds(
  raw: readonly string[],
  index: ReadonlyMap<string, ListingV5EvidenceIndexEntry>,
): { resolved: string[]; unresolved: string[] } {
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const candidate of raw.slice(0, MAX_IDS_PER_CONCLUSION)) {
    const id = text(candidate, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (index.has(id)) resolved.push(id);
    else unresolved.push(id);
  }
  return { resolved, unresolved };
}

/**
 * Label every conclusion as `evidence_bound` or `ai_suggestion`.
 *
 * A conclusion is only bound when at least one declared id resolves. An
 * unresolvable id is never reported as a binding: it is kept in
 * `unresolvedEvidenceIds` so the audit can see the provider invented it.
 * Conclusion text is never rewritten, added to or removed here.
 */
export function bindStrategyConclusions(
  conclusions: readonly StrategyConclusionInput[],
  index: ReadonlyMap<string, ListingV5EvidenceIndexEntry>,
  source: "provider" | "deterministic",
): ListingV5EvidenceBinding {
  const bound: ListingV5BoundConclusion[] = [];
  let boundCount = 0;
  for (const conclusion of conclusions) {
    if (bound.length >= MAX_CONCLUSIONS) break;
    const conclusionText = text(conclusion.text);
    if (!conclusionText) continue;
    const { resolved, unresolved } = resolveIds(conclusion.evidenceIds, index);
    const status = resolved.length > 0 ? "evidence_bound" : "ai_suggestion";
    if (status === "evidence_bound") boundCount += 1;
    bound.push({
      field: text(conclusion.field, 60),
      text: conclusionText,
      status,
      // An `ai_suggestion` never carries ids, so a caller cannot mistake an
      // unresolved id for a citation.
      evidenceIds: status === "evidence_bound" ? resolved : [],
      unresolvedEvidenceIds: unresolved,
    });
  }
  return {
    version: LISTING_V5_EVIDENCE_BINDING_VERSION,
    source,
    bound: boundCount,
    suggestions: bound.length - boundCount,
    total: bound.length,
    conclusions: bound,
  };
}

/** Cheap operator-facing summary; counts only, never conclusion text. */
export function summarizeEvidenceBinding(binding: ListingV5EvidenceBinding | undefined): {
  total: number;
  bound: number;
  suggestions: number;
  resolvedEvidenceIds: number;
  unresolvedEvidenceIds: number;
} {
  if (!binding) return { total: 0, bound: 0, suggestions: 0, resolvedEvidenceIds: 0, unresolvedEvidenceIds: 0 };
  const resolved = new Set<string>();
  const unresolved = new Set<string>();
  for (const conclusion of binding.conclusions) {
    for (const id of conclusion.evidenceIds) resolved.add(id);
    for (const id of conclusion.unresolvedEvidenceIds) unresolved.add(id);
  }
  return {
    total: binding.total,
    bound: binding.bound,
    suggestions: binding.suggestions,
    resolvedEvidenceIds: resolved.size,
    unresolvedEvidenceIds: unresolved.size,
  };
}
