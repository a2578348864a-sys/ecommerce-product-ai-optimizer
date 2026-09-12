import type { ListingV5ExecutionTrace } from "./trace";
import type { ListingV5ConversionBlueprint } from "./conversionBlueprint";
import type { ListingV5QualityEvaluation } from "./qualityEvaluation";

export const LISTING_V5_CONTEXT_VERSION = "listing-v5.context.v1" as const;
export const LISTING_V5_STRATEGY_VERSION = "listing-v5.strategy.v1" as const;
export const LISTING_V5_WRITER_VERSION = "listing-v5.writer-draft.v1" as const;
/**
 * v5 exempts the content-free residual sets and the Writer's own authorised persuasion
 * phrases from the copula attribute rule (`validation.ts`), keeping `level` / `standard` /
 * `regular` and bare quantity wording on the reporting path. This changes verdicts, so the
 * version must move: it is hashed into `contextFingerprint` (`context.ts:224`), which makes
 * previously persisted Listing V5 snapshots stale.
 * v6 makes the single-sentence, single-field claim families (numeric / dimension /
 * compatibility) locally repairable instead of blocking, so one benefit clause no longer
 * discards a whole AI draft for the deterministic fallback. The exit gate is unchanged:
 * certification, absolute promises, conflicts, unknown fact ids, AI-reference facts and
 * prohibited wording stay blocking, and a repaired draft is re-validated before it ships.
 */
export const LISTING_V5_VALIDATION_VERSION = "listing-v5.validation.v6" as const;
/**
 * v5 requires an `evidenceIds` list per strategy conclusion (Evidence Binding).
 * v6 adds the FRAMING VOCABULARY rule: strategy framing must be expressible with the
 * supplied confirmed-fact vocabulary, never as a promised outcome and never with an
 * adjective no fact states. Measured reason: an outcome-phrased `bulletAngles.shopperValue`
 * reached the Writer copy and was rejected as an unsupported dimension claim, which
 * blocked the whole AI draft in favour of the deterministic fallback.
 */
export const LISTING_V5_STRATEGY_PROMPT_VERSION = "listing-v5-strategy.v6" as const;
/**
 * v4 adds the Conversion Blueprint to the Writer input (conversion intelligence layer).
 * v5 aligns the Writer's banned vocabulary with the Validator's hard-token set: the M3a
 * completion appends every hard token the historical prompt never listed (derived in
 * claimVocabulary.ts from HARD_OR_ESCALATION_TOKENS, never hand-written). The prompt
 * text changes, so `contextFingerprint` changes and previously persisted Listing V5
 * snapshots become stale by design.
 * v6 states the benefit boundary the Validator already enforced (a benefit is the plain
 * meaning of the fact, never a physical outcome or an unstated size adjective) and stops
 * the Writer from copying a strategy phrase that promises an outcome.
 */
export const LISTING_V5_WRITER_PROMPT_VERSION = "listing-v5-writer.v6" as const;
export const LISTING_V5_REPAIR_PROMPT_VERSION = "listing-v5-repair.v3" as const;

export type ListingV5Reference = {
  text: string;
  /** The evidence source. This IS the `source` of the reference; no duplicate field. */
  sourceType: "VOC" | "keyword" | "competitor" | "sourcing";
  marker: "UNTRUSTED_REFERENCE_DATA";
  notProductFact: true;
  /**
   * Evidence Binding (additive, all optional so older snapshots and test
   * literals keep working).
   *
   * `evidenceId` is the stable identity of the research reference this text came
   * from. It is derived from the Evidence layer (never from an array index and
   * never a constant), so a strategy conclusion that cites it can be traced back
   * to a real observation. See `lib/listingV5/evidenceBinding.ts`.
   */
  evidenceId?: string;
  /** Human-readable provenance (`ev:voc:...` / `ev:keyword:...` / `ev:competitor:...`). */
  evidenceRef?: string;
  /** Evidence strength straight from the Evidence layer, not re-derived here. */
  strength?: ListingV5EvidenceStrength;
  /** Observations behind the reference (VOC review count). */
  count?: number;
  /** The text was clipped by the context character budget. */
  textTruncated?: boolean;
};

export type ListingV5EvidenceStrength = "isolated" | "weak" | "recurring" | "unknown";

export const LISTING_V5_EVIDENCE_BINDING_VERSION = "listing-v5.evidence-binding.v1" as const;

/**
 * `evidence_bound`: the conclusion cites at least one id that resolves to a
 * reference actually present in the frozen context.
 * `ai_suggestion`: it cites none, or only ids that resolve to nothing. It stays
 * available as framing but is never presented as backed by research.
 */
export type ListingV5EvidenceStatus = "evidence_bound" | "ai_suggestion";

export type ListingV5BoundConclusion = {
  field: string;
  text: string;
  status: ListingV5EvidenceStatus;
  /** Resolved ids only. Always empty when status is `ai_suggestion`. */
  evidenceIds: string[];
  /** Ids the provider claimed that do not exist in the frozen context (audit trail). */
  unresolvedEvidenceIds: string[];
};

export type ListingV5EvidenceBinding = {
  version: typeof LISTING_V5_EVIDENCE_BINDING_VERSION;
  source: "provider" | "deterministic";
  bound: number;
  suggestions: number;
  total: number;
  conclusions: ListingV5BoundConclusion[];
};

export const LISTING_V5_BENEFIT_PRIORITY_VERSION = "listing-v5.benefit-priority.v1" as const;

/**
 * Why a benefit sits where it does (Phase 1, additive).
 *
 * The four classes are deliberately evidence-shaped, not copy-shaped:
 * - `strong_purchase_signal`: repeated VOC demand AND a keyword reference carrying
 *   the same need, i.e. shoppers complain about it repeatedly and search for it.
 * - `recurring_need`: repeated VOC demand (`strength: "recurring"`) on its own.
 * - `competitor_gap`: a competitor observation covers a dimension this product can
 *   answer with a Confirmed Fact, so the need is also a differentiation point.
 * - `weak_signal`: none of the above. This is a strength label, NOT an evidence
 *   label: `basis` says whether any reference backs the entry at all. An entry
 *   with no reference is the `ai_suggestion` case of Evidence Binding.
 */
export type ListingV5BenefitSignal = "strong_purchase_signal" | "recurring_need" | "competitor_gap" | "weak_signal";

/**
 * One auditable ranking entry.
 *
 * `field` + `index` point AT the strategy list entry this explains instead of
 * duplicating its text: conclusion text duplicated here would bypass
 * `sanitizeStrategyForCopy()` on the way to the Writer prompt.
 *
 * `evidenceIds` are ids that resolved against the frozen context. An invented or
 * unresolvable id is never reported here, exactly as in Evidence Binding.
 */
export type ListingV5BenefitPriority = {
  field: "painPoints" | "purchaseMotivations" | "useCases";
  /** 0-based position inside that list. The list is ordered by `score` desc. */
  index: number;
  /** 1-based position, for display. */
  rank: number;
  signal: ListingV5BenefitSignal;
  /** Deterministic ordering score: strength + observation volume + signals. Higher ranks earlier. */
  score: number;
  strength: ListingV5EvidenceStrength;
  count: number;
  basis: "reference_backed" | "no_reference";
  evidenceIds: string[];
  /** One line, built from evidence metadata only: never reference wording. */
  rationale: string;
};

export type ListingV5BenefitPriorityBasis = {
  version: typeof LISTING_V5_BENEFIT_PRIORITY_VERSION;
  entries: ListingV5BenefitPriority[];
};

export const LISTING_V5_BENEFIT_CANDIDATE_VERSION = "listing-v5.benefit-candidate.v1" as const;

/**
 * Where a benefit candidate came from. Both kinds are observed evidence; neither
 * is ever a product statement.
 */
export type ListingV5BenefitCandidateKind =
  /** An observed VOC theme. */
  | "buyer_concern"
  /** A VOC conflict: shoppers report opposing perceptions of the same attribute. */
  | "buyer_conflict";

/**
 * Phase 2 — one benefit candidate derived from the research evidence.
 *
 * Phase 1 ranked a fixed vocabulary of four English need sentences. That left a
 * hard ceiling: the vocabulary was fixed, and it was matched against VOC text
 * that the VOC contract requires to be Simplified Chinese, so on real products
 * most tasks produced nothing to rank at all.
 *
 * A candidate is derived from the evidence instead: an observed theme selects a
 * language-independent concept, the concept carries the evidence identity, and
 * the Phase 1 ranking decides the order.
 *
 * Hard rules:
 * - `evidenceIds` is never empty: a candidate that cannot name the reference it
 *   came from is not emitted at all. A fabricated or unresolvable id can never
 *   appear here.
 * - `framing` is reference-only English framing. It is a way of talking about
 *   what shoppers said; it is never a Confirmed Fact, never carries a `factId`,
 *   and never asserts a specification, certification or performance attribute.
 * - Candidates never promote a strategy conclusion in `evidenceBindings`: the
 *   deterministic template stays `ai_suggestion` even though its POSITION is
 *   evidence-ranked.
 */
export type ListingV5BenefitCandidate = {
  /** Stable: derived from the concept id and the first evidence id behind it. */
  candidateId: string;
  /** Language-independent concept key, e.g. `leak_resistance`. */
  concept: string;
  kind: ListingV5BenefitCandidateKind;
  /** English, reference-only framing. Never a product fact and never copy. */
  framing: string;
  /** Resolved evidence ids only. Never empty. */
  evidenceIds: string[];
  strength: ListingV5EvidenceStrength;
  count: number;
  /** Deterministic Phase 1 ordering score: strength + volume + demand + gap. */
  score: number;
  marker: "UNTRUSTED_REFERENCE_DATA";
  notProductFact: true;
};

export type ListingV5BenefitCandidateSet = {
  version: typeof LISTING_V5_BENEFIT_CANDIDATE_VERSION;
  /**
   * `evidence` when at least one observed theme produced a candidate.
   * `none` when the frozen context carries no citable theme — the strategy then
   * falls back to the previous fixed-vocabulary behaviour rather than inventing
   * a need, so an empty set means "nothing to cite", not "no research".
   */
  source: "evidence" | "none";
  candidates: ListingV5BenefitCandidate[];
};

export type ListingV5Fact = {
  id: string;
  canonicalField: string;
  label: string;
  value: string;
  sourceRefs: string[];
};

export type ListingV5Context = {
  version: typeof LISTING_V5_CONTEXT_VERSION;
  taskId: string;
  researchRevision: number;
  handoffRevision: number;
  contextFingerprint: string;
  marketplace: string;
  productIdentity: string;
  confirmedFacts: ListingV5Fact[];
  prohibitedClaims: string[];
  unknowns: string[];
  references: {
    voc: ListingV5Reference[];
    keywords: ListingV5Reference[];
    competitors: ListingV5Reference[];
    sourcing: ListingV5Reference[];
  };
  manualDirection: string | null;
};

export type ListingV5BulletRole = "core_outcome" | "pain_relief" | "use_scenario" | "ease_of_use" | "proof_or_fit";

export type ListingV5Strategy = {
  version: typeof LISTING_V5_STRATEGY_VERSION;
  referenceOnly: true;
  researchRevision: number;
  targetAudience: string[];
  purchaseMotivations: string[];
  painPoints: string[];
  useCases: string[];
  primaryAngle: string;
  secondaryAngles: string[];
  tone: string[];
  keywordIntent: { primary: string[]; secondary: string[]; backendOnly: string[] };
  bulletAngles: Array<{ role: ListingV5BulletRole; shopperValue: string }>;
  avoidClaims: string[];
  /**
   * Evidence Binding side-car (additive). Present when the strategy was produced
   * with an evidence index available. It records, per conclusion, whether the
   * claim can be traced to a real research reference. It never changes the
   * conclusion text, never gates the Validator and never blocks generation:
   * an unbound conclusion is LABELLED, not removed.
   */
  evidenceBindings?: ListingV5EvidenceBinding;
  /**
   * Phase 1 benefit ranking basis (additive, optional so older snapshots and test
   * literals keep working). `painPoints` / `purchaseMotivations` / `useCases` are
   * ordered by it, and every entry says why it sits where it does.
   *
   * It carries evidence CLASSIFICATION only. It never promotes a conclusion in
   * `evidenceBindings`: a deterministic template stays `ai_suggestion` there even
   * when the need behind it is evidence-ranked.
   */
  benefitPriorityBasis?: ListingV5BenefitPriorityBasis;
  /**
   * Phase 2 benefit candidates (additive, optional). The needs the strategy
   * speaks to are derived from observed research themes instead of a fixed
   * English vocabulary.
   *
   * Reference-only framing, bounded, and every candidate names the evidence it
   * came from. It carries no `factId` and is never merged into Confirmed Facts.
   */
  benefitCandidates?: ListingV5BenefitCandidateSet;
};

export type ListingV5WriterBullet = {
  text: string;
  factIds: string[];
  strategyRole: ListingV5BulletRole;
};

export type ListingV5WriterDraft = {
  version: typeof LISTING_V5_WRITER_VERSION;
  title: { text: string; factIds: string[] };
  bullets: ListingV5WriterBullet[];
  description: { text: string; factIds: string[] };
  backendSearchTerms: string[];
  humanReviewRequired: true;
};

/**
 * Why one sentence failed fact anchoring, in a form a repair step can act on.
 * `offendingSpans` are the exact surface words that the Validator rejected
 * (`high-use`), never a paraphrase and never new content. They explain a
 * failure; they are NOT a fact source - Confirmed Facts remain the only
 * factual authority.
 */
export type ListingV5UnsupportedDetail = {
  text: string;
  reason: string;
  field: string;
  issueCode: ListingV5IssueCode;
  offendingSpans: string[];
};

export type ListingV5IssueCode =
  | "unsupported_hard_claim"
  | "unsupported_attribute_assertion"
  /** A model-shaped code in the copy that no confirmed series/model value covers. */
  | "unsupported_model_code"
  | "unsupported_claim";

export type ListingV5ValidationResult = {
  version: typeof LISTING_V5_VALIDATION_VERSION;
  status: "PASS" | "REPAIRABLE" | "BLOCK";
  title: { valid: boolean; issues: string[] };
  bullets: Array<{ valid: boolean; factIds: string[]; strategyRole: ListingV5BulletRole; issues: string[] }>;
  description: { valid: boolean; issues: string[] };
  claims: {
    allHaveEvidence: boolean;
    unsupportedClaims: string[];
    prohibitedClaims: string[];
    competitorOverlap: string[];
    /** Bounded, deterministic violation evidence for the repair step. */
    unsupportedDetails?: ListingV5UnsupportedDetail[];
  };
  quality: { repetitive: boolean; keywordStuffing: boolean; mechanicalTemplate: boolean };
  /** `targets` lists the bounded text fields one repair pass may rewrite. */
  repair: { allowed: boolean; reason: string | null; targets: string[] };
};

export type ListingV5Snapshot = {
  version: "listing-v5.snapshot.v1";
  taskId: string;
  researchRevision: number;
  handoffRevision: number;
  contextFingerprint: string;
  strategy: ListingV5Strategy | null;
  listing: ListingV5WriterDraft | null;
  validation: ListingV5ValidationResult;
  strategyPromptVersion: typeof LISTING_V5_STRATEGY_PROMPT_VERSION;
  writerPromptVersion: typeof LISTING_V5_WRITER_PROMPT_VERSION;
  validatorVersion: typeof LISTING_V5_VALIDATION_VERSION;
  repairApplied: boolean;
  repairPromptVersion: typeof LISTING_V5_REPAIR_PROMPT_VERSION;
  provider: { strategyAttempted: boolean; writerAttempted: boolean; repairAttempted: boolean; fallbackUsed: boolean };
  model: string;
  generatedAt: string;
  humanReviewRequired: true;
  /** Conversion intelligence layer artefacts. Additive; Validator is unchanged. */
  conversionBlueprint?: ListingV5ConversionBlueprint | null;
  qualityEvaluation?: ListingV5QualityEvaluation | null;
  /** Development / test only AI execution trace. Never emitted in production. */
  trace?: ListingV5ExecutionTrace;
};
