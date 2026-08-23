import "server-only";

/**
 * 轮 9：Browser Use 自动采集研究输入（竞品 / 关键词）——正式链路合同。
 *
 * 原则：
 * 1. 输入只来自当前任务服务端权威身份（candidateAnalysisContext 的批次/卖家精灵事实）；
 *    客户端不得传入/伪造 marketplace、seed ASIN、商品 URL。
 * 2. 仅本地 owner 可启动；Visitor/Sandbox 一律拒绝。
 * 3. 采集结果只以严格 Preview 返回（先预览、再人工确认；不自动写证据）。
 * 4. 页面不存在/未登录/验证码/权限不足/空或畸形结果 → 显式失败（fail-closed），不冒充无数据。
 */

export const BROWSER_USE_RESEARCH_SCHEMA = "browser-use-research-preview.v1" as const;
export const BROWSER_USE_RESEARCH_VERSION = 1 as const;
export const BROWSER_USE_COMPETITOR_LIMIT = 5 as const;
export const BROWSER_USE_KEYWORD_LIMIT = 100 as const;

export type BrowserUseResearchKind = "competitor" | "keyword";

export type BrowserUseCollectorInfo = { tool: "browser-use"; version: string };

export type BrowserUseCompetitorPreviewItem = {
  asin: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  bsr: number | null;
  sourceUrl: string;
  capturedAt: string;
  /** 轮 15：竞品详情页五点（reference-only；来自同一 ASIN 的官方详情页采集） */
  bullets?: string[];
};

export type BrowserUseKeywordPreviewItem = {
  keyword: string;
  keywordTranslation: string | null;
  searchVolume: number | null;
  abaWeeklyRank: number | null;
  purchaseVolume: number | null;
  relevance: number | null;
  competition: number | null;
  capturedAt: string;
};

export type BrowserUseResearchPreview =
  | {
      schema: typeof BROWSER_USE_RESEARCH_SCHEMA;
      version: typeof BROWSER_USE_RESEARCH_VERSION;
      kind: "competitor";
      seedAsin: string;
      marketplace: string;
      seedProductUrl: string | null;
      sourceUrl: string;
      capturedAt: string;
      results: BrowserUseCompetitorPreviewItem[];
      missing: string[];
      failureReason: "collector_unavailable" | "login_required" | "captcha_required" | "permission_insufficient" | "panel_not_detected" | "collect_failed" | "identity_unavailable" | null;
      collector: BrowserUseCollectorInfo;
    }
  | {
      schema: typeof BROWSER_USE_RESEARCH_SCHEMA;
      version: typeof BROWSER_USE_RESEARCH_VERSION;
      kind: "keyword";
      seedAsin: string;
      marketplace: string;
      seedProductUrl: string | null;
      sourceUrl: string;
      capturedAt: string;
      results: BrowserUseKeywordPreviewItem[];
      missing: string[];
      failureReason: "collector_unavailable" | "login_required" | "captcha_required" | "permission_insufficient" | "panel_not_detected" | "collect_failed" | "identity_unavailable" | null;
      collector: BrowserUseCollectorInfo;
    };

export type BrowserUseResearchPreviewV1 = BrowserUseResearchPreview;

export type BrowserUseResearchFailureCode = BrowserUseResearchPreview["failureReason"];

export class BrowserUseResearchError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserUseResearchError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAILURE_REASONS = new Set([
  "collector_unavailable", "login_required", "captcha_required", "permission_insufficient",
  "panel_not_detected", "collect_failed", "identity_unavailable",
]);

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** 服务端权威种子：只从任务 resultJson 的身份事实解析（fail-closed）。 */
export type BrowserUseSeed = {
  marketplace: string;
  asin: string;
  productUrl: string | null;
  productName: string | null;
};

export function resolveBrowserUseSeed(result: unknown): BrowserUseSeed | null {
  if (!isRecord(result)) return null;
  const cac = isRecord(result.candidateAnalysisContext) ? result.candidateAnalysisContext : null;
  if (!cac) return null;
  if (cac.integrity !== "verified_product_batch" && cac.integrity !== "verified_seller_sprite") return null;
  const facts = isRecord(cac.facts) ? cac.facts : null;
  if (!facts) return null;
  const asin = typeof facts.asin === "string" && ASIN_PATTERN.test(facts.asin) ? facts.asin : null;
  if (!asin) return null;
  const marketplace = typeof facts.marketplace === "string" && facts.marketplace.trim() ? facts.marketplace.trim() : null;
  if (!marketplace) return null;
  const productUrl = typeof facts.productUrl === "string" && facts.productUrl.trim() ? facts.productUrl.trim() : null;
  const productName = typeof facts.productName === "string" && facts.productName.trim() ? facts.productName.trim() : null;
  return { marketplace, asin, productUrl, productName };
}

/** 仅 local owner 可启动：Visitor/Sandbox 一律拒绝（fail-closed）。 */
export function assertBrowserUseOwnerOnly(context: { mode?: string }): void {
  if (!context || context.mode !== "owner") {
    throw new BrowserUseResearchError(
      "browser_use_local_owner_only", 403,
      "Browser Use 自动采集仅限本机 Owner 使用。",
    );
  }
}

function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asString(value: unknown, maxLength = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCompetitorItem(value: unknown): BrowserUseCompetitorPreviewItem | null {
  if (!isRecord(value)) return null;
  const asin = asString(value.asin, 10);
  if (!asin || !ASIN_PATTERN.test(asin.toUpperCase())) return null;
  const title = asString(value.title, 500);
  if (!title) return null;
  const sourceUrl = asString(value.sourceUrl, 1000);
  if (!sourceUrl) return null;
  const imageUrl = typeof value.imageUrl === "string" && value.imageUrl.trim() ? value.imageUrl.trim().slice(0, 1000) : null;
  const capturedAt = asIsoDate(value.capturedAt);
  if (!capturedAt) return null;
  return {
    asin: asin.toUpperCase(),
    title,
    imageUrl,
    price: asNumber(value.price),
    rating: asNumber(value.rating),
    reviews: asNumber(value.reviews),
    bsr: asNumber(value.bsr),
    sourceUrl,
    capturedAt,
  };
}

function parseKeywordItem(value: unknown): BrowserUseKeywordPreviewItem | null {
  if (!isRecord(value)) return null;
  const keyword = asString(value.keyword, 300);
  if (!keyword) return null;
  const capturedAt = asIsoDate(value.capturedAt);
  if (!capturedAt) return null;
  return {
    keyword,
    keywordTranslation: typeof value.keywordTranslation === "string" && value.keywordTranslation.trim() ? value.keywordTranslation.trim().slice(0, 300) : null,
    searchVolume: asNumber(value.searchVolume),
    abaWeeklyRank: asNumber(value.abaWeeklyRank),
    purchaseVolume: asNumber(value.purchaseVolume),
    relevance: asNumber(value.relevance),
    competition: asNumber(value.competition),
    capturedAt,
  };
}

/** 严格解析 Preview（结构非法/超出上限/伪造失败原因 → null）。 */
export function parseBrowserUseResearchPreview(value: unknown): BrowserUseResearchPreview | null {
  if (!isRecord(value)) return null;
  if (value.schema !== BROWSER_USE_RESEARCH_SCHEMA || value.version !== BROWSER_USE_RESEARCH_VERSION) return null;
  const kind = value.kind;
  if (kind !== "competitor" && kind !== "keyword") return null;
  const seedAsin = asString(value.seedAsin, 10);
  if (!seedAsin || !ASIN_PATTERN.test(seedAsin.toUpperCase())) return null;
  const marketplace = asString(value.marketplace, 120);
  if (!marketplace) return null;
  const sourceUrl = asString(value.sourceUrl, 1000);
  if (!sourceUrl) return null;
  const capturedAt = asIsoDate(value.capturedAt);
  if (!capturedAt) return null;
  const failureReason = value.failureReason;
  if (failureReason !== null && (typeof failureReason !== "string" || !FAILURE_REASONS.has(failureReason))) return null;
  if (!Array.isArray(value.results)) return null;
  const collector = isRecord(value.collector) && value.collector.tool === "browser-use" ? { tool: "browser-use" as const, version: asString(value.collector.version, 60) ?? "unknown" } : null;
  if (!collector) return null;
  if (kind === "competitor") {
    if (value.results.length > BROWSER_USE_COMPETITOR_LIMIT) return null;
    const results: BrowserUseCompetitorPreviewItem[] = [];
    for (const item of value.results) {
      const parsed = parseCompetitorItem(item);
      if (!parsed) return null;
      results.push(parsed);
    }
    const missing = Array.isArray(value.missing) ? value.missing.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 20) : [];
    return { schema: BROWSER_USE_RESEARCH_SCHEMA, version: BROWSER_USE_RESEARCH_VERSION, kind, seedAsin: seedAsin.toUpperCase(), marketplace, seedProductUrl: asString(value.seedProductUrl, 1000), sourceUrl, capturedAt, results, missing, failureReason: failureReason as BrowserUseResearchPreview["failureReason"], collector };
  }
  if (value.results.length > BROWSER_USE_KEYWORD_LIMIT) return null;
  const results: BrowserUseKeywordPreviewItem[] = [];
  for (const item of value.results) {
    const parsed = parseKeywordItem(item);
    if (!parsed) return null;
    results.push(parsed);
  }
  return { schema: BROWSER_USE_RESEARCH_SCHEMA, version: BROWSER_USE_RESEARCH_VERSION, kind, seedAsin: seedAsin.toUpperCase(), marketplace, seedProductUrl: asString(value.seedProductUrl, 1000), sourceUrl, capturedAt, results, missing: Array.isArray(value.missing) ? (value.missing as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 20) : [], failureReason: failureReason as BrowserUseResearchPreview["failureReason"], collector };
}

/* ── 服务端 Preview 短暂缓存（一次性取用；不信任客户端回传字段） ── */

const PREVIEW_CACHE: Map<string, BrowserUseResearchPreview> = new Map();
const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;

export function storeBrowserUsePreview(preview: BrowserUseResearchPreview): string {
  const id = `bup_preview_${Math.random().toString(36).slice(2, 12)}`;
  PREVIEW_CACHE.set(id, preview);
  setTimeout(() => { PREVIEW_CACHE.delete(id); }, PREVIEW_CACHE_TTL_MS).unref?.();
  return id;
}

export function takeBrowserUsePreview(previewId: string): BrowserUseResearchPreview | null {
  if (typeof previewId !== "string" || !/^bup_preview_[a-z0-9]{10}$/.test(previewId)) return null;
  const preview = PREVIEW_CACHE.get(previewId);
  if (!preview) return null;
  PREVIEW_CACHE.delete(previewId);
  return preview;
}

/** 采集来源 URL 同域校验：只允许 Amazon 官方域名（伪造外站 URL → false）。 */
/**
 * 轮 10：可靠搜索关键词选择——取第一个非空、非纯品牌词（keyword 与翻译相同视为品牌词，如 owala）。
 * 不按最高搜索量盲选（避免品牌词带偏）；无可信词 → null（fail-closed，不从标题瞎猜）。
 */
export function selectReliableSearchKeyword(
  items: readonly BrowserUseKeywordPreviewItem[],
): string | null {
  for (const item of items) {
    const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
    if (!keyword) continue;
    const translation = typeof item.keywordTranslation === "string" ? item.keywordTranslation.trim() : "";
    if (translation && translation.toLowerCase() === keyword.toLowerCase()) continue;
    return keyword;
  }
  return null;
}
/** 系统支持的 Amazon 零售站点（与 marketplaceToAmazonTld 一致；不扩展新 marketplace）。 */
const AMAZON_RETAIL_HOSTS = new Set([
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.co.jp",
  "amazon.ca",
]);

export function isAllowedCollectorSourceUrl(url: string): boolean {
  if (typeof url !== "string" || !url.trim() || /\s/.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return AMAZON_RETAIL_HOSTS.has(bare);
}
/** marketplace 来源标识 → Amazon 站点 tld（US/Amazon US → com；其余按 us 处理 fail-closed 交给调用方）。 */
export function marketplaceToAmazonTld(marketplace: string): string {
  const normalized = marketplace.trim().toLowerCase();
  if (normalized === "us" || normalized === "amazon us") return "com";
  if (normalized === "uk" || normalized === "amazon uk") return "co.uk";
  if (normalized === "de" || normalized === "amazon de") return "de";
  if (normalized === "jp" || normalized === "amazon jp") return "co.jp";
  if (normalized === "ca" || normalized === "amazon ca") return "ca";
  return "com";
}
