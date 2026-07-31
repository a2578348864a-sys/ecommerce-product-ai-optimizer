import type { NextRequest } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { hasSellerSpritePreviewSameOrigin } from "@/lib/server/sellerSpritePreviewOrigin";
import {
  DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS,
  isSellerSpritePreviewXlsxZipMagic,
  SellerSpritePreviewXlsxError,
} from "@/lib/upstream/sellersprite/previewXlsx";
import {
  precheckSellerSpritePreview,
  SellerSpritePreviewError,
} from "@/lib/upstream/sellersprite/preview";
import {
  checkDuplicateAsin,
  confirmedIsTrue,
  parseSelectedRowHashes,
  reconcileSellerSpritePreviewAgainstToken,
  SELLERSPRITE_IMPORT_FIELDS,
  selectedRowHashesAreSubset,
  sellerSpriteImportRowFromPreview,
  verifySellerSpritePreviewTokenForImport,
  warningsAcceptedOk,
} from "@/lib/server/sellerSpriteImportContract";
import { importSellerSpriteCandidates } from "@/lib/server/sellerSpriteCandidateImport";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS.maxSourceBytes;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 128 * 1024;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function error(
  status: number,
  code: string,
  message: string,
  details?: { reasonCode?: string; stage?: string },
): Response {
  return Response.json(
    { ok: false, error: { code, ...(details ?? {}), message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function subjectFromAccessContext(context: { mode: string; demoAccessId?: string }): string {
  return context.mode === "demo" && context.demoAccessId
    ? `visitor:${context.demoAccessId}`
    : "owner";
}

function isSafeXlsxFileName(name: string): boolean {
  return Boolean(name)
    && !/[\\/\u0000]/.test(name)
    && name.toLowerCase().endsWith(".xlsx");
}

function isSupportedXlsxMimeType(value: string): boolean {
  return value.toLowerCase() === XLSX_MIME_TYPE;
}

function hasSafeMultipartContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_MULTIPART_BYTES;
}

function tokenStatusFor(code: string): number {
  if (code === "malformed_preview_token") return 400;
  if (code === "invalid_preview_token_signature" || code === "preview_token_subject_mismatch") return 403;
  return 422;
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Authentication (server-side binding of the token subject).
  const guard = requireAuthenticated(request);
  if (!guard.ok) return error(guard.status, guard.code, guard.message);

  // 2. Same-origin check.
  if (!hasSellerSpritePreviewSameOrigin(request)) {
    return error(403, "same_origin_required", "请求来源无效。");
  }

  // 3. Content-Type must be multipart/form-data.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return error(415, "xlsx_multipart_required", "只接受 multipart XLSX 提交。");
  }
  if (!hasSafeMultipartContentLength(request)) {
    return error(413, "upload_too_large", "上传内容大小无效或超出限制。");
  }

  // Parse form and enforce the exact allowed field set.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error(400, "invalid_multipart", "无法读取上传请求。");
  }

  const seenFields = new Set<string>();
  for (const [key] of form.entries()) {
    if (!(SELLERSPRITE_IMPORT_FIELDS as readonly string[]).includes(key)) {
      return error(400, "invalid_import_fields", "包含不受支持的导入字段。");
    }
    if (seenFields.has(key)) {
      return error(400, "invalid_import_fields", "导入字段重复。");
    }
    seenFields.add(key);
  }
  for (const field of SELLERSPRITE_IMPORT_FIELDS) {
    if (!seenFields.has(field)) {
      return error(400, "missing_import_field", `缺少导入字段 ${field}。`);
    }
  }

  // 4. Exactly one file named "file".
  const fileValue = form.get("file");
  const isFile = typeof fileValue === "object"
    && fileValue !== null
    && "arrayBuffer" in fileValue
    && "name" in fileValue
    && "size" in fileValue;
  if (!isFile) return error(400, "single_xlsx_required", "必须提供单个 file 字段。");
  const file = fileValue as File;

  // 5. File size bounds.
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    return error(413, "upload_too_large", "XLSX 文件大小超出限制。");
  }

  // 6. File name + MIME type.
  if (!isSafeXlsxFileName(file.name) || !isSupportedXlsxMimeType(file.type)) {
    return error(415, "xlsx_required", "只支持卖家精灵导出的 Amazon 美国站搜索结果 XLSX。");
  }

  // Extract string fields.
  const previewToken = String(form.get("previewToken") ?? "");
  const selectedRowHashesJson = String(form.get("selectedRowHashesJson") ?? "");
  const confirmed = String(form.get("confirmed") ?? "");
  const warningsAccepted = String(form.get("warningsAccepted") ?? "");

  // 7-10. Preview token format, signature, subject, and time.
  const subjectScope = subjectFromAccessContext(guard.context);
  const tokenResult = verifySellerSpritePreviewTokenForImport(previewToken, subjectScope);
  if (!tokenResult.ok) {
    return error(tokenStatusFor(tokenResult.code), tokenResult.code, "Preview Token 校验失败。");
  }

  // 11. Re-parse the submitted XLSX with the existing safe parser.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return error(400, "invalid_multipart", "无法读取上传文件。");
  }
  if (!isSellerSpritePreviewXlsxZipMagic(bytes)) {
    return error(422, "invalid_xlsx", "上传内容不是有效的 XLSX ZIP 文件。");
  }

  let preview;
  try {
    preview = precheckSellerSpritePreview(bytes);
  } catch (caught) {
    if (caught instanceof SellerSpritePreviewXlsxError) {
      return error(422, caught.code, "XLSX 未通过安全检查或报表合同校验。", {
        reasonCode: caught.reasonCode,
        stage: caught.stage,
      });
    }
    if (caught instanceof SellerSpritePreviewError) {
      return error(422, caught.code, "XLSX 未通过安全检查或报表合同校验。");
    }
    return error(422, "invalid_xlsx", "无法安全解析 XLSX 文件。");
  }

  // 12-17. Recompute file hash and digests and reconcile with the token.
  const acceptedRowHashes = preview.acceptedRows.map((row) => row.rowHash!);
  const reconciled = reconcileSellerSpritePreviewAgainstToken(
    {
      sourceFileSha256: preview.source.sourceFileSha256,
      acceptedRowsDigest: preview.acceptedRowsDigest,
      acceptedRowCount: preview.acceptedRowCount,
      warningDigest: preview.warningDigest,
      warnings: preview.warnings,
      acceptedRowHashes,
    },
    tokenResult.payload,
  );
  if (!reconciled.ok) {
    return error(422, reconciled.code, "XLSX 与 Preview Token 内容不一致。");
  }

  // 19-21. Parse and validate the selected row hash set.
  const selectedRowHashes = parseSelectedRowHashes(selectedRowHashesJson);
  if (!selectedRowHashes) {
    return error(400, "invalid_selected_rows", "selectedRowHashesJson 无效。");
  }
  if (!selectedRowHashesAreSubset(selectedRowHashes, reconciled.value.acceptedRowHashes)) {
    return error(422, "selected_rows_not_subset", "选中行不在合法 Preview 行集合内。");
  }

  // 23. Human confirmation.
  if (!confirmedIsTrue(confirmed)) {
    return error(422, "confirmation_required", "需要确认导入。");
  }

  // 24. Warnings acceptance.
  if (!warningsAcceptedOk(warningsAccepted, reconciled.value.warningCount)) {
    return error(422, "warnings_not_accepted", "报表存在警告但未确认接受。");
  }

  // 25. Rebuild selected rows from server-side parse results only.
  const byHash = new Map(preview.acceptedRows.map((row) => [row.rowHash!, row]));
  const selectedRows = selectedRowHashes.map((hash) => {
    const row = byHash.get(hash)!;
    return sellerSpriteImportRowFromPreview({ ...row, rowHash: row.rowHash! });
  });

  // 26. Reject duplicate ASINs in the same request before any write.
  const duplicateAsin = checkDuplicateAsin(selectedRows);
  if (duplicateAsin) {
    return error(422, "duplicate_selected_candidate_identity", "选中行包含重复 ASIN。");
  }

  // 27-28. Candidate Authority.
  const importedAt = new Date().toISOString();
  const summary = await importSellerSpriteCandidates({
    context: guard.context,
    rows: selectedRows,
    sourceFileSha256: reconciled.value.sourceFileSha256,
    importedAt,
  });

  return Response.json({ ok: true, ...summary, warnings: [] }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
