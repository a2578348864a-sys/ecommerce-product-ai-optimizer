/**
 * Listing Capability V2 —— 事实支撑 Bullet 能力合同（纯函数）。
 *
 * 本模块是「事实能支撑几条 Bullet」的单一判定出口，供后续统一主链与独立
 * Listing Studio 共用。它只消费已经 listingClaimPolicy 裁决过的事实
 * （tier = verified / review / prohibited），不复制、不另造禁词/高风险规则。
 *
 * 基本规则：
 * - 只有 verified 且非空事实参与能力计算；review / prohibited / 未知字段
 *   不得增加 Bullet 数。
 * - 固定分组：同一卖点组最多贡献一条核心 Bullet；一组最多 +1。
 * - identity（品牌/类型/系列）只用于身份，不计 Bullet；
 *   secondary_variant（颜色/变体）只辅助，不增加正式 Bullet 数。
 * - supportedBulletCount 最大为 5；>=3 条才算正式 Listing。
 *
 * 纯函数：无 DB / 文件 / 环境变量 / 网络 / Provider / 日期 / 随机；同输入同输出。
 */

export const LISTING_CAPABILITY_V2_VERSION = "listing-capability-v2.v1" as const;

/** 事实分级（与 listingClaimPolicy 的 ClaimTier 对齐；只消费其裁决结果） */
export type ListingCapabilityTier = "verified" | "review" | "prohibited";

export type ListingCapabilityFact = {
  factId: string;
  field: string;
  value: string;
  tier: ListingCapabilityTier;
};

/** 能力等级：facts_only / partial_draft / standard_draft / full_draft */
export type ListingCapabilityLevel =
  | "facts_only"
  | "partial_draft"
  | "standard_draft"
  | "full_draft";

/** 固定分组集合（name → fields） */
export type ClaimGroupName =
  | "identity"
  | "material_construction"
  | "size_capacity_fit"
  | "core_function_operation"
  | "use_scenario"
  | "care_cleaning"
  | "package_contents"
  | "proof_performance"
  | "secondary_variant";

export const IDENTITY_GROUP: ClaimGroupName = "identity";
export const SECONDARY_VARIANT_GROUP: ClaimGroupName = "secondary_variant";

/** 固定分组：全部字段归属（同一事实只属于一组；不重复计入） */
export const CLAIM_GROUPS: Record<ClaimGroupName, readonly string[]> = {
  identity: ["brand", "product_type", "series_or_model"],
  material_construction: ["material", "construction"],
  size_capacity_fit: ["capacity", "dimension", "dimensions", "weight", "size", "compatibility"],
  core_function_operation: [
    "functional_feature",
    "operation",
    "drinking_mechanism",
    "lid_behavior",
    "insulation",
    "carry",
  ],
  use_scenario: ["usage"],
  care_cleaning: ["care", "cleaning"],
  package_contents: ["included_components", "quantity_or_pack_size"],
  proof_performance: ["certification", "performance", "duration"],
  secondary_variant: ["color_or_variant"],
};

/** 核心卖点组（可贡献正式 Bullet 的组），顺序固定；identity/secondary_variant 不在其中 */
export const CORE_CLAIM_GROUPS: readonly ClaimGroupName[] = [
  "material_construction",
  "size_capacity_fit",
  "core_function_operation",
  "use_scenario",
  "care_cleaning",
  "package_contents",
  "proof_performance",
];

export const TARGET_BULLET_MAX = 5;
export const STANDARD_DRAFT_MIN = 3;
export const FULL_DRAFT_MIN = 5;
export const SUGGESTED_QUESTION_MAX = 3;

export type ClaimEligibleGroup = {
  group: ClaimGroupName;
  factIds: string[];
};

export type ListingCapabilityResult = {
  version: typeof LISTING_CAPABILITY_V2_VERSION;
  level: ListingCapabilityLevel;
  supportedBulletCount: number;
  targetBulletCount: number;
  canCallProvider: boolean;
  hasIdentity: boolean;
  isBlocked: boolean;
  eligibleGroups: ClaimEligibleGroup[];
  missingClaimGroups: ClaimGroupName[];
  suggestedQuestions: string[];
};

/** 已知字段 → 组；未知字段返回 null（不得增加 Bullet 数） */
export function claimGroupOfField(field: string): ClaimGroupName | null {
  const normalized = String(field ?? "").trim();
  if (!normalized) return null;
  for (const [group, fields] of Object.entries(CLAIM_GROUPS) as Array<[ClaimGroupName, readonly string[]]>) {
    if (fields.includes(normalized)) return group;
  }
  return null;
}

/** 该事实是否可用于能力计算：仅 verified 且值非空（已知字段） */
export function factContributes(fact: ListingCapabilityFact): boolean {
  return fact?.tier === "verified" && String(fact?.value ?? "").trim().length > 0;
}

/**
 * 单件默认数量（1 Count / 1 count 等）无消费者选择价值：
 * 保留为已确认内部事实，但不消耗卖点组、不进入正式文案。
 * 只处理 quantity_or_pack_size；有界单件默认值：规范化后恰为 "1 count"。
 * 多件装（10/12/21 Count）、组合装（2-pack set / 1 set with 3 pieces）不受影响。
 */
export function isTrivialSingleUnitQuantity(field: string, value: string): boolean {
  if (String(field ?? "").trim() !== "quantity_or_pack_size") return false;
  const norm = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/g, "");
  return norm === "1 count" || norm === "1 ct" || norm === "1ct";
}

/**
 * 判定事实能支撑几条 Bullet（纯函数）。
 * @param input.facts 已经 listingClaimPolicy 裁决的事实（tier 已定）
 * @param input.hasBlockingIssue 是否已有阻断性问题（如 Quality 门禁命中等）
 */
export function evaluateListingCapability(input: {
  facts: ReadonlyArray<ListingCapabilityFact>;
  hasBlockingIssue?: boolean;
}): ListingCapabilityResult {
  const facts = input?.facts ?? [];
  const hasBlockingIssue = input?.hasBlockingIssue === true;

  // 1) 按组收集 verified 非空事实（去重 factId）
  const groupToFactIds = new Map<ClaimGroupName, Set<string>>();
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!factContributes(fact)) continue;
    // 1 Count：保留确认事实但不组卖点（数量无消费者价值，不得占正式 Bullet）
    if (isTrivialSingleUnitQuantity(fact.field, fact.value)) continue;
    const group = claimGroupOfField(fact.field);
    if (!group) continue;
    if (seen.has(fact.factId)) continue;
    seen.add(fact.factId);
    if (!groupToFactIds.has(group)) groupToFactIds.set(group, new Set());
    groupToFactIds.get(group)!.add(fact.factId);
  }

  const hasIdentity = groupToFactIds.has(IDENTITY_GROUP);

  // 2) 核心组（按固定顺序）：每组最多 +1
  const eligibleGroups: ClaimEligibleGroup[] = [];
  // identity 仅用于身份（不计 Bullet），但有内容时如实进入 eligibleGroups
  const identityIds = groupToFactIds.get(IDENTITY_GROUP);
  if (identityIds && identityIds.size > 0) {
    eligibleGroups.push({ group: IDENTITY_GROUP, factIds: [...identityIds] });
  }
  let supportedBulletCount = 0;
  for (const group of CORE_CLAIM_GROUPS) {
    const ids = groupToFactIds.get(group);
    if (!ids || ids.size === 0) continue;
    eligibleGroups.push({ group, factIds: [...ids] });
    supportedBulletCount = Math.min(supportedBulletCount + 1, TARGET_BULLET_MAX);
  }
  // secondary_variant 仅辅助：进入 eligibleGroups 但不增加 supportedBulletCount
  const variantIds = groupToFactIds.get(SECONDARY_VARIANT_GROUP);
  if (variantIds && variantIds.size > 0) {
    eligibleGroups.push({ group: SECONDARY_VARIANT_GROUP, factIds: [...variantIds] });
  }

  // 3) 等级与目标条数
  let level: ListingCapabilityLevel;
  let targetBulletCount: number;
  if (supportedBulletCount >= FULL_DRAFT_MIN) {
    level = "full_draft";
    targetBulletCount = TARGET_BULLET_MAX;
  } else if (supportedBulletCount >= STANDARD_DRAFT_MIN) {
    level = "standard_draft";
    targetBulletCount = supportedBulletCount;
  } else if (supportedBulletCount === 2) {
    level = "partial_draft";
    targetBulletCount = 2;
  } else {
    level = "facts_only";
    targetBulletCount = 0;
  }

  // 4) canCallProvider：>=3 条且无阻断且具备身份
  const canCallProvider =
    supportedBulletCount >= STANDARD_DRAFT_MIN && hasIdentity && !hasBlockingIssue;

  // 5) 缺失核心组（未进入 eligibleGroups 的 CORE 组）
  const presentCore = new Set(eligibleGroups.map((g) => g.group));
  const missingClaimGroups: ClaimGroupName[] = CORE_CLAIM_GROUPS.filter((g) => !presentCore.has(g));

  // 6) suggestedQuestions：仅针对缺失核心组，最多 3 个，按固定顺序
  const GROUP_QUESTION_HINTS: Record<ClaimGroupName, string> = {
    identity: "缺少品牌/商品类型/系列型号（身份事实）。",
    material_construction: "缺少材质/构造事实，无法支撑卖点。",
    size_capacity_fit: "缺少容量/尺寸/重量/兼容性事实。",
    core_function_operation: "缺少功能特性/操作方式/保温等核心功能事实。",
    use_scenario: "缺少使用场景事实。",
    care_cleaning: "缺少清洁/保养事实。",
    package_contents: "缺少随附组件/包装数量事实。",
    proof_performance: "缺少认证/性能/时长事实。",
    secondary_variant: "缺少颜色/款式变体事实。",
  };
  const suggestedQuestions = missingClaimGroups
    .slice(0, SUGGESTED_QUESTION_MAX)
    .map((g) => GROUP_QUESTION_HINTS[g]);

  return {
    version: LISTING_CAPABILITY_V2_VERSION,
    level,
    supportedBulletCount,
    targetBulletCount,
    canCallProvider,
    hasIdentity,
    isBlocked: hasBlockingIssue,
    eligibleGroups,
    missingClaimGroups,
    suggestedQuestions,
  };
}
