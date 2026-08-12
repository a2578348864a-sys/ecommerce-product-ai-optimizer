import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

/**
 * PR2-2 Claim Final-Fix: 结构化事实正向放行（conservative positive allow）。
 *
 * 原则（规格第五-九节）：
 * - 不再以"未命中黑名单"放行事实；
 * - 能进入 Listing 的事实必须在 Handoff 结构化 Evidence Index 中找到依据；
 * - 证据不明确时默认拒绝（宁可保守）。
 *
 * 流程：
 *   Listing 表达
 *     ↓ 句段切分（title/bullets/description/keywords/sellingPoints/riskNotes）
 *     ├─ 精确属于冻结中性文案允许集 → 允许
 *     ├─ 含事实性信号（数字/高风险类别词/Index 事实值）
 *     │    └─ 所有事实性成分映射到 Evidence Index（含保守模板）且无未支持修饰 → 允许
 *     │    └─ 否则拒绝（unclassified_factual_claim / unsupported_*_claim）
 *     └─ 无事实性信号的纯文案（无数字/无类别词/无事实值）→ 允许（中性）
 *
 * Evidence Index 只来自允许用于 Listing 的 confirmedFacts（productFacts）。
 * stableSourceFacts 为 internal-only 时全部排除；AI creativeReferences / unknown /
 * conflict / prohibitedClaims / 来源快照 / Visual / actor / requestId / Ledger / Hash 永不进入。
 *
 * 归一化仅允许：Unicode NFC / 大小写 / 首尾空白 / 连续空白 / 常规中英文标点 / 单位空格（20cm 与 20 cm）。
 * 禁止：单位换算、语义同义推断、材质等级推断、性能推断、认证推断、产地推断。
 *
 * 高风险类别（第八节）：数字单位 / 材质等级 / 认证标准 / 兼容范围 / 性能耐久 /
 * 产地制造 / 健康安全效果 / 绝对化永久 —— 检测后必须映射 Evidence，否则拒绝。
 *
 * 对外统一错误码：listing_claims_unsupported（浏览器不返回内部 Evidence）。
 */

export type ListingClaimVerification = {
  supportedClaims: string[];
  neutralPhrases: string[];
  unsupportedClaims: Array<{ text: string; reason: string }>;
  prohibitedClaims: string[];
  reasonCode: string | null;
  fieldPath: string[];
  evidence: {
    factFields: string[];
    allowedValues: string[];
  };
};

export type ClaimReasonCode =
  | "unsupported_numeric_claim"
  | "unsupported_material_claim"
  | "unsupported_dimension_claim"
  | "unsupported_certification_claim"
  | "unsupported_compatibility_claim"
  | "unsupported_performance_claim"
  | "unsupported_origin_claim"
  | "unsupported_effect_claim"
  | "unsupported_absolute_claim"
  | "ai_reference_fact_claim"
  | "unknown_fact_claim"
  | "conflict_fact_claim"
  | "unclassified_factual_claim"
  | "prohibited_claim";

type FactType =
  | "brand"
  | "category"
  | "material"
  | "dimension"
  | "weight"
  | "color"
  | "certification"
  | "compatibility"
  | "performance"
  | "origin"
  | "quantity"
  | "product_type"
  | "series_or_model"
  | "other";

type EvidenceEntry = {
  canonicalField: string;
  normalizedValue: string;
  factType: FactType;
  allowedExactForms: string[];
  allowedUsage: "listing";
  sourceTier: "confirmed";
  sourceFactId: string;
};

// ─── 字段 → 事实类型分类（canonical field 匹配）────────────────

const FIELD_TYPE_PATTERNS: Array<{ type: FactType; pattern: RegExp }> = [
  { type: "brand", pattern: /^(?:brand|品牌)$/i },
  { type: "category", pattern: /^(?:category|类目|分类)$/i },
  { type: "material", pattern: /^(?:material|材质|材料)$/i },
  { type: "dimension", pattern: /^(?:size|dimension|length|width|height|diameter|thickness|capacity|容量|尺寸|长度|宽度|高度|直径)/i },
  { type: "weight", pattern: /^(?:weight|重量|净重)/i },
  { type: "color", pattern: /^(?:color|colour|颜色|色彩|color_or_variant)/i },
  { type: "certification", pattern: /^(?:certification|certificate|certified|认证|资质|标准)/i },
  { type: "compatibility", pattern: /^(?:compatib|works with|fit|适配|兼容)/i },
  { type: "performance", pattern: /^(?:performance|effect|result|power|speed|性能|效果|功率|速度)/i },
  { type: "origin", pattern: /^(?:origin|产地|制造地)/i },
  { type: "quantity", pattern: /^(?:quantity|count|数量|件数|quantity_or_pack_size)/i },
  // V2.1.3：title-derived 字段分类（有确认事实证据才允许对应声明）
  { type: "product_type", pattern: /^(?:product_type|商品类型|product type)/i },
  { type: "series_or_model", pattern: /^(?:series_or_model|系列\/型号|series|model|型号)/i },
];

function classifyField(field: string, label: string): FactType {
  for (const { type, pattern } of FIELD_TYPE_PATTERNS) {
    if (pattern.test(field) || pattern.test(label)) return type;
  }
  return "other";
}

// ─── 归一化（仅允许的安全归一化）────────────────────────────

function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，]/g, ",")
    .replace(/[。]/g, ".")
    .replace(/[；]/g, ";")
    .replace(/[：]/g, ":")
    // 全角括号 → 半角：filterListingClaims 的 NFKC 归一化会转换括号，
    // 证据值与段必须使用同一形式才能匹配（R3 回归：防水防汗（80分钟）vs 防水防汗(80分钟)）
    .replace(/[（）]/g, (match) => (match === "（" ? "(" : ")"))
    .replace(/\s*([.,;:!?])/g, "$1")
    .toLocaleLowerCase();
}

/** 紧凑归一化（去全部空白，用于高风险词/中性集模式匹配；不用于事实值匹配） */
function compactText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "").toLocaleLowerCase();
}

/** 单位空格归一化：20cm ↔ 20 cm（仅此一种单位空格变体） */
function normalizeUnitSpacing(value: string): string {
  return value.replace(/(\d)\s+(cm|mm|m|kg|g|ml|l|w|v|hz|ah|mah|inch|寸)/gi, "$1$2");
}

/** 正则字面转义（剥离循环用词边界正则匹配证据原文） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 剥离证据值前的尾部标点归一：源 fact 句尾标点（。、. 等）经 normalizeText 保留在
 * evidence 值中，但组合草稿经 splitSegments 切分后该标点被吞掉，导致完整值剥离不匹配
 * （如 evidence="宽口设计,便于清洁和加冰." vs segment="...宽口设计,便于清洁和加冰"）。
 * 剥离时同时尝试"带尾部标点"与"去尾部标点"两种形态。
 */
function stripTrailingPunct(value: string): string {
  return value.replace(/[.,;:!?、]+$/g, "");
}

// ─── 冻结中性文案允许集（第九节 B）──────────────────────────

const NEUTRAL_COPY_ALLOWLIST = Object.freeze([
  "日常使用的实用选择",
  "简洁实用的选择",
  "清晰呈现产品特点",
  "现代简约风格",
  "简洁现代的设计",
  "值得信赖的优质之选",
  "轻松融入日常使用",
  "适合日常使用的实用选择",
  "实用之选",
  "设计简约大方",
  "一款实用的产品",
  "适用于日常场景",
  "为生活增添便利",
  "简单好用的选择",
  "满足日常需求",
  "结构清晰",
  "外观简洁",
  "使用方便",
  "便于携带",
  "适合桌面",
  "便于日常使用",
  "易于使用",
  "方便实用",
  "适合各种场合",
  "日常使用方便",
  "for the target market",
  "practical listing draft",
  "listing draft",
  "cross-border product",
  "human review required",
]);

// ─── 高风险事实类别触发词（第八节）──────────────────────────
// 用于"识别 Claim 类别"，识别后必须进入 Evidence Mapping；
// 命中词 + 无对应 Evidence → 拒绝；命中词 + 有 Evidence 且保守表达 → 允许。

const HIGH_RISK_CATEGORY_PATTERNS: Array<{ category: ClaimReasonCode; pattern: RegExp }> = [
  { category: "unsupported_material_claim", pattern: /(?:复合材料|环保(?:型|材料)?|航空级|工程级|医用级|食品级|军用级|工业级|高品质|reinforced|环保材质|混合材质|材质升级)/i },
  { category: "unsupported_dimension_claim", pattern: /(?:加大型|加长|超大|超小|超轻|超重|轻量化|compact\s*size|extra\s*long|lightweight|更大|更小|更轻|加宽|加高)/i },
  { category: "unsupported_certification_claim", pattern: /(?:认证|certified|approved|compliant|符合.*标准|标准认证|品质认证|安全认证|meets\s*industry\s*standards)/i },
  { category: "unsupported_compatibility_claim", pattern: /(?:兼容|适配|适用于|通用|所有型号|workswith|compatiblewith|广泛适配|universallycompatible|适配主流|fits?(?:most)?cupholders?|cupholdercompatible)/i },
  { category: "unsupported_performance_claim", pattern: /(?:高强度|超耐用|经久耐用|持久耐用|防摔|防水|防尘|防刮|抗冲击|heavyduty|enhanceddurability|superiorperformance|更耐用|耐用|经久使用|更快|更强|更持久|提升|性能|easytosqueeze|spill-?resistant|comfortablegrip)/i },
  { category: "unsupported_origin_claim", pattern: /(?:制造|made\s*in|原装进口|imported\s*quality|locally\s*made|美国制造|德国制造|日本制造|中国制造|进口)/i },
  { category: "unsupported_effect_claim", pattern: /(?:百分百有效|guaranteed\s*effective|绝对有效|健康效果|治疗效果|保护效果|安全保证|100\s*percent\s*effective|guaranteed\s*results)/i },
  { category: "unsupported_absolute_claim", pattern: /(?:永久|永不|绝不|不会损坏|100%|guaranteed|never\s*fails|绝对可靠|绝对安全|always)/i },
];

// ─── 数字检测 ──────────────────────────────────────────────

function containsNumber(text: string): boolean {
  return /\d/.test(text);
}

// ─── Evidence Index 构建（纯函数）───────────────────────────

export function buildListingClaimEvidenceIndex(input: ListingGenerationInput): EvidenceEntry[] {
  // 只使用允许用于 Listing 的 confirmedFacts（productFacts）；
  // stableSourceFacts 为 internal-only（当前恒为空）→ 全部排除。
  return input.productFacts.map((fact) => {
    const factType = classifyField(fact.field, fact.label);
    const normalizedValue = normalizeUnitSpacing(normalizeText(fact.value));
    const safeId = `${factType}:${fact.field}`;
    return {
      canonicalField: fact.field,
      normalizedValue,
      factType,
      allowedExactForms: [normalizedValue],
      allowedUsage: "listing" as const,
      sourceTier: "confirmed" as const,
      sourceFactId: safeId,
    };
  });
}

// ─── 句段切分（分号/句号/换行；小数点后跟数字不切分）────────────

function splitSegments(text: string): string[] {
  // 先保护小数点（. 后跟数字 → 占位符），再按分隔符切分，最后还原
  const protectedText = text.replace(/(\d)\.(\d)/g, "$1__DEC__$2");
  return protectedText
    .split(/[.;;。\n]+/)
    .map((s) => s.trim().replace(/__DEC__/g, "."))
    .filter(Boolean);
}

// ─── 事实值在段中的匹配（保守：值原样或带模板词）──────────────

function segmentContainsEvidenceValue(segment: string, entries: EvidenceEntry[]): EvidenceEntry | null {
  const normalized = normalizeUnitSpacing(normalizeText(segment));
  for (const entry of entries) {
    if (!entry.normalizedValue) continue;
    // 值原样（含单位空格归一）
    if (normalized.includes(entry.normalizedValue)) return entry;
  }
  return null;
}

/**
 * 从已确认的长文本事实中提取“原文连续短语”，只用于多事实自然组合。
 * 这里不做同义词、营销词或语义推断；输出必须逐字来自 confirmed evidence。
 */
function confirmedContentFragments(entries: EvidenceEntry[]): string[] {
  const fragments = new Set<string>();
  for (const entry of entries) {
    if (!["other", "performance"].includes(entry.factType) || entry.normalizedValue.length < 20) continue;
    const tokens = entry.normalizedValue.match(/[\p{L}\p{N}]+/gu) ?? [];
    const maxWindow = Math.min(tokens.length, 6);
    // 窗口含 1（单 token 原文词）："covered SoftSip straw" 等原文短语的词序
    // 可能与窗口切片不一致，须允许逐字单词剥离；仍只来自 confirmed evidence。
    for (let size = 1; size <= maxWindow; size += 1) {
      for (let start = 0; start + size <= tokens.length; start += 1) {
        const fragment = normalizeText(tokens.slice(start, start + size).join(" "));
        if (compactText(fragment).length >= (size === 1 ? 5 : 8)) fragments.add(fragment);
      }
    }
  }
  return [...fragments].sort((a, b) => b.length - a.length);
}

/** 段中的事实值数量（含重复）——用于检测"合法事实 + 非法修饰混合" */
function evidenceValueCount(segment: string, entries: EvidenceEntry[]): number {
  const normalized = normalizeUnitSpacing(normalizeText(segment));
  return entries.filter((e) => e.normalizedValue && normalized.includes(e.normalizedValue)).length;
}

// ─── 中性文案判定 ──────────────────────────────────────────

function isNeutralCopy(segment: string): boolean {
  const normalized = normalizeText(segment);
  return NEUTRAL_COPY_ALLOWLIST.some((phrase) => normalized === normalizeText(phrase));
}

// ─── 高风险类别检测（compact 模式匹配，容忍 Unicode 空白）────────

function detectHighRiskCategories(segment: string): ClaimReasonCode[] {
  const compact = compactText(segment);
  const hits: ClaimReasonCode[] = [];
  for (const { category, pattern } of HIGH_RISK_CATEGORY_PATTERNS) {
    if (pattern.test(compact)) hits.push(category);
  }
  return hits;
}

// ─── Unknown / Conflict / Prohibited 前置阻断 ───────────────

function detectUnknownCompletion(segment: string, input: ListingGenerationInput): string | null {
  const lower = normalizeText(segment);
  for (const u of input.unknowns) {
    const un = normalizeText(u);
    // unknown 的语义核心（去"未知/待确认"等后缀）：防水等级 → 段中出现"防水…IPX7"类具体值
    const core = un.replace(/(?:未知|待确认|待核实|未确认|需要确认|与.*冲突|冲突)$/g, "").trim();
    if (core.length >= 2 && lower.includes(core)) return core;
  }
  return null;
}

function detectConflictAdjudication(segment: string, input: ListingGenerationInput): boolean {
  const lower = normalizeText(segment);
  const hasConflictContext = input.unknowns.some((u) => /冲突|conflict|不一致|矛盾/i.test(u));
  if (!hasConflictContext) return false;
  // 裁定必须针对冲突值（选择/采用/按照 + 数字或尺寸上下文）；纯文案"实用选择"不触发
  const adjudicationVerb = /(?:选择|采用|按照|以.*为准|prefer|确定|取)/i.test(lower);
  if (!adjudicationVerb) return false;
  // 段须含数字（冲突值为尺寸/数值）或尺寸类词
  return /\d/.test(lower) || /(?:尺寸|宽度|长度|高度|规格)/i.test(lower);
}

function detectProhibited(segment: string, input: ListingGenerationInput): string | null {
  const lower = normalizeText(segment);
  for (const p of input.prohibitedClaims) {
    const pn = normalizeText(p);
    if (!pn) continue;
    if (lower.includes(pn)) return pn;
    // 常见大小写/空白/标点变化已由 normalizeText 覆盖；token 全含改写
    const tokens = pn.split(/[,;:\s]+/).filter((t) => t.length >= 2);
    if (tokens.length >= 2 && tokens.every((t) => lower.includes(t))) return pn;
  }
  return null;
}

// ─── 主验证函数 ────────────────────────────────────────────

export function verifyListingClaims(
  draft: AiListingPackDraft,
  input: ListingGenerationInput,
): ListingClaimVerification {
  const unsupportedClaims: Array<{ text: string; reason: string }> = [];
  const supportedClaims: string[] = [];
  const neutralPhrases: string[] = [];
  const prohibitedClaims: string[] = [];
  const fieldPath: string[] = [];
  const entries = buildListingClaimEvidenceIndex(input);
  const evidenceValues = entries.map((e) => e.normalizedValue).filter(Boolean);

  const fields: Array<{ name: string; texts: string[] }> = [
    { name: "title", texts: draft.titles },
    { name: "bullet", texts: draft.bullets },
    { name: "description", texts: [draft.description] },
    { name: "keywords", texts: draft.keywords },
    { name: "sellingPoints", texts: draft.sellingPoints },
    { name: "riskNotes", texts: draft.riskNotes },
  ];

  for (const field of fields) {
    for (const text of field.texts) {
      if (!text || !text.trim()) continue;
      const segments = splitSegments(text);
      for (const segment of segments) {
        fieldPath.push(`${field.name}:${segment.slice(0, 60)}`);

        // 0) Prohibited 原样 + 变形（最高优先，含否定词也拦截）
        const prohibitedHit = detectProhibited(segment, input);
        if (prohibitedHit) {
          prohibitedClaims.push(prohibitedHit);
          unsupportedClaims.push({ text: segment, reason: "prohibited_claim" });
          continue;
        }
        // 0b) 绝对化/效果类别 fail-closed（prohibitedClaims 之外的绝对承诺）
        const absoluteHits = detectHighRiskCategories(segment).filter((c) => c === "unsupported_absolute_claim" || c === "unsupported_effect_claim");
        if (absoluteHits.length > 0) {
          unsupportedClaims.push({ text: segment, reason: absoluteHits[0] });
          continue;
        }

        // 1) Unknown 补全阻断
        const unknownHit = detectUnknownCompletion(segment, input);
        if (unknownHit) {
          unsupportedClaims.push({ text: segment, reason: "unknown_fact_claim" });
          continue;
        }

        // 2) Conflict 阻断：冲突上下文 + 段含冲突字段（与 unknown 中冲突项同字段）→ 未人工解决输出任一值均拒绝
        const conflictUnknown = input.unknowns.find((u) => /冲突|conflict|不一致|矛盾/i.test(u));
        if (conflictUnknown) {
          const conflictField = conflictUnknown.match(/(宽度|长度|高度|尺寸|规格|weight|length|width|height|size)/i)?.[1] ?? "";
          if (conflictField && new RegExp(conflictField, "i").test(segment)
            && (/\d/.test(segment) || /(?:选择|采用|按照|以.*为准|取|确定)/i.test(segment))) {
            unsupportedClaims.push({ text: segment, reason: "conflict_fact_claim" });
            continue;
          }
        }

        // 3) AI Reference 事实化（强事实化动词，避免误杀"使用/适合"）
        if (input.creativeReferences.length > 0) {
          const strongFactualizedVerb = /(?:专为|专供|专用于|精心打造|特别研发|专门研发|专门设计)/.test(segment);
          if (strongFactualizedVerb) {
            unsupportedClaims.push({ text: segment, reason: "ai_reference_fact_claim" });
            continue;
          }
        }

        // 3b) 说明性/否定性文本（未发布/未认证/需人工审核/草稿/不承诺/交接元数据）→ 非事实性 claim，跳过
        if (/(?:未发布|未认证|未获批|未获|未经|不承诺|不保证|尚未|需人工|待确认|需确认|需核实|仅供|draft only|not published|certified or approved|human review|before any use|not.*certified|nothing here is|handoff rev|handoff revision|research mode|research \d|listing draft|generated from a confirmed creative handoff|all stated product details|confirmed handoff facts|against supplier|against platform rules|ip risk|local compliance|reviewed before publishing)/i.test(segment)) {
          neutralPhrases.push(segment);
          continue;
        }

        // 3c) "Confirmed:" 前缀 → 事实复述段，跳过证据检查（值已在 Evidence Index 验证路径）
        if (/^confirmed[:：]/i.test(segment.trim())) {
          supportedClaims.push(segment);
          continue;
        }

        // 4) 冻结中性文案（精确匹配）→ 允许
        if (isNeutralCopy(segment)) {
          neutralPhrases.push(segment);
          continue;
        }

        // 5) 事实性信号检测
        const highRisk = detectHighRiskCategories(segment);
        const evidenceEntry = segmentContainsEvidenceValue(segment, entries);
        const hasNumber = containsNumber(segment);

        // 5b) 无 material Evidence 时，段含材质断言词 → 拒绝（材质无依据）
        const hasMaterialAssertion = /(?:材质|用料|材料|金属|塑料|木质|合金|不锈钢|纤维|棉|麻)/i.test(segment);
        if (hasMaterialAssertion && !entries.some((e) => e.factType === "material")) {
          unsupportedClaims.push({ text: segment, reason: "unsupported_material_claim" });
          continue;
        }

        // 6) 高风险类别词命中 → 默认拒绝。
        //    唯一例外：段含**同类别**事实值且修饰词为字段词/连接词（保守组合），
        //    如 certification=CE 时 "CE 认证"（值+字段词）允许，但 "环保ABS"（ABS 事实 +
        //    环保修饰）拒绝。
        //
        //    P1 修复（先于 6 的 6.5 完整复述放行）：已确认长文本事实被原样复述时，
        //    值内可能含高风险词（如 "防水" 属于 unsupported_performance_claim 词表），
        //    若先执行 high-risk 拒绝会把合法复述误杀为 unsupported_*_claim。
        //    完整值逐字相等即证据原样复述、无新增声明，因此放到高风险拒绝之前。
        {
          // 尾部标点剥离后比较：splitSegments 会把句尾的 。；！ 当作分隔符吞掉，
          // 事实值（如 "...补涂。"）切段后 normalize 与证据值差一个尾部 "."，
          // 必须剥掉双方尾部标点才能判定"逐字复述"，否则完整复述永远命中不了。
          const normalizedSegment = normalizeUnitSpacing(normalizeText(segment)).replace(/[.,;:!?]+$/g, "");
          const exactContentEntry = entries.find((e) =>
            ["other", "performance"].includes(e.factType)
            && e.normalizedValue.length >= 20
            && normalizedSegment === e.normalizedValue.replace(/[.,;:!?]+$/g, ""),
          );
          if (exactContentEntry) {
            supportedClaims.push(segment);
            continue;
          }
        }

        if (highRisk.length > 0) {
          const reasonType = (rc: ClaimReasonCode): FactType | null => {
            switch (rc) {
              case "unsupported_material_claim": return "material";
              case "unsupported_dimension_claim": return "dimension";
              case "unsupported_certification_claim": return "certification";
              case "unsupported_compatibility_claim": return "compatibility";
              case "unsupported_performance_claim": return "performance";
              case "unsupported_origin_claim": return "origin";
              default: return null;
            }
          };
          // 高风险词类别与命中事实值类别相同 → 保守组合允许（值原样 + 字段词）
          const sameCategoryCovered = highRisk.some((rc) => {
            const t = reasonType(rc);
            if (!t) return false;
            const entry = entries.find((e) => e.factType === t && e.normalizedValue);
            if (!entry) return false;
            // 值必须在段中且段除值+字段词外无其他事实性内容（由 5b/材质断言与 8 数字检查兜底）
            const normalized = normalizeUnitSpacing(normalizeText(segment));
            return normalized.includes(entry.normalizedValue);
          });
          // 高风险词是"材质等级/性能/效果/绝对"类修饰 → 即使有值也拒绝（修饰无依据）
          const pureModifier = highRisk.some((rc) =>
            rc === "unsupported_material_claim" || rc === "unsupported_performance_claim"
            || rc === "unsupported_effect_claim" || rc === "unsupported_absolute_claim");
          if (sameCategoryCovered && !pureModifier) {
            supportedClaims.push(segment);
            continue;
          }
          unsupportedClaims.push({ text: segment, reason: highRisk[0] });
          continue;
        }

        // 7) 有事实值且无高风险词 → 段中剩余部分须为：其他已确认事实值（多事实组合）/
        //    中性集成员 / 普通连接词，否则拒绝（合法事实 + 未允许文案 = 拒绝）
        if (evidenceEntry) {
          // 在空格归一文本上剥离，避免词边界歧义（compact 后无空格会破坏词边界）；
          // 单位空格（20 cm）先归一，使剥离值与证据值一致。
          let rest = normalizeUnitSpacing(normalizeText(segment));
          const contentEntries = entries.filter((entry) => ["other", "performance"].includes(entry.factType) && entry.normalizedValue.length >= 20);
          // 先剥离完整长事实，再处理其中的逐字连续短语，最后剥离短字段事实。
          // 这样既不会拆碎完整长事实，也不会先删掉 material 后破坏 "SoftSip Silicone Straw" 之类原文短语。
          // 每个值同时尝试"带尾部标点"与"去尾部标点"两种形态（splitSegments 会吞掉句尾标点）。
          for (const exactValue of contentEntries
            .map((entry) => entry.normalizedValue)
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)) {
            rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(exactValue)}(?![\\p{L}\\p{N}])`, "gi"), "");
            const stripped = stripTrailingPunct(exactValue);
            if (stripped !== exactValue) {
              rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stripped)}(?![\\p{L}\\p{N}])`, "gi"), "");
            }
          }
          // 保护 allow 词后再剥离 fragments：单 token 片段（如长事实中的 every）不得拆坏
          // allow 词（every ⊆ everyday）。剥离完成后还原。
          const protectedWords: string[] = [];
          rest = rest.replace(
            /\b(everyday|hydration|practical|construction|available|preference|capacity|matches|on-the-go)\b/gi,
            (match) => {
              protectedWords.push(match);
              return ` __P${protectedWords.length - 1}__ `;
            },
          );
          // 该步骤不允许同义改写或 Brief 派生词。
          // 词边界替换：防止单 token 片段（如 every）拆坏 allow 词（如 everyday）。
          for (const fragment of confirmedContentFragments(entries)) {
            rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(fragment)}(?![\\p{L}\\p{N}])`, "gi"), "");
          }
          protectedWords.forEach((word, i) => {
            rest = rest.replaceAll(`__P${i}__`, word);
          });
          for (const exactValue of entries
            .filter((entry) => !contentEntries.includes(entry))
            .map((entry) => entry.normalizedValue)
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)) {
            rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(exactValue)}(?![\\p{L}\\p{N}])`, "gi"), "");
            const stripped = stripTrailingPunct(exactValue);
            if (stripped !== exactValue) {
              rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stripped)}(?![\\p{L}\\p{N}])`, "gi"), "");
            }
          }
          rest = compactText(rest);
          // 剩余部分允许：其他 confirmed 事实值（组合事实，含部分重叠如 Bottle ⊆ Water Bottle）、
          // 中性词、字段词/连接词/介词
          const otherEvidenceValues = entries
            .filter((e) => e.normalizedValue && compactText(e.normalizedValue) !== compactText(evidenceEntry.normalizedValue))
            .map((e) => compactText(e.normalizedValue));
          let restCleaned = rest;
          for (const otherValue of otherEvidenceValues) {
            restCleaned = restCleaned.replace(otherValue, "");
          }
          // 部分重叠：剩余部分是某个 evidence 值的前缀/后缀（Bottle ⊆ Water Bottle）
          if (restCleaned.length > 0) {
            const overlapHit = otherEvidenceValues.some((v) => v.startsWith(restCleaned) || v.endsWith(restCleaned) || restCleaned.startsWith(v) || restCleaned.endsWith(v));
            if (overlapHit) restCleaned = "";
          }
          const restAllowed = restCleaned.length === 0
            || NEUTRAL_COPY_ALLOWLIST.some((p) => restCleaned.includes(compactText(p)))
            || /^(?:材质|材料|为|是|尺寸|长度|重量|颜色|品牌|类目|款|外壳|设计|价格|参考价格|评分|评论数|商品名|product|madeof|brand|category|material|color|weight|length|size|price|rating|reviewcount|usd|参考|(?:usd)|,|、|:|;|\(|\)|\.|-|的|与|和|及|产品|类别|净重|约|商品类型|类型|系列|型号|容量|数量|包装|颜色\/款式|系列\/型号|option|pairs|available|construction|capacity|practical|on-the-go|everyday|hydration|matches|your|style|preference|use|in|of|for|with|and|the|a|an)+$/i.test(restCleaned);
          if (!restAllowed) {
            unsupportedClaims.push({ text: segment, reason: "unclassified_factual_claim" });
            continue;
          }
          supportedClaims.push(segment);
          continue;
        }

        // 8) 有数字 → 数字必须精确匹配某个事实值的数字 token（非 substring）
        if (hasNumber) {
          const segmentDigits = [...segment.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
          const factDigits = new Set<string>();
          for (const e of entries) {
            for (const m of e.normalizedValue.matchAll(/\d+(?:[.,]\d+)?/g)) factDigits.add(m[0]);
          }
          const covered = segmentDigits.some((d) => factDigits.has(d));
          if (!covered) {
            unsupportedClaims.push({ text: segment, reason: "unsupported_numeric_claim" });
            continue;
          }
          supportedClaims.push(segment);
          continue;
        }

        // 9) 无任何事实性信号 → 纯文案中性表达 → 允许
        neutralPhrases.push(segment);
      }
    }
  }

  const reasonCode = unsupportedClaims.length > 0 ? (unsupportedClaims[0].reason as ClaimReasonCode) : null;

  return {
    supportedClaims,
    neutralPhrases,
    unsupportedClaims,
    prohibitedClaims,
    reasonCode,
    fieldPath,
    evidence: {
      factFields: [...new Set(input.productFacts.map((f) => f.field))],
      allowedValues: evidenceValues,
    },
  };
}

/** 断言：验证结果为通过（无未支持声明） */
export function listingClaimsHaveEvidence(result: ListingClaimVerification): boolean {
  return result.unsupportedClaims.length === 0;
}
