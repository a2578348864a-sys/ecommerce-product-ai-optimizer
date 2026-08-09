import { NextRequest, NextResponse } from "next/server";

import {
  PRODUCT_BATCH_MAX_XLSX_BYTES,
} from "@/lib/productBatchContract";
import { isAmazonUsTopLevelCategory } from "@/lib/productBatchPresentation";
import { productBatchResponseShape } from "@/lib/productBatchStore";
import {
  ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID,
} from "@/lib/marketScreeningProductionRegistry";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import {
  ProductBatchImportError,
  importSellerSpriteProductBatch,
  inspectSellerSpriteProductBatch,
} from "@/lib/server/productBatchImportService";
import {
  getProductBatchAccessSummary,
  getProductBatchStore,
} from "@/lib/server/productBatchStoreResolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = PRODUCT_BATCH_MAX_XLSX_BYTES + 64 * 1024;
const FORBIDDEN_CLIENT_FIELDS = [
  "ownerSubject",
  "demoAccessId",
  "storageMode",
  "accessMode",
  "snapshot",
  "ranking",
  "rankingHash",
  "normalizedBusinessHash",
  "sourceBoundSnapshotHash",
  "briefHash",
  "signalScore",
  "products",
  "componentScores",
] as const;

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

function sameOrigin(request: NextRequest): boolean {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  let expected = url.origin;
  if (host !== null) {
    try {
      expected = new URL(`${url.protocol}//${host}`).origin;
    } catch {
      return false;
    }
  }
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === expected;
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");
  try {
    return referer !== null
      && new URL(referer).origin === expected
      && (fetchSite === null || fetchSite === "same-origin");
  } catch {
    return false;
  }
}

function contentLengthAllowed(request: NextRequest): boolean {
  const raw = request.headers.get("content-length");
  if (raw === null) return true;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_REQUEST_BYTES;
}

function textField(formData: FormData, name: string): string | null {
  const values = formData.getAll(name);
  return values.length === 1 && typeof values[0] === "string"
    ? values[0].trim()
    : null;
}

function moneyField(
  formData: FormData,
  name: string,
): { ok: true; value: number | null } | { ok: false } {
  const values = formData.getAll(name);
  if (values.length === 0) return { ok: true, value: null };
  if (values.length !== 1 || typeof values[0] !== "string") return { ok: false };
  const value = values[0].trim();
  if (value === "") return { ok: true, value: null };
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) return { ok: false };
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? { ok: true, value: parsed }
    : { ok: false };
}

function safeFileName(value: string): string | null {
  return value
    && !value.includes("/")
    && !value.includes("\\")
    && value.toLowerCase().endsWith(".xlsx")
    ? value
    : null;
}

function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (
      (bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
}

function caughtError(error: unknown) {
  if (error instanceof ProductBatchImportError) {
    const badRequest = new Set([
      "brief_validation_failed",
      "report_type_required",
      "report_type_mismatch",
      "unsupported_report_type",
      "unsupported_sheet",
      "unsafe_or_invalid_workbook",
      "no_accepted_rows",
    ]);
    return errorResponse(
      badRequest.has(error.code) ? 422 : 500,
      error.code,
      error.code === "report_type_required"
        ? "无法自动识别报表类型，请手动选择后重试。"
        : badRequest.has(error.code)
          ? "SellerSprite 文件或筛选条件未通过检查。"
        : "ProductBatch 导入失败。",
    );
  }
  const code = error instanceof Error && "code" in error
    ? String((error as { code: unknown }).code)
    : "product_batch_internal_error";
  return errorResponse(500, code, "ProductBatch 操作失败。");
}

export async function GET(request: NextRequest) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  try {
    const store = getProductBatchStore(auth.context);
    const [batches, selection] = await Promise.all([
      store.listBatches(),
      store.getSelection(),
    ]);
    const access = getProductBatchAccessSummary(auth.context);
    return NextResponse.json({
      ok: true,
      data: productBatchResponseShape({
        ...access,
        batches,
        selection,
        legacyRegistrationId: ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID,
      }),
    });
  } catch (error) {
    return caughtError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) return errorResponse(auth.status, auth.code, auth.message);
  if (!sameOrigin(request)) {
    return errorResponse(403, "origin_not_allowed", "请求来源不受信任。");
  }
  if (!contentLengthAllowed(request)) {
    return errorResponse(413, "file_too_large", "文件超过 10 MiB 限制。");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return errorResponse(400, "missing_file", "请选择 SellerSprite XLSX 文件。");
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse(400, "missing_file", "请选择 SellerSprite XLSX 文件。");
  }
  if (FORBIDDEN_CLIENT_FIELDS.some((field) => formData.has(field))) {
    return errorResponse(
      400,
      "client_storage_or_ranking_field_forbidden",
      "不得由客户端选择身份、存储或排序结果。",
    );
  }
  const allFiles = [...formData.values()].filter((value) => value instanceof File);
  const selected = formData.getAll("file").filter((value) => value instanceof File);
  if (allFiles.length !== 1 || selected.length !== 1) {
    return errorResponse(400, "invalid_file_count", "仅支持一个 XLSX 文件。");
  }
  const file = selected[0];
  const sourceFileName = safeFileName(file.name);
  if (!sourceFileName) {
    return errorResponse(400, "unsupported_file_extension", "仅支持 .xlsx 文件。");
  }
  if (file.size === 0) {
    return errorResponse(422, "invalid_workbook", "XLSX 文件为空。");
  }
  if (file.size > PRODUCT_BATCH_MAX_XLSX_BYTES) {
    return errorResponse(413, "file_too_large", "文件超过 10 MiB 限制。");
  }
  const operation = textField(formData, "operation") || "import";
  if (operation !== "import" && operation !== "inspect") {
    return errorResponse(400, "unsupported_operation", "商品批次操作无效。");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return errorResponse(422, "invalid_workbook", "无法读取 XLSX 文件。");
  }
  if (!hasZipMagic(bytes)) {
    return errorResponse(422, "unsafe_xlsx", "XLSX 未通过安全检查。");
  }
  if (operation === "inspect") {
    try {
      return NextResponse.json({
        ok: true,
        data: inspectSellerSpriteProductBatch(bytes),
      });
    } catch (error) {
      return caughtError(error);
    }
  }
  const reportTypeValue = textField(formData, "reportType");
  const reportType = reportTypeValue === null || reportTypeValue === ""
    ? null
    : reportTypeValue;
  if (reportType !== null
    && reportType !== "search_results"
    && reportType !== "category_current") {
    return errorResponse(400, "unsupported_report_type", "报表类型无效。");
  }
  const queryEntries = formData.getAll("query");
  if (reportType === "category_current" && queryEntries.length > 0) {
    return errorResponse(400, "query_not_applicable", "类目当前商品报表不使用查询词。");
  }
  const query = reportType === "category_current" ? null : textField(formData, "query");
  const category = textField(formData, "category");
  const priceMinField = moneyField(formData, "priceMin");
  const priceMaxField = moneyField(formData, "priceMax");
  if (!priceMinField.ok || !priceMaxField.ok) {
    return errorResponse(
      400,
      "brief_validation_failed",
      "价格必须是大于等于 0、最多两位小数的美元金额。",
    );
  }
  const priceMin = priceMinField.value;
  const priceMax = priceMaxField.value;
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    return errorResponse(
      400,
      "brief_validation_failed",
      "最低价格不能高于最高价格。",
    );
  }
  if (
    (reportType === "search_results" && (!query || query.length > 200))
    || !category
    || category.length > 200
    || !isAmazonUsTopLevelCategory(category)
  ) {
    return errorResponse(400, "brief_validation_failed", "筛选条件无效。");
  }
  try {
    const store = getProductBatchStore(auth.context);
    const result = await importSellerSpriteProductBatch({
      store,
      bytes,
      sourceFileName,
      reportType,
      query,
      category,
      priceMin,
      priceMax,
    });
    if (result.batch.batchStatus === "archived") {
      return errorResponse(
        409,
        "product_batch_archived",
        "相同文件和研究条件对应的批次已归档，请调整研究条件后重新导入。",
      );
    }
    if (result.batch.batchStatus !== "ready") {
      return errorResponse(
        409,
        "product_batch_not_ready",
        "导入批次尚未就绪，不能设为当前批次。",
      );
    }
    const selection = await store.activateBatch(result.batch.id);
    const access = getProductBatchAccessSummary(auth.context);
    return NextResponse.json({
      ok: true,
      data: {
        ...access,
        batch: result.batch,
        selection,
        created: result.created,
      },
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return caughtError(error);
  }
}
