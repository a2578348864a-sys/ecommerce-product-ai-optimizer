/**
 * Phase 3/4 — 关键词 Evidence API（Preview → Human bind → Save → Workbench）
 * GET  /api/tasks/[id]/keyword-evidence  读取已保存的关键词证据 + storageVersion
 * POST action=save_browser_use           确认保存「采集关键词+竞品」产出的关键词预览（版本 CAS 校验）
 * 轮 12.5 合并：原 multipart 上传 XLSX 预览 / action=save 人工报表 / action=collect_browser_use 关键词采集已下线。
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  KeywordEvidenceError,
  getKeywordEvidence,
  readKeywordEvidenceSnapshot,
  saveKeywordEvidence,
  KEYWORD_EVIDENCE_SCHEMA,
  type KeywordEvidenceV1,
} from "@/lib/server/keywordEvidence";
import type { AccessContext } from "@/lib/server/accessPassword";
import {
  assertBrowserUseOwnerOnly,
  isAllowedCollectorSourceUrl,
  resolveBrowserUseSeed,
  takeBrowserUsePreview,
} from "@/lib/server/browserUseResearch";
import { getRuntimeMode } from "@/lib/server/runtimeMode";

export const runtime = "nodejs";

type StorageVersion = { resultJsonHash: string; updatedAt: string };

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
  if (error instanceof KeywordEvidenceError) {
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
    const evidence = await getKeywordEvidence(resolved.context, id);
    const snapshot = await readKeywordEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence, storageVersion: toStorageVersion(snapshot) },
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

  // 轮 12.5 合并：上传 XLSX 报表入口已下线（多上传入口与「采集关键词+竞品」职责冲突）。
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return errorResponse(400, "upload_disabled", "关键词报表上传已下线；关键词证据仅由「采集关键词+竞品」自动产生并人工确认。");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const bodyRecord = isRecord(body) ? body : {};
  if (asString(bodyRecord.action) !== "save_browser_use") {
    return errorResponse(400, "invalid_action", "未知操作（仅支持 action=save_browser_use；关键词采集/报表上传已合并下线）。");
  }

  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  try {
    assertBrowserUseOwnerOnly(resolved.context);
    if (getRuntimeMode() !== "local_owner") return errorResponse(403, "browser_use_local_env_required", "自动采集仅限本机环境使用。");
    const snapshot = await readKeywordEvidenceSnapshot(resolved.context, id);
    const record = (() => { try { const parsed = JSON.parse(snapshot.resultJson) as unknown; return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; } catch { return null; } })();
    const seed = resolveBrowserUseSeed(record);
    if (!seed) return errorResponse(409, "browser_use_identity_unavailable", "该任务没有可验证的权威商品身份（批次/卖家精灵事实缺失或不完整），无法自动采集。");

    const previewId = asString(bodyRecord.previewId);
    if (!previewId) return errorResponse(400, "preview_id_required", "缺少预览 ID。");
    const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
    if (expectedStorageVersion === null) return errorResponse(400, "storage_version_required", "内容刚在其他位置更新，请刷新后重试。");
    const preview = takeBrowserUsePreview(previewId);
    if (!preview) return errorResponse(400, "preview_not_found", "预览不存在或已过期，请重新采集。");
    if (preview.kind !== "keyword") return errorResponse(400, "preview_kind_mismatch", "预览类型与保存目标不一致。");
    if (!isAllowedCollectorSourceUrl(preview.sourceUrl)) return errorResponse(400, "forged_external_source_url", "采集来源不是 Amazon 官方页面，已拒绝保存。");
    if (preview.seedAsin !== seed.asin) return errorResponse(409, "seed_asin_mismatch", "当前任务的商品身份已变化，请重新采集后再确认。不做覆盖。");
    const rows = preview.results.map((item, index) => ({
      rowNumber: index + 1,
      keyword: item.keyword,
      keywordTranslation: item.keywordTranslation,
      fields: {
        ...(item.searchVolume !== null ? { monthlySearches: { raw: String(item.searchVolume), normalized: item.searchVolume, metricNature: "estimate" as const, applicability: "available" as const } } : {}),
        ...(item.relevance !== null ? { relevance: { raw: String(item.relevance), normalized: item.relevance, metricNature: "estimate" as const, applicability: "available" as const } } : {}),
        ...(item.competition !== null ? { competition: { raw: String(item.competition), normalized: item.competition, metricNature: "estimate" as const, applicability: "available" as const } } : {}),
      },
    }));
    if (rows.length === 0) return errorResponse(400, "no_valid_rows", "预览中没有可保存的关键词行。");
    const evidence: KeywordEvidenceV1 = {
      schema: KEYWORD_EVIDENCE_SCHEMA,
      reportType: "reverse_asin",
      capturedAt: preview.capturedAt,
      dataPeriod: null,
      rows,
      updatedAt: preview.capturedAt,
    };
    const saved = await saveKeywordEvidence({ context: resolved.context, taskId: id, evidence, expectedStorageVersion });
    const after = await readKeywordEvidenceSnapshot(resolved.context, id);
    return jsonResponse({ ok: true, data: { evidence: saved, storageVersion: toStorageVersion(after), saved: rows.map((row) => row.keyword) } });
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "browser_use_local_owner_only") {
      return errorResponse(403, "browser_use_local_owner_only", "Browser Use 自动采集仅限本机 Owner 使用。");
    }
    return errorResponseFrom(error);
  }
}

export type { KeywordEvidenceV1 };
