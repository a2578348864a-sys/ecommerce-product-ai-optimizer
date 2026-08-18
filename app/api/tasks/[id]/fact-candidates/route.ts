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
  type ConfirmedFactCandidate,
} from "@/lib/factCandidates";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { candidates: unknown[]; confirmed: unknown[]; storageVersion: StorageVersion } }
  | { ok: true; data: { confirmedCount: number; confirmed: unknown[]; storageVersion: StorageVersion } }
  | { ok: false; error: { code: string; message: string } };

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
  const snapshot = await loadSnapshot(auth.context, taskId);
  if (!snapshot) return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);

  // 服务端提取候选作为权威来源（客户端只能确认/修改值，不能伪造来源）
  const view = buildFactCandidateView(parseResultJson(snapshot.resultJson));
  const candidateMap = new Map(view.candidates.map((c) => [c.candidateId, c]));
  const confirmedMap = new Map(view.confirmed.map((c) => [c.candidateId, c]));

  const confirmed: ConfirmedFactCandidate[] = [];
  for (const raw of selectionsRaw) {
    if (!isRecord(raw)) {
      return jsonResponse({ ok: false, error: { code: "invalid_selection", message: "确认项结构无效。" } }, 400);
    }
    const candidateId = asString(raw.candidateId);
    const confirmedFlag = raw.confirmed === true;
    const existing = confirmedMap.get(candidateId);
    const candidate = candidateMap.get(candidateId);
    if (!confirmedFlag) continue; // 取消勾选 = 不写入（已确认项不在此接口撤销）
    if (!existing && !candidate) {
      return jsonResponse({ ok: false, error: { code: "candidate_not_found", message: "确认项不在候选列表中（来源不受支持）。" } }, 400);
    }
    const source = candidate ?? existing;
    if (!source) continue;
    // value：客户端可修改（人工核实值）；来源与引用以服务端提取为准
    const valueRaw = raw.value;
    const value = (typeof valueRaw === "string" && valueRaw.trim())
      ? valueRaw.trim()
      : (typeof valueRaw === "number" && Number.isFinite(valueRaw)) ? valueRaw : source.value;
    const now = new Date().toISOString();
    confirmed.push({
      candidateId: source.candidateId,
      field: source.field,
      label: source.label,
      value,
      sourceKind: source.sourceKind,
      sourceRef: source.sourceRef,
      humanConfirmationRequired: true,
      confirmedAt: existing?.confirmedAt ?? now,
      confirmedBy: existing?.confirmedBy ?? actorRef(auth.context),
    });
  }
  if (confirmed.length === 0) {
    return jsonResponse({ ok: false, error: { code: "no_confirmed_facts", message: "没有要确认的商品事实。" } }, 400);
  }

  try {
    const mutation = await mutateTaskResultJson({
      context: auth.context,
      taskId,
      writer: "fact-candidates",
      expectedStorageVersion,
      mutate: (current) => {
        const prior = getFactCandidates(current);
        const priorConfirmed = prior?.confirmed ?? [];
        const nextMap = new Map(priorConfirmed.map((c) => [c.candidateId, c]));
        for (const item of confirmed) nextMap.set(item.candidateId, item);
        const next: Record<string, unknown> = {
          schema: FACT_CANDIDATES_SCHEMA,
          version: FACT_CANDIDATES_VERSION,
          confirmed: [...nextMap.values()],
          updatedAt: new Date().toISOString(),
        };
        return {
          result: { ...current, factCandidates: next },
          value: { confirmedCount: confirmed.length, confirmed },
        };
      },
    });
    const value = mutation.value as { confirmedCount: number; confirmed: unknown[] };
    const snapshotAfter = await loadSnapshot(auth.context, taskId);
    return jsonResponse({
      ok: true,
      data: {
        confirmedCount: value.confirmedCount,
        confirmed: value.confirmed,
        storageVersion: snapshotAfter ? toStorageVersion(snapshotAfter) : expectedStorageVersion,
      },
    });
  } catch (error) {
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") {
        return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在或无权限。" } }, 404);
      }
      if (error.code === "task_result_conflict") {
        return jsonResponse({ ok: false, error: { code: "task_result_conflict", message: "内容刚在其他位置更新，请刷新后重试。" } }, 409);
      }
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status ?? 500);
    }
    throw error;
  }
}
