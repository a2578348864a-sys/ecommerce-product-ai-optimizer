import {
  MARKETING_INSIGHT_REFERENCE_ONLY,
  MARKETING_INSIGHT_SCHEMA,
  type MarketingInsightItem,
  type MarketingInsightV1,
  type MarketingInsightConfidence,
  type MarketingInsightSourceType,
} from "./types";

const SOURCE_TYPES = new Set<MarketingInsightSourceType>(["VOC", "keyword", "competitor", "sourcing"]);
const CONFIDENCES = new Set<MarketingInsightConfidence>(["high", "medium", "low"]);
const SECTIONS = ["painPoints", "customerNeeds", "marketAngles", "keywordThemes", "competitorPatterns", "recommendations"] as const;
type InsightSection = (typeof SECTIONS)[number];

export type MarketingInsightParseResult =
  | { ok: true; value: MarketingInsightV1 }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): string[] {
  const allowed = new Set(keys);
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function parseItem(value: unknown, path: string, errors: string[]): value is MarketingInsightItem {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const unknown = exactKeys(value, ["topic", "summary", "sourceType", "confidence", "referenceOnly"]);
  if (unknown.length > 0) errors.push(`${path} has unknown field(s): ${unknown.join(", ")}`);
  if (typeof value.topic !== "string" || value.topic.trim().length === 0 || value.topic.length > 120) errors.push(`${path}.topic must be a non-empty string <= 120 chars`);
  if (typeof value.summary !== "string" || value.summary.trim().length === 0 || value.summary.length > 500) errors.push(`${path}.summary must be a non-empty string <= 500 chars`);
  if (typeof value.sourceType !== "string" || !SOURCE_TYPES.has(value.sourceType as MarketingInsightSourceType)) errors.push(`${path}.sourceType is invalid`);
  if (typeof value.confidence !== "string" || !CONFIDENCES.has(value.confidence as MarketingInsightConfidence)) errors.push(`${path}.confidence is invalid`);
  if (value.referenceOnly !== MARKETING_INSIGHT_REFERENCE_ONLY) errors.push(`${path}.referenceOnly must be true`);
  return errors.length === 0;
}

/** Strict runtime validator for the reference-only report. */
export function parseMarketingInsightV1(value: unknown): MarketingInsightParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["report must be an object"] };

  const unknown = exactKeys(value, ["version", "referenceOnly", ...SECTIONS]);
  if (unknown.length > 0) errors.push(`report has unknown field(s): ${unknown.join(", ")}`);
  if (value.version !== MARKETING_INSIGHT_SCHEMA) errors.push("report.version is invalid");
  if (value.referenceOnly !== MARKETING_INSIGHT_REFERENCE_ONLY) errors.push("report.referenceOnly must be true");

  for (const section of SECTIONS) {
    const entries = value[section];
    if (!Array.isArray(entries)) {
      errors.push(`${section} must be an array`);
      continue;
    }
    if (entries.length > 50) errors.push(`${section} exceeds the 50 item limit`);
    entries.forEach((item, index) => parseItem(item, `${section}[${index}]`, errors));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: value as MarketingInsightV1 };
}

export function isMarketingInsightV1(value: unknown): value is MarketingInsightV1 {
  return parseMarketingInsightV1(value).ok;
}

export function assertMarketingInsightV1(value: unknown): asserts value is MarketingInsightV1 {
  const parsed = parseMarketingInsightV1(value);
  if (!parsed.ok) throw new Error(`Invalid MarketingInsightV1: ${parsed.errors.join("; ")}`);
}

export type { InsightSection };

