import "server-only";

import { createHash } from "node:crypto";

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
} from "@/lib/server/taskResultJsonMutation";
import {
  ProductResearchRecordError,
  RESEARCH_COMPLETION_SCHEMA,
  appendProductResearchDecision,
  buildProductResearchActor,
  buildProductResearchHash,
  computeResearchEvidenceHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  getProductResearchRecord,
  getProductResearchVerification,
  getResearchCompletion,
  getResearchStaleState,
  hasProductResearchRecordNamespace,
  parseResearchCompletion,
  productResearchDecisionToCompatibilityStatus,
  toProductResearchDecisionSummary,
  type ProductResearchDecisionSummary,
  type ProductResearchRecordV1,
  type ProductResearchReviewState,
  type ResearchCompletionV1,
  verifyProductResearchHash,
  type ProductResearchDecisionInput,
  type ProductResearchHashInput,
} from "@/lib/productResearchRecord";
import { getResearchTaskCandidateId } from "@/lib/productResearchImage";
import { taskResultWriterPersistence } from "@/lib/server/taskResultWriterServices";

type RawTaskSnapshot = {
  id: string;
  updatedAt: Date | string;
  resultJson: string;
  decisionStatus: string;
};

/**
 * V3 Current Research Normalization：无 Agent workflow 复核流程的当前 Research
 * （candidate_research 等直接人工收集 Evidence）——reviewState = 无复核步骤。
 */
const NO_WORKFLOW_REVIEW: ProductResearchReviewState = {
  sourcingReviewed: false,
  riskReviewed: false,
  summaryReviewed: false,
  listingReviewed: false,
  reviewedCount: 0,
  totalReviewSteps: 0,
  allReviewed: true,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * 从当前 Research（无 researchRecord）创建正式 product-research-record.v1（revision 1）。
 * - candidateId 来自 resultJson 绑定（sourceMeta/candidateToTask，与 creative-handoff gate 同源）；
 * - runId/contextHash/inputHash/resultHash 为确定性绑定指纹（锁定 task↔candidate 关系，
 *   不伪造"内容完整性"承诺；verification 写入后 record 修改即 hash 失配）；
 * - workflowStatus="completed"（研究已收集 Evidence）；reviewState=无 workflow 复核；
 * - 单次持久化：record + verification + decisionStatus 同步（同一 canonical Task，不复制）。
 */
async function createCurrentResearchDecision(
  context: AccessContext,
  taskId: string,
  snapshot: RawTaskSnapshot,
  input: {
    expectedRevision: number;
    decision: ProductResearchDecisionInput;
    now?: string;
  },
): Promise<{ kind: "created"; state: ProductResearchDecisionState }> {
  if (input.expectedRevision !== 1) {
    throw new ProductResearchStoreError(
      "research_record_conflict",
      409,
      "研究记录尚未创建，请刷新后重试。",
    );
  }
  const result = parseResultJson(snapshot.resultJson);
  const candidateId = getResearchTaskCandidateId(result);
  if (!candidateId) {
    throw new ProductResearchStoreError(
      "research_binding_invalid",
      409,
      "研究记录与候选商品的绑定缺失，不能创建正式研究记录。",
    );
  }
  const runId = taskId;
  const contextHash = sha256(`context:${taskId}:${candidateId}`);
  const inputHash = sha256(`input:${taskId}:${candidateId}`);
  const resultHash = sha256(`result:${taskId}:${candidateId}`);
  const hashInput: ProductResearchHashInput = {
    schema: "product-research-hash.v1",
    candidateId,
    runId,
    contextHash,
    inputHash,
    resultHash,
    workflowStatus: "completed",
    reviewState: NO_WORKFLOW_REVIEW,
  };
  const researchHash = buildProductResearchHash(hashInput);
  const verification = createProductResearchVerification(hashInput);
  let record: ProductResearchRecordV1;
  try {
    record = createInitialProductResearchRecord({
      candidateId,
      runId,
      contextHash,
      researchHash,
      workflowStatus: "completed",
      reviewState: NO_WORKFLOW_REVIEW,
      decision: input.decision,
      actor: buildProductResearchActor(context),
      now: input.now,
    });
  } catch (error) {
    if (error instanceof ProductResearchRecordError) {
      throw new ProductResearchStoreError(error.code, 400, error.message);
    }
    throw error;
  }
  const compatibilityStatus = productResearchDecisionToCompatibilityStatus(record.latestDecision.status);
  try {
    await taskResultWriterPersistence.persistResearchDecision({
      context,
      taskId,
      expectedStorageVersion: {
        resultJson: snapshot.resultJson,
        updatedAt: snapshot.updatedAt,
      },
      record,
      verification,
      decisionStatus: compatibilityStatus,
      updatedAt: record.updatedAt,
    });
  } catch (error) {
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") notFound();
      if (error.code === "task_result_conflict") {
        throw new ProductResearchStoreError(
          "research_record_conflict",
          409,
          "研究记录已更新，请刷新后重试。",
        );
      }
      throw new ProductResearchStoreError(error.code, error.status, error.message);
    }
    throw error;
  }
  return {
    kind: "created",
    state: { taskId, legacy: false, readOnly: false, record },
  };
}

export type CompleteCurrentResearchResult = {
  taskId: string;
  lifecycle: "completed" | "abandoned";
  researchRecord: boolean;
  completedAt: string;
  idempotent: boolean;
  /** V3 UX Closure：研究资料在完成后发生变化，本次为重新确认 */
  reconfirmed?: boolean;
};

/**
 * V3 Current Research Normalization：Research Completion（同一 canonical Task 的 lifecycle 收口）。
 * Gate：当前 actor；CURRENT_ACTIVE；人工决定已保存（record 存在）且 finalStatus != needs_information；
 * 幂等：已 researchCompletion → 返回当前状态（不重复、不新建 Task/Record）；
 * 单次持久化（CAS）：写入 research-completion.v1 命名空间 + 更新时间。
 */
export async function completeCurrentResearch(
  context: AccessContext,
  taskId: string,
  input: { now?: string },
): Promise<CompleteCurrentResearchResult> {
  const snapshot = await loadSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  const existing = getResearchCompletion(result);
  const record = getProductResearchRecord(result);
  if (!record) {
    throw new ProductResearchStoreError(
      "research_decision_required",
      409,
      "请先保存人工决定，再完成研究。",
    );
  }
  const now = input.now ?? new Date().toISOString();
  const currentEvidenceHash = computeResearchEvidenceHash(result);
  // V3 UX Closure Staleness：已存在 completion 时，若完成研究后证据内容发生变化
  // （evidenceHash 失配）→ 允许重新确认（更新证据指纹 + 完成时间，reconfirmed）；
  // 否则幂等返回现有状态。
  if (existing) {
    const existingHash = existing.evidenceHash ?? null;
    const stale = existingHash !== null
      && currentEvidenceHash !== null
      && existingHash !== currentEvidenceHash;
    if (!stale) {
      return {
        taskId,
        lifecycle: existing.status,
        researchRecord: true,
        completedAt: existing.completedAt,
        idempotent: true,
      };
    }
    const reconfirmed: ResearchCompletionV1 = {
      ...existing,
      completedAt: now,
      ...(currentEvidenceHash ? { evidenceHash: currentEvidenceHash } : {}),
    };
    try {
      await taskResultWriterPersistence.persistResearchCompletion({
        context,
        taskId,
        expectedStorageVersion: {
          resultJson: snapshot.resultJson,
          updatedAt: snapshot.updatedAt,
        },
        completion: reconfirmed,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof TaskResultJsonMutationError) {
        if (error.code === "not_found") notFound();
        if (error.code === "task_result_conflict") {
          throw new ProductResearchStoreError(
            "research_record_conflict",
            409,
            "研究记录已更新，请刷新后重试。",
          );
        }
        throw new ProductResearchStoreError(error.code, error.status, error.message);
      }
      throw error;
    }
    return {
      taskId,
      lifecycle: reconfirmed.status,
      researchRecord: true,
      completedAt: now,
      idempotent: false,
      reconfirmed: true,
    };
  }
  if (record.latestDecision.status === "needs_information") {
    throw new ProductResearchStoreError(
      "research_need_info",
      409,
      "当前仍需补充资料，补充后再完成研究。",
    );
  }
  const completion: ResearchCompletionV1 = {
    schema: RESEARCH_COMPLETION_SCHEMA,
    status: record.latestDecision.status === "abandoned" ? "abandoned" : "completed",
    completedAt: now,
    decisionId: record.latestDecision.decisionId,
    revision: record.revision,
    finalStatus: record.latestDecision.status,
    ...(currentEvidenceHash ? { evidenceHash: currentEvidenceHash } : {}),
  };
  try {
    await taskResultWriterPersistence.persistResearchCompletion({
      context,
      taskId,
      expectedStorageVersion: {
        resultJson: snapshot.resultJson,
        updatedAt: snapshot.updatedAt,
      },
      completion,
      updatedAt: now,
    });
  } catch (error) {
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") notFound();
      if (error.code === "task_result_conflict") {
        throw new ProductResearchStoreError(
          "research_record_conflict",
          409,
          "研究记录已更新，请刷新后重试。",
        );
      }
      throw new ProductResearchStoreError(error.code, error.status, error.message);
    }
    throw error;
  }
  return {
    taskId,
    lifecycle: completion.status,
    researchRecord: true,
    completedAt: now,
    idempotent: false,
  };
}

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
    label: "待人工决定";
    reasonSummary: "";
    nextActionSummary: null;
    revision: null;
    decidedAt: null;
    legacy: false;
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
  // V3 Current Research Normalization：
  // - 无 researchRecord 的当前 Research（candidate_research 等，有当前 Evidence）不是 legacy，
  //   是可编辑的 CURRENT_ACTIVE（首次保存决定时创建 researchRecord）；
  // - 已有 researchRecord 且已 researchCompletion 的 CURRENT_COMPLETED → 决定只读（§30/§32）。
  if (!hasProductResearchRecordNamespace(result)) {
    return { taskId, legacy: false, readOnly: false, record: null };
  }
  const state = (await parseVersionedState(context, taskId, snapshot)).state;
  const completion = getResearchCompletion(result);
  if (completion) {
    return { ...state, readOnly: true };
  }
  return state;
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
      // V3 Current Research Normalization：无 researchRecord 的当前 Research = 待人工决定（非 legacy）
      projections.set(row.id, {
        candidateId: null,
        summary: {
          schema: null,
          status: null,
          label: "待人工决定",
          reasonSummary: "",
          nextActionSummary: null,
          revision: null,
          decidedAt: null,
          legacy: false,
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
  kind: "updated" | "created" | "idempotent";
  state: ProductResearchDecisionState;
}> {
  const snapshot = await loadSnapshot(context, taskId);
  const result = parseResultJson(snapshot.resultJson);
  // V3 Current Research Normalization：无 researchRecord 的当前 Research（candidate_research 等）
  // 首次保存人工决定 → 创建正式 product-research-record.v1（revision 1），与新版任务同一 writer。
  if (!hasProductResearchRecordNamespace(result)) {
    return createCurrentResearchDecision(context, taskId, snapshot, input);
  }
  if (getResearchCompletion(result)) {
    throw new ProductResearchStoreError(
      "research_record_completed",
      409,
      "该研究已完成并保存到研究记录，决定不再修改。",
    );
  }
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
    await taskResultWriterPersistence.persistResearchDecision({
      context,
      taskId,
      expectedStorageVersion: {
        resultJson: snapshot.resultJson,
        updatedAt: snapshot.updatedAt,
      },
      record: appended.record,
      decisionStatus: compatibilityStatus,
      updatedAt: now,
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
