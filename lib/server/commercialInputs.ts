import "server-only";

export type CommercialInputCurrency = "CNY" | "USD";
export type CommercialComplianceStatus = "not_reviewed" | "reviewed_ok" | "issues_found";

export type CommercialInputs = {
  /** 单件采购价（value ≥ 0；currency 默认 CNY；0 是合法值，不得当成空值） */
  purchasePrice?: { value: number; currency: CommercialInputCurrency };
  /** MOQ：必须为正整数 */
  moq?: number;
  /** 单件物流成本（规则同采购价） */
  logisticsCost?: { value: number; currency: CommercialInputCurrency };
  /** 合规核对状态与依据备注（备注 ≤ 500 字符） */
  compliance?: { status: CommercialComplianceStatus; note?: string };
};

const CURRENCIES: ReadonlySet<string> = new Set(["CNY", "USD"]);
const COMPLIANCE_STATUSES: ReadonlySet<string> = new Set(["not_reviewed", "reviewed_ok", "issues_found"]);
const NOTE_MAX_CHARS = 500;

export type ParseCommercialInputsResult =
  | { ok: true; inputs: CommercialInputs }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 严格校验：未知字段拒绝；数值有限；MOQ 正整数；备注长度限制；至少提供一个字段。 */
export function parseCommercialInputs(value: unknown): ParseCommercialInputsResult {
  if (!isRecord(value)) return { ok: false, error: "commercial_inputs_invalid" };
  const allowed = new Set(["purchasePrice", "moq", "logisticsCost", "compliance"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return { ok: false, error: "unknown_field:" + key };
  }
  const inputs: CommercialInputs = {};

  if (value.purchasePrice !== undefined) {
    const price = parseMoney(value.purchasePrice, "purchasePrice");
    if (!price.ok) return price;
    inputs.purchasePrice = { value: price.value, currency: price.currency };
  }
  if (value.moq !== undefined) {
    if (typeof value.moq !== "number" || !Number.isInteger(value.moq) || value.moq < 1) {
      return { ok: false, error: "moq_positive_integer_required" };
    }
    inputs.moq = value.moq;
  }
  if (value.logisticsCost !== undefined) {
    const cost = parseMoney(value.logisticsCost, "logisticsCost");
    if (!cost.ok) return cost;
    inputs.logisticsCost = { value: cost.value, currency: cost.currency };
  }
  if (value.compliance !== undefined) {
    if (!isRecord(value.compliance) || typeof value.compliance.status !== "string"
      || !COMPLIANCE_STATUSES.has(value.compliance.status)) {
      return { ok: false, error: "compliance_status_invalid" };
    }
    const compliance: NonNullable<CommercialInputs["compliance"]> = {
      status: value.compliance.status as CommercialComplianceStatus,
    };
    if (value.compliance.note !== undefined) {
      if (typeof value.compliance.note !== "string") return { ok: false, error: "compliance_note_invalid" };
      const note = value.compliance.note.trim();
      if (note.length > NOTE_MAX_CHARS) return { ok: false, error: "compliance_note_too_long" };
      if (note) compliance.note = note;
    }
    inputs.compliance = compliance;
  }

  if (Object.keys(inputs).length === 0) return { ok: false, error: "commercial_inputs_empty" };
  return { ok: true, inputs };
}

function parseMoney(value: unknown, field: string): { ok: true; value: number; currency: CommercialInputCurrency } | { ok: false; error: string } {
  if (!isRecord(value) || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0
    || typeof value.currency !== "string" || !CURRENCIES.has(value.currency)) {
    return { ok: false, error: field + "_invalid" };
  }
  return { ok: true, value: value.value, currency: value.currency as CommercialInputCurrency };
}

/** 存储位置：candidateAnalysisContext.commercialInputs（research-save 写入器拥有；
 * 该命名空间在证据指纹集内 → 完成研究后写入自动沿用既有 stale 重新确认机制）。 */
export const COMMERCIAL_INPUTS_STORAGE = "commercialInputs" as const;

export function readCommercialInputs(result: Record<string, unknown> | null | undefined): CommercialInputs {
  if (!isRecord(result) || !isRecord(result.candidateAnalysisContext)) return {};
  const stored = (result.candidateAnalysisContext as Record<string, unknown>).commercialInputs;
  const parsed = parseCommercialInputs(stored);
  return parsed.ok ? parsed.inputs : {};
}

export function applyCommercialInputsRecord(
  current: Readonly<Record<string, unknown>>,
  inputs: CommercialInputs,
): Record<string, unknown> {
  const context = isRecord(current.candidateAnalysisContext) ? current.candidateAnalysisContext : {};
  return {
    ...current,
    candidateAnalysisContext: { ...context, commercialInputs: inputs },
  };
}

export function isCompletedForInputs(result: unknown): boolean {
  if (!isRecord(result)) return false;
  const completion = isRecord(result.researchCompletion) ? result.researchCompletion : null;
  return completion?.schema === "research-completion.v1" && completion.status === "completed";
}
