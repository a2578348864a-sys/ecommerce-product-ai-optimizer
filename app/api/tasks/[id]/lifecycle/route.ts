/**
 * Phase 4-E.2.1 — PATCH /api/tasks/[id]/lifecycle
 * Update workflow task product lifecycle state.
 * No schema changes — writes to resultJson.productLifecycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { isSandboxTaskId, updateSandboxTaskLifecycle, getSandboxTask } from "@/lib/server/demoSandbox";
import { Prisma } from "@prisma/client";
import {
  isValidLifecycleStatus,
  isValidLifecycleReasonCode,
  isValidLifecycleTransition,
  normalizeProductLifecycle,
  getLifecycleStatusLabel,
  transitionLifecycle,
  type LifecycleStatus,
} from "@/lib/workflowLifecycle";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; taskId: string; productLifecycle: ReturnType<typeof normalizeProductLifecycle> }
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

async function getId(context: { params: Promise<{ id: string }> }): Promise<string | null> {
  try {
    const { id } = await context.params;
    return id || null;
  } catch {
    return null;
  }
}

function isDatabaseError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  const bodyRecord = isRecord(body) ? body : {};

  // Task ID
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);

  // Demo-Sandbox.1-B: allow sandbox lifecycle for demo
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const updated = updateSandboxTaskLifecycle(auth.context.demoAccessId, id, bodyRecord);
      if (!updated) return jsonResponse({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, 404);
      const parsed = (() => { try { return JSON.parse(updated.productLifecycle); } catch { return {}; } })();
      return jsonResponse({ ok: true, taskId: updated.id, productLifecycle: parsed });
    }
    return jsonResponse({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, 404);
  }

  // Auth — Demo-Login.1-F: Owner only for official tasks
  const auth = requireAuthenticated(request, bodyRecord);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
  if (!id) {
    return jsonResponse({ ok: false, error: { code: "invalid_id", message: "无效的任务 ID。" } }, 400);
  }

  // Validate status
  const newStatus = asString(bodyRecord.status);
  if (!isValidLifecycleStatus(newStatus)) {
    return jsonResponse({ ok: false, error: { code: "invalid_status", message: "无效的状态值。" } }, 400);
  }

  // Validate reasonCode
  const reasonCode = asString(bodyRecord.reasonCode);
  if (reasonCode && !isValidLifecycleReasonCode(reasonCode)) {
    return jsonResponse({ ok: false, error: { code: "invalid_reason_code", message: "无效的原因代码。" } }, 400);
  }

  // Validate reasonText
  const reasonText = asString(bodyRecord.reasonText).slice(0, 300);
  if (reasonCode === "other" && !reasonText) {
    return jsonResponse({ ok: false, error: { code: "reason_text_required", message: "选择「其他」原因时，必须填写具体说明。" } }, 400);
  }

  try {
    // Fetch task
    const task = await prisma.viralAnalysisRecord.findUnique({
      where: { id },
      select: { id: true, type: true, resultJson: true },
    });

    if (!task) {
      return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
    }

    // Only workflow tasks
    if (task.type !== "workflow") {
      return jsonResponse({ ok: false, error: { code: "wrong_task_type", message: "只有单品分析任务支持生命周期状态。" } }, 400);
    }

    // Parse current resultJson
    let parsed: Record<string, unknown> = {};
    try {
      if (typeof task.resultJson === "string") {
        parsed = JSON.parse(task.resultJson);
      } else if (isRecord(task.resultJson)) {
        parsed = task.resultJson as Record<string, unknown>;
      }
    } catch {
      return jsonResponse({ ok: false, error: { code: "invalid_result_json", message: "任务数据损坏，无法读取。" } }, 500);
    }

    // Get current lifecycle
    const currentLifecycle = normalizeProductLifecycle(parsed.productLifecycle);

    // Validate transition
    if (!isValidLifecycleTransition(currentLifecycle?.status || "analyzed", newStatus as LifecycleStatus)) {
      const fromLabel = currentLifecycle ? getLifecycleStatusLabel(currentLifecycle.status) : "已分析";
      const toLabel = getLifecycleStatusLabel(newStatus as LifecycleStatus);
      return jsonResponse({
        ok: false,
        error: { code: "invalid_transition", message: `无法从「${fromLabel}」切换到「${toLabel}」。` },
      }, 400);
    }

    // Transition
    const result = transitionLifecycle(currentLifecycle, newStatus as LifecycleStatus, reasonCode || undefined, reasonText || undefined);
    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error }, 400);
    }

    // Update resultJson
    const updatedResultJson = { ...parsed, productLifecycle: result.lifecycle };

    await prisma.viralAnalysisRecord.update({
      where: { id },
      data: { resultJson: JSON.stringify(updatedResultJson) },
    });

    return jsonResponse({
      ok: true,
      taskId: id,
      productLifecycle: result.lifecycle,
    });
  } catch (error) {
    if (isDatabaseError(error) && (error as Prisma.PrismaClientKnownRequestError).code === "P2025") {
      return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
    }
    return jsonResponse({ ok: false, error: { code: "server_error", message: "服务器错误，请稍后重试。" } }, 500);
  }
}
