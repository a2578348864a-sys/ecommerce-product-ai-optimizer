/**
 * Phase 2 — 竞品 Evidence API（competitor-evidence.v1 合同）
 * GET  /api/tasks/[id]/competitor-evidence  读取竞品列表 + storageVersion
 * POST /api/tasks/[id]/competitor-evidence  人工添加（上限 5、去重）
 * DELETE /api/tasks/[id]/competitor-evidence 删除单条
 * 只允许人工维护；写入经 mutateTaskResultJson（writer 所有权 + 乐观并发）。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  addCompetitorAsin,
  CompetitorEvidenceError,
  getCompetitorEvidence,
  readCompetitorEvidenceSnapshot,
  removeCompetitorAsin,
  type CompetitorEvidenceV1,
} from "@/lib/server/competitorEvidence";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };
type ApiResponse =
  | { ok: true; data: { evidence: CompetitorEvidenceV1; storageVersion: StorageVersion } }
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

async function resolveContext(
  request: NextRequest,
  taskId: string,
  bodyRecord?: Record<string, unknown>,
): Promise<{ ok: true; context: AccessContext } | { ok: false; response: NextResponse }> {
  if (isSandboxTaskId(taskId)) {
    const auth = requireAuthenticated(request, bodyRecord);
    if (!auth.ok) {
      return { ok: false, response: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
    }
    if (auth.context.mode !== "demo") {
      return { ok: false, response: jsonResponse({ ok: false, error: { code: "not_found", message: "未找到该任务。" } }, 404) };
    }
    return { ok: true, context: auth.context };
  }
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status }) };
  }
  return { ok: true, context: auth.context };
}

async function getId(context: { params: Promise<{ id: string }> }): Promise<string | null> {
  try {
    const { id } = await context.params;
    return id || null;
  } catch {
    return null;
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CompetitorEvidenceError) {
    return jsonResponse({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  }
  return jsonResponse({ ok: false, error: { code: "server_error", message: "服务器错误，请稍后重试。" } }, 500);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);
  const resolved = await resolveContext(request, id);
  if (!resolved.ok) return resolved.response;
  try {
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    const evidence = await getCompetitorEvidence(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);
  const bodyRecord = isRecord(body) ? body : {};
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  const asin = asString(bodyRecord.asin);
  if (!asin) {
    return jsonResponse({ ok: false, error: { code: "invalid_asin", message: "缺少 ASIN。" } }, 400);
  }
  const note = bodyRecord.note === undefined ? undefined : asString(bodyRecord.note);
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }

  try {
    const evidence = await addCompetitorAsin({
      context: resolved.context,
      taskId: id,
      asin,
      note,
      expectedStorageVersion,
    });
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  const id = await getId(context);
  if (!id) return jsonResponse({ ok: false, error: { code: "invalid_id", message: "缺少有效 task id。" } }, 400);
  const bodyRecord = isRecord(body) ? body : {};
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  const asin = asString(bodyRecord.asin);
  if (!asin) {
    return jsonResponse({ ok: false, error: { code: "invalid_asin", message: "缺少 ASIN。" } }, 400);
  }
  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return jsonResponse({
      ok: false,
      error: { code: "storage_version_required", message: "内容刚在其他位置更新，请刷新后重试。" },
    }, 400);
  }

  try {
    const evidence = await removeCompetitorAsin({
      context: resolved.context,
      taskId: id,
      asin,
      expectedStorageVersion,
    });
    const snapshot = await readCompetitorEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
