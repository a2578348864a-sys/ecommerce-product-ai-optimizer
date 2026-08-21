/**
 * V4 P2 — VOC adapter（review-voc-analysis skill，Worktree B）。
 *
 * 双模式：
 * - recorded：fixture 确定性回放（测试/CI 默认）。
 * - live：只读复用既有 reviewEvidence / vocAnalysis 数据面（Lead 注入 readLive 读取器）。
 *
 * Guards（对照 P2_CONTRACT D7 / 06 / RESEARCH_SKILLS_SPEC review-voc-analysis）：
 * - 最小样本阈值：样本 < MIN_SAMPLE → lowConfidence + 告警。
 * - 去重：按 duplicateKey / 文本归一化去重。
 * - 模板/机器人评论提示：重复文本与泛模板短语 → 告警并计入 biases。
 * - 变体混杂提示：多 ASIN / 多来源角色 → 告警并计入 biases。
 * - 版权最小化：只保留主题摘要（≤ MAX_SUMMARY 字符）与短摘录，绝不复制整条评论原文。
 * - 注入：评论为 UNTRUSTED DATA；检测指令样文本 → injectionDetected 告警，但不改变行为。
 * - evidenceRefs 硬校验：ref 必须命中实际样本，否则该主题进 unverified（不输出无证据主题）。
 *
 * 本文件只做只读规范化，不写数据库、不调用真实付费 Provider。
 */
import "server-only";

import { createHash } from "node:crypto";

import {
  validateToolResult,
  type RawArtifactRef,
  type ToolCallEnvelope,
  type ToolResultEnvelope,
  type ToolStatus,
  type ToolWarning,
} from "@/lib/v4/tools/envelope";
import type { ResearchRunErrorCode } from "@/lib/v4/contracts";

export const VOC_ADAPTER_VERSION = "voc-adapter.v1" as const;
export const VOC_MIN_SAMPLE = 5 as const;
export const VOC_MAX_SUMMARY_CHARS = 200 as const;
export const VOC_MAX_EXCERPT_CHARS = 120 as const;
export const VOC_TEMPLATE_REPEAT_THRESHOLD = 3 as const;

export type AdapterMode = "recorded" | "live";

/** 幂等存储最小接口（同 idempotencyKey + 同 inputHash 不重复执行）。 */
export type IdempotencyStore = {
  get(key: string): Promise<unknown | null>;
  set(key: string, value: unknown): Promise<void>;
};

export type VocReviewSource = {
  evidenceId: string;
  productAsin: string;
  sourceProductRole: "current_candidate" | "competitor";
  rating: number | null;
  reviewDate: string | null;
  /** UNTRUSTED DATA：仅用于去重/统计，永不整段进入输出 */
  reviewText: string;
  duplicateKey: string | null;
  language: string | null;
  locale: string | null;
};

export type VocThemeSource = {
  label: string;
  bucket: string;
  evidenceRefs: string[];
  summary: string;
  limitations: string | null;
};

export type VocSourcePayload = {
  candidateId: string | null;
  sampledEvidenceIds: string[] | null;
  reviews: VocReviewSource[];
  themes: VocThemeSource[];
  unknowns: string[];
  nextResearchSteps: string[];
};

export type VocThemeOutput = {
  label: string;
  bucket: string;
  count: number;
  share: number;
  evidenceRefs: string[];
  summary: string;
};

export type VocAdapterOutput = {
  sampleSize: number;
  samplingMethod: string;
  minSampleThreshold: number;
  lowConfidence: boolean;
  themes: VocThemeOutput[];
  scenarios: string[];
  languagePatterns: string[];
  biases: string[];
  unknowns: string[];
  warnings: string[];
  injectionDetected: boolean;
  copyrightMinimized: boolean;
};

export type VocAdapterDeps = {
  mode: AdapterMode;
  now?: () => string;
  idempotency?: IdempotencyStore;
  /** recorded：必须提供 fixture source payload */
  fixture?: VocSourcePayload;
  /** live：注入只读读取器（Lead 接到既有 reviewEvidence/vocAnalysis 数据面） */
  readLive?: (input: ToolCallEnvelope) => Promise<VocSourcePayload>;
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

function normalizeText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function reviewHash(review: VocReviewSource): string {
  const normalized = normalizeText(review.reviewText);
  const seed = `${review.productAsin}|${normalized}|${String(review.rating ?? "")}|${review.reviewDate ?? ""}`;
  return createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 24);
}

/* 注入检测：评论是 UNTRUSTED DATA，任何指令样文本都不改变行为。 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (previous|all|the above|prior|earlier) instructions/i,
  /you are now|act as|pretend to be|assistant.*role|system prompt/i,
  /leak|expose|reveal|print (the |your )?(key|secret|token|password|api)/i,
  /call tools|use tools|execute (command|code|script)|run (a )?(shell|command)/i,
  /https?:\/\//i,
  /```/i,
  /disregard|override (your|the) (instructions|rules)/i,
];

function detectInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/* 泛模板短语（机器人/重复评论） */
const TEMPLATE_PHRASES: RegExp[] = [
  /works as described/i,
  /good product/i,
  /great product/i,
  /highly recommend/i,
  /exactly as pictured/i,
  /fast shipping/i,
  /does what it says/i,
  /no issues/i,
  /great quality/i,
  /as expected/i,
  /nice product/i,
  /good quality/i,
  /i like it/i,
  /very good/i,
];

function isTemplatePhrase(text: string): boolean {
  const normalized = text.toLowerCase();
  return TEMPLATE_PHRASES.some((pattern) => pattern.test(normalized));
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

export function normalizeVocSource(
  source: VocSourcePayload,
): {
  output: VocAdapterOutput;
  errors: AdapterError[];
  status: ToolStatus;
  nextAction: ToolResultEnvelope["nextAction"];
} {
  const warnings: string[] = [];
  const biases: string[] = [];

  const seen = new Map<string, VocReviewSource>();
  const deduplicated: VocReviewSource[] = [];
  for (const review of source.reviews ?? []) {
    if (!review || !review.evidenceId) continue;
    const key = review.duplicateKey && review.duplicateKey.trim()
      ? review.duplicateKey
      : `hash:${reviewHash(review)}`;
    if (seen.has(key)) {
      warnings.push(`Review ${review.evidenceId} is a duplicate; kept first occurrence.`);
      continue;
    }
    seen.set(key, review);
    deduplicated.push(review);
  }

  const sampleSize = deduplicated.length;
  const samplingMethod = source.sampledEvidenceIds && source.sampledEvidenceIds.length > 0
    ? "sampled_subset"
    : "full_dataset";

  // 模板/机器人评论
  const textCounts = new Map<string, number>();
  for (const review of deduplicated) {
    const normalized = normalizeText(review.reviewText);
    textCounts.set(normalized, (textCounts.get(normalized) ?? 0) + 1);
  }
  const templateReviewCount = deduplicated.filter((review) => {
    const normalized = normalizeText(review.reviewText);
    return (textCounts.get(normalized) ?? 0) >= VOC_TEMPLATE_REPEAT_THRESHOLD || isTemplatePhrase(normalized);
  }).length;
  if (templateReviewCount > 0) {
    warnings.push(`${templateReviewCount} review(s) looked like template/robot text (repeated or generic phrases).`);
    biases.push(`template_reviews:${templateReviewCount}`);
  }

  // 变体混杂
  const asins = new Set(deduplicated.map((r) => r.productAsin));
  const roles = new Set(deduplicated.map((r) => r.sourceProductRole));
  if (asins.size > 1) {
    warnings.push(`Sample mixes ${asins.size} ASINs; theme counts may combine variants.`);
    biases.push(`variant_mixing:asins=${asins.size}`);
  }
  if (roles.size > 1) {
    warnings.push(`Sample mixes ${roles.size} source product roles (current_candidate + competitor); competitor pain is not own-product advantage.`);
    biases.push(`role_mixing:roles=${roles.size}`);
  }

  // 注入检测
  let injectionDetected = false;
  for (const review of deduplicated) {
    if (detectInjection(review.reviewText)) {
      injectionDetected = true;
      warnings.push(`Review ${review.evidenceId} contains instruction-like text; treated as data, ignored.`);
      break;
    }
  }

  // 最小样本
  const lowConfidence = sampleSize < VOC_MIN_SAMPLE;
  if (sampleSize === 0) {
    return {
      output: {
        sampleSize: 0,
        samplingMethod,
        minSampleThreshold: VOC_MIN_SAMPLE,
        lowConfidence: true,
        themes: [],
        scenarios: [],
        languagePatterns: [],
        biases,
        unknowns: source.unknowns ?? [],
        warnings,
        injectionDetected,
        copyrightMinimized: true,
      },
      errors: [],
      status: "no_results",
      nextAction: "revise_plan",
    };
  }
  if (lowConfidence) {
    warnings.push(`Sample size ${sampleSize} is below the ${VOC_MIN_SAMPLE}-review minimum; treat results as low confidence.`);
    biases.push("low_sample_size");
  }

  // 主题：evidenceRefs 必须命中实际样本；否则拒绝（unverified）。
  const reviewIdSet = new Set(deduplicated.map((r) => r.evidenceId));
  const themes: VocThemeOutput[] = [];
  for (const theme of source.themes ?? []) {
    const refs = [...new Set((theme.evidenceRefs ?? []).filter((ref) => reviewIdSet.has(ref)))];
    if (refs.length === 0) {
      warnings.push(`Theme "${theme.label}" had no valid evidenceRefs; rejected (unverified).`);
      continue;
    }
    const summary = theme.summary ? theme.summary.slice(0, VOC_MAX_SUMMARY_CHARS) : "";
    themes.push({
      label: theme.label.slice(0, 60),
      bucket: theme.bucket,
      count: refs.length,
      share: sampleSize > 0 ? refs.length / sampleSize : 0,
      evidenceRefs: refs,
      summary,
    });
  }

  // languagePatterns：按语言分组
  const languageCounts = new Map<string, number>();
  for (const review of deduplicated) {
    const lang = review.language || review.locale || "unknown";
    languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);
  }
  const languagePatterns = [...languageCounts.entries()]
    .map(([lang, count]) => `${count} review(s) in ${lang}`)
    .sort();

  const scenarios = [...new Set((source.nextResearchSteps ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 200)))];

  return {
    output: {
      sampleSize,
      samplingMethod,
      minSampleThreshold: VOC_MIN_SAMPLE,
      lowConfidence,
      themes,
      scenarios,
      languagePatterns,
      biases,
      unknowns: source.unknowns ?? [],
      warnings,
      injectionDetected,
      copyrightMinimized: true,
    },
    errors: [],
    status: "ok",
    nextAction: "continue",
  };
}

/* -------------------------------------------------------------------------- */
/* Live source converter（reviewEvidence/vocAnalysis-like → VocSourcePayload）  */
/* -------------------------------------------------------------------------- */

export function reviewVocToSource(input: {
  reviewEvidence?: unknown;
  vocAnalysis?: unknown;
}): { source: VocSourcePayload | null; warnings: string[] } {
  const warnings: string[] = [];
  const reviews: VocReviewSource[] = [];
  const themes: VocThemeSource[] = [];
  let candidateId: string | null = null;
  let unknowns: string[] = [];
  let nextResearchSteps: string[] = [];

  const reviewEvidence = input.reviewEvidence;
  if (isRecord(reviewEvidence)) {
    const candidate = reviewEvidence.candidateId;
    if (typeof candidate === "string") candidateId = candidate;
    const dataset = isRecord(reviewEvidence.dataset) ? reviewEvidence.dataset : null;
    if (dataset && Array.isArray(dataset.reviews)) {
      for (const raw of dataset.reviews) {
        if (!isRecord(raw)) continue;
        const evidenceId = asString(raw.evidenceId);
        if (!evidenceId) continue;
        reviews.push({
          evidenceId,
          productAsin: asString(raw.productAsin),
          sourceProductRole: asString(raw.sourceProductRole) === "competitor" ? "competitor" : "current_candidate",
          rating: typeof raw.rating === "number" ? raw.rating : null,
          reviewDate: typeof raw.reviewDate === "string" ? raw.reviewDate : null,
          reviewText: typeof raw.reviewText === "string" ? raw.reviewText : "",
          duplicateKey: typeof raw.duplicateKey === "string" ? raw.duplicateKey : null,
          language: typeof raw.language === "string" ? raw.language : null,
          locale: typeof raw.locale === "string" ? raw.locale : null,
        });
      }
    }
  }

  const voc = input.vocAnalysis;
  if (isRecord(voc)) {
    if (Array.isArray(voc.unknowns)) unknowns = voc.unknowns.filter((u): u is string => typeof u === "string");
    if (Array.isArray(voc.nextResearchSteps)) nextResearchSteps = voc.nextResearchSteps.filter((s): s is string => typeof s === "string");
    const themesRaw = isRecord(voc.themes) ? voc.themes : null;
    if (themesRaw) {
      const buckets: Array<[string, unknown]> = [
        ["positive", themesRaw.positiveThemes],
        ["pain", themesRaw.painPointThemes],
        ["scenario", themesRaw.usageScenarios],
        ["request", themesRaw.recurringRequests],
        ["weak", themesRaw.weakSignals],
      ];
      for (const [bucket, list] of buckets) {
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
          if (!isRecord(raw)) continue;
          const label = asString(raw.label);
          if (!label) continue;
          themes.push({
            label,
            bucket,
            evidenceRefs: Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs.filter((r): r is string => typeof r === "string") : [],
            summary: typeof raw.summary === "string" ? raw.summary : "",
            limitations: raw.limitations === null || raw.limitations === undefined ? null : asString(raw.limitations),
          });
        }
      }
    }
  }

  if (reviews.length === 0 && themes.length === 0) {
    return { source: null, warnings: ["no review/voc source data"] };
  }

  return {
    source: {
      candidateId,
      sampledEvidenceIds: null,
      reviews,
      themes,
      unknowns,
      nextResearchSteps,
    },
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

export async function runVocAdapter(
  call: ToolCallEnvelope,
  deps: VocAdapterDeps,
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

  let source: VocSourcePayload | null = null;
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

  const normalized = normalizeVocSource(source);
  const rawArtifactRefs: RawArtifactRef[] = [
    {
      kind: deps.mode === "recorded" ? "recorded" : "json",
      ref: `voc/${source.candidateId ?? "unknown"}`,
      capturedAt,
    },
  ];

  const result = buildResult({
    call,
    status: normalized.status,
    observedEntity: source.candidateId || call.targetEntity,
    data: normalized.output,
    rawArtifactRefs,
    capturedAt,
    usedCost: 0,
    warnings: [
      ...sourceWarnings.map((m) => ({ code: "SOURCE_WARNING", message: m })),
      ...normalized.output.warnings.map((m) => ({ code: "VOC_WARNING", message: m })),
    ],
    errors: normalized.errors,
    nextAction: normalized.nextAction,
  });

  if (deps.idempotency) {
    await deps.idempotency.set(idemKey, result);
  }
  return result;
}
