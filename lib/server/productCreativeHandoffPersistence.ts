import "server-only";
import { createHash } from "node:crypto";

import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";
import type { TaskResultJsonSnapshot } from "@/lib/server/taskResultJsonMutation";
import {
  createProductCreativeHandoff,
  appendProductCreativeHandoffVersion,
  revokeProductCreativeHandoff,
  parseProductCreativeHandoff,
  calculateHandoffFingerprint,
  type ProductCreativeHandoffV1,
  type ProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoff";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";

export class CreativeHandoffPersistenceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreativeHandoffPersistenceError";
  }
}

export type CreateHandoffInput = {
  requestId: string;
  expectedResearchRevision: number;
  expectedCurrentHandoffRevision: number;
  expectedStorageVersion?: { resultJson: string; updatedAt: string };
  candidate: ProductCreativeHandoffCandidate;
  /** Canonical fingerprint of the request payload */
  requestFingerprint: string;
};

function hashShort(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}

function buildIdempotencyRef(action: string, taskId: string, requestId: string, fingerprint: string): string {
  return `idem:${action}:${hashShort(taskId)}:${hashShort(requestId)}:${hashShort(fingerprint)}`;
}

function buildHandoffId(): string {
  return createHash("sha256").update(crypto.randomUUID()).digest("hex").slice(0, 32);
}

// ─── Create / Append ─────────────────────────────────────

export async function createOrAppendCreativeHandoff(
  taskId: string,
  context: AccessContext,
  input: CreateHandoffInput,
): Promise<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean; idempotentReplay: boolean }> {
  const now = new Date().toISOString();
  const ctxAny = context as unknown as Record<string, unknown>;
  const createdBy = context.mode === "owner"
    ? { mode: "owner" as const, subjectFingerprint: (ctxAny.ownerRef as string || "owner") }
    : { mode: "visitor" as const, subjectFingerprint: (ctxAny.demoAccessId as string || "visitor") };

  const idempotencyRef = buildIdempotencyRef("create", taskId, input.requestId, input.requestFingerprint);
  const handoffId = buildHandoffId();

  const result = await mutateTaskResultJson<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean; idempotentReplay: boolean }>({
    context,
    taskId,
    writer: "creative-handoff",
    expectedStorageVersion: input.expectedStorageVersion,
    async mutate(_current, _snapshot) {
      // ── Re-execute Gate INSIDE the CAS/lock scope (P1-1 fix) ──
      const gate = await checkCreativeHandoffGate(taskId, context);
      if (!gate.allowed || !gate.candidate) {
        throw new CreativeHandoffPersistenceError("research_gate_failed", 422, "当前研究状态不允许创建创作交接。");
      }

      // Version checks
      if (input.expectedResearchRevision !== gate.candidate.sourceResearch.researchRevision) {
        throw new CreativeHandoffPersistenceError("research_revision_changed", 409, "研究数据已更新，请刷新后重新确认。");
      }

      const currentHandoff = gate.currentHandoff;

      // ── Existing version check ──
      if (currentHandoff && input.expectedCurrentHandoffRevision !== currentHandoff.currentRevision) {
        throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "创作交接已有新版本。");
      }
      if (!currentHandoff && input.expectedCurrentHandoffRevision !== 0) {
        throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "交接版本状态异常。");
      }

      // ── Idempotency check (B1 fix) ──
      // Compare candidate fingerprint to detect duplicate submissions
      if (currentHandoff) {
        try {
          const candidateFp = calculateHandoffFingerprint(input.candidate);
          const existingVersion = currentHandoff.versions.find(
            (v) => v.handoffFingerprint === candidateFp,
          );
          if (existingVersion) {
            return {
              result: _current as Record<string, unknown>,
              value: { handoff: currentHandoff, isNewRevision: false, idempotentReplay: true },
            };
          }
        } catch { /* fingerprint calc can throw on invalid candidate — proceed to create */ }
      }

      // Candidate binding check
      if (currentHandoff && currentHandoff.candidateId !== gate.candidate.sourceResearch.candidateId) {
        throw new CreativeHandoffPersistenceError("candidate_identity_mismatch", 409, "候选人身份不匹配。");
      }

      let handoff: ProductCreativeHandoffV1;

      if (!currentHandoff) {
        // ── Create first revision ──
        handoff = createProductCreativeHandoff({
          handoffId,
          taskId,
          candidateId: gate.candidate.sourceResearch.candidateId,
          createdAt: now,
          createdBy,
          candidate: input.candidate,
        });
      } else {
        // ── Append revision ──
        handoff = appendProductCreativeHandoffVersion({
          handoff: currentHandoff,
          createdAt: now,
          createdBy,
          candidate: input.candidate,
        });
      }

      return {
        result: { ..._current, creativeHandoff: handoff as unknown as Record<string, unknown> },
        value: { handoff, isNewRevision: !currentHandoff, idempotentReplay: false },
      };
    },
  });

  return result.value;
}

// ─── Revoke ──────────────────────────────────────────────

export async function revokeCreativeHandoffAction(
  taskId: string,
  context: AccessContext,
  input: { requestId: string; revokeReasonCode: "explicit_user_revoke" | "decision_changed" | "identity_invalid" | "verification_invalid" },
  expectedStorageVersion?: { resultJson: string; updatedAt: string },
): Promise<{ handoff: ProductCreativeHandoffV1; idempotentReplay: boolean }> {
  const now = new Date().toISOString();

  const result = await mutateTaskResultJson<{ handoff: ProductCreativeHandoffV1; idempotentReplay: boolean }>({
    context,
    taskId,
    writer: "creative-handoff",
    expectedStorageVersion,
    async mutate(_current, _snapshot) {
      // ── Re-execute Gate INSIDE the lock (P1-1 fix) ──
      const gate = await checkCreativeHandoffGate(taskId, context);
      if (!gate.currentHandoff) {
        throw new CreativeHandoffPersistenceError("not_found", 404, "没有可撤回的创作交接。");
      }

      // Already revoked → idempotent
      if (gate.currentHandoff.controlState !== "active") {
        // Same reason → idempotent, different reason → conflict
        if (gate.currentHandoff.revokeReasonCode === input.revokeReasonCode) {
          return {
            result: _current as Record<string, unknown>,
            value: { handoff: gate.currentHandoff, idempotentReplay: true },
          };
        }
        throw new CreativeHandoffPersistenceError("idempotency_conflict", 409, "已撤回的交接无法用不同原因再次撤回。");
      }

      const revoked = revokeProductCreativeHandoff(gate.currentHandoff, {
        revokedAt: now,
        reasonCode: input.revokeReasonCode,
      });

      // Stamp the revoke reason into the confirmation reference field for audit
      (revoked as Record<string, unknown>).revokeRequestId = input.requestId;

      return {
        result: { ..._current, creativeHandoff: revoked as unknown as Record<string, unknown> },
        value: { handoff: revoked, idempotentReplay: false },
      };
    },
  });

  return result.value;
}
