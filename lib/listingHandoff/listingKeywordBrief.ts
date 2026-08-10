/**
 * Listing Keyword Brief（Quality.1）
 *
 * 目的：把"关键词"从 confirmedFacts 机械拆词中独立出来。
 *
 * 合同：
 * - primaryKeyword：主搜索词（可进入 Title 高权重位置）
 * - supportingKeywords：辅助词（自然进入 Bullets/Description）
 * - backendSearchTerms：Amazon Backend Search Terms（空格分隔、去重、≤250 bytes）
 * - source：关键词来源（sellersprite / amazon_search_query / ad_search_term_report / manual / synthetic / unknown）
 * - keywordReady：是否有真实关键词资料
 *
 * 安全：
 * - 禁止 AI 虚构搜索量 / high-volume / high-converting / top keyword
 * - 无资料时 keywordReady=false，UI 明确"当前 Listing 尚未进行搜索词优化"
 * - 纯函数；无 DB/网络；同输入同输出
 */

export type ListingKeywordSource =
  | "sellersprite"
  | "amazon_search_query"
  | "ad_search_term_report"
  | "manual"
  | "synthetic"
  | "unknown";

export type ListingKeywordBrief = {
  schema: "listing-keyword-brief.v1";
  primaryKeyword: string;
  supportingKeywords: string[];
  backendSearchTerms: string[];
  source: ListingKeywordSource;
  capturedAt: string;
};

export type ListingKeywordBriefResult =
  | { ok: true; brief: ListingKeywordBrief }
  | { ok: false; code: string; message: string };

const MAX_PRIMARY_LENGTH = 60;
const MAX_SUPPORTING_ITEMS = 20;
const MAX_SUPPORTING_LENGTH = 60;
const MAX_BACKEND_ITEMS = 50;
const MAX_BACKEND_TERM_LENGTH = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanTerm(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/**
 * Amazon Backend Search Terms 250-byte 合同（UTF-8 字节）。
 * 空格分隔、去重、禁无效标点（仅字母数字空格与少量符号）。
 */
export function normalizeBackendSearchTerms(terms: unknown, maxBytes = 250): { terms: string[]; bytes: number } {
  if (!Array.isArray(terms)) return { terms: [], bytes: 0 };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = cleanTerm(raw, MAX_BACKEND_TERM_LENGTH).toLocaleLowerCase();
    if (!term) continue;
    // 仅允许字母数字空格（后端词合同），去掉无效标点
    const cleaned = term.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  // 逐步加入直到超 250 bytes
  const result: string[] = [];
  let bytes = 0;
  for (const term of out) {
    const delta = Buffer.byteLength(term, "utf8") + (result.length > 0 ? 1 : 0);
    if (bytes + delta > maxBytes) break;
    result.push(term);
    bytes += delta;
  }
  return { terms: result, bytes };
}

/** 解析/规范化存储的 Keyword Brief（从 resultJson 命名空间） */
export function parseListingKeywordBrief(value: unknown): ListingKeywordBrief | null {
  if (!isRecord(value) || value.schema !== "listing-keyword-brief.v1") return null;
  const primaryKeyword = cleanTerm(value.primaryKeyword, MAX_PRIMARY_LENGTH);
  if (!primaryKeyword) return null;
  const supportingKeywords = Array.isArray(value.supportingKeywords)
    ? value.supportingKeywords.map((v) => cleanTerm(v, MAX_SUPPORTING_LENGTH)).filter(Boolean).slice(0, MAX_SUPPORTING_ITEMS)
    : [];
  const backendRaw = Array.isArray(value.backendSearchTerms)
    ? value.backendSearchTerms.map((v) => cleanTerm(v, MAX_BACKEND_TERM_LENGTH)).filter(Boolean).slice(0, MAX_BACKEND_ITEMS)
    : [];
  const { terms: backendSearchTerms } = normalizeBackendSearchTerms(backendRaw);
  const source = typeof value.source === "string" ? value.source as ListingKeywordSource : "unknown";
  const capturedAt = typeof value.capturedAt === "string" && !Number.isNaN(Date.parse(value.capturedAt))
    ? value.capturedAt
    : "";
  if (!capturedAt) return null;
  return {
    schema: "listing-keyword-brief.v1",
    primaryKeyword,
    supportingKeywords,
    backendSearchTerms,
    source,
    capturedAt,
  };
}

/**
 * 构造 Keyword Brief（服务端或测试 fixture）。
 * primaryKeyword 必填；supporting/backend 可选。
 */
export function buildListingKeywordBrief(input: {
  primaryKeyword: string;
  supportingKeywords?: string[];
  backendSearchTerms?: string[];
  source?: ListingKeywordSource;
  capturedAt: string;
}): ListingKeywordBriefResult {
  const primaryKeyword = cleanTerm(input.primaryKeyword, MAX_PRIMARY_LENGTH);
  if (!primaryKeyword) return { ok: false, code: "primary_keyword_required", message: "缺少主搜索词。" };
  if (!input.capturedAt || Number.isNaN(Date.parse(input.capturedAt))) {
    return { ok: false, code: "captured_at_invalid", message: "关键词资料时间无效。" };
  }
  const supportingKeywords = (input.supportingKeywords ?? [])
    .map((v) => cleanTerm(v, MAX_SUPPORTING_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_SUPPORTING_ITEMS);
  const { terms: backendSearchTerms } = normalizeBackendSearchTerms(input.backendSearchTerms ?? []);
  const source = input.source ?? "unknown";
  return {
    ok: true,
    brief: {
      schema: "listing-keyword-brief.v1",
      primaryKeyword,
      supportingKeywords,
      backendSearchTerms,
      source,
      capturedAt: new Date(input.capturedAt).toISOString(),
    },
  };
}

/** 供测试/证据使用的安全摘要（不含原始词） */
export function safeKeywordBriefSummary(brief: ListingKeywordBrief | null) {
  if (!brief) return { keywordReady: false };
  return {
    keywordReady: true,
    primaryKeyword: brief.primaryKeyword,
    supportingCount: brief.supportingKeywords.length,
    backendTermsCount: brief.backendSearchTerms.length,
    backendBytes: Buffer.byteLength(brief.backendSearchTerms.join(" "), "utf8"),
    source: brief.source,
  };
}
