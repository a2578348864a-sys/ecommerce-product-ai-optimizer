const EVIDENCE_SCHEMA_VERSION = "sellersprite_preview_acceptance_evidence_v1";

const ERROR_SUMMARIES = new Map([
  ["same_origin_required", "请求来源无效。"],
  ["xlsx_multipart_required", "上传合同不符合要求。"],
  ["upload_too_large", "上传大小无效或超出限制。"],
  ["invalid_multipart", "上传内容无法读取。"],
  ["single_xlsx_required", "上传结构不符合要求。"],
  ["xlsx_required", "文件类型不符合要求。"],
  ["invalid_xlsx", "XLSX 未通过安全检查或报表合同校验。"],
  ["unsupported_xlsx_feature", "该 XLSX 包含当前安全解析器不支持的工作簿特征。"],
  ["preview_rate_limited", "预览请求过于频繁。"],
  ["access_password_required", "认证未通过。"],
  ["access_password_invalid", "认证未通过。"],
  ["unauthorized", "认证未通过。"],
]);

const UNSUPPORTED_XLSX_REASON_CODES = new Set([
  "unsupported_zip_compression",
  "zip64_rejected",
  "multidisk_zip_rejected",
  "encrypted_zip_entry",
  "unsupported_zip_flags",
  "unsafe_zip_entry_path",
  "duplicate_zip_entry",
  "dtd_or_entity_rejected",
  "macro_enabled_workbook",
  "formula_cell_rejected",
  "external_relationship_rejected",
  "external_hyperlink_relationship_rejected",
  "insecure_hyperlink_relationship_rejected",
  "local_hyperlink_target_rejected",
  "private_network_hyperlink_rejected",
  "invalid_hyperlink_target_rejected",
  "hyperlink_target_too_long",
  "external_drawing_or_image_relationship_rejected",
  "external_workbook_relationship_rejected",
  "external_link_rejected",
  "ole_object_rejected",
  "activex_rejected",
  "workbook_connection_rejected",
  "embedded_package_rejected",
  "hidden_worksheet_rejected",
  "unsupported_ooxml_feature",
]);

const UNSUPPORTED_XLSX_STAGES = new Set([
  "zip_container",
  "ooxml_package",
  "workbook",
  "worksheet",
  "cell",
]);

function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function normalizeOrigin(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.origin : null;
  } catch {
    return null;
  }
}

function normalizeRequestUrl(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function normalizeAuthority(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return null;
  return /^[a-z0-9.-]+(?::\d{1,5})?$/i.test(value) ? value.toLowerCase() : null;
}

function normalizeContentType(value) {
  if (typeof value !== "string") return null;
  const lower = value.toLowerCase();
  if (lower.startsWith("multipart/form-data")) return "multipart/form-data";
  if (lower.startsWith("application/json")) return "application/json";
  if (lower.length === 0) return null;
  return "other";
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function normalizeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : null;
}

function classifyResponse(status, isJson, payload) {
  if (!isJson) return "non_json_response";
  if (status === 200 && payload?.ok === true) return "preview_success";
  if (status === 422 && payload?.ok === true && arrayLength(payload.preview?.blockingErrors) > 0) {
    return "controlled_blocking_preview";
  }
  if (status === 401) return "authentication_failure";
  if (status === 403) return "origin_or_authorization_failure";
  if (status === 415) return "upload_contract_failure";
  if (status === 400) return "request_structure_failure";
  if (status === 413) return "upload_limit_failure";
  if (status === 429) return "rate_limit_failure";
  if (status >= 500 && status <= 599) return "server_failure";
  return "unexpected_response";
}

/**
 * Extracts a deliberately small allowlist of acceptance evidence.
 * It receives decoded payload metadata but never returns headers with secrets,
 * a request body, a file name, product rows, or the full response payload.
 */
export function buildSellerSpritePreviewAcceptanceEvidence(input = {}) {
  const request = asRecord(input.request) ?? {};
  const response = asRecord(input.response) ?? {};
  const requestHeaders = asRecord(request.headers) ?? {};
  const responseHeaders = asRecord(response.headers) ?? {};
  const payload = response.isJson === true ? asRecord(response.json) : null;
  const preview = asRecord(payload?.preview) ?? {};
  const error = asRecord(payload?.error);
  const rawErrorCode = typeof error?.code === "string" ? error.code : null;
  const knownError = rawErrorCode && ERROR_SUMMARIES.has(rawErrorCode) ? rawErrorCode : null;
  const rawReasonCode = typeof error?.reasonCode === "string" ? error.reasonCode : null;
  const rawStage = typeof error?.stage === "string" ? error.stage : null;
  const reasonCode = knownError === "unsupported_xlsx_feature"
    && rawReasonCode
    && UNSUPPORTED_XLSX_REASON_CODES.has(rawReasonCode)
    ? rawReasonCode
    : null;
  const stage = knownError === "unsupported_xlsx_feature"
    && rawStage
    && UNSUPPORTED_XLSX_STAGES.has(rawStage)
    ? rawStage
    : null;
  const status = normalizeNonNegativeInteger(response.status);
  const isJson = response.isJson === true;
  const acceptedRowCount = normalizeNonNegativeInteger(preview.acceptedRowCount);
  const rejectedRowCount = normalizeNonNegativeInteger(preview.rejectedRowCount)
    ?? arrayLength(preview.rejectedRows);

  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    request: {
      url: normalizeRequestUrl(request.url),
      method: typeof request.method === "string" ? request.method.toUpperCase() : null,
      pageFinalUrl: normalizeRequestUrl(request.pageFinalUrl),
      origin: normalizeOrigin(requestHeaders.origin),
      refererOrigin: normalizeOrigin(requestHeaders.referer),
      authority: normalizeAuthority(requestHeaders.host ?? requestHeaders[":authority"]),
      secFetchSite: typeof requestHeaders["sec-fetch-site"] === "string" ? requestHeaders["sec-fetch-site"] : null,
      secFetchMode: typeof requestHeaders["sec-fetch-mode"] === "string" ? requestHeaders["sec-fetch-mode"] : null,
      contentType: normalizeContentType(requestHeaders["content-type"]),
      startedAt: normalizeTimestamp(request.startedAt),
      finishedAt: normalizeTimestamp(request.finishedAt),
    },
    response: {
      status,
      contentType: normalizeContentType(responseHeaders["content-type"]),
      cacheControl: responseHeaders["cache-control"] === "no-store" ? "no-store" : null,
      isJson,
      ok: typeof payload?.ok === "boolean" ? payload.ok : null,
      canProceed: typeof payload?.canProceed === "boolean"
        ? payload.canProceed
        : (typeof preview.canProceed === "boolean" ? preview.canProceed : null),
      errorCode: knownError,
      errorSummary: knownError ? ERROR_SUMMARIES.get(knownError) : null,
      blockingErrorCount: arrayLength(preview.blockingErrors),
      warningCount: arrayLength(preview.warnings),
      validRows: acceptedRowCount,
      invalidRows: rejectedRowCount,
      reasonCode,
      stage,
      classification: classifyResponse(status, isJson, { ...payload, preview }),
    },
  };
}
