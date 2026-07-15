import type { CollectionRun, RawObservation, SelectionBrief } from "./contracts";
import {
  buildSourceIndependentPipeline,
  canonicalizeAmazonProductUrl,
  stableHash,
  type FixturePipelineResult,
} from "./pipeline";

export type SourceAdapterType =
  | "fixture"
  | "json"
  | "csv"
  | "human_assisted_amazon"
  | "amazon_anonymous_auto";

export type QuarantinedSourceRow = {
  rowNumber: number;
  errorCodes: string[];
};

export type SourceAdapterResult = {
  schemaVersion: "source-adapter-result.v1";
  sourceType: SourceAdapterType;
  sourceSchemaVersion: string;
  sourceInputHash: string;
  sourceBatchId: string;
  acceptedCount: number;
  quarantinedCount: number;
  quarantinedRows: QuarantinedSourceRow[];
  qualitySummary: {
    status: "passed" | "failed";
    errorCodes: string[];
  };
  pipeline: FixturePipelineResult | null;
};

export type CsvSourceAdapterInput = {
  schemaVersion: "csv-source-adapter-input.v1";
  csvText: string;
  brief: SelectionBrief | unknown;
  collectionRunId: string;
  collectorVersion: string;
};

type CsvRow = Record<string, string>;

const CSV_SOURCE_SCHEMA_VERSION = "csv-source.v1";
const REQUIRED_CSV_COLUMNS = [
  "marketplace", "market", "query", "sourceUrl", "platformProductId", "parentProductId", "title",
  "price", "currency", "rating", "reviewCount", "sponsored", "brand", "imageUrl", "capturedAt",
  "deliveryRegion", "language", "page", "position",
] as const;
const PROHIBITED_CSV_COLUMNS = new Set([
  "rank", "totalScore", "componentScores", "promotionDecision", "recommendationTier",
  "humanDecision", "aiConclusion", "aiGeneratedConclusion",
]);

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCsvRows(csvText: string): string[][] {
  if (typeof csvText !== "string" || !csvText.trim()) throw new Error("CSV_SOURCE_EMPTY");
  if (csvText.length > 5_000_000) throw new Error("CSV_SOURCE_TOO_LARGE");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"' && csvText[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => item.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV_SOURCE_UNCLOSED_QUOTE");
  row.push(field.replace(/\r$/, ""));
  if (row.some((item) => item.length > 0)) rows.push(row);
  return rows;
}

function csvRecords(csvText: string): { headers: string[]; rows: CsvRow[] } {
  const [headers = [], ...values] = parseCsvRows(csvText);
  const normalizedHeaders = headers.map((header) => header.trim());
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new Error("CSV_SOURCE_DUPLICATE_HEADER");
  return {
    headers: normalizedHeaders,
    rows: values.map((columns) => Object.fromEntries(normalizedHeaders.map((header, index) => [header, columns[index]?.trim() ?? ""]))),
  };
}

function finiteNumber(value: string): number | null {
  if (!value || value.toLowerCase() === "null") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerValue(value: string): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return !normalized || normalized.toLowerCase() === "null" ? null : normalized;
}

function sponsoredValue(value: string): boolean | null | "invalid" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (["", "null", "unknown"].includes(normalized)) return null;
  return "invalid";
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function csvRowErrors(row: CsvRow, brief: SelectionBrief): string[] {
  const errors: string[] = [];
  const asin = row.platformProductId.trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) errors.push("missing_identity");
  let canonicalUrl: string | null = null;
  try {
    canonicalUrl = canonicalizeAmazonProductUrl(row.sourceUrl);
  } catch {
    errors.push("source_url_invalid");
  }
  if (canonicalUrl && /^[A-Z0-9]{10}$/.test(asin) && !canonicalUrl.endsWith(`/${asin}`)) errors.push("identity_url_conflict");
  if (row.marketplace !== brief.marketplace || row.market !== brief.market) errors.push("market_context_conflict");
  if (row.query !== brief.query) errors.push("query_conflict");
  if (row.currency !== brief.targetPriceRange.currency) errors.push("currency_conflict");
  if (!/\b10001\b/.test(row.deliveryRegion)
    || !/\b(?:new york|ny|united states|usa)\b/i.test(row.deliveryRegion)) errors.push("delivery_region_unconfirmed");
  if (row.language.toLowerCase() !== "en-us") errors.push("language_conflict");
  const capturedAt = Date.parse(row.capturedAt);
  if (!Number.isFinite(capturedAt)) errors.push("captured_at_invalid");
  const page = integerValue(row.page);
  if (page === null || page < 1 || page > brief.sampleBudget.maxPages) errors.push("page_out_of_budget");
  const position = integerValue(row.position);
  if (position === null || position < 1) errors.push("position_invalid");
  if (sponsoredValue(row.sponsored) === "invalid") errors.push("sponsored_invalid");
  if (row.imageUrl && row.imageUrl.toLowerCase() !== "null" && !isSafeHttpsUrl(row.imageUrl)) errors.push("image_url_invalid");
  for (const [field, value] of [["price", row.price], ["rating", row.rating], ["reviewCount", row.reviewCount]] as const) {
    if (value && value.toLowerCase() !== "null" && finiteNumber(value) === null) errors.push(`${field}_invalid`);
  }
  return [...new Set(errors)].sort();
}

function adapterResult(
  sourceType: SourceAdapterType,
  sourceSchemaVersion: string,
  sourceInput: unknown,
  pipeline: FixturePipelineResult | null,
  quarantinedRows: QuarantinedSourceRow[],
  extraErrors: string[] = [],
): SourceAdapterResult {
  const sourceInputHash = stableHash(sourceInput);
  const errorCodes = [...new Set([
    ...extraErrors,
    ...(pipeline?.contextGate.errorCodes ?? []),
    ...(pipeline?.layoutGate.errorCodes ?? []),
  ])].sort();
  return {
    schemaVersion: "source-adapter-result.v1",
    sourceType,
    sourceSchemaVersion,
    sourceInputHash,
    sourceBatchId: `source-batch-${stableHash({ sourceType, sourceSchemaVersion, sourceInputHash }).slice(0, 24)}`,
    acceptedCount: pipeline ? pipeline.rawObservations.length - pipeline.quarantined.length : 0,
    quarantinedCount: quarantinedRows.length + (pipeline?.quarantined.length ?? 0),
    quarantinedRows,
    qualitySummary: {
      status: pipeline && errorCodes.length === 0 ? "passed" : "failed",
      errorCodes,
    },
    pipeline,
  };
}

export function adaptCollectedRawSource(input: {
  sourceType: "human_assisted_amazon" | "amazon_anonymous_auto";
  sourceSchemaVersion: string;
  sourceInputHashMaterial: unknown;
  brief: SelectionBrief;
  run: CollectionRun;
  observations: RawObservation[];
}): SourceAdapterResult {
  const observationDrafts = input.observations.map((observation) => {
    const {
      schemaVersion: _schemaVersion,
      collectionRunId: _collectionRunId,
      marketplace: _marketplace,
      market: _market,
      sourceUrl: _sourceUrl,
      capturedAt: _capturedAt,
      contentHash: _contentHash,
      status: _status,
      errorCode: _errorCode,
      ...draft
    } = observation;
    void _schemaVersion;
    void _collectionRunId;
    void _marketplace;
    void _market;
    void _sourceUrl;
    void _capturedAt;
    void _contentHash;
    void _status;
    void _errorCode;
    return draft;
  });
  const pipeline = buildSourceIndependentPipeline({
    schemaVersion: "raw-observation-batch.v1",
    brief: input.brief,
    run: input.run,
    observations: observationDrafts,
  });
  return adapterResult(
    input.sourceType,
    input.sourceSchemaVersion,
    input.sourceInputHashMaterial,
    pipeline,
    [],
  );
}

function adaptStructuredSource(sourceType: "fixture" | "json", input: unknown): SourceAdapterResult {
  if (!recordValue(input) || input.schemaVersion !== "raw-observation-batch.v1") {
    throw new Error(sourceType === "json" ? "JSON_SOURCE_SCHEMA_VERSION_INVALID" : "FIXTURE_SCHEMA_VERSION_INVALID");
  }
  const pipeline = buildSourceIndependentPipeline(input);
  return adapterResult(sourceType, "raw-observation-batch.v1", input, pipeline, []);
}

export function adaptFixtureSource(input: unknown): SourceAdapterResult {
  return adaptStructuredSource("fixture", input);
}

export function adaptJsonSource(jsonText: string): SourceAdapterResult {
  if (typeof jsonText !== "string" || !jsonText.trim()) throw new Error("JSON_SOURCE_EMPTY");
  if (jsonText.length > 5_000_000) throw new Error("JSON_SOURCE_TOO_LARGE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("JSON_SOURCE_PARSE_FAILED");
  }
  return adaptStructuredSource("json", parsed);
}

export function adaptCsvSource(input: CsvSourceAdapterInput): SourceAdapterResult {
  if (!recordValue(input) || input.schemaVersion !== "csv-source-adapter-input.v1") {
    throw new Error("CSV_SOURCE_INPUT_VERSION_INVALID");
  }
  const parsed = csvRecords(input.csvText);
  const prohibitedColumns = parsed.headers.filter((column) => PROHIBITED_CSV_COLUMNS.has(column));
  if (prohibitedColumns.length) {
    const errorCodes = prohibitedColumns.map((column) => `prohibited_column:${column}`);
    const quarantinedRows = parsed.rows.map((_row, index) => ({ rowNumber: index + 2, errorCodes }));
    return adapterResult("csv", CSV_SOURCE_SCHEMA_VERSION, input.csvText, null, quarantinedRows, errorCodes);
  }
  const missingColumns = REQUIRED_CSV_COLUMNS.filter((column) => !parsed.headers.includes(column));
  if (missingColumns.length) {
    const quarantinedRows = parsed.rows.map((_row, index) => ({
      rowNumber: index + 2,
      errorCodes: missingColumns.map((column) => `missing_required_column:${column}`),
    }));
    return adapterResult("csv", CSV_SOURCE_SCHEMA_VERSION, input.csvText, null, quarantinedRows,
      missingColumns.map((column) => `missing_required_column:${column}`));
  }
  if (!recordValue(input.brief) || input.brief.schemaVersion !== "selection-brief.v1") {
    throw new Error("SELECTION_BRIEF_VERSION_INVALID");
  }
  const brief = input.brief as SelectionBrief;
  const quarantinedRows: QuarantinedSourceRow[] = [];
  const accepted: CsvRow[] = [];
  parsed.rows.forEach((row, index) => {
    const errorCodes = csvRowErrors(row, brief);
    if (errorCodes.length) quarantinedRows.push({ rowNumber: index + 2, errorCodes });
    else accepted.push(row);
  });
  if (accepted.length === 0) {
    return adapterResult("csv", CSV_SOURCE_SCHEMA_VERSION, input.csvText, null, quarantinedRows, ["no_accepted_observations"]);
  }
  if (accepted.length > brief.sampleBudget.maxAppearances) throw new Error("SAMPLE_APPEARANCE_BUDGET_EXCEEDED");
  const capturedAt = accepted.map((row) => row.capturedAt).sort()[0];
  const sourceUrl = `https://www.amazon.com/s?k=${encodeURIComponent(brief.query ?? "").replace(/%20/g, "+")}`;
  const observations = accepted.map((row) => {
    const asin = row.platformProductId.toUpperCase();
    const sponsored = sponsoredValue(row.sponsored);
    if (sponsored === "invalid") throw new Error("SPONSORED_STATE_UNREACHABLE");
    const semanticRow = {
      page: integerValue(row.page) as number,
      position: integerValue(row.position) as number,
      asin,
      parentAsin: optionalText(row.parentProductId)?.toUpperCase() ?? null,
      title: optionalText(row.title),
      price: finiteNumber(row.price),
      priceCurrency: row.currency as "USD",
      rating: finiteNumber(row.rating),
      reviewCount: integerValue(row.reviewCount),
      sponsored,
      brand: optionalText(row.brand),
      productUrl: canonicalizeAmazonProductUrl(row.sourceUrl),
      imageUrl: optionalText(row.imageUrl),
    };
    const fieldMissingReasons = Object.fromEntries([
      ["title", semanticRow.title], ["price", semanticRow.price], ["rating", semanticRow.rating],
      ["reviewCount", semanticRow.reviewCount], ["brand", semanticRow.brand], ["imageUrl", semanticRow.imageUrl],
      ["sponsored", semanticRow.sponsored],
    ].filter((entry) => entry[1] === null).map(([field]) => [field, "csv_value_missing"]));
    return {
      appearanceKey: `appearance-csv-${stableHash(semanticRow).slice(0, 20)}`,
      ...semanticRow,
      identityMissingReason: null,
      fieldMissingReasons,
      observedRiskFlags: [],
    };
  });
  const first = accepted[0];
  const batch = {
    schemaVersion: "raw-observation-batch.v1",
    brief,
    run: {
      schemaVersion: "collection-run.v2",
      collectionRunId: input.collectionRunId,
      briefId: brief.briefId,
      requested: {
        marketplace: brief.marketplace,
        market: brief.market,
        currency: brief.targetPriceRange.currency,
      },
      observed: {
        marketplace: first.marketplace,
        market: first.market,
        currency: first.currency,
        deliveryRegion: first.deliveryRegion,
        deliveryRegionMarket: first.market,
        language: first.language.toLowerCase(),
      },
      sampledObservationIds: observations.map((observation) => observation.appearanceKey),
      diagnosticVisiblePriceNodeCount: null,
      pageStatus: "ok",
      sourceUrl,
      capturedAt,
      collectorVersion: input.collectorVersion,
      status: "completed",
      errorCode: null,
      contentHash: "computed_by_pipeline",
    },
    observations,
  };
  let pipeline: FixturePipelineResult | null = null;
  const errors: string[] = [];
  try {
    pipeline = buildSourceIndependentPipeline(batch);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "source_pipeline_failed");
  }
  return adapterResult("csv", CSV_SOURCE_SCHEMA_VERSION, input.csvText, pipeline, quarantinedRows, errors);
}

export function blockedAnonymousAmazonAdapter(): SourceAdapterResult {
  return adapterResult("amazon_anonymous_auto", "amazon-anonymous-auto.v2", {
    status: "blocked_external_source",
  }, null, [], ["blocked_external_source"]);
}
