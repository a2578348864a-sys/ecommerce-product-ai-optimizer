/**
 * Phase 5 — AI 证据总结 API
 * GET  /api/tasks/[id]/ai-evidence-summary  读取已生成总结 + storageVersion
 * POST /api/tasks/[id]/ai-evidence-summary  生成（复用 provider 治理 + demo 配额 + run trace）
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { consumeDemoAiCalls, ensureDemoAiQuota, requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  AiEvidenceSummaryError,
  getAiEvidenceSummary,
  generateAiEvidenceSummary,
  readAiSummarySnapshot,
} from "@/lib/server/aiEvidenceSummary";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function errorResponse(status: number, code: string, message: string) {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function toStorageVersion(snapshot: { resultJson: string; updatedAt: Date | string }) {
  return {
    resultJsonHash: createHash("sha256").update(snapshot.resultJson, "utf8").digest("hex"),
    updatedAt: snapshot.updatedAt instanceof Date
      ? snapshot.updatedAt.toISOString()
      : String(snapshot.updatedAt),
  };
}

function parseStorageVersionInput(value: unknown): { resultJsonHash: string; updatedAt: string } | null {
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
      return { ok: false, response: jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status) };
    }
    if (auth.context.mode !== "demo") {
      return { ok: false, response: errorResponse(404, "not_found", "未找到该任务。") };
    }
    return { ok: true, context: auth.context };
  }
  const auth = requireOwnerOnly(request, bodyRecord);
  if (!auth.ok) {
    return { ok: false, response: jsonResponse({ ok: false, error: { code: auth.code, message: auth.message } }, auth.status) };
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

function errorResponseFrom(error: unknown): NextResponse {
  if (error instanceof AiEvidenceSummaryError) {
    return errorResponse(error.status, error.code, error.message);
  }
  return errorResponse(500, "server_error", "服务器错误，请稍后重试。");
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return errorResponse(400, "invalid_id", "缺少有效 task id。");
  const resolved = await resolveContext(request, id);
  if (!resolved.ok) return resolved.response;
  try {
    const summary = await getAiEvidenceSummary(resolved.context, id);
    const snapshot = await readAiSummarySnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { summary, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponseFrom(error);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const id = await getId(context);
  if (!id) return errorResponse(400, "invalid_id", "缺少有效 task id。");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const bodyRecord = isRecord(body) ? body : {};
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return errorResponse(400, "storage_version_required", "缺少或非法的 expectedStorageVersion（并发保护）。");
  }

  // demo 配额（复用研究辅助配额体系）
  if (resolved.context.mode === "demo") {
    const quota = ensureDemoAiQuota(resolved.context, 1);
    if (!quota.ok) {
      return jsonResponse({ ok: false, error: { code: quota.code, message: quota.message } }, quota.status);
    }
  }

  try {
    const { summary, unverified, gateResult } = await generateAiEvidenceSummary({
      context: resolved.context,
      taskId: id,
      expectedStorageVersion,
    });
    if (resolved.context.mode === "demo") {
      consumeDemoAiCalls(resolved.context, 1);
    }
    const snapshot = await readAiSummarySnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: {
        summary,
        unverified,
        gateResult,
        storageVersion: toStorageVersion(snapshot),
      },
    });
  } catch (error) {
    return errorResponseFrom(error);
  }
}
