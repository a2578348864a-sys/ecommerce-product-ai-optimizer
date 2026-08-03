/**
 * Phase 4-E.2.1 — PATCH /api/tasks/[id]/lifecycle
 * Update workflow task product lifecycle state.
 * No schema changes — writes to resultJson.productLifecycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
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

class LifecycleMutationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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

  let accessContext;
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode !== "demo") {
      return jsonResponse({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, 404);
    }
    accessContext = auth.context;
  } else {
    const auth = requireOwnerOnly(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    accessContext = auth.context;
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
    const mutation = await mutateTaskResultJson({
      context: accessContext,
      taskId: id,
      writer: "lifecycle",
      mutate: (current, snapshot) => {
        if (snapshot.type !== "workflow") {
          throw new LifecycleMutationError("wrong_task_type", 400, "只有单品分析任务支持生命周期状态。");
        }
        let lifecycleSource = current.productLifecycle;
        if (lifecycleSource === undefined && snapshot.productLifecycle) {
          try { lifecycleSource = JSON.parse(snapshot.productLifecycle); } catch { lifecycleSource = undefined; }
        }
        const currentLifecycle = normalizeProductLifecycle(lifecycleSource);
        if (!isValidLifecycleTransition(currentLifecycle?.status || "analyzed", newStatus as LifecycleStatus)) {
          const fromLabel = currentLifecycle ? getLifecycleStatusLabel(currentLifecycle.status) : "已分析";
          const toLabel = getLifecycleStatusLabel(newStatus as LifecycleStatus);
          throw new LifecycleMutationError(
            "invalid_transition",
            400,
            `无法从「${fromLabel}」切换到「${toLabel}」。`,
          );
        }
        const result = transitionLifecycle(
          currentLifecycle,
          newStatus as LifecycleStatus,
          reasonCode || undefined,
          reasonText || undefined,
        );
        if (!result.ok) {
          throw new LifecycleMutationError(result.error.code, 400, result.error.message);
        }
        return {
          result: { ...current, productLifecycle: result.lifecycle },
          value: result.lifecycle,
          visitorProductLifecycle: JSON.stringify(result.lifecycle),
        };
      },
    });

    return jsonResponse({
      ok: true,
      taskId: id,
      productLifecycle: mutation.value,
    });
  } catch (error) {
    if (error instanceof LifecycleMutationError) {
      return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") {
        return jsonResponse({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
      }
      if (error.status === 409) {
        return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, 409);
      }
    }
    return jsonResponse({ ok: false, error: { code: "server_error", message: "服务器错误，请稍后重试。" } }, 500);
  }
}
