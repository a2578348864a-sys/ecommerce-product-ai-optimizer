import { NextRequest, NextResponse } from "next/server";
import { requireOwnerOnly } from "@/lib/server/demoGuard";
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

  const auth = requireOwnerOnly(request, body);
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

  const auth = requireOwnerOnly(request);
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
