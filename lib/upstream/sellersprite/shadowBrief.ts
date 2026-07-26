import { sellerSpriteStableHash } from "./canonical";

const SCHEMA_VERSION = "sellersprite-shadow-selection-brief.v1" as const;

export interface SellerSpriteShadowSelectionBriefInput {
  marketplace: string;
  market: string;
  currency: string;
  query: string;
  category: string | null;
  priceMin: number;
  priceMax: number;
  requiredSignals: ReadonlyArray<string>;
  optionalSignals: ReadonlyArray<string>;
  createdAt: string;
  briefSource: string;
}

export interface SellerSpriteShadowSelectionBrief {
  schemaVersion: typeof SCHEMA_VERSION;
  briefHash: string;
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
  query: string;
  category: string | null;
  priceMin: number;
  priceMax: number;
  requiredSignals: ReadonlyArray<string>;
  optionalSignals: ReadonlyArray<string>;
  createdAt: string;
  briefSource: string;
}

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
  const marketplace = input.marketplace;
  const market = input.market;
  const currency = input.currency;
  const queryValue = input.query;
  const categoryValue = input.category;
  const priceMin = input.priceMin;
  const priceMax = input.priceMax;
  const requiredSignalsValue = input.requiredSignals;
  const optionalSignalsValue = input.optionalSignals;
  const createdAt = input.createdAt;
  const briefSourceValue = input.briefSource;
  const suppliedBriefHash = input.briefHash;

  if (marketplace !== "amazon.com" || market !== "US") {
    throw new Error("SELLERSPRITE_BRIEF_MARKETPLACE_INVALID");
  }
  if (currency !== "USD") {
    throw new Error("SELLERSPRITE_BRIEF_CURRENCY_INVALID");
  }
  if (typeof queryValue !== "string" || queryValue.trim() === "") {
    throw new Error("SELLERSPRITE_BRIEF_QUERY_REQUIRED");
  }
  if (!Object.prototype.hasOwnProperty.call(input, "category")
    || (categoryValue !== null && typeof categoryValue !== "string")) {
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
    requiredSignalsValue,
    "SELLERSPRITE_BRIEF_REQUIRED_SIGNALS_INVALID",
  );
  const optionalSignals = normalizedSignals(
    optionalSignalsValue,
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
    marketplace: "amazon.com" as const,
    market: "US" as const,
    currency: "USD" as const,
    query: queryValue.trim(),
    category: categoryValue?.trim() || null,
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
  };
}

export function createSellerSpriteShadowSelectionBrief(
  input: SellerSpriteShadowSelectionBriefInput,
): SellerSpriteShadowSelectionBrief {
  return normalizeAndValidateSellerSpriteShadowBrief({
    ...input,
    schemaVersion: SCHEMA_VERSION,
  });
}
