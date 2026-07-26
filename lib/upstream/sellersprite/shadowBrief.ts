import { sellerSpriteStableHash } from "./canonical";
import type { SellerSpriteReportType } from "./reportType";

const SCHEMA_VERSION = "sellersprite-shadow-selection-brief.v2" as const;

interface SellerSpriteShadowSelectionBriefInputCommon {
  marketplace: string;
  market: string;
  currency: string;
  category: string | null;
  priceMin: number;
  priceMax: number;
  requiredSignals: ReadonlyArray<string>;
  optionalSignals: ReadonlyArray<string>;
  createdAt: string;
  briefSource: string;
}

export type SellerSpriteShadowSelectionBriefInput =
  | (SellerSpriteShadowSelectionBriefInputCommon & {
    reportType?: "search_results";
    query: string;
  })
  | (SellerSpriteShadowSelectionBriefInputCommon & {
    reportType: "category_current";
    query?: string | null;
  });

interface SellerSpriteShadowSelectionBriefCommon {
  schemaVersion: typeof SCHEMA_VERSION;
  briefHash: string;
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
  category: string;
  priceMin: number;
  priceMax: number;
  requiredSignals: ReadonlyArray<string>;
  optionalSignals: ReadonlyArray<string>;
  createdAt: string;
  briefSource: string;
}

export type SellerSpriteShadowSelectionBrief =
  | (SellerSpriteShadowSelectionBriefCommon & {
    reportType: "search_results";
    query: string;
  })
  | (SellerSpriteShadowSelectionBriefCommon & {
    reportType: "category_current";
    query: null;
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedSignals(value: unknown, errorCode: string): string[] {
  if (!Array.isArray(value) || !value.every((signal) => typeof signal === "string")) {
    throw new Error(errorCode);
  }
  return [...new Set(value.map((signal) => signal.trim()).filter(Boolean))].sort();
}

function validIsoInstant(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === (
      value.includes(".") ? value : value.replace("Z", ".000Z")
    );
}

export function normalizeAndValidateSellerSpriteShadowBrief(
  input: unknown,
): SellerSpriteShadowSelectionBrief {
  if (!isRecord(input) || input.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("SELLERSPRITE_SHADOW_BRIEF_VERSION_INVALID");
  }
  const reportTypeValue = input.reportType;
  if (reportTypeValue !== "search_results" && reportTypeValue !== "category_current") {
    throw new Error("SELLERSPRITE_BRIEF_REPORT_TYPE_INVALID");
  }
  const reportType: SellerSpriteReportType = reportTypeValue;
  const marketplace = input.marketplace;
  const market = input.market;
  const currency = input.currency;
  const queryValue = input.query;
  const categoryValue = input.category;
  const priceMin = input.priceMin;
  const priceMax = input.priceMax;
  const createdAt = input.createdAt;
  const briefSourceValue = input.briefSource;
  const suppliedBriefHash = input.briefHash;

  if (marketplace !== "amazon.com" || market !== "US") {
    throw new Error("SELLERSPRITE_BRIEF_MARKETPLACE_INVALID");
  }
  if (currency !== "USD") {
    throw new Error("SELLERSPRITE_BRIEF_CURRENCY_INVALID");
  }
  let query: string | null;
  if (reportType === "search_results") {
    if (typeof queryValue !== "string" || queryValue.trim() === "") {
      throw new Error("SELLERSPRITE_BRIEF_QUERY_REQUIRED");
    }
    query = queryValue.trim();
  } else {
    if (queryValue !== undefined && queryValue !== null) {
      throw new Error("SELLERSPRITE_BRIEF_QUERY_NOT_APPLICABLE");
    }
    query = null;
  }
  if (typeof categoryValue !== "string" || categoryValue.trim() === "") {
    throw new Error("SELLERSPRITE_BRIEF_CATEGORY_INVALID");
  }
  if (
    typeof priceMin !== "number"
    || typeof priceMax !== "number"
    || !Number.isFinite(priceMin)
    || !Number.isFinite(priceMax)
    || priceMin < 0
    || priceMax < 0
    || priceMin > priceMax
  ) {
    throw new Error("SELLERSPRITE_BRIEF_PRICE_RANGE_INVALID");
  }
  const requiredSignals = normalizedSignals(
    input.requiredSignals,
    "SELLERSPRITE_BRIEF_REQUIRED_SIGNALS_INVALID",
  );
  const optionalSignals = normalizedSignals(
    input.optionalSignals,
    "SELLERSPRITE_BRIEF_OPTIONAL_SIGNALS_INVALID",
  ).filter((signal) => !requiredSignals.includes(signal));
  if (!validIsoInstant(createdAt)) {
    throw new Error("SELLERSPRITE_BRIEF_CREATED_AT_INVALID");
  }
  if (typeof briefSourceValue !== "string" || briefSourceValue.trim() === "") {
    throw new Error("SELLERSPRITE_BRIEF_SOURCE_REQUIRED");
  }

  const hashPayload = {
    schemaVersion: SCHEMA_VERSION,
    reportType,
    marketplace: "amazon.com" as const,
    market: "US" as const,
    currency: "USD" as const,
    query,
    category: categoryValue.trim(),
    priceMin,
    priceMax,
    requiredSignals,
    optionalSignals,
    briefSource: briefSourceValue.trim(),
  };
  const briefHash = sellerSpriteStableHash(hashPayload);
  if (suppliedBriefHash !== undefined && suppliedBriefHash !== briefHash) {
    throw new Error("SELLERSPRITE_BRIEF_HASH_MISMATCH");
  }
  return {
    ...hashPayload,
    briefHash,
    createdAt,
  } as SellerSpriteShadowSelectionBrief;
}

export function createSellerSpriteShadowSelectionBrief(
  input: SellerSpriteShadowSelectionBriefInput,
): SellerSpriteShadowSelectionBrief {
  return normalizeAndValidateSellerSpriteShadowBrief({
    ...input,
    reportType: input.reportType ?? "search_results",
    schemaVersion: SCHEMA_VERSION,
  });
}
