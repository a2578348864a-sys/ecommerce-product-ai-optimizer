import type { ProfitCalculationInput, ProfitCalculationResult, ProfitLevel } from "./types";

const DEFAULT_CURRENCY = "USD";

function hasProvidedValue(value: unknown) {
  return value !== undefined
    && value !== null
    && !(typeof value === "string" && value.trim() === "");
}

export function normalizeNumber(value: unknown, defaultValue = 0) {
  const safeDefault = Number.isFinite(defaultValue) ? defaultValue : 0;

  if (value === undefined || value === null) {
    return safeDefault;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : safeDefault;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return safeDefault;
    }

    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : safeDefault;
  }

  return safeDefault;
}

export function roundMoney(value: number, digits = 2) {
  const safeValue = normalizeNumber(value);
  const safeDigits = Math.min(Math.max(Math.trunc(normalizeNumber(digits, 2)), 0), 8);
  const scale = 10 ** safeDigits;
  return Math.round((safeValue + Number.EPSILON) * scale) / scale;
}

function roundRate(value: number) {
  return roundMoney(value, 4);
}

export function formatProfitWarnings(params: {
  baseCost: number;
  commissionRate: number;
  expectedProfitRate: number;
  manualSellingPrice?: number;
  hasManualSellingPrice: boolean;
}) {
  const warnings: string[] = [];

  if (params.baseCost <= 0) {
    warnings.push("商品成本为 0 或小于 0，利润测算仅作为占位结果。");
  }

  if (params.commissionRate < 0) {
    warnings.push("平台佣金率小于 0，请检查输入；调用方应传 0.15 表示 15%。");
  }

  if (params.commissionRate >= 1) {
    warnings.push("平台佣金率大于或等于 1，无法按正常公式计算保本价，已使用安全兜底结果。");
  }

  if (params.expectedProfitRate < 0) {
    warnings.push("预期利润率小于 0，建议确认是否为主动亏损测试。");
  }

  if (params.hasManualSellingPrice && normalizeNumber(params.manualSellingPrice) <= 0) {
    warnings.push("手动售价不是有效正数，已按 0 参与计算。");
  }

  if (
    params.hasManualSellingPrice
    && normalizeNumber(params.manualSellingPrice) > 0
    && normalizeNumber(params.manualSellingPrice) <= params.baseCost
  ) {
    warnings.push("手动售价低于或等于基础成本，预计会亏损。");
  }

  return warnings;
}

export function calculateProfit(input: ProfitCalculationInput): ProfitCalculationResult {
  const purchasePrice = normalizeNumber(input.purchasePrice);
  const domesticShippingFee = normalizeNumber(input.domesticShippingFee);
  const internationalShippingFee = normalizeNumber(input.internationalShippingFee);
  const otherCost = normalizeNumber(input.otherCost);
  const commissionRate = normalizeNumber(input.commissionRate);
  const expectedProfitRate = normalizeNumber(input.expectedProfitRate);
  const hasManualSellingPrice = hasProvidedValue(input.manualSellingPrice);
  const manualSellingPrice = hasManualSellingPrice ? normalizeNumber(input.manualSellingPrice) : undefined;

  const baseCost = purchasePrice + domesticShippingFee + internationalShippingFee + otherCost;
  const safeCommissionRate = commissionRate >= 1 ? 0 : commissionRate;
  const denominator = 1 - safeCommissionRate;
  const breakEvenPrice = denominator > 0 ? baseCost / denominator : baseCost;
  const suggestedPrice = hasManualSellingPrice
    ? normalizeNumber(manualSellingPrice)
    : baseCost * (1 + expectedProfitRate) / denominator;
  const commissionAmount = suggestedPrice * safeCommissionRate;
  const grossProfit = suggestedPrice - commissionAmount - baseCost;
  const grossMargin = suggestedPrice > 0 ? grossProfit / suggestedPrice : 0;
  const roi = baseCost > 0 ? grossProfit / baseCost : 0;

  return {
    baseCost: roundMoney(baseCost),
    totalFixedCost: roundMoney(baseCost),
    commissionRate: roundRate(commissionRate),
    suggestedPrice: roundMoney(suggestedPrice),
    breakEvenPrice: roundMoney(breakEvenPrice),
    commissionAmount: roundMoney(commissionAmount),
    grossProfit: roundMoney(grossProfit),
    grossMargin: roundRate(grossMargin),
    roi: roundRate(roi),
    currency: input.currency || DEFAULT_CURRENCY,
    warnings: formatProfitWarnings({
      baseCost,
      commissionRate,
      expectedProfitRate,
      manualSellingPrice,
      hasManualSellingPrice,
    }),
  };
}

export function getProfitLevel(result: Pick<ProfitCalculationResult, "grossProfit" | "grossMargin">): ProfitLevel {
  if (result.grossProfit <= 0) {
    return "loss";
  }

  if (result.grossMargin < 0.15) {
    return "low";
  }

  if (result.grossMargin < 0.35) {
    return "medium";
  }

  return "high";
}
