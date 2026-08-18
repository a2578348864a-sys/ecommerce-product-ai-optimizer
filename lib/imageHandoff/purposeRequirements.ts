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
    const fieldHit = PACKAGING_EVIDENCE_FIELDS.has(fact.field);
    if (fieldHit) return true;
    const haystack = `${fact.label} ${fact.value}`;
    return PACKAGING_EVIDENCE_VALUE_PATTERN.test(haystack);
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
  const requirement = PURPOSE_REQUIREMENTS[purpose];
  if (!requirement.requiresEvidence) return { ok: true };
  if (purpose === "packaging_bundle") {
    if (!hasPackagingEvidence(facts)) {
      return { ok: false, code: requirement.blockedCode!, message: requirement.blockedMessage! };
    }
    return { ok: true };
  }
  // 其余 REQUIRES_EVIDENCE 用途：本轮仅定义矩阵，不启用 gate（避免过度收紧；见 PURPOSE_REQUIREMENTS 注释）
  return { ok: true };
}
