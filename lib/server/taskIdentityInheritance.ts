/**
 * V3 Final Product Integration — Task Identity Inheritance（F4）
 *
 * Candidate → Task 商品身份继承的唯一权威（fail-closed）：
 * - productUrl Authority：Candidate 已保存合法 source URL > ASIN + 明确 marketplace 派生 canonical URL；
 *   禁止"只看到 ASIN 就猜 marketplace"、禁止未知市场默认 amazon.com。
 * - Browser Evidence 回退：Amazon Browser Evidence 能力边界为 Amazon US 单一市场
 *   （lib/server/browserEvidenceCollect.ts: BROWSER_EVIDENCE_ALLOWED_ORIGINS = ["https://www.amazon.com"]），
 *   因此 resultJson ASIN 回退仅允许 marketplace 明确为 US 系（Amazon US / US / amazon.com）。
 * - 全部输入 fail-closed：结构非法 / 域名不在白名单 / 市场未知 → null（不构造、不导航）。
 */
import "server-only";

/** 已知 Amazon marketplace 名 → 站点 host（未知市场 → null，禁止猜测） */
const AMAZON_MARKETPLACE_HOSTS: Record<string, string> = {
  "Amazon US": "www.amazon.com",
  US: "www.amazon.com",
  "amazon.com": "www.amazon.com",
  "Amazon UK": "www.amazon.co.uk",
  UK: "www.amazon.co.uk",
  "amazon.co.uk": "www.amazon.co.uk",
  "Amazon CA": "www.amazon.ca",
  CA: "www.amazon.ca",
  "amazon.ca": "www.amazon.ca",
  "Amazon DE": "www.amazon.de",
  DE: "www.amazon.de",
  "amazon.de": "www.amazon.de",
  "Amazon FR": "www.amazon.fr",
  FR: "www.amazon.fr",
  "amazon.fr": "www.amazon.fr",
  "Amazon IT": "www.amazon.it",
  IT: "www.amazon.it",
  "amazon.it": "www.amazon.it",
  "Amazon ES": "www.amazon.es",
  ES: "www.amazon.es",
  "amazon.es": "www.amazon.es",
  "Amazon JP": "www.amazon.co.jp",
  JP: "www.amazon.co.jp",
  "amazon.co.jp": "www.amazon.co.jp",
  "Amazon MX": "www.amazon.com.mx",
  MX: "www.amazon.com.mx",
  "amazon.com.mx": "www.amazon.com.mx",
  "Amazon AU": "www.amazon.com.au",
  AU: "www.amazon.com.au",
  "amazon.com.au": "www.amazon.com.au",
  "Amazon IN": "www.amazon.in",
  IN: "www.amazon.in",
  "amazon.in": "www.amazon.in",
};

/** Browser Evidence 仅支持 Amazon US（collect 固定 https://www.amazon.com/dp/{asin}） */
const BROWSER_EVIDENCE_US_MARKETPLACES = new Set(["Amazon US", "US", "amazon.com"]);

const AMAZON_HOSTS = new Set(Object.values(AMAZON_MARKETPLACE_HOSTS));

const ASIN_RE = /^[A-Z0-9]{10}$/;

/** 候选 sourceMetaJson 内可能出现的 identity 结构（sellersprite_candidate_source_v1 / product-batch-candidate-source.v1 等） */
type CandidateSourceMetaIdentity = {
  identity?: { asin?: unknown; productUrl?: unknown };
  asin?: unknown;
  productUrl?: unknown;
  marketplace?: unknown;
  source?: { marketplace?: unknown };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSourceMetaJson(sourceMetaJson: string): CandidateSourceMetaIdentity {
  try {
    const parsed: unknown = JSON.parse(sourceMetaJson);
    if (!isRecord(parsed)) return {};
    return parsed as CandidateSourceMetaIdentity;
  } catch {
    return {};
  }
}

/** 校验 URL 为 https + Amazon 家族主机（fail-closed） */
export function isTrustedAmazonProductUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return AMAZON_HOSTS.has(parsed.hostname.toLowerCase());
}

/** 规范化 marketplace 名并返回站点 host；未知市场 → null */
export function amazonHostForMarketplace(marketplace: string | null | undefined): string | null {
  if (typeof marketplace !== "string" || !marketplace.trim()) return null;
  return AMAZON_MARKETPLACE_HOSTS[marketplace.trim()] ?? null;
}

function canonicalProductUrl(asin: string, marketplace: string): string | null {
  if (!ASIN_RE.test(asin)) return null;
  const host = amazonHostForMarketplace(marketplace);
  if (!host) return null;
  return `https://${host}/dp/${asin}`;
}

/**
 * Candidate → Task productUrl 继承（Authority：已保存合法 URL > ASIN+明确 marketplace 派生）。
 * 全部候选来源（SellerSprite 直导 / ProductBatch / 手工）统一走本函数。
 */
export function resolveTaskProductUrlFromCandidate(input: {
  link: string | null;
  sourceMetaJson: string;
}): string | null {
  const meta = parseSourceMetaJson(input.sourceMetaJson ?? "{}");

  // 1) sourceMeta 内已保存的 identity.productUrl（导入时已校验；此处防御性二次校验）
  if (typeof meta.identity?.productUrl === "string") {
    const url = meta.identity.productUrl.trim();
    if (isTrustedAmazonProductUrl(url)) return url;
  }

  // 2) Candidate.link（SellerSprite 直导 = amazonUrl，导入时校验；防御性二次校验）
  if (typeof input.link === "string" && input.link.trim()) {
    const url = input.link.trim();
    if (isTrustedAmazonProductUrl(url)) return url;
  }

  // 3) ASIN + 明确 marketplace → deterministic canonical URL（禁止未知市场默认 amazon.com）
  const asin = typeof meta.identity?.asin === "string" ? meta.identity.asin : null;
  const marketplace = typeof meta.source?.marketplace === "string"
    ? meta.source.marketplace
    : typeof meta.marketplace === "string"
      ? meta.marketplace
      : null;
  if (asin && marketplace) {
    const canonical = canonicalProductUrl(asin, marketplace);
    if (canonical) return canonical;
  }

  // 4) 无法证明 Entity → fail-closed
  return null;
}

/**
 * Browser Evidence ASIN 回退：task.productUrl 缺失时，仅当 resultJson 身份
 * （candidateAnalysisContext.facts）给出 ASIN 且 marketplace 明确为 Amazon US 系，
 * 才返回该 ASIN（collect 端固定导航 amazon.com；非 US 市场 fail-closed）。
 */
export function resolveBrowserEvidenceAsinFromResultJson(resultJson: string): string | null {
  let result: unknown;
  try {
    result = JSON.parse(resultJson);
  } catch {
    return null;
  }
  if (!isRecord(result)) return null;
  const facts = isRecord(result.candidateAnalysisContext)
    ? isRecord(result.candidateAnalysisContext.facts)
      ? result.candidateAnalysisContext.facts
      : null
    : null;
  if (!facts) return null;
  const asin = typeof facts.asin === "string" ? facts.asin.trim().toUpperCase() : "";
  const marketplace = typeof facts.marketplace === "string" ? facts.marketplace.trim() : "";
  if (!ASIN_RE.test(asin)) return null;
  if (!BROWSER_EVIDENCE_US_MARKETPLACES.has(marketplace)) return null;
  return asin;
}
