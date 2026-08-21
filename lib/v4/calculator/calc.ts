/**
 * V4 P4 — Commercial Calculator（Worktree A，纯函数实现）。
 *
 * 纯确定性函数（无 LLM 算术）：相同输入 + 相同注入时间 => 输出完全一致。
 * 版本 calc-commercial.v1。
 *
 * 本实现仅依赖契约 contract.ts 的“类型”与冻结 schemaVersion 字面量，不在运行时
 * 引入 "server-only"，以便在纯 Node / vitest 环境独立可测。
 *
 * 公式基线（Interpretation B，与 V3.1 r22CommercialValidation 语义对齐）：
 *   - landedCostPerUnit = (采购 + 头程运费 + 包装 + 样品/抽检) / 有效汇率 + 关税
 *       —— 即“货物到手成本”（含关税），不含平台佣金/履约费（二者在贡献利润行扣除）。
 *   - 广告前贡献利润 = 售价 - landedCost - 佣金 - 履约 - 仓储 - 处置 - 退货损失
 *   - marginRate = 贡献利润 / 售价
 *   - moqCapital = 采购价 × MOQ / 有效汇率（结算币）
 *   - breakEvenUnits = moqCapital / 贡献利润（贡献利润 <= 0 -> null）
 *
 * 注（偏差，待 Lead 公式裁定）：契约字段 landedCostPerUnit 与 preAdContributionMargin
 * 分离，且 V3.1 r22 规范把“平台佣金 / FBA 履约费”放在贡献利润行单列，故本实现的
 * landedCost 不含它们。工作单“landedCost = .../fxRate + fulfillmentFee + commission + tariff”
 * 字面与“margin = 售价 - landedCost - commission - fulfillment”重复扣除自相矛盾；
 * 本实现取与契约字段名及 r22 一致的自洽分支，偏差记录在交接报告。
 */
import type {
  CalcInput,
  CalcOutput,
  CalcRuleMeta,
  CalcStatus,
  ScenarioKey,
  ScenarioResult,
  SensitiveVariable,
} from "@/lib/v4/calculator/contract";

/** 输出 schemaVersion：与 contract.ts 冻结常量 CALC_CONTRACT_VERSION 字面量一致。 */
const SCHEMA_VERSION = "calc-commercial.v1" as const;
/** 金额类字段四舍五入到 2 位小数（确定性 round-half-up）。 */
const MONEY_DECIMALS = 2;
/** 比率类字段保留 4 位小数，避免比率精度丢失。 */
const RATE_DECIMALS = 4;
/** 规则新鲜度门槛：reviewedAt 距今 > 90 天判定为 stale。 */
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

type ScenarioAdjust = { freightFactor: number; fxFactor: number; returnOverride: number | null };

/** 三情景仅有确定性系数变化（D3）；其余计算完全一致。 */
const SCENARIOS: Record<ScenarioKey, ScenarioAdjust> = {
  baseline: { freightFactor: 1.0, fxFactor: 1.0, returnOverride: null },
  optimistic: { freightFactor: 0.9, fxFactor: 1.05, returnOverride: 0 },
  pessimistic: { freightFactor: 1.3, fxFactor: 0.95, returnOverride: null },
};

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
  if (!Number.isFinite(input.commissionRate) || input.commissionRate < 0 || input.commissionRate > 1) {
    issues.push("invalid_commission_rate");
  }
  if (negative(input.fulfillmentFee.value)) issues.push("negative_fulfillment_fee");
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
  adjust: ScenarioAdjust,
  chargeableWeightKg: number,
): {
  landedCost: number;
  margin: number;
  marginRate: number;
  moqCapital: number;
  breakEvenUnits: number | null;
} {
  const effectiveFx = input.fxRate * adjust.fxFactor;
  const freightTotal = (input.freightPerKg?.value ?? 0) * adjust.freightFactor * chargeableWeightKg;
  const baseGoods =
    input.purchasePrice.value +
    freightTotal +
    (input.optional?.packagingCostPerUnit?.value ?? 0) +
    (input.optional?.sampleCostPerUnit?.value ?? 0);
  const convertedGoods = baseGoods / effectiveFx;
  const duty = (input.optional?.tariffRate ?? 0) * convertedGoods;
  const landedCost = convertedGoods + duty;
  const commission = input.salePrice.value * input.commissionRate;
  const fulfillment = input.fulfillmentFee.value;
  const storage = input.optional?.warehousingCostPerUnit?.value ?? 0;
  const disposal = input.optional?.disposalCostPerUnit?.value ?? 0;
  const returnRate =
    adjust.returnOverride !== null ? adjust.returnOverride : (input.optional?.returnRate ?? 0);
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
  const base = computeScenarioNumbers(input, SCENARIOS.baseline, chargeableWeightKg).margin;
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
        c.commissionRate = c.commissionRate * s;
      },
    },
    {
      name: "fulfillmentFee",
      apply: (c, s) => {
        c.fulfillmentFee = { ...c.fulfillmentFee, value: c.fulfillmentFee.value * s };
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
      computeScenarioNumbers(applyInput(input, apply, scale), SCENARIOS.baseline, chargeableWeightKg).margin;
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

function isStale(reviewedAt: string, nowMs: number): { stale: boolean; reason?: string } {
  const reviewedMs = Date.parse(reviewedAt);
  if (!Number.isFinite(reviewedMs)) {
    return { stale: true, reason: "reviewedAt_invalid" };
  }
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
  const staleCheck = isStale(opts.rulesMeta.reviewedAt, nowMs);
  if (staleCheck.stale) {
    return {
      ok: false,
      code: "RULES_STALE",
      missing: [],
      message: "rules_stale: " + (staleCheck.reason ?? "reviewedAt_exceeds_90_days"),
    };
  }
  const scenarios = {} as Record<ScenarioKey, ScenarioResult>;
  for (const key of Object.keys(SCENARIOS) as ScenarioKey[]) {
    const numbers = computeScenarioNumbers(input, SCENARIOS[key], weightCheck.chargeable);
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
  if (!opts.rulesMeta.category || !opts.rulesMeta.category.trim()) unknowns.push("category");
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
      version: opts.rulesMeta.version,
      marketplace: opts.rulesMeta.marketplace,
      category: opts.rulesMeta.category,
      reviewedAt: opts.rulesMeta.reviewedAt,
      sourceUrl: opts.rulesMeta.sourceUrl,
      stale: false,
      staleReason: undefined,
    },
    generatedAt: new Date(nowMs).toISOString(),
  };
  return { ok: true, output };
}
