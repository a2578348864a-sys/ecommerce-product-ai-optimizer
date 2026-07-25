/**
 * Phase 3F Reset-A2-1 — Legacy Candidate Write rule engine & executor.
 *
 * Implements the approved Target Contract C for legacy (unverified)
 * Candidate writes.  Pure business logic; no HTTP, Prisma, or file I/O.
 */

import { createHash } from "node:crypto";
import { normalizeCandidateIdentity } from "@/lib/server/candidateSourceSave";
import {
  LegacyCandidateWriteError,
  type BoundLegacyCandidateWriteBackend,
  type ExistingLegacyCandidate,
  type LegacyCandidateWriteDecision,
  type LegacyCandidateWriteInput,
  type LegacyCandidateWriteResult,
  type LegacyCandidateWriteResultItem,
} from "@/lib/server/legacyCandidateWriteTypes";

// ── Mutable Fingerprint V1 ───────────────────────

/**
 * Fields that constitute the "effective content" of a legacy Candidate.
 *
 * Only these fields are compared when deciding "unchanged" vs "updated".
 * Timestamps, generated metadata, authority fields (status, convertedTaskId),
 * and the display name are intentionally excluded so that a write with
 * identical business content is recognised as unchanged.
 */
const MUTABLE_FINGERPRINT_V1_FIELDS = [
  "score",
  "rawInput",
  "link",
  "source",
  "keyword",
  "riskLevel",
  "riskLabel",
  "summaryLabel",
] as const;

/**
 * Stable semantic fingerprint of the legacy-mutable content.
 *
 * Uses SHA-256 over a deterministic JSON array so that the result is
 * reproducible regardless of object-key iteration order.
 */
export function computeMutableFingerprintV1(input: LegacyCandidateWriteInput): string {
  const canonical: unknown[] = MUTABLE_FINGERPRINT_V1_FIELDS.map((field) => {
    const value = input[field as keyof LegacyCandidateWriteInput];
    // Normalise: null → null, string → trimmed-or-null
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }
    return value;
  });
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

// ── Helpers ──────────────────────────────────────

const LEGACY_UNVERIFIED = "legacy_unverified";
const SIGNED = "signed_source_v2";
const PENDING = "pending";
const OVERWRITABLE_STATUSES: ReadonlySet<string> = new Set([PENDING]);

function isOverwritable(existing: ExistingLegacyCandidate): boolean {
  return (
    existing.sourceIntegrity === LEGACY_UNVERIFIED &&
    existing.status === PENDING &&
    existing.convertedTaskId === null
  );
}

function normalizeTextField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// ── Pure batch planner ───────────────────────────

/**
 * Produce a deterministic plan for a batch of legacy Candidate writes.
 *
 * This is a **pure function** — no I/O, no randomness, no current time.
 *
 * Error priority (checked in order, first violation wins):
 *  1. Batch-internal duplicate identity → candidate_source_conflict
 *  2. Multiple existing records for one identity → candidate_identity_ambiguous
 *  3. Existing record that must not be overwritten → candidate_legacy_overwrite_blocked
 */
export function planLegacyCandidateWriteBatch(
  inputs: readonly LegacyCandidateWriteInput[],
  existingByIdentity: ReadonlyMap<string, readonly ExistingLegacyCandidate[]>,
): readonly LegacyCandidateWriteDecision[] {
  // Validate inputs
  if (!Array.isArray(inputs)) {
    throw new LegacyCandidateWriteError("candidate_batch_invalid", "输入必须是数组。");
  }
  if (inputs.length === 0) {
    throw new LegacyCandidateWriteError("candidate_batch_invalid", "Legacy Candidate 批次不能为空。");
  }

  // Step 1 — Validate individual inputs and compute identities
  const identityMap = new Map<string, LegacyCandidateWriteInput>();
  const identityOrder: string[] = [];

  for (const input of inputs) {
    if (!input || typeof input !== "object") {
      throw new LegacyCandidateWriteError("candidate_batch_invalid", "批次包含无效条目。");
    }
    const name = normalizeTextField(input.name);
    if (!name) {
      throw new LegacyCandidateWriteError("candidate_batch_invalid", "Candidate 名称不能为空。");
    }
    const identityKey = normalizeCandidateIdentity(name);

    // Step 2 — Batch-internal duplicate check (fail-closed)
    if (identityMap.has(identityKey)) {
      throw new LegacyCandidateWriteError(
        "candidate_source_conflict",
        `Legacy Candidate 批次包含重复身份: ${identityKey}`,
      );
    }
    identityMap.set(identityKey, input);
    identityOrder.push(identityKey);
  }

  // Step 3 — Generate decisions
  const decisions: LegacyCandidateWriteDecision[] = [];

  for (const identityKey of identityOrder) {
    const input = identityMap.get(identityKey)!;
    const existingRecords = existingByIdentity.get(identityKey) ?? [];

    // Priority: ambiguous > blocked > update/unchanged > create

    if (existingRecords.length > 1) {
      throw new LegacyCandidateWriteError(
        "candidate_identity_ambiguous",
        `候选池已有重复身份 (${identityKey})，无法安全写入。`,
      );
    }

    if (existingRecords.length === 1) {
      const existing = existingRecords[0];

      // Signed Candidate cannot be overwritten by legacy input
      if (existing.sourceIntegrity === SIGNED) {
        throw new LegacyCandidateWriteError(
          "candidate_legacy_overwrite_blocked",
          `未验证来源不能覆盖已验证 Candidate: ${identityKey}`,
        );
      }

      // Task-linked Candidate cannot be overwritten
      if (existing.convertedTaskId) {
        throw new LegacyCandidateWriteError(
          "candidate_legacy_overwrite_blocked",
          `已转为任务的 Candidate 不能被同名 Legacy 输入覆盖: ${identityKey}`,
        );
      }

      // Non-pending Candidate cannot be overwritten
      if (!OVERWRITABLE_STATUSES.has(existing.status)) {
        throw new LegacyCandidateWriteError(
          "candidate_legacy_overwrite_blocked",
          `非 pending 状态的 Candidate 不能被 Legacy 输入覆盖: ${identityKey} (${existing.status})`,
        );
      }

      // Unknown integrity with authoritative info — blocked
      if (existing.sourceIntegrity === "unknown") {
        throw new LegacyCandidateWriteError(
          "candidate_legacy_overwrite_blocked",
          `无法确定来源完整性的 Candidate 不能被 Legacy 输入覆盖: ${identityKey}`,
        );
      }

      // At this point: legacy_unverified + pending + unlinked → overwritable
      const newFingerprint = computeMutableFingerprintV1(input);

      if (newFingerprint === existing.mutableFingerprint) {
        decisions.push({ kind: "unchanged", candidateId: existing.id });
      } else {
        decisions.push({ kind: "update", candidateId: existing.id, input });
      }
    } else {
      // No existing record → create
      decisions.push({ kind: "create", identityKey, input });
    }
  }

  return decisions;
}

// ── Bound-backend executor ───────────────────────

/**
 * Execute a Legacy Candidate write batch end-to-end.
 *
 * 1. Validates inputs and computes identities.
 * 2. Loads existing records via the bound backend.
 * 3. Plans the batch (pure function).
 * 4. Commits the plan via the bound backend (single call).
 *
 * The backend is responsible for atomicity.  If commitPlan returns a
 * mismatched result, the error is surfaced as a backend contract violation.
 */
export async function executeLegacyCandidateWrite(
  inputs: readonly LegacyCandidateWriteInput[],
  backend: BoundLegacyCandidateWriteBackend,
): Promise<LegacyCandidateWriteResult> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new LegacyCandidateWriteError("candidate_batch_invalid", "Legacy Candidate 批次不能为空。");
  }

  // Collect identity keys
  const identityKeys = inputs.map((input) => {
    const name = normalizeTextField(input.name);
    if (!name) {
      throw new LegacyCandidateWriteError("candidate_batch_invalid", "Candidate 名称不能为空。");
    }
    return normalizeCandidateIdentity(name);
  });

  // Load existing records
  let existingByIdentity: ReadonlyMap<string, readonly ExistingLegacyCandidate[]>;
  try {
    existingByIdentity = await backend.loadByIdentityKeys(identityKeys);
  } catch (error) {
    if (error instanceof LegacyCandidateWriteError) throw error;
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_failure",
      `读取已有 Candidate 失败: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  // Plan (pure — any error here aborts before commit)
  const plan = planLegacyCandidateWriteBatch(inputs, existingByIdentity);

  // Commit (single call — backend is responsible for atomicity)
  let result: LegacyCandidateWriteResult;
  try {
    result = await backend.commitPlan(plan);
  } catch (error) {
    if (error instanceof LegacyCandidateWriteError) throw error;
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_failure",
      `保存 Candidate 失败: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  // Verify result integrity
  if (!result || typeof result !== "object") {
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_mismatch",
      "Backend 返回无效结果。",
    );
  }
  if (
    typeof result.created !== "number" ||
    typeof result.updated !== "number" ||
    typeof result.unchanged !== "number"
  ) {
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_mismatch",
      "Backend 返回计数不完整。",
    );
  }
  if (!Array.isArray(result.items) || result.items.length !== plan.length) {
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_mismatch",
      `Backend 返回条目数 (${result.items?.length ?? 0}) 与计划 (${plan.length}) 不一致。`,
    );
  }

  // Verify counts match plan
  const expectedCreated = plan.filter((d) => d.kind === "create").length;
  const expectedUpdated = plan.filter((d) => d.kind === "update").length;
  const expectedUnchanged = plan.filter((d) => d.kind === "unchanged").length;
  if (
    result.created !== expectedCreated ||
    result.updated !== expectedUpdated ||
    result.unchanged !== expectedUnchanged
  ) {
    throw new LegacyCandidateWriteError(
      "candidate_write_backend_mismatch",
      `Backend 计数与计划不匹配 (期望 c${expectedCreated}/u${expectedUpdated}/n${expectedUnchanged}, 实际 c${result.created}/u${result.updated}/n${result.unchanged})。`,
    );
  }

  return result;
}
