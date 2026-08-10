/**
 * Listing Plan（Quality.1）
 *
 * 生成前先形成内部 Listing Plan，不直接 facts → 最终文案。
 *
 * 结构：
 * - primaryKeyword / supportingKeywords
 * - titlePlan（结构说明，不直接等于最终文案）
 * - bulletPlans[]：每条绑定至少一个 factId（featureFactIds），含 shopperAngle
 * - descriptionPlan
 * - backendSearchTerms
 * - missingFacts / prohibitedClaims
 *
 * 安全：
 * - 每条 Bullet Plan 必须绑定已允许用于 Listing 的 factId
 * - 无 functional facts 时 bulletPlans 只生成"基础事实"计划（不冒充优化）
 * - 纯函数；无 DB/网络；同输入同输出
 */

import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { listingFactRole, type ListingFactRole } from "@/lib/listingHandoff/listingReadiness";

export type ListingBulletPlan = {
  featureFactIds: string[];
  shopperAngle: string;
  keywordIds: string[];
};

export type ListingPlan = {
  schema: "listing-plan.v1";
  primaryKeyword: string | null;
  supportingKeywords: string[];
  titlePlan: string[];
  bulletPlans: ListingBulletPlan[];
  descriptionPlan: string;
  backendSearchTerms: string[];
  missingFacts: string[];
  prohibitedClaims: string[];
  planQuality: "optimized" | "safe_fact_draft";
};

type PlanFact = {
  factId: string;
  field: string;
  label: string;
  value: string;
  role: ListingFactRole;
};

function textOf(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFC").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).join("; ");
  return "";
}

/** 从 generation input 收集可计划的 listing facts（含 factId 绑定） */
function planFactsOf(input: ListingGenerationInput): PlanFact[] {
  return input.productFacts.map((f) => ({
    factId: f.field, // productFacts 无 factId；用 field 作为稳定绑定键
    field: f.field,
    label: f.label,
    value: textOf(f.value),
    role: listingFactRole({ field: f.field, value: f.value, usageScopes: ["listing"] } as never),
  }));
}

function factById(facts: PlanFact[], id: string): PlanFact | null {
  return facts.find((f) => f.factId === id) ?? null;
}

const FUNCTIONAL_ANGLE_HINTS: Record<string, string> = {
  drinking_mechanism: "饮水方式更顺手",
  insulation: "保温/保冷场景",
  lid_behavior: "开合与密封便利",
  cleaning: "清洁保养便利",
  carry: "随身携带场景",
  compatibility: "兼容适用对象",
  construction: "结构与做工",
  usage: "使用场景",
  operation: "操作方式",
  included_components: "随附组件",
};

/**
 * v2.2.14：按"不同信息价值"规划 Bullet，避免 functional 少时只有 1-2 条。
 * 优先级：functional 各条独立 → 规格按独立信息组（material+capacity 组合、color、quantity 各一组）。
 * 绝不重复同一事实、不换词凑数、不创造不存在的功能；安全事实只够 2 条时只生成 2 条。
 */
const FUNCTIONAL_PRIORITY_ORDER = [
  "functional_feature",
  "operation",
  "drinking_mechanism",
  "insulation",
  "lid_behavior",
  "usage",
  "care",
  "cleaning",
  "construction",
  "compatibility",
  "included_components",
] as const;

/** 规格按独立信息价值分组：材质+容量（选择依据）、颜色（变体）、数量（包装）。 */
const SPEC_BULLET_GROUPS: Array<{ fields: readonly string[]; shopperAngle: string }> = [
  { fields: ["material", "capacity"], shopperAngle: "关键材质与容量选择依据" },
  { fields: ["color_or_variant"], shopperAngle: "颜色与款式选择" },
  { fields: ["quantity_or_pack_size"], shopperAngle: "数量与包装规格" },
];

/** 生成 Listing Plan：有 functional facts → optimized；否则 safe_fact_draft */
export function buildListingPlan(
  input: ListingGenerationInput,
  keywordBrief: ListingKeywordBrief | null,
): ListingPlan {
  const facts = planFactsOf(input);
  const identity = facts.filter((f) => f.role === "identity");
  const specification = facts.filter((f) => f.role === "specification");
  const functional = facts.filter((f) => f.role === "functional");
  const primaryKeyword = keywordBrief?.primaryKeyword ?? null;
  const supportingKeywords = keywordBrief?.supportingKeywords ?? [];
  const backendSearchTerms = keywordBrief?.backendSearchTerms ?? [];

  // titlePlan：Brand + Product Line + Primary Type + 1-3 关键属性
  const titleParts: string[] = [];
  for (const role of ["identity", "specification"] as const) {
    for (const f of facts.filter((x) => x.role === role)) {
      if (titleParts.length >= 6) break;
      titleParts.push(f.value);
    }
    if (titleParts.length >= 6) break;
  }
  const titlePlan = titleParts.length > 0 ? [titleParts.join(" ")] : [];

  // bulletPlans：v2.2.14 按信息价值分组。
  // functional 各条独立（按优先顺序）；规格按独立信息组补充（material+capacity、color、quantity）。
  // 目标 3-5 条；安全事实不够时不凑数。
  const bulletPlans: ListingBulletPlan[] = [];
  const functionalOrdered = FUNCTIONAL_PRIORITY_ORDER
    .map((field) => functional.find((f) => f.field === field))
    .filter((f): f is PlanFact => f !== undefined);
  for (const f of functionalOrdered.slice(0, 4)) {
    bulletPlans.push({
      featureFactIds: [f.factId],
      shopperAngle: FUNCTIONAL_ANGLE_HINTS[f.field] ?? "实际使用价值",
      keywordIds: supportingKeywords.slice(0, 1),
    });
  }
  // 规格按独立信息组补充（已有事实才生成；不合并所有规格为一条）
  for (const group of SPEC_BULLET_GROUPS) {
    if (bulletPlans.length >= 5) break;
    const present = group.fields.filter((field) => specification.some((f) => f.field === field));
    if (present.length === 0) continue;
    bulletPlans.push({
      featureFactIds: present.map((field) => specification.find((f) => f.field === field)!.factId),
      shopperAngle: group.shopperAngle,
      keywordIds: [],
    });
  }
  // 无 functional 且规格组不足时：基础事实计划（safe_fact_draft）
  if (bulletPlans.length === 0) {
    for (const f of facts.slice(0, 5)) {
      bulletPlans.push({
        featureFactIds: [f.factId],
        shopperAngle: "基础商品信息",
        keywordIds: [],
      });
    }
  }

  const descriptionPlan = functional.length > 0
    ? "产品用途 + 关键功能 + 使用场景 + 买方价值（全部基于已确认事实）"
    : "基础事实描述（仅已确认事实，不虚构功能）";

  const missingFacts = functional.length === 0
    ? ["缺少功能/使用相关事实，无法生成优化 Listing"]
    : [];

  return {
    schema: "listing-plan.v1",
    primaryKeyword,
    supportingKeywords,
    titlePlan,
    bulletPlans,
    descriptionPlan,
    backendSearchTerms,
    missingFacts,
    prohibitedClaims: input.prohibitedClaims,
    planQuality: functional.length > 0 ? "optimized" : "safe_fact_draft",
  };
}

/** 安全摘要（供 UI 展示，不含内部结构细节） */
export function safeListingPlanSummary(plan: ListingPlan) {
  return {
    planQuality: plan.planQuality,
    primaryKeyword: plan.primaryKeyword,
    bulletPlanCount: plan.bulletPlans.length,
    backendTermsCount: plan.backendSearchTerms.length,
    missingFacts: plan.missingFacts,
    bulletFactsBound: plan.bulletPlans.every((b) => b.featureFactIds.length > 0),
  };
}

export { factById };
