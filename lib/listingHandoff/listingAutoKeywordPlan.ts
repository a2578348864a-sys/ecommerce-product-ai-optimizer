/**
 * 轮 16：自动关键词计划（auto_suggested）。
 *
 * 从已保存的 SellerSprite keywordEvidence（经 creativeContext.keywordCandidates）派生
 * 一次性 SEO 参考词计划：1 主词 + 2–5 辅助词 + ≤10 后台词。
 *
 * 安全规则：
 * - 纯函数；不写任何 DB；同输入同输出。
 * - 关键词只是 SEO 参考，不是商品事实（禁止进入 confirmed facts）。
 * - 属性词（材质/容量/尺寸/功能/认证等）必须能在 confirmedFacts 中找到对应事实，
 *   否则丢弃（防止把"stainless steel"当卖点但商品材质未确认）。
 * - 最高级/疗效/绝对承诺（best/guaranteed/effective/medical 等）拒绝。
 * - 目标商品品牌词、竞品品牌词、明显无关词拒绝。
 * - 有人工 Keyword Brief 时人工优先（调用方保证），本模块仅供无 Brief 回退。
 */

export type AutoKeywordPlan = {
  source: "auto_suggested";
  primaryKeyword: string;
  supportingKeywords: string[];
  backendSearchTerms: string[];
  /** 可追溯来源（keywordEvidence 行号 -> 词），供 UI 展示与审计 */
  provenance: Array<{ keyword: string; source: string; rowNumber: number | null; capturedAt: string | null }>;
  /** 被拒绝的词与原因（UI 展示"本次未采用"） */
  rejected: Array<{ keyword: string; reason: string }>;
};

export type AutoKeywordPlanInput = {
  /** creativeContext.keywordCandidates（observed 关键词证据） */
  keywordCandidates: string[];
  /** 目标商品已确认事实（field -> value 小写） */
  confirmedFacts: Array<{ field: string; label: string; value: string }>;
  /** 目标商品品牌（小写；来自 brand fact） */
  ownBrand: string;
  /** 竞品品牌/系列（小写；来自 competitiveContext 与关键词分析，尽量剔除） */
  knownBrands: string[];
};

const ATTRIBUTE_WORDS = [
  "stainless", "steel", "plastic", "glass", "ceramic", "silicone",
  "18oz", "24oz", "32oz", "oz", "liter", "ml", "lb", "pound", "gram",
  "slices", "slice", "capacity", "qt", "cup",
  "electric", "rechargeable", "cordless", "wireless",
  "certified", "approved", "fda", "bpa", "ect", "ce", "rohs", "ul",
] as const;

const FORBIDDEN_CLAIM = [
  "best", "guaranteed", "guarantee", "effective", "medical", "therapeutic",
  "cure", "heal", "safest", "premium-quality", "no.1", "number one", "top-rated",
] as const;

const COMMON_PRODUCT_WORDS = [
  "toaster", "bottle", "scale", "whisk", "cup", "mug", "jar", "box", "container",
  "pot", "pan", "kettle", "teacher", "kitchen", "cooking", "baking", "drinking",
  "travel", "home", "portable", "outdoor", "sports", "fitness",
] as const;

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** 单位归一化（oz/ounce/ounces/ml/liter/lb/… → 统一形态），使属性词与已确认事实值可匹配 */
function unitCanon(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/\b(\d+)\s*(ounces?|oz)\b/g, "$1 oz")
    .replace(/\b(\d+)\s*(gallons?|gal)\b/g, "$1 gal")
    .replace(/\b(\d+)\s*(milliliters?|ml)\b/g, "$1 ml")
    .replace(/\b(\d+)\s*(liters?|l)\b/g, "$1 l")
    .replace(/\b(\d+)\s*(pounds?|lb)\b/g, "$1 lb")
    .replace(/\b(\d+)\s*(kilograms?|kg)\b/g, "$1 kg")
    .replace(/\b(\d+)\s*(grams?|g)\b/g, "$1 g")
    .replace(/\b(\d+)\s*(inches?|in)\b/g, "$1 in")
    .replace(/\b(\d+)\s*(centimeters?|cm)\b/g, "$1 cm")
    .replace(/\b(\d+)\s*(millimeters?|mm)\b/g, "$1 mm")
    .replace(/\b(\d+)\s*(qt|cups?)\b/g, "$1 qt");
}

function hasAnyWord(phrase: string, words: readonly string[]): boolean {
  const p = norm(phrase);
  return words.some((w) => p.includes(norm(w)));
}

/** 属性词必须在 confirmedFacts 中有对应事实（材质/容量/尺寸/功能等） */
function attributeSupported(keyword: string, facts: AutoKeywordPlanInput["confirmedFacts"]): boolean {
  const kw = unitCanon(norm(keyword));
  const factValues = facts
    .map((f) => unitCanon(norm(f.value)))
    .filter(Boolean);
  // 关键词含属性词时，该属性词必须出现在某个已确认事实值中（单位归一化后匹配）
  return ATTRIBUTE_WORDS.some((attr) => {
    const a = unitCanon(norm(attr));
    if (!a || !kw.includes(a)) return false;
    return factValues.some((fv) => fv.includes(a));
  });
  // 注意：无属性词的普通类目词不受此限制（如 toaster / 2 slice toaster 若 2 slice 无事实则被拒）
}

function isForbiddenClaim(keyword: string): boolean {
  return hasAnyWord(keyword, FORBIDDEN_CLAIM);
}

function isBrandTerm(keyword: string, ownBrand: string, knownBrands: string[]): boolean {
  const kw = norm(keyword);
  if (!kw) return false;
  const brands = [ownBrand, ...knownBrands].map(norm).filter(Boolean);
  return brands.some((b) => kw.includes(b) || kw === b);
}

/** 主词：优先最宽泛的类目词（普通商品类型词）；否则第一个无属性/无品牌的合格词。 */
export function buildAutoKeywordPlan(input: AutoKeywordPlanInput): AutoKeywordPlan {
  const candidates = input.keywordCandidates.filter((k) => typeof k === "string" && k.trim().length > 0);
  const unique = Array.from(new Set(candidates.map((k) => k.trim())));

  const accepted: string[] = [];
  const rejected: Array<{ keyword: string; reason: string }> = [];

  for (const kw of unique) {
    // 1. 品牌/最高级/疗效 → 拒绝
    if (isBrandTerm(kw, input.ownBrand, input.knownBrands)) { rejected.push({ keyword: kw, reason: "品牌词" }); continue; }
    if (isForbiddenClaim(kw)) { rejected.push({ keyword: kw, reason: "绝对/疗效承诺" }); continue; }
    // 2. 属性词须有对应事实
    if (hasAnyWord(kw, ATTRIBUTE_WORDS) && !attributeSupported(kw, input.confirmedFacts)) {
      rejected.push({ keyword: kw, reason: "属性词无对应已确认事实" }); continue;
    }
    accepted.push(kw);
  }

  // 主词：优先 COMMON_PRODUCT_WORDS 中最宽泛的（词数最少、无属性词的类目词）；
  // 词数相同取更简洁的一个（先出现的保留稳定），避免 "kitchen toaster" 抢占 "toaster"。
  let primaryKeyword = "";
  const generic = accepted
    .filter((k) => hasAnyWord(k, COMMON_PRODUCT_WORDS))
    .sort((a, b) => norm(a).split(" ").filter(Boolean).length - norm(b).split(" ").filter(Boolean).length);
  if (generic.length > 0) {
    primaryKeyword = generic[0];
  } else if (accepted.length > 0) {
    primaryKeyword = accepted[0];
  }

  const supportingKeywords = accepted
    .filter((k) => k !== primaryKeyword)
    .slice(0, 5);

  const backendSearchTerms = accepted.slice(0, 10);

  const provenance = accepted.map((k) => ({
    keyword: k,
    source: "keywordEvidence",
    rowNumber: null,
    capturedAt: null,
  }));

  return {
    source: "auto_suggested",
    primaryKeyword,
    supportingKeywords,
    backendSearchTerms: backendSearchTerms.slice(0, 10),
    provenance,
    rejected,
  };
}
