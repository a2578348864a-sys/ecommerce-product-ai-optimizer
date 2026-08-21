/**
 * V4 P4 — Commercial Calculator（Worktree A，纯函数实现，对齐 Lead P4-C 修订契约）。
 *
 * 纯确定性函数（无 LLM 算术）：相同输入 + 相同注入时间 => 输出完全一致。
 * 版本 calc-commercial.v1。
 *
 * 公式基线（Interpretation B，与 V3.1 r22CommercialValidation 语义对齐）：
 *   - landedCostPerUnit = (采购 + 头程运费 + 包装 + 样品/抽检) / 有效汇率 + 关税
 *   - preAdContributionMargin = 售价 - landedCost - 佣金 - 履约 - 仓储 - 处置 - 退货损失
 *   - marginRate = 贡献利润 / 售价
 *   - moqCapital = 采购价 × MOQ / 有效汇率
 *   - breakEvenUnits = moqCapital / 贡献利润（margin <= 0 -> null）
 *
 * 三情景乘数统一使用契约冻结常量 SCENARIO_MULTIPLIERS（P4-C R3 裁定），避免 A/B 漂移。
 * 本模块为服务端纯函数（server 路由）使用，故可直接从 contract.ts 引入该常量。
 */
import {
  SCENARIO_MULTIPLIERS,
  type CalcInput,
  type CalcOutput,
  type CalcRuleMeta,
  type CalcStatus,
  type ScenarioKey,
  type ScenarioResult,
  type SensitiveVariable,
} from "@/lib/v4/calculator/contract";

/** 输出 schemaVersion：与 contract.ts 冻结常量 CALC_CONTRACT_VERSION 字面量一致。 */
const SCHEMA_VERSION = "calc-commercial.v1" as const;
/** 金额类字段四舍五入到 2 位小数（确定性 round-half-up）。 */
const MONEY_DECIMALS = 2;
/** 比率类字段保留 4 位小数，避免比率精度丢失。 */
const RATE_DECIMALS = 4;
/** 无有效期窗口时，reviewedAt 距今 > 90 天判定为 stale。 */
const STALE_DAYS = 90;
/**
 * 体积重折算系数（cm^3 / kg）。跨境电商空运/快递常用 5000（DHL/FedEx 计费重）。
 * 规格书（06 / RESEARCH_SKILLS_SPEC eval：体积重）未给出具体除数，此为**假设**，
 * 作为命名常量便于 Lead 复核；改动只影响体积重分支，不影响确定性。
 */
const VOLUMETRIC_DIVISOR = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CalcOpts = {
  now: string | Date | number;
  rulesMeta: CalcRuleMeta;
};

type ScenarioMultiplier = { freight: number; fx: number; returnRate: number | null };

export function roundHalfUp(value: number, decimals: number = MONEY_DECIMALS): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  const scaled = value * factor;
  const epsilon = 1e-9 * Math.max(1, Math.abs(scaled));
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + epsilon);
  return rounded / factor;
}

function toMs(value: string | Date | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

function validateInput(input: CalcInput): string[] {
  const issues: string[] = [];
  const invalidNumber = (v: number | undefined): boolean => v !== undefined && !Number.isFinite(v);
  const negative = (v: number | undefined): boolean => invalidNumber(v) || (v as number) < 0;

  if (invalidNumber(input.purchasePrice.value) || input.purchasePrice.value < 0) {
    issues.push("negative_or_nonfinite_purchase_price");
  }
  if (!Number.isFinite(input.moq) || input.moq <= 0) issues.push("invalid_moq");
  if (invalidNumber(input.salePrice.value) || input.salePrice.value <= 0) {
    issues.push("invalid_sale_price");
  }
  if (!Number.isFinite(input.fxRate) || input.fxRate <= 0) issues.push("invalid_fx_rate");
  // commissionRate 可为 null（null=费率 unknown -> BLOCKED_MISSING_INPUT）；非 null 时校验范围。
  if (
    input.commissionRate !== null &&
    input.commissionRate !== undefined &&
    (!Number.isFinite(input.commissionRate) || input.commissionRate < 0 || input.commissionRate > 1)
  ) {
    issues.push("invalid_commission_rate");
  }
  // fulfillmentFee 可为 null（null=费率 unknown -> BLOCKED_MISSING_INPUT）；非 null 时校验非负。
  if (input.fulfillmentFee && negative(input.fulfillmentFee.value)) {
    issues.push("negative_fulfillment_fee");
  }
  if (input.freightPerKg && negative(input.freightPerKg.value)) issues.push("negative_freight_per_kg");
  if (
    input.weightKg !== null &&
    input.weightKg !== undefined &&
    (invalidNumber(input.weightKg) || input.weightKg < 0)
  ) {
    issues.push("negative_or_nonfinite_weight");
  }
  if (input.dims) {
    const { lengthCm, widthCm, heightCm } = input.dims;
    if (negative(lengthCm) || negative(widthCm) || negative(heightCm)) issues.push("negative_dims");
  }
  const o = input.optional;
  if (o) {
    if (negative(o.packagingCostPerUnit?.value)) issues.push("negative_packaging_cost");
    if (negative(o.sampleCostPerUnit?.value)) issues.push("negative_sample_cost");
    if (negative(o.warehousingCostPerUnit?.value)) issues.push("negative_warehousing_cost");
    if (negative(o.disposalCostPerUnit?.value)) issues.push("negative_disposal_cost");
    if (negative(o.adCostPerUnit?.value)) issues.push("negative_ad_cost");
    if (o.returnRate !== undefined && (!Number.isFinite(o.returnRate) || o.returnRate < 0 || o.returnRate > 1)) {
      issues.push("invalid_return_rate");
    }
    if (o.tariffRate !== undefined && (!Number.isFinite(o.tariffRate) || o.tariffRate < 0 || o.tariffRate > 1)) {
      issues.push("invalid_tariff_rate");
    }
  }
  return issues;
}

function computeChargeableWeight(input: CalcInput): {
  chargeable: number;
  block: boolean;
  missing: string[];
  freightUnknowns: string[];
} {
  const hasWeight = input.weightKg !== null && input.weightKg !== undefined;
  const hasDims = input.dims !== null && input.dims !== undefined;
  if (!hasWeight && !hasDims) {
    return {
      chargeable: 0,
      block: true,
      missing: ["weightKg", "dims"],
      freightUnknowns: ["freight_chargeable_weight_unavailable"],
    };
  }
  const volumetric = hasDims
    ? (input.dims!.lengthCm * input.dims!.widthCm * input.dims!.heightCm) / VOLUMETRIC_DIVISOR
    : 0;
  const freightUnknowns: string[] = [];
  let chargeable: number;
  if (hasWeight && hasDims) {
    chargeable = Math.max(input.weightKg!, volumetric);
  } else if (hasWeight) {
    chargeable = input.weightKg!;
    freightUnknowns.push("freight_volumetric_weight_unavailable");
  } else {
    chargeable = volumetric;
    freightUnknowns.push("freight_actual_weight_unavailable");
  }
  return { chargeable, block: false, missing: [], freightUnknowns };
}

function computeScenarioNumbers(
  input: CalcInput,
  mult: ScenarioMultiplier,
  chargeableWeightKg: number,
): {
  landedCost: number;
  margin: number;
  marginRate: number;
  moqCapital: number;
  breakEvenUnits: number | null;
} {
  const effectiveFx = input.fxRate * mult.fx;
  const freightTotal = (input.freightPerKg?.value ?? 0) * mult.freight * chargeableWeightKg;
  const baseGoods =
    input.purchasePrice.value +
    freightTotal +
    (input.optional?.packagingCostPerUnit?.value ?? 0) +
    (input.optional?.sampleCostPerUnit?.value ?? 0);
  const convertedGoods = baseGoods / effectiveFx;
  const duty = (input.optional?.tariffRate ?? 0) * convertedGoods;
  const landedCost = convertedGoods + duty;
  const commission = input.salePrice.value * (input.commissionRate ?? 0);
  const fulfillment = input.fulfillmentFee?.value ?? 0;
  const storage = input.optional?.warehousingCostPerUnit?.value ?? 0;
  const disposal = input.optional?.disposalCostPerUnit?.value ?? 0;
  const returnRate =
    mult.returnRate !== null ? mult.returnRate : (input.optional?.returnRate ?? 0);
  const returnLoss = returnRate * input.salePrice.value;
  const margin =
    input.salePrice.value - landedCost - commission - fulfillment - storage - disposal - returnLoss;
  const marginRate = margin / input.salePrice.value;
  const moqCapital = (input.purchasePrice.value * input.moq) / effectiveFx;
  const breakEvenUnits = margin > 0 ? moqCapital / margin : null;
  return { landedCost, margin, marginRate, moqCapital, breakEvenUnits };
}

function applyInput(input: CalcInput, apply: (copy: CalcInput, scale: number) => void, scale: number): CalcInput {
  const copy = structuredClone(input);
  apply(copy, scale);
  return copy;
}

function computeSensitivity(input: CalcInput, chargeableWeightKg: number): SensitiveVariable[] {
  const base = computeScenarioNumbers(
    input,
    SCENARIO_MULTIPLIERS.baseline,
    chargeableWeightKg,
  ).margin;

  const configs: { name: string; apply: (copy: CalcInput, scale: number) => void }[] = [
    {
      name: "purchasePrice",
      apply: (c, s) => {
        c.purchasePrice = { ...c.purchasePrice, value: c.purchasePrice.value * s };
      },
    },
    {
      name: "freight",
      apply: (c, s) => {
        if (c.freightPerKg) c.freightPerKg = { ...c.freightPerKg, value: c.freightPerKg.value * s };
      },
    },
    {
      name: "commissionRate",
      apply: (c, s) => {
        c.commissionRate = (c.commissionRate ?? 0) * s;
      },
    },
    {
      name: "fulfillmentFee",
      apply: (c, s) => {
        if (c.fulfillmentFee) c.fulfillmentFee = { ...c.fulfillmentFee, value: c.fulfillmentFee.value * s };
      },
    },
    {
      name: "fxRate",
      apply: (c, s) => {
        c.fxRate = c.fxRate * s;
      },
    },
  ];

  const rows: (SensitiveVariable & { raw: number })[] = configs.map(({ name, apply }) => {
    const f = (scale: number) =>
      computeScenarioNumbers(
        applyInput(input, apply, scale),
        SCENARIO_MULTIPLIERS.baseline,
        chargeableWeightKg,
      ).margin;
    const dUp = f(1.1) - base;
    const dDown = f(0.9) - base;
    const impact = Math.max(Math.abs(dUp), Math.abs(dDown));
    const direction: "up" | "down" = dUp > 0 ? "up" : "down";
    return { name, deltaImpact: roundHalfUp(impact, MONEY_DECIMALS), direction, raw: impact };
  });
  rows.sort((a, b) => {
    if (b.raw !== a.raw) return b.raw - a.raw;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return rows.slice(0, 3).map(({ name, deltaImpact, direction }) => ({ name, deltaImpact, direction }));
}

function collectCoverage(
  input: CalcInput,
  freightUnknowns: string[],
): { unknownCosts: string[]; uncoveredCosts: string[] } {
  const o = input.optional;
  const uncoveredCosts: string[] = [];
  if (!o?.packagingCostPerUnit) uncoveredCosts.push("packaging cost");
  if (!o?.sampleCostPerUnit) uncoveredCosts.push("sample/inspection cost");
  if (!o?.warehousingCostPerUnit) uncoveredCosts.push("warehousing cost");
  if (!o?.disposalCostPerUnit) uncoveredCosts.push("disposal cost");
  if (o?.returnRate === undefined) uncoveredCosts.push("return rate");
  if (o?.tariffRate === undefined) uncoveredCosts.push("tariff rate");
  if (!o?.adCostPerUnit) uncoveredCosts.push("ad cost");
  if (freightUnknowns.length > 0) uncoveredCosts.push("freight (partially unknown)");
  return { unknownCosts: freightUnknowns, uncoveredCosts };
}

function isStale(rulesMeta: CalcRuleMeta, nowMs: number): { stale: boolean; reason?: string } {
  // P4-C R1：有生效区间则按 [effectiveDate, effectiveEndDate] 判定；否则回退 reviewedAt>90 天。
  const hasWindow = Boolean(rulesMeta.effectiveDate || rulesMeta.effectiveEndDate);
  if (hasWindow) {
    if (rulesMeta.effectiveDate) {
      const start = Date.parse(rulesMeta.effectiveDate);
      if (!Number.isFinite(start)) return { stale: true, reason: "effectiveDate_invalid" };
      if (nowMs < start) return { stale: true, reason: "rule_not_yet_effective" };
    }
    if (rulesMeta.effectiveEndDate) {
      const end = Date.parse(rulesMeta.effectiveEndDate);
      if (!Number.isFinite(end)) return { stale: true, reason: "effectiveEndDate_invalid" };
      if (nowMs > end) return { stale: true, reason: "rule_expired" };
    }
    return { stale: false };
  }
  const reviewedMs = Date.parse(rulesMeta.reviewedAt);
  if (!Number.isFinite(reviewedMs)) return { stale: true, reason: "reviewedAt_invalid" };
  const stale = nowMs - reviewedMs > STALE_DAYS * DAY_MS;
  return stale ? { stale: true, reason: "reviewedAt_exceeds_90_days" } : { stale: false };
}

export function calcCommercial(input: CalcInput, opts: CalcOpts): CalcStatus {
  if (!input || typeof input !== "object") {
    return { ok: false, code: "INVALID_INPUT", missing: [], message: "invalid_input_shape" };
  }
  const issues = validateInput(input);
  if (issues.length > 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      missing: issues,
      message: "invalid_input: " + issues.join(", "),
    };
  }
  const weightCheck = computeChargeableWeight(input);
  const missingRequired: string[] = [];
  if (!input.freightPerKg) missingRequired.push("freightPerKg");
  // P4-C R2：commissionRate / fulfillmentFee 为 null 表示费率 unknown -> BLOCKED。
  if (input.commissionRate === null || input.commissionRate === undefined) missingRequired.push("commissionRate");
  if (!input.fulfillmentFee) missingRequired.push("fulfillmentFee");
  if (weightCheck.block) missingRequired.push(...weightCheck.missing);
  if (missingRequired.length > 0) {
    return {
      ok: false,
      code: "BLOCKED_MISSING_INPUT",
      missing: missingRequired,
      message: "blocked_missing_input: " + missingRequired.join(", "),
    };
  }
  const nowMs = toMs(opts.now);
  if (!Number.isFinite(nowMs)) {
    return { ok: false, code: "RULES_STALE", missing: [], message: "invalid_now" };
  }
  const staleCheck = isStale(opts.rulesMeta, nowMs);
  if (staleCheck.stale) {
    return {
      ok: false,
      code: "RULES_STALE",
      missing: [],
      message: "rules_stale: " + (staleCheck.reason ?? "unverified"),
    };
  }

  const scenarios = {} as Record<ScenarioKey, ScenarioResult>;
  for (const key of Object.keys(SCENARIO_MULTIPLIERS) as ScenarioKey[]) {
    const numbers = computeScenarioNumbers(input, SCENARIO_MULTIPLIERS[key], weightCheck.chargeable);
    scenarios[key] = {
      landedCostPerUnit: roundHalfUp(numbers.landedCost, MONEY_DECIMALS),
      preAdContributionMargin: roundHalfUp(numbers.margin, MONEY_DECIMALS),
      marginRate: roundHalfUp(numbers.marginRate, RATE_DECIMALS),
      breakEvenUnits:
        numbers.breakEvenUnits === null ? null : roundHalfUp(numbers.breakEvenUnits, MONEY_DECIMALS),
      moqCapital: roundHalfUp(numbers.moqCapital, MONEY_DECIMALS),
    };
  }

  const coverage = collectCoverage(input, weightCheck.freightUnknowns);
  const unknowns: string[] = [...coverage.unknownCosts];
  // P4-C R2：category 缺失 -> 费率规则 unknown（不阻断）。
  if (!input.category || !input.category.trim()) unknowns.push("category");
  if (!opts.rulesMeta.marketplace || !opts.rulesMeta.marketplace.trim()) unknowns.push("marketplace");
  if (!Number.isFinite(Date.parse(input.fxDate))) unknowns.push("fx_date");

  const sensitiveVariables = computeSensitivity(input, weightCheck.chargeable);
  const output: CalcOutput = {
    schemaVersion: SCHEMA_VERSION,
    scenarios,
    sensitiveVariables,
    unknowns,
    uncoveredCosts: coverage.uncoveredCosts,
    rules: {
      ...opts.rulesMeta,
      stale: false,
      staleReason: undefined,
    },
    generatedAt: new Date(nowMs).toISOString(),
  };
  return { ok: true, output };
}
