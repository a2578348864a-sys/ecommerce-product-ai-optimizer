/**
 * SellerSprite Plugin Deterministic Capture → Candidate Import contract.
 *
 * Spike 结论（READ-C）：SellerSprite 浏览器插件面板的「展开」时序不稳定，
 * 因此本工具只做「面板已打开后的确定性提取」——不做任何面板展开/点击自动化，
 * 主数据链仍以 XLSX 导入为准；插件捕获是同一 Candidate 池的第二条确定性输入链。
 *
 * 本模块是纯服务端合同（无 Prisma、无文件 I/O）：
 * - 定义插件面板 22 列 → `SellerSpritePluginRow` 的字段白名单与类型/边界校验；
 * - `mapPluginRowToSellerSpriteImportRow` 映射到既有 `SellerSpriteImportRow`
 *   （复用 frozen rowHash 格式），并携带 `pluginCapture`（subtype=sellersprite_plugin）；
 * - Preview 摘要/选行校验，与 `sellersprite-import` 链共用同一签名 Token 与
 *   幂等键（`marketplace:asin`）。
 */
import { createHash } from "node:crypto";
import {
  computeSellerSpriteRowHash,
  isSellerSpriteRowHash,
  SELLERSPRITE_IMPORT_MARKETPLACE,
  type SellerSpriteImportRow,
  type SellerSpritePluginCapture,
} from "@/lib/server/sellerSpriteImportContract";

export const SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS = 50;
export const SELLERSPRITE_PLUGIN_ROW_SCHEMA = "sellersprite_plugin_row_v1";
/**
 * Preview Token 复用既有 frozen Token 合同版本（`sellersprite_preview_import_v1`）：
 * Token 层不区分插件/XLSX，内容一致性由 sourceFileSha256（插件合成值）+ 摘要绑定。
 */
export const SELLERSPRITE_PLUGIN_PARSER_CONTRACT_VERSION = "sellersprite_preview_import_v1";
export const SELLERSPRITE_PLUGIN_SOURCE_SUBTYPE = "sellersprite_plugin";
export const SELLERSPRITE_PLUGIN_MAX_BODY_UTF8_BYTES = 256 * 1024;

/**
 * 插件链路无物理 XLSX 文件：sourceFileSha256 使用确定性合成值。
 * 同一 ASIN 的「相同快照」判定 = 合成值 + rowHash 双等（与 XLSX 语义一致：
 * 相同来源相同行 → skipped；不同快照 → conflict）。
 */
export const SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256 = createHash("sha256")
  .update("sellersprite-plugin-capture-v1")
  .digest("hex")
  .toLowerCase();

/**
 * 插件面板 22 列（列名 → 规范键）。BSR 取「大类目 BSR」；小类 BSR 由
 * `subCategoryBsr` 作为可选的附加键（超出 22 列白名单的少数面板）。
 */
export const SELLERSPRITE_PLUGIN_PANEL_COLUMNS = [
  "asin",
  "title",
  "priceUsd",
  "rating",
  "reviewCount",
  "bsr",
  "estimatedMonthlySales",
  "estimatedMonthlyRevenueUsd",
  "variationCount",
  "reviewRate",
  "grossMargin",
  "listingDate",
  "sellerCount",
  "fulfillment",
  "brand",
  "category",
  "parentAsin",
  "productUrl",
  "imageUrl",
  "sku",
  "searchRank",
  "seller",
] as const;

export const SELLERSPRITE_PLUGIN_FIELD_KEYS = [
  ...SELLERSPRITE_PLUGIN_PANEL_COLUMNS,
  "subCategoryBsr",
] as const;

export type SellerSpritePluginFieldKey = (typeof SELLERSPRITE_PLUGIN_FIELD_KEYS)[number];

export const SELLERSPRITE_PLUGIN_REQUIRED_FIELDS = ["asin", "title", "productUrl"] as const;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const MAX_TITLE_LENGTH = 500;
const MAX_OPTIONAL_STRING_LENGTH = 300;

/** 面板空值占位（"-" / "--" / "N/A" / 空串）→ null（缺省） */
const NULLABLE_TEXT_PATTERN = /^(?:-{1,2}|n\/?a|null|)$/iu;

/** 百分比字段（留评率/毛利率）：允许尾部 "%" */
const PERCENT_FIELDS = new Set<SellerSpritePluginFieldKey>(["reviewRate", "grossMargin"]);

export type SellerSpritePluginRow = {
  asin: string;
  title: string;
  productUrl: string;
  parentAsin: string | null;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  sku: string | null;
  priceUsd: number | null;
  rating: number | null;
  reviewCount: number | null;
  searchRank: number | null;
  bsr: number | null;
  subCategoryBsr: number | null;
  estimatedMonthlySales: number | null;
  estimatedMonthlyRevenueUsd: number | null;
  variationCount: number | null;
  reviewRate: number | null;
  grossMargin: number | null;
  listingDate: string | null;
  sellerCount: number | null;
  fulfillment: string | null;
  seller: string | null;
};

export type SellerSpritePluginValidationFailure = {
  code: string;
  message: string;
  /** 0-based 行下标；非行级错误为 null */
  rowIndex: number | null;
  /** 出错字段；非字段级错误为 null */
  field: SellerSpritePluginFieldKey | null;
};

export type SellerSpritePluginRowsValidationResult =
  | { ok: true; rows: SellerSpritePluginRow[] }
  | { ok: false; error: SellerSpritePluginValidationFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableText(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (NULLABLE_TEXT_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function failure(
  code: string,
  message: string,
  rowIndex: number | null,
  field: SellerSpritePluginFieldKey | null,
): SellerSpritePluginRowsValidationResult {
  return { ok: false, error: { code, message, rowIndex, field } };
}

/**
 * 数字字段：接受 number 或面板格式文本（"$19.99" / "1,234" / "12.5%"）。
 * 空值占位 → null；无法解析 → "invalid"。
 */
function coerceNumber(raw: unknown, field: SellerSpritePluginFieldKey): number | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : "invalid";
  }
  if (typeof raw !== "string") return "invalid";
  let text = raw.trim();
  if (NULLABLE_TEXT_PATTERN.test(text)) return null;
  if (PERCENT_FIELDS.has(field) && text.endsWith("%")) text = text.slice(0, -1).trim();
  if (text.startsWith("$")) text = text.slice(1).trim();
  text = text.replaceAll(",", "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return "invalid";
  const value = Number(text);
  return Number.isFinite(value) ? value : "invalid";
}

const NON_NEGATIVE_INTEGER_FIELDS = new Set<SellerSpritePluginFieldKey>([
  "reviewCount",
  "estimatedMonthlySales",
  "variationCount",
]);

const POSITIVE_INTEGER_FIELDS = new Set<SellerSpritePluginFieldKey>([
  "searchRank",
  "bsr",
  "subCategoryBsr",
  "sellerCount",
]);

const ZERO_TO_FIVE_FIELDS = new Set<SellerSpritePluginFieldKey>(["rating"]);
const ZERO_TO_HUNDRED_FIELDS = new Set<SellerSpritePluginFieldKey>(["reviewRate"]);
const NON_NEGATIVE_NUMBER_FIELDS = new Set<SellerSpritePluginFieldKey>([
  "priceUsd",
  "estimatedMonthlyRevenueUsd",
]);
/** 毛利率可为负（清仓/亏损品）；仅约束有限值与合理带宽 */
const BANDED_NUMBER_FIELDS = new Set<SellerSpritePluginFieldKey>(["grossMargin"]);

function numericRangeError(field: SellerSpritePluginFieldKey, value: number): boolean {
  if (ZERO_TO_FIVE_FIELDS.has(field)) return value < 0 || value > 5;
  if (ZERO_TO_HUNDRED_FIELDS.has(field)) return value < 0 || value > 100;
  if (NON_NEGATIVE_INTEGER_FIELDS.has(field)) return value < 0 || !Number.isSafeInteger(value);
  if (POSITIVE_INTEGER_FIELDS.has(field)) return value < 1 || !Number.isSafeInteger(value);
  if (NON_NEGATIVE_NUMBER_FIELDS.has(field)) return value < 0;
  if (BANDED_NUMBER_FIELDS.has(field)) return value < -1000 || value > 1000;
  return false;
}

function validateNumberField(
  raw: unknown,
  field: SellerSpritePluginFieldKey,
  rowIndex: number,
): { ok: true; value: number | null } | { ok: false; error: SellerSpritePluginValidationFailure } {
  const coerced = coerceNumber(raw, field);
  if (coerced === "invalid") {
    return { ok: false, error: { code: "plugin_invalid_field_type", message: `字段 ${field} 不是有效数字。`, rowIndex, field } };
  }
  if (coerced === null) return { ok: true, value: null };
  if (numericRangeError(field, coerced)) {
    return { ok: false, error: { code: "plugin_invalid_field_value", message: `字段 ${field} 数值超出允许范围。`, rowIndex, field } };
  }
  return { ok: true, value: coerced };
}

function validateStringField(
  raw: unknown,
  field: SellerSpritePluginFieldKey,
  rowIndex: number,
  maxLength = MAX_OPTIONAL_STRING_LENGTH,
): { ok: true; value: string | null } | { ok: false; error: SellerSpritePluginValidationFailure } {
  const text = nullableText(raw);
  if (text === "invalid") {
    return { ok: false, error: { code: "plugin_invalid_field_type", message: `字段 ${field} 不是有效文本。`, rowIndex, field } };
  }
  if (text === null) return { ok: true, value: null };
  if (text.length > maxLength) {
    return { ok: false, error: { code: "plugin_invalid_field_value", message: `字段 ${field} 超出长度限制。`, rowIndex, field } };
  }
  return { ok: true, value: text };
}

/**
 * 校验并规范化插件面板行数组（白名单/类型/边界/列身份）。
 * 通过后返回字段已规范化的行（ASIN 大写、文本去空白、空值占位 → null）。
 */
export function validateSellerSpritePluginRows(value: unknown): SellerSpritePluginRowsValidationResult {
  if (!Array.isArray(value)) {
    return failure("plugin_rows_not_array", "rows 必须是数组。", null, null);
  }
  if (value.length === 0) {
    return failure("plugin_rows_empty", "rows 不能为空。", null, null);
  }
  if (value.length > SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS) {
    return failure("plugin_rows_too_many", `rows 超过上限 ${SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS} 行。`, null, null);
  }

  const rows: SellerSpritePluginRow[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    if (!isRecord(item)) {
      return failure("plugin_row_not_object", `第 ${index + 1} 行不是对象。`, index, null);
    }
    const keys = Object.keys(item);
    for (const key of keys) {
      if (!(SELLERSPRITE_PLUGIN_FIELD_KEYS as readonly string[]).includes(key)) {
        return failure("plugin_unknown_field", `第 ${index + 1} 行包含白名单外字段 ${key}。`, index, null);
      }
    }

    for (const required of SELLERSPRITE_PLUGIN_REQUIRED_FIELDS) {
      const text = nullableText(item[required]);
      if (text === "invalid" || text === null || text.length === 0) {
        return failure("plugin_missing_required_field", `第 ${index + 1} 行缺少必填字段 ${required}。`, index, required);
      }
    }

    const asinRaw = nullableText(item.asin);
    if (asinRaw === "invalid") {
      return failure("plugin_invalid_asin", `第 ${index + 1} 行 ASIN 无效。`, index, "asin");
    }
    const asin = asinRaw!.toUpperCase();
    if (!ASIN_PATTERN.test(asin)) {
      return failure("plugin_invalid_asin", `第 ${index + 1} 行 ASIN 格式无效。`, index, "asin");
    }

    const titleRaw = nullableText(item.title);
    if (titleRaw === "invalid" || titleRaw === null || titleRaw.length > MAX_TITLE_LENGTH) {
      return failure("plugin_invalid_title", `第 ${index + 1} 行标题无效。`, index, "title");
    }

    const urlRaw = nullableText(item.productUrl);
    if (urlRaw === "invalid" || urlRaw === null) {
      return failure("plugin_invalid_product_url", `第 ${index + 1} 行商品链接无效。`, index, "productUrl");
    }
    let productUrl = urlRaw;
    try {
      const parsed = new URL(productUrl);
      if (parsed.protocol !== "https:") throw new Error("not-https");
      productUrl = parsed.toString();
    } catch {
      return failure("plugin_invalid_product_url", `第 ${index + 1} 行商品链接必须是 HTTPS URL。`, index, "productUrl");
    }

    const numericFields = [
      "priceUsd",
      "rating",
      "reviewCount",
      "searchRank",
      "bsr",
      "subCategoryBsr",
      "estimatedMonthlySales",
      "estimatedMonthlyRevenueUsd",
      "variationCount",
      "reviewRate",
      "grossMargin",
      "sellerCount",
    ] as const;
    const numbers: Partial<Record<SellerSpritePluginFieldKey, number | null>> = {};
    for (const field of numericFields) {
      const result = validateNumberField(item[field], field, index);
      if (!result.ok) return { ok: false, error: result.error };
      numbers[field] = result.value;
    }

    const stringFields = [
      "parentAsin",
      "brand",
      "category",
      "imageUrl",
      "sku",
      "listingDate",
      "fulfillment",
      "seller",
    ] as const;
    const strings: Partial<Record<SellerSpritePluginFieldKey, string | null>> = {};
    for (const field of stringFields) {
      const result = validateStringField(item[field], field, index);
      if (!result.ok) return { ok: false, error: result.error };
      strings[field] = result.value;
    }

    rows.push({
      asin,
      title: titleRaw,
      productUrl,
      parentAsin: strings.parentAsin ?? null,
      brand: strings.brand ?? null,
      category: strings.category ?? null,
      imageUrl: strings.imageUrl ?? null,
      sku: strings.sku ?? null,
      priceUsd: numbers.priceUsd ?? null,
      rating: numbers.rating ?? null,
      reviewCount: numbers.reviewCount ?? null,
      searchRank: numbers.searchRank ?? null,
      bsr: numbers.bsr ?? null,
      subCategoryBsr: numbers.subCategoryBsr ?? null,
      estimatedMonthlySales: numbers.estimatedMonthlySales ?? null,
      estimatedMonthlyRevenueUsd: numbers.estimatedMonthlyRevenueUsd ?? null,
      variationCount: numbers.variationCount ?? null,
      reviewRate: numbers.reviewRate ?? null,
      grossMargin: numbers.grossMargin ?? null,
      listingDate: strings.listingDate ?? null,
      sellerCount: numbers.sellerCount ?? null,
      fulfillment: strings.fulfillment ?? null,
      seller: strings.seller ?? null,
    });
  }

  return { ok: true, rows };
}

/**
 * 映射插件行 → 既有 `SellerSpriteImportRow`（幂等键 marketplace:asin 复用）。
 * rowHash 复用 frozen `computeSellerSpriteRowHash`；rowNumber = 提交顺序（1-based），
 * Preview 与 Confirm 必须保持行序一致，否则摘要不匹配（fail-closed）。
 */
export function mapPluginRowToSellerSpriteImportRow(
  row: SellerSpritePluginRow,
  index: number,
  capturedAt: string | null,
): SellerSpriteImportRow {
  const rowNumber = index + 1;
  return {
    rowHash: computeSellerSpriteRowHash({
      rowNumber,
      asin: row.asin,
      title: row.title,
      amazonUrl: row.productUrl,
    }),
    rowNumber,
    asin: row.asin,
    parentAsin: row.parentAsin,
    title: row.title,
    amazonUrl: row.productUrl,
    imageUrl: row.imageUrl,
    priceUsd: row.priceUsd,
    rating: row.rating,
    reviewCount: row.reviewCount,
    brand: row.brand,
    category: row.category,
    searchRank: row.searchRank,
    estimatedMonthlySales: row.estimatedMonthlySales,
    estimatedMonthlyRevenueUsd: row.estimatedMonthlyRevenueUsd,
    skuRaw: row.sku,
    pluginCapture: {
      subtype: SELLERSPRITE_PLUGIN_SOURCE_SUBTYPE,
      capturedAt,
      bsr: row.bsr,
      subCategoryBsr: row.subCategoryBsr,
      variationCount: row.variationCount,
      reviewRate: row.reviewRate,
      grossMargin: row.grossMargin,
      listingDate: row.listingDate,
      sellerCount: row.sellerCount,
      fulfillment: row.fulfillment,
      seller: row.seller,
    } satisfies SellerSpritePluginCapture,
  };
}

export function sellerSpritePluginAcceptedRowsDigest(rows: readonly SellerSpriteImportRow[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => row.rowHash)))
    .digest("hex")
    .toLowerCase();
}

export function sellerSpritePluginWarningDigest(): string {
  return createHash("sha256").update("[]").digest("hex").toLowerCase();
}

/** 插件链路无警告（行级校验全有即全收；不通过直接拒绝） */
export const SELLERSPRITE_PLUGIN_WARNING_COUNT = 0 as const;

export function validateSellerSpritePluginSelectedRowHashes(value: unknown):
  | { ok: true; selectedRowHashes: string[] }
  | { ok: false; code: string } {
  if (!Array.isArray(value)) return { ok: false, code: "invalid_selected_rows" };
  if (value.length === 0 || value.length > SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS) {
    return { ok: false, code: "invalid_selected_rows" };
  }
  if (value.some((entry) => !isSellerSpriteRowHash(entry))) {
    return { ok: false, code: "invalid_selected_rows" };
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, code: "invalid_selected_rows" };
  }
  return { ok: true, selectedRowHashes: value as string[] };
}

/** 供 README/测试引用：插件链路使用的幂等键前缀（与 XLSX 链一致） */
export const SELLERSPRITE_PLUGIN_IDENTITY_KEY_PREFIX = SELLERSPRITE_IMPORT_MARKETPLACE;
