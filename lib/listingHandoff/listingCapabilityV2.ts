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
 * 事实已通过 Claim Policy 并不代表它一定有安全的消费者句型。
 * 这些高风险复合词即使被确认，也不能作为“可渲染能力”去占用计划名额；
 * 否则 Capability 会承诺一条 Renderer 最终必然拒绝的 Bullet。
 */
export function isSafeRenderableFact(fact: ListingCapabilityFact): boolean {
  if (!factContributes(fact)) return false;
  if (isTrivialSingleUnitQuantity(fact.field, fact.value)) return false;
  if (String(fact.field ?? "").trim() === "functional_feature" && /(?:food\s*safe|waterproof|sturdy)/i.test(String(fact.value ?? ""))) {
    return false;
  }
  return true;
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

/** 归一化 token：小写、去两端非字母数字、拆空格；不做词干，仅做单复数去尾 s。 */
function identityTokensOf(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.replace(/'s$/i, "").replace(/s$/i, ""))
    .filter((w) => w.length > 1 || /^\d+$/.test(w));
}

const SINGLE_UNIT_WORDS = new Set(["count", "ct", "pc", "pcs", "piece", "pieces", "set", "pack", "bundle", "box", "bag", "kit", "unit", "units", "ea"]);
const RELATION_WORDS = new Set(["with", "for", "plus", "including", "and", "or", "includes", "incl"]);

function parseSingleQuantity(tokens: string[]): { count: number | null; nextIndex: number } {
  const head = tokens[0];
  if (!head) return { count: null, nextIndex: 0 };
  const numMatch = /^(\d+)$/.exec(head);
  if (numMatch) return { count: Number(numMatch[1]), nextIndex: 1 };
  const pkMatch = /^(\d+)-(?:pack|pcs?|ct|count|set|piece|pieces)$/.exec(head);
  if (pkMatch) return { count: Number(pkMatch[1]), nextIndex: 1 };
  if (head === "one" || head === "a" || head === "an") return { count: 1, nextIndex: 1 };
  return { count: null, nextIndex: 0 };
}

/**
 * 低价值"单件自身"事实（通用判定，无商品词表、不用动态正则拼商品值）：
 * included_components / quantity_or_pack_size 的"1 个 + 与商品类型同义名词短语"（如
 * "1 Expandable Silverware Organizer" 之于 Organizer）是商品自身而不是配件，无消费者选择价值。
 * 判定（全部按词形/结构）：
 *   1) 数量解析：前导数量=1（1/one/a/an 或 2-pack 拆出 2）→ 继续；数量>=2/multipack → 非单件自身；
 *   2) 剥单位/容器词（count/ct/pc/piece/set/pack/kit/unit…）；剩空 → 单件默认（true）；
 *   3) 含 with/for/plus/including/and/or 等配件关系词 → 真附件/组合（false）；
 *   4) 类型中心核对：typeLabel 的有义词都在短语中，且短语末位语义 token 与 typeLabel 末位相同
 *      （即"修饰语 + 类型"形态，"type ... X"或独立名词则不是）。
 */
export function isTrivialSingleUnitSelfReference(field: string, value: string, typeLabel: string): boolean {
  const f = String(field ?? "").trim();
  if (f !== "included_components" && f !== "quantity_or_pack_size") return false;
  const tokens = identityTokensOf(value);
  if (tokens.length === 0) return false;
  const { count, nextIndex } = parseSingleQuantity(tokens);
  if (count !== null && count !== 1) return false;
  let rest = tokens.slice(nextIndex).filter((w) => !SINGLE_UNIT_WORDS.has(w));
  if (rest.length === 0) return true;
  if (rest.some((w) => RELATION_WORDS.has(w))) return false;
  const typeTokens = identityTokensOf(typeLabel).filter((w) => !RELATION_WORDS.has(w));
  if (typeTokens.length === 0) return false;
  const allIncluded = typeTokens.every((t) => rest.includes(t));
  if (!allIncluded) return false;
  return rest[rest.length - 1] === typeTokens[typeTokens.length - 1];
}

/** 单件自身句的两种规范消费者句式 → 提取被包含组件的名词短语；非该句式返回 null。 */
function extractIncludedPhrase(sentence: string): string | null {
  const s = String(sentence ?? "").trim();
  const m1 = /^the included component is (.+?)[.!]?$/i.exec(s);
  if (m1) return m1[1].trim();
  const m2 = /^a (.+?) is included with the/i.exec(s);
  if (m2) return m2[1].trim();
  return null;
}

/**
 * 通用句式级判定（供 Copy Quality 兜底与历史旧稿重判复用同一底层规则）：
 * "The included component is 1 {…}" / "A {…} is included with the …" 句中被包含组件
 * 若为"数量=1/无数量 + 无 with/for 关系 + 与身份文本同义（双向词集覆盖其一 + 末位命中）"
 * → 单件自身句。
 * identityText 可为 typeLabel（copyQuality）或快照 title 首段（历史重判）。
 */
export function detectSingleUnitSelfSentence(sentence: string, identityText: string): boolean {
  const content = extractIncludedPhrase(sentence);
  if (!content) return false;
  const contentTokens = identityTokensOf(content);
  if (contentTokens.length === 0) return false;
  const { count, nextIndex } = parseSingleQuantity(contentTokens);
  if (count !== null && count !== 1) return false;
  const rest = contentTokens.slice(nextIndex).filter((w) => !SINGLE_UNIT_WORDS.has(w));
  if (rest.length === 0) return true;
  if (rest.some((w) => RELATION_WORDS.has(w))) return false;
  // 身份文本取首段（title 首个逗号前 = 品牌/型号/类型段；typeLabel 无逗号即整体）
  const identityTokens = identityTokensOf(String(identityText ?? "").split(/[,;|]/)[0])
    .filter((w) => !RELATION_WORDS.has(w));
  if (identityTokens.length === 0) return false;
  const restSet = new Set(rest);
  const identitySet = new Set(identityTokens);
  const identityInRest = identityTokens.every((t) => restSet.has(t));
  const restInIdentity = rest.every((w) => identitySet.has(w));
  if (!identityInRest && !restInIdentity) return false;
  return identitySet.has(rest[rest.length - 1]);
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

  // 身份类型（verified product_type）用于"单件自身"语义判定（无类型则保守放行）
  const productTypeValue = facts.find((f) => f.tier === "verified" && String(f.field ?? "").trim() === "product_type")?.value ?? "";

  // 1) 按组收集 verified 非空事实（去重 factId）；package_contents 的单件自身事实不占用组名额
  const groupToFactIds = new Map<ClaimGroupName, Set<string>>();
  const seen = new Set<string>();
  for (const fact of facts) {
    if (!isSafeRenderableFact(fact)) continue;
    const group = claimGroupOfField(fact.field);
    if (!group) continue;
    if (group === "package_contents" && productTypeValue && isTrivialSingleUnitSelfReference(fact.field, fact.value, productTypeValue)) continue;
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
