import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireOwnerOnly } from "@/lib/server/demoGuard";
import {
  buildSellerSpriteOpportunityPreviewViewModel,
  SELLERSPRITE_PREVIEW_MAX_FILE_BYTES,
  SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES,
} from "@/lib/sellerSpriteOpportunityPreview";
import { buildSellerSpriteBriefBoundShadowReport } from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import { buildSellerSpriteMarketSnapshot } from "@/lib/upstream/sellersprite/marketSnapshot";
import { precheckSellerSpriteXlsx } from "@/lib/upstream/sellersprite/precheck";
import { createSellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";
import type { SellerSpriteReportType } from "@/lib/upstream/sellersprite/reportType";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewErrorCode =
  | "not_found"
  | "owner_required"
  | "origin_not_allowed"
  | "missing_file"
  | "unsupported_file_extension"
  | "file_too_large"
  | "report_type_required"
  | "unsupported_report_type"
  | "report_type_mismatch"
  | "query_not_applicable"
  | "unsafe_xlsx"
  | "unsupported_sheet"
  | "invalid_workbook"
  | "brief_validation_failed"
  | "no_accepted_rows"
  | "internal_error";

const ERROR_MESSAGES: Record<PreviewErrorCode, string> = {
  not_found: "该本地预览能力在当前环境不可用。",
  owner_required: "仅 Owner 可使用 SellerSprite 本地预览。",
  origin_not_allowed: "请求来源不受信任。",
  missing_file: "请选择一个 SellerSprite XLSX 文件。",
  unsupported_file_extension: "仅支持单个 .xlsx 文件。",
  file_too_large: "文件超过 10 MiB 限制。",
  report_type_required: "请选择 SellerSprite 报表类型。",
  unsupported_report_type: "该 SellerSprite 报表类型暂不受支持。",
  report_type_mismatch: "所选报表类型与文件结构不一致，请确认文件来源。",
  query_not_applicable: "类目当前商品报表不需要查询词，请移除后重试。",
  unsafe_xlsx: "XLSX 文件未通过安全检查。",
  unsupported_sheet: "未找到受支持的 SellerSprite US 商品工作表。",
  invalid_workbook: "XLSX 工作簿结构或字段不符合预检合同。",
  brief_validation_failed: "市场、查询、类目或 USD 价格范围无效。",
  no_accepted_rows: "工作簿没有可用于预览的有效商品行。",
  internal_error: "生成本地预览时发生内部错误。",
};

function errorResponse(code: PreviewErrorCode, status: number) {
  return NextResponse.json(
    { ok: false, error: { code, message: ERROR_MESSAGES[code] } },
    { status },
  );
}

function environmentGate() {
  return process.env.NODE_ENV === "production"
    ? errorResponse("not_found", 404)
    : null;
}

function ownerGate(request: NextRequest) {
  const guard = requireOwnerOnly(request);
  return guard.ok
    ? null
    : errorResponse("owner_required", guard.status);
}

function sameOriginGate(request: NextRequest) {
  const suppliedOrigin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  let expectedOrigin = requestUrl.origin;
  if (host !== null) {
    try {
      expectedOrigin = new URL(`${requestUrl.protocol}//${host}`).origin;
    } catch {
      return errorResponse("origin_not_allowed", 403);
    }
  }
  if (suppliedOrigin !== null) {
    return suppliedOrigin === expectedOrigin
      ? null
      : errorResponse("origin_not_allowed", 403);
  }
  const suppliedReferer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  try {
    if (
      suppliedReferer !== null
      && new URL(suppliedReferer).origin === expectedOrigin
      && (fetchSite === null || fetchSite === "same-origin")
    ) {
      return null;
    }
  } catch {
    // Fall through to the fail-closed response.
  }
  return errorResponse("origin_not_allowed", 403);
}

function contentLengthGate(request: NextRequest) {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length)
    && length >= 0
    && length <= SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES
    ? null
    : errorResponse("file_too_large", 413);
}

function isZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04)
    || (bytes[2] === 0x05 && bytes[3] === 0x06)
    || (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}

function singleTextField(formData: FormData, field: string): string | null {
  const values = formData.getAll(field);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function parseUsdValue(value: string | null): number | null {
  if (value === null || value === "" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function safeFileName(fileName: string): string | null {
  if (
    fileName === ""
    || fileName.includes("/")
    || fileName.includes("\\")
    || !fileName.toLowerCase().endsWith(".xlsx")
  ) {
    return null;
  }
  return fileName;
}

function workbookError(precheck: ReturnType<typeof precheckSellerSpriteXlsx>) {
  const fatalErrors = precheck.errors.filter(
    (error) => error.severity === "error" && error.rowNumber === undefined,
  );
  if (fatalErrors.length === 0) return null;
  if (fatalErrors.some((error) => error.code === "unsupported_sheet")) {
    return errorResponse("unsupported_sheet", 422);
  }
  if (fatalErrors.some((error) => error.code === "report_type_mismatch")) {
    return errorResponse("report_type_mismatch", 422);
  }
  if (fatalErrors.some((error) => error.code === "unsupported_report_type")) {
    return errorResponse("unsupported_report_type", 422);
  }
  if (
    fatalErrors.some((error) => (
      error.code === "invalid_xlsx"
      || error.code === "xlsx_file_too_large"
      || error.code === "xlsx_archive_limit_exceeded"
      || error.code === "unsupported_xlsx_feature"
      || error.code.startsWith("unsafe_xlsx_")
    ))
  ) {
    return errorResponse("unsafe_xlsx", 422);
  }
  return errorResponse("invalid_workbook", 422);
}

export async function GET(request: NextRequest) {
  const unavailable = environmentGate();
  if (unavailable) return unavailable;
  const denied = ownerGate(request);
  if (denied) return denied;
  return NextResponse.json({
    ok: true,
    data: {
      available: true,
      ownerOnly: true,
      productionEffect: false,
      productionDatabaseWritten: false,
    },
  });
}

export async function POST(request: NextRequest) {
  const unavailable = environmentGate();
  if (unavailable) return unavailable;

  const denied = ownerGate(request);
  if (denied) return denied;

  const wrongOrigin = sameOriginGate(request);
  if (wrongOrigin) return wrongOrigin;

  const tooLargeRequest = contentLengthGate(request);
  if (tooLargeRequest) return tooLargeRequest;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse("missing_file", 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("missing_file", 400);
  }

  const fileEntries = [...formData.entries()].filter(([, value]) => value instanceof File);
  const selectedFiles = formData.getAll("file").filter((value) => value instanceof File);
  if (fileEntries.length === 0 || selectedFiles.length === 0) {
    return errorResponse("missing_file", 400);
  }
  if (fileEntries.length !== 1 || selectedFiles.length !== 1) {
    return errorResponse("unsupported_file_extension", 400);
  }

  const file = selectedFiles[0];
  const sourceFileName = safeFileName(file.name);
  if (!sourceFileName) return errorResponse("unsupported_file_extension", 400);
  if (file.size === 0) return errorResponse("invalid_workbook", 422);
  if (file.size > SELLERSPRITE_PREVIEW_MAX_FILE_BYTES) {
    return errorResponse("file_too_large", 413);
  }

  const reportTypeValue = singleTextField(formData, "reportType");
  if (reportTypeValue === null || reportTypeValue === "") {
    return errorResponse("report_type_required", 400);
  }
  if (reportTypeValue !== "search_results" && reportTypeValue !== "category_current") {
    return errorResponse("unsupported_report_type", 400);
  }
  const reportType: SellerSpriteReportType = reportTypeValue;
  const queryEntries = formData.getAll("query");
  if (reportType === "category_current" && queryEntries.length > 0) {
    return errorResponse("query_not_applicable", 400);
  }
  const query = reportType === "search_results"
    ? singleTextField(formData, "query")
    : null;
  const category = singleTextField(formData, "category");
  const priceMin = parseUsdValue(singleTextField(formData, "priceMin"));
  const priceMax = parseUsdValue(singleTextField(formData, "priceMax"));
  if (
    (reportType === "search_results"
      && (query === null || query === "" || query.length > 200))
    || category === null
    || category === ""
    || category.length > 200
    || priceMin === null
    || priceMax === null
    || priceMin > priceMax
  ) {
    return errorResponse("brief_validation_failed", 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return errorResponse("invalid_workbook", 422);
  }
  if (!isZipMagic(bytes)) return errorResponse("unsafe_xlsx", 422);

  const now = new Date().toISOString();
  try {
    const precheck = precheckSellerSpriteXlsx(bytes, {
      capturedAt: now,
      expectedReportType: reportType,
    });
    const fatalWorkbookError = workbookError(precheck);
    if (fatalWorkbookError) return fatalWorkbookError;
    if (precheck.acceptedRows === 0) return errorResponse("no_accepted_rows", 422);

    const snapshot = buildSellerSpriteMarketSnapshot(precheck);
    const briefCommon = {
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      category,
      priceMin,
      priceMax,
      requiredSignals: reportType === "search_results"
        ? ["price", "rating", "reviews", "searchRank"]
        : ["price", "rating", "reviews"],
      optionalSignals: ["estimatedMonthlySales", "estimatedMonthlyRevenue", "variationCount"],
      createdAt: now,
      briefSource: "sellersprite-opportunity-preview-ui",
    };
    const brief = reportType === "search_results"
      ? createSellerSpriteShadowSelectionBrief({
          ...briefCommon,
          reportType,
          query: query!,
        })
      : createSellerSpriteShadowSelectionBrief({
          ...briefCommon,
          reportType,
          query: null,
        });
    const report = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
    const viewModel = buildSellerSpriteOpportunityPreviewViewModel({
      requestId: randomUUID(),
      sourceFileName,
      headerColumnCount: precheck.headerColumnCount,
      snapshot,
      report,
    });
    return NextResponse.json({ ok: true, data: viewModel });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SELLERSPRITE_BRIEF_")) {
      return errorResponse("brief_validation_failed", 400);
    }
    return errorResponse("internal_error", 500);
  }
}
