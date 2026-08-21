/**
 * V4 P4 — Commercial Calculator 契约（Lead 冻结，D1-D5）。
 * 纯确定性函数；无 LLM 算术。版本 calc-commercial.v1。
 */
import "server-only";

export const CALC_CONTRACT_VERSION = "calc-commercial.v1" as const;

export type InputValueKind = "source_value" | "owner_input" | "assumption";

export type TypedMoney = { value: number; currency: string };

/** 三情景冻结乘数（P4-C R3 裁定，共享常量防 A/B 漂移）。 */
export const SCENARIO_MULTIPLIERS = {
  optimistic: { freight: 0.9, fx: 1.05, returnRate: 0 },
  baseline: { freight: 1.0, fx: 1.0, returnRate: null },
  pessimistic: { freight: 1.3, fx: 0.95, returnRate: null },
} as const;

export type CalcInput = {
  purchasePrice: TypedMoney & { kind: InputValueKind; capturedAt: string };
  moq: number; // 件
  salePrice: TypedMoney;
  category: string | null; // 缺 → 费率规则 unknown（P4-C R2 裁定）
  dims: { lengthCm: number; widthCm: number; heightCm: number } | null; // 缺 → 体积重 unknown
  weightKg: number | null; // 缺 → 运费 unknown
  freightPerKg: TypedMoney | null; // 基础头程
  commissionRate: number | null; // null=费率 unknown → BLOCKED_MISSING_INPUT
  fulfillmentFee: TypedMoney | null; // null=费率 unknown → BLOCKED_MISSING_INPUT
  fxRate: number; // 本币→结算币
  fxDate: string;
  optional?: {
    packagingCostPerUnit?: TypedMoney;
    sampleCostPerUnit?: TypedMoney;
    warehousingCostPerUnit?: TypedMoney;
    returnRate?: number; // 0..1
    disposalCostPerUnit?: TypedMoney;
    tariffRate?: number; // 0..1
    adCostPerUnit?: TypedMoney;
  };
};

export type ScenarioKey = "optimistic" | "baseline" | "pessimistic";

export type ScenarioResult = {
  landedCostPerUnit: number; // 结算币
  preAdContributionMargin: number;
  marginRate: number;
  breakEvenUnits: number | null;
  moqCapital: number;
};

export type SensitiveVariable = { name: string; deltaImpact: number; direction: "up" | "down" };

export type CalcRuleMeta = {
  version: string;
  marketplace: string;
  category: string;
  reviewedAt: string;
  sourceUrl: string;
  /** P4-C R1 裁定：有 effectiveDate/effectiveEndDate 时按有效期判定 stale，否则 reviewedAt>90 天。 */
  effectiveDate?: string;
  effectiveEndDate?: string;
  stale: boolean;
  staleReason?: string;
};

export type CalcOutput = {
  schemaVersion: typeof CALC_CONTRACT_VERSION;
  scenarios: Record<ScenarioKey, ScenarioResult>;
  sensitiveVariables: SensitiveVariable[];
  unknowns: string[];
  uncoveredCosts: string[];
  rules: CalcRuleMeta;
  generatedAt: string;
};

export type CalcStatus =
  | { ok: true; output: CalcOutput }
  | { ok: false; code: "BLOCKED_MISSING_INPUT" | "RULES_STALE" | "INVALID_INPUT"; missing: string[]; message: string };

export type GateBOption = "proceed" | "get_more_info" | "modify_product" | "stop";

export type GateBInput = { option: GateBOption; reason?: string; revision: number; actor: string };