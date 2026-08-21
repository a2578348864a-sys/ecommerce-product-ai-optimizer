/**
 * V4 P2 — Keyword adapter（keyword-research skill，Worktree B）。
 *
 * 双模式：
 * - recorded：fixture 确定性回放（测试/CI 默认）。
 * - live：只读复用既有 keywordEvidence 数据面（Lead 注入 readLive 读取器，不改动数据面）。
 *
 * Guards（对照 P2_CONTRACT D6 / 06 / RESEARCH_SKILLS_SPEC keyword-research）：
 * - metricType 显式区分 exact / estimate / index。
 * - 禁止跨时间窗相加：本 adapter 不聚合，任何指标保留 period；period 缺失（snapshot）
 *   或混合时间窗时输出 warning，绝不把不同窗口数值合成单一数字。
 * - 禁止第三方热度冒充精确搜索量：仅官方来源可标注 exact；第三方估算一律 estimate/index，
 *   若源声明 exact 但 provider 非官方则降级并告警。
 *
 * 输入 source payload 由调用方提供（fixture 或 live 读取器），本文件只做只读规范化，
 * 不写数据库、不调用真实付费 Provider。
 */
import "server-only";

import {
  validateToolResult,
  type RawArtifactRef,
  type ToolCallEnvelope,
  type ToolResultEnvelope,
  type ToolStatus,
  type ToolWarning,
} from "@/lib/v4/tools/envelope";
import type { ResearchRunErrorCode } from "@/lib/v4/contracts";

export const KEYWORD_ADAPTER_VERSION = "keyword-adapter.v1" as const;

export type AdapterMode = "recorded" | "live";
export type KeywordMetricType = "exact" | "estimate" | "index";

/** 幂等存储最小接口（同 idempotencyKey + 同 inputHash 不重复执行）。 */
export type IdempotencyStore = {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
};

export type KeywordMetricValue = number | { min: number; max: number } | null;

export type KeywordRawMetric = {
  field: string;
  value: KeywordMetricValue;
  unit: string;
  metricType: KeywordMetricType;
  /** null => 无时间窗（snapshot），不可跨窗聚合 */
  period: string | null;
  source: string;
  row: number | null;
};

export type KeywordSourceRow = {
  rowNumber: number;
  term: string;
  translation: string | null;
  relevance: number | null;
  brandTerm: boolean;
  metrics: KeywordRawMetric[];
  /** null => snapshot（无数据期字段，不猜） */
  dataPeriod: string | null;
};

export type KeywordSourcePayload = {
  provider: string;
  reportType: string;
  capturedAt: string;
  dataPeriod: string | null;
  /** 报表绑定的实体（ASIN / seed），用于与 targetEntity 校验 */
  entity: string;
  marketplace: string;
  /** 来源信任声明：official_exact / third_party_estimate / relative_index */
  volumeTrust: "official_exact" | "third_party_estimate" | "relative_index";
  rows: KeywordSourceRow[];
};

export type KeywordMetricOutput = {
  field: string;
  metricType: KeywordMetricType;
  value: KeywordMetricValue;
  unit: string;
  period: string;
  source: string;
  row: number | null;
  evidenceRef: string | null;
};

export type KeywordOutputRow = {
  term: string;
  translation: string | null;
  relevance: number | null;
  brandTerm: boolean;
  dataPeriod: string | null;
  metrics: KeywordMetricOutput[];
};

export type KeywordAdapterOutput = {
  provider: string;
  reportType: string;
  capturedAt: string;
  dataPeriod: string | null;
  timeWindowWarning: string | null;
  keywords: KeywordOutputRow[];
  gaps: string[];
  brandTerms: string[];
  warnings: string[];
};

export type KeywordAdapterDeps = {
  mode: AdapterMode;
  now?: () => string;
  idempotency?: IdempotencyStore;
  /** recorded：必须提供 fixture source payload */
  fixture?: KeywordSourcePayload;
  /** live：注入只读读取器（Lead 接到既有 keywordEvidence 数据面） */
  readLive?: (input: ToolCallEnvelope) => Promise<KeywordSourcePayload>;
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isExactTrusted(source: string, volumeTrust: KeywordSourcePayload["volumeTrust"]): boolean {
  // 仅官方来源可视为精确搜索量；第三方估算/相对指数一律不得标注 exact。
  if (volumeTrust !== "official_exact") return false;
  return /official|amazon/i.test(source);
}

function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

function classifyPeriod(period: string | null, dataPeriod: string | null): string | null {
  return period ?? dataPeriod;
}

/* -------------------------------------------------------------------------- */
/* Envelope helpers                                                            */
/* -------------------------------------------------------------------------- */

type AdapterError = { code: ResearchRunErrorCode; safeMessage?: string };

function buildResult(input: {
  call: ToolCallEnvelope;
  status: ToolStatus;
  observedEntity: string | null;
  data: unknown;
  rawArtifactRefs: RawArtifactRef[];
  capturedAt: string;
  usedCost: number;
  warnings: ToolWarning[];
  errors: AdapterError[];
  nextAction: ToolResultEnvelope["nextAction"];
}): ToolResultEnvelope {
  const result: ToolResultEnvelope = {
    status: input.status,
    observedEntity: input.observedEntity,
    data: input.data,
    rawArtifactRefs: input.rawArtifactRefs,
    capturedAt: input.capturedAt,
    cost: {
      usedCost: input.usedCost,
      currency: input.call.budget.currency,
      usedBrowserSteps: 0,
    },
    warnings: input.warnings,
    errors: input.errors,
    nextAction: input.nextAction,
  };
  const validation = validateToolResult(result);
  if (!validation.ok) {
    // 信封自身损坏（内部 bug），返回 schema 错误信封。
    return {
      status: "stopped_error",
      observedEntity: input.observedEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt: input.capturedAt,
      cost: { usedCost: input.usedCost, currency: input.call.budget.currency, usedBrowserSteps: 0 },
      warnings: input.warnings,
      errors: [{ code: "SCHEMA_INVALID", safeMessage: `envelope build failed: ${validation.reason}` }],
      nextAction: "revise_plan",
    };
  }
  return result;
}

function timeWindowWarningFor(rows: KeywordSourceRow[]): string | null {
  const periods = new Set<string>();
  let hasSnapshot = false;
  for (const row of rows) {
    const p = classifyPeriod(null, row.dataPeriod);
    if (p === null) hasSnapshot = true;
    else periods.add(p);
    for (const metric of row.metrics ?? []) {
      const mp = classifyPeriod(metric.period, row.dataPeriod);
      if (mp === null) hasSnapshot = true;
      else periods.add(mp);
    }
  }
  if (hasSnapshot && periods.size > 0) {
    return "Mixed time windows (snapshot + explicit period); do not sum or compare across windows.";
  }
  if (hasSnapshot) {
    return "No data period (snapshot); these values are point-in-time and cannot be aggregated across time windows.";
  }
  if (periods.size > 1) {
    return "Multiple time windows present; do not sum or compare across windows.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

export function normalizeKeywordSource(
  source: KeywordSourcePayload,
): {
  output: KeywordAdapterOutput;
  errors: AdapterError[];
  status: ToolStatus;
  nextAction: ToolResultEnvelope["nextAction"];
} {
  const warnings: string[] = [];
  const gaps: string[] = [];
  const brandTerms: string[] = [];
  const seen = new Map<string, KeywordOutputRow>();

  if (!source.rows || source.rows.length === 0) {
    return {
      output: {
        provider: source.provider,
        reportType: source.reportType,
        capturedAt: source.capturedAt,
        dataPeriod: source.dataPeriod,
        timeWindowWarning: null,
        keywords: [],
        gaps: ["No keyword rows were available."],
        brandTerms: [],
        warnings: [],
      },
      errors: [],
      status: "no_results",
      nextAction: "revise_plan",
    };
  }

  const timeWindowWarning = timeWindowWarningFor(source.rows);

  for (const row of source.rows) {
    const term = asString(row.term);
    if (!term) {
      gaps.push("A keyword row had no term; skipped.");
      continue;
    }
    const key = normalizeTerm(term);
    if (seen.has(key)) {
      warnings.push(`Keyword "${term}" appears more than once; kept first occurrence.`);
      continue;
    }
    const metrics: KeywordMetricOutput[] = [];
    for (const metric of row.metrics ?? []) {
      if (!metric) continue;
      if (typeof metric.unit !== "string" || metric.unit.trim() === "") {
        warnings.push(`Keyword "${term}" metric "${metric.field}" missing unit; rejected.`);
        continue;
      }
      if (metric.value === null) {
        warnings.push(`Keyword "${term}" metric "${metric.field}" has null value; rejected.`);
        continue;
      }
      let metricType = metric.metricType;
      if (metricType === "exact" && !isExactTrusted(metric.source, source.volumeTrust)) {
        warnings.push(
          `Keyword "${term}" metric "${metric.field}" claimed exact but source "${metric.source}" is not official; downgraded to estimate.`,
        );
        metricType = "estimate";
      }
      const period = classifyPeriod(metric.period, row.dataPeriod);
      metrics.push({
        field: metric.field,
        metricType,
        value: metric.value,
        unit: metric.unit,
        period: period ?? "snapshot",
        source: metric.source,
        row: metric.row ?? row.rowNumber,
        evidenceRef: null,
      });
    }
    if (metrics.length === 0) {
      gaps.push(`Keyword "${term}" had no usable metric; skipped.`);
      continue;
    }
    const brandTerm = row.brandTerm === true;
    if (brandTerm) brandTerms.push(term);
    const outputRow: KeywordOutputRow = {
      term,
      translation: row.translation ?? null,
      relevance: asNullableNumber(row.relevance),
      brandTerm,
      dataPeriod: row.dataPeriod ?? null,
      metrics,
    };
    seen.set(key, outputRow);
  }

  return {
    output: {
      provider: source.provider,
      reportType: source.reportType,
      capturedAt: source.capturedAt,
      dataPeriod: source.dataPeriod,
      timeWindowWarning,
      keywords: [...seen.values()],
      gaps,
      brandTerms: [...new Set(brandTerms)],
      warnings,
    },
    errors: [],
    status: "ok",
    nextAction: "continue",
  };
}

/* -------------------------------------------------------------------------- */
/* Live source converter (keywordEvidence-like → KeywordSourcePayload)         */
/* -------------------------------------------------------------------------- */

function mapKeywordField(field: string, metricNature: string): { unit: string; metricType: KeywordMetricType } | null {
  switch (field) {
    case "monthlySearches":
      return { unit: "searches/month", metricType: "estimate" };
    case "estimatedWeeklyImpressions":
      return { unit: "impressions/week", metricType: "estimate" };
    case "purchases":
      return { unit: "units", metricType: "estimate" };
    case "products":
      return { unit: "count", metricType: "estimate" };
    case "clicks":
      return { unit: "clicks", metricType: "estimate" };
    case "impressions":
      return { unit: "impressions", metricType: "estimate" };
    case "purchaseRate":
    case "clickShare":
    case "conversionShare":
      return { unit: "ratio", metricType: "estimate" };
    case "abaWeeklyRank":
    case "abaMonthlyRank":
      return { unit: "rank", metricType: "index" };
    case "spr":
      return { unit: "ratio", metricType: "index" };
    case "supplyDemandRatio":
      return { unit: "ratio", metricType: "index" };
    case "titleDensity":
      return { unit: "ratio", metricType: "index" };
    case "relevance":
      return { unit: "score", metricType: "index" };
    case "ppcBid":
      return { unit: "USD", metricType: "estimate" };
    case "bidRange":
      return { unit: "USD", metricType: "estimate" };
    default:
      if (metricNature === "snapshot" || metricNature === "estimate") {
        return { unit: "count", metricType: "estimate" };
      }
      return null;
  }
}

function normalizeMetricValue(value: unknown): KeywordMetricValue {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.min === "number" && typeof value.max === "number") {
    return { min: value.min, max: value.max };
  }
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function detectBrandTerm(term: string): boolean {
  // 商标词启发式：含 ®/™，或全大写商标样式。仅作提示，不当作已确认品牌。
  if (/[®™]/.test(term)) return true;
  if (/^[A-Z0-9]{3,12}$/.test(term.trim())) return true;
  return false;
}

/**
 * 把既有 keywordEvidence / keywordReport 行转换为 KeywordSourcePayload（只读）。
 * 输入为未知结构；坏行 fail-closed 忽略并记 warning。不修改原数据面。
 */
export function keywordEvidenceToSource(value: unknown): { source: KeywordSourcePayload | null; warnings: string[] } {
  if (!isRecord(value)) return { source: null, warnings: ["keyword source is not an object"] };
  const provider = asString(value.provider) || "sellersprite-keyword";
  const reportType = asString(value.reportType);
  if (reportType !== "reverse_asin" && reportType !== "keyword_mining") {
    return { source: null, warnings: [`unsupported keyword reportType: ${reportType || "(missing)"}`] };
  }
  const capturedAt = asString(value.capturedAt);
  if (!capturedAt) return { source: null, warnings: ["keyword source missing capturedAt"] };
  const rowsRaw = Array.isArray(value.rows) ? value.rows : [];
  const rows: KeywordSourceRow[] = [];
  const warnings: string[] = [];
  for (const rawRow of rowsRaw) {
    if (!isRecord(rawRow)) {
      warnings.push("skipped non-object keyword row");
      continue;
    }
    const term = asString(rawRow.keyword);
    if (!term) {
      warnings.push("skipped keyword row without keyword text");
      continue;
    }
    const fields = isRecord(rawRow.fields) ? rawRow.fields : {};
    const metrics: KeywordRawMetric[] = [];
    for (const [field, fieldValue] of Object.entries(fields)) {
      if (!isRecord(fieldValue)) continue;
      const applicability = asString(fieldValue.applicability, "missing");
      if (applicability !== "available") continue;
      const value = fieldValue.normalized;
      const metricNature = asString(fieldValue.metricNature, "unknown");
      const mapped = mapKeywordField(field, metricNature);
      if (!mapped) continue;
      metrics.push({
        field,
        value: normalizeMetricValue(value),
        unit: mapped.unit,
        metricType: mapped.metricType,
        period: null,
        source: provider,
        row: asNullableNumber(rawRow.rowNumber) ?? null,
      });
    }
    if (metrics.length === 0) continue;
    const relevance = (() => {
      const rel = fields.relevance;
      if (isRecord(rel) && rel.applicability === "available" && typeof rel.normalized === "number") {
        return rel.normalized;
      }
      return null;
    })();
    rows.push({
      rowNumber: asNullableNumber(rawRow.rowNumber) ?? rows.length + 1,
      term,
      translation: typeof rawRow.keywordTranslation === "string" ? rawRow.keywordTranslation : null,
      relevance,
      brandTerm: detectBrandTerm(term),
      metrics,
      dataPeriod: null,
    });
  }
  if (rows.length === 0) return { source: null, warnings: [...warnings, "no usable keyword rows"] };
  return {
    source: {
      provider,
      reportType,
      capturedAt,
      dataPeriod: null,
      entity: asString(value.entity),
      marketplace: asString(value.marketplace),
      volumeTrust: asString(value.volumeTrust) === "official_exact"
        ? "official_exact"
        : asString(value.volumeTrust) === "relative_index"
          ? "relative_index"
          : "third_party_estimate",
      rows,
    },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

export async function runKeywordAdapter(
  call: ToolCallEnvelope,
  deps: KeywordAdapterDeps,
): Promise<ToolResultEnvelope> {
  const now = deps.now ?? (() => new Date().toISOString());
  const capturedAt = now();
  const idemKey = `${call.idempotencyKey}|${call.inputHash}`;

  if (deps.idempotency) {
    const cached = await deps.idempotency.get(idemKey);
    if (cached !== null && cached !== undefined) {
      return cached as ToolResultEnvelope;
    }
  }

  let source: KeywordSourcePayload | null = null;
  let sourceWarnings: string[] = [];
  if (deps.mode === "recorded") {
    source = deps.fixture ?? null;
    if (!source) sourceWarnings = ["recorded mode requires deps.fixture"];
  } else {
    if (!deps.readLive) {
      sourceWarnings = ["live mode requires deps.readLive"];
    } else {
      try {
        source = await deps.readLive(call);
      } catch (error) {
        const message = error instanceof Error ? error.message : "live read failed";
        return buildResult({
          call,
          status: "stopped_error",
          observedEntity: null,
          data: null,
          rawArtifactRefs: [],
          capturedAt,
          usedCost: 0,
          warnings: [],
          errors: [{ code: "UNKNOWN_RECOVERABLE", safeMessage: message }],
          nextAction: "retry",
        });
      }
    }
  }

  if (!source) {
    return buildResult({
      call,
      status: "stopped_error",
      observedEntity: null,
      data: null,
      rawArtifactRefs: [],
      capturedAt,
      usedCost: 0,
      warnings: sourceWarnings.map((m) => ({ code: "SOURCE_UNAVAILABLE", message: m })),
      errors: [{ code: "SOURCE_STALE" }],
      nextAction: "retry",
    });
  }

  if (source.entity && call.targetEntity && source.entity !== call.targetEntity) {
    return buildResult({
      call,
      status: "stopped_error",
      observedEntity: source.entity,
      data: null,
      rawArtifactRefs: [],
      capturedAt,
      usedCost: 0,
      warnings: [],
      errors: [{ code: "WRONG_ENTITY" }],
      nextAction: "stop",
    });
  }

  // WE-2 地区/站点切换：marketplace 不匹配 → 立即停止。
  if (source.marketplace && call.marketplace && source.marketplace !== call.marketplace) {
    return buildResult({
      call,
      status: "stopped_error",
      observedEntity: source.entity || call.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt,
      usedCost: 0,
      warnings: [],
      errors: [{ code: "WRONG_ENTITY" }],
      nextAction: "stop",
    });
  }

  const normalized = normalizeKeywordSource(source);
  const rawArtifactRefs: RawArtifactRef[] = [
    {
      kind: deps.mode === "recorded" ? "recorded" : "json",
      ref: `keyword/${source.provider}/${source.reportType}`,
      capturedAt,
    },
  ];

  const result = buildResult({
    call,
    status: normalized.status,
    observedEntity: source.entity || call.targetEntity,
    data: normalized.output,
    rawArtifactRefs,
    capturedAt,
    usedCost: 0,
    warnings: [
      ...sourceWarnings.map((m) => ({ code: "SOURCE_WARNING", message: m })),
      ...normalized.output.warnings.map((m) => ({ code: "NORMALIZATION", message: m })),
    ],
    errors: normalized.errors,
    nextAction: normalized.nextAction,
  });

  if (deps.idempotency) {
    await deps.idempotency.set(idemKey, result);
  }
  return result;
}
