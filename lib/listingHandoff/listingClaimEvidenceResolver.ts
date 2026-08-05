import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import type { ListingGenerationInput } from "@/lib/listingHandoff/listingGenerationInput";

/**
 * PR2-2 Final-Fix (P1-1): Claim Evidence Mapping — 结构化事实声明验证。
 *
 * 职责（只验证，不生成）：
 * 检查 Listing 文本中的事实性声明是否有 Handoff 证据支撑。
 * 纯函数：无 DB / 无网络 / 无环境变量 / 同输入同输出 / 不修改输入。
 *
 * 与既有 filterListingClaims（逐字关键词替换）互补：
 * - filterListingClaims：已知风险短语的精确替换（继续保留）。
 * - 本模块：结构性映射 —— 数值/材质/尺寸/认证/性能/兼容性/AI参考/Unknown/Conflict。
 *
 * 验证规则（来自 PR2-2 Final-Fix 规格第六节）：
 * - 数字：文本中的重量/长度/容量等数值必须能在 allowed facts 中找到（宽松：单位变体/截断）。
 * - 材质：文本中出现材质线索（中文"材质/用料"或已知材质名词/缩写）时必须能在 facts 中找到（不允许"航空级 ABS"等扩写）。
 * - 尺寸：无尺寸事实时 "超大尺寸" 等无证据定性词拒绝。
 * - 认证：无认证事实 → 任何"认证/approved/certified"输出拒绝。
 * - 性能：无性能事实 → 百分比提升/效果声称拒绝。
 * - 兼容性：无兼容事实 → "兼容/works with"输出拒绝。
 * - AI Reference：creativeReferences 只是措辞参考；"适合户外风格"→"专为户外设计"式事实化改写拒绝。
 * - Unknown：handoff 未知项不得被补全输出。
 * - Conflict：handoff 冲突项不得被单方裁定输出。
 * - 文案调整：允许结构重排/语气优化/非事实营销表达（不视为事实性 claim）。
 *
 * 说明性/否定性文本（如 "Draft is not published, certified or approved"、
 * "Human review is required before publishing"、"Confirmed: <事实原样>"、
 * "handoff rev 1 (research 1)"、"需人工确认"）不是事实性 claim，不触发证据检查。
 */

export type ListingClaimVerification = {
  supportedClaims: string[];
  unsupportedClaims: Array<{ text: string; reason: string }>;
  rejectedReason: string | null;
  evidence: {
    factFields: string[];
    allowedValues: string[];
  };
};

type Category = "dimension" | "material" | "certification" | "performance" | "compatibility" | "other";

type FactCategory = {
  category: Category;
  values: string[];
  labels: string[];
  present: boolean;
};

const KNOWN_FACT_FIELD_PATTERNS: Array<{ category: Category; pattern: RegExp }> = [
  { category: "dimension", pattern: /^(?:size|dimension|length|width|height|diameter|thickness|尺寸)/i },
  { category: "material", pattern: /^(?:material|材质|材料)/i },
  { category: "certification", pattern: /^(?:certification|certificate|certified|认证|资质)/i },
  { category: "performance", pattern: /^(?:performance|effect|result|power|speed|capacity|性能|效果|功率|速度|容量)/i },
  { category: "compatibility", pattern: /^(?:compatib|works with|fit|适配|兼容)/i },
];

/** 无证据定性词/扩写词（航空级/医用级/超大/已认证 等）→ 无条件拒绝 */
const UNSUPPORTED_QUALIFIERS = [
  /航空级/i, /医用级/i, /食品级/i, /军用级/i, /工业级/i,
  /超大/i, /超小/i, /超强/i, /极速/i, /极致/i, /超轻/i, /超重/i,
  /已验证/i, /已认证/i, /认证通过/i,
];

/** 否定性文本标记：命中则跳过证据检查（非事实性 claim） */
const NEGATION_MARKERS = /\b(?:not|no|nothing|never|unless|without)\b|不会|不是|没有|无需|并非|未经|未获|不承诺|不保证|尚未|不适用/i;
/** 说明/指令性文本标记：命中则跳过证据检查（非事实性 claim） */
const INSTRUCTION_MARKERS = /\b(?:required|must|need|please|review|check|confirm|verify|ensure|note|draft only|before any use|against supplier|listing draft|handoff rev|research \d+|human review|manual confirmation|against platform rules)\b|需人工|人工确认|待确认|需确认|需核实|以供应商|请人工|供人工|仅供参考/i;
const RELAY_PREFIX = /^confirmed:/i;

/** 说明性/否定性文本：不是事实性 claim，跳过证据检查 */
function isNonClaimText(text: string): boolean {
  if (RELAY_PREFIX.test(text.trim())) return true;
  if (NEGATION_MARKERS.test(text)) return true;
  if (INSTRUCTION_MARKERS.test(text)) return true;
  return false;
}

/** 中文无空格分词：字符级 bigram 提取（用于 Unknown/AI Reference 相似度） */
function charBigrams(value: string): string[] {
  const compact = value.normalize("NFKC").replace(/\s+/g, "");
  const grams: string[] = [];
  for (let i = 0; i + 1 < compact.length; i++) grams.push(compact.slice(i, i + 2));
  return grams;
}

/** 提取 fact 的分类与值（字段名 + 数值/短词 token） */
function classifyFacts(facts: Array<{ field: string; label: string; value: string }>): FactCategory[] {
  const categories: FactCategory[] = [
    { category: "dimension", values: [], labels: [], present: false },
    { category: "material", values: [], labels: [], present: false },
    { category: "certification", values: [], labels: [], present: false },
    { category: "performance", values: [], labels: [], present: false },
    { category: "compatibility", values: [], labels: [], present: false },
    { category: "other", values: [], labels: [], present: false },
  ];
  for (const fact of facts) {
    let matched = false;
    for (const { category, pattern } of KNOWN_FACT_FIELD_PATTERNS) {
      if (pattern.test(fact.field) || pattern.test(fact.label)) {
        const cat = categories.find((c) => c.category === category)!;
        cat.values.push(fact.value.trim().toLocaleLowerCase());
        cat.labels.push(`${fact.label} (${fact.field})`.trim());
        cat.present = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const other = categories.find((c) => c.category === "other")!;
      other.values.push(fact.value.trim().toLocaleLowerCase());
      other.present = true;
    }
  }
  return categories;
}

/** 每次调用创建新正则实例，避免全局 lastIndex 状态污染 */
function numberMatches(value: string): Array<{ digit: string; num: number }> {
  return [...value.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((m) => {
      const digit = m[0].replace(",", ".");
      const num = Number.parseFloat(digit);
      return { digit, num: Number.isNaN(num) ? -1 : num };
    })
    .filter((m) => m.num >= 0);
}

/** 数字证据匹配：文本中的数值能被某个 fact 值覆盖（宽松：单位变体/截断） */
function matchesNumericEvidence(text: string, factValues: string[]): boolean {
  if (factValues.length === 0) return false;
  const textDigits = numberMatches(text);
  if (textDigits.length === 0) return false;
  for (const factValue of factValues) {
    const factDigits = numberMatches(factValue);
    for (const fd of factDigits) {
      if (textDigits.some((td) => td.num === fd.num)) return true;
    }
  }
  return false;
}

/** 已知材质名词（触发材质检查的中文词） */
const MATERIAL_NOUNS = /(?:不锈钢|铝合金|合金|塑料|金属|木质|纯棉|涤纶|尼龙|碳纤维|玻璃|陶瓷|橡胶|硅胶|钢材|钢化|亚克力|真皮|皮革|ABS|PP|PC|PVC|PU|TPU|硅胶)/i;
/** 材质断言触发词（出现即视为材质声明） */
const MATERIAL_ASSERTION = /(?:材质|用料|材料)/i;
/** 材质声明中的说明性修饰（需/待/未/无/确认/核实等） */
const MATERIAL_NON_CLAIM = /(?:需|待|未|无|确认|核实|confirm|verify|以供应商|supplier)/i;

/** 材质证据匹配：文本中的材质 token（中文名词或大写缩写）能在 fact 值中找到 */
function matchesMaterialEvidence(text: string, factValues: string[]): boolean {
  if (factValues.length === 0) return false;
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase();
  return factValues.some((value) => {
    const normalizedValue = value.normalize("NFKC").toLocaleLowerCase();
    if (!normalizedValue) return false;
    if (normalizedText.includes(normalizedValue)) return true;
    if (/^[a-z]{2,}$/.test(normalizedValue) && new RegExp(`\\b${normalizedValue}\\b`, "i").test(text)) return true;
    return false;
  });
}

/** 无证据定性词（航空级/超大/已认证 等）→ 拒绝 */
function unsupportedQualifier(text: string): string | null {
  for (const marker of UNSUPPORTED_QUALIFIERS) {
    if (marker.test(text)) return marker.source;
  }
  return null;
}

/** 事实值中包含数字则视为可验证数字（重量/尺寸/容量/速度等） */
function categoryHasNumericFact(category: FactCategory): boolean {
  return category.values.some((value) => /\d/.test(value));
}

const CERTIFICATION_TERMS = /(?:认证|certified|approved|ce\s*certified|fda\b)/i;
const PERFORMANCE_TERMS = /(?:提升|增加|加快|减少|降低|提速|加速|\d+\s*%|效果|性能|功率|速度)/i;
const COMPATIBILITY_TERMS = /(?:兼容|适配|works with|compatible)/i;
const CONFLICT_ADJUDICATION_TERMS = /(?:选择|采用|按照|以.*为准|prefer)/i;

/** 提取文本中事实性声明并验证（只报告，不修改文本） */
export function verifyListingClaims(
  draft: AiListingPackDraft,
  input: ListingGenerationInput,
): ListingClaimVerification {
  const unsupportedClaims: Array<{ text: string; reason: string }> = [];
  const supportedClaims: string[] = [];
  const categories = classifyFacts(input.productFacts);
  const dimension = categories.find((c) => c.category === "dimension")!;
  const material = categories.find((c) => c.category === "material")!;
  const certification = categories.find((c) => c.category === "certification")!;
  const performance = categories.find((c) => c.category === "performance")!;
  const compatibility = categories.find((c) => c.category === "compatibility")!;

  const texts = [
    ...draft.titles,
    ...draft.bullets,
    draft.description,
    ...draft.keywords,
    ...draft.sellingPoints,
    ...draft.riskNotes,
  ].filter(Boolean);

  const creativeReferences = input.creativeReferences.map((ref) => ref.normalize("NFKC").toLocaleLowerCase());
  const unknownTexts = input.unknowns.map((u) => u.normalize("NFKC").toLocaleLowerCase());
  const unknownBigrams = unknownTexts.flatMap((u) => charBigrams(u)).filter((g) => g.length === 2);
  const unknownTokens = unknownTexts.flatMap((u) => u.split(/[，,、;；。:：\s]+/).filter((t) => t.length >= 2));

  const prohibitedSet = new Set(input.prohibitedClaims.map((p) => p.normalize("NFKC").toLocaleLowerCase()));

  for (const text of texts) {
    const normalized = text.normalize("NFKC");
    if (!normalized) continue;
    const lower = normalized.toLocaleLowerCase();

    // 0) 禁止声明（结构化：原样 + 同义 token 全含改写）— 最先执行（含否定词也拦截）
    let prohibitedHit = false;
    for (const p of prohibitedSet) {
      if (!p) continue;
      if (lower.includes(p)) {
        unsupportedClaims.push({ text, reason: `prohibited_claim: ${p.slice(0, 80)}` });
        prohibitedHit = true;
        break;
      }
      const tokens = p.split(/[，,、;；。:：\s]+/).filter((t) => t.length >= 2);
      if (tokens.length >= 2 && tokens.every((t) => lower.includes(t))) {
        unsupportedClaims.push({ text, reason: `prohibited_claim_rewrite: ${p.slice(0, 80)}` });
        prohibitedHit = true;
        break;
      }
    }
    if (prohibitedHit) continue;

    // 1) AI Reference 事实化改写（"适合户外风格" → "专为户外设计"）
    if (creativeReferences.length > 0) {
      const factualizedVerb = /(?:专为|专供|采用|专用于|使用|打造)/.test(normalized);
      if (factualizedVerb && creativeReferences.some((ref) => {
        if (!ref) return false;
        const refBigrams = charBigrams(ref);
        return refBigrams.length >= 2 && refBigrams.some((g) => lower.includes(g));
      })) {
        unsupportedClaims.push({ text, reason: "ai_reference_factualized" });
        continue;
      }
    }

    // 2) 说明性/否定性文本（非事实性 claim）→ 跳过类别证据检查
    if (isNonClaimText(normalized)) {
      supportedClaims.push(`instructional: ${text.slice(0, 80)}`);
      continue;
    }

    // 3) Conflict 单方裁定（先于 Unknown：冲突语境更特定）
    let conflictHit = false;
    for (const u of unknownTexts) {
      if (!u) continue;
      if (/冲突|conflict|不一致|矛盾/i.test(u) && CONFLICT_ADJUDICATION_TERMS.test(lower)) {
        unsupportedClaims.push({ text, reason: "conflict_adjudicated" });
        conflictHit = true;
        break;
      }
    }
    if (conflictHit) continue;

    // 4) Unknown 补全（未知项被具体化输出；中文 bigram 覆盖无空格分词）
    let unknownHit = false;
    if (unknownTokens.length > 0 || unknownBigrams.length > 0) {
      const tokenHit = unknownTokens.find((token) => lower.includes(token));
      if (tokenHit) {
        unsupportedClaims.push({ text, reason: `unknown_completed: ${tokenHit.slice(0, 60)}` });
        unknownHit = true;
      } else {
        const bigramHit = unknownBigrams.find((g) => lower.includes(g));
        if (bigramHit) {
          unsupportedClaims.push({ text, reason: `unknown_completed: ${bigramHit.slice(0, 60)}` });
          unknownHit = true;
        }
      }
    }
    if (unknownHit) continue;

    // 5) 无证据定性词/扩写词（无条件：航空级 ABS / 超大尺寸 等）
    {
      const qualifier = unsupportedQualifier(normalized);
      if (qualifier) {
        unsupportedClaims.push({ text, reason: "unsupported_qualifier" });
        continue;
      }
    }

    // 6) 认证（无认证事实 → 拒绝）
    if (!certification.present && CERTIFICATION_TERMS.test(normalized)) {
      unsupportedClaims.push({ text, reason: "certification_without_evidence" });
      continue;
    }

    // 7) 性能（无性能事实 → 拒绝百分比/效果声称）
    if (!performance.present && PERFORMANCE_TERMS.test(normalized)) {
      unsupportedClaims.push({ text, reason: "performance_without_evidence" });
      continue;
    }

    // 8) 兼容性（无兼容事实 → 拒绝）
    if (!compatibility.present && COMPATIBILITY_TERMS.test(normalized)) {
      unsupportedClaims.push({ text, reason: "compatibility_without_evidence" });
      continue;
    }

    // 9) 材质（仅当文本含材质线索时检查）
    const hasMaterialCue = MATERIAL_ASSERTION.test(normalized) || MATERIAL_NOUNS.test(normalized);
    if (hasMaterialCue) {
      if (material.present) {
        if (!matchesMaterialEvidence(normalized, material.values)) {
          unsupportedClaims.push({ text, reason: "material_without_evidence" });
          continue;
        }
        supportedClaims.push(`material: ${text.slice(0, 100)}`);
        continue;
      }
      if (!MATERIAL_NON_CLAIM.test(normalized)) {
        unsupportedClaims.push({ text, reason: "material_without_evidence" });
        continue;
      }
    }

    // 10) 数字证据（文本含数字且存在数字事实 → 必须匹配；有数字但无数字事实 → 拒绝发明数字）
    if (/\d/.test(normalized)) {
      const numericCategories = [dimension, material, performance, certification, compatibility, categories.find((c) => c.category === "other")!]
        .filter((c) => c.present && categoryHasNumericFact(c));
      if (numericCategories.length > 0) {
        const allValues = numericCategories.flatMap((c) => c.values);
        if (!matchesNumericEvidence(normalized, allValues)) {
          unsupportedClaims.push({ text, reason: "number_without_evidence" });
          continue;
        }
        supportedClaims.push(`numeric: ${text.slice(0, 100)}`);
        continue;
      }
      unsupportedClaims.push({ text, reason: "number_invented_without_fact" });
      continue;
    }

    supportedClaims.push(`ok: ${text.slice(0, 100)}`);
  }

  const rejectedReason = unsupportedClaims.length > 0
    ? unsupportedClaims[0].reason
    : null;

  return {
    supportedClaims,
    unsupportedClaims,
    rejectedReason,
    evidence: {
      factFields: [...new Set(input.productFacts.map((f) => f.field))],
      allowedValues: [...new Set(input.productFacts.map((f) => f.value))],
    },
  };
}

/** 断言：验证结果为通过（无未支持声明） */
export function listingClaimsHaveEvidence(result: ListingClaimVerification): boolean {
  return result.unsupportedClaims.length === 0;
}
