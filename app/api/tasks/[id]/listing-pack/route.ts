/**
 * Core-4-Fix.1 — PATCH /api/tasks/[id]/listing-pack
 * Save/update listing pack snapshot in task resultJson.
 * No schema change, no AI call, no auto-publish.
 */

import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import {
  getSandboxTask,
  updateSandboxTask,
  isSandboxTaskId,
} from "@/lib/server/demoSandbox";

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
  const safety = isRecord(snapshot.safety) ? snapshot.safety : {};
  const enforcedSafety = {
    ...safety,
    unverifiedClaimsSanitized: true,
    requiresHumanReview: true,
    autoListing: false,
  };

  const enforcedSnapshot = {
    ...snapshot,
    safety: enforcedSafety,
    savedAt: new Date().toISOString(),
  };

  // Demo sandbox
  if (isSandboxTaskId(id)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

    const existing = getSandboxTask(auth.context.mode === "demo" ? auth.context.demoAccessId : "", id);
    if (!existing) return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);

    let existingResult: Record<string, unknown> = {};
    try { existingResult = JSON.parse(existing.resultJson || "{}"); } catch { /* ignore */ }
    const merged = { ...existingResult, listingPackSnapshot: enforcedSnapshot };
    const updated = updateSandboxTask(auth.context.mode === "demo" ? auth.context.demoAccessId : "", id, { resultJson: JSON.stringify(merged) });
    if (!updated) return json({ ok: false, error: { code: "save_failed", message: "保存失败。" } }, 500);
    return json({ ok: true, data: { id: updated.id, savedAt: enforcedSnapshot.savedAt as string } });
  }

  // Owner: Prisma
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  try {
    const existing = await prisma.viralAnalysisRecord.findUnique({
      where: { id },
      select: { resultJson: true },
    });
    if (!existing) return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);

    let existingResult: Record<string, unknown> = {};
    try { existingResult = JSON.parse(existing.resultJson || "{}"); } catch { /* ignore */ }
    const merged = { ...existingResult, listingPackSnapshot: enforcedSnapshot };

    await prisma.viralAnalysisRecord.update({
      where: { id },
      data: { resultJson: JSON.stringify(merged) },
    });

    return json({ ok: true, data: { id, savedAt: enforcedSnapshot.savedAt as string } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return json({ ok: false, error: { code: "not_found", message: "任务不存在。" } }, 404);
    }
    return json({ ok: false, error: { code: "save_failed", message: "保存失败，请稍后重试。" } }, 500);
  }
}
