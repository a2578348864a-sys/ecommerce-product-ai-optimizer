/**
 * ListingKeywordPolicy v1 —— 所有关键词进入最终 Listing 前的唯一策略出口。
 *
 * 目标：任何来源（SellerSprite / 已保存 Keyword Brief / 自动方案 / AI 返回词 / 历史快照读取）
 * 在进入正式标题/五点/描述/keywords/backendSearchTerms 前必须经过本策略；
 * 竞品品牌词、风险/绝对承诺词永不进入正式 Listing；own_brand 可进标题但默认不重复塞后台搜索词。
 */

export const listingKeywordPolicyVersion = "listing-keyword-policy.v1" as const;

export type KeywordCategory =
  | "generic"
  | "attribute"
  | "scenario"
  | "long_tail"
  | "own_brand"
  | "competitor_brand"
  | "unknown_brand"
  | "risk";

export type KeywordPolicyInput = {
  ownBrand: string;
  knownBrands: string[];
};

const STOPWORDS = new Set(["a", "an", "the", "for", "with", "of", "and", "or", "in", "on", "to", "at", "by", "from", "this", "that", "is", "are"]);
const ATTRIBUTE_WORDS = new Set([
  "stainless", "steel", "plastic", "glass", "ceramic", "silicone", "18oz", "24oz", "32oz", "oz", "liter", "ml", "lb", "pound", "gram",
  "slices", "slice", "capacity", "qt", "cup", "electric", "rechargeable", "cordless", "wireless", "certified", "approved", "fda", "bpa", "ect", "ce", "rohs", "ul",
]);
const SCENARIO_WORDS = new Set(["school", "travel", "office", "home", "outdoor", "camping", "gym", "work", "car", "kitchen", "lunch", "picnic"]);
const RISK_WORDS = new Set(["best", "guaranteed", "guarantee", "effective", "medical", "therapeutic", "cure", "heal", "safest", "premium-quality", "no.1", "number one", "top-rated", "100%"]);
const GENERIC_WORDS = new Set(["bottle", "toaster", "scale", "whisk", "cup", "mug", "jar", "box", "container", "pot", "pan", "kettle", "luminaire", "bag", "lunchbox", "water", "kids", "child", "children", "school", "travel", "insulated", "thermal", "vacuum", "stainless", "steel", "food", "jar", "refill", "sport", "home", "office", "camping", "gym", "drink", "beverage", "coffee", "tea", "soup", "food"]);
const BRAND_HINT_WORDS = new Set(["brand", "series"]);

function norm(value: string): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function wordsOf(value: string): string[] {
  const n = norm(value);
  return n ? n.split(/\s+/).filter(Boolean) : [];
}

function hasAny(phrase: string, set: Set<string>): boolean {
  const ws = wordsOf(phrase);
  return ws.some((w) => set.has(w)) || [...set].some((w) => norm(phrase).includes(norm(w)));
}

export function classifyKeyword(keyword: string, input: KeywordPolicyInput): KeywordCategory {
  const kw = keyword.trim();
  if (!kw) return "risk";
  const normKw = norm(kw);
  const own = norm(input.ownBrand);
  const ownCompact = own.replace(/\s+/g, "");
  const kwCompact = normKw.replace(/\s+/g, "");
  if (own && (normKw.includes(own) || own === normKw || kwCompact.includes(ownCompact) || ownCompact === kwCompact)) return "own_brand";
  const known = input.knownBrands.map(norm).filter(Boolean);
  if (known.some((b) => normKw.includes(b) || b === normKw)) return "competitor_brand";
  if (hasAny(kw, RISK_WORDS)) return "risk";
  const tokens = wordsOf(kw);
  // 无法从当前竞品资料映射、但显式标为品牌/系列的词，必须按未知品牌 fail-closed。
  // 不维护 Stanley/Owala 等当前样例品牌硬编码；已知竞品只来自传入的证据标题。
  if (tokens.some((w) => BRAND_HINT_WORDS.has(w))) return "unknown_brand";
  const attrHit = [...ATTRIBUTE_WORDS].some((a) => normKw.includes(norm(a)));
  const scenarioHit = hasAny(kw, SCENARIO_WORDS);
  const genericHit = hasAny(kw, GENERIC_WORDS);
  const wc = wordsOf(kw).length;
  if (wc >= 4) return "long_tail";
  if (attrHit) return "attribute";
  if (scenarioHit) return "scenario";
  if (genericHit) return "generic";
  return "long_tail";
}

export type KeywordFilterResult = {
  accepted: string[];
  rejected: Array<{ keyword: string; reason: string }>;
  ownBrandKeyword: string | null;
};

/**
 * AI 即使没有采用关键词方案，也不得在正式 Listing 正文中写入已知竞品品牌。
 * 品牌集合只来自当前任务的竞品资料；自有品牌不属于禁词。
 */
export function findCompetitorBrandMentions(
  texts: ReadonlyArray<string | null | undefined>,
  input: KeywordPolicyInput,
): string[] {
  const body = ` ${texts.map((text) => norm(String(text ?? ""))).join(" ")} `;
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const rawBrand of input.knownBrands) {
    const brand = norm(rawBrand);
    if (!brand || seen.has(brand)) continue;
    seen.add(brand);
    if (body.includes(` ${brand} `)) matches.push(rawBrand);
  }
  return matches;
}

/** 唯一出口：排序稳定、保序去重；人工方案没有绕过入口。 */
export function filterKeywordsForListing(
  keywords: string[],
  input: KeywordPolicyInput,
): KeywordFilterResult {
  const seen = new Set<string>();
  const accepted: string[] = [];
  const rejected: Array<{ keyword: string; reason: string }> = [];
  let ownBrandKeyword: string | null = null;

  for (const raw of keywords ?? []) {
    const kw = String(raw ?? "").trim();
    if (!kw) continue;
    const key = norm(kw);
    if (seen.has(key)) continue;
    seen.add(key);
    const cat = classifyKeyword(kw, input);
    if (cat === "competitor_brand" || cat === "unknown_brand" || cat === "risk") {
      // 人工 Brief 也不能绕过竞品品牌、未知品牌与风险词。
      rejected.push({ keyword: kw, reason: cat });
      continue;
    }
    if (cat === "own_brand") {
      if (!ownBrandKeyword) ownBrandKeyword = kw;
      // own_brand 可进标题，但默认不重复塞入后台搜索词 → 仅有标题资格；明确记录不进 accepted
      rejected.push({ keyword: kw, reason: "own_brand" });
      continue;
    }
    accepted.push(kw);
  }
  // 保序去重已在 seen 中完成；accepted 按原始顺序
  return { accepted, rejected, ownBrandKeyword };
}


/** 从关键词候选识别「品牌样」token（4+ 字母、非通用词、非自身品牌）——用于补齐 knownBrands（竞品证据之外） */
export function extractBrandLikeTokensFromKeywords(
  keywords: ReadonlyArray<string | null | undefined>,
  input: { ownBrand?: string },
): string[] {
  const own = norm(input.ownBrand ?? "");
  const skip = new Set<string>([...STOPWORDS, ...GENERIC_WORDS, ...ATTRIBUTE_WORDS, ...SCENARIO_WORDS, ...RISK_WORDS, "brand", "cup", "bottle", "tumbler", "jug", "flask", "leak", "proof"]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of keywords ?? []) {
    if (!kw) continue;
    const toks = String(kw).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    for (const w of toks) {
      if (w.length < 4 || skip.has(w) || w === own) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
    if (out.length >= 12) break;
  }
  return out;
}

/** 从竞品证据 note（商品标题）确定性提取品牌：逐 title 取首个 4+ 字母非常见词 token，归一化小写，排除 ownBrand */
export function extractKnownBrandsFromCompetitorTitles(
  titles: ReadonlyArray<string | null | undefined>,
  input: { ownBrand?: string },
): string[] {
  const own = norm(input.ownBrand ?? "");
  const out: string[] = [];
  const seen = new Set<string>();
  const skip = new Set<string>([...STOPWORDS, ...RISK_WORDS, "generic", "unknown", "brand", "tumbler", "bottle", "cup", "jar", "box", "bag", "container", "flask", "lid", "straw", "oz", "pack", "count"]);
  for (const title of titles) {
    if (!title) continue;
    const toks = String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    const candidate = toks.find((w) => w.length >= 4 && !skip.has(w) && w !== own);
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
