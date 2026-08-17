import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  ProductResearchStoreError,
  completeCurrentResearch,
} from "@/lib/server/productResearchRecordStore";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id?: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getTaskId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  return typeof id === "string" ? id.trim() : "";
}

function errorResponse(error: unknown) {
  if (error instanceof ProductResearchStoreError) {
    return json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
      },
    }, error.status);
  }
  return json({
    ok: false,
    error: { code: "server_error", message: "完成研究失败，请稍后重试。" },
  }, 500);
}

/**
 * V3 Current Research Normalization — POST /api/tasks/[id]/complete
 * 同一 canonical Research Task 的 lifecycle 收口（Active → Completed/Abandoned → 研究记录）。
 * auth / closure gate / idempotency / CAS / 单次持久化，均由 store.completeCurrentResearch 保证。
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return json({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status);
  }
  const taskId = await getTaskId(context);
  if (!taskId) return json({ ok: false, error: { code: "invalid_task_id", message: "缺少有效 task id。" } }, 400);
  try {
    const result = await completeCurrentResearch(auth.context, taskId, {});
    return json({
      ok: true,
      data: {
        taskId: result.taskId,
        lifecycle: result.lifecycle,
        researchRecord: result.researchRecord,
        completedAt: result.completedAt,
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
