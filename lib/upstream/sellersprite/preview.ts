import { createHash } from "node:crypto";
import { computeSellerSpriteRowHash } from "../../server/sellerSpriteImportContract";
import { parseSellerSpritePreviewXlsx } from "./previewXlsx";

const REPORT_SHEET_NAME = "US";
// Standard SellerSprite Amazon US search-results workbook layout:
// a visible "US" business sheet plus optional metadata sheets. Any other
// worksheet name is rejected fail-closed. Selection is by exact name only.
const ALLOWED_WORKSHEET_NAMES = new Set(["US", "Brands", "Sellers", "Note"]);
const MAX_PREVIEW_ROWS = 200;
const MAX_REJECTED_ROWS = 100;
const MAX_DUPLICATE_GROUPS = 100;
const MAX_TEXT_LENGTH = 500;
const MAX_URL_LENGTH = 2_048;

const REQUIRED_COLUMNS = {
  asin: "ASIN",
  title: "商品标题",
  amazonUrl: "商品详情页链接",
} as const;

const OPTIONAL_COLUMNS = {
  parentAsin: "父ASIN",
  imageUrl: "商品主图",
  priceUsd: "价格($)",
  rating: "评分",
  reviewCount: "评分数",
  brand: "品牌",
  category: "类目路径",
  searchRank: "搜索排名",
  estimatedMonthlySales: "月销量",
  estimatedMonthlyRevenueUsd: "月销售额($)",
} as const;

const ALL_COLUMNS = { ...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS };
const UNKNOWN_MARKERS = new Set(["-", "--", "n/a", "na", "null", "unknown", "未知"]);

export const SELLERSPRITE_PREVIEW_SOURCE = {
  sourceProvider: "SellerSprite",
  sourceType: "sellersprite_xlsx",
  marketplace: "Amazon US",
  reportType: "SellerSprite Search Results",
  currency: "USD",
} as const;

export type SellerSpritePreviewErrorCode =
  | "unsupported_report_layout"
  | "ambiguous_product_worksheet"
  | "ambiguous_header"
  | "missing_required_column"
  | "no_valid_rows";

export class SellerSpritePreviewError extends Error {
  constructor(
    readonly code: SellerSpritePreviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SellerSpritePreviewError";
  }
}

type RowReasonCode =
  | "invalid_asin"
  | "invalid_parent_asin"
  | "missing_title"
  | "invalid_amazon_url"
  | "asin_url_mismatch"
  | "invalid_image_url"
  | "invalid_price"
  | "invalid_rating"
  | "invalid_review_count"
  | "invalid_estimate"
  | "field_too_long";

type PreviewFacts = {
  asin: string;
  parentAsin?: string;
  title: string;
  amazonUrl: string;
  imageUrl?: string;
  priceUsd?: number;
  rating?: number;
  reviewCount?: number;
  brand?: string;
  category?: string;
};

type PreviewEstimates = {
  searchRank?: number;
  estimatedMonthlySales?: number;
  estimatedMonthlyRevenueUsd?: number;
};

export type SellerSpritePreviewFieldStatus =
  | "source_fact"
  | "third_party_estimate"
  | "snapshot"
  | "missing"
  | "unknown";

type PreviewFieldStatusMap = Record<keyof typeof ALL_COLUMNS, SellerSpritePreviewFieldStatus>;

export type SellerSpriteAcceptedPreviewRow = {
  rowNumber: number;
  facts: PreviewFacts;
  estimates: PreviewEstimates;
  fieldStatus: PreviewFieldStatusMap;
  missingFields: string[];
  warnings: Array<{ code: "missing_optional_field" | "unknown_optional_field"; field: string }>;
  /** Populated by the precheck return for every accepted row. */
  rowHash?: string;
};

export type SellerSpritePreviewResult = {
  schemaVersion: "sellersprite_preview_v1";
  source: typeof SELLERSPRITE_PREVIEW_SOURCE & { sourceFileSha256: string };
  acceptedRowCount: number;
  rejectedRowCount: number;
  acceptedRows: SellerSpriteAcceptedPreviewRow[];
  rejectedRows: Array<{ rowNumber: number; status: "invalid"; reasons: Array<{ code: RowReasonCode; field?: string }> }>;
  duplicates: Array<{ asin: string; rowNumbers: number[]; hasCriticalConflict: boolean; conflictStatus: "none" | "conflict" }>;
  warnings: Array<{ code: "duplicate_asin" | "invalid_rows_quarantined"; rowNumbers?: number[] }>;
  blockingErrors: Array<{ code: "duplicate_asin_conflict"; status: "conflict"; asin: string; rowNumbers: number[] }>;
  previewTruncated: boolean;
  acceptedRowsDigest?: string;
  warningDigest?: string;
  parserContractVersion?: string;
};

type CellValue = { value: string; kind: "value" | "missing" | "unknown" };
type RowReason = { code: RowReasonCode; field?: string };

function fail(code: SellerSpritePreviewErrorCode, message: string): never {
  throw new SellerSpritePreviewError(code, message);
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function cellValue(values: readonly string[], index: number | undefined): CellValue {
  const value = index === undefined ? "" : normalize(values[index] ?? "");
  if (!value) return { value: "", kind: "missing" };
  if (UNKNOWN_MARKERS.has(value.toLowerCase())) return { value: "", kind: "unknown" };
  return { value, kind: "value" };
}

function fieldStatus(
  field: keyof typeof ALL_COLUMNS,
  cell: CellValue,
): SellerSpritePreviewFieldStatus {
  if (cell.kind === "missing") return "missing";
  if (cell.kind === "unknown") return "unknown";
  if (field === "priceUsd" || field === "rating" || field === "reviewCount") return "snapshot";
  if (field === "searchRank" || field === "estimatedMonthlySales" || field === "estimatedMonthlyRevenueUsd") {
    return "third_party_estimate";
  }
  return "source_fact";
}

function readText(
  values: readonly string[],
  index: number | undefined,
  field: keyof typeof ALL_COLUMNS,
  reasons: RowReason[],
): { value: string | undefined; cell: CellValue } {
  const cell = cellValue(values, index);
  if (cell.kind !== "value") return { value: undefined, cell };
  if (cell.value.length > MAX_TEXT_LENGTH) {
    reasons.push({ code: "field_too_long", field });
    return { value: undefined, cell };
  }
  return { value: cell.value, cell };
}

function numericReason(field: keyof typeof ALL_COLUMNS): RowReasonCode {
  if (field === "priceUsd") return "invalid_price";
  if (field === "rating") return "invalid_rating";
  if (field === "reviewCount") return "invalid_review_count";
  return "invalid_estimate";
}

function readNumber(
  values: readonly string[],
  index: number | undefined,
  field: "priceUsd" | "rating" | "reviewCount" | "searchRank" | "estimatedMonthlySales" | "estimatedMonthlyRevenueUsd",
  reasons: RowReason[],
  options: { integer?: boolean; min: number; max: number; usd?: boolean },
): { value: number | undefined; cell: CellValue } {
  const cell = cellValue(values, index);
  if (cell.kind !== "value") return { value: undefined, cell };
  let source = cell.value.replaceAll(",", "");
  if (options.usd) {
    source = source.replace(/^(?:US)?\$\s?/i, "");
  }
  if (!/^(?:\d+|\d+\.\d+)$/.test(source)) {
    reasons.push({ code: numericReason(field), field });
    return { value: undefined, cell };
  }
  const value = Number(source);
  if (
    !Number.isFinite(value)
    || value < options.min
    || value > options.max
    || (options.integer && !Number.isSafeInteger(value))
  ) {
    reasons.push({ code: numericReason(field), field });
    return { value: undefined, cell };
  }
  return { value, cell };
}

function readHttpsUrl(
  values: readonly string[],
  index: number | undefined,
  field: "amazonUrl" | "imageUrl",
  reasons: RowReason[],
): { value: URL | undefined; cell: CellValue } {
  const cell = cellValue(values, index);
  if (cell.kind !== "value") return { value: undefined, cell };
  if (cell.value.length > MAX_URL_LENGTH) {
    reasons.push({ code: "field_too_long", field });
    return { value: undefined, cell };
  }
  try {
    const value = new URL(cell.value);
    if (value.protocol !== "https:" || value.username || value.password || value.port) {
      throw new Error("unsafe_url");
    }
    return { value, cell };
  } catch {
    reasons.push({ code: field === "imageUrl" ? "invalid_image_url" : "invalid_amazon_url", field });
    return { value: undefined, cell };
  }
}

function asinFromAmazonUsUrl(url: URL): string | undefined {
  if (url.hostname.toLowerCase() !== "amazon.com" && url.hostname.toLowerCase() !== "www.amazon.com") {
    return undefined;
  }
  return /\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:[/?]|$)/i.exec(url.pathname)?.[1]?.toUpperCase();
}

function headerIndexes(headers: readonly string[]): Map<keyof typeof ALL_COLUMNS, number> {
  const knownByHeader = new Map<string, keyof typeof ALL_COLUMNS>(
    Object.entries(ALL_COLUMNS).map(([field, label]) => [normalize(label), field as keyof typeof ALL_COLUMNS]),
  );
  const found = new Map<keyof typeof ALL_COLUMNS, number>();
  for (const [index, header] of headers.entries()) {
    const field = knownByHeader.get(normalize(header));
    if (!field) continue;
    if (found.has(field)) fail("ambiguous_header", `报表字段“${header}”重复，无法安全解析。`);
    found.set(field, index);
  }
  for (const field of Object.keys(REQUIRED_COLUMNS) as Array<keyof typeof REQUIRED_COLUMNS>) {
    if (!found.has(field)) fail("missing_required_column", `报表缺少必填列“${REQUIRED_COLUMNS[field]}”。`);
  }
  return found;
}

function recordOptionalFieldState(
  field: keyof typeof OPTIONAL_COLUMNS,
  cell: CellValue,
  missingFields: string[],
  warnings: SellerSpriteAcceptedPreviewRow["warnings"],
): void {
  if (cell.kind === "missing") {
    missingFields.push(field);
    warnings.push({ code: "missing_optional_field", field });
  } else if (cell.kind === "unknown") {
    missingFields.push(field);
    warnings.push({ code: "unknown_optional_field", field });
  }
}

function buildRow(
  values: readonly string[],
  indexes: Map<keyof typeof ALL_COLUMNS, number>,
  rowNumber: number,
): { accepted: SellerSpriteAcceptedPreviewRow } | { rejected: { rowNumber: number; status: "invalid"; reasons: RowReason[] } } {
  const reasons: RowReason[] = [];
  const statuses = {} as PreviewFieldStatusMap;
  const asinCell = cellValue(values, indexes.get("asin"));
  const asin = asinCell.value.toUpperCase();
  statuses.asin = fieldStatus("asin", asinCell);
  if (asinCell.kind !== "value" || !/^[A-Z0-9]{10}$/.test(asin)) {
    reasons.push({ code: "invalid_asin", field: "asin" });
  }

  const parentAsinCell = cellValue(values, indexes.get("parentAsin"));
  const parentAsin = parentAsinCell.value.toUpperCase() || undefined;
  statuses.parentAsin = fieldStatus("parentAsin", parentAsinCell);
  if (parentAsin && !/^[A-Z0-9]{10}$/.test(parentAsin)) {
    reasons.push({ code: "invalid_parent_asin", field: "parentAsin" });
  }

  const title = readText(values, indexes.get("title"), "title", reasons);
  statuses.title = fieldStatus("title", title.cell);
  if (!title.value) reasons.push({ code: "missing_title", field: "title" });

  const amazonUrl = readHttpsUrl(values, indexes.get("amazonUrl"), "amazonUrl", reasons);
  statuses.amazonUrl = fieldStatus("amazonUrl", amazonUrl.cell);
  const urlAsin = amazonUrl.value ? asinFromAmazonUsUrl(amazonUrl.value) : undefined;
  if (amazonUrl.value && !urlAsin) reasons.push({ code: "invalid_amazon_url", field: "amazonUrl" });
  if (urlAsin && asin && urlAsin !== asin) reasons.push({ code: "asin_url_mismatch", field: "amazonUrl" });

  const imageUrl = readHttpsUrl(values, indexes.get("imageUrl"), "imageUrl", reasons);
  statuses.imageUrl = fieldStatus("imageUrl", imageUrl.cell);
  const priceUsd = readNumber(values, indexes.get("priceUsd"), "priceUsd", reasons, {
    min: 0,
    max: 1_000_000,
    usd: true,
  });
  statuses.priceUsd = fieldStatus("priceUsd", priceUsd.cell);
  const rating = readNumber(values, indexes.get("rating"), "rating", reasons, { min: 0, max: 5 });
  statuses.rating = fieldStatus("rating", rating.cell);
  const reviewCount = readNumber(values, indexes.get("reviewCount"), "reviewCount", reasons, {
    min: 0,
    max: 1_000_000_000,
    integer: true,
  });
  statuses.reviewCount = fieldStatus("reviewCount", reviewCount.cell);
  const brand = readText(values, indexes.get("brand"), "brand", reasons);
  statuses.brand = fieldStatus("brand", brand.cell);
  const category = readText(values, indexes.get("category"), "category", reasons);
  statuses.category = fieldStatus("category", category.cell);
  const searchRank = ((): { value: number | undefined; cell: CellValue } => {
    const searchRankCell = cellValue(values, indexes.get("searchRank"));
    if (searchRankCell.kind === "value") {
      const stripped = searchRankCell.value.replaceAll(",", "");
      if (!/^(?:\d+|\d+\.\d+)$/.test(stripped)) {
        // Real SellerSprite search rank is a display string such as
        // "自然位:第1页第1位" or "广告位:第1页第8位". Treat non-numeric
        // rank text as unknown instead of rejecting the whole row.
        return { value: undefined, cell: { value: "", kind: "unknown" } };
      }
    }
    return readNumber(values, indexes.get("searchRank"), "searchRank", reasons, {
      min: 0,
      max: 1_000_000_000,
      integer: true,
    });
  })();
  statuses.searchRank = fieldStatus("searchRank", searchRank.cell);
  const estimatedMonthlySales = readNumber(values, indexes.get("estimatedMonthlySales"), "estimatedMonthlySales", reasons, {
    min: 0,
    max: 1_000_000_000,
    integer: true,
  });
  statuses.estimatedMonthlySales = fieldStatus("estimatedMonthlySales", estimatedMonthlySales.cell);
  const estimatedMonthlyRevenueUsd = readNumber(
    values,
    indexes.get("estimatedMonthlyRevenueUsd"),
    "estimatedMonthlyRevenueUsd",
    reasons,
    { min: 0, max: 1_000_000_000, usd: true },
  );
  statuses.estimatedMonthlyRevenueUsd = fieldStatus("estimatedMonthlyRevenueUsd", estimatedMonthlyRevenueUsd.cell);

  if (reasons.length > 0) return { rejected: { rowNumber, status: "invalid", reasons } };

  const facts: PreviewFacts = { asin, title: title.value!, amazonUrl: amazonUrl.value!.toString() };
  if (parentAsin) facts.parentAsin = parentAsin;
  if (imageUrl.value) facts.imageUrl = imageUrl.value.toString();
  if (priceUsd.value !== undefined) facts.priceUsd = priceUsd.value;
  if (rating.value !== undefined) facts.rating = rating.value;
  if (reviewCount.value !== undefined) facts.reviewCount = reviewCount.value;
  if (brand.value) facts.brand = brand.value;
  if (category.value) facts.category = category.value;
  const estimates: PreviewEstimates = {};
  if (searchRank.value !== undefined) estimates.searchRank = searchRank.value;
  if (estimatedMonthlySales.value !== undefined) estimates.estimatedMonthlySales = estimatedMonthlySales.value;
  if (estimatedMonthlyRevenueUsd.value !== undefined) estimates.estimatedMonthlyRevenueUsd = estimatedMonthlyRevenueUsd.value;

  const missingFields: string[] = [];
  const warnings: SellerSpriteAcceptedPreviewRow["warnings"] = [];
  const optionalCells: Record<keyof typeof OPTIONAL_COLUMNS, CellValue> = {
    parentAsin: parentAsinCell,
    imageUrl: imageUrl.cell,
    priceUsd: priceUsd.cell,
    rating: rating.cell,
    reviewCount: reviewCount.cell,
    brand: brand.cell,
    category: category.cell,
    searchRank: searchRank.cell,
    estimatedMonthlySales: estimatedMonthlySales.cell,
    estimatedMonthlyRevenueUsd: estimatedMonthlyRevenueUsd.cell,
  };
  for (const [field, cell] of Object.entries(optionalCells) as Array<[keyof typeof OPTIONAL_COLUMNS, CellValue]>) {
    recordOptionalFieldState(field, cell, missingFields, warnings);
  }
  return { accepted: { rowNumber, facts, estimates, fieldStatus: statuses, missingFields, warnings } };
}

function hasCriticalConflict(rows: readonly SellerSpriteAcceptedPreviewRow[]): boolean {
  const criticalIdentity = new Set(rows.map((row) => JSON.stringify([
    row.facts.parentAsin ?? null,
    row.facts.title,
    row.facts.amazonUrl,
    row.facts.priceUsd ?? null,
    row.facts.rating ?? null,
    row.facts.reviewCount ?? null,
    row.facts.brand ?? null,
    row.facts.category ?? null,
  ])));
  return criticalIdentity.size > 1;
}

export function precheckSellerSpritePreview(input: Uint8Array): SellerSpritePreviewResult {
  const workbook = parseSellerSpritePreviewXlsx(input);
  // Fail closed on any worksheet name outside the standard SellerSprite set.
  // Hidden sheets are already rejected at the OOXML decode layer.
  for (const ws of workbook.sheets) {
    if (!ALLOWED_WORKSHEET_NAMES.has(ws.name)) {
      fail("unsupported_report_layout", `报表包含不受支持的工作表“${ws.name}”。`);
    }
  }
  // Select the business sheet by exact name only. Metadata sheets
  // (Brands / Sellers / Note) never participate in product-row parsing.
  const businessSheets = workbook.sheets.filter((ws) => ws.name === REPORT_SHEET_NAME);
  if (businessSheets.length === 0) {
    fail("unsupported_report_layout", "只支持卖家精灵导出的 Amazon 美国站搜索结果 XLSX。");
  }
  if (businessSheets.length !== 1) {
    fail("ambiguous_product_worksheet", "报表必须且只能包含一个可见的 US 工作表。");
  }
  const sheet = businessSheets[0];
  const header = sheet.rows[0];
  if (header.rowNumber !== 1) fail("unsupported_report_layout", "报表首行必须是字段表头。");
  const indexes = headerIndexes(header.values);

  const accepted: SellerSpriteAcceptedPreviewRow[] = [];
  const rejected: Array<{ rowNumber: number; status: "invalid"; reasons: RowReason[] }> = [];
  for (const row of sheet.rows.slice(1)) {
    const item = buildRow(row.values, indexes, row.rowNumber);
    if ("accepted" in item) accepted.push(item.accepted);
    else rejected.push(item.rejected);
  }
  if (accepted.length === 0) fail("no_valid_rows", "没有可安全预览的合法商品行。");

  const duplicateGroups = new Map<string, SellerSpriteAcceptedPreviewRow[]>();
  for (const row of accepted) {
    const rows = duplicateGroups.get(row.facts.asin) ?? [];
    rows.push(row);
    duplicateGroups.set(row.facts.asin, rows);
  }
  const duplicates = [...duplicateGroups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([asin, rows]) => ({
      asin,
      rowNumbers: rows.map((row) => row.rowNumber),
      hasCriticalConflict: hasCriticalConflict(rows),
      conflictStatus: hasCriticalConflict(rows) ? "conflict" as const : "none" as const,
    }));
  const blockingErrors = duplicates
    .filter((duplicate) => duplicate.hasCriticalConflict)
    .map((duplicate) => ({
      code: "duplicate_asin_conflict" as const,
      status: "conflict" as const,
      asin: duplicate.asin,
      rowNumbers: duplicate.rowNumbers,
    }));
  const warnings: SellerSpritePreviewResult["warnings"] = [];
  if (rejected.length > 0) warnings.push({ code: "invalid_rows_quarantined" });
  for (const duplicate of duplicates) {
    warnings.push({ code: "duplicate_asin", rowNumbers: duplicate.rowNumbers });
  }

  // compute canonical digests as per contract (no token generation here)
  const rowHashes = accepted.map((row) => row.facts.asin).sort().join(",");
  const acceptedRowsDigest = createHash("sha256")
    .update(JSON.stringify(rowHashes))
    .digest("hex")
    .toLowerCase();

  // warningDigest canonical
  const warningItems = rejected.map((r) => ({
    code: "invalid_rows_quarantined",
    rowNumber: r.rowNumber,
  }));
  const warningDigest = createHash("sha256")
    .update(JSON.stringify(warningItems.sort((a, b) => a.rowNumber - b.rowNumber)))
    .digest("hex")
    .toLowerCase();

  const parserContractVersion = "sellersprite_preview_import_v1";

  return {
    schemaVersion: "sellersprite_preview_v1",
    source: {
      ...SELLERSPRITE_PREVIEW_SOURCE,
      sourceFileSha256: createHash("sha256").update(input).digest("hex"),
    },
    acceptedRowCount: accepted.length,
    rejectedRowCount: rejected.length,
    acceptedRows: accepted.map((row) => ({
      ...row,
      rowHash: computeSellerSpriteRowHash({
        rowNumber: row.rowNumber,
        asin: row.facts.asin,
        title: row.facts.title,
        amazonUrl: row.facts.amazonUrl,
      }),
    })).slice(0, MAX_PREVIEW_ROWS),
    rejectedRows: rejected.slice(0, MAX_REJECTED_ROWS),
    duplicates: duplicates.slice(0, MAX_DUPLICATE_GROUPS),
    warnings,
    blockingErrors: blockingErrors.slice(0, MAX_DUPLICATE_GROUPS),
    previewTruncated: accepted.length > MAX_PREVIEW_ROWS
      || rejected.length > MAX_REJECTED_ROWS
      || duplicates.length > MAX_DUPLICATE_GROUPS,
    acceptedRowsDigest,
    warningDigest,
    parserContractVersion,
  };
}
