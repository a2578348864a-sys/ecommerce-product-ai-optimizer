/**
 * V3 UX Closure — Fact Candidate API（fact-candidates.v1）
 * GET  /api/tasks/[id]/fact-candidates  提取候选 + 已确认事实（服务端权威视图）
 * POST /api/tasks/[id]/fact-candidates  批量人工确认（selections: [{candidateId, field, label, value, sourceKind, sourceRef, confirmed}]）
 *
 * 安全：
 * - requireAuthenticated / subject binding / expectedStorageVersion CAS；
 * - 候选仅来自确定性来源（SellerSprite / browserEvidence / 标题派生）；AI/VOC/competitor/seller claims 不进入；
 * - 确认写入独立 writer（fact-candidates namespace），不绕过 Human Confirmation Authority；
 * - 客户端提交的 value 作为「人工修改值」持久化（Human Review 语义），但 sourceKind/sourceRef 以服务端提取为准。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { isSandboxTaskId, getSandboxTask } from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";
import { mutateTaskResultJson, TaskResultJsonMutationError } from "@/lib/server/taskResultJsonMutation";
import {
  buildFactCandidateView,
  FACT_CANDIDATES_SCHEMA,
  FACT_CANDIDATES_VERSION,
  getFactCandidates,
  humanManualCandidateId,
  MANUAL_FACT_FIELDS,
  type ConfirmedFactCandidate,
  type FactCandidate,
} from "@/lib/factCandidates";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { candidates: unknown[]; confirmed: unknown[]; storageVersion: StorageVersion } }
  | {
      ok: true;
      data: {
        confirmedCount: number;
        alreadyConfirmedCount: number;
        conflicts: FactConfirmConflictView[];
        confirmed: unknown[];
        storageVersion: StorageVersion;
      };
    }
  | { ok: false; error: { code: string; message: string; conflicts?: FactConfirmConflictView[] } };

function jsonResponse(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toStorageVersion(snapshot: { resultJson: string; updatedAt: Date | string }): StorageVersion {
  return {
    resultJsonHash: createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex"),
    updatedAt: snapshot.updatedAt instanceof Date
      ? snapshot.updatedAt.toISOString()
      : String(snapshot.updatedAt),
  };
}

function parseStorageVersionInput(value: unknown): StorageVersion | null {
  if (!isRecord(value)) return null;
  const hash = asString(value.resultJsonHash);
  const updatedAt = asString(value.updatedAt);
  if (!/^[a-f0-9]{64}$/.test(hash) || !updatedAt) return null;
  return { resultJsonHash: hash, updatedAt };
}

async function loadSnapshot(
  context: AccessContext,
  taskId: string,
): Promise<{ resultJson: string; updatedAt: Date | string } | null> {
  if (context.mode === "demo") {
    if (!isSandboxTaskId(taskId)) return null;
    const task = getSandboxTask(context.demoAccessId, taskId);
    if (!task) return null;
    return { resultJson: task.resultJson, updatedAt: task.updatedAt };
  }
  if (isSandboxTaskId(taskId)) return null;
  const task = await prisma.viralAnalysisRecord.findFirst({
    where: { id: taskId },
    select: { resultJson: true, updatedAt: true },
  });
  if (!task) return null;
  return { resultJson: task.resultJson, updatedAt: task.updatedAt };
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function actorRef(context: AccessContext): string {
  return context.mode === "demo" ? `visitor:${context.demoAccessId}` : "owner:v1";
}

// ── V3 Final HWF Fact Batch Confirmation（CAS / Conflict / Selection Preservation） ──
// Root Cause：fact-candidates 的 CAS 用整个 resultJson 的 hash——任何无关 namespace 更新
// （competitor/keyword/ai-summary/browser/voc/review/sourcing/visual-reference/research-save 等）
// 都会使 hash 变化，导致用户批量确认时 409「请重新勾选确认」（FALSE_CONFLICT）。
// 修复语义（不删除 CAS，不 Last Write Wins）：
// - 批量确认 = ONE BATCH MUTATION（mutate 回调内基于实际写入版本做 fingerprint 终检）；
// - Safe Rebase：409 时用最新版本自动重试 1 次（任务书 §9/§10）；
// - Partial Conflict：无冲突项确认、冲突项返回复核（§11）；
// - 幂等：已确认且同值 → alreadyConfirmed，不重复写入、不 bump 版本（§16/§17）。

export type FactConfirmConflictReason = "candidate_missing" | "value_changed";

export type FactConfirmConflictView = {
  candidateId: string;
  label: string;
  reason: FactConfirmConflictReason;
};

type BatchCheckResult = {
  /** 本次实际要写入的确认项（新增或 Human Review 修改值） */
  confirmed: ConfirmedFactCandidate[];
  /** 已确认且同值（幂等，不写） */
  alreadyConfirmed: Array<{ candidateId: string }>;
  /** 真实冲突（fail-closed，不写） */
  conflicts: FactConfirmConflictView[];
};

class FactBatchConflictError extends Error {
  constructor(public readonly conflicts: FactConfirmConflictView[]) {
    super("fact_conflict");
    this.name = "FactBatchConflictError";
  }
}

function checkBatchSelections(
  view: { candidates: FactCandidate[]; confirmed: ConfirmedFactCandidate[] },
  selectionsRaw: unknown[],
  actor: string,
): { ok: true; result: BatchCheckResult } | { ok: false; code: string; message: string } {
  const candidateMap = new Map(view.candidates.map((c) => [c.candidateId, c]));
  const confirmedMap = new Map(view.confirmed.map((c) => [c.candidateId, c]));
  const confirmed: ConfirmedFactCandidate[] = [];
  const alreadyConfirmed: Array<{ candidateId: string }> = [];
  const conflicts: FactConfirmConflictView[] = [];

  for (const raw of selectionsRaw) {
    if (!isRecord(raw)) {
      return { ok: false, code: "invalid_selection", message: "确认项结构无效。" };
    }
    const candidateId = asString(raw.candidateId);
    if (raw.confirmed !== true) continue; // 取消勾选 = 不写入（已确认项不在此接口撤销）
    const existing = confirmedMap.get(candidateId);
    const candidate = candidateMap.get(candidateId);

    // 手动补充项（human_manual）：服务端白名单校验字段，来源固定 human_manual（人工核实）
    if (!existing && !candidate && candidateId.startsWith("human_manual:")) {
      const field = candidateId.slice("human_manual:".length);
      const registryEntry = MANUAL_FACT_FIELDS.find((entry) => entry.field === field);
      if (!registryEntry) {
        return { ok: false, code: "invalid_manual_field", message: "该事实字段不在支持列表中。" };
      }
      const valueRaw = raw.value;
      const value = (typeof valueRaw === "string" && valueRaw.trim())
        ? valueRaw.trim().slice(0, 500)
        : (typeof valueRaw === "number" && Number.isFinite(valueRaw)) ? valueRaw : null;
      if (value === null || value === "") {
        return { ok: false, code: "manual_value_required", message: "请填写该商品事实的值。" };
      }
      const now = new Date().toISOString();
      confirmed.push({
        candidateId: humanManualCandidateId(field),
        field,
        label: registryEntry.label,
        value,
        sourceKind: "human_manual",
        sourceRef: "human_manual.supplied",
        humanConfirmationRequired: true,
        confirmedAt: now,
        confirmedBy: actor,
      });
      continue;
    }
    if (!existing && !candidate) {
      // 候选已被删除/合并 → REAL_CONFLICT（candidate_missing），fail-closed
      conflicts.push({ candidateId, label: "", reason: "candidate_missing" });
      continue;
    }
    const source = candidate ?? existing;
    if (!source) continue;
    const submittedRaw = raw.value;
    // Human Review 不允许空值确认（人工核实必须有值；空串视为未填写）
    if (submittedRaw !== undefined && submittedRaw !== null
      && typeof submittedRaw === "string" && !submittedRaw.trim()) {
      return { ok: false, code: "manual_value_required", message: "请填写该商品事实的值。" };
    }
    const submittedStr = submittedRaw === undefined || submittedRaw === null
      ? null
      : String(submittedRaw).trim();
    const currentStr = String(source.value).trim();
    const edited = raw.edited === true; // 用户在 UI 显式修改过值（Human Review CORRECT）

    if (existing) {
      // 已确认：同值 → 幂等；不同值 → Human Review 修改（允许更新值）
      if (submittedStr === null || submittedStr === currentStr) {
        alreadyConfirmed.push({ candidateId });
      } else {
        confirmed.push({
          candidateId: source.candidateId,
          field: source.field,
          label: source.label,
          value: (typeof submittedRaw === "string" || typeof submittedRaw === "number")
            ? submittedRaw
            : source.value,
          sourceKind: source.sourceKind,
          sourceRef: source.sourceRef,
          humanConfirmationRequired: true,
          confirmedAt: existing.confirmedAt,
          confirmedBy: existing.confirmedBy,
        });
      }
      continue;
    }
    // 未确认候选：用户显式修改或提交值与当前候选一致 → 可确认；
    // 否则候选值已被其他操作改变（用户看到的是旧值）→ REAL_CONFLICT（value_changed）
    if (edited || submittedStr === null || submittedStr === currentStr) {
      const now = new Date().toISOString();
      confirmed.push({
        candidateId: source.candidateId,
        field: source.field,
        label: source.label,
        value: (typeof submittedRaw === "string" || typeof submittedRaw === "number")
          ? submittedRaw
          : source.value,
        sourceKind: source.sourceKind,
        sourceRef: source.sourceRef,
        humanConfirmationRequired: true,
        confirmedAt: now,
        confirmedBy: actor,
      });
    } else {
      conflicts.push({ candidateId, label: source.label, reason: "value_changed" });
    }
  }
  return { ok: true, result: { confirmed, alreadyConfirmed, conflicts } };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id?: string }> }) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }
  const { id } = await context.params;
  const taskId = asString(id);
  if (!taskId) return jsonResponse({ ok: false, error: { code: "invalid_task_id", message: "缺少有效 task id。" } }, 400);
  const snapshot = await loadSnapshot(auth.context, taskId);
  if (!snapshot) return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);
  const result = parseResultJson(snapshot.resultJson);
  const view = buildFactCandidateView(result);
  return jsonResponse({
    ok: true,
    data: { candidates: view.candidates, confirmed: view.confirmed, storageVersion: toStorageVersion(snapshot) },
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id?: string }> }) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }
  const { id } = await context.params;
  const taskId = asString(id);
  if (!taskId) return jsonResponse({ ok: false, error: { code: "invalid_task_id", message: "缺少有效 task id。" } }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  const bodyRecord = isRecord(body) ? body : {};
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({ ok: false, error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" } }, 400);
  }
  const selectionsRaw = bodyRecord.selections;
  if (!Array.isArray(selectionsRaw) || selectionsRaw.length === 0 || selectionsRaw.length > 50) {
    return jsonResponse({ ok: false, error: { code: "invalid_selection", message: "请选择要确认的商品事实（1-50 项）。" } }, 400);
  }
  const actor = actorRef(auth.context);
  const preSnapshot = await loadSnapshot(auth.context, taskId);
  if (!preSnapshot) return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);

  // ── 1) 预检（最新版本）：幂等短路 + 全冲突提前 fail-closed（不写） ──
  const preCheck = checkBatchSelections(
    buildFactCandidateView(parseResultJson(preSnapshot.resultJson)),
    selectionsRaw,
    actor,
  );
  if (!preCheck.ok) {
    return jsonResponse({ ok: false, error: { code: preCheck.code, message: preCheck.message } }, 400);
  }
  const pre = preCheck.result;
  if (pre.confirmed.length === 0) {
    if (pre.conflicts.length > 0) {
      // 全部真实冲突：fail-closed，不写任何确认
      return jsonResponse({
        ok: false,
        error: {
          code: "fact_conflict",
          message: "这几条商品资料刚发生变化，系统没有替你确认。请检查最新内容后再确认。",
          conflicts: pre.conflicts,
        },
      }, 409);
    }
    // 全部已确认且同值：幂等，不重复写入、不 bump 版本（不触发 Stale）
    return jsonResponse({
      ok: true,
      data: {
        confirmedCount: 0,
        alreadyConfirmedCount: pre.alreadyConfirmed.length,
        conflicts: [],
        confirmed: [],
        storageVersion: toStorageVersion(preSnapshot),
      },
    });
  }

  // ── 2) ONE BATCH MUTATION（mutate 回调基于实际写入版本做 fingerprint 终检） ──
  const runMutation = (expected: StorageVersion) => mutateTaskResultJson({
    context: auth.context,
    taskId,
    writer: "fact-candidates",
    expectedStorageVersion: expected,
    mutate: (current) => {
      const check = checkBatchSelections(buildFactCandidateView(current), selectionsRaw, actor);
      if (!check.ok) {
        throw new TaskResultJsonMutationError(check.code, 400, check.message);
      }
      const { confirmed: toWrite, alreadyConfirmed, conflicts } = check.result;
      if (toWrite.length === 0 && conflicts.length > 0) {
        // 终检发现全部真实冲突（如 Safe Rebase 窗口内候选又变化）→ fail-closed
        throw new FactBatchConflictError(conflicts);
      }
      if (toWrite.length === 0) {
        // 终检发现全部已确认同值（并发幂等）→ 不写
        return {
          result: current,
          value: { confirmedCount: 0, alreadyConfirmedCount: alreadyConfirmed.length, conflicts, confirmed: [] },
        };
      }
      const prior = getFactCandidates(current);
      const nextMap = new Map((prior?.confirmed ?? []).map((c) => [c.candidateId, c]));
      for (const item of toWrite) nextMap.set(item.candidateId, item);
      const next: Record<string, unknown> = {
        schema: FACT_CANDIDATES_SCHEMA,
        version: FACT_CANDIDATES_VERSION,
        confirmed: [...nextMap.values()],
        updatedAt: new Date().toISOString(),
      };
      return {
        result: { ...current, factCandidates: next },
        value: { confirmedCount: toWrite.length, alreadyConfirmedCount: alreadyConfirmed.length, conflicts, confirmed: toWrite },
      };
    },
  });

  const respondSuccess = async (mutation: { value: { confirmedCount: number; alreadyConfirmedCount: number; conflicts: FactConfirmConflictView[]; confirmed: unknown[] } }) => {
    const snapshotAfter = await loadSnapshot(auth.context, taskId);
    return jsonResponse({
      ok: true,
      data: {
        confirmedCount: mutation.value.confirmedCount,
        alreadyConfirmedCount: mutation.value.alreadyConfirmedCount,
        conflicts: mutation.value.conflicts,
        confirmed: mutation.value.confirmed,
        storageVersion: snapshotAfter ? toStorageVersion(snapshotAfter) : expectedStorageVersion,
      },
    });
  };

  const conflictResponse = (conflicts: FactConfirmConflictView[]) => jsonResponse({
    ok: false,
    error: {
      code: "fact_conflict",
      message: "这几条商品资料刚发生变化，系统没有替你确认。请检查最新内容后再确认。",
      conflicts,
    },
  }, 409);

  try {
    const mutation = await runMutation(expectedStorageVersion);
    return respondSuccess(mutation);
  } catch (error) {
    if (error instanceof FactBatchConflictError) {
      return conflictResponse(error.conflicts);
    }
    if (error instanceof TaskResultJsonMutationError && error.code === "task_result_conflict") {
      // ── 3) SAFE REBASE：最多 1 次（任务书 §9/§10）──
      // 无关更新导致 CAS 过期（FALSE_CONFLICT）→ 用最新版本重新验证同一 batch；
      // 候选 fingerprint 未变 → 自动重试成功（用户无感）。
      const latestSnapshot = await loadSnapshot(auth.context, taskId);
      if (!latestSnapshot) return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);
      const rebaseCheck = checkBatchSelections(
        buildFactCandidateView(parseResultJson(latestSnapshot.resultJson)),
        selectionsRaw,
        actor,
      );
      if (!rebaseCheck.ok) {
        return jsonResponse({ ok: false, error: { code: rebaseCheck.code, message: rebaseCheck.message } }, 400);
      }
      if (rebaseCheck.result.confirmed.length === 0) {
        if (rebaseCheck.result.conflicts.length > 0) return conflictResponse(rebaseCheck.result.conflicts);
        return jsonResponse({
          ok: true,
          data: {
            confirmedCount: 0,
            alreadyConfirmedCount: rebaseCheck.result.alreadyConfirmed.length,
            conflicts: [],
            confirmed: [],
            storageVersion: toStorageVersion(latestSnapshot),
          },
        });
      }
      try {
        const rebaseMutation = await runMutation(toStorageVersion(latestSnapshot));
        return respondSuccess(rebaseMutation);
      } catch (rebError) {
        if (rebError instanceof FactBatchConflictError) return conflictResponse(rebError.conflicts);
        if (rebError instanceof TaskResultJsonMutationError && rebError.code === "task_result_conflict") {
          // 重试后仍冲突 = 真实并发竞态：不再自动重试，返回真实冲突 UI
          return jsonResponse({ ok: false, error: { code: "task_result_conflict", message: "内容刚刚发生变化，请刷新后重试。" } }, 409);
        }
        throw rebError;
      }
    }
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") {
        return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);
      }
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status ?? 500);
    }
    throw error;
  }
}
