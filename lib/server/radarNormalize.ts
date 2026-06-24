/**
 * Phase 1E — Radar Normalizer
 * 从 HTML/RSS/sitemap/简单 JSON 提取候选机会。
 * 不依赖 cheerio/jsdom，使用正则和字符串匹配。
 */

import type { CrawlResult } from "./radarCrawler";

export type CandidateItem = {
  title: string;
  sourceUrl: string;
  sourceType: "html" | "rss" | "sitemap" | "json" | "trend_api";
  sourceHost: string;
  categoryHint: string;
  signalText: string;
  riskHint: string;
  extractedAt: string;
  rawSnippet: string;
  /** Phase 4-D.7: Candidate quality classification */
  candidateType?: "product_candidate" | "category_hint" | "trend_signal" | "rejected";
  /** Phase 4-D.7: Reason for rejection or classification */
  rejectionReason?: string;
};

const MAX_CANDIDATES_PER_URL = 20;
const MAX_TOTAL_CANDIDATES = 50;

/**
 * Phase 4-D.7: Low-quality candidate patterns.
 * Filters out obvious category names, navigation text, and non-product content.
 */
const LOW_QUALITY_PATTERNS: RegExp[] = [
  /^best sellers?\s/i,                          // Amazon category headers
  /^best sellers?\s+in\s/i,                     // "Best Sellers in Kitchen & Dining"
  /^amazon\s*(\.com)?\s*best\s*sellers?/i,      // Amazon BS page title variants
  /^top\s+sellers?\s+in\s/i,                    // Generic category headers
  /^shop\s+by\s/i,                              // Navigation
  /^browse\s/i,                                 // Navigation
  /^category:/i,                                // Labeled categories
  /(cookies|privacy|terms|accessibility|settings?)\s*(policy|notice|preferences?)?$/i, // Legal pages
  /^(sign\s*in|log\s*in|register|create\s*account|my\s*account|wish\s*list|cart|checkout)$/i, // Account pages
  /^(home|about|contact(\s*us)?|faq|help|support|blog)$/i, // Generic pages
  /^\s*(just\s*a\s*moment\.*|one\s*moment\.*|please\s*wait\.*|verifying.*|checking\s*your\s*browser\.*)\s*$/i, // Anti-bot pages
  /^.{1,2}$/,                                   // Too short (1-2 chars)
  /^\d+$/,                                      // Only digits
];

/**
 * Phase 4-D.7: Check if a candidate title looks like a product/opportunity signal
 * rather than a category name or navigation label.
 */
function isLowQualityCandidate(title: string): { rejected: boolean; reason?: string; candidateType: CandidateItem["candidateType"] } {
  const trimmed = title.trim();

  for (const pattern of LOW_QUALITY_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (/best sellers?/i.test(trimmed) || /top sellers?/i.test(trimmed) || /shop by/i.test(trimmed) || /\bbrowse\b/i.test(trimmed)) {
        return { rejected: false, candidateType: "category_hint", reason: "类目/导航文本，非具体商品候选" };
      }
      return { rejected: true, candidateType: "rejected", reason: `匹配低质模式: ${pattern.source.slice(0, 40)}` };
    }
  }

  // Product-like signals
  const productSignals = /product|gadget|device|tool|gear|item|accessory|buy|price|\$|sale|review|best|top|recommend|deal|discount|new|trending|viral|dropship|supplier|manufacturer|wholesale/i;
  const isCategoryLike = /(?:department|category|section|aisle|collection|range|series|type|style|color|size|brand|shop\s+all|all\s+products?)/i;

  if (isCategoryLike.test(trimmed) && !productSignals.test(trimmed)) {
    return { rejected: false, candidateType: "category_hint", reason: "疑似类目描述，缺少商品信号" };
  }

  return { rejected: false, candidateType: "product_candidate" };
}

function extractHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 3) + "...";
}

/**
 * Extract candidates from HTML content
 */
function extractFromHtml(result: CrawlResult): CandidateItem[] {
  const { body, url } = result;
  if (!body) return [];

  const host = extractHost(url);
  const now = new Date().toISOString();
  const candidates: CandidateItem[] = [];

  // Extract meta description
  const metaDesc = body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const description = metaDesc?.[1] || "";

  // Extract title
  const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
  const pageTitle = titleMatch?.[1]?.trim() || "";

  // Extract h1/h2
  const headings: string[] = [];
  const headingRegex = /<h[12][^>]*>([^<]+)<\/h[12]>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(body)) !== null) {
    const h = stripHtml(hMatch[1]).trim();
    if (h && h.length > 3) headings.push(h);
  }

  // Extract visible text snippets (paragraphs, list items)
  const textBlocks: string[] = [];
  const blockRegex = /<(?:p|li|div|span|article|section)[^>]*>([\s\S]*?)<\/(?:p|li|div|span|article|section)>/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = blockRegex.exec(body)) !== null) {
    const text = stripHtml(bMatch[1]).trim();
    if (text.length > 10 && text.length < 500) textBlocks.push(text);
    if (textBlocks.length >= 30) break;
  }

  // Build primary candidate from page title
  if (pageTitle && pageTitle.length > 2) {
    const signalText = [description, ...headings.slice(0, 2)].filter(Boolean).join("; ");
    candidates.push({
      title: truncate(pageTitle, 120),
      sourceUrl: url,
      sourceType: "html",
      sourceHost: host,
      categoryHint: guessCategory(pageTitle + " " + description + " " + headings.join(" ")),
      signalText: truncate(signalText || pageTitle, 300),
      riskHint: guessRisk(pageTitle + " " + description + " " + textBlocks.join(" ")),
      extractedAt: now,
      rawSnippet: truncate(body.slice(0, 1000), 500),
    });
  }

  // Build candidates from headings
  for (const heading of headings) {
    if (candidates.length >= MAX_CANDIDATES_PER_URL) break;
    if (heading === pageTitle) continue;
    candidates.push({
      title: truncate(heading, 120),
      sourceUrl: url,
      sourceType: "html",
      sourceHost: host,
      categoryHint: guessCategory(heading),
      signalText: truncate(heading, 200),
      riskHint: guessRisk(heading),
      extractedAt: now,
      rawSnippet: truncate(heading, 200),
    });
  }

  return candidates;
}

/**
 * Extract candidates from RSS feed
 */
function extractFromRss(result: CrawlResult): CandidateItem[] {
  const { body, url } = result;
  if (!body) return [];

  const host = extractHost(url);
  const now = new Date().toISOString();
  const candidates: CandidateItem[] = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(body!)) !== null) {
    if (candidates.length >= MAX_CANDIDATES_PER_URL) break;
    const itemXml = match[1];
    const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/i);
    const linkMatch = itemXml.match(/<link>([^<]+)<\/link>/i);
    const descMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/i);

    const title = titleMatch?.[1]?.trim() || "";
    if (!title || title.length < 3) continue;

    candidates.push({
      title: truncate(title, 120),
      sourceUrl: linkMatch?.[1]?.trim() || url,
      sourceType: "rss",
      sourceHost: host,
      categoryHint: guessCategory(title + " " + (descMatch?.[1] || "")),
      signalText: truncate(stripHtml(descMatch?.[1] || title), 300),
      riskHint: guessRisk(title + " " + (descMatch?.[1] || "")),
      extractedAt: now,
      rawSnippet: truncate(stripHtml(itemXml), 500),
    });
  }

  return candidates;
}

/**
 * Extract candidates from sitemap XML
 */
function extractFromSitemap(result: CrawlResult): CandidateItem[] {
  const { body, url } = result;
  if (!body) return [];

  const host = extractHost(url);
  const now = new Date().toISOString();
  const candidates: CandidateItem[] = [];

  const locRegex = /<loc>([^<]+)<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(body!)) !== null) {
    if (candidates.length >= MAX_CANDIDATES_PER_URL) break;
    const loc = match[1].trim();
    if (!loc) continue;

    // Extract keywords from URL path
    const pathParts = loc
      .replace(/https?:\/\/[^/]+/, "")
      .replace(/\.(html?|php|aspx?)$/i, "")
      .split(/[/_-]/)
      .filter(Boolean)
      .map((p) => decodeURIComponent(p).replace(/\+/g, " "))
      .filter((p) => p.length > 2 && !/^\d+$/.test(p));

    const title = pathParts.join(" ") || loc;

    candidates.push({
      title: truncate(title, 120),
      sourceUrl: loc,
      sourceType: "sitemap",
      sourceHost: host,
      categoryHint: guessCategory(title),
      signalText: `Sitemap URL: ${loc}`,
      riskHint: guessRisk(title),
      extractedAt: now,
      rawSnippet: truncate(loc, 200),
    });
  }

  return candidates;
}

// ---- Category & Risk Hint Rules ----

function guessCategory(text: string): string {
  const lower = text.toLowerCase();
  const categories: string[] = [];
  if (/kitchen|cook|food|bake|recipe|dining|kitchenware/i.test(lower)) categories.push("厨房用品");
  if (/pet|dog|cat|bird|fish|hamster|rabbit/i.test(lower)) categories.push("宠物用品");
  if (/camp|hiking|outdoor|travel|tent|backpack|survival/i.test(lower)) categories.push("户外/旅行");
  if (/desk|office|organiz|storage|shelf|rack|holder|stand/i.test(lower)) categories.push("收纳/桌面");
  if (/baby|kids|child|toddler|infant|toy|magnetic/i.test(lower)) categories.push("母婴/儿童/玩具");
  if (/phone|usb|charge|cable|bluetooth|speaker|headphone|earphone/i.test(lower)) categories.push("3C数码配件");
  if (/beauty|makeup|cosmetic|skincare|nail|hair/i.test(lower)) categories.push("美妆个护");
  if (/fitness|gym|exercise|yoga|sport|workout/i.test(lower)) categories.push("运动健身");
  if (/fashion|clothing|shirt|dress|shoe|bag|jewelry/i.test(lower)) categories.push("服饰鞋包");
  if (/home|decor|garden|light|furniture|bed|pillow/i.test(lower)) categories.push("家居装饰");
  return categories.join("、") || "日用百货";
}

function guessRisk(text: string): string {
  const lower = text.toLowerCase();
  const risks: string[] = [];
  if (/baby|kids|child|toddler|infant/i.test(lower)) risks.push("儿童用品合规");
  if (/pet|dog|cat/i.test(lower)) risks.push("食品接触/宠物安全");
  if (/food|edible|drink|water|bpa/i.test(lower)) risks.push("食品接触材料");
  if (/battery|charge|electric|usb.*power|recharge/i.test(lower)) risks.push("带电/电池运输");
  if (/magnet/i.test(lower)) risks.push("磁铁安全");
  if (/medical|health.*claim|supplement|cure|treatment/i.test(lower)) risks.push("医疗宣称");
  if (/disney|nike|pok[eé]mon|apple|marvel|star wars|harry potter|anime/i.test(lower)) risks.push("IP侵权风险");
  if (/cosmetic|skincare|cream|serum|mask/i.test(lower)) risks.push("化妆品合规");
  if (/silicone|plastic|rubber/i.test(lower)) risks.push("材质检测");
  return risks.join("、") || "低风险品类";
}

// ---- Main Export ----

export type NormalizeResult = {
  items: CandidateItem[];
  warnings: string[];
};

/**
 * Normalize crawl results into candidate opportunities.
 * Handles auto-detection of content type (HTML/RSS/sitemap/JSON).
 */
export function normalizeResults(crawlResults: CrawlResult[]): NormalizeResult {
  const items: CandidateItem[] = [];
  const warnings: string[] = [];

  for (const result of crawlResults) {
    if (result.status !== "ok" || !result.body) continue;

    const body = result.body;
    const trimmed = body.trim();

    // Auto-detect content type
    if (/<rss\b/i.test(trimmed) || /<feed\b/i.test(trimmed) || /<channel>/i.test(trimmed)) {
      items.push(...extractFromRss(result));
    } else if (/<urlset\b/i.test(trimmed) || /<sitemapindex\b/i.test(trimmed)) {
      items.push(...extractFromSitemap(result));
    } else if (/<html\b/i.test(trimmed) || /<!DOCTYPE\s+html/i.test(trimmed) || /<head\b/i.test(trimmed)) {
      items.push(...extractFromHtml(result));
    } else {
      // Try as plain text — create one candidate
      const host = extractHost(result.url);
      const now = new Date().toISOString();
      const text = stripHtml(trimmed).slice(0, 500);
      if (text.length > 5) {
        items.push({
          title: truncate(text.split(/\n|。/)[0]?.trim() || text, 120),
          sourceUrl: result.url,
          sourceType: "html",
          sourceHost: host,
          categoryHint: guessCategory(text),
          signalText: truncate(text, 300),
          riskHint: guessRisk(text),
          extractedAt: now,
          rawSnippet: truncate(text, 500),
        });
      }
    }
  }

  if (items.length > MAX_TOTAL_CANDIDATES) {
    warnings.push(`候选总数超过 ${MAX_TOTAL_CANDIDATES} 条，已截断`);
  }

  // Dedup by title
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    const key = item.title.toLowerCase().replace(/\s+/g, "").slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Phase 4-D.7: Classify and filter low-quality candidates
  const classified = deduped.map((item) => {
    const quality = isLowQualityCandidate(item.title);
    return { ...item, candidateType: quality.candidateType, rejectionReason: quality.reason };
  });

  // Separate rejected, product candidates, and category hints
  const rejected = classified.filter((c) => c.candidateType === "rejected");
  const kept = classified.filter((c) => c.candidateType !== "rejected");

  if (rejected.length > 0) {
    warnings.push(`过滤 ${rejected.length} 条低质候选（类目/导航/非商品文本）`);
  }

  return { items: kept.slice(0, MAX_TOTAL_CANDIDATES), warnings };
}
