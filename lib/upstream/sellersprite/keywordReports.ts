/**
 * SellerSprite 关键词报表解析（Phase 3/4，真实样本验证版）。
 *
 * 支持两种真实报表（2026-08-15 样本）：
 * - reverse_asin（Reverse ASIN，32 列）：1 个竞品 ASIN 的流量词报表
 * - keyword_mining（Keyword Mining，21 列）：1 个 Seed 的扩展关键词报表
 *
 * 真实样本核实的字段语义（不得偏离）：
 * - 比例字段（流量占比/自然流量占比/购买率/点击总占比/转化总占比）原值为 0–1，
 *   存储原值，仅展示层 ×100（ratioToPercent）。
 * - 需供比（supplyDemandRatio）是比率（样本 1,778.8 / 1,296.2），**不得 ×100**。
 * - PPC价格/建议竞价范围为美元文本（$3.22 / $2.42-$4.03）。
 * - 前十ASIN 为逗号分隔列表。
 * - 0 与 null/unknown 区分：空字符串 → null（missing）；"0" → 0（available）。
 * - 广告流量占比 / 广告排名页码 在真实样本中全部为空（不稳定字段）：解析为
 *   missing/null，不强造值。
 * - 报表内无数据期（month/dataPeriod）字段 → dataPeriod=null（不猜）。
 * - 自然排名页码为文本（"第1页 5/59"），派生为 {page, position, total}（derived）。
 */
import type { KeywordReportType } from "./reportType";
import { detectKeywordReportType } from "./reportType";

export type { KeywordReportType } from "./reportType";

export const KEYWORD_REPORT_SCHEMA = "sellersprite-keyword-report.v1" as const;

export type KeywordReportMetricNature = "snapshot" | "estimate" | "derived" | "unknown";

export type KeywordReportFieldValue = {
  raw: string | null;
  normalized: number | string | boolean | string[] | { min: number; max: number } | { page: number; position: number; total: number } | null;
  metricNature: KeywordReportMetricNature;
  applicability: "available" | "missing" | "not_applicable" | "invalid";
};

export type KeywordReportRow = {
  rowNumber: number;
  keyword: string;
  keywordTranslation: string | null;
  fields: Record<string, KeywordReportFieldValue>;
};

export type KeywordReport = {
  schema: typeof KEYWORD_REPORT_SCHEMA;
  reportType: KeywordReportType;
  capturedAt: string;
  /** 报表内无数据期字段 → null（不猜）；capturedAt 为采集上下文 */
  dataPeriod: null;
  headerColumnCount: number;
  rows: KeywordReportRow[];
};

export type KeywordReportParseResult =
  | { ok: true; report: KeywordReport }
  | { ok: false; code: string; message: string };

/** 0–1 比例 → 展示百分比（仅展示层使用；存储保持原值） */
export function ratioToPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** 0–1 比例字段集合（真实样本验证为 0–1 原值） */
export const RATIO_FIELDS = new Set([
  "trafficShare",
  "naturalTrafficShare",
  "purchaseRate",
  "clickShare",
  "conversionShare",
]);

/** 文本状态字段（保持原文本） */
export const TEXT_STATE_FIELDS = new Set([
  "keywordType",
  "conversionEffect",
  "trafficWordType",
  "adRank",
  "updatedAtText",
  "adRankPage",
]);

/** 字段映射：真实表头 → 规范字段名（reverse_asin） */
const REVERSE_ASIN_HEADER_MAP: Record<string, string> = {
  流量词: "keyword",
  关键词翻译: "keywordTranslation",
  "AC推荐词": "acRecommended",
  流量占比: "trafficShare",
  预估周曝光量: "estimatedWeeklyImpressions",
  关键词类型: "keywordType",
  转化效果: "conversionEffect",
  流量词类型: "trafficWordType",
  自然流量占比: "naturalTrafficShare",
  广告流量占比: "adTrafficShare",
  自然排名: "naturalRank",
  自然排名页码: "naturalRankPage",
  更新时间: "updatedAtText",
  广告排名: "adRank",
  广告排名页码: "adRankPage",
  ABA周排名: "abaWeeklyRank",
  月搜索量: "monthlySearches",
  SPR: "spr",
  标题密度: "titleDensity",
  购买量: "purchases",
  购买率: "purchaseRate",
  展示量: "impressions",
  点击量: "clicks",
  商品数: "products",
  需供比: "supplyDemandRatio",
  广告竞品数: "adCompetitors",
  点击总占比: "clickShare",
  转化总占比: "conversionShare",
  PPC价格: "ppcBid",
  建议竞价范围: "bidRange",
  前十ASIN: "top10Asins",
};

/** 字段映射（keyword_mining；与 reverse_asin 共用的键保持一致） */
const KEYWORD_MINING_HEADER_MAP: Record<string, string> = {
  关键词: "keyword",
  关键词翻译: "keywordTranslation",
  "AC推荐词": "acRecommended",
  相关度: "relevance",
  ABA月排名: "abaMonthlyRank",
  ABA周排名: "abaWeeklyRank",
  月搜索量: "monthlySearches",
  SPR: "spr",
  标题密度: "titleDensity",
  购买量: "purchases",
  购买率: "purchaseRate",
  展示量: "impressions",
  点击量: "clicks",
  商品数: "products",
  需供比: "supplyDemandRatio",
  广告竞品数: "adCompetitors",
  点击总占比: "clickShare",
  转化总占比: "conversionShare",
  PPC价格: "ppcBid",
  建议竞价范围: "bidRange",
  前十ASIN: "top10Asins",
};

function headerMapFor(reportType: KeywordReportType): Record<string, string> {
  return reportType === "reverse_asin" ? REVERSE_ASIN_HEADER_MAP : KEYWORD_MINING_HEADER_MAP;
}

function parseNumber(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text.replaceAll(",", "").trim());
  return Number.isFinite(value) ? value : null;
}

function parseUsd(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  const match = /^\$?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function parseBidRange(raw: string | null): { min: number; max: number } | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  const match = /\$?\s*([\d,]+(?:\.\d+)?)\s*-\s*\$?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const min = Number(match[1].replaceAll(",", ""));
  const max = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
  return { min, max };
}

function parseTop10Asins(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter((item) => /^[A-Z0-9]{10}$/.test(item));
}

function parseRankPage(raw: string | null): { page: number; position: number; total: number } | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === "") return null;
  const match = /第\s*(\d+)\s*页\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  if (!match) return null;
  const page = Number(match[1]);
  const position = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isFinite(page) || !Number.isFinite(position) || !Number.isFinite(total)) return null;
  return { page, position, total };
}

function normalizeFieldValue(
  field: string,
  raw: string | null,
): KeywordReportFieldValue {
  const missing: KeywordReportFieldValue = {
    raw,
    normalized: null,
    metricNature: "unknown",
    applicability: raw === null || raw.trim() === "" ? "missing" : "invalid",
  };
  if (raw === null || raw.trim() === "") return missing;
  if (field === "keyword" || field === "keywordTranslation") {
    return { raw, normalized: raw.trim(), metricNature: "unknown", applicability: "available" };
  }
  if (field === "acRecommended") {
    const value = raw.trim() === "Y" ? true : raw.trim() === "N" ? false : null;
    return value === null
      ? { raw, normalized: null, metricNature: "unknown", applicability: "invalid" }
      : { raw, normalized: value, metricNature: "snapshot", applicability: "available" };
  }
  if (field === "top10Asins") {
    const asins = parseTop10Asins(raw);
    return {
      raw,
      normalized: asins,
      metricNature: "snapshot",
      applicability: asins.length > 0 ? "available" : "missing",
    };
  }
  if (field === "ppcBid") {
    const value = parseUsd(raw);
    return value === null
      ? { raw, normalized: null, metricNature: "unknown", applicability: "invalid" }
      : { raw, normalized: value, metricNature: "snapshot", applicability: "available" };
  }
  if (field === "bidRange") {
    const value = parseBidRange(raw);
    return value === null
      ? { raw, normalized: null, metricNature: "unknown", applicability: "invalid" }
      : { raw, normalized: value, metricNature: "snapshot", applicability: "available" };
  }
  if (field === "naturalRankPage") {
    const value = parseRankPage(raw);
    return value === null
      ? { raw, normalized: null, metricNature: "unknown", applicability: "invalid" }
      : { raw, normalized: value, metricNature: "derived", applicability: "available" };
  }
  if (TEXT_STATE_FIELDS.has(field)) {
    return { raw, normalized: raw.trim(), metricNature: "snapshot", applicability: "available" };
  }
  if (RATIO_FIELDS.has(field)) {
    const value = parseNumber(raw);
    if (value === null) return missing;
    if (value < 0 || value > 1) {
      return { raw, normalized: value, metricNature: "snapshot", applicability: "invalid" };
    }
    return { raw, normalized: value, metricNature: "snapshot", applicability: "available" };
  }
  const value = parseNumber(raw);
  if (value === null) return missing;
  return { raw, normalized: value, metricNature: "snapshot", applicability: "available" };
}

/**
 * 解析关键词报表（Preview/保存用）。表头签名不符 → 错报告拒绝。
 */
export function parseKeywordReport(input: {
  headers: ReadonlyArray<string | null>;
  rows: ReadonlyArray<ReadonlyArray<string | null>>;
  capturedAt: string;
}): KeywordReportParseResult {
  const reportType = detectKeywordReportType(input.headers);
  if (reportType === null) {
    return {
      ok: false,
      code: "unsupported_report_type",
      message: "报表表头不匹配 Reverse ASIN / Keyword Mining 签名（错报告拒绝）。",
    };
  }
  const headerMap = headerMapFor(reportType);
  const indexOf = new Map<string, number>();
  input.headers.forEach((header, index) => {
    const key = header?.trim() ?? "";
    // 真实 Reverse ASIN 样本存在重复表头「更新时间」（第 13 列有值、第 16 列全空）：
    // 保留首个出现的列（有值列），后续重复列忽略。
    if (key && !indexOf.has(key)) indexOf.set(key, index);
  });
  const keywordIndex = indexOf.get(reportType === "reverse_asin" ? "流量词" : "关键词");
  if (keywordIndex === undefined) {
    return { ok: false, code: "missing_keyword_column", message: "缺少关键词列。" };
  }
  const rows: KeywordReportRow[] = [];
  for (const row of input.rows) {
    const keywordRaw = row[keywordIndex] ?? null;
    const keyword = keywordRaw?.trim() ?? "";
    if (!keyword) continue;
    const fields: Record<string, KeywordReportFieldValue> = {};
    for (const [header, field] of Object.entries(headerMap)) {
      const index = indexOf.get(header);
      if (index === undefined) continue;
      fields[field] = normalizeFieldValue(field, row[index] ?? null);
    }
    rows.push({
      rowNumber: rows.length + 1,
      keyword,
      keywordTranslation: (fields.keywordTranslation?.normalized as string | undefined) ?? null,
      fields,
    });
  }
  if (rows.length === 0) {
    return { ok: false, code: "no_valid_rows", message: "没有可解析的关键词行。" };
  }
  return {
    ok: true,
    report: {
      schema: KEYWORD_REPORT_SCHEMA,
      reportType,
      capturedAt: input.capturedAt,
      dataPeriod: null,
      headerColumnCount: input.headers.length,
      rows,
    },
  };
}
