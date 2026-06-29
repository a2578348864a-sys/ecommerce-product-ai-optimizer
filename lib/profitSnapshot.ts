import {
  type AiSchemaValidationResult,
  invalidSchema,
  repairedSchema,
  validSchema,
} from "@/lib/aiOutputSchema";

export type ProfitDecision = "testable" | "caution" | "not_recommended" | "unknown";

export type ProfitSnapshot = {
  purchaseCost: number;
  salePrice: number;
  platformFeeRate: number;
  platformFeeAmount: number;
  estimatedProfit: number;
  estimatedMarginRate: number;
  decision: ProfitDecision;
  note: string;
  source: "manual_profit_mvp";
  createdAt: string;
  currency?: string;
};

const PROFIT_SCHEMA_NAME = "profitSnapshot";
const DEFAULT_NOTE = "粗略估算，非真实市场价，需人工复核";

type NormalizedNumber = {
  value: number;
  repaired: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeFiniteNumber(value: unknown, fallback = 0): NormalizedNumber {
  const numberValue = typeof value === "number" ? value : Number(value);

  return {
    value: Number.isFinite(numberValue) ? numberValue : fallback,
    repaired: typeof value !== "number" || !Number.isFinite(numberValue),
  };
}

function normalizeProfitDecision(value: unknown, estimatedProfit: number, estimatedMarginRate: number): ProfitDecision {
  if (value === "testable" || value === "caution" || value === "not_recommended" || value === "unknown") {
    return value;
  }
  if (value === "cautious") {
    return "caution";
  }
  if (estimatedProfit <= 0) return "not_recommended";
  if (estimatedMarginRate >= 0.25) return "testable";
  if (estimatedProfit > 0) return "caution";
  return "unknown";
}

export function normalizeProfitSnapshot(raw: unknown): ProfitSnapshot | null {
  if (!isRecord(raw)) return null;

  const purchaseCost = asFiniteNumber(raw.purchaseCost ?? raw.estimatedPurchasePrice);
  const salePrice = asFiniteNumber(raw.salePrice ?? raw.estimatedSellingPrice);
  const rawRate = asFiniteNumber(raw.platformFeeRate ?? raw.commissionRate, 0.15);
  const platformFeeRate = rawRate > 1 ? rawRate / 100 : rawRate;
  const platformFeeAmount = asFiniteNumber(raw.platformFeeAmount, salePrice * platformFeeRate);
  const estimatedProfit = asFiniteNumber(raw.estimatedProfit, salePrice - purchaseCost - platformFeeAmount);
  const estimatedMarginRate = asFiniteNumber(
    raw.estimatedMarginRate ?? raw.estimatedMargin,
    salePrice > 0 ? estimatedProfit / salePrice : 0,
  );
  const note = asString(raw.note, DEFAULT_NOTE);
  const createdAt = asString(raw.createdAt, new Date().toISOString());
  const currency = asString(raw.currency, "");

  return {
    purchaseCost,
    salePrice,
    platformFeeRate,
    platformFeeAmount,
    estimatedProfit,
    estimatedMarginRate,
    decision: normalizeProfitDecision(raw.decision, estimatedProfit, estimatedMarginRate),
    note,
    source: "manual_profit_mvp",
    createdAt,
    ...(currency ? { currency } : {}),
  };
}

export function validateProfitSnapshot(raw: unknown): AiSchemaValidationResult<ProfitSnapshot> {
  if (!isRecord(raw)) {
    return invalidSchema<ProfitSnapshot>(PROFIT_SCHEMA_NAME, {
      fieldErrors: [{ field: PROFIT_SCHEMA_NAME, message: "Profit snapshot must be a JSON object." }],
      userMessage: "利润快照结构异常，已跳过保存。",
    });
  }

  const repairedFields = new Set<string>();
  const warnings: string[] = [];

  const purchaseCost = normalizeFiniteNumber(raw.purchaseCost ?? raw.estimatedPurchasePrice);
  const salePrice = normalizeFiniteNumber(raw.salePrice ?? raw.estimatedSellingPrice);
  const rawRate = normalizeFiniteNumber(raw.platformFeeRate ?? raw.commissionRate, 0.15);
  const platformFeeRate = rawRate.value > 1 ? rawRate.value / 100 : rawRate.value;
  const platformFeeAmount = normalizeFiniteNumber(raw.platformFeeAmount, salePrice.value * platformFeeRate);
  const estimatedProfit = normalizeFiniteNumber(
    raw.estimatedProfit,
    salePrice.value - purchaseCost.value - platformFeeAmount.value,
  );
  const estimatedMarginRate = normalizeFiniteNumber(
    raw.estimatedMarginRate ?? raw.estimatedMargin,
    salePrice.value > 0 ? estimatedProfit.value / salePrice.value : 0,
  );

  const numberResults: Array<[string, NormalizedNumber]> = [
    ["purchaseCost", purchaseCost],
    ["salePrice", salePrice],
    ["platformFeeRate", rawRate],
    ["platformFeeAmount", platformFeeAmount],
    ["estimatedProfit", estimatedProfit],
    ["estimatedMarginRate", estimatedMarginRate],
  ];
  numberResults.forEach(([field, result]) => {
    if (result.repaired) repairedFields.add(field);
  });

  if (raw.purchaseCost === undefined && raw.estimatedPurchasePrice !== undefined) repairedFields.add("purchaseCost");
  if (raw.salePrice === undefined && raw.estimatedSellingPrice !== undefined) repairedFields.add("salePrice");
  if (raw.platformFeeRate === undefined && raw.commissionRate !== undefined) repairedFields.add("platformFeeRate");
  if (raw.estimatedMarginRate === undefined && raw.estimatedMargin !== undefined) repairedFields.add("estimatedMarginRate");
  if (rawRate.value > 1) repairedFields.add("platformFeeRate");

  const decision = normalizeProfitDecision(raw.decision, estimatedProfit.value, estimatedMarginRate.value);
  if (raw.decision !== decision) repairedFields.add("decision");

  const note = asString(raw.note, DEFAULT_NOTE);
  if (!asString(raw.note)) repairedFields.add("note");

  const createdAt = asString(raw.createdAt, new Date().toISOString());
  if (!asString(raw.createdAt)) repairedFields.add("createdAt");

  const currency = asString(raw.currency, "");
  const data: ProfitSnapshot = {
    purchaseCost: purchaseCost.value,
    salePrice: salePrice.value,
    platformFeeRate,
    platformFeeAmount: platformFeeAmount.value,
    estimatedProfit: estimatedProfit.value,
    estimatedMarginRate: estimatedMarginRate.value,
    decision,
    note,
    source: "manual_profit_mvp",
    createdAt,
    ...(currency ? { currency } : {}),
  };

  if (repairedFields.size > 0) {
    warnings.push("Profit snapshot was normalized with defaults or compatible field aliases.");

    return repairedSchema(PROFIT_SCHEMA_NAME, data, {
      repairedFields: [...repairedFields],
      warnings,
      userMessage: "利润快照已按兼容格式修正。",
    });
  }

  return validSchema(PROFIT_SCHEMA_NAME, data);
}
