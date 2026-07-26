import { createHash } from "node:crypto";
import {
  mapSellerSpriteHeaders,
  normalizeSellerSpriteField,
  REQUIRED_SELLERSPRITE_FIELDS,
  SELLERSPRITE_FIELD_KEYS,
  sellerSpriteMetricNatureForField,
  sellerSpriteMetricNatureForRawHeader,
  type SellerSpriteFieldKey,
  type SellerSpriteFieldApplicability,
  type SellerSpriteMetricNature,
  type SellerSpriteNormalizedValue,
  type SellerSpriteBsrNormalizedValue,
  type SellerSpriteSearchRank,
} from "./fields";
import {
  detectSellerSpriteReportType,
  type SellerSpriteDetectedReportType,
  type SellerSpriteReportType,
  type SellerSpriteReportTypeDetectionEvidence,
} from "./reportType";
import {
  parseXlsxWorkbook,
  SellerSpriteXlsxError,
  type XlsxRow,
  type XlsxSheet,
} from "./xlsx";

const SOURCE = "SellerSprite" as const;
const SOURCE_TYPE = "provider_metric" as const;
const SCHEMA_VERSION = "sellersprite-xlsx-precheck.v2" as const;
const HEADER_SCAN_LIMIT = 20;

export interface SellerSpriteFieldValue<T extends SellerSpriteNormalizedValue = SellerSpriteNormalizedValue> {
  raw: string | null;
  normalized: T;
  source: typeof SOURCE;
  sourceType: typeof SOURCE_TYPE;
  capturedAt: string;
  capturedAtSemantics: "caller_supplied_ingestion_context";
  ingestedAt: string;
  exportedAt: null;
  providerUpdatedAt: null;
  metricNature: SellerSpriteMetricNature;
  applicability: SellerSpriteFieldApplicability;
}

export interface SellerSpriteRecord {
  rowNumber: number;
  asin: SellerSpriteFieldValue<string | null>;
  sku: SellerSpriteFieldValue<string | null>;
  brand: SellerSpriteFieldValue<string | null>;
  productTitle: SellerSpriteFieldValue<string | null>;
  productUrl: SellerSpriteFieldValue<string | null>;
  parentAsin: SellerSpriteFieldValue<string | null>;
  searchRank: SellerSpriteFieldValue<SellerSpriteSearchRank | null>;
  price: SellerSpriteFieldValue<number | null>;
  rating: SellerSpriteFieldValue<number | null>;
  reviews: SellerSpriteFieldValue<number | null>;
  estimatedMonthlySales: SellerSpriteFieldValue<number | null>;
  estimatedMonthlyRevenue: SellerSpriteFieldValue<number | null>;
  seller: SellerSpriteFieldValue<string | null>;
  variationCount: SellerSpriteFieldValue<number | null>;
  rootCategory: SellerSpriteFieldValue<string | null>;
  rootCategoryBsr: SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue>;
  subCategory: SellerSpriteFieldValue<string | null>;
  subCategoryBsr: SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue>;
  extraRaw: Readonly<Record<string, string | null>>;
  extraRawMetricNature: Readonly<Record<string, SellerSpriteMetricNature>>;
}

export interface SellerSpritePrecheckError {
  code: string;
  message: string;
  severity: "error" | "warning";
  rowNumber?: number;
  field?: SellerSpriteFieldKey;
  column?: string;
}

export interface SellerSpriteRejectedRecord {
  rowNumber: number;
  raw: Readonly<Record<string, string | null>>;
  errorCodes: ReadonlyArray<string>;
  normalizedRecord?: SellerSpriteRecord;
}

export interface SellerSpriteAggregateRow {
  rowNumber: number;
  entity: SellerSpriteFieldValue<string | null>;
  marketShare: SellerSpriteFieldValue<number | null>;
  raw: Readonly<Record<string, string | null>>;
}

export interface SellerSpriteAggregateEvidence {
  status: "available" | "missing" | "invalid";
  sheetName: string | null;
  fieldMapping: {
    entity: string | null;
    marketShare: string | null;
  };
  rows: ReadonlyArray<SellerSpriteAggregateRow>;
  errors: ReadonlyArray<string>;
}

export interface SellerSpriteNoteEvidence {
  status: "available" | "missing";
  sheetName: string | null;
  rawText: ReadonlyArray<string>;
}

export interface SellerSpriteAuxiliaryEvidence {
  brands: SellerSpriteAggregateEvidence;
  sellers: SellerSpriteAggregateEvidence;
  note: SellerSpriteNoteEvidence;
}

export interface SellerSpritePrecheckResult {
  schemaVersion: typeof SCHEMA_VERSION;
  sourceFileHash: string;
  source: typeof SOURCE;
  sourceType: typeof SOURCE_TYPE;
  ingestedAt: string;
  exportedAt: null;
  providerUpdatedAt: null;
  capturedAtSemantics: "caller_supplied_ingestion_context";
  reportType: SellerSpriteDetectedReportType;
  reportTypeDetectionEvidence: SellerSpriteReportTypeDetectionEvidence;
  expectedReportType: SellerSpriteReportType | null;
  reportTypeMatched: boolean;
  sheetName: string | null;
  headerColumnCount: number;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  fieldMapping: Partial<Record<SellerSpriteFieldKey, string>>;
  errors: ReadonlyArray<SellerSpritePrecheckError>;
  records: ReadonlyArray<SellerSpriteRecord>;
  rejectedRecords: ReadonlyArray<SellerSpriteRejectedRecord>;
  auxiliaryEvidence: SellerSpriteAuxiliaryEvidence;
  productionEffect: false;
  productionDatabaseWritten: false;
}

export interface SellerSpritePrecheckOptions {
  capturedAt: string;
  expectedReportType?: SellerSpriteReportType;
}

interface HeaderCandidate {
  sheet: XlsxSheet;
  header: XlsxRow;
  mapping: ReturnType<typeof mapSellerSpriteHeaders>;
}

function emptyResult(
  sourceFileHash: string,
  expectedReportType: SellerSpriteReportType | null,
): SellerSpritePrecheckResult {
  const ingestedAt = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFileHash,
    source: SOURCE,
    sourceType: SOURCE_TYPE,
    ingestedAt,
    exportedAt: null,
    providerUpdatedAt: null,
    capturedAtSemantics: "caller_supplied_ingestion_context",
    reportType: "unknown",
    reportTypeDetectionEvidence: {
      hasSearchRankColumn: false,
      hasRootCategoryColumn: false,
      hasRootCategoryBsrColumn: false,
      hasSubCategoryColumn: false,
      hasSubCategoryBsrColumn: false,
    },
    expectedReportType,
    reportTypeMatched: false,
    sheetName: null,
    headerColumnCount: 0,
    totalRows: 0,
    acceptedRows: 0,
    rejectedRows: 0,
    fieldMapping: {},
    errors: [],
    records: [],
    rejectedRecords: [],
    auxiliaryEvidence: {
      brands: {
        status: "missing",
        sheetName: null,
        fieldMapping: { entity: null, marketShare: null },
        rows: [],
        errors: [],
      },
      sellers: {
        status: "missing",
        sheetName: null,
        fieldMapping: { entity: null, marketShare: null },
        rows: [],
        errors: [],
      },
      note: {
        status: "missing",
        sheetName: null,
        rawText: [],
      },
    },
    productionEffect: false,
    productionDatabaseWritten: false,
  };
}

function findHeaderCandidate(sheets: ReadonlyArray<XlsxSheet>): HeaderCandidate | null {
  const candidates: HeaderCandidate[] = [];
  for (const sheet of sheets) {
    if (sheet.name.trim().toUpperCase() !== "US") continue;
    for (const row of sheet.rows.slice(0, HEADER_SCAN_LIMIT)) {
      const mapping = mapSellerSpriteHeaders(row.values);
      if (mapping.fieldIndexes.asin !== undefined) {
        candidates.push({ sheet, header: row, mapping });
      }
    }
  }
  const requiredCount = (candidate: HeaderCandidate) => REQUIRED_SELLERSPRITE_FIELDS
    .filter((field) => candidate.mapping.fieldIndexes[field] !== undefined)
    .length;
  const duplicateHeaderCount = (candidate: HeaderCandidate) => {
    const counts = new Map<string, number>();
    candidate.header.values.forEach((header) => {
      const key = header?.trim();
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.values()].filter((count) => count > 1).length;
  };
  const structuralIssueCount = (candidate: HeaderCandidate) => (
    candidate.mapping.ambiguousFields.length + duplicateHeaderCount(candidate)
  );
  candidates.sort((left, right) => (
    requiredCount(right) - requiredCount(left)
    || structuralIssueCount(left) - structuralIssueCount(right)
    || right.mapping.recognizedCount - left.mapping.recognizedCount
  ));
  if (candidates.length === 0) return null;
  if (
    candidates.length > 1
    && requiredCount(candidates[0]) === requiredCount(candidates[1])
    && structuralIssueCount(candidates[0]) === structuralIssueCount(candidates[1])
    && candidates[0].mapping.recognizedCount === candidates[1].mapping.recognizedCount
  ) {
    return null;
  }
  return candidates[0];
}

function rawRow(headers: ReadonlyArray<string | null>, row: XlsxRow): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const headerCounts = new Map<string, number>();
  headers.forEach((header) => {
    const key = header?.trim();
    if (key) headerCounts.set(key, (headerCounts.get(key) ?? 0) + 1);
  });
  headers.forEach((header, index) => {
    const rawKey = header?.trim();
    if (!rawKey) return;
    const key = (headerCounts.get(rawKey) ?? 0) > 1
      ? `${rawKey} [column ${index + 1}]`
      : rawKey;
    result[key] = row.values[index] ?? null;
  });
  return result;
}

function fieldValue(
  raw: string | null,
  normalized: SellerSpriteNormalizedValue,
  capturedAt: string,
  ingestedAt: string,
  metricNature: SellerSpriteMetricNature,
  applicability: SellerSpriteFieldApplicability = normalized === null ? "missing" : "available",
): SellerSpriteFieldValue {
  return {
    raw,
    normalized,
    source: SOURCE,
    sourceType: SOURCE_TYPE,
    capturedAt,
    capturedAtSemantics: "caller_supplied_ingestion_context",
    ingestedAt,
    exportedAt: null,
    providerUpdatedAt: null,
    metricNature,
    applicability,
  };
}

function asStringField(value: SellerSpriteFieldValue): SellerSpriteFieldValue<string | null> {
  return value as SellerSpriteFieldValue<string | null>;
}

function asNumberField(value: SellerSpriteFieldValue): SellerSpriteFieldValue<number | null> {
  return value as SellerSpriteFieldValue<number | null>;
}

function asBsrField(
  value: SellerSpriteFieldValue,
): SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue> {
  return value as SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue>;
}

function asSearchRankField(
  value: SellerSpriteFieldValue,
): SellerSpriteFieldValue<SellerSpriteSearchRank | null> {
  return value as SellerSpriteFieldValue<SellerSpriteSearchRank | null>;
}

function createRecord(
  row: XlsxRow,
  headers: ReadonlyArray<string | null>,
  fieldIndexes: Partial<Record<SellerSpriteFieldKey, number>>,
  capturedAt: string,
  ingestedAt: string,
  reportType: SellerSpriteReportType,
  errors: SellerSpritePrecheckError[],
): SellerSpriteRecord {
  const fields: Partial<Record<SellerSpriteFieldKey, SellerSpriteFieldValue>> = {};
  const mappedIndexes = new Set<number>();
  for (const field of SELLERSPRITE_FIELD_KEYS) {
    const index = fieldIndexes[field];
    if (index !== undefined) mappedIndexes.add(index);
    const raw = index === undefined ? null : row.values[index] ?? null;
    const normalized = normalizeSellerSpriteField(field, raw);
    const applicability: SellerSpriteFieldApplicability = (
      reportType === "category_current" && field === "searchRank"
        ? "not_applicable"
        : normalized.errorCode
          ? "invalid"
          : normalized.normalized === null
            ? "missing"
            : "available"
    );
    fields[field] = fieldValue(
      raw,
      applicability === "not_applicable" ? null : normalized.normalized,
      capturedAt,
      ingestedAt,
      sellerSpriteMetricNatureForField(field),
      applicability,
    );
    if (normalized.errorCode && applicability !== "not_applicable") {
      errors.push({
        code: normalized.errorCode,
        message: `Row ${row.rowNumber} has an invalid ${field} value`,
        severity: "error",
        rowNumber: row.rowNumber,
        field,
      });
    }
  }

  for (const field of REQUIRED_SELLERSPRITE_FIELDS) {
    if (fields[field]?.normalized === null) {
      errors.push({
        code: "missing_required_value",
        message: `Row ${row.rowNumber} is missing required field ${field}`,
        severity: "error",
        rowNumber: row.rowNumber,
        field,
      });
    }
  }
  const asin = fields.asin?.normalized;
  const productUrl = fields.productUrl?.normalized;
  if (typeof asin === "string" && typeof productUrl === "string") {
    const url = new URL(productUrl);
    const hostname = url.hostname.toLowerCase();
    const amazonHost = hostname === "amazon.com" || hostname.endsWith(".amazon.com");
    const urlContainsAsin = url.pathname
      .split("/")
      .some((segment) => segment.toUpperCase() === asin);
    if (!amazonHost || !urlContainsAsin) {
      errors.push({
        code: "invalid_url",
        message: `Row ${row.rowNumber} productUrl does not match its Amazon ASIN`,
        severity: "error",
        rowNumber: row.rowNumber,
        field: "productUrl",
      });
    }
  }

  const extraRaw: Record<string, string | null> = {};
  const extraRawMetricNature: Record<string, SellerSpriteMetricNature> = {};
  headers.forEach((header, index) => {
    const key = header?.trim();
    if (key && !mappedIndexes.has(index)) {
      extraRaw[key] = row.values[index] ?? null;
      extraRawMetricNature[key] = sellerSpriteMetricNatureForRawHeader(key);
    }
  });

  return {
    rowNumber: row.rowNumber,
    asin: asStringField(fields.asin!),
    sku: asStringField(fields.sku!),
    brand: asStringField(fields.brand!),
    productTitle: asStringField(fields.productTitle!),
    productUrl: asStringField(fields.productUrl!),
    parentAsin: asStringField(fields.parentAsin!),
    searchRank: asSearchRankField(fields.searchRank!),
    price: asNumberField(fields.price!),
    rating: asNumberField(fields.rating!),
    reviews: asNumberField(fields.reviews!),
    estimatedMonthlySales: asNumberField(fields.estimatedMonthlySales!),
    estimatedMonthlyRevenue: asNumberField(fields.estimatedMonthlyRevenue!),
    seller: asStringField(fields.seller!),
    variationCount: asNumberField(fields.variationCount!),
    rootCategory: asStringField(fields.rootCategory!),
    rootCategoryBsr: asBsrField(fields.rootCategoryBsr!),
    subCategory: asStringField(fields.subCategory!),
    subCategoryBsr: asBsrField(fields.subCategoryBsr!),
    extraRaw,
    extraRawMetricNature,
  };
}

function normalizedHeader(value: string | null): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeMarketShare(raw: string | null): {
  normalized: number | null;
  invalid: boolean;
} {
  const text = raw?.trim();
  if (!text || /^(?:-|--|n\/a|null)$/i.test(text)) {
    return { normalized: null, invalid: false };
  }
  const percentage = /^(\d+(?:\.\d+)?)%$/.exec(text);
  const numericText = percentage ? percentage[1] : text;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(numericText)) {
    return { normalized: null, invalid: true };
  }
  const value = Number(numericText);
  if (
    !Number.isFinite(value)
    || value < 0
    || (percentage !== null && value > 100)
    || (percentage === null && value > 1)
  ) {
    return { normalized: null, invalid: true };
  }
  return {
    normalized: percentage ? value / 100 : value,
    invalid: false,
  };
}

function findNamedSheet(sheets: ReadonlyArray<XlsxSheet>, name: string): XlsxSheet | undefined {
  return sheets.find((sheet) => sheet.name.trim().toLowerCase() === name.toLowerCase());
}

function parseAggregateEvidence(
  sheets: ReadonlyArray<XlsxSheet>,
  name: "Brands" | "Sellers",
  capturedAt: string,
  ingestedAt: string,
): SellerSpriteAggregateEvidence {
  const sheet = findNamedSheet(sheets, name);
  if (!sheet) {
    return {
      status: "missing",
      sheetName: null,
      fieldMapping: { entity: null, marketShare: null },
      rows: [],
      errors: [],
    };
  }
  const entityAliases = new Set(name === "Brands" ? ["品牌", "brand"] : ["卖家", "seller"]);
  const shareAliases = new Set(["市场份额", "marketshare"]);
  const header = sheet.rows.slice(0, HEADER_SCAN_LIMIT).find((row) => {
    const keys = row.values.map(normalizedHeader);
    return keys.some((key) => entityAliases.has(key)) && keys.some((key) => shareAliases.has(key));
  });
  if (!header) {
    return {
      status: "invalid",
      sheetName: sheet.name,
      fieldMapping: { entity: null, marketShare: null },
      rows: [],
      errors: ["missing_aggregate_header"],
    };
  }
  const entityIndexes = header.values.flatMap((value, index) => (
    entityAliases.has(normalizedHeader(value)) ? [index] : []
  ));
  const marketShareIndexes = header.values.flatMap((value, index) => (
    shareAliases.has(normalizedHeader(value)) ? [index] : []
  ));
  const ambiguousColumns = [
    ...(entityIndexes.length > 1 ? ["ambiguous_aggregate_column:entity"] : []),
    ...(marketShareIndexes.length > 1 ? ["ambiguous_aggregate_column:marketShare"] : []),
  ];
  if (ambiguousColumns.length > 0) {
    return {
      status: "invalid",
      sheetName: sheet.name,
      fieldMapping: {
        entity: entityIndexes.length === 1
          ? header.values[entityIndexes[0]]?.trim() ?? null
          : null,
        marketShare: marketShareIndexes.length === 1
          ? header.values[marketShareIndexes[0]]?.trim() ?? null
          : null,
      },
      rows: [],
      errors: ambiguousColumns,
    };
  }
  const entityIndex = entityIndexes[0];
  const marketShareIndex = marketShareIndexes[0];
  const errors: string[] = [];
  const rows = sheet.rows
    .filter((row) => row.rowNumber > header.rowNumber)
    .map((row): SellerSpriteAggregateRow => {
      const entityRaw = row.values[entityIndex] ?? null;
      const entity = entityRaw?.trim() || null;
      const marketShareRaw = row.values[marketShareIndex] ?? null;
      const marketShare = normalizeMarketShare(marketShareRaw);
      if (marketShare.invalid) errors.push(`invalid_market_share:${row.rowNumber}`);
      return {
        rowNumber: row.rowNumber,
        entity: fieldValue(entityRaw, entity, capturedAt, ingestedAt, "unknown") as SellerSpriteFieldValue<string | null>,
        marketShare: fieldValue(
          marketShareRaw,
          marketShare.normalized,
          capturedAt,
          ingestedAt,
          "derived",
        ) as SellerSpriteFieldValue<number | null>,
        raw: rawRow(header.values, row),
      };
    });
  return {
    status: errors.length === 0 ? "available" : "invalid",
    sheetName: sheet.name,
    fieldMapping: {
      entity: header.values[entityIndex]?.trim() ?? null,
      marketShare: header.values[marketShareIndex]?.trim() ?? null,
    },
    rows,
    errors,
  };
}

function parseNoteEvidence(sheets: ReadonlyArray<XlsxSheet>): SellerSpriteNoteEvidence {
  const sheet = findNamedSheet(sheets, "Note");
  if (!sheet) return { status: "missing", sheetName: null, rawText: [] };
  return {
    status: "available",
    sheetName: sheet.name,
    rawText: sheet.rows.flatMap((row) => row.values)
      .filter((value): value is string => typeof value === "string" && value.trim() !== "")
      .map((value) => value.trim()),
  };
}

export function precheckSellerSpriteXlsx(
  input: Uint8Array,
  options: SellerSpritePrecheckOptions,
): SellerSpritePrecheckResult {
  const sourceFileHash = createHash("sha256").update(input).digest("hex");
  const result = emptyResult(sourceFileHash, options.expectedReportType ?? null);
  const capturedAtMs = Date.parse(options.capturedAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(options.capturedAt)
    || !Number.isFinite(capturedAtMs)
    || new Date(capturedAtMs).toISOString() !== options.capturedAt
  ) {
    return {
      ...result,
      errors: [{
        code: "invalid_captured_at",
        message: "capturedAt must be a valid ISO date-time",
        severity: "error",
      }],
    };
  }

  let workbook;
  try {
    workbook = parseXlsxWorkbook(input);
  } catch (error) {
    const code = error instanceof SellerSpriteXlsxError ? error.code : "invalid_xlsx";
    const message = error instanceof Error ? error.message : "XLSX parsing failed";
    return { ...result, errors: [{ code, message, severity: "error" }] };
  }

  const candidate = findHeaderCandidate(workbook.sheets);
  if (!candidate) {
    return {
      ...result,
      errors: [{
        code: "unsupported_sheet",
        message: "No unique SellerSprite US product worksheet with an ASIN header was found",
        severity: "error",
      }],
    };
  }
  const dataRows = candidate.sheet.rows.filter((row) => row.rowNumber > candidate.header.rowNumber);
  result.sheetName = candidate.sheet.name;
  result.headerColumnCount = candidate.header.values.length;
  result.totalRows = dataRows.length;
  result.fieldMapping = candidate.mapping.fieldMapping;
  const detection = detectSellerSpriteReportType(candidate.header.values);
  result.reportType = detection.reportType;
  result.reportTypeDetectionEvidence = detection.evidence;
  result.expectedReportType = options.expectedReportType
    ?? (detection.reportType === "unknown" ? null : detection.reportType);
  result.reportTypeMatched = detection.reportType !== "unknown"
    && result.expectedReportType === detection.reportType;
  result.auxiliaryEvidence = {
    brands: parseAggregateEvidence(
      workbook.sheets,
      "Brands",
      options.capturedAt,
      result.ingestedAt,
    ),
    sellers: parseAggregateEvidence(
      workbook.sheets,
      "Sellers",
      options.capturedAt,
      result.ingestedAt,
    ),
    note: parseNoteEvidence(workbook.sheets),
  };

  const headerCounts = new Map<string, number>();
  candidate.header.values.forEach((header) => {
    const key = header?.trim();
    if (key) headerCounts.set(key, (headerCounts.get(key) ?? 0) + 1);
  });
  const duplicateHeaders = [...headerCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([header]) => header);
  const structuralErrors: SellerSpritePrecheckError[] = [
    ...(detection.reportType === "unknown" ? [{
      code: "unsupported_report_type",
      message: "SellerSprite report type is not supported by the offline precheck",
      severity: "error" as const,
    }] : []),
    ...(detection.reportType !== "unknown"
      && options.expectedReportType !== undefined
      && options.expectedReportType !== detection.reportType
      ? [{
          code: "report_type_mismatch",
          message: `Expected ${options.expectedReportType} but detected ${detection.reportType}`,
          severity: "error" as const,
        }]
      : []),
    ...candidate.mapping.ambiguousFields.map((field) => ({
      code: "ambiguous_column",
      message: `Multiple columns map to ${field}`,
      severity: "error" as const,
      field,
    })),
    ...REQUIRED_SELLERSPRITE_FIELDS
      .filter((field) => candidate.mapping.fieldIndexes[field] === undefined)
      .map((field) => ({
        code: "missing_required_column",
        message: `Required SellerSprite column is missing: ${field}`,
        severity: "error" as const,
        field,
      })),
    ...duplicateHeaders.map((column) => ({
      code: "duplicate_column_header",
      message: `SellerSprite worksheet contains duplicate header: ${column}`,
      severity: "error" as const,
      column,
    })),
  ];
  if (structuralErrors.length > 0) {
    return {
      ...result,
      rejectedRows: dataRows.length,
      errors: structuralErrors,
      rejectedRecords: dataRows.map((row) => ({
        rowNumber: row.rowNumber,
        raw: rawRow(candidate.header.values, row),
        errorCodes: structuralErrors.map((error) => error.code),
      })),
    };
  }

  const seenAsins = new Set<string>();
  const accepted: SellerSpriteRecord[] = [];
  const rejected: SellerSpriteRejectedRecord[] = [];
  const errors: SellerSpritePrecheckError[] = [];
  for (const row of dataRows) {
    const rowErrors: SellerSpritePrecheckError[] = [];
    const record = createRecord(
      row,
      candidate.header.values,
      candidate.mapping.fieldIndexes,
      options.capturedAt,
      result.ingestedAt,
      detection.reportType as SellerSpriteReportType,
      rowErrors,
    );
    const asin = record.asin.normalized;
    if (asin !== null && seenAsins.has(asin)) {
      errors.push({
        code: "duplicate_asin",
        message: `Row ${row.rowNumber} repeats ASIN ${asin}`,
        severity: "warning",
        rowNumber: row.rowNumber,
        field: "asin",
      });
    }
    if (asin !== null) seenAsins.add(asin);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      rejected.push({
        rowNumber: row.rowNumber,
        raw: rawRow(candidate.header.values, row),
        errorCodes: [...new Set(rowErrors.map((error) => error.code))],
        normalizedRecord: record,
      });
      continue;
    }
    accepted.push(record);
  }

  return {
    ...result,
    acceptedRows: accepted.length,
    rejectedRows: rejected.length,
    errors,
    records: accepted,
    rejectedRecords: rejected,
  };
}
