export const SELLERSPRITE_FIELD_KEYS = [
  "asin",
  "sku",
  "brand",
  "productTitle",
  "productUrl",
  "parentAsin",
  "searchRank",
  "price",
  "rating",
  "reviews",
  "estimatedMonthlySales",
  "estimatedMonthlyRevenue",
  "seller",
  "variationCount",
  "rootCategory",
  "rootCategoryBsr",
  "subCategory",
  "subCategoryBsr",
] as const;

export type SellerSpriteFieldKey = (typeof SELLERSPRITE_FIELD_KEYS)[number];

export type SellerSpriteMetricNature = "snapshot" | "estimate" | "derived" | "unknown";
export type SellerSpriteFieldApplicability =
  | "available"
  | "missing"
  | "not_applicable"
  | "invalid"
  | "conflicting";

const FIELD_METRIC_NATURE: Readonly<Record<SellerSpriteFieldKey, SellerSpriteMetricNature>> = {
  asin: "unknown",
  sku: "unknown",
  brand: "unknown",
  productTitle: "unknown",
  productUrl: "unknown",
  parentAsin: "unknown",
  searchRank: "snapshot",
  price: "snapshot",
  rating: "snapshot",
  reviews: "snapshot",
  estimatedMonthlySales: "estimate",
  estimatedMonthlyRevenue: "estimate",
  seller: "unknown",
  variationCount: "snapshot",
  rootCategory: "unknown",
  rootCategoryBsr: "snapshot",
  subCategory: "unknown",
  subCategoryBsr: "snapshot",
};

export function sellerSpriteMetricNatureForField(
  field: SellerSpriteFieldKey,
): SellerSpriteMetricNature {
  return FIELD_METRIC_NATURE[field];
}

export const REQUIRED_SELLERSPRITE_FIELDS: ReadonlyArray<SellerSpriteFieldKey> = [
  "asin",
  "productTitle",
  "productUrl",
];

const FIELD_ALIASES: Readonly<Record<SellerSpriteFieldKey, readonly string[]>> = {
  asin: ["ASIN", "商品ASIN", "Product ASIN"],
  sku: ["SKU", "Seller SKU", "卖家SKU"],
  brand: ["Brand", "品牌"],
  productTitle: ["Product Title", "商品标题", "Title"],
  productUrl: ["Product URL", "Product Link", "商品详情页链接", "商品链接"],
  parentAsin: ["Parent ASIN", "父ASIN"],
  searchRank: ["Search Rank", "Keyword Rank", "搜索排名"],
  price: ["Price", "Price($)", "价格", "价格($)"],
  rating: ["Rating", "评分"],
  reviews: ["Reviews", "Review Count", "Ratings Count", "评分数"],
  estimatedMonthlySales: ["Estimated Monthly Sales", "Monthly Sales", "月销量"],
  estimatedMonthlyRevenue: ["Estimated Monthly Revenue", "Monthly Revenue", "月销售额", "月销售额($)"],
  seller: ["Seller", "Buy Box Seller", "Buybox Seller", "Buybox卖家"],
  variationCount: ["Variation Count", "Variations", "变体数"],
  rootCategory: ["Root Category", "大类目"],
  rootCategoryBsr: ["Root Category BSR", "大类BSR"],
  subCategory: ["Subcategory", "Sub Category", "小类目"],
  subCategoryBsr: ["Subcategory BSR", "Sub Category BSR", "小类BSR"],
};

const INTEGER_FIELDS = new Set<SellerSpriteFieldKey>([
  "reviews",
  "estimatedMonthlySales",
  "variationCount",
  "rootCategoryBsr",
  "subCategoryBsr",
]);

const POSITIVE_INTEGER_FIELDS = new Set<SellerSpriteFieldKey>([
  "rootCategoryBsr",
  "subCategoryBsr",
]);

const NUMBER_FIELDS = new Set<SellerSpriteFieldKey>([
  ...INTEGER_FIELDS,
  "price",
  "rating",
  "estimatedMonthlyRevenue",
]);

const USD_AMOUNT_FIELDS = new Set<SellerSpriteFieldKey>([
  "price",
  "estimatedMonthlyRevenue",
]);

const CURRENCY_SYMBOL_PATTERN = /\p{Sc}/gu;
const CURRENCY_CODE_PREFIX_PATTERN = /^(?:USD|EUR|GBP|JPY|CNY|RMB)\b\s*/iu;

const HEADER_ALIAS_LOOKUP = new Map<string, SellerSpriteFieldKey>();

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

const RAW_SNAPSHOT_HEADERS = new Set([
  "搜索排名",
  "广告位",
  "自然位",
  "价格",
  "价格($)",
  "评分",
  "评分数",
  "变体数",
  "卖家数",
  "上架时间",
  "上架日期",
  "listingdate",
  "配送方式",
  "fulfillment",
]);

const RAW_ESTIMATE_HEADERS = new Set([
  "月销量",
  "月销售额",
  "月销售额($)",
  "子体销量",
  "子体月销量",
  "子体销售额",
  "子体销售额($)",
]);

const RAW_DERIVED_HEADERS = new Set([
  "留评率",
  "毛利率",
  "增长率",
  "月销量增长率",
  "月销售额增长率",
  "品牌市场份额",
  "卖家市场份额",
  "市场份额",
]);

export function sellerSpriteMetricNatureForRawHeader(
  header: string,
): SellerSpriteMetricNature {
  const normalized = normalizeHeader(header);
  if ([...RAW_SNAPSHOT_HEADERS].some((value) => normalizeHeader(value) === normalized)) {
    return "snapshot";
  }
  if ([...RAW_ESTIMATE_HEADERS].some((value) => normalizeHeader(value) === normalized)) {
    return "estimate";
  }
  if (
    [...RAW_DERIVED_HEADERS].some((value) => normalizeHeader(value) === normalized)
    || normalized.endsWith("增长率")
  ) {
    return "derived";
  }
  return "unknown";
}

for (const field of SELLERSPRITE_FIELD_KEYS) {
  for (const alias of FIELD_ALIASES[field]) {
    const normalized = normalizeHeader(alias);
    const existing = HEADER_ALIAS_LOOKUP.get(normalized);
    if (existing && existing !== field) {
      throw new Error(`SELLERSPRITE_FIELD_ALIAS_CONFLICT:${alias}`);
    }
    HEADER_ALIAS_LOOKUP.set(normalized, field);
  }
}

export interface SellerSpriteHeaderMapping {
  fieldMapping: Partial<Record<SellerSpriteFieldKey, string>>;
  fieldIndexes: Partial<Record<SellerSpriteFieldKey, number>>;
  ambiguousFields: ReadonlyArray<SellerSpriteFieldKey>;
  recognizedCount: number;
}

export function mapSellerSpriteHeaders(headers: ReadonlyArray<string | null>): SellerSpriteHeaderMapping {
  const fieldMapping: Partial<Record<SellerSpriteFieldKey, string>> = {};
  const fieldIndexes: Partial<Record<SellerSpriteFieldKey, number>> = {};
  const ambiguousFields = new Set<SellerSpriteFieldKey>();

  headers.forEach((rawHeader, index) => {
    const header = rawHeader?.trim();
    if (!header) return;
    const field = HEADER_ALIAS_LOOKUP.get(normalizeHeader(header));
    if (!field) return;
    if (fieldIndexes[field] !== undefined) {
      ambiguousFields.add(field);
      return;
    }
    fieldIndexes[field] = index;
    fieldMapping[field] = header;
  });

  return {
    fieldMapping,
    fieldIndexes,
    ambiguousFields: [...ambiguousFields],
    recognizedCount: Object.keys(fieldIndexes).length,
  };
}

export interface SellerSpriteSearchRank {
  placementType: "sponsored" | "organic";
  page: number;
  position: number;
}

export type SellerSpriteBsrNormalizedValue = number | ReadonlyArray<number> | null;
export type SellerSpriteNormalizedValue =
  | string
  | number
  | ReadonlyArray<number>
  | SellerSpriteSearchRank
  | null;

export interface SellerSpriteNormalizationResult {
  normalized: SellerSpriteNormalizedValue;
  errorCode?: "invalid_number_format" | "currency_mismatch" | "invalid_asin" | "invalid_url";
}

function normalizeNullableText(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || /^(?:-|--|n\/a|null)$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeNumber(field: SellerSpriteFieldKey, raw: string | null): SellerSpriteNormalizationResult {
  const text = normalizeNullableText(raw);
  if (text === null) return { normalized: null };
  const currencySymbols = text.match(CURRENCY_SYMBOL_PATTERN) ?? [];
  if (CURRENCY_CODE_PREFIX_PATTERN.test(text)) {
    return { normalized: null, errorCode: "currency_mismatch" };
  }
  let numericText = text;
  if (currencySymbols.length > 0) {
    const hasSingleLeadingUsdSymbol = currencySymbols.length === 1
      && currencySymbols[0] === "$"
      && text.startsWith("$");
    if (!USD_AMOUNT_FIELDS.has(field) || !hasSingleLeadingUsdSymbol) {
      return { normalized: null, errorCode: "currency_mismatch" };
    }
    numericText = text.slice(1).trimStart();
  }
  const numberMatch = /^((?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+))$/.exec(numericText);
  if (!numberMatch) return { normalized: null, errorCode: "invalid_number_format" };
  const stripped = numberMatch[1].replaceAll(",", "");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(stripped)) {
    return { normalized: null, errorCode: "invalid_number_format" };
  }
  const value = Number(stripped);
  if (
    !Number.isFinite(value)
    || value < 0
    || (INTEGER_FIELDS.has(field) && !Number.isSafeInteger(value))
    || (POSITIVE_INTEGER_FIELDS.has(field) && value < 1)
  ) {
    return { normalized: null, errorCode: "invalid_number_format" };
  }
  if (field === "rating" && value > 5) {
    return { normalized: null, errorCode: "invalid_number_format" };
  }
  return { normalized: value };
}

export function normalizeSellerSpriteField(
  field: SellerSpriteFieldKey,
  raw: string | null,
): SellerSpriteNormalizationResult {
  if (field === "searchRank") {
    const text = normalizeNullableText(raw);
    if (text === null) return { normalized: null };
    const match = /^(广告位|自然位)\s*[:：]\s*第(\d+)页第(\d+)位$/.exec(text);
    if (!match) return { normalized: null, errorCode: "invalid_number_format" };
    const page = Number.parseInt(match[2], 10);
    const position = Number.parseInt(match[3], 10);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(position) || position < 1) {
      return { normalized: null, errorCode: "invalid_number_format" };
    }
    return {
      normalized: {
        placementType: match[1] === "广告位" ? "sponsored" : "organic",
        page,
        position,
      },
    };
  }
  if (field === "rootCategoryBsr" || field === "subCategoryBsr") {
    const text = normalizeNullableText(raw);
    if (text === null) return { normalized: null };
    const parts = text.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean);
    if (parts.length <= 1) return normalizeNumber(field, text);
    const normalizedParts: number[] = [];
    for (const part of parts) {
      const normalized = normalizeNumber(field, part);
      if (normalized.errorCode || typeof normalized.normalized !== "number") {
        return normalized;
      }
      normalizedParts.push(normalized.normalized);
    }
    return { normalized: normalizedParts };
  }
  if (NUMBER_FIELDS.has(field)) return normalizeNumber(field, raw);
  const normalized = normalizeNullableText(raw);
  if (field === "asin" || field === "parentAsin") {
    if (normalized === null) return { normalized: null };
    const asin = normalized.toUpperCase();
    return /^[A-Z0-9]{10}$/.test(asin)
      ? { normalized: asin }
      : { normalized: null, errorCode: "invalid_asin" };
  }
  if (field === "productUrl") {
    if (normalized === null) return { normalized: null };
    try {
      const url = new URL(normalized);
      return url.protocol === "https:"
        ? { normalized: url.toString() }
        : { normalized: null, errorCode: "invalid_url" };
    } catch {
      return { normalized: null, errorCode: "invalid_url" };
    }
  }
  return { normalized };
}
