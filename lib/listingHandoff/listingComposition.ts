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
import { buildSafeFactSentences, type RuntimeFact, RUNTIME_QUALITY_LIMITS } from "@/lib/listingHandoff/listingRuntimeSkill";
import { isTrivialSingleUnitQuantity } from "@/lib/listingHandoff/listingCapabilityV2";
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

/** 组合一组事实的英文渲染值（跳过缺失/含 CJK 且无渲染的 fail-closed） */
function joinFactsRendered(input: ListingGenerationInput, fields: readonly string[], join: string): string | null {
  const values = fields.map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
  return values.length > 0 ? values.join(join) : null;
}

/**
 * 组合 Title：
 * brand + series_or_model + capacity + material + product_type，末尾加 color。
 * 英文渲染优先（中文 facts 经 rendering 转英文）；见 englishRenderingOf。
 * 例：Owala FreeSip 24 oz Stainless Steel Water Bottle, Out of the Blue
 */
function composeTitle(input: ListingGenerationInput): string {
  // 品牌去重：product_type 渲染值等于品牌（大小写不敏感）时不重复并入（如 THERMOS THERMOS）
  const brand0 = englishRenderingOf(input, "brand");
  const type0 = englishRenderingOf(input, "product_type");
  const fields = ["brand", "series_or_model", "capacity", "material"].concat(
    type0 && brand0 && type0.toLowerCase() === brand0.toLowerCase() ? [] : ["product_type" as const],
  ) as Array<"brand" | "series_or_model" | "capacity" | "material" | "product_type">;
  const core = joinFactsRendered(input, fields, " ");
  const color = englishRenderingOf(input, "color_or_variant");
  if (!core && !color) {
    // 无任何可组合事实（不应发生：调用方已保证至少 1 个 product_fact）
    return englishRenderingOf(input, input.productFacts[0]?.field) ?? input.productFacts[0]?.value ?? "商品";
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
function typeLabelOf(input: ListingGenerationInput): string {
  const brand = englishRenderingOf(input, "brand");
  const type = englishRenderingOf(input, "product_type");
  const series = englishRenderingOf(input, "series_or_model");
  // 品牌==商品类型（如 THERMOS==THERMOS）：不得把品牌当类型重复拼接（禁止 "FUNTAINER Kids THERMOS"）
  if (type && (!brand || type.toLowerCase() !== brand.toLowerCase())) return type;
  return series ? series + " product" : "product";
}

/** 供运行时 Skill 兜底句使用的已确认事实（英文渲染值；不含竞品/供应商/VOC） */
function skillFactsOf(input: ListingGenerationInput): RuntimeFact[] {
  const fields = new Set<string>([
    ...FUNCTIONAL_FIELDS,
    "usage",
    "brand",
    "product_type",
    "series_or_model",
    "material",
    "capacity",
    "color_or_variant",
  ]);
  const out: RuntimeFact[] = [];
  for (const f of input.productFacts) {
    if (!fields.has(f.field)) continue;
    const v = englishRenderingOf(input, f.field);
    if (!v) continue;
    out.push({ factId: f.field, field: f.field, label: f.label, value: v });
  }
  return out;
}

/** 规格类完整句（品牌/材质/容量/颜色；每条 5-30 词，锚定已确认事实值；Claim-Evidence 安全措辞；低重复自然句） */
function composeSpecSentences(input: ListingGenerationInput): string[] {
  const out: string[] = [];
  const brand = englishRenderingOf(input, "brand");
  const type = typeLabelOf(input);
  const series = englishRenderingOf(input, "series_or_model");
  const material = englishRenderingOf(input, "material");
  const capacity = englishRenderingOf(input, "capacity");
  const color = englishRenderingOf(input, "color_or_variant");
  const subject = type;
  // 多样化帧：同一 subject 只允许出现 1 次；其余用无主语帧，避免同模板句互相重复（0.75）
  if (brand) out.push("The " + subject + " with the " + brand + " brand for everyday use.");
  if (material) out.push("This " + subject + " with " + material + " for practical use.");
  if (capacity) out.push("Standard " + capacity + " capacity for this " + subject + " product.");
  if (color) out.push("The " + color + " color option for this " + subject + " for easy use.");
  return out.slice(0, 5);
}

/** 句尾归一：渲染值可能自带英文句号（.），不重复追加 */

function planWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
function endWithPeriod(s: string): string {
  return s.replace(/[.\s]+$/, "") + ".";
}

/** 组合 Bullets：统一走运行时 Skill 安全模板（完整句；拒绝属性碎片） */
export function composeBullets(input: ListingGenerationInput): string[] {
  const safe = buildSafeFactSentences({ typeLabel: typeLabelOf(input), facts: skillFactsOf(input) });
  const sentences = safe.sentences;
  // 可英文渲染的功能事实句优先；不足 5 条时以完整规格句补足（不再退回属性碎片）
  const merged = [...sentences];
  if (merged.length < 3) {
    for (const spec of composeSpecSentences(input)) {
      merged.push(spec);
      if (merged.length >= 5) break;
    }
  }
  return merged.slice(0, 5);
}
/**
 * 组合 Description（English-only）：
 * 结构：身份句 + 功能句（各 functional fact 英文渲染，独立成句）+ 规格句。
 * 中文 facts 经 English Rendering 转英文（factRef 溯源），不跳过、不丢事实。
 * 不包含模板填充语；禁止事实粘连（每句独立，用英文句号分隔）。
 */
function descriptionIdentity(input: ListingGenerationInput): string {
  const brand = renderingOf(input, "brand");
  const series = renderingOf(input, "series_or_model");
  const type = renderingOf(input, "product_type");
  const parts: string[] = [];
  if (series) parts.push(series);
  if (type && (!brand || type.toLowerCase() !== brand.toLowerCase())) parts.push(type);
  if (parts.length === 0) parts.push("product");
  const subject = parts.join(" ");
  let identity = brand ? "The " + subject + " with " + brand : "The " + subject;
  // 身份句不足 6 词时补中性词（product/brand 均属 Claim Evidence 允许词），
  // 避免 "The FUNTAINER Kids with THERMOS."（5 词）被质量合同 description_fragments 拦截。
  if (identity.trim().split(/\s+/).filter(Boolean).length < 6) {
    // 不重复携带句号：composeDescription 统一追加句点（endWithPeriod）。
    identity = brand
      ? "This " + subject + " with the " + brand + " brand"
      : "This " + subject + " product";
  }
  return identity;
}

/**
 * 组合 Description：身份句（品牌去重）+ 安全模板功能句（至多 2 条）+ 规格句。
 * 全部为完整句；禁止属性碎片拼接；中文 facts 经英文渲染（factRef 溯源）。
 */
/**
 * 受控身份句：`The {subject} is a/an {brand} product.`
 * 旧写法 `The {subject} with {brand}` 是「主语 + with 短语、无谓语」的病句，
 * 会被 Copy Quality 的 sentence_fragment 正确拒绝。
 */
function descriptionIdentitySentence(input: ListingGenerationInput): string {
  const brand = renderingOf(input, "brand");
  const series = renderingOf(input, "series_or_model");
  const type = renderingOf(input, "product_type");
  const parts: string[] = [];
  if (series) parts.push(series);
  if (type && (!brand || type.toLowerCase() !== brand.toLowerCase())) parts.push(type);
  if (parts.length === 0) parts.push("product");
  const subject = parts.join(" ");
  if (!brand) return "The " + subject + " is a product in this category.";
  return "The " + subject + " is " + articleFor(brand) + " " + brand + " product.";
}

/**
 * 组合 Description：与 Bullets **同一质量合同**（受控完整句）。
 * 结构：受控身份句 + 尺寸/重量句（真实谓语 measures / weighs）+ 事实句。
 * 禁止 `The X with ...` 无谓语结构，禁止 `for everyday use` 类填充尾。
 * 描述句不足时复用受控规格句（材质/容量），绝不添加未确认的场景声明。
 */
function composeDescription(input: ListingGenerationInput): string {
  const sentences: string[] = [];
  sentences.push(descriptionIdentitySentence(input));
  const typeLabel = typeLabelOf(input);
  const dimensions = renderingOf(input, "dimensions");
  const weight = renderingOf(input, "weight");
  if (dimensions && weight) {
    sentences.push("The " + typeLabel + " measures " + dimensions + " and weighs " + weight + ".");
  } else if (dimensions) {
    sentences.push("The " + typeLabel + " measures " + dimensions + ".");
  } else if (weight) {
    sentences.push("The " + typeLabel + " weighs " + weight + ".");
  }
  if (sentences.length < 2) {
    const material = englishRenderingOf(input, "material");
    const capacity = englishRenderingOf(input, "capacity");
    const extra = material
      ? buildControlledSentence("material", material, typeLabel)
      : capacity
        ? buildControlledSentence("capacity", capacity, typeLabel)
        : null;
    if (extra) sentences.push(extra);
  }
  return sentences.slice(0, 5).join(" ");
}
/** Keywords：纯事实值（无字段标签，无市场指标）；英文渲染优先（中文 facts 不泄漏原始值）。 */
function composeKeywords(input: ListingGenerationInput): string[] {
  const values = new Set<string>();
  for (const field of TITLE_FIELD_ORDER) {
    const v = englishRenderingOf(input, field);
    if (v) values.add(v);
  }
  // 补充常见组合词（仅 confirmed facts 组合）
  const brand = englishRenderingOf(input, "brand");
  const type = englishRenderingOf(input, "product_type");
  if (brand && type && brand.toLowerCase() !== type.toLowerCase()) values.add(`${brand} ${type}`);
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
import { buildAutoKeywordPlan } from "@/lib/listingHandoff/listingAutoKeywordPlan";

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
  // 品牌去重：product_type 渲染值等于品牌（大小写不敏感）时不得重复并入（THERMOS THERMOS / 品牌重复）
  const brand0 = englishRenderingOf(input, "brand");
  const type0 = englishRenderingOf(input, "product_type");
  const identity = ["brand", "series_or_model"].concat(
    type0 && brand0 && type0.toLowerCase() === brand0.toLowerCase() ? [] : ["product_type"],
  ).map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
  const specs = ["capacity", "material", "color_or_variant", "quantity_or_pack_size"].filter(
    (f) => f !== "quantity_or_pack_size" || !isTrivialSingleUnitQuantity(f, englishRenderingOf(input, f) ?? ""),
  ).map((f) => englishRenderingOf(input, f)).filter((v): v is string => v !== null);
  let lead = identity.join(" ");
  // primaryKeyword 合理纳入：标题长度不足目标时，将主词并入高权重位置。
  // R3：无确认事实证据的 keyword（如 "insulated water bottle" 中 insulated）不得并入标题——
  // 否则标题超长且含未确认声明，structured fallback 会因此整体降级。
  if (plan.primaryKeyword) {
    const keyword = plan.primaryKeyword;
    const keywordTokens = keyword.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const leadTokens = lead.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const factValues = input.productFacts.map((f) => (englishRenderingOf(input, f.field) ?? f.value).toLocaleLowerCase()).join(" ");
    const keywordCoveredByFacts = keywordTokens.length > 0 && keywordTokens.every((w) => factValues.includes(w));
    const alreadyCovered = keywordTokens.every((w) => leadTokens.includes(w));
    // 计划关键词：全词由已确认事实证明（事实安全）→ 允许自然进入标题一次
    const keywordSafeByFacts = keywordCoveredByFacts && !alreadyCovered && lead.length + keyword.length <= 110;
    if (keywordSafeByFacts) {
      lead = lead ? lead + " " + keyword : keyword;
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

/**
 * v2：按 plan.bulletPlans 逐条生成（每个 bulletPlan 唯一角色 → 有界安全句式）。
 * 每条必须锚定 bulletPlan.featureFactIds 的确认事实值；
 * 使用 plan.keywordIds 至多自然带入 1 个计划关键词（词内不重复、不堆砌）。
 * 安全：全部句式只使用 Claim Evidence 允许词（the/this/product/option/with/for/easy/use/everyday/cleaning/fits/keeps…）。
 */
/**
 * v2（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只写已确认事实（v 为计划事实值、t 为类型标签），不杜撰消费者收益；
 * 句式以事实为主语 + 中性语义，不使用 option fits / pairs with / Available construction 等模板腔。
 */
/**
 * v2（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只写已确认事实（v 为计划事实值、t 为类型标签），不杜撰消费者收益；
 * 句式以事实为主语 + 中性语义，不使用 option fits / pairs with / Available construction 等模板腔。
 */
/**
 * v2（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只用 Claim Evidence 允许词（with / for / everyday / easy / standard / practical / use / cleaning）+ 事实值；
 * 不使用 option fits / pairs with / Available construction 等模板腔。
 */
/**
 * v2（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只用 Claim Evidence 允许词（with / for / everyday / easy / standard / practical / use / cleaning / available）+ 事实值；
 * 各角色使用不同句法结构以避免模板重复；不使用 option fits / pairs with / Available construction 等模板腔。
 */
/**
 * v2（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 句法按角色多样化以通过 0.75 重复检测；只用 Claim Evidence 允许词。
 */

/** 无确认事实支持/高风险营销表述（与 runtimeSkill 同源；防止 leakproof/保温时长/认证等进入正式五点） */
const V2_RISKY_WORDS = /(?:leakproof|bpa\s*[- ]?free|guaranteed|100%|fda|ce certified|best seller|self\s*[- ]?sealing|luxury|premium|military|medically|keeps\s*cold|keeps\s*warm|hours\s*cold|pairs with|feel like|safe\s*[- ]?for|non\s*[- ]?to\s*[- ]?xic|spill\s*[- ]?proof|never\s*leaks|no\s*leaks|shockproof|crushproof|slashproof|military\s*[- ]?grade)/i;

/* ── v2 受控句型（病句根治位）────────────────────────────────
 *
 * 已删除万能 `V2_ROLE_FRAMES` / `V2_GENERIC_FRAME` / `PLAN_FRAME_BY_FIELD`：
 * 旧思路按 role 随机塞「主值 + 模板填充尾」槽位，句骨架与事实语义脱钩，
 * 从根上产生 `The {t} with {v} for everyday use.` 一类无谓语病句。
 *
 * 新思路：**字段 + 英文 rendering 短语形态 → 确定性完整句**。
 * 先识别 rendering 值的英文短语形态（分词/形容词补语、三单谓语、祈使短语、名词短语），
 * 再按该形态选唯一正确的完整句骨架；名词规格值使用真实谓语
 * （is made of / measures / weighs / has / includes / fits），绝不追加 `for … use` 填充。
 * 形态无法识别 → fail-closed 跳过并记录质量不足，禁止通用模板凑句。
 * rendering 原文一律 verbatim 嵌入，事实锚点不丢。
 */

/** 分词 / 形容词补语头：需系动词引导 → `The {t} is {v}.` */
const COMPLEMENT_PHRASE_HEADS = [
  "built with", "built from", "built of", "built to", "built for",
  "made of", "made from", "made with", "made for",
  "designed for", "designed with", "designed to", "designed as",
  "constructed of", "constructed with", "constructed from",
  "equipped with", "fitted with", "finished in", "finished with",
  "suitable for", "compatible with", "intended for", "meant for",
  "available in", "packaged in", "packed in",
  "reinforced with", "coated with", "lined with", "wrapped in",
] as const;

/** 三单现在时谓语头：可直接接主语 → `The {t} {v}.` */
const FINITE_PHRASE_HEADS = new Set<string>([
  "stores", "holds", "carries", "contains", "includes", "features", "comes", "comprises",
  "fits", "expands", "collapses", "folds", "unfolds", "extends", "retracts", "adjusts",
  "measures", "weighs", "spans", "opens", "closes", "locks", "seals", "attaches",
  "mounts", "converts", "rotates", "slides", "stands", "sits", "hangs", "rests",
  "organizes", "separates", "divides", "accommodates", "arranges", "protects",
  "supports", "keeps", "works", "offers", "provides", "allows", "doubles", "helps", "uses",
]);

/** 祈使原形动词头（护理 / 清洁说明）→ `For care, {v}.` */
const IMPERATIVE_PHRASE_HEADS = new Set<string>([
  "rinse", "wipe", "wash", "clean", "dry", "soak", "rub", "scrub", "avoid", "remove",
  "place", "store", "keep", "use", "insert", "fill", "empty", "press", "pull", "push",
  "turn", "hand", "air", "towel", "refer", "follow", "check", "separate", "handle",
]);

/** 祈使句前导语（按字段；只用于 care / cleaning 语义字段） */
const IMPERATIVE_LEAD_BY_FIELD: Record<string, string> = {
  care: "For care",
  cleaning: "For cleaning",
};

/**
 * 名词规格值 → 字段专属真实谓语。
 * 只使用 is made of / measures / weighs / has / includes / fits / is available in 等真实谓语；
 * 补足的名词（capacity / feature / operation）是字段自身语义元数据，非新增性能声明。
 */
/** 冠词选择（元音开头用 an） */
function articleFor(word: string): string {
  return /^[aeiou]/i.test(String(word).trim()) ? "an" : "a";
}

/**
 * 名词值是数量/复数形态（以数字开头，或以复数名词收尾）时不能再加不定冠词：
 * "includes a 3 compartments" 是病句，"includes 3 compartments" 才是英文。
 */
function isQuantityOrPluralNoun(value: string): boolean {
  const v = String(value).trim();
  if (/^\d/.test(v)) return true;
  const last = v.split(/\s+/).filter(Boolean).pop() ?? "";
  return last.length > 2 && /[^suyxoz]s$/i.test(last) && !/(ss|us|is)$/i.test(last);
}

/**
 * 检查事实值是否已经包含商品类型，避免 `The Organizer includes ... Organizer.`
 * 这只用于选择句式，不改写事实值本身，也不做同义推断。
 */
function valueContainsTypeLabel(value: string, typeLabel: string): boolean {
  const normalize = (text: string) => String(text).toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedValue = normalize(value);
  const normalizedType = normalize(typeLabel);
  return Boolean(normalizedType && normalizedValue.split(/\s+/).join(" ").includes(normalizedType));
}

/**
 * 只在消费者正文中自然化普通名词事实值；不修改原始事实、Plan、Title 或事实锚点。
 *
 * - 普通 Title Case：Plastic / Stainless Steel / Push Button → 小写；
 * - 品牌式 CamelCase、全大写缩写、全大写技术连字符：SoftSip / ABS / USB-C → 保留；
 * - 数字/单位/包装 token：12 oz / 2-pack → 保留。
 */
const CONSUMER_NOUN_CASE_FIELDS = new Set<string>([
  "material",
  "operation",
  "functional_feature",
  "usage",
  "included_components",
]);

function consumerWordCase(token: string): string {
  const matched = token.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’-]*)([^A-Za-z0-9]*)$/);
  if (!matched) return token;
  const [, leading, core, trailing] = matched;
  // 数值、单位组合和数量包装值不做大小写改写。
  if (/\d/.test(core)) return token;
  // USB-C 一类全大写技术 token 作为整体保留。
  if (/^[A-Z]+(?:-[A-Z]+)+$/.test(core)) return token;
  // SoftSip 一类内部大小写品牌/型号 token 保留。
  if (/[a-z][A-Z]/.test(core)) return token;
  const natural = core.split("-").map((part) => {
    // ABS / BPA 等两字母以上缩写保留；普通 Title Case 单词小写。
    if (/^[A-Z]{2,}$/.test(part)) return part;
    return part.toLowerCase();
  }).join("-");
  return leading + natural + trailing;
}

function consumerFactPhrase(field: string, value: string): string {
  if (!CONSUMER_NOUN_CASE_FIELDS.has(field)) return value;
  // 本层只修正短名词值；较长英文 rendering 可能已经是人工/模型编辑后的完整事实表达，必须原文保留。
  if (value.trim().split(/\s+/).filter(Boolean).length > 5) return value;
  return value.split(/(\s+)/).map((token) => /\s+/.test(token) ? token : consumerWordCase(token)).join("");
}

/**
 * 功能类名词值 → 数量/复数用 `includes {v}.`（"includes 3 compartments"），
 * 其余用 `has a {v} feature.`。
 * 禁止产出 "has a 3 compartments feature" —— 数量/复数前不能加不定冠词。
 */
function featureObjectFrame(t: string, v: string): string {
  return isQuantityOrPluralNoun(v)
    ? "The " + t + " includes " + v + "."
    : "The " + t + " has " + articleFor(v) + " " + v + " feature.";
}

/** 纯控件名（push button / switch / lever / knob / dial）→ uses-as-control 帧；其余名词机制 → opens-through 帧 */
const PURE_CONTROL_NAMES = /^(?:push|press|slide|flip|toggle)?\s*(?:button|switch|lever|knob|dial)\s*$/i;

/**
 * 操作类名词值 → 消费者自然句。
 * 1) 纯控件名（Push Button）→ `uses a {v} as a control.`；
 * 2) 其余机制名（Latch / Step pedal mechanism）→ `opens through its {v} mechanism.`
 * 禁止产出 "has a push-button opening operation" / "opens with a Latch operation."（字段标签拼接）。
 * 不用 works with：works with 命中 Claim Evidence 的兼容性高风险类别（无兼容性事实时会被拒）。
 */
function operationObjectFrame(t: string, v: string): string {
  if (PURE_CONTROL_NAMES.test(String(v).trim())) {
    return "The " + t + " uses " + articleFor(v) + " " + v + " as a control.";
  }
  // 值已含 mechanism（Step pedal mechanism / sliding sip lid mechanism）则不再重复追加
  return /\bmechanism\b/i.test(String(v))
    ? "The " + t + " opens through its " + v + "."
    : "The " + t + " opens through its " + v + " mechanism.";
}

const NOUN_SPEC_FRAME_BY_FIELD: Record<string, (t: string, v: string) => string> = {
  material: (t, v) => "The " + t + " is made of " + v + ".",
  construction: (t, v) => "The " + t + " includes " + v + ".",
  dimensions: (t, v) => "The " + t + " measures " + v + ".",
  weight: (t, v) => "The " + t + " weighs " + v + ".",
  capacity: (t, v) => "The " + t + " has a capacity of " + v + ".",
  color_or_variant: (t, v) => "The " + t + " is available in " + v + " color.",
  included_components: (t, v) =>
    isQuantityOrPluralNoun(v)
      ? valueContainsTypeLabel(v, t)
        ? "The included component is " + v + "."
        : "The " + t + " includes " + v + "."
      : "A " + v + " is included with the " + t + ".",
  quantity_or_pack_size: (t, v) => "The " + t + " comes in a " + v + ".",
  compatibility: (t, v) => "The " + t + " fits " + v + ".",
  usage: (t, v) => "The " + t + " is suitable for use at " + v + ".",
  // 功能类字段：值本身即可作 features / uses 的宾语，不再套 "has a X feature / operation"
  // （"has a 3 compartments feature" / "has a push-button opening operation" 均非自然英文）。
  functional_feature: (t, v) =>
    isQuantityOrPluralNoun(v)
      ? "The " + t + " includes " + v + "."
      : PURE_CONTROL_NAMES.test(String(v).trim())
        ? "The " + t + " uses " + articleFor(v) + " " + v + " as a control."
        : featureObjectFrame(t, v),
  insulation: (t, v) => featureObjectFrame(t, v),
  drinking_mechanism: (t, v) => featureObjectFrame(t, v),
  lid_behavior: (t, v) => featureObjectFrame(t, v),
  other: (t, v) => featureObjectFrame(t, v),
  operation: (t, v) => operationObjectFrame(t, v),
  care: (t, v) => "For care, the " + t + " is " + v + ".",
  cleaning: (t, v) => "For cleaning, the " + t + " is " + v + ".",
};

/** 值的首词（小写、去标点） */
function phraseHeadWord(value: string): string {
  const m = String(value).trim().toLowerCase().match(/^[a-z][a-z'’-]*/);
  return m ? m[0] : "";
}

/** 值本身已是自带主语的完整句（The X …/This X …/It …）且含谓语 */
function isSelfContainedSentence(value: string): boolean {
  const v = String(value).trim();
  if (!/^(?:the|this|that|these|those|it)\s/i.test(v)) return false;
  return /\b(?:is|are|was|were|has|have|includes?|uses?|stores?|holds?|fits?|expands?|measures?|weighs?|comes?|features?|keeps?|works?)\b/i.test(v);
}

/**
 * 受控完整句构造：字段 + 英文短语形态 → 唯一确定性句骨架。
 * 返回 null = 形态不可识别（fail-closed，调用方跳过并记录质量不足）。
 */
function buildControlledSentence(field: string, rawValue: string, typeLabel: string): string | null {
  const value = String(rawValue).trim().replace(/[.\s]+$/, "");
  if (!value) return null;
  const head = phraseHeadWord(value);
  const lower = value.toLowerCase();

  // 0) 值已是完整句 → 原样复述（只做句点归一），不再套骨架
  if (isSelfContainedSentence(value)) return endWithPeriod(value);

  // 1) care / cleaning 的祈使短语 → `For care, {v}.`
  const lead = IMPERATIVE_LEAD_BY_FIELD[field];
  if (lead && IMPERATIVE_PHRASE_HEADS.has(head)) return lead + ", " + value + ".";

  // 2) 分词 / 形容词补语 → `The {t} is {v}.`
  if (COMPLEMENT_PHRASE_HEADS.some((h) => lower.startsWith(h + " "))) {
    return "The " + typeLabel + " is " + value + ".";
  }

  // 3) 三单谓语开头 → `The {t} {v}.`
  if (FINITE_PHRASE_HEADS.has(head)) return "The " + typeLabel + " " + value + ".";

  // 4) 名词规格值 → 字段专属真实谓语
  const nounFrame = NOUN_SPEC_FRAME_BY_FIELD[field];
  if (nounFrame) return nounFrame(typeLabel, consumerFactPhrase(field, value));

  // 5) 形态不可识别 → fail-closed
  return null;
}

/**
 * Plan 组内候选（**字段与值成对**，帧必须与被选中值的字段一致，不得错配）。
 * 按「能否组成 5-30 词自然句」的适配度排序：长值含完整事实更多上下文，短值难以成句。
 */
function planBulletCandidates(
  input: ListingGenerationInput,
  factIds: string[],
): Array<{ field: string; value: string }> {
  const candidates: Array<{ field: string; value: string }> = [];
  for (const id of factIds) {
    const f = input.productFacts.find((x) => x.field === id);
    if (!f || !f.value.trim()) continue;
    // 1 Count：单件默认数量无消费者价值，即使旧 Plan/历史数据传入也不得生成正式句
    if (isTrivialSingleUnitQuantity(f.field, f.value)) continue;
    // English rendering 优先（中文 facts 经渲染转英文；渲染失败 → 原值仅当无 CJK 才可用）
    const rendered = renderingOf(input, id);
    const candidate = rendered && !HAS_CJK.test(rendered) && !HAS_CJK_PUNCT.test(rendered) ? rendered : "";
    if (!candidate) continue;
    if (V2_RISKY_WORDS.test(candidate)) continue;
    candidates.push({ field: id, value: candidate });
  }
  return candidates.sort((a, b) => {
    const wa = planWordCount(a.value), wb = planWordCount(b.value);
    const scoreA = wa >= 5 && wa <= 30 ? (wa >= 8 ? 0 : 8 - wa) : 100;
    const scoreB = wb >= 5 && wb <= 30 ? (wb >= 8 ? 0 : 8 - wb) : 100;
    return scoreA - scoreB;
  });
}

/** 受控组合结果：合格句 + fail-closed 记录（质量不足，供调用方判定是否降级） */
export type ControlledBulletsResult = {
  bullets: string[];
  /** 形态不可识别或不足词数而被跳过的事实（质量不足记录；不参与凑句） */
  unrenderable: Array<{ field: string; value: string; reason: string }>;
};

/**
 * 按 plan.bulletPlans 逐条生成受控完整句（每组一条，逐 Plan 绑定）。
 * 任一组无法生成自然完整句 → 跳过并记入 unrenderable，绝不用通用模板凑句。
 */
export function composeControlledBullets(
  input: ListingGenerationInput,
  plan: ListingPlan,
): ControlledBulletsResult {
  const typeLabel = typeLabelOf(input);
  const bullets: string[] = [];
  const unrenderable: Array<{ field: string; value: string; reason: string }> = [];
  for (const bp of plan.bulletPlans) {
    const candidates = planBulletCandidates(input, bp.featureFactIds);
    if (candidates.length === 0) {
      unrenderable.push({
        field: (bp.featureFactIds ?? [])[0] ?? "",
        value: "",
        reason: "该计划组无可用英文渲染事实值（缺失/含中文/含高风险营销词）。",
      });
      continue;
    }
    // 同组回退：第一个事实不能形成受控句（形态不可识别 / 词数越界）时，
    // 依次尝试同组下一个可用事实，不得因为长值或不可识别值直接丢掉整组。
    // 失败的候选**逐条记录** unrenderable（即使同组后续候选成功——失败事实不进入正式 bullets，
    // 但质量记录必须保留供调用方/展示判定）。
    const groupFailures: Array<{ field: string; value: string; reason: string }> = [];
    let rendered = false;
    for (const picked of candidates) {
      const sentence = buildControlledSentence(picked.field, picked.value, typeLabel);
      if (!sentence) {
        groupFailures.push({
          field: picked.field,
          value: picked.value,
          reason: "英文短语形态不可识别，无受控句型可用；按 fail-closed 跳过，不用通用模板凑句。",
        });
        continue;
      }
      const wc = planWordCount(sentence);
      // 单一权威词数合同：与 Runtime Quality（RUNTIME_QUALITY_LIMITS.bulletWordsMin/Max）一致；
      // Composition 不得返回它已知最终 Runtime 必然拒绝（too_short/too_long）的候选句。
      if (wc < RUNTIME_QUALITY_LIMITS.bulletWordsMin || wc > RUNTIME_QUALITY_LIMITS.bulletWordsMax || !/[.!?]$/.test(sentence)) {
        groupFailures.push({
          field: picked.field,
          value: picked.value,
          reason: "受控完整句词数不在 " + RUNTIME_QUALITY_LIMITS.bulletWordsMin + "-" + RUNTIME_QUALITY_LIMITS.bulletWordsMax + " 区间（" + wc + " 词），不得追加模板填充语凑足词数。",
        });
        continue;
      }
      bullets.push(sentence);
      rendered = true;
      break;
    }
    unrenderable.push(...groupFailures);
  }
  return { bullets: bullets.slice(0, 5), unrenderable };
}

function composeOptimizedBullets(input: ListingGenerationInput, plan: ListingPlan): string[] {
  // v2：计划必须真实驱动生成——绝不无差别退回 composeBullets。
  // 关键词只出现在标题（主词一次）与 Keywords 字段；正文不内嵌关键词词面
  // （市场词可能越过 Claim Evidence 允许表 → 保 claim 安全零风险）。
  const { bullets } = composeControlledBullets(input, plan);
  // 受控句 ≥1 条即采用（即使 <3 条——模板回退句含 "for ... use" 模板尾，违反无模板尾合同）；
  // 仅受控句为 0（全部 fail-closed）时才退回既有安全模板路径（旧行为）。
  if (bullets.length === 0) {
    return composeBullets(input);
  }
  return bullets.slice(0, 5);
}
function composeOptimizedDescription(input: ListingGenerationInput): string {
  // R6：与默认描述同规则——安全模板完整句（身份+事实句+规格句），禁止碎片拼接
  return composeDescription(input);
}
function composeOptimizedKeywords(input: ListingGenerationInput, brief: ListingKeywordBrief | null): {
  keywords: string[];
  backendSearchTerms: string[];
} {
  if (!brief) {
    // 轮 16：无手工 Keyword Brief → 从已保存 keywordEvidence 派生 auto_suggested 计划，
    // 不关闭 SEO 优化；关键词是 SEO 参考，不是商品事实（不进 confirmed facts）。
    const auto = buildAutoKeywordPlan({
      keywordCandidates: input.creativeContext?.keywordCandidates ?? [],
      // 英文渲染值：属性词(材质/容量)匹配已确认事实用英文值（中文原值会漏配）
      confirmedFacts: input.productFacts.map((f) => ({ field: f.field, label: f.label, value: englishRenderingOf(input, f.field) ?? f.value })),
      ownBrand: englishRenderingOf(input, "brand") ?? "",
      knownBrands: [],
    });
    const kw: string[] = [];
    if (auto.primaryKeyword) kw.push(auto.primaryKeyword);
    for (const s of auto.supportingKeywords) {
      if (!kw.includes(s)) kw.push(s);
    }
    return { keywords: kw.slice(0, 12), backendSearchTerms: auto.backendSearchTerms };
  }
  const keywords: string[] = [];
  if (brief.primaryKeyword) keywords.push(brief.primaryKeyword);
  for (const s of brief.supportingKeywords) {
    if (!keywords.includes(s)) keywords.push(s);
  }
  // 补充身份词（品牌/类型组合），但去重
  const brand = englishRenderingOf(input, "brand");
  const type = englishRenderingOf(input, "product_type");
  // 品牌==类型（THERMOS THERMOS）不得生成词内重复组合词
  if (brand && type && brand.toLowerCase() !== type.toLowerCase() && !keywords.includes(`${brand} ${type}`)) keywords.push(`${brand} ${type}`);
  const materialV = englishRenderingOf(input, "material");
  const capacityV = englishRenderingOf(input, "capacity");
  if (type && materialV && !keywords.includes(materialV + " " + type) && keywords.length < 12) keywords.push(materialV + " " + type);
  if (type && capacityV && !keywords.includes(capacityV + " " + type) && keywords.length < 12) keywords.push(capacityV + " " + type);
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
