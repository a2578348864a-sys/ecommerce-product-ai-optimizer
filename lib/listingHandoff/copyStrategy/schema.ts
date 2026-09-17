import {
  COPY_STRATEGY_SCHEMA,
  type CopyStrategyBullet,
  type CopyStrategyV1,
  type CopyTone,
} from "./types";

const TONES = new Set<CopyTone>(["clear", "practical", "reassuring", "concise"]);

export type CopyStrategyParseResult =
  | { ok: true; value: CopyStrategyV1 }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const keys = new Set(allowed);
  return Object.keys(value).filter((key) => !keys.has(key));
}

function text(value: unknown, path: string, errors: string[], max = 300): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    errors.push(`${path} must be null or a non-empty string <= ${max} chars`);
    return null;
  }
  return value;
}

function parseBullet(value: unknown, path: string, errors: string[]): value is CopyStrategyBullet {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const unknown = unknownKeys(value, ["order", "structure", "purpose", "referenceOnly"]);
  if (unknown.length > 0) errors.push(`${path} has unknown field(s): ${unknown.join(", ")}`);
  if (typeof value.order !== "number" || !Number.isInteger(value.order) || value.order < 1 || value.order > 5) errors.push(`${path}.order must be an integer from 1 to 5`);
  if (value.structure !== "feature_benefit_scenario") errors.push(`${path}.structure is invalid`);
  text(value.purpose, `${path}.purpose`, errors);
  if (value.referenceOnly !== true) errors.push(`${path}.referenceOnly must be true`);
  return true;
}

export function parseCopyStrategyV1(value: unknown): CopyStrategyParseResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["strategy must be an object"] };
  const allowed = ["version", "referenceOnly", "targetBuyer", "buyerPainPoints", "mainAngle", "emotionalHook", "copyTone", "bulletStrategies", "titleStrategy", "descriptionStrategy", "avoidExpressions"] as const;
  const unknown = unknownKeys(value, allowed);
  if (unknown.length > 0) errors.push(`strategy has unknown field(s): ${unknown.join(", ")}`);
  if (value.version !== COPY_STRATEGY_SCHEMA) errors.push("strategy.version is invalid");
  if (value.referenceOnly !== true) errors.push("strategy.referenceOnly must be true");
  text(value.targetBuyer, "targetBuyer", errors);
  text(value.mainAngle, "mainAngle", errors);
  text(value.emotionalHook, "emotionalHook", errors);
  text(value.titleStrategy, "titleStrategy", errors);
  text(value.descriptionStrategy, "descriptionStrategy", errors);
  if (typeof value.copyTone !== "string" || !TONES.has(value.copyTone as CopyTone)) errors.push("copyTone is invalid");
  for (const key of ["buyerPainPoints", "avoidExpressions"] as const) {
    const entries = value[key];
    if (!Array.isArray(entries)) {
      errors.push(`${key} must be an array`);
    } else if (entries.length > 12 || entries.some((entry) => typeof entry !== "string" || entry.trim().length === 0 || entry.length > 300)) {
      errors.push(`${key} must contain at most 12 non-empty strings <= 300 chars`);
    }
  }
  if (!Array.isArray(value.bulletStrategies)) {
    errors.push("bulletStrategies must be an array");
  } else {
    if (value.bulletStrategies.length > 5) errors.push("bulletStrategies exceeds 5 items");
    value.bulletStrategies.forEach((entry, index) => parseBullet(entry, `bulletStrategies[${index}]`, errors));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as CopyStrategyV1 };
}

export function isCopyStrategyV1(value: unknown): value is CopyStrategyV1 {
  return parseCopyStrategyV1(value).ok;
}

export function assertCopyStrategyV1(value: unknown): asserts value is CopyStrategyV1 {
  const parsed = parseCopyStrategyV1(value);
  if (!parsed.ok) throw new Error(`Invalid CopyStrategyV1: ${parsed.errors.join("; ")}`);
}
