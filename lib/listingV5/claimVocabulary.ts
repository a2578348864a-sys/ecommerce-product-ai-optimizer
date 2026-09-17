/**
 * Listing V5 — shared hard-claim vocabulary.
 *
 * Single source of truth for the wording that asserts performance, duration or
 * certification. The Validator rejects it (validation.ts) and the Conversion
 * Blueprint warns the Writer about exactly the same words (conversionBlueprint.ts),
 * so the two can never drift apart.
 *
 * This module is deliberately dependency-free: the route tests replace the
 * Validator module with a partial mock, and the shared vocabulary must keep
 * working there.
 */
export const HARD_OR_ESCALATION_TOKENS: ReadonlySet<string> = new Set([
  "durable", "durability", "lasting", "leakproof", "leak", "spillproof", "spill", "waterproof", "rustproof", "rust",
  "certified", "certification", "fda", "approved", "nontoxic", "toxic", "bpa", "scratch", "odor", "resistant", "resistance",
  "guarantee", "guaranteed", "unbreakable", "shatterproof", "tough", "strongest", "dishwasher", "safe", "foodsafe", "nonstick",
  "cold", "hot", "warm", "hour", "hours", "minute", "minutes", "overnight", "freeze", "frozen", "boil", "microwave",
  "bacteria", "mold", "insulated", "insulation",
  "high", "higher", "highest", "maximum", "max", "extreme", "ultra", "super", "heavy", "duty", "professional", "industrial",
  "perfect", "best", "most", "complete", "total", "fully", "always", "never", "only", "every", "all",
]);

// ===== M1/S1 MOVED DECLARATIONS =====
//
// 以下声明于 M1 / S1 从各自的原位置原样搬入本模块，元素内容、顺序与
// 字符串字节逐位保持搬出前状态（仅新增 `export` 与类型标注，字面量未改动）。
// 搬出前的位置见每个分节标题；S1 阶段原文件仍保留本地声明，本块暂无消费者。

/* ──────────────────────────────────────────────────────────────────────────
 * STRUCTURE 层 — 中性文案 / 残余语法判定词表
 * 搬出前位置：lib/listingHandoff/listingClaimEvidenceResolver.ts
 * ────────────────────────────────────────────────────────────────────────── */

export const NEUTRAL_COPY_ALLOWLIST: readonly string[] = Object.freeze([
  "日常使用的实用选择",
  "简洁实用的选择",
  "清晰呈现产品特点",
  "现代简约风格",
  "简洁现代的设计",
  "值得信赖的优质之选",
  "轻松融入日常使用",
  "适合日常使用的实用选择",
  "实用之选",
  "设计简约大方",
  "一款实用的产品",
  "适用于日常场景",
  "为生活增添便利",
  "简单好用的选择",
  "满足日常需求",
  "结构清晰",
  "外观简洁",
  "使用方便",
  "便于携带",
  "适合桌面",
  "便于日常使用",
  "易于使用",
  "方便实用",
  "适合各种场合",
  "日常使用方便",
  "for the target market",
  "practical listing draft",
  "listing draft",
  "cross-border product",
  "human review required",
]);

/** 1. 功能词：限定词 / 代词 / 介词 / 连词 / 助动词 / 量词 / 单位字母 */
export const RESIDUAL_FUNCTION_WORDS: ReadonlySet<string> = Object.freeze(new Set([
  "the", "a", "an", "this", "that", "these", "those", "it", "its", "their", "there",
  "of", "for", "with", "in", "on", "at", "to", "from", "by", "as", "into", "onto",
  "through",
  "within", "without", "per", "than", "over", "under", "between", "about", "around",
  "up", "down", "out", "off", "back", "when", "while", "before", "after", "during",
  "and", "or", "but", "nor", "also", "plus", "then", "if",
  "not", "no", "all", "any", "each", "both", "more", "most", "only",
  "can", "may", "will", "must", "should", "would", "could", "do", "does", "did",
  "be", "been", "being",
  "approx", "approximately", "about", "x", "w", "h", "l", "d", "oz", "g", "kg", "ml", "cm", "mm",
]));

/** 2. 字段元数据名词：描述「字段角色」，不描述商品属性 */
export const RESIDUAL_FIELD_NOUNS: ReadonlySet<string> = Object.freeze(new Set([
  "product", "products", "item", "items", "unit", "units", "brand", "category",
  "type", "model", "series", "style", "design", "finish", "material", "color", "colour",
  "weight", "size", "length", "width", "height", "depth", "dimension", "dimensions",
  "capacity", "volume", "quantity", "count", "pack", "set", "piece", "pieces",
  "part", "parts", "component", "components", "feature", "features",
  "option", "options", "spec", "specs", "specification", "range", "level",
  "care", "cleaning", "usage", "use", "operation", "compatibility", "construction",
  "function", "functions", "price", "rating", "review", "reviews", "usd",
  "standard", "version", "field", "value", "name",
  // 消费者自然句字段语义名词（任务书窄授权：body/mechanism/control）
  "body", "mechanism", "control",
  // 中文字段词（与英文同义，仅供中文残余走同一判定）
  "材质", "材料", "为", "是", "尺寸", "长度", "重量", "颜色", "品牌", "类目", "款",
  "外壳", "设计", "价格", "参考价格", "评分", "评论数", "商品名", "参考", "产品",
  "类别", "净重", "约", "商品类型", "类型", "系列", "型号", "容量", "数量", "包装",
  "的", "与", "和", "及",
  // 组合字段标签词：字段标签不是商品属性，剥离事实值后允许残留
  "款式", "规格", "参数", "功能", "说明", "特点", "优点", "内容", "清单", "名称", "单位",
]));

/** 3. 无事实内容的限定修饰词 */
export const RESIDUAL_QUALIFIERS: ReadonlySet<string> = Object.freeze(new Set([
  "everyday", "daily", "practical", "easy", "easily", "simple", "simply", "general",
  "regular", "normal", "common", "typical", "basic", "convenient", "gently",
  "suitable", "available", "made", "built", "designed", "included", "including",
  "together", "individually", "on-the-go", "every", "day", "times",
]));

/** 4. 中性连接谓语（受位置约束；见上） */
export const RESIDUAL_PREDICATES: ReadonlySet<string> = Object.freeze(new Set([
  "is", "are", "was", "were", "has", "have", "had",
  "includes", "include", "contains", "contain",
  "measures", "measure", "weighs", "weigh", "spans", "span",
  "holds", "hold", "stores", "store", "carries", "carry", "accommodates", "accommodate",
  "fits", "fit", "comes", "come", "features", "feature",
  "provides", "provide", "offers", "offer", "supports", "support",
  "works", "work", "expands", "expand", "collapses", "collapse",
  "organizes", "organize", "separates", "separate", "divides", "divide",
  "seals", "seal", "opens", "open", "closes", "close", "locks", "lock",
  "uses",
  "slides", "slide", "rotates", "rotate", "adjusts", "adjust",
  "helps", "help", "allows", "allow", "prevents", "prevent",
  "reduces", "reduce", "resists", "resist", "doubles", "double",
  "sits", "sit", "stands", "stand", "hangs", "hang", "rests", "rest",
]));

/**
 * 祈使护理动词：出现在无事实锚点的段中，即构成「未证实的护理/用法声明」，
 * 不能走"纯文案中性表达"通道（假绿：无锚点句借中性通道过关）。
 */
export const ASSERTIVE_IMPERATIVE_VERBS: ReadonlySet<string> = Object.freeze(new Set([
  "rinse", "rinsed", "wipe", "wiped", "wash", "washed", "dry", "dried",
  "soak", "scrub", "place", "store", "insert", "fill", "empty", "press",
  "pull", "push", "turn", "remove", "avoid", "follow", "check", "separate",
  "handle", "clean", "cleaned",
]));

/* ──────────────────────────────────────────────────────────────────────────
 * FACT_REQUIRED 层的 shape 参数 — 硬声明识别器的判定阈值
 * 搬出前位置：lib/listingV5/validation.ts
 * ────────────────────────────────────────────────────────────────────────── */

export const STOPWORDS: ReadonlySet<string> = new Set(["a", "an", "the", "of", "for", "to", "and", "in", "on", "with", "is", "are", "that", "this", "it", "its", "as", "at", "by", "or", "be", "from"]);

export const COPULA_ALLOWED_COMPLEMENTS: string = "made|designed|available|included|listed|shown|intended|suited|used|from";

/**
 * Function words that cannot be the adjective a copula asserts. A noun
 * homograph such as "a clean look that fits" would otherwise be read as the
 * verb "look" asserting "that"; the same shape covers "a look of the kitchen".
 */
export const COPULA_NON_COMPLEMENTS: string = "that|which|who|whom|whose|of|for|in|on|at|and|or|but|with|to|as|by|near|over|under|into|onto|is|are|was|were|be|been|it|its|this|these|those|there";

/**
 * Relational nouns describe placement or purpose, not a product attribute, so
 * "each have a place" is idiomatic rather than a claim. Performance nouns
 * ("has a waterproof coating") are unaffected, and are additionally caught by
 * the hard-token rule.
 */
export const RELATIONAL_COMPLEMENTS: ReadonlySet<string> = new Set(["place", "places", "spot", "spots", "home", "role", "purpose", "use", "uses", "sense", "look", "looks", "feel", "way", "ways"]);

/**
 * Measurement participles only restate the size or weight the sentence has
 * already anchored to a confirmed numeric value. This is a deliberately tiny
 * closed set, not a general past-participle allowance.
 */
export const MEASUREMENT_PARTICIPLES: ReadonlySet<string> = new Set(["sized", "measured", "weighed"]);

/**
 * Enumeration vs absolute reading of a hard-vocabulary token.
 *
 * A hard word can be a count quantifier ("the pack holds four pieces in total") or an
 * absolute claim modifier ("total coverage"). The token list alone cannot tell them
 * apart, which is why benign quantity wording was reported as a hard claim.
 *
 * The reading is decided from the token's immediate context, so the rule is reusable
 * for any vocabulary token instead of being an exception for one word:
 *   enumeration <- "in <token>", "a <token> of", "<token> of", "<token>: 4", "<token> 4",
 *                  "<token> pack size / pieces / count / quantity / weight / ..."
 *   absolute    <- "<token> coverage / protection / control / satisfaction / ...": an
 *                  absolute head noun always wins, so real claims keep being reported.
 */
export const ABSOLUTE_HEAD_NOUNS: ReadonlySet<string> = new Set([
  "coverage", "protection", "control", "satisfaction", "experience", "quality", "performance",
  "value", "package", "solution", "system", "confidence", "assurance", "peace", "comfort",
  "safety", "security", "durability", "strength", "power", "support",
]);

export const MEASURE_HEAD_NOUNS: ReadonlySet<string> = new Set([
  "piece", "pieces", "pc", "pcs", "count", "quantity", "qty", "pack", "packs",
  "size", "sizes", "weight", "length", "width", "height", "dimensions", "capacity",
  "item", "items", "unit", "units",
]);

/**
 * The vocabulary words that also read as count quantifiers. Only these may be excused
 * by a following measure noun, because a performance word followed by a measure noun is
 * still a claim: "total pack size" is a count, "heavy weight" and "maximum capacity"
 * assert performance and must stay hard. The preposition and number frames below are
 * unambiguous for every token, so they are not restricted to this family.
 */
export const QUANTITY_QUANTIFIER_TOKENS: ReadonlySet<string> = new Set(["total", "complete", "fully", "always", "never", "only", "every", "all", "most", "best", "perfect"]);

// ===== M2/S4 WRITER PROMPT VOCABULARY =====
//
// Writer prompt 使用的三张词表（原硬编码于 lib/listingV5/generation.ts 的
// WRITER_SYSTEM_PROMPT）。M2 把它们收敛到本模块，使 Writer 与 Validator /
// Resolver 读取同一个声明来源。
//
// 本次为纯来源搬迁：writerVocabulary() 的元素与原文逐字相同，generation.ts 用它
// 拼出的 prompt 文本与搬迁前逐字节一致，因此 Writer 行为与 prompt 版本均不变。
// 注意：这三张表与 HARD_OR_ESCALATION_TOKENS 仍有已知差异（连字符、大小写、
// 词项增减），该分歧属 M3 的处理范围，M2 不做任何合并或改写。

/** NEVER INVENT（generation.ts:105），顺序与原文一致。 */
const WRITER_NEVER_INVENT_TERMS: readonly string[] = Object.freeze([
  "durable", "long-lasting", "heavy-duty", "leakproof", "spill-proof", "waterproof", "rustproof", "BPA-free", "food-safe", "non-toxic", "FDA approved", "dishwasher safe", "scratch resistant", "stain resistant", "odor resistant", "24-hour", "all-day cold"
]);

/**
 * BANNED VOCABULARY（generation.ts:106）的历史词表，顺序与 M2 搬迁前逐字一致。
 * 它不再是 Writer 的完整禁词集：M3a 起由下方 `uncoveredHardTokens()` 在其后补齐
 * Validator 已经在执行、但 prompt 从未告知的 hard token。
 */
const WRITER_BANNED_TERMS_BASE: readonly string[] = Object.freeze([
  "durable", "durability", "lasting", "leakproof", "spill-proof", "waterproof", "rustproof", "certified", "certification", "FDA", "approved", "non-toxic", "toxic", "BPA", "scratch", "odor", "resistant", "guaranteed", "unbreakable", "shatterproof", "tough", "strongest", "dishwasher", "safe", "cold", "hot", "warm", "hour", "hours", "minute", "minutes", "overnight", "freeze", "boil", "microwave", "bacteria", "mold", "insulated", "insulation", "high", "higher", "highest", "maximum", "extreme", "ultra", "super", "heavy", "duty", "professional", "industrial", "perfect", "best", "most", "complete", "total", "fully", "always", "never", "only", "every", "all"
]);

/** 归一化键：小写并去掉连字符与空白，使 "non-toxic" 与 token "nontoxic" 可比。 */
const coverageKey = (value: string) => value.toLowerCase().replace(/[-\s]+/g, "");

/**
 * Validator 的 hard token 中，尚未被历史 Writer 禁词覆盖的部分。
 *
 * 由 `HARD_OR_ESCALATION_TOKENS` **推导**而非手写清单：只有真正登记在硬词表里的
 * token 才可能被补进来，因此 `non` / `proof` 这类仅由连字符拆分产生的片段永远
 * 不会入选。遍历 Set 得到的是声明顺序，所以输出确定、可测试。
 */
function uncoveredHardTokens(): string[] {
  const covered = new Set<string>();
  for (const item of WRITER_BANNED_TERMS_BASE) {
    covered.add(coverageKey(item));
    for (const word of item.toLowerCase().split(/[-\s]+/)) covered.add(word);
  }
  return [...HARD_OR_ESCALATION_TOKENS].filter((token) => !covered.has(token));
}

/**
 * Writer 的完整禁词集：历史词表在前，补齐项按硬词表声明顺序追加。
 * M3a 只做补集合并 —— 不删除旧项、不放宽任何规则、不改动 Validator。
 */
const WRITER_BANNED_TERMS: readonly string[] = Object.freeze([
  ...WRITER_BANNED_TERMS_BASE,
  ...uncoveredHardTokens(),
]);

/** PERSUASION VOCABULARY（generation.ts:107），顺序与原文一致。 */
const WRITER_PERSUASION_TERMS: readonly string[] = Object.freeze([
  "easier", "simpler", "quicker", "tidier", "less guesswork", "one less thing to think about", "confidently compare", "ready for", "matches", "avoids", "saves a step"
]);

/** 生成 Writer prompt 片段的数据来源；纯函数，零依赖。 */
export function writerVocabulary(): {
  bannedUnlessFactBacked: readonly string[];
  persuasion: readonly string[];
  neverInvent: readonly string[];
} {
  return {
    bannedUnlessFactBacked: WRITER_BANNED_TERMS,
    persuasion: WRITER_PERSUASION_TERMS,
    neverInvent: WRITER_NEVER_INVENT_TERMS,
  };
}
