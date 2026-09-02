/**
 * ListingKeywordPolicy v1 —— 所有关键词进入最终 Listing 前的唯一策略出口。
 *
 * 目标：任何来源（SellerSprite / 已保存 Keyword Brief / 自动方案 / AI 返回词 / 历史快照读取）
 * 在进入正式标题/五点/描述/keywords/backendSearchTerms 前必须经过本策略；
 * 竞品品牌词、风险/绝对承诺词永不进入正式 Listing；own_brand 可进标题但默认不重复塞后台搜索词。
 */

export const listingKeywordPolicyVersion = "listing-keyword-policy.v2" as const;

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

/* ── R2 关键词形态门禁：句子型/谓语开头/标点垃圾词不得进入正式关键词 ──
 *
 * 关键词是 2–6 词自然名词短语；Amazon 正式关键词字段禁止句子。
 * 只拒绝「句子形态」输入：句末/句中句子标点、明显谓语开头（含情态动词原形）、
 * 以及超过自然短语上限的明显超长串。绝不按词面猜品牌、不杀 2–6 词自然名词短语。
 * 判定完全基于英文短语形态，不含任何商品/品牌/类型字符串特判。
 */const SENTENCE_LEAD_WORDS = new Set([
  // 情态/助动词（后接动词才像句子；can opener 类名词产品名不在此集合）
  "can", "could", "will", "would", "should", "must", "may", "does", "did",
  // 三单现在时与无歧义原形谓语（词面即动词形态，不可能是纯名词短语开头）
  "is", "are", "was", "were", "has", "have",
  "holds", "hold", "keeps", "keep", "stores", "store", "carries", "carry",
  "contains", "contain", "includes", "include", "features", "feature", "comes", "come",
  "fits", "fit", "expands", "expand", "extends", "extend", "contracts", "contract",
  "collapses", "collapse", "folds", "fold", "unfolds", "unfold", "adjusts", "adjust",
  "organizes", "organize", "separates", "separate", "divides", "divide",
  "accommodates", "accommodate", "arranges", "arrange", "protects", "protect",
  "supports", "support", "offers", "offer", "provides", "provide", "allows", "allow",
  "works", "work", "measures", "measure", "weighs", "weigh", "makes", "make",
  "prevents", "prevent", "reduces", "reduce", "resists", "resist", "requires", "require",
  "opens", "open", "closes", "close", "slides", "slide", "stands", "stand", "hangs", "hang",
]);
/** 明显超长（> 10 词）串几乎不可能是类目关键词，按句子型拒绝 */
const MAX_KEYWORD_WORDS = 10;
const SENTENCE_PUNCT = /[.!?]/;
const PHRASE_SEPARATOR = /[,;]/;

/** 返回句子形态原因；null = 形态合规（可继续走分类策略） */
function sentenceLikeReason(keyword: string): string | null {
  const kw = String(keyword ?? "").trim();
  if (!kw) return null;
  // 正式关键词字段不得含句末标点或句内逗号/分号（句子分隔符）
  if (SENTENCE_PUNCT.test(kw) || PHRASE_SEPARATOR.test(kw)) return "sentence_like";
  const tokens = kw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.length > MAX_KEYWORD_WORDS) return "sentence_like";
  // 明显谓语开头：仅当整串 >= 5 词才按谓语拒（3-4 词如 "carry water bottle"
  // 是 Amazon 后端词里常见的省略功能短语，不得误杀）
  if (tokens.length >= 5 && SENTENCE_LEAD_WORDS.has(tokens[0])) return "sentence_like";
  return null;
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
    const sentenceReason = sentenceLikeReason(kw);
    if (sentenceReason) {
      // 句子型垃圾词即使写进人工 Brief 也不得进入正式关键词（R2 关键词卫生）
      rejected.push({ keyword: kw, reason: sentenceReason });
      continue;
    }
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


/** 每个 brand/series 标记只识别一个品牌候选：优先标记前一 token，不合格时取后一 token，绝不同时提取两侧。 */
function brandCandidateAt(
  toks: string[],
  markerIndex: number,
  ownTokens: Set<string>,
  commonWords: Set<string>,
): string | null {
  const BRAND_MARKER_WORDS = new Set(["brand", "series"]);
  const candidateToks = [toks[markerIndex - 1], toks[markerIndex + 1]].filter((t): t is string => Boolean(t));
  for (const candidate of candidateToks) {
    if (candidate.length < 4) continue;
    if (BRAND_MARKER_WORDS.has(candidate)) continue;
    if (ownTokens.has(candidate)) continue;
    if (commonWords.has(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * 关键词不是品牌事实：只有显式出现 brand/series 标记时才可辅助识别品牌。
 * 裸关键词中的陌生 token 不再凭长度被猜为品牌（普通功能词无限，黑名单必然再次误杀，
 * 如 dishwasher/straw 被误判为竞品品牌导致已确认事实被品牌门禁拦截）。
 * 有标记时最多识别一个品牌候选（优先标记前一侧；前面无合格候选才取后一侧）；
 * 候选不得是标记词/ownBrand 组成 token/普通类目词；仍保留保序去重与数量上限。
 */
export function extractBrandLikeTokensFromKeywords(
  keywords: ReadonlyArray<string | null | undefined>,
  input: { ownBrand?: string },
): string[] {
  const own = norm(input.ownBrand ?? "");
  const ownTokens = new Set(own.split(/\s+/).filter(Boolean));
  const commonWords = new Set<string>([...STOPWORDS, ...GENERIC_WORDS, ...ATTRIBUTE_WORDS, ...SCENARIO_WORDS, ...RISK_WORDS, "brand", "series"]);
  const BRAND_MARKER_WORDS = new Set(["brand", "series"]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of keywords ?? []) {
    if (!kw) continue;
    const toks = String(kw).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    // 无显式 brand/series 标记：关键词不得升级为品牌证据
    if (!toks.some((w) => BRAND_MARKER_WORDS.has(w))) continue;
    for (let i = 0; i < toks.length; i++) {
      if (!BRAND_MARKER_WORDS.has(toks[i])) continue;
      const candidate = brandCandidateAt(toks, i, ownTokens, commonWords);
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      out.push(candidate);
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
