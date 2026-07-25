/**
 * Phase 3F Reset-A2-1 — Legacy Candidate Write domain types.
 *
 * These types express the approved Target Contract C for legacy
 * (unverified) Candidate writes. They are Scope-agnostic and do not
 * reference Prisma, HTTP, or any concrete storage backend.
 */

import type { CandidateSaveItem } from "@/lib/server/candidateSourceSave";

// ── Input ────────────────────────────────────────

/** Input for a single legacy Candidate write. Reuses the existing save-item shape. */
export type LegacyCandidateWriteInput = CandidateSaveItem;

// ── Existing-record snapshot ─────────────────────

/**
 * Minimal view of an already-persisted Candidate that the planner needs
 * to decide create / update / unchanged / blocked / ambiguous.
 */
export type ExistingLegacyCandidate = Readonly<{
  id: string;
  name: string;
  status: string;
  convertedTaskId: string | null;
  /** "legacy_unverified" | "signed_source_v2" | "unknown" */
  sourceIntegrity: "legacy_unverified" | "signed_source_v2" | "unknown";
  /** Stable fingerprint of the previously-written mutable content. */
  mutableFingerprint: string;
}>;

// ── Plan decisions ───────────────────────────────

export type LegacyCandidateWriteDecision =
  | Readonly<{ kind: "create"; identityKey: string; input: LegacyCandidateWriteInput }>
  | Readonly<{ kind: "update"; candidateId: string; input: LegacyCandidateWriteInput }>
  | Readonly<{ kind: "unchanged"; candidateId: string }>;

// ── Result ───────────────────────────────────────

export type LegacyCandidateWriteResultItem = Readonly<{
  decision: "created" | "updated" | "unchanged";
  identityKey: string;
  candidateId?: string;
}>;

export type LegacyCandidateWriteResult = Readonly<{
  created: number;
  updated: number;
  unchanged: number;
  items: readonly LegacyCandidateWriteResultItem[];
}>;

// ── Backend ──────────────────────────────────────

/**
 * Storage backend that the write service delegates I/O to.
 *
 * The backend is already scoped to a single owner/visitor by the caller;
 * the service itself never sees or passes a scopeId.
 */
export interface BoundLegacyCandidateWriteBackend {
  /**
   * Load every Candidate whose normalized identity matches one of the
   * given keys.  Each key maps to zero or more existing records.
   */
  loadByIdentityKeys(
    identityKeys: readonly string[],
  ): Promise<ReadonlyMap<string, readonly ExistingLegacyCandidate[]>>;

  /**
   * Persist a complete, pre-validated plan in a single atomic step.
   * The backend MUST return exactly one result item per decision.
   */
  commitPlan(
    plan: readonly LegacyCandidateWriteDecision[],
  ): Promise<LegacyCandidateWriteResult>;
}

// ── Error contract ───────────────────────────────

export const LEGACY_CANDIDATE_WRITE_ERROR_CODES = [
  "candidate_source_conflict",
  "candidate_identity_ambiguous",
  "candidate_legacy_overwrite_blocked",
  "candidate_batch_invalid",
  "candidate_write_backend_mismatch",
  "candidate_write_backend_failure",
] as const;

export type LegacyCandidateWriteErrorCode =
  (typeof LEGACY_CANDIDATE_WRITE_ERROR_CODES)[number];

export class LegacyCandidateWriteError extends Error {
  public readonly code: LegacyCandidateWriteErrorCode;
  constructor(code: LegacyCandidateWriteErrorCode, message: string) {
    super(message);
    this.name = "LegacyCandidateWriteError";
    this.code = code;
  }
}
