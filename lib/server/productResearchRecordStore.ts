import "server-only";

import { prisma } from "@/lib/server/db";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  getSandboxCandidate,
  getSandboxTask,
  isSandboxTaskId,
  listSandboxTasks,
} from "@/lib/server/demoSandbox";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
import {
  ProductResearchRecordError,
  appendProductResearchDecision,
  buildProductResearchActor,
  getProductResearchRecord,
  getProductResearchVerification,
  hasProductResearchRecordNamespace,
  productResearchDecisionToCompatibilityStatus,
  toProductResearchDecisionSummary,
  type ProductResearchDecisionSummary,
  verifyProductResearchHash,
  type ProductResearchDecisionInput,
  type ProductResearchRecordV1,
} from "@/lib/productResearchRecord";
import { createResearchDecisionResultMutation } from "@/lib/server/taskResultWriterServices";

type RawTaskSnapshot = {
  id: string;
  updatedAt: Date | string;
  resultJson: string;
  decisionStatus: string;
};

export type ProductResearchDecisionState = {
  taskId: string;
  legacy: boolean;
  readOnly: boolean;
  record: ProductResearchRecordV1 | null;
};

export type CandidateResearchDecisionProjection = {
  candidateId: string | null;
  summary: ProductResearchDecisionSummary | {
    schema: null;
    status: null;
    label: "旧版研究记录";
    reasonSummary: "";
    nextActionSummary: null;
    revision: null;
    decidedAt: null;
    legacy: true;
  };
};

export class ProductResearchStoreError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "ProductResearchStoreError";
  }
}

function notFound(): never {
  throw new ProductResearchStoreError("not_found", 404, "研究记录不存在。" );
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function loadSnapshot(context: AccessContext, taskId: string): Promise<RawTaskSnapshot> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) notFound();
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) notFound();
    return task;
  }
  if (isSandboxTaskId(taskId)) notFound();
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { id: true, updatedAt: true, resultJson: true, decisionStatus: true },
  });
  if (!task) notFound();
  return task;
}

async function assertBinding(
  context: AccessContext,
  taskId: string,
  result: Record<string, unknown>,
  record: ProductResearchRecordV1,
): Promise<void> {
  const verification = getProductResearchVerification(result);
  if (!verification || !verifyProductResearchHash(record, verification)) {
    throw new ProductResearchStoreError(
      "research_hash_invalid",
      409,
      "研究依据已损坏或无法验证，不能继续修改。",
    );
  }
  if (context.mode === "demo") {
    const candidate = getSandboxCandidate(context.demoAccessId, record.candidateId);
    if (!candidate || candidate.convertedTaskId !== taskId) {
      throw new ProductResearchStoreError(
        "research_binding_invalid",
        409,
        "研究记录与候选商品的绑定已失效。",
      );
    }
    return;
  }
  const candidate = await prisma.opportunityCandidate.findFirst({
    where: { id: record.candidateId, convertedTaskId: taskId },
    select: { id: true },
  });
  if (!candidate) {
    throw new ProductResearchStoreError(
      "research_binding_invalid",
      409,
      "研究记录与候选商品的绑定已失效。",
    );
  }
}

async function parseVersionedState(
  context: AccessContext,
  taskId: string,
  snapshot: RawTaskSnapshot,
): Promise<{
  state: ProductResearchDecisionState;
  result: Record<string, unknown>;
  record: ProductResearchRecordV1;
}> {
  const result = parseResultJson(snapshot.resultJson);
  if (!hasProductResearchRecordNamespace(result)) {
    throw new ProductResearchStoreError(
      "legacy_record_read_only",
      409,
      "旧研究记录仅可查看，不能伪造或补写版本化决定。",
    );
  }
  const record = getProductResearchRecord(result);
  if (!record) {
    throw new ProductResearchStoreError(
      "invalid_research_record",
      409,
      "版本化研究记录结构无效。",
    );
  }
  await assertBinding(context, taskId, result, record);
  return {
    state: { taskId, legacy: false, readOnly: false, record },
    result,
    record,
  };
}

function currentRevisionFromSnapshot(snapshot: RawTaskSnapshot | null): number | undefined {
  if (!snapshot) return undefined;
  return getProductResearchRecord(parseResultJson(snapshot.resultJson))?.revision;
}

async function loadCurrentRevision(context: AccessContext, taskId: string): Promise<number | undefined> {
  try {
    return currentRevisionFromSnapshot(await loadSnapshot(context, taskId));
  } catch {
    return undefined;
  }
}

export async function getProductResearchDecisionState(
  context: AccessContext,
  taskId: string,
): Promise<ProductResearchDecisionState> {
  const snapshot = await loadSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  if (!hasProductResearchRecordNamespace(result)) {
    return { taskId, legacy: true, readOnly: true, record: null };
  }
  return (await parseVersionedState(context, taskId, snapshot)).state;
}

export async function getCandidateResearchDecisionProjections(
  context: AccessContext,
  taskIds: readonly string[],
): Promise<Map<string, CandidateResearchDecisionProjection>> {
  const uniqueIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();
  const rows: Array<{ id: string; resultJson: string }> = context.mode === "demo"
    ? listSandboxTasks(context.demoAccessId)
      .filter((task) => uniqueIds.includes(task.id))
      .map((task) => ({ id: task.id, resultJson: task.resultJson }))
    : await prisma.viralAnalysisRecord.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, resultJson: true },
      });
  const projections = new Map<string, CandidateResearchDecisionProjection>();
  for (const row of rows) {
    const result = parseResultJson(row.resultJson);
    if (!hasProductResearchRecordNamespace(result)) {
      projections.set(row.id, {
        candidateId: null,
        summary: {
          schema: null,
          status: null,
          label: "旧版研究记录",
          reasonSummary: "",
          nextActionSummary: null,
          revision: null,
          decidedAt: null,
          legacy: true,
        },
      });
      continue;
    }
    const record = getProductResearchRecord(result);
    const verification = getProductResearchVerification(result);
    if (!record || !verification || !verifyProductResearchHash(record, verification)) continue;
    projections.set(row.id, {
      candidateId: record.candidateId,
      summary: toProductResearchDecisionSummary(record),
    });
  }
  return projections;
}

export async function updateProductResearchDecision(
  context: AccessContext,
  taskId: string,
  input: {
    expectedRevision: number;
    decision: ProductResearchDecisionInput;
    now?: string;
  },
): Promise<{
  kind: "updated" | "idempotent";
  state: ProductResearchDecisionState;
}> {
  const snapshot = await loadSnapshot(context, taskId);
  const parsed = await parseVersionedState(context, taskId, snapshot);
  const verification = getProductResearchVerification(parsed.result)!;
  let appended: ReturnType<typeof appendProductResearchDecision>;
  try {
    appended = appendProductResearchDecision({
      record: parsed.record,
      expectedRevision: input.expectedRevision,
      workflowStatus: verification.workflowStatus,
      reviewState: verification.reviewState,
      decision: input.decision,
      actor: buildProductResearchActor(context),
      now: input.now,
    });
  } catch (error) {
    if (error instanceof ProductResearchRecordError) {
      if (error.code === "revision_conflict") {
        throw new ProductResearchStoreError(
          "research_record_conflict",
          409,
          "研究记录已更新，请刷新后重试。",
          parsed.record.revision,
        );
      }
      const conflictCodes = new Set([
        "decision_id_conflict",
        "creative_ready_not_allowed",
        "partial_failed_requires_information",
        "decision_history_limit_reached",
        "revision_limit_reached",
        "research_record_too_large",
      ]);
      throw new ProductResearchStoreError(
        error.code,
        conflictCodes.has(error.code) ? 409 : 400,
        error.message,
        parsed.record.revision,
      );
    }
    throw error;
  }

  if (appended.kind === "idempotent") {
    return { kind: "idempotent", state: parsed.state };
  }

  const now = appended.record.updatedAt;
  const compatibilityStatus = productResearchDecisionToCompatibilityStatus(
    appended.record.latestDecision.status,
  );
  try {
    await mutateTaskResultJson({
      context,
      taskId,
      writer: "research-decision",
      expectedStorageVersion: {
        resultJson: snapshot.resultJson,
        updatedAt: snapshot.updatedAt,
      },
      mutate: createResearchDecisionResultMutation({
        record: appended.record,
        decisionStatus: compatibilityStatus,
        updatedAt: now,
      }),
    });
  } catch (error) {
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") notFound();
      if (error.code === "task_result_conflict") {
        throw new ProductResearchStoreError(
          "research_record_conflict",
          409,
          "研究记录已更新，请刷新后重试。",
          await loadCurrentRevision(context, taskId),
        );
      }
      throw new ProductResearchStoreError(error.code, error.status, error.message);
    }
    throw error;
  }

  return {
    kind: "updated",
    state: { taskId, legacy: false, readOnly: false, record: appended.record },
  };
}
