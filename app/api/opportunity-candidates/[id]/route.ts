import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  isSandboxCandidateId,
  getSandboxCandidate,
  updateSandboxCandidate,
  deleteSandboxCandidate,
  sandboxCandidateToListItem,
} from "@/lib/server/demoSandbox";
import {
  isValidCandidateStatus,
  deleteCandidate,
  updateCandidate,
  type CandidateUpdate,
} from "@/lib/server/opportunityCandidateService";

export const runtime = "nodejs";

type ApiResponse =
  | { ok: true; candidate: unknown }
  | { ok: true; data: { id: string } }
  | { ok: false; error: { code: string; message: string } };

type RouteContext = { params: Promise<{ id: string }> };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ── PATCH ────────────────────────────────────── */

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return json({ ok: false, error: { code: "not_found", message: "缺少候选品 ID。" } }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }

  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_body", message: "请求体必须是 JSON object。" } }, 400);
  }

  // Demo-Sandbox.1-C: allow sandbox candidate PATCH for demo
  if (isSandboxCandidateId(id)) {
    const auth = requireAuthenticated(request, body);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const update: Record<string, unknown> = {};
      if (typeof body.status === "string" && isValidCandidateStatus(body.status)) update.status = body.status;
      if (typeof body.score === "number") update.score = body.score;
      if (typeof body.name === "string") update.name = body.name;
      if (body.link !== undefined) update.link = typeof body.link === "string" ? body.link : null;
      const updated = updateSandboxCandidate(auth.context.demoAccessId, id, update);
      if (!updated) return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
      return json({ ok: true, candidate: sandboxCandidateToListItem(updated) });
    }
    return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
  }

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  const update: CandidateUpdate = {};

  if (body.status !== undefined) {
    if (!isValidCandidateStatus(body.status)) {
      return json({ ok: false, error: { code: "invalid_payload", message: "状态值不合法。" } }, 400);
    }
    update.status = body.status;
  }

  if (body.convertedTaskId !== undefined) {
    update.convertedTaskId = typeof body.convertedTaskId === "string" && body.convertedTaskId.trim()
      ? body.convertedTaskId.trim()
      : null;
  }

  if (body.link !== undefined) update.link = typeof body.link === "string" ? body.link : null;
  if (typeof body.score === "number") update.score = body.score;
  if (typeof body.keyword === "string") update.keyword = body.keyword;

  try {
    const candidate = await updateCandidate(id, update);
    if (!candidate) {
      return json({ ok: false, error: { code: "not_found", message: "候选品不存在。" } }, 404);
    }
    return json({ ok: true, candidate });
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用。"
          : "更新失败，请稍后重试。",
      },
    }, 500);
  }
}

/* ── DELETE ───────────────────────────────────── */

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!id) return json({ ok: false, error: { code: "not_found", message: "缺少候选品 ID。" } }, 400);

  // Demo-Sandbox.1-C: allow sandbox candidate DELETE for demo
  if (isSandboxCandidateId(id)) {
    const auth = requireAuthenticated(request);
    if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
    if (auth.context.mode === "demo") {
      const deleted = deleteSandboxCandidate(auth.context.demoAccessId, id);
      if (!deleted) return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
      return json({ ok: true, data: { id } });
    }
    return json({ ok: false, error: { code: "not_found", message: "未找到该候选。" } }, 404);
  }

  const auth = requireAuthenticated(request);
  if (!auth.ok) return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });

  try {
    const deleted = await deleteCandidate(id);
    if (!deleted) {
      return json({ ok: false, error: { code: "not_found", message: "候选品不存在。" } }, 404);
    }
    return json({ ok: true, data: { id } });
  } catch (error) {
    return json({
      ok: false,
      error: {
        code: "server_error",
        message: error instanceof Error && error.message.includes("database")
          ? "数据库暂时不可用。"
          : "删除失败，请稍后重试。",
      },
    }, 500);
  }
}
