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

  // bulletPlans：functional 优先（每条绑 functional factId + 关键规格），否则基础事实
  const bulletPlans: ListingBulletPlan[] = [];
  if (functional.length > 0) {
    for (const f of functional.slice(0, 4)) {
      bulletPlans.push({
        featureFactIds: [f.factId],
        shopperAngle: FUNCTIONAL_ANGLE_HINTS[f.field] ?? "实际使用价值",
        keywordIds: supportingKeywords.slice(0, 1),
      });
    }
    // 若还有规格可补充，附加一条规格组合（绑 spec factId）
    if (specification.length > 0 && bulletPlans.length < 5) {
      bulletPlans.push({
        featureFactIds: specification.slice(0, 2).map((f) => f.factId),
        shopperAngle: "关键规格与选择依据",
        keywordIds: [],
      });
    }
  } else {
    // 无 functional：只生成基础事实计划（safe_fact_draft）
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
