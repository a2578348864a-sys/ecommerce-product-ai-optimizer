/**
 * Core-4-Fix.1 — PATCH /api/tasks/[id]/listing-pack
 * Save/update listing pack snapshot in task resultJson.
 * No schema change, no AI call, no auto-publish.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  TaskResultJsonMutationError,
  mutateTaskResultJson,
} from "@/lib/server/taskResultJsonMutation";
import {
  buildListingPackSnapshot,
  createListingPackResultMutation,
} from "@/lib/server/taskResultWriterServices";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; data: { id: string; savedAt: string } }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id?: string }> },
) {
  const id = (await params).id;
  if (!id) return json({ ok: false, error: { code: "missing_id", message: "缺少任务 ID。" } }, 400);

  let body: unknown;
  try { body = await request.json(); } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体格式错误。" } }, 400);
  }

  const bodyRecord = isRecord(body) ? body : {};
  const snapshot = bodyRecord.listingPackSnapshot;

  if (!isRecord(snapshot)) {
    return json({ ok: false, error: { code: "missing_snapshot", message: "缺少 listingPackSnapshot。" } }, 400);
  }

  // Safety enforcement
  const enforcedSnapshot = buildListingPackSnapshot(snapshot);

  let context;
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode !== "demo") {
      return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
    }
    context = auth.context;
  } else {
    const auth = requireOwnerOnly(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    context = auth.context;
  }

  try {
    await mutateTaskResultJson({
      context,
      taskId: id,
      writer: "listing-pack",
      mutate: createListingPackResultMutation(enforcedSnapshot),
    });
    return json({ ok: true, data: { id, savedAt: enforcedSnapshot.savedAt as string } });
  } catch (error) {
    if (error instanceof TaskResultJsonMutationError) {
      if (error.code === "not_found") {
        return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
      }
      if (error.status === 409) {
        return json({ ok: false, error: { code: error.code, message: error.message } }, 409);
      }
    }
    return json({ ok: false, error: { code: "save_failed", message: "保存失败，请稍后重试。" } }, 500);
  }
}
