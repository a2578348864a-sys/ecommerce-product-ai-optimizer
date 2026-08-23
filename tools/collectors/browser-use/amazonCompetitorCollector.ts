/**
 * 轮 10：Amazon 搜索结果竞品发现采集器。
 *
 * 输入只来自服务端解析的权威种子（seed ASIN + marketplace tld + SellerSprite 关键词）；
 * 打开 Amazon 搜索页只读解析结果卡片；结果必须是真实卡片（10 位 ASIN + 标题 + Amazon 详情 URL +
 * 采集时间）；排除 seed ASIN、广告卡、重复、非法 ASIN、外站 URL；图片只接受 Amazon 官方图床；
 * 无结果/结构变化/登录墙/验证码/畸形 → 显式失败原因，绝不冒充“没有竞品”。
 */
import { BROWSER_USE_RESEARCH_SCHEMA, type BrowserUseResearchPreview, type BrowserUseCollectorInfo } from "@/lib/server/browserUseResearch";
import { defaultBrowserUseSpawn, type SpawnLike, type SpawnResult } from "./sellerSpriteCollector";

export const AMAZON_SEARCH_OBSERVATION_SCHEMA = "amazon-search-observation.v1" as const;
export const AMAZON_COMPETITOR_LIMIT = 5 as const;

export type AmazonCompetitorCollectionInput = {
  seedAsin: string;
  marketplaceTld: string;
  keyword: string;
};

export type AmazonCompetitorCandidate = {
  asin: string;
  title: string;
  sourceUrl: string;
  imageUrl: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  capturedAt: string;
  sponsored: boolean;
};

export type AmazonCompetitorObservation = {
  schema: typeof AMAZON_SEARCH_OBSERVATION_SCHEMA;
  url: string;
  title: string;
  bodyText: string;
  parsedCards: number;
  cards: AmazonCompetitorCandidate[];
  structureChanged: boolean;
  failureReason: "login_required" | "captcha_required" | "no_results" | "structure_changed" | null;
  observedAt: string;
};

export type AmazonCompetitorCollectionRun =
  | { ok: true; observation: AmazonCompetitorObservation }
  | { ok: false; failureReason: "collector_unavailable" | "collect_failed"; detail: string };

/** 允许的 Amazon 主域名（精确匹配）；拒绝 amazon.evil.example、用户信息段、http 等。 */
export function isAllowedAmazonSourceUrl(raw: string): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return /^(www\.)?amazon\.(com|co\.uk|de|ca|co\.jp)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/** 搜索 URL：https + 编码关键词。 */
export function amazonSearchUrl(input: AmazonCompetitorCollectionInput): string {
  const tld = input.marketplaceTld && /^[a-z0-9.-]+$/i.test(input.marketplaceTld) ? input.marketplaceTld : "com";
  return `https://www.amazon.${tld}/s?k=${encodeURIComponent(input.keyword)}`;
}

/** 搜索卡片图片只接受 Amazon 官方图床。 */
function isAllowedAmazonImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return /^(m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

function asStr(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 规范化（排除 seed/广告/重复/非法 ASIN/外站 URL；外站图片→null；≤5）。 */
export function normalizeAmazonCompetitorCandidates(
  cards: unknown[],
  seedAsin: string,
): { competitors: AmazonCompetitorCandidate[]; excluded: { asin: string; reason: string }[] } {
  const seed = seedAsin.trim().toUpperCase();
  const seen = new Set<string>();
  const competitors: AmazonCompetitorCandidate[] = [];
  const excluded: { asin: string; reason: string }[] = [];
  for (const item of cards) {
    if (competitors.length >= AMAZON_COMPETITOR_LIMIT) break;
    const c = item as Record<string, unknown>;
    const asin = asStr(c.asin).toUpperCase();
    if (!ASIN_PATTERN.test(asin)) { excluded.push({ asin: asin || "-", reason: "invalid_asin" }); continue; }
    if (asin === seed) { excluded.push({ asin, reason: "seed_asin" }); continue; }
    if (seen.has(asin)) { excluded.push({ asin, reason: "duplicate" }); continue; }
    if (c.sponsored === true) { excluded.push({ asin, reason: "sponsored" }); continue; }
    const sourceUrl = asStr(c.sourceUrl);
    if (sourceUrl === "" || !isAllowedAmazonSourceUrl(sourceUrl) || !sourceUrl.startsWith("https://www.amazon.")) {
      excluded.push({ asin, reason: "external_source_url" }); continue;
    }
    const title = asStr(c.title);
    if (!title) { excluded.push({ asin, reason: "missing_title" }); continue; }
    const imageRaw = asStr(c.imageUrl);
    seen.add(asin);
    competitors.push({
      asin,
      title,
      sourceUrl,
      imageUrl: imageRaw && isAllowedAmazonImageUrl(imageRaw) ? imageRaw : null,
      price: typeof c.price === "number" && Number.isFinite(c.price) ? c.price : null,
      rating: typeof c.rating === "number" && Number.isFinite(c.rating) ? c.rating : null,
      reviews: typeof c.reviews === "number" && Number.isFinite(c.reviews) ? c.reviews : null,
      capturedAt: asStr(c.capturedAt) || new Date().toISOString(),
      sponsored: false,
    });
  }
  return { competitors, excluded };
}

const JS_BODY = "(() => { const body = document.body.innerText || ''; const cards = []; const els = document.querySelectorAll('div[data-asin][data-component-type=s-search-result]'); for (let i = 0; i < els.length; i++) { const el = els[i]; const asin = (el.getAttribute('data-asin') || '').trim(); if (!asin) { continue; } const img = el.querySelector('img'); const titleEl = el.querySelector('h2') || el.querySelector('h2 span'); const priceEl = el.querySelector('.a-price .a-offscreen'); const link = el.querySelector('a.a-link-normal'); const fmt = function (v) { if (!v) return null; const clean = String(v).replace(/[^0-9.]/g, ''); const n = parseFloat(clean); return Number.isFinite(n) ? n : null; }; const rateText = (el.innerText || '').slice(0, 600); const rev = function (v) { if (!v) return null; const st = String(v); const p = st.indexOf('('); const tail = p >= 0 ? st.slice(p + 1) : ''; const m2 = tail.match(/([0-9,.]+)([kKmM]?)/); if (!m2) return null; let n = parseFloat((m2[1] || '').replace(/,/g, '')); if (!Number.isFinite(n)) return null; if (/[mM]/.test(m2[2] || '')) n = n * 1000000; else if (/[kK]/.test(m2[2] || '')) n = n * 1000; return n; }; const rate = function (v) { if (!v) return null; const st = String(v); const m = st.match(/([0-9.]+) out of 5 stars/); if (m) return parseFloat(m[1]); const ms = st.match(/([0-9.]+)[^0-9]{0,12}\\u661f/); if (ms) return parseFloat(ms[1]); return null; }; cards.push({ asin: asin, title: (titleEl ? titleEl.textContent.trim() : ''), sourceUrl: (link ? (link.href || '') : ''), imageUrl: (img ? (img.src || '') : ''), price: fmt(priceEl ? priceEl.textContent : null), rating: rate(rateText), reviews: rev(rateText), sponsored: /Sponsored/i.test((el.textContent || '').slice(0, 300)), capturedAt: new Date().toISOString() }); } return JSON.stringify({ bodyText: body.slice(0, 1500), cards: cards.slice(0, 30), parsedCards: cards.length }); })()";

/** 确定性脚本：导航 + 无管道文件输出（复用 sellerSpriteCollector 的 spawn 与文件约定）。 */
export function buildAmazonCompetitorScript(input: AmazonCompetitorCollectionInput): string {
  const url = amazonSearchUrl(input);
  return [
    "import os, json, re",
    "num = 0",
    `new_tab("${url}")`,
    "wait_for_load()",
    "wait(6.0)",
    `d = json.loads(js(${JSON.stringify(JS_BODY)}))`,
    'o = js("(() => ({ schema: \'amazon-search-observation.v1\', url: location.href, title: document.title }))()")',
    "if isinstance(d, dict):",
    "    o['bodyText'] = d.get('bodyText', '')",
    "    o['cards'] = d.get('cards', [])",
    "    o['parsedCards'] = d.get('parsedCards', 0)",
    "else:",
    "    o['bodyText'] = ''; o['cards'] = []; o['parsedCards'] = 0",
    "o['structureChanged'] = o['parsedCards'] > 0 and len(o['cards']) == 0",
    "o['observedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'",
    "out = json.dumps(o, ensure_ascii=False)",
    "print(out)",
    "open(os.environ['BU_COLLECT_OUTPUT'], 'w', encoding='utf-8').write(out)",
  ].join(String.fromCharCode(10));
}

function isRecord2(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 解析观察（畸形 → null）；失败原因判定：验证码 > 登录墙 > 无结果 > 结构变化。 */
export function parseAmazonCompetitorObservation(raw: string): AmazonCompetitorObservation | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const maybeJson = trimmed.split("\n").reverse().find((line) => line.trim().startsWith("{"));
  if (!maybeJson) return null;
  try {
    const value = JSON.parse(maybeJson) as Record<string, unknown>;
    if (value.schema !== AMAZON_SEARCH_OBSERVATION_SCHEMA) return null;
    if (typeof value.url !== "string" || typeof value.title !== "string" || typeof value.bodyText !== "string") return null;
    if (typeof value.observedAt !== "string" || Number.isNaN(new Date(value.observedAt).getTime())) return null;
    const cards = Array.isArray(value.cards) ? value.cards : [];
    const parsedCards = typeof value.parsedCards === "number" && Number.isInteger(value.parsedCards) ? value.parsedCards : cards.length;
    const lower = value.bodyText.toLowerCase();
    const hasCaptcha = /enter the characters you see below|captcha|robot check/i.test(value.bodyText);
    const hasLogin = !hasCaptcha && cards.length === 0 && /sign in|we just need to make sure/i.test(value.bodyText);
    const hasNoResults = !hasCaptcha && !hasLogin && /no results|did not match any products/i.test(value.bodyText);
    const structureChanged = value.structureChanged === true || (parsedCards > 0 && cards.length === 0);
    const failureReason = hasCaptcha ? "captcha_required" as const
      : hasLogin ? "login_required" as const
        : hasNoResults ? "no_results" as const
          : structureChanged ? "structure_changed" as const
            : null;
    return {
      schema: AMAZON_SEARCH_OBSERVATION_SCHEMA,
      url: value.url,
      title: value.title,
      bodyText: value.bodyText,
      parsedCards,
      cards: cards.filter(isRecord2).map((c) => ({
        asin: asStr(c.asin),
        title: asStr(c.title),
        sourceUrl: asStr(c.sourceUrl),
        imageUrl: asStr(c.imageUrl) || null,
        price: typeof c.price === "number" && Number.isFinite(c.price) ? c.price : null,
        rating: typeof c.rating === "number" && Number.isFinite(c.rating) ? c.rating : null,
        reviews: typeof c.reviews === "number" && Number.isFinite(c.reviews) ? c.reviews : null,
        capturedAt: asStr(c.capturedAt) || String(value.observedAt),
        sponsored: c.sponsored === true,
      })),
      structureChanged,
      failureReason,
      observedAt: String(value.observedAt),
    };
  } catch {
    return null;
  }
}

export function amazonCompetitorObservationToPreview(
  input: AmazonCompetitorCollectionInput,
  observation: AmazonCompetitorObservation,
  collectorVersion: string,
): BrowserUseResearchPreview {
  const collector: BrowserUseCollectorInfo = { tool: "browser-use", version: collectorVersion || "unknown" };
  const failureReason = observation.failureReason;
  const normalized = normalizeAmazonCompetitorCandidates(observation.cards, input.seedAsin);
  return {
    schema: BROWSER_USE_RESEARCH_SCHEMA,
    version: 1,
    kind: "competitor",
    seedAsin: input.seedAsin,
    marketplace: input.marketplaceTld === "com" ? "Amazon US" : input.marketplaceTld,
    seedProductUrl: null,
    sourceUrl: observation.url,
    capturedAt: observation.observedAt,
    results: normalized.competitors.map((c) => ({
      asin: c.asin,
      title: c.title,
      imageUrl: c.imageUrl,
      price: c.price,
      rating: c.rating,
      reviews: c.reviews,
      bsr: null,
      sourceUrl: c.sourceUrl,
      capturedAt: c.capturedAt,
    })),
    missing: failureReason === null && normalized.competitors.length === 0 ? ["amazon_search_competitors"] : (failureReason !== null ? ["amazon_search_results"] : []),
    failureReason: failureReason as BrowserUseResearchPreview["failureReason"],
    collector,
  } as BrowserUseResearchPreview;
}

export async function runAmazonCompetitorCollection(
  input: AmazonCompetitorCollectionInput,
  spawnImpl: SpawnLike = defaultBrowserUseSpawn,
): Promise<AmazonCompetitorCollectionRun> {
  let result: SpawnResult;
  try {
    result = await spawnImpl(buildAmazonCompetitorScript(input));
  } catch (error) {
    return { ok: false, failureReason: "collector_unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
  const observation = parseAmazonCompetitorObservation(result.stdout);
  if (!observation) {
    return { ok: false, failureReason: "collect_failed", detail: "未获得有效 Amazon 搜索观察（stdout=" + result.stdout.slice(0, 400) + "）" };
  }
  return { ok: true, observation };
}


// ---------------------------------------------------------------
// 轮 15：竞品 Amazon 详情页五点采集（reference-only，绝不写回当前商品属性）
// ---------------------------------------------------------------

export const AMAZON_DETAIL_OBSERVATION_SCHEMA = "amazon-detail-observation.v1" as const;
export const AMAZON_DETAIL_BULLETS_MAX = 5 as const;
export const AMAZON_DETAIL_BULLET_MAX_LENGTH = 500 as const;

export type AmazonDetailCollectionInput = {
  asin: string;
  marketplaceTld: string;
};

export type AmazonCompetitorDetailBullet = {
  asin: string;
  bullets: string[];
  sourceUrl: string;
  capturedAt: string;
};

export type AmazonCompetitorDetailObservation = {
  schema: typeof AMAZON_DETAIL_OBSERVATION_SCHEMA;
  url: string;
  title: string;
  bodyText: string;
  asin: string;
  bulletTexts: string[];
  parsedBullets: number;
  structureChanged: boolean;
  failureReason: "login_required" | "captcha_required" | "asin_mismatch" | "structure_changed" | null;
  observedAt: string;
};

export type AmazonCompetitorDetailRun =
  | { ok: true; observation: AmazonCompetitorDetailObservation }
  | { ok: false; failureReason: "collector_unavailable" | "collect_failed"; detail: string };

/** 竞品详情 URL：https + amazon.{tld}/dp/{asin}。 */
export function amazonDetailUrl(input: AmazonDetailCollectionInput): string {
  const tld = input.marketplaceTld && /^[a-z0-9.-]+$/i.test(input.marketplaceTld) ? input.marketplaceTld : "com";
  return `https://www.amazon.${tld}/dp/${encodeURIComponent(input.asin)}`;
}

const DETAIL_JS_BODY = "(() => { const li = [...document.querySelectorAll('#feature-bullets li')].map((el) => (el.innerText || '').replace(/^\\s*\\S+\\s*/u, '').trim()).filter((s) => s.length > 0); const dp = (document.querySelector('#productTitle') || document.querySelector('h1') || {}).textContent || ''; const asin = window.location.href.match(/\\/dp\\/([A-Z0-9]{10})/)?.[1] || ''; return JSON.stringify({ bulletTexts: li.slice(0, 20), productTitle: dp.trim(), asin: asin }); })()";

/** 确定性脚本：打开竞品详情页采集五点。 */
export function buildAmazonCompetitorDetailScript(input: AmazonDetailCollectionInput): string {
  const url = amazonDetailUrl(input);
  return [
    "import os, json",
    `new_tab("${url}")`,
    "wait_for_load()",
    "wait(6.0)",
    `d = json.loads(js(${JSON.stringify(DETAIL_JS_BODY)}))`,
    'o = js("(() => ({ schema: \'amazon-detail-observation.v1\', url: location.href, title: document.title, bodyText: (document.body.innerText || \'\').slice(0, 1500) }))()")',
    "if isinstance(d, dict):",
    "    o['asin'] = d.get('asin', '')",
    "    o['bulletTexts'] = d.get('bulletTexts', [])",
    "    o['productTitle'] = d.get('productTitle', '')",
    "else:",
    "    o['asin'] = ''; o['bulletTexts'] = []; o['productTitle'] = ''",
    "o['parsedBullets'] = len(o['bulletTexts'])",
    "o['structureChanged'] = o['asin'] == '' and o['parsedBullets'] == 0",
    "o['observedAt'] = __import__('datetime').datetime.utcnow().isoformat() + 'Z'",
    "out = json.dumps(o, ensure_ascii=False)",
    "print(out)",
    "open(os.environ['BU_COLLECT_OUTPUT'], 'w', encoding='utf-8').write(out)",
  ].join(String.fromCharCode(10));
}

/** 解析详情观察（畸形 → null）；失败原因：验证码 > 登录墙 > ASIN 不匹配 > 结构变化。 */
export function parseAmazonCompetitorDetailObservation(
  raw: string,
  expectedAsin?: string,
): AmazonCompetitorDetailObservation | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const maybeJson = trimmed.split("\n").reverse().find((line) => line.trim().startsWith("{"));
  if (!maybeJson) return null;
  try {
    const value = JSON.parse(maybeJson) as Record<string, unknown>;
    if (value.schema !== AMAZON_DETAIL_OBSERVATION_SCHEMA) return null;
    if (typeof value.url !== "string" || typeof value.title !== "string" || typeof value.bodyText !== "string") return null;
    if (typeof value.observedAt !== "string" || Number.isNaN(new Date(value.observedAt).getTime())) return null;
    const bulletTexts = Array.isArray(value.bulletTexts) ? value.bulletTexts.filter((b): b is string => typeof b === "string" && b.trim().length > 0) : [];
    const observedAsin = typeof value.asin === "string" ? value.asin.trim().toUpperCase() : "";
    const lower = String(value.bodyText).toLowerCase();
    const hasCaptcha = /enter the characters you see below|captcha|robot check/i.test(String(value.bodyText));
    const hasLogin = !hasCaptcha && /sign in|we just need to make sure|sorry, could not log you in/i.test(String(value.bodyText));
    const asinMismatch = (!!expectedAsin && observedAsin !== "" && observedAsin !== expectedAsin.toUpperCase());
    const structureChanged = value.structureChanged === true || (observedAsin === "" && bulletTexts.length === 0);
    const failureReason = hasCaptcha ? ("captcha_required" as const)
      : hasLogin ? ("login_required" as const)
        : asinMismatch ? ("asin_mismatch" as const)
          : structureChanged ? ("structure_changed" as const)
            : null;
    return {
      schema: AMAZON_DETAIL_OBSERVATION_SCHEMA,
      url: String(value.url),
      title: String(value.title),
      bodyText: String(value.bodyText),
      asin: observedAsin,
      bulletTexts,
      parsedBullets: typeof value.parsedBullets === "number" && Number.isInteger(value.parsedBullets) ? value.parsedBullets : bulletTexts.length,
      structureChanged,
      failureReason,
      observedAt: String(value.observedAt),
    };
  } catch {
    return null;
  }
}

/** 规范化竞品五点：≤5 条、每条 ≤500 字符、只接受 Amazon 详情 URL、ASIN 匹配。 */
export function normalizeAmazonCompetitorDetailBullets(
  entries: unknown[],
  expectedAsin: string,
): AmazonCompetitorDetailBullet[] {
  const out: AmazonCompetitorDetailBullet[] = [];
  for (const item of entries.slice(0, 5)) {
    const c = item as Record<string, unknown>;
    const asin = typeof c.asin === "string" ? c.asin.trim().toUpperCase() : "";
    if (asin !== expectedAsin.toUpperCase()) continue;
    const url = typeof c.url === "string" ? c.url : "";
    if (!url || !isAllowedAmazonSourceUrl(url)) continue;
    const bullets = (Array.isArray(c.bullets) ? c.bullets : [])
      .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      .map((b) => b.trim().slice(0, AMAZON_DETAIL_BULLET_MAX_LENGTH))
      .slice(0, AMAZON_DETAIL_BULLETS_MAX);
    if (bullets.length === 0) continue;
    out.push({
      asin,
      bullets,
      sourceUrl: url,
      capturedAt: typeof c.capturedAt === "string" ? c.capturedAt : new Date().toISOString(),
    });
  }
  return out;
}
