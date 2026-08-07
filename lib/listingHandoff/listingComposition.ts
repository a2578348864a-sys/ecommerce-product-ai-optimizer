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

import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

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
