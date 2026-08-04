import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";
import type { TaskResultJsonSnapshot } from "@/lib/server/taskResultJsonMutation";
import {
  createProductCreativeHandoff,
  appendProductCreativeHandoffVersion,
  revokeProductCreativeHandoff,
  parseProductCreativeHandoff,
  type ProductCreativeHandoffV1,
  type ProductCreativeHandoffCandidate,
} from "@/lib/productCreativeHandoff";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";

export class CreativeHandoffPersistenceError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = "CreativeHandoffPersistenceError";
  }
}

export type CreateHandoffInput = {
  requestId: string;
  expectedResearchRevision: number;
  expectedCurrentHandoffRevision: number;
  candidate: ProductCreativeHandoffCandidate;
};

export type RevokeHandoffInput = {
  requestId: string;
  revokeReasonCode: "explicit_user_revoke" | "decision_changed" | "identity_invalid" | "verification_invalid";
};

export async function createOrAppendCreativeHandoff(
  taskId: string,
  context: AccessContext,
  input: CreateHandoffInput,
  expectedStorageVersion?: { resultJson: string; updatedAt: string },
): Promise<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean }> {
  const gate = await checkCreativeHandoffGate(taskId, context);
  if (!gate.allowed) {
    throw new CreativeHandoffPersistenceError("research_gate_failed", 422, "当前研究状态不允许创建创作交接。");
  }
  if (!gate.candidate) {
    throw new CreativeHandoffPersistenceError("research_gate_failed", 422, "缺少有效的候选人研究数据。");
  }

  // Verify expected research revision
  if (input.expectedResearchRevision !== gate.candidate.sourceResearch.researchRevision) {
    throw new CreativeHandoffPersistenceError("research_revision_changed", 409, "研究数据已更新，请刷新后重新确认。");
  }

  const currentHandoff = gate.currentHandoff;
  const expectedRev = input.expectedCurrentHandoffRevision;

  // Verify expected handoff revision
  if (currentHandoff && expectedRev !== currentHandoff.currentRevision) {
    throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "创作交接已有新版本，请刷新后重新确认。");
  }
  if (!currentHandoff && expectedRev !== 0) {
    throw new CreativeHandoffPersistenceError("creative_handoff_conflict", 409, "创作交接状态异常，请刷新后重试。");
  }

  const now = new Date().toISOString();
  const ctxAny = context as unknown as Record<string, unknown>;
  const createdBy = context.mode === "owner"
    ? { mode: "owner" as const, subjectFingerprint: (ctxAny.ownerRef as string || "owner") }
    : { mode: "visitor" as const, subjectFingerprint: (ctxAny.demoAccessId as string || "visitor") };

  const result = await mutateTaskResultJson<{ handoff: ProductCreativeHandoffV1; isNewRevision: boolean }>({
    context,
    taskId,
    writer: "creative-handoff",
    expectedStorageVersion,
    async mutate(current) {
      let handoff: ProductCreativeHandoffV1;

      if (!currentHandoff) {
        // Create first revision
        handoff = createProductCreativeHandoff({
          handoffId: input.requestId,
          taskId,
          candidateId: gate.candidate!.sourceResearch.candidateId,
          createdAt: now,
          createdBy,
          candidate: input.candidate,
        });
      } else {
        // Verify candidate binding
        if (currentHandoff.candidateId !== gate.candidate!.sourceResearch.candidateId) {
          throw new CreativeHandoffPersistenceError("candidate_identity_mismatch", 409, "候选人身份不匹配。");
        }
        // Append new revision
        handoff = appendProductCreativeHandoffVersion({
          handoff: currentHandoff,
          createdAt: now,
          createdBy,
          candidate: input.candidate,
        });
      }

      return {
        result: { ...current, creativeHandoff: handoff as unknown as Record<string, unknown> },
        value: { handoff, isNewRevision: !currentHandoff },
      };
    },
  });

  return result.value;
}

export async function revokeCreativeHandoffAction(
  taskId: string,
  context: AccessContext,
  input: RevokeHandoffInput,
  expectedStorageVersion?: { resultJson: string; updatedAt: string },
): Promise<ProductCreativeHandoffV1> {
  const gate = await checkCreativeHandoffGate(taskId, context);
  if (!gate.currentHandoff) {
    throw new CreativeHandoffPersistenceError("not_found", 404, "没有可撤回的创作交接。");
  }
  if (gate.currentHandoff.controlState !== "active") {
    // Idempotent: already revoked
    return gate.currentHandoff;
  }

  const now = new Date().toISOString();

  const result = await mutateTaskResultJson<ProductCreativeHandoffV1>({
    context,
    taskId,
    writer: "creative-handoff",
    expectedStorageVersion,
    async mutate(current) {
      const revoked = revokeProductCreativeHandoff(gate.currentHandoff!, {
        revokedAt: now,
        reasonCode: input.revokeReasonCode,
      });

      return {
        result: { ...current, creativeHandoff: revoked as unknown as Record<string, unknown> },
        value: revoked,
      };
    },
  });

  return result.value;
}
