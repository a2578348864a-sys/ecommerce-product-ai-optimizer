/**
 * 研究输入数据质量（Research Input Quality）—— 唯一相关度判定模块。
 *
 * 职责：
 * 1. 关键词确定性与商品身份的相关度评分 + 主词选择（竞品搜索与 Keyword Brief 推荐共用，禁止两套算法）；
 * 2. 已保存竞品按商品身份分类：direct（核心词 ≥2 或产品短语命中）/ adjacent（仅 1 核心词）/ irrelevant（0）；
 *    仅 direct 允许进入 Listing 竞品定位参考（reference-only）。
 *
 * 安全：品牌/ASIN/容量不单独构成相关；最大相关度为 0 → 返回 null fail-closed（不从标题编造关键词）。
 * 纯函数；无 DB/网络；同输入同输出。
 */

export type KeywordRelevanceRow = {
  keyword: string;
  searchVolume?: number | null;
  relevance?: number | null;
};

export type KeywordRelevanceScored = KeywordRelevanceRow & { score: number };

/** 规范化：小写、去标点、去多余空格，保留词序与词本身。 */
function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 规范化后按空格切词。 */
function words(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

/** 品牌/ASIN/容量不算核心词（单独出现不构成相关）。 */
const NON_SPECIFIC_FIELDS = new Set(["brand", "asin", "capacity", "weight", "color", "material", "marketplace", "price", "rating", "reviews"]);

const STOPWORDS = new Set(["a", "an", "the", "for", "with", "of", "and", "or", "in", "on", "to", "at", "by", "from", "this", "that", "is", "are"]);

/** 判定给定词是否为"产品语义词"（排除品牌/ASIN/容量词与常见商品泛词即视为具体词）。 */
function isSpecificTerm(term: string, knownBrands: string[]): boolean {
  const t = term.trim();
  if (!t || t.length < 2) return false;
  if (NON_SPECIFIC_FIELDS.has(t)) return false;
  if (STOPWORDS.has(t)) return false;
  if (knownBrands.some((b) => b.toLowerCase() === t)) return false;
  if (/^\d+oz$/.test(t) || /^(\d+(\.\d+)?)(cm|mm|in|inch|ml|l|kg|g|oz)$/.test(t)) return false;
  return true;
}

/**
 * 计算关键词与权威商品名的相关度（确定性）。
 * - 商品词 = 商品名语义词（去停用词后）；
 * - 相关度 = 关键词与商品词的交集质量：优先商品标题关键词重合，其次多词具体度；
 * - 品牌/ASIN/容量/单 token 泛词单独出现不构成相关；
 * - 0 = 不相关。
 */
export function scoreKeywordRelevance(keyword: string, productName: string, knownBrands: string[] = []): number {
  const kw = normalize(keyword);
  const prod = normalize(productName);
  if (!kw || !prod) return 0;

  const prodTokens = new Set(words(productName));
  const prodSpecific = [...prodTokens].filter((t) => isSpecificTerm(t, knownBrands));
  if (prodSpecific.length === 0) return 0;

  const kwTokens = words(keyword);
  const kwSpecific = kwTokens.filter((t) => isSpecificTerm(t, knownBrands));
  if (kwSpecific.length === 0) return 0;

  // 1) 商品标题关键词重合（无共享词 → 0 相关，fail-closed）
  const shared = kwSpecific.filter((t) => prodTokens.has(t));
  if (shared.length === 0) return 0;
  // 2) 品种/产品语义词加权：thermos→high；容器宽词（box/bag/bottle 等）降权；复合共享词数越高越好
  const HIGH_SPECIFIC = new Set(["thermos", "food", "jar", "container", "insulated", "thermal", "vacuum", "bottle"]);
  const LOW_SPECIFIC = new Set(["box", "bag", "bag", "kids", "child", "lunch", "small", "pink", "red", "blue", "white", "black", "green", "grey", "other", "fashion", "style"]);
  const highWeight = shared.filter((t) => HIGH_SPECIFIC.has(t)).length;
  const lowWeight = shared.filter((t) => LOW_SPECIFIC.has(t)).length;
  // 词序敏感性：产品短语（连续 2+ 共享词）额外加分
  const kwLower = words(keyword);
  let phraseBonus = 0;
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= kwLower.length; i++) {
      const phrase = kwLower.slice(i, i + n).join(" ");
      const prodPhrase = prodSpecific.join(" ");
      if (phrase.length >= 6 && prodPhrase.includes(phrase)) { phraseBonus += 6; break; }
    }
  }
  return 10 + shared.length * 5 + highWeight * 8 - lowWeight * 3 + phraseBonus;
}

/**
 * 从关键词行选择最佳主词（确定性排序，最后才用搜索量打破平局）。
 * 返回 null 表示无相关词（fail-closed）。
 */
export function pickBestKeyword(rows: readonly KeywordRelevanceRow[], productName: string, knownBrands: string[] = []): { keyword: string; score: number } | null {
  let best: { keyword: string; score: number; volume: number } | null = null;
  for (const row of rows ?? []) {
    const kw = String(row.keyword ?? "").trim();
    if (!kw) continue;
    const score = scoreKeywordRelevance(kw, productName, knownBrands);
    if (score <= 0) continue;
    const volume = Number(row.searchVolume ?? 0) || 0;
    if (!best || score > best.score || (score === best.score && volume > best.volume)) {
      best = { keyword: kw, score, volume };
    }
  }
  return best ? { keyword: best.keyword, score: best.score } : null;
}

/** 竞品标题与商品身份的三分类。 */
export function classifyCompetitorRelation(title: string, productName: string, knownBrands: string[] = []): "direct" | "adjacent" | "irrelevant" {
  const prodTokens = new Set(words(productName));
  const prodSpecific = [...prodTokens].filter((t) => isSpecificTerm(t, knownBrands));
  if (prodSpecific.length === 0) return "irrelevant";
  const titleTokens = words(title);
  const titleSpecific = titleTokens.filter((t) => isSpecificTerm(t, knownBrands));
  const shared = titleSpecific.filter((t) => prodTokens.has(t)).length;
  if (shared >= 2) return "direct";
  if (shared === 1) {
    // 若命中产品短语（连续 2 词以上与商品名重叠）同样 direct
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= titleSpecific.length; i++) {
        const phrase = titleSpecific.slice(i, i + n).join(" ");
        const prodPhrase = prodSpecific.join(" ");
        if (phrase.length >= 6 && prodPhrase.includes(phrase)) return "direct";
      }
    }
    return "adjacent";
  }
  return "irrelevant";
}
