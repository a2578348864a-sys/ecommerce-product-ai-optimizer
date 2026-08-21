/**
 * V4 P2 — SellerSprite adapter（opportunity-prioritization skill，Worktree B）。
 *
 * 双模式：
 * - recorded：fixture 确定性回放（脱敏 XLSX 案例，测试/CI 默认）。
 * - live：只读复用既有 sellersprite-preview/import 能力（Lead 注入 readLive 读取器，
 *   读取器内部 import 现有解析函数或经 API 契约读取，不改动它们）。
 *
 * 范围（对照 P2_CONTRACT D5）：只输出候选与市场指标，保留 row/column/unit/fileHash；
 * 不复制上传/解析系统；不调用真实付费 Provider；不写数据库。
 *
 * Guards：
 * - currency 必须为 3 位大写字母（USD 等）。
 * - priceMin ≤ priceMax。
 * - sourceFileSha256 应为 64 位 hex（不满足 → warning，不静默改成 AI 值）。
 * - 候选 ASIN 格式校验；重复 ASIN 去重。
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

export const SELLERSPRITE_ADAPTER_VERSION = "sellersprite-adapter.v1" as const;

export type AdapterMode = "recorded" | "live";

/** 幂等存储最小接口（同 idempotencyKey + 同 inputHash 不重复执行）。 */
export type IdempotencyStore = {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
};

export type SellerSpriteMetricNature = "snapshot" | "estimate" | "derived";

export type SellerSpriteMetricSource = {
  field: string;
  value: number | string | null;
  unit: string | null;
  metricNature: SellerSpriteMetricNature;
  row: number | null;
  column: string | null;
};

export type SellerSpriteCandidateSource = {
  asin: string;
  title: string | null;
  brand: string | null;
  parentAsin: string | null;
  metrics: SellerSpriteMetricSource[];
  missingSignals: string[];
  conflictingSignals: string[];
  provisionalDisposition: string;
  researchPriority: string;
};

export type SellerSpriteSourcePayload = {
  sourceFileName: string;
  sourceFileSha256: string;
  sheetName: string;
  headerColumnCount: number;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  reportType: string;
  marketplace: string;
  market: string;
  currency: string;
  category: string;
  priceMin: number;
  priceMax: number;
  query: string | null;
  uniqueAsinCount: number;
  productCount: number;
  conflictCount: number;
  brandConcentration: { topEntity: string | null; topShare: number | null; top3Share: number | null; entityCount: number };
  sellerConcentration: { topEntity: string | null; topShare: number | null; top3Share: number | null; entityCount: number };
  metricNatureCoverage: Record<string, number>;
  candidates: SellerSpriteCandidateSource[];
};

export type SellerSpriteMetric = SellerSpriteMetricSource;

export type SellerSpriteCandidate = {
  candidateKey: string;
  asin: string;
  title: string | null;
  brand: string | null;
  parentAsin: string | null;
  metrics: SellerSpriteMetric[];
  missingSignals: string[];
  conflictingSignals: string[];
  provisionalDisposition: string;
  researchPriority: string;
};

export type SellerSpriteConcentration = {
  topEntity: string | null;
  topShare: number | null;
  top3Share: number | null;
  entityCount: number;
};

export type SellerSpriteMarketMetrics = {
  productCount: number;
  uniqueAsinCount: number;
  conflictCount: number;
  priceMin: number;
  priceMax: number;
  currency: string;
  marketplace: string;
  category: string;
  query: string | null;
  brandConcentration: SellerSpriteConcentration;
  sellerConcentration: SellerSpriteConcentration;
  metricNatureCoverage: Record<string, number>;
  source: {
    sourceFileName: string;
    sourceFileSha256: string;
    sheetName: string;
    headerColumnCount: number;
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
  };
};

export type SellerSpriteAdapterOutput = {
  reportType: string;
  source: SellerSpriteMarketMetrics["source"];
  market: Omit<SellerSpriteMarketMetrics, "source">;
  candidates: SellerSpriteCandidate[];
};

export type SellerSpriteAdapterDeps = {
  mode: AdapterMode;
  now?: () => string;
  idempotency?: IdempotencyStore;
  /** recorded：必须提供 fixture source payload */
  fixture?: SellerSpriteSourcePayload;
  /** live：注入只读读取器（Lead 接到既有 sellersprite-preview/import 数据面） */
  readLive?: (input: ToolCallEnvelope) => Promise<SellerSpriteSourcePayload>;
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

function isValidAsin(value: string): boolean {
  return /^[A-Z0-9]{10}$/.test(value);
}

function isHex64(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
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

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

export function normalizeSellerSpriteSource(
  source: SellerSpriteSourcePayload,
): {
  output: SellerSpriteAdapterOutput | null;
  errors: AdapterError[];
  status: ToolStatus;
  nextAction: ToolResultEnvelope["nextAction"];
} {
  const warnings: ToolWarning[] = [];

  // 币种校验
  if (!/^[A-Z]{3}$/.test(source.currency)) {
    return {
      output: null,
      errors: [{ code: "SCHEMA_INVALID", safeMessage: `invalid currency "${source.currency}" (expected 3 uppercase letters)` }],
      status: "stopped_error",
      nextAction: "revise_plan",
    };
  }
  // 价格区间校验
  if (typeof source.priceMin !== "number" || typeof source.priceMax !== "number" || source.priceMin > source.priceMax) {
    return {
      output: null,
      errors: [{ code: "SCHEMA_INVALID", safeMessage: "invalid price range (priceMin must be <= priceMax)" }],
      status: "stopped_error",
      nextAction: "revise_plan",
    };
  }
  // 文件哈希校验（不静默改成 AI 值）
  if (!isHex64(source.sourceFileSha256)) {
    warnings.push({ code: "INVALID_FILE_HASH", message: "sourceFileSha256 is not a 64-hex string; file provenance unverifiable." });
  }

  // 候选去重 + ASIN 校验
  const seen = new Map<string, SellerSpriteCandidate>();
  for (const candidate of source.candidates ?? []) {
    const asin = asString(candidate.asin);
    if (!asin) {
      warnings.push({ code: "MISSING_ASIN", message: "A candidate row had no ASIN; skipped." });
      continue;
    }
    if (!isValidAsin(asin)) {
      warnings.push({ code: "INVALID_ASIN", message: `Candidate "${asin}" is not a valid 10-char ASIN; skipped.` });
      continue;
    }
    if (seen.has(asin)) {
      warnings.push({ code: "DUPLICATE_ASIN", message: `Candidate "${asin}" appears more than once; kept first occurrence.` });
      continue;
    }
    const metrics: SellerSpriteMetric[] = (candidate.metrics ?? []).map((metric) => ({
      field: metric.field,
      value: metric.value ?? null,
      unit: metric.unit ?? null,
      metricNature: metric.metricNature ?? "snapshot",
      row: metric.row ?? null,
      column: metric.column ?? null,
    }));
    seen.set(asin, {
      candidateKey: asin,
      asin,
      title: candidate.title ?? null,
      brand: candidate.brand ?? null,
      parentAsin: candidate.parentAsin ?? null,
      metrics,
      missingSignals: [...(candidate.missingSignals ?? [])],
      conflictingSignals: [...(candidate.conflictingSignals ?? [])],
      provisionalDisposition: asString(candidate.provisionalDisposition, "unclassified"),
      researchPriority: asString(candidate.researchPriority, "unranked"),
    });
  }

  const candidates = [...seen.values()];
  if (candidates.length === 0) {
    return {
      output: null,
      errors: [],
      status: "no_results",
      nextAction: "revise_plan",
    };
  }

  const sourceBlock: SellerSpriteMarketMetrics["source"] = {
    sourceFileName: source.sourceFileName,
    sourceFileSha256: source.sourceFileSha256,
    sheetName: source.sheetName,
    headerColumnCount: source.headerColumnCount,
    totalRows: source.totalRows,
    acceptedRows: source.acceptedRows,
    rejectedRows: source.rejectedRows,
  };

  const market: Omit<SellerSpriteMarketMetrics, "source"> = {
    productCount: source.productCount ?? candidates.length,
    uniqueAsinCount: source.uniqueAsinCount ?? candidates.length,
    conflictCount: source.conflictCount ?? 0,
    priceMin: source.priceMin,
    priceMax: source.priceMax,
    currency: source.currency,
    marketplace: source.marketplace,
    category: source.category,
    query: source.query ?? null,
    brandConcentration: { ...source.brandConcentration },
    sellerConcentration: { ...source.sellerConcentration },
    metricNatureCoverage: { ...source.metricNatureCoverage },
  };

  const output: SellerSpriteAdapterOutput = {
    reportType: source.reportType,
    source: sourceBlock,
    market,
    candidates,
  };

  return { output, errors: [], status: "ok", nextAction: "continue" };
}

/* -------------------------------------------------------------------------- */
/* Live source converter（preview view-model-like → SellerSpriteSourcePayload） */
/* -------------------------------------------------------------------------- */

function metricFromNumber(value: unknown, field: string, unit: string, nature: SellerSpriteMetricNature, row: number | null, column: string | null): SellerSpriteMetricSource | null {
  const num = asNullableNumber(value);
  if (num === null) return null;
  return { field, value: num, unit, metricNature: nature, row, column };
}

/**
 * 把既有 SellerSprite preview view-model 投影为 SellerSpriteSourcePayload（只读）。
 * 输入为未知结构；缺失字段 fail-closed 忽略并记 warning。row/column 在投影中不可用时为 null。
 */
export function sellerSpriteViewModelToSource(value: unknown): { source: SellerSpriteSourcePayload | null; warnings: string[] } {
  if (!isRecord(value)) return { source: null, warnings: ["sellersprite source is not an object"] };
  const warnings: string[] = [];
  const candidates: SellerSpriteCandidateSource[] = [];
  const products = Array.isArray(value.products) ? value.products : [];
  for (const raw of products) {
    if (!isRecord(raw)) continue;
    const asin = asString(raw.asin);
    if (!asin) {
      warnings.push("skipped product row without asin");
      continue;
    }
    const metrics: SellerSpriteMetricSource[] = [];
    const push = (field: string, unit: string, nature: SellerSpriteMetricNature, numVal: unknown) => {
      const metric = metricFromNumber(numVal, field, unit, nature, null, null);
      if (metric) metrics.push(metric);
    };
    push("price", "USD", "snapshot", raw.price);
    push("estimatedMonthlySales", "units/month", "estimate", raw.estimatedMonthlySales);
    push("rating", "stars", "snapshot", raw.rating);
    push("reviews", "count", "snapshot", raw.reviews);
    push("variationCount", "count", "snapshot", raw.variationCount);
    push("occurrenceCount", "count", "snapshot", raw.occurrenceCount);
    push("bestOrganicPosition", "position", "snapshot", raw.bestOrganicPosition);
    push("bestSponsoredPosition", "position", "snapshot", raw.bestSponsoredPosition);
    candidates.push({
      asin,
      title: raw.title === null || raw.title === undefined ? null : asString(raw.title),
      brand: raw.brand === null || raw.brand === undefined ? null : asString(raw.brand),
      parentAsin: raw.parentAsin === null || raw.parentAsin === undefined ? null : asString(raw.parentAsin),
      metrics,
      missingSignals: Array.isArray(raw.missingSignals) ? raw.missingSignals.filter((m): m is string => typeof m === "string") : [],
      conflictingSignals: Array.isArray(raw.conflictingSignals) ? raw.conflictingSignals.filter((c): c is string => typeof c === "string") : [],
      provisionalDisposition: asString(raw.provisionalDisposition, "unclassified"),
      researchPriority: asString(raw.researchPriority, "unranked"),
    });
  }
  if (candidates.length === 0) return { source: null, warnings: [...warnings, "no usable sellersprite candidates"] };

  const concentration = (raw: unknown): { topEntity: string | null; topShare: number | null; top3Share: number | null; entityCount: number } => {
    if (!isRecord(raw)) return { topEntity: null, topShare: null, top3Share: null, entityCount: 0 };
    return {
      topEntity: typeof raw.topEntity === "string" ? raw.topEntity : null,
      topShare: asNullableNumber(raw.topShare),
      top3Share: asNullableNumber(raw.top3Share),
      entityCount: typeof raw.entityCount === "number" ? raw.entityCount : 0,
    };
  };

  return {
    source: {
      sourceFileName: asString(value.sourceFileName),
      sourceFileSha256: asString(value.sourceFileSha256),
      sheetName: asString(value.sheetName),
      headerColumnCount: typeof value.headerColumnCount === "number" ? value.headerColumnCount : 0,
      totalRows: typeof value.totalRows === "number" ? value.totalRows : candidates.length,
      acceptedRows: typeof value.acceptedRows === "number" ? value.acceptedRows : candidates.length,
      rejectedRows: typeof value.rejectedRows === "number" ? value.rejectedRows : 0,
      reportType: asString(value.reportType, "search_results"),
      marketplace: asString(value.marketplace, "amazon.com"),
      market: asString(value.market, "US"),
      currency: asString(value.currency, "USD"),
      category: asString(value.category),
      priceMin: typeof value.priceMin === "number" ? value.priceMin : 0,
      priceMax: typeof value.priceMax === "number" ? value.priceMax : 0,
      query: value.query === null || value.query === undefined ? null : asString(value.query),
      uniqueAsinCount: typeof value.uniqueAsinCount === "number" ? value.uniqueAsinCount : candidates.length,
      productCount: typeof value.productCount === "number" ? value.productCount : candidates.length,
      conflictCount: typeof value.conflictCount === "number" ? value.conflictCount : 0,
      brandConcentration: concentration(value.brandConcentration),
      sellerConcentration: concentration(value.sellerConcentration),
      metricNatureCoverage: isRecord(value.metricNatureCoverage) ? value.metricNatureCoverage as Record<string, number> : {},
      candidates,
    },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

export async function runSellerSpriteAdapter(
  call: ToolCallEnvelope,
  deps: SellerSpriteAdapterDeps,
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

  let source: SellerSpriteSourcePayload | null = null;
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

  // 实体校验：observedEntity = category（或 query）；与 targetEntity 不匹配 → WRONG_ENTITY。
  const observedEntity = source.category || source.query || call.targetEntity;
  if (call.targetEntity && observedEntity && call.targetEntity !== observedEntity) {
    return buildResult({
      call,
      status: "stopped_error",
      observedEntity,
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
      observedEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt,
      usedCost: 0,
      warnings: [],
      errors: [{ code: "WRONG_ENTITY" }],
      nextAction: "stop",
    });
  }

  const normalized = normalizeSellerSpriteSource(source);

  // WE-1/WE-3 目标 ASIN 未出现在候选集（推荐位/变体混杂错收）→ 停止，不合并证据。
  const targetIsAsin = /^[A-Z0-9]{10}$/.test(call.targetEntity);
  if (targetIsAsin && normalized.output && !normalized.output.candidates.some((c) => c.asin === call.targetEntity)) {
    return buildResult({
      call,
      status: "stopped_error",
      observedEntity: call.targetEntity,
      data: null,
      rawArtifactRefs: [],
      capturedAt,
      usedCost: 0,
      warnings: [],
      errors: [{ code: "WRONG_ENTITY" }],
      nextAction: "stop",
    });
  }
  const rawArtifactRefs: RawArtifactRef[] = [
    {
      kind: deps.mode === "recorded" ? "recorded" : "xlsx",
      ref: `sellersprite/${source.sourceFileSha256.slice(0, 12)}/${source.sheetName}`,
      capturedAt,
    },
  ];

  if (normalized.output === null) {
    return buildResult({
      call,
      status: normalized.status,
      observedEntity,
      data: null,
      rawArtifactRefs,
      capturedAt,
      usedCost: 0,
      warnings: [...sourceWarnings.map((m) => ({ code: "SOURCE_WARNING", message: m }))],
      errors: normalized.errors,
      nextAction: normalized.nextAction,
    });
  }

  const conflictSignals = normalized.output.candidates.some((c) => c.conflictingSignals.length > 0);
  const result = buildResult({
    call,
    status: normalized.status,
    observedEntity,
    data: normalized.output,
    rawArtifactRefs,
    capturedAt,
    usedCost: 0,
    warnings: [
      ...sourceWarnings.map((m) => ({ code: "SOURCE_WARNING", message: m })),
      ...(conflictSignals ? [{ code: "CONFLICT_SIGNALS", message: "Some candidates carry conflicting signals; flag for conflict review." }] : []),
    ],
    errors: normalized.errors,
    nextAction: normalized.nextAction,
  });

  if (deps.idempotency) {
    await deps.idempotency.set(idemKey, result);
  }
  return result;
}
