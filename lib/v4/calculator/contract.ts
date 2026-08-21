/**
 * V4 P4 — Commercial Calculator 契约（Lead 冻结，D1-D5）。
 * 纯确定性函数；无 LLM 算术。版本 calc-commercial.v1。
 */
import "server-only";

export const CALC_CONTRACT_VERSION = "calc-commercial.v1" as const;

export type InputValueKind = "source_value" | "owner_input" | "assumption";

export type TypedMoney = { value: number; currency: string };

export type CalcInput = {
  purchasePrice: TypedMoney & { kind: InputValueKind; capturedAt: string };
  moq: number; // 件
  salePrice: TypedMoney;
  dims: { lengthCm: number; widthCm: number; heightCm: number } | null; // 缺 → 体积重 unknown
  weightKg: number | null; // 缺 → 运费 unknown
  freightPerKg: TypedMoney | null; // 基础头程
  commissionRate: number; // 平台佣金率（0..1）
  fulfillmentFee: TypedMoney; // FBA/履约费（每件）
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
