/**
 * Listing Composition Layer（V2.1.5）
 *
 * 确定性 Listing 草稿组合层：事实决定结构，AI 只负责有限润色。
 *
 * 原则：
 * 1. 输入只有 confirmed product facts（product_fact + listing usageScope）；
 * 2. 输出结构完全由事实决定（Title/Bullets/Description/Keywords 组合规则固定）；
 * 3. 绝不引入未确认 benefit/功能/性能；
 * 4. 字段缺失时按已有字段组合，不补不存在信息；
 * 5. 禁止字段标签（品牌: / 商品类型:）作为内容；禁止泛化占位（日常使用的实用选择）。
 */

import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import {
  LISTING_COMPOSER_VERSION,
  LISTING_GENERATION_POLICY_VERSION,
  type ListingGenerationInput,
} from "@/lib/listingHandoff/listingGenerationInput";

export type ComposedListingDraft = {
  titles: string[];
  bullets: string[];
  description: string;
  keywords: string[];
};

/** 组合顺序：brand → series_or_model → capacity → material → product_type → color_or_variant */
const TITLE_FIELD_ORDER = [
  "brand",
  "series_or_model",
  "capacity",
  "material",
  "product_type",
  "color_or_variant",
] as const;

const BULLET_GROUPS: Array<{
  fields: readonly string[];
  join: string;
}> = [
  { fields: ["brand", "series_or_model", "product_type"], join: " " },
  { fields: ["material", "capacity"], join: " " },
  { fields: ["color_or_variant"], join: " " },
];

function factsOf(input: ListingGenerationInput, field: string): string | null {
  const fact = input.productFacts.find((f) => f.field === field);
  return fact && fact.value.trim() ? fact.value.trim() : null;
}

function hasAnyFact(input: ListingGenerationInput, fields: readonly string[]): boolean {
  return fields.some((f) => factsOf(input, f) !== null);
}

/** 组合一组事实值（跳过缺失） */
function joinFacts(input: ListingGenerationInput, fields: readonly string[], join: string): string | null {
  const values = fields.map((f) => factsOf(input, f)).filter((v): v is string => v !== null);
  return values.length > 0 ? values.join(join) : null;
}

/**
 * 组合 Title：
 * brand + series_or_model + capacity + material + product_type，末尾加 color。
 * 例：Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue
 */
function composeTitle(input: ListingGenerationInput): string {
  const core = joinFacts(input, ["brand", "series_or_model", "capacity", "material", "product_type"], " ");
  const color = factsOf(input, "color_or_variant");
  if (!core && !color) {
    // 无任何可组合事实（不应发生：调用方已保证至少 1 个 product_fact）
    return input.productFacts[0]?.value ?? "商品";
  }
  if (core && color) return `${core}, ${color}`;
  return core ?? color!;
}

/**
 * 组合 Bullets：多事实组合成自然短语（非字段打印）。
 * 组1: Owala FreeSip Water Bottle（品牌+系列+类型）
 * 组2: Stainless Steel 24 oz（材质+容量）
 * 组3: Out of the Blue（颜色）
 * 组4（可选）: 组合词（如 brand + product_type）
 */
function composeBullets(input: ListingGenerationInput): string[] {
  const bullets: string[] = [];
  for (const group of BULLET_GROUPS) {
    if (!hasAnyFact(input, group.fields)) continue;
    const composed = joinFacts(input, group.fields, group.join);
    if (composed) bullets.push(composed);
  }
  // 补充：若少于 1 条（理论上不可能），保底用第一个事实值
  if (bullets.length === 0 && input.productFacts.length > 0) {
    bullets.push(input.productFacts[0].value);
  }
  // 上限 5 条
  return bullets.slice(0, 5);
}

/**
 * Description：事实型自然描述（品牌+类型+系列+材质+容量+颜色）。
 * 不包含风格/功能臆造。
 */
function composeDescription(input: ListingGenerationInput): string {
  const brand = factsOf(input, "brand");
  const type = factsOf(input, "product_type");
  const series = factsOf(input, "series_or_model");
  const material = factsOf(input, "material");
  const capacity = factsOf(input, "capacity");
  const color = factsOf(input, "color_or_variant");

  const parts: string[] = [];
  if (brand) parts.push(brand);
  if (series) parts.push(series);
  if (capacity) parts.push(capacity);
  if (material) parts.push(material);
  if (type) parts.push(type);
  if (color) parts.push(color);

  if (parts.length === 0) return input.productFacts[0]?.value ?? "商品";
  return `${parts.join(" ")}。`;
}

/** Keywords：纯事实值（无字段标签，无市场指标）。 */
function composeKeywords(input: ListingGenerationInput): string[] {
  const values = new Set<string>();
  for (const field of TITLE_FIELD_ORDER) {
    const v = factsOf(input, field);
    if (v) values.add(v);
  }
  // 补充常见组合词（仅 confirmed facts 组合）
  const brand = factsOf(input, "brand");
  const type = factsOf(input, "product_type");
  if (brand && type) values.add(`${brand} ${type}`);
  return Array.from(values).slice(0, 12);
}

/**
 * 主入口：从 Listing Generation Input 生成确定性组合草稿。
 * 输入必须已通过 MARKET_SIGNAL 双保险（调用方保证），本层不额外校验。
 */
export function composeListingDraft(input: ListingGenerationInput): ComposedListingDraft {
  return {
    titles: [composeTitle(input)],
    bullets: composeBullets(input),
    description: composeDescription(input),
    keywords: composeKeywords(input),
  };
}

/**
 * V2.1.6 Listing 生产基础能力：只根据已确认事实构造完整、可校验、可保存的草稿。
 * AI 润色尚未启用，因此来源与 polish 元数据必须明确保持为纯 Composition。
 */
export function buildDeterministicListingPackDraft(
  input: ListingGenerationInput,
  generatedAt: string,
): AiListingPackDraft {
  const composed = composeListingDraft(input);
  return {
    source: "deterministic_composition_v1",
    version: 1,
    generatedAt,
    model: LISTING_COMPOSER_VERSION,
    composerVersion: LISTING_COMPOSER_VERSION,
    generationPolicyVersion: LISTING_GENERATION_POLICY_VERSION,
    polishApplied: false,
    polishModel: null,
    humanReviewRequired: true,
    titles: composed.titles,
    bullets: composed.bullets,
    description: composed.description,
    keywords: composed.keywords,
    sellingPoints: composed.bullets.slice(0, 6),
    riskNotes: ["商品信息来自已人工确认的事实，未包含未经验证的声明。"],
    complianceWarnings: [],
    blockedClaims: [],
    reviewChecklist: ["请人工核对事实字段与值后完善表达。"],
  };
}

/**
 * Quality.1：Plan-driven 组合（optimized 模式）。
 *
 * 与基础组合的区别：
 * - 使用 Listing Plan 的 bulletPlans（每条绑定 factId + shopperAngle）
 * - Bullet 表达为 "功能/事实 → 买方价值" 结构，不再只是属性词拼接
 * - Description 为完整句子（用途 + 关键功能 + 场景），不复制 Title
 * - Keywords 用 Keyword Brief（primary/supporting/backend），不从 facts 机械拆词
 *
 * 仍只使用已确认事实；禁止引入未确认 benefit/功能/性能。
 */

import type { ListingPlan } from "@/lib/listingHandoff/listingPlan";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

export type OptimizedListingDraft = {
  titles: string[];
  bullets: string[];
  description: string;
  keywords: string[];
  backendSearchTerms: string[];
};

function valueOf(input: ListingGenerationInput, field: string): string | null {
  const fact = input.productFacts.find((f) => f.field === field);
  return fact && fact.value.trim() ? fact.value.trim() : null;
}

/** 从 plan 的 featureFactIds（= fields）解析实际值 */
function planFactValues(input: ListingGenerationInput, factIds: string[]): string[] {
  const out: string[] = [];
  for (const id of factIds) {
    const v = valueOf(input, id);
    if (v) out.push(v);
  }
  return out;
}

/**
 * 组合 optimized Title：
 * primaryKeyword（合理时前置或纳入）或 Brand + Type 开头，
 * 后跟 1-3 关键属性；长度目标 60-100。
 */
function composeOptimizedTitle(input: ListingGenerationInput, plan: ListingPlan): string {
  const identity = ["brand", "series_or_model", "product_type"].map((f) => valueOf(input, f)).filter((v): v is string => v !== null);
  const specs = ["capacity", "material", "color_or_variant", "quantity_or_pack_size"].map((f) => valueOf(input, f)).filter((v): v is string => v !== null);
  let lead = identity.join(" ");
  // primaryKeyword 合理纳入：标题长度不足目标时，将主词并入高权重位置
  if (plan.primaryKeyword) {
    const keyword = plan.primaryKeyword;
    const keywordTokens = keyword.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const leadTokens = lead.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const alreadyCovered = keywordTokens.every((w) => leadTokens.includes(w));
    if (!alreadyCovered && lead.length + keyword.length <= 110) {
      lead = lead ? `${lead} ${keyword}` : keyword;
    } else if (lead.length === 0) {
      lead = keyword;
    }
  }
  const rest = specs.slice(0, 3).join(" ");
  const title = [lead, rest].filter(Boolean).join(" ");
  // 若超硬限，截断到 200
  return title.length > 200 ? title.slice(0, 197).trimEnd() + "..." : title;
}

/**
 * 组合 optimized Bullets：每条 = 事实值 + 买方价值角度。
 * 例如 fact="insulation" value="Double-wall insulation" → "Double-wall insulation，适合日常通勤保温。"
 * 所有表达只基于已确认事实值；shopperAngle 是评估性 framing（可接受），非虚构性能。
 */
function composeOptimizedBullets(input: ListingGenerationInput, plan: ListingPlan): string[] {
  const bullets: string[] = [];
  for (const bp of plan.bulletPlans) {
    const values = planFactValues(input, bp.featureFactIds);
    if (values.length === 0) continue;
    const feature = values.join(" · ");
    bullets.push(`${feature}，${bp.shopperAngle}。`);
  }
  return bullets.slice(0, 5);
}

/**
 * 组合 optimized Description：2-4 个完整句子。
 * 句1：产品身份（品牌+类型+系列）用途。
 * 句2：关键功能事实。
 * 句3：使用场景/买方价值（评估性，非虚构性能）。
 */
function composeOptimizedDescription(input: ListingGenerationInput, plan: ListingPlan): string {
  const identity = ["brand", "series_or_model", "product_type"].map((f) => valueOf(input, f)).filter((v): v is string => v !== null);
  const functional = plan.bulletPlans
    .flatMap((bp) => planFactValues(input, bp.featureFactIds))
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const specs = ["capacity", "material", "color_or_variant"].map((f) => valueOf(input, f)).filter((v): v is string => v !== null);

  const sentences: string[] = [];
  const identityText = identity.join(" ") || "商品";
  sentences.push(`${identityText}，适合日常使用。`);
  if (functional.length > 0) sentences.push(`关键特性包括${functional.slice(0, 3).join("、")}。`);
  if (specs.length > 0) sentences.push(`规格：${specs.slice(0, 4).join("、")}。`);
  if (plan.primaryKeyword) sentences.push(`适合搜索“${plan.primaryKeyword}”的用户。`);
  return sentences.slice(0, 4).join("");
}

/**
 * Keywords：使用 Keyword Brief（visible 词 + backend terms），
 * 不再从 confirmedFacts 机械拆词。
 */
function composeOptimizedKeywords(input: ListingGenerationInput, brief: ListingKeywordBrief | null): {
  keywords: string[];
  backendSearchTerms: string[];
} {
  if (!brief) {
    // 无 brief：退回基础组合（但标记 keywordReady=false 由调用方处理）
    const values = new Set<string>();
    for (const f of input.productFacts) values.add(f.value);
    return { keywords: Array.from(values).slice(0, 12), backendSearchTerms: [] };
  }
  const keywords: string[] = [];
  if (brief.primaryKeyword) keywords.push(brief.primaryKeyword);
  for (const s of brief.supportingKeywords) {
    if (!keywords.includes(s)) keywords.push(s);
  }
  // 补充身份词（品牌/类型组合），但去重
  const brand = valueOf(input, "brand");
  const type = valueOf(input, "product_type");
  if (brand && type && !keywords.includes(`${brand} ${type}`)) keywords.push(`${brand} ${type}`);
  return {
    keywords: keywords.slice(0, 12),
    backendSearchTerms: brief.backendSearchTerms,
  };
}

export function composeOptimizedListingDraft(
  input: ListingGenerationInput,
  plan: ListingPlan,
  brief: ListingKeywordBrief | null,
): OptimizedListingDraft {
  const title = composeOptimizedTitle(input, plan);
  const bullets = composeOptimizedBullets(input, plan);
  const description = composeOptimizedDescription(input, plan);
  const { keywords, backendSearchTerms } = composeOptimizedKeywords(input, brief);
  return { titles: [title], bullets, description, keywords, backendSearchTerms };
}
