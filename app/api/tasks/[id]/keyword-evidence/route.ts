/**
 * Phase 3/4 — 关键词 Evidence API（Preview → Human bind → Save → Workbench）
 * GET  /api/tasks/[id]/keyword-evidence  读取已保存的关键词证据 + storageVersion
 * POST action=preview  multipart 上传 XLSX → parseKeywordReport（不保存，Preview）
 * POST action=save     人工确认后保存解析结果（writer keyword-evidence）
 */
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated, requireOwnerOnly } from "@/lib/server/demoGuard";
import { isSandboxTaskId } from "@/lib/server/demoSandbox";
import {
  KeywordEvidenceError,
  getKeywordEvidence,
  keywordReportToEvidence,
  readKeywordEvidenceSnapshot,
  saveKeywordEvidence,
  type KeywordEvidenceV1,
} from "@/lib/server/keywordEvidence";
import { parseKeywordReport } from "@/lib/upstream/sellersprite/keywordReports";
import { parseXlsxWorkbook, SellerSpriteXlsxError } from "@/lib/upstream/sellersprite/xlsx";
import type { AccessContext } from "@/lib/server/accessPassword";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  if (error instanceof SellerSpriteXlsxError) {
    return errorResponse(400, error.code, error.message);
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

  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType.includes("multipart/form-data");

  // ── Preview：multipart 上传 XLSX → 解析（不保存） ──
  if (isMultipart) {
    const resolved = await resolveContext(request, id);
    if (!resolved.ok) return resolved.response;
    try {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return errorResponse(400, "invalid_upload", "缺少上传文件。");
      }
      if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
        return errorResponse(400, "upload_too_large", "文件大小超出限制（10MB）。");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const workbook = parseXlsxWorkbook(bytes);
      const sheet = workbook.sheets[0];
      const headerRow = sheet?.rows.find((row) => row.values.some((value) => value && value.trim().length > 0));
      if (!sheet || !headerRow) {
        return errorResponse(400, "unsupported_sheet", "未找到有效报表工作表。");
      }
      const headers = headerRow.values.map((value) => (value ?? "").trim());
      const rows = sheet.rows
        .filter((row) => row.rowNumber > headerRow.rowNumber)
        .map((row) => row.values);
      const parsed = parseKeywordReport({
        headers,
        rows,
        capturedAt: new Date().toISOString(),
      });
      if (!parsed.ok) {
        return errorResponse(400, parsed.code, parsed.message);
      }
      return jsonResponse({
        ok: true,
        data: { preview: parsed.report },
      });
    } catch (error) {
      return errorResponseFrom(error);
    }
  }

  // ── Save：人工确认后保存解析结果 ──
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体不是合法 JSON。");
  }
  const bodyRecord = isRecord(body) ? body : {};
  if (asString(bodyRecord.action) !== "save") {
    return errorResponse(400, "invalid_action", "未知操作（仅支持 action=save 或 multipart 上传预览）。");
  }
  const resolved = await resolveContext(request, id, bodyRecord);
  if (!resolved.ok) return resolved.response;

  const expectedStorageVersion = parseStorageVersionInput(bodyRecord.expectedStorageVersion);
  if (expectedStorageVersion === null) {
    return errorResponse(400, "storage_version_required", "缺少或非法的 expectedStorageVersion（并发保护）。");
  }
  const reportRaw = bodyRecord.report;
  if (!isRecord(reportRaw)) {
    return errorResponse(400, "invalid_report", "缺少解析结果（report）。");
  }
  const parsedReport = parseKeywordReportFromJson(reportRaw);
  if (parsedReport === null) {
    return errorResponse(400, "invalid_report", "解析结果结构无效（应为 sellersprite-keyword-report.v1）。");
  }
  try {
    const evidence = keywordReportToEvidence(parsedReport, new Date().toISOString());
    const saved = await saveKeywordEvidence({
      context: resolved.context,
      taskId: id,
      evidence,
      expectedStorageVersion,
    });
    const snapshot = await readKeywordEvidenceSnapshot(resolved.context, id);
    return jsonResponse({
      ok: true,
      data: { evidence: saved, storageVersion: toStorageVersion(snapshot) },
    });
  } catch (error) {
    return errorResponseFrom(error);
  }
}

/** 从客户端回传的 report JSON 重建 KeywordReport（校验 schema 与必填字段） */
function parseKeywordReportFromJson(value: Record<string, unknown>): Parameters<typeof keywordReportToEvidence>[0] | null {
  if (value.schema !== "sellersprite-keyword-report.v1") return null;
  const reportType = value.reportType;
  if (reportType !== "reverse_asin" && reportType !== "keyword_mining") return null;
  const capturedAt = asString(value.capturedAt);
  if (!capturedAt) return null;
  if (!Array.isArray(value.rows)) return null;
  const rows = value.rows.filter(isRecord).map((row) => ({
    rowNumber: typeof row.rowNumber === "number" ? row.rowNumber : 0,
    keyword: asString(row.keyword),
    keywordTranslation: row.keywordTranslation === null || row.keywordTranslation === undefined
      ? null
      : asString(row.keywordTranslation),
    fields: isRecord(row.fields) ? row.fields : {},
  }));
  if (rows.length === 0 || rows.some((row) => !row.keyword)) return null;
  return {
    schema: "sellersprite-keyword-report.v1" as const,
    reportType,
    capturedAt,
    dataPeriod: null,
    headerColumnCount: typeof value.headerColumnCount === "number" ? value.headerColumnCount : 0,
    rows: rows as unknown as Parameters<typeof keywordReportToEvidence>[0]["rows"],
  };
}

export type { KeywordEvidenceV1 };
