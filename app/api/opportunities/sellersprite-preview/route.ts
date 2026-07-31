import type { NextRequest } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { hasSellerSpritePreviewSameOrigin } from "@/lib/server/sellerSpritePreviewOrigin";
import { reserveSellerSpritePreviewRequest } from "@/lib/server/sellerSpritePreviewRateLimit";
import {
  SellerSpritePreviewError,
  precheckSellerSpritePreview,
} from "@/lib/upstream/sellersprite/preview";
import {
  DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS,
  isSellerSpritePreviewXlsxZipMagic,
  SellerSpritePreviewXlsxError,
} from "@/lib/upstream/sellersprite/previewXlsx";
import { generateSellerSpritePreviewImportToken } from "@/lib/server/sellerSpritePreviewImportToken";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = DEFAULT_SELLERSPRITE_PREVIEW_XLSX_LIMITS.maxSourceBytes;
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function error(
  status: number,
  code: string,
  message: string,
  details?: { reasonCode: string; stage: string },
): Response {
  return Response.json({ ok: false, error: { code, ...(details ?? {}), message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

function parseSingleFile(form: FormData): File | null {
  const entries = [...form.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "file") return null;
  const value = entries[0][1];
  return typeof value === "object" && value !== null && "arrayBuffer" in value && "name" in value
    ? value as File
    : null;
}

function hasSafeMultipartContentLength(request: Request): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_MULTIPART_BYTES;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!hasSellerSpritePreviewSameOrigin(request)) {
    return error(403, "same_origin_required", "请求来源无效。");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return error(415, "xlsx_multipart_required", "只接受单个 XLSX 文件上传。");
  }
  if (!hasSafeMultipartContentLength(request)) {
    return error(413, "upload_too_large", "上传内容大小无效或超出限制。");
  }

  const guard = requireAuthenticated(request);
  if (!guard.ok) return error(guard.status, guard.code, guard.message);
  const reservation = reserveSellerSpritePreviewRequest(subjectFromAccessContext(guard.context));
  if (!reservation.ok) return error(429, "preview_rate_limited", "预览请求过于频繁，请稍后重试。");

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return error(400, "invalid_multipart", "无法读取上传文件。");
    }
    const file = parseSingleFile(form);
    if (!file) return error(400, "single_xlsx_required", "只能上传一个名为 file 的 XLSX 文件。");
    if (!isSafeXlsxFileName(file.name) || !isSupportedXlsxMimeType(file.type)) {
      return error(415, "xlsx_required", "只支持卖家精灵导出的 Amazon 美国站搜索结果 XLSX。");
    }
    if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
      return error(413, "upload_too_large", "XLSX 文件大小超出限制。");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isSellerSpritePreviewXlsxZipMagic(bytes)) {
      return error(422, "invalid_xlsx", "XLSX 文件未通过安全检查。");
    }
    const preview = precheckSellerSpritePreview(bytes);

    let importToken: string | undefined;
    if (
      preview.blockingErrors.length === 0 &&
      preview.acceptedRowCount >= 1 &&
      preview.source.sourceFileSha256
    ) {
      const guard = requireAuthenticated(request);
      if (guard.ok) {
        try {
          const subjectScope = subjectFromAccessContext(guard.context);
          importToken = generateSellerSpritePreviewImportToken(
            subjectScope,
            preview.source.sourceFileSha256,
            preview.acceptedRowsDigest!,
            preview.acceptedRowCount,
            preview.warningDigest!,
            preview.warnings.length,
            preview.parserContractVersion!
          );
        } catch {
          // Token generation failed (e.g. SIGNING_KEY_MISSING).
          // Fail-closed: return preview without importToken.
        }
      }
    }

    return Response.json({ ok: true, preview: { ...preview, importToken } }, {
      status: preview.blockingErrors.length > 0 ? 422 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (caught) {
    if (caught instanceof SellerSpritePreviewXlsxError) {
      if (caught.code === "unsupported_xlsx_feature") {
        return error(
          422,
          caught.code,
          "该 XLSX 包含当前安全解析器不支持的工作簿特征。",
          {
            reasonCode: caught.reasonCode ?? "unsupported_ooxml_feature",
            stage: caught.stage ?? "ooxml_package",
          },
        );
      }
      return error(422, caught.code, "XLSX 文件未通过安全检查或报表合同校验。");
    }
    if (caught instanceof SellerSpritePreviewError) {
      return error(422, caught.code, "XLSX 文件未通过安全检查或报表合同校验。");
    }
    return error(422, "invalid_xlsx", "无法安全解析 XLSX 文件。");
  } finally {
    reservation.release();
  }
}
