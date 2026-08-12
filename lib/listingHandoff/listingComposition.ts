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

/** 中文字符检测：最终用户可见 Listing 字段不得含中文（Amazon US English-only 合同） */
const HAS_CJK = /[一-鿿㐀-䶿]/;

/** 中文标点检测：最终用户可见 Listing 字段不得含中文标点 */
const HAS_CJK_PUNCT = /[。，；：、！？]/;

/**
 * 取事实的英文渲染值（优先 englishRenderings，否则原值）。
 * 原始 fact/evidence 永不修改；渲染仅供用户可见字段使用。
 */
function renderingOf(input: ListingGenerationInput, field: string): string | null {
  const raw = factsOf(input, field);
  if (raw === null) return null;
  const rendering = input.englishRenderings?.renderings.find((r) => r.field === field);
  if (rendering && rendering.english.trim()) return rendering.english.trim();
  return raw;
}

/**
 * 组合 Bullets：每条一个已确认事实的英文渲染（自然英文表达，非字段打印）。
 * 中文 facts 经 English Rendering 转英文（factRef 溯源），不跳过。
 */
function composeBullets(input: ListingGenerationInput): string[] {
  const bullets: string[] = [];
  // 功能/操作/保养/结构/组件等事实：每条独立 bullet（英文渲染）
  for (const field of FUNCTIONAL_FIELDS) {
    const v = englishRenderingOf(input, field);
    if (v) bullets.push(endWithPeriod(v));
    if (bullets.length >= 5) break;
  }
  // 无功能事实：规格组组合句（identity / material+capacity / color），非字段打印
  if (bullets.length === 0) {
    const specGroups: Array<{ fields: readonly string[]; join: string }> = [
      { fields: ["brand", "series_or_model", "product_type"], join: " " },
      { fields: ["material", "capacity"], join: " " },
      { fields: ["color_or_variant"], join: " " },
    ];
    for (const group of specGroups) {
      if (bullets.length >= 3) break;
      const values = group.fields.map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
      if (values.length === 0) continue;
      bullets.push(endWithPeriod(values.join(group.join)));
    }
  }
  // 保底：第一个可英文渲染的事实
  if (bullets.length === 0 && input.productFacts.length > 0) {
    const first = input.productFacts.find((f) => englishRenderingOf(input, f.field) !== null);
    if (first) bullets.push(endWithPeriod(englishRenderingOf(input, first.field)!));
  }
  return bullets.slice(0, 5);
}

/** 句尾归一：渲染值可能自带英文句号（.），不重复追加 */
function endWithPeriod(s: string): string {
  return s.replace(/[.\s]+$/, "") + ".";
}

/**
 * 组合 Description（English-only）：
 * 结构：身份句 + 功能句（各 functional fact 英文渲染，独立成句）+ 规格句。
 * 中文 facts 经 English Rendering 转英文（factRef 溯源），不跳过、不丢事实。
 * 不包含模板填充语；禁止事实粘连（每句独立，用英文句号分隔）。
 */
function composeDescription(input: ListingGenerationInput): string {
  const brand = renderingOf(input, "brand");
  const type = renderingOf(input, "product_type");
  const series = renderingOf(input, "series_or_model");
  const material = renderingOf(input, "material");
  const capacity = renderingOf(input, "capacity");
  const color = renderingOf(input, "color_or_variant");
  const functionalFacts = FUNCTIONAL_FIELDS
    .map((f) => englishRenderingOf(input, f))
    .filter((v): v is string => v !== null);

  const sentences: string[] = [];
  // 句1：身份（英文）
  const identityParts: string[] = [];
  if (brand) identityParts.push(brand);
  if (series) identityParts.push(series);
  if (type) identityParts.push(type);
  if (identityParts.length > 0) {
    sentences.push(endWithPeriod(identityParts.join(" ")));
  }
  // 句2：功能（每条英文渲染独立成句，自然英文；不丢事实，全部列出）
  if (functionalFacts.length > 0) {
    sentences.push(...functionalFacts.map(endWithPeriod));
  }
  // 句3：规格（英文标签；分隔用逗号；含尺寸/重量渲染）
  const specParts: string[] = [];
  if (capacity) specParts.push(`Capacity: ${capacity}`);
  if (material) specParts.push(`Material: ${material}`);
  if (color) specParts.push(`Color: ${color}`);
  const dimensions = renderingOf(input, "dimensions");
  const weight = renderingOf(input, "weight");
  if (dimensions) specParts.push(`Dimensions: ${dimensions}`);
  if (weight) specParts.push(`Weight: ${weight}`);
  if (specParts.length > 0) {
    sentences.push(endWithPeriod(specParts.join(", ")));
  }

  if (sentences.length === 0) return input.productFacts[0]?.value ?? "Product";
  return sentences.join(" ");
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
  // primaryKeyword 合理纳入：标题长度不足目标时，将主词并入高权重位置。
  // R3：无确认事实证据的 keyword（如 "insulated water bottle" 中 insulated）不得并入标题——
  // 否则标题超长且含未确认声明，structured fallback 会因此整体降级。
  if (plan.primaryKeyword) {
    const keyword = plan.primaryKeyword;
    const keywordTokens = keyword.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const leadTokens = lead.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const factValues = input.productFacts.map((f) => f.value.toLocaleLowerCase()).join(" ");
    const keywordCoveredByFacts = keywordTokens.length > 0 && keywordTokens.every((w) => factValues.includes(w));
    const alreadyCovered = keywordTokens.every((w) => leadTokens.includes(w));
    if (keywordCoveredByFacts && !alreadyCovered && lead.length + keyword.length <= 110) {
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
 * English-only：跳过含中文字符的事实值；不添加模板填充语。
 * 所有表达只基于已确认事实值；shopperAngle 是评估性 framing（可接受），非虚构性能。
 */
const FUNCTIONAL_FIELDS = ["functional_feature", "operation", "usage", "care", "construction", "compatibility", "included_components", "other", "drinking_mechanism", "insulation", "lid_behavior", "cleaning"] as const;

/** 英文渲染且无中文/中文标点（可进用户可见字段） */
function englishRenderingOf(input: ListingGenerationInput, field: string): string | null {
  const v = renderingOf(input, field);
  return v !== null && !HAS_CJK.test(v) && !HAS_CJK_PUNCT.test(v) ? v : null;
}

function composeOptimizedBullets(input: ListingGenerationInput, plan: ListingPlan): string[] {
  const bullets: string[] = [];
  // R3.2：功能类事实各占一条独立 bullet（自然英文句）；spec 碎片（"Stainless Steel."）不进 bullet。
  for (const field of FUNCTIONAL_FIELDS) {
    const v = englishRenderingOf(input, field);
    if (v) bullets.push(endWithPeriod(v));
    if (bullets.length >= 5) break;
  }
  // 功能不足：spec 组合句补足（identity / material+capacity / color），非字段打印、非逗号碎片。
  if (bullets.length < 3) {
    const specGroups: Array<{ fields: readonly string[]; join: string }> = [
      { fields: ["brand", "series_or_model", "product_type"], join: " " },
      { fields: ["material", "capacity"], join: " " },
      { fields: ["color_or_variant"], join: " " },
    ];
    for (const group of specGroups) {
      if (bullets.length >= 5) break;
      const values = group.fields.map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
      if (values.length === 0) continue;
      bullets.push(endWithPeriod(values.join(group.join)));
    }
  }
  return bullets.slice(0, 5);
}

/**
 * 组合 optimized Description：身份句 + 全部功能句 + 完整规格句（含 dimensions/weight）。
 * R3.2：中文/混合事实已英文化，全部保留；无逗号碎片、无模板填充。
 */
function composeOptimizedDescription(input: ListingGenerationInput): string {
  const identity = ["brand", "series_or_model", "product_type"].map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
  const functional = FUNCTIONAL_FIELDS.map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
  const specParts: string[] = [];
  const capacity = englishRenderingOf(input, "capacity");
  const material = englishRenderingOf(input, "material");
  const color = englishRenderingOf(input, "color_or_variant");
  const dimensions = englishRenderingOf(input, "dimensions");
  const weight = englishRenderingOf(input, "weight");
  if (capacity) specParts.push(`Capacity: ${capacity}`);
  if (material) specParts.push(`Material: ${material}`);
  if (color) specParts.push(`Color: ${color}`);
  if (dimensions) specParts.push(`Dimensions: ${dimensions}`);
  if (weight) specParts.push(`Weight: ${weight}`);

  const sentences: string[] = [];
  const identityText = identity.join(" ") || "Product";
  sentences.push(endWithPeriod(identityText));
  sentences.push(...functional.map(endWithPeriod));
  if (specParts.length > 0) sentences.push(endWithPeriod(specParts.join(", ")));
  return sentences.join(" ");
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
    // 无 Keyword Brief：正文可以由确认事实生成，但 SEO 词必须保持为空，不能从 facts 自动拆词。
    return { keywords: [], backendSearchTerms: [] };
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
  const description = composeOptimizedDescription(input);
  const { keywords, backendSearchTerms } = composeOptimizedKeywords(input, brief);
  return { titles: [title], bullets, description, keywords, backendSearchTerms };
}
