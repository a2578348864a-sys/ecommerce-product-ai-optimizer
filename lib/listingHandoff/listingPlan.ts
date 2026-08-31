/**
 * Listing Plan（Quality.1）v2
 *
 * 生成前先形成内部 Listing Plan，不直接 facts → 最终文案。
 *
 * v2 扩展（兼容 v1 旧数据）：
 * - bulletPlans 每条独立 role：core_outcome / pain_relief / use_scenario / ease_of_use / proof_or_fit
 * - 每条包含 shopperNeed（买家关心什么，来源 VOC 客户语言，仅参考不成为事实）、shopperAngle（准备怎么表达）、
 *   featureFactIds（≥1 条已确认事实）、evidenceRefs（研究参考：VOC 语言/direct 竞品定位，reference-only）、
 *   keywordIds（来自有效 Brief/auto plan）、claimMode（verified/review）、cannotSay（无确认事实不可说项）
 * - 计划级 status：ready / needs_facts / needs_keywords / needs_review
 * - VOC 只决定需求、优先级、客户语言，不成为商品事实；adjacent/irrelevant 竞品不得证明当前能力。
 *
 * 安全：
 * - 每条 Bullet Plan 必须绑定已允许用于 Listing 的 factId（≥1）
 * - 无 functional facts 时 bulletPlans 只生成“基础事实”计划（不冒充优化）
 * - 纯函数；无 DB/网络；同输入同输出
 */

import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";
import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { listingFactRole, type ListingFactRole } from "@/lib/listingHandoff/listingReadiness";

export type ListingPlanRole = "core_outcome" | "pain_relief" | "use_scenario" | "ease_of_use" | "proof_or_fit";

export type ListingClaimMode = "verified" | "review";

export type ListingPlanStatus = "ready" | "needs_facts" | "needs_keywords" | "needs_review";

export type ListingBulletPlan = {
  /** v2：运营卖点角色（同一 plan 内角色唯一；v1 旧数据兼容：可选） */
  role?: ListingPlanRole;
  /** v2：买家关心什么（VOC 客户语言；仅需求/优先级参考，不是商品事实；v1 兼容可选） */
  shopperNeed?: string;
  /** v1 兼容：准备怎么表达 */
  shopperAngle: string;
  /** 至少 1 条已确认事实 */
  featureFactIds: string[];
  /** v2：研究参考（VOC 语言/direct 竞品定位；reference-only，不作为事实证据；v1 兼容可选） */
  evidenceRefs?: string[];
  keywordIds: string[];
  /** v2：claim 模式（review 表示需人工确认；v1 兼容可选） */
  claimMode?: ListingClaimMode;
  /** v2：无确认事实支持时禁止表达的内容（性能/时长/认证/绝对承诺等；v1 兼容可选） */
  cannotSay?: string[];
};

export type ListingPlan = {
  schema: "listing-plan.v1" | "listing-plan.v2";
  /** v2：计划状态（v1 旧数据兼容：可选） */
  status?: ListingPlanStatus;
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

/** v2：角色 → 事实字段族（角色选择器；同一事实只允许一个角色） */
const ROLE_FIELD_FAMILIES: Array<{ role: ListingPlanRole; fields: readonly string[] }> = [
  { role: "core_outcome", fields: ["functional_feature", "series_or_model"] },
  { role: "use_scenario", fields: ["usage", "operation"] },
  { role: "ease_of_use", fields: ["cleaning", "care", "operation"] },
  { role: "proof_or_fit", fields: ["material", "capacity", "construction", "color_or_variant"] },
  { role: "pain_relief", fields: ["included_components", "care", "compatibility"] },
];

/** 无确认事实支持的禁止表述（默认全加；已确认事实值本身不在其中） */
export const DEFAULT_CANNOT_SAY = [
  "leakproof",
  "12 hours",
  "keeps warm 12 hours",
  "keeps cold 24 hours",
  "BPA-free",
  "FDA",
  "CE certified",
  "guaranteed",
  "100%",
  "best seller",
];

/** v2：从 VOC 客户语言提取买家关心点（bounded；NOT FACT） */
function shopperNeedOf(vocInsights: string[]): string {
  const raw = Array.isArray(vocInsights) ? vocInsights : [];
  if (raw.length === 0) return "日常使用需求";
  // FIX(COPY_QUALITY)：/s+/g 是字面字符 s 的替换 bug；空格/空白必须用 [\s]+
  const text = raw.slice(0, 3).join(" ").replace(/[\s]+/g, " ").trim().slice(0, 120);
  return text || "日常使用需求";
}

/** v2：按角色角度生成差异化 shopperNeed（同需求不得复制到多卡；不足时用角色角度兜底而非重复） */
const ROLE_NEED_HINTS: Record<ListingPlanRole, string> = {
  core_outcome: "日常核心功能需求",
  pain_relief: "痛点缓解与省心需求",
  use_scenario: "常用场景与随身需求",
  ease_of_use: "打理与清洁便利需求",
  proof_or_fit: "规格匹配与选择依据",
};

function shopperNeedOfRole(role: ListingPlanRole, baseNeed: string): string {
  const hint = ROLE_NEED_HINTS[role] ?? "实际使用价值";
  // 差异化：角色角度 + 基础需求合并（若基础需求与角色角度相同或为空，仅用角色角度）
  const trimmed = String(baseNeed ?? "").trim();
  if (!trimmed || trimmed === hint || trimmed === "日常使用需求") return hint;
  return hint + "（" + trimmed.slice(0, 60) + "）";
}

/** v2：VOC/竞品参考 —— 只作为证据引用标签，不进入 featureFactIds（reference-only） */
function evidenceRefsOf(input: ListingGenerationInput): string[] {
  const refs: string[] = [];
  if (Array.isArray(input.creativeContext?.vocInsights) && input.creativeContext.vocInsights.length > 0) {
    refs.push("ev:voc");
  }
  // direct 竞品仅作定位参考；相邻/无关竞品不得证明当前能力 → 全都不进 bullet 依据
  return refs;
}

/**
 * v2：为每个计划单元选择角色（角色唯一；按事实可得性降级）。
 * 返回 bulletPlan 构造参数，保证 featureFactIds 非空且仅在确认事实中挑选。
 */
function assignRoles(
  facts: PlanFact[],
  input: ListingGenerationInput,
  supportingKeywords: string[],
): Array<{
  role: ListingPlanRole;
  featureFactIds: string[];
  shopperAngle: string;
  shopperNeed: string;
  claimMode: ListingClaimMode;
}> {
  const used = new Set<string>();
  const usedRoles = new Set<ListingPlanRole>();
  const out: Array<{ role: ListingPlanRole; featureFactIds: string[]; shopperAngle: string; shopperNeed: string; claimMode: ListingClaimMode }> = [];
  // 身份事实（brand/product_type/series）不充当条件卖点；仅 functional/specification 可作为 bullet 事实
  const bulletEligible = facts.filter((f) => f.role !== "identity");
  const baseNeed = shopperNeedOf(input.creativeContext?.vocInsights ?? []);
  const needOf = (role: ListingPlanRole) => shopperNeedOfRole(role, baseNeed);
  // 1) 按角色族挑选未使用的事实（角色顺序：core → use → ease → proof → pain）
  for (const family of ROLE_FIELD_FAMILIES) {
    if (out.length >= 5) break;
    const found = bulletEligible.find((f) => family.fields.includes(f.field) && !used.has(f.factId));
    if (!found) continue;
    used.add(found.factId);
    usedRoles.add(family.role);
    out.push({
      role: family.role,
      featureFactIds: [found.factId],
      shopperAngle: FUNCTIONAL_ANGLE_HINTS[found.field] ?? "实际使用价值",
      shopperNeed: needOf(family.role),
      claimMode: "verified",
    });
  }
  // 2) 规格（材质/容量/颜色/数量）合并为 1 条 proof_or_fit（角色唯一；同一 plan 不重复角色 → 不产生同模板句）
  if (out.length < 3 && !usedRoles.has("proof_or_fit")) {
    const specFields = ["material", "capacity", "color_or_variant", "quantity_or_pack_size"];
    const present = specFields.filter((field) => bulletEligible.some((f) => f.field === field && !used.has(f.factId)));
    if (present.length > 0) {
      out.push({
        role: "proof_or_fit",
        featureFactIds: present.map((field) => bulletEligible.find((f) => f.field === field && !used.has(f.factId))!.factId),
        shopperAngle: "关键材质与容量选择依据",
        shopperNeed: needOf("proof_or_fit"),
        claimMode: "verified",
      });
      present.forEach((field) => used.add(field));
    }
  }
  // 3) 仍不足但确有基础事实 → 基础事实角色（仅在最末；角色唯一约束放宽到允许 proof_or_fit 复用？不：用剩余事实补充，角色取未用角色）
  if (out.length < 3) {
    const restRoles: ListingPlanRole[] = (["core_outcome", "pain_relief", "use_scenario", "ease_of_use", "proof_or_fit"] as ListingPlanRole[]).filter((r) => !usedRoles.has(r));
    for (const f of bulletEligible) {
      if (out.length >= 3 || restRoles.length === 0) break;
      if (used.has(f.factId)) continue;
      const role = restRoles.shift()!;
      used.add(f.factId);
      out.push({ role, featureFactIds: [f.factId], shopperAngle: "基础商品信息", shopperNeed: needOf(role), claimMode: "verified" });
    }
  }
  return out.slice(0, 5);
}

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

  // v2：keywordIds 映射（有效 Brief 才提供关键词引用）
  const keywordIdsValid = keywordBrief !== null && primaryKeyword !== null;
  const keywordIdsFor = (index: number): string[] => {
    if (!keywordIdsValid) return [];
    // 每个 plan 单元引用至多 2 个关键词（主词优先，然后辅助词轮转）
    const kw: string[] = [];
    if (primaryKeyword) kw.push("kw:primary");
    const support = supportingKeywords.length > 0 ? [supportingKeywords[index % supportingKeywords.length]] : [];
    if (support.length) kw.push("kw:supporting:" + support[0]);
    return kw;
  };

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

  // v2：角色驱动 bulletPlans（每 plan 唯一角色；事实不足 3 条 → needs_facts）
  const assigned = assignRoles(facts, input, supportingKeywords);
  const cannotSay = [...DEFAULT_CANNOT_SAY];
  const bulletPlans: ListingBulletPlan[] = assigned.map((a, index) => ({
    role: a.role,
    shopperNeed: a.shopperNeed,
    shopperAngle: a.shopperAngle,
    featureFactIds: a.featureFactIds,
    evidenceRefs: evidenceRefsOf(input),
    keywordIds: keywordIdsFor(index),
    claimMode: a.claimMode,
    cannotSay: [...cannotSay],
  }));

  // v1 兼容回退：assignRoles 未覆盖时用旧逻辑兜底（不产生空 featureFactIds）
  if (bulletPlans.length === 0) {
    for (const f of facts.filter((x) => x.role !== "identity").slice(0, 5)) {
      bulletPlans.push({
        role: "core_outcome",
        shopperNeed: "日常使用需求",
        shopperAngle: "基础商品信息",
        featureFactIds: [f.factId],
        evidenceRefs: [],
        keywordIds: [],
        claimMode: "verified",
        cannotSay: [...cannotSay],
      });
    }
  }

  const enoughFacts = bulletPlans.length >= 3;
  const status: ListingPlanStatus = !enoughFacts
    ? "needs_facts"
    : (keywordBrief === null || primaryKeyword === null)
      ? "needs_keywords"
      : bulletPlans.some((b) => b.claimMode === "review")
        ? "needs_review"
        : "ready";

  const descriptionPlan = functional.length > 0
    ? "产品用途 + 关键功能 + 使用场景 + 买方价值（全部基于已确认事实）"
    : "基础事实描述（仅已确认事实，不虚构功能）";

  const missingFacts = functional.length === 0
    ? ["缺少功能/使用相关事实，无法生成优化 Listing"]
    : [];

  return {
    schema: "listing-plan.v2",
    status,
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

/** 安全摘要（供 UI 展示，不含内部结构细节；v2 增加 status/bulletRoles） */
export function safeListingPlanSummary(plan: ListingPlan) {
  return {
    schema: plan.schema,
    status: plan.status,
    planQuality: plan.planQuality,
    primaryKeyword: plan.primaryKeyword,
    bulletPlanCount: plan.bulletPlans.length,
    bulletRoles: plan.bulletPlans.map((b) => ({
      role: b.role,
      claimMode: b.claimMode,
      factLabels: b.featureFactIds.map((id) => (id.startsWith("kw:") ? id : id)),
    })),
    backendTermsCount: plan.backendSearchTerms.length,
    missingFacts: plan.missingFacts,
    bulletFactsBound: plan.bulletPlans.every((b) => b.featureFactIds.length > 0),
  };
}

export { factById };

/* ── Step2：Capability 驱动的 Listing Plan 出口 ─────────────────────────────
 *
 * 与旧 buildListingPlan 共用同一 ListingPlan 结构，但计划条数由
 * ListingCapabilityV2 能力合同（evaluateListingCapability 结果）驱动：
 * 只消费 capability.eligibleGroups 中的核心组；identity / secondary_variant
 * 永不生成 Bullet；bulletPlans.length 精确等于 targetBulletCount（最多 5）。
 * claimGroup 承担事实语义（绑定该组全部去重 factId），role 只承担表达角度
 * （固定 5 角色顺序分配，正式 3-5 条时唯一）。
 * 纯函数：无 DB/网络/env/Date.now/随机；不修改输入；同输入同输出。
 * -------------------------------------------------------------------------─ */

import {
  CORE_CLAIM_GROUPS,
  IDENTITY_GROUP,
  SECONDARY_VARIANT_GROUP,
  type ClaimGroupName,
  type ListingCapabilityResult,
} from "@/lib/listingHandoff/listingCapabilityV2";

/** Capability 驱动 Plan 的 5 个固定表达角色（顺序固定） */
const CAPABILITY_ROLE_ORDER: readonly ListingPlanRole[] = [
  "core_outcome",
  "pain_relief",
  "use_scenario",
  "ease_of_use",
  "proof_or_fit",
];

/** 组 → 表达角度（claimGroup 承载事实语义；role 只承载表达） */
const CAPABILITY_GROUP_ANGLE_HINTS: Record<ClaimGroupName, string> = {
  identity: "商品身份",
  material_construction: "材质与构造",
  size_capacity_fit: "容量/尺寸/重量与适配",
  core_function_operation: "核心功能与操作方式",
  use_scenario: "使用场景",
  care_cleaning: "清洁与保养",
  package_contents: "随附组件与包装",
  proof_performance: "认证/性能/时长",
  secondary_variant: "颜色/款式",
};

export type CapabilityBulletPlan = ListingBulletPlan & { claimGroup: ClaimGroupName };

export type CapabilityDrivenPlan = Omit<ListingPlan, "bulletPlans" | "schema"> & {
  schema: "listing-plan.v2";
  bulletPlans: CapabilityBulletPlan[];
};

/**
 * 由 ListingCapabilityV2 能力合同驱动的 Listing Plan（纯函数）。
 * 与旧 buildListingPlan 并存（Step3 再切换权威调用点）。
 */
export function buildListingPlanFromCapability(
  input: ListingGenerationInput,
  keywordBrief: ListingKeywordBrief | null,
  capability: ListingCapabilityResult,
): CapabilityDrivenPlan {
  const coreGroupNames: ClaimGroupName[] = CORE_CLAIM_GROUPS.filter(
    (group) => capability.eligibleGroups.some((g) => g.group === group),
  );

  // 按固定顺序取 targetBulletCount 个核心组（最多 5）
  const groups = coreGroupNames.slice(0, capability.targetBulletCount);

  const primaryKeyword = keywordBrief?.primaryKeyword ?? null;
  const supportingKeywords = keywordBrief?.supportingKeywords ?? [];
  const backendSearchTerms = keywordBrief?.backendSearchTerms ?? [];
  const keywordIdsValid = keywordBrief !== null && primaryKeyword !== null;
  const keywordIdsFor = (index: number): string[] => {
    if (!keywordIdsValid) return [];
    const kw: string[] = [];
    if (primaryKeyword) kw.push("kw:primary");
    const support = supportingKeywords.length > 0 ? [supportingKeywords[index % supportingKeywords.length]] : [];
    if (support.length) kw.push("kw:supporting:" + support[0]);
    return kw;
  };

  // shopperNeed 差异化：复用既有 shopperNeedOfRole（同一实现，不新建第二套映射）
  const baseNeed = shopperNeedOf(input.creativeContext?.vocInsights ?? []);
  const bulletPlans = groups.map((group, index) => {
    const eligible = capability.eligibleGroups.find((g) => g.group === group);
    const factIds = [...new Set(eligible ? eligible.factIds : [])];
    const role = CAPABILITY_ROLE_ORDER[index] ?? "core_outcome";
    return {
      role,
      claimGroup: group,
      shopperNeed: shopperNeedOfRole(role, baseNeed),
      shopperAngle: CAPABILITY_GROUP_ANGLE_HINTS[group] ?? "实际使用价值",
      featureFactIds: factIds,
      evidenceRefs: [],
      keywordIds: keywordIdsFor(index),
      claimMode: "verified",
      cannotSay: [...DEFAULT_CANNOT_SAY],
    } satisfies ListingBulletPlan & { claimGroup: ClaimGroupName };
  });

  // status：isBlocked → needs_review；target<3 → needs_facts；正式能力缺关键词 → needs_keywords；否则 ready
  const status: ListingPlanStatus = capability.isBlocked
    ? "needs_review"
    : capability.targetBulletCount < 3
      ? "needs_facts"
      : (keywordBrief === null || primaryKeyword === null)
        ? "needs_keywords"
        : "ready";

  // planQuality：canCallProvider=true → optimized；否则 safe_fact_draft
  const planQuality: ListingPlan["planQuality"] = capability.canCallProvider ? "optimized" : "safe_fact_draft";

  const descriptionPlan = "产品用途 + 关键功能 + 使用场景 + 买方价值（全部基于已确认事实）";

  return {
    schema: "listing-plan.v2",
    status,
    primaryKeyword,
    supportingKeywords,
    titlePlan: [],
    bulletPlans,
    descriptionPlan,
    backendSearchTerms,
    missingFacts: capability.targetBulletCount < 3 ? ["较少的事实不足以生成正式 Listing（至少 3 条）。"] : [],
    prohibitedClaims: input.prohibitedClaims,
    planQuality,
  };
}
