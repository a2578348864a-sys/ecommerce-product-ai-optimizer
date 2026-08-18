/**
 * Image Studio Creative Intent — Purpose Requirement Matrix（V3 P1）
 *
 * 每类图片主用途的确定性要求（证据门禁，前端/服务端共享同一规则，杜绝静默降级）：
 * - REQUIRES_EVIDENCE：缺少对应已确认证据时生成必须被阻止（不再默默生成普通棚拍图）。
 * - SCENE：场景偏好与主用途的兼容关系（ALLOWED / IGNORED / CONFLICT）。
 *
 * 本轮实现（最小）：PACKAGING_SET 证据 gate（用户真实反例核心）；WHITE_BACKGROUND 场景冲突
 * 由既有 parse 层 white_background_scene_conflict 处理；其余用途的要求在矩阵中明确标注，
 * 供后续按需启用（不做自动业务推理）。
 */

import type { StudioImageLifestyleScene, StudioImagePrimaryPurpose } from "@/lib/studioImageCreativeIntent";

/** 包装/套装证据相关的已确认事实字段（deterministic 白名单，不猜测） */
export const PACKAGING_EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  "quantity_or_pack_size",
  "packaging",
  "bundle",
  "set",
  "accessories",
  "included_items",
  "package_contents",
  "units_per_package",
]);

/** 包装语义关键词（label/value 命中即视为包装证据线索；与字段白名单互补） */
export const PACKAGING_EVIDENCE_VALUE_PATTERN = /(?:包|盒|袋|瓶|罐|支|件|套|箱|装|pack|box|bundle|set|included|package|units?)/iu;

export type PurposeRequirement = {
  /** 主用途是否要求已确认证据才能生成 */
  requiresEvidence: boolean;
  /** 缺证据时的机器码 */
  blockedCode?: string;
  /** 缺证据时的用户提示（中文） */
  blockedMessage?: string;
};

export type PurposeSceneCompatibility = "ALLOWED" | "IGNORED" | "CONFLICT" | "REQUIRES_EVIDENCE";

/** Purpose 需求矩阵（确定性，不做业务推理） */
export const PURPOSE_REQUIREMENTS: Record<StudioImagePrimaryPurpose, PurposeRequirement> = {
  white_studio: { requiresEvidence: false },
  selling_point_infographic: {
    requiresEvidence: true,
    blockedCode: "image_purpose_requires_confirmed_claims",
    blockedMessage: "卖点信息图需要已确认的卖点事实；当前没有可安全展示的已确认卖点。",
  },
  dimension_specification: {
    requiresEvidence: true,
    blockedCode: "image_purpose_requires_dimensions",
    blockedMessage: "尺寸规格图需要已确认的尺寸/规格事实；当前没有可标注的已确认尺寸。",
  },
  detail_closeup: { requiresEvidence: false },
  packaging_bundle: {
    requiresEvidence: true,
    blockedCode: "image_purpose_requires_packaging_evidence",
    blockedMessage: "缺少已确认包装/套装资料，无法生成真实包装展示图。请先在研究记录中确认包装或套装事实，或改用其他图片用途。",
  },
  usage_steps: {
    requiresEvidence: true,
    blockedCode: "image_purpose_requires_usage_facts",
    blockedMessage: "使用步骤图需要已确认的使用方式事实；当前没有可展示的已确认步骤。",
  },
  comparison: { requiresEvidence: false },
  custom: { requiresEvidence: false },
};

/** Purpose × Scene 兼容矩阵（当前用途的实际行为） */
export const PURPOSE_SCENE_COMPATIBILITY: Record<StudioImagePrimaryPurpose, Record<StudioImageLifestyleScene, PurposeSceneCompatibility>> = {
  white_studio: {
    none: "ALLOWED",
    home_lifestyle: "CONFLICT",
    office_commute: "CONFLICT",
    outdoor_travel: "CONFLICT",
    sports_fitness: "CONFLICT",
  },
  selling_point_infographic: {
    none: "ALLOWED",
    home_lifestyle: "ALLOWED",
    office_commute: "ALLOWED",
    outdoor_travel: "ALLOWED",
    sports_fitness: "ALLOWED",
  },
  dimension_specification: {
    none: "ALLOWED",
    home_lifestyle: "IGNORED",
    office_commute: "IGNORED",
    outdoor_travel: "IGNORED",
    sports_fitness: "IGNORED",
  },
  detail_closeup: {
    none: "ALLOWED",
    home_lifestyle: "IGNORED",
    office_commute: "IGNORED",
    outdoor_travel: "IGNORED",
    sports_fitness: "IGNORED",
  },
  packaging_bundle: {
    none: "ALLOWED",
    home_lifestyle: "ALLOWED",
    office_commute: "ALLOWED",
    outdoor_travel: "ALLOWED",
    sports_fitness: "ALLOWED",
  },
  usage_steps: {
    none: "ALLOWED",
    home_lifestyle: "ALLOWED",
    office_commute: "ALLOWED",
    outdoor_travel: "ALLOWED",
    sports_fitness: "ALLOWED",
  },
  comparison: {
    none: "ALLOWED",
    home_lifestyle: "ALLOWED",
    office_commute: "ALLOWED",
    outdoor_travel: "ALLOWED",
    sports_fitness: "ALLOWED",
  },
  custom: {
    none: "ALLOWED",
    home_lifestyle: "ALLOWED",
    office_commute: "ALLOWED",
    outdoor_travel: "ALLOWED",
    sports_fitness: "ALLOWED",
  },
};

export type ConfirmedFactLike = { field: string; label: string; value: string };

/** 包装/套装证据判定（deterministic）：字段白名单 + 语义关键词，不猜测、不调用 AI */
export function hasPackagingEvidence(facts: ConfirmedFactLike[]): boolean {
  return facts.some((fact) => {
    if (!isAuthoritativeFact(fact)) return false;
    const fieldHit = PACKAGING_EVIDENCE_FIELDS.has(fact.field);
    if (fieldHit) return true;
    const haystack = `${fact.label} ${fact.value}`;
    return PACKAGING_EVIDENCE_VALUE_PATTERN.test(haystack);
  });
}

// ── 尺寸规格证据（SIZE_SPEC）──────────────────────────────────────────────
/** 尺寸证据字段白名单（正式规格字段；capacity/容量 不算尺寸） */
export const DIMENSION_EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  "dimensions",
  "product_dimensions",
  "package_dimensions",
  "width",
  "height",
  "length",
  "depth",
  "diameter",
  "size",
]);

/** 尺寸语义关键词（label/value；带单位的数字或尺寸词） */
export const DIMENSION_EVIDENCE_PATTERN = /(?:尺寸|宽|高|长|直径|深度|规格|dimension|width|height|length|diameter|depth|\d+(?:\.\d+)?\s*(?:cm|mm|inch|in|"|英寸|厘米|毫米))/iu;

/** 带单位的尺寸数字（用于区分"容量"与"尺寸"） */
const DIMENSION_UNIT_PATTERN = /\d+(?:\.\d+)?\s*(?:cm|mm|inch|in|"|英寸|厘米|毫米)/iu;

/** 容量语义（明确排除：容量 ≠ 尺寸） */
const CAPACITY_ONLY_PATTERN = /(?:容量|容积|capacity|oz|ml|升|毫升|盎司)/iu;

/** 非权威来源字段（VOC / AI Summary / 竞品 / 供应 / 关键词 / 评论等：绝不升级为 confirmed evidence） */
const NON_AUTHORITY_FIELDS: ReadonlySet<string> = new Set([
  "ai_reference",
  "ai_references",
  "ai_summary",
  "voc",
  "voc_insight",
  "voc_insights",
  "competitor",
  "competitor_reference",
  "competitor_evidence",
  "sourcing",
  "sourcing_offer",
  "keyword",
  "seller_claim",
  "creative_description",
  "review_insight",
  "review_quote",
]);

function isAuthoritativeFact(fact: ConfirmedFactLike): boolean {
  return !NON_AUTHORITY_FIELDS.has(fact.field);
}

/**
 * 已确认尺寸证据判定：字段白名单命中，或 label/value 含明确尺寸语义；
 * 仅容量（24oz/500ml 等）不构成尺寸证据（容量 ≠ 尺寸）；VOC/AI 等非权威来源不升级。
 */
export function hasDimensionEvidence(facts: ConfirmedFactLike[]): boolean {
  return facts.some((fact) => {
    if (!isAuthoritativeFact(fact)) return false;
    if (DIMENSION_EVIDENCE_FIELDS.has(fact.field)) return fact.value.trim().length > 0;
    const haystack = `${fact.label} ${fact.value}`;
    if (!DIMENSION_EVIDENCE_PATTERN.test(haystack)) return false;
    // 尺寸语义命中但整体仅表达容量（value="24oz" 等）且无带单位尺寸数字 → 不算尺寸
    if (CAPACITY_ONLY_PATTERN.test(haystack) && !DIMENSION_UNIT_PATTERN.test(haystack)) {
      return false;
    }
    return true;
  });
}

// ── 使用方式证据（USAGE_STEPS）────────────────────────────────────────────
/** 使用方式证据字段白名单 */
export const USAGE_EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  "usage",
  "usage_steps",
  "usage_method",
  "how_to_use",
  "operation",
  "cleaning",
  "maintenance",
  "installation",
  "assembly",
  "brewing",
]);

/** 使用方式语义关键词（明确动作/步骤语义；"用途/使用场景"不算） */
export const USAGE_EVIDENCE_PATTERN = /(?:使用(?:方法|方式|步骤|说明)|操作(?:方式|步骤)|清洗(?:方式|方法)|安装(?:方式|方法)|维护|冲泡|冲煮|how to (?:use|clean|install|operate)|usage (?:steps?|method)|instruction)/iu;

/**
 * 已确认使用方式证据判定：字段白名单或明确步骤/动作语义。
 * 参考图视觉推断（看到按钮/吸管）不构成 usage facts；VOC/AI Summary 不自动升级。
 */
export function hasUsageEvidence(facts: ConfirmedFactLike[]): boolean {
  return facts.some((fact) => {
    if (!isAuthoritativeFact(fact)) return false;
    if (USAGE_EVIDENCE_FIELDS.has(fact.field)) return fact.value.trim().length > 0;
    const haystack = `${fact.label} ${fact.value}`;
    return USAGE_EVIDENCE_PATTERN.test(haystack);
  });
}

// ── 卖点信息图证据（SELLING_POINT_INFOGRAPHIC）───────────────────────────
/** 卖点证据字段白名单（功能性/材料/特性；identity 与市场字段不算） */
export const SELLING_POINT_EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  "material",
  "materials",
  "features",
  "feature",
  "insulation",
  "construction",
  "compatibility",
  "bpa_free",
  "leakproof",
  "dishwasher_safe",
  "carry_loop",
  "carry_handle",
  "lid_type",
  "spout_type",
  "valve",
  "weight",
]);

/** identity/市场类字段黑名单（品牌/标题/类型/容量/颜色/价格/评分等不算卖点） */
const NON_SELLING_POINT_FIELDS: ReadonlySet<string> = new Set([
  "brand",
  "title",
  "product_type",
  "series_or_model",
  "capacity",
  "color_or_variant",
  "price_usd",
  "rating",
  "review_count",
  "bsr",
  "category",
  "asin",
]);

/** 卖点语义关键词（材料/保温/防漏/认证等；仅在有确认事实时使用） */
export const SELLING_POINT_EVIDENCE_PATTERN = /(?:材质|材料|不锈钢|保温|双层|防漏|密封|不含\s*bpa|洗碗机|提手|挂环|兼容|杯盖|吸管|stainless|insulat|leakproof|bpa\s*free|dishwasher|carry (?:loop|handle)|compatible|material)/iu;

/**
 * 已确认卖点证据判定：功能/材料/特性字段白名单，或 label/value 命中卖点语义；
 * 品牌/标题/类型/容量/颜色/价格等 identity 字段不算卖点；
 * VOC / AI Summary / 竞品 / 常识 不自动升级为卖点（只读 confirmed facts）。
 */
export function hasSellingPointEvidence(facts: ConfirmedFactLike[]): boolean {
  return facts.some((fact) => {
    if (!isAuthoritativeFact(fact)) return false;
    if (NON_SELLING_POINT_FIELDS.has(fact.field)) return false;
    if (SELLING_POINT_EVIDENCE_FIELDS.has(fact.field)) return fact.value.trim().length > 0;
    const haystack = `${fact.label} ${fact.value}`;
    return SELLING_POINT_EVIDENCE_PATTERN.test(haystack);
  });
}

export type PurposeGateResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** 生成前 Purpose 要求门禁（前端/服务端共享）：返回 blocked 时不得生成（不静默降级） */
export function evaluatePurposeRequirements(
  purpose: StudioImagePrimaryPurpose,
  facts: ConfirmedFactLike[],
): PurposeGateResult {
  switch (purpose) {
    case "packaging_bundle":
      if (!hasPackagingEvidence(facts)) {
        const requirement = PURPOSE_REQUIREMENTS[purpose];
        return { ok: false, code: requirement.blockedCode!, message: requirement.blockedMessage! };
      }
      return { ok: true };
    case "dimension_specification":
      if (!hasDimensionEvidence(facts)) {
        const requirement = PURPOSE_REQUIREMENTS[purpose];
        return { ok: false, code: requirement.blockedCode!, message: requirement.blockedMessage! };
      }
      return { ok: true };
    case "usage_steps":
      if (!hasUsageEvidence(facts)) {
        const requirement = PURPOSE_REQUIREMENTS[purpose];
        return { ok: false, code: requirement.blockedCode!, message: requirement.blockedMessage! };
      }
      return { ok: true };
    case "selling_point_infographic":
      if (!hasSellingPointEvidence(facts)) {
        const requirement = PURPOSE_REQUIREMENTS[purpose];
        return { ok: false, code: requirement.blockedCode!, message: requirement.blockedMessage! };
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}
