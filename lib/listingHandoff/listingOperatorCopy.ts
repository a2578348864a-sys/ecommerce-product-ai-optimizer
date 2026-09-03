/**
 * Listing Operator Copy（阶段 B 自然语言编辑器）
 *
 * 只做“在不改变事实的前提下让句子更自然”的编辑：
 * - 输入：阶段 A 原句 + Plan 角色 + 事实（field/value 对）
 * - 输出：仅调整语序、句式、冠词、大小写、标点、段落组织；
 * - factRefs（规范化 field=value 集合）逐项必须完全相等；
 * - 不得引入输入中不存在的事实名词/数值/性能/场景/收益/效果；
 * - 不得把推测、关键词、营销表达变成商品事实；
 * - 不得删除关键限制条件（如 care 的 only、操作类的 after/before 引导）；
 * - 无法在不改变事实的前提下安全编辑 → 保留阶段 A 原句（fail-closed，不强行润色）。
 *
 * 本模块只做纯文本变换；不访问 Provider/DB/网络；不修改任何门禁阈值。
 */

import type { ListingPlanRole } from "@/lib/listingHandoff/listingPlan";

export type OperatedFact = {
  /** 字段名（product_fact.field 语义） */
  field: string;
  /** 该事实的英文渲染/原值（阶段 A 句子依赖的表达） */
  value: string;
};

export type StageBInput = {
  /** 阶段 A 原句（composeControlledBullets / composeDescription 产物） */
  sentence: string;
  /** 该句锚定的事实（用于合成 factRefs 与词面校验） */
  facts: OperatedFact[];
  /** Plan 角色 */
  role?: ListingPlanRole;
  /** 已出现的句首形态数量（用于开头节奏去重） */
  usedOpenings?: Record<string, number>;
  /** 最近前两句的开头模式（用于防止连续3句相同开头） */
  recentPatterns?: string[];
};

export type StageBOutput = {
  /** 编辑后句子（若无法安全编辑则与输入完全相同） */
  sentence: string;
  /** 规范化 factRefs（keys=field，values=value）；任何路径必须与原句一致 */
  factRefs: Record<string, string>;
  /** 是否实际发生了编辑（false=保留原句 fail-closed） */
  edited: boolean;
  /** 编辑原因 */
  reason: string;
};

function normalizeFactKey(value: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/** 规范化 factRefs：按 field 唯一化（同字段多值合并为集合）。 */
export function buildFactRefs(facts: OperatedFact[]): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const f of facts ?? []) {
    const k = String(f.field ?? "");
    if (!k) continue;
    const v = normalizeFactKey(f.value);
    if (!v) continue;
    if (!(k in refs)) refs[k] = v;
    else if (refs[k] !== v) refs[k] = refs[k] + " | " + v;
  }
  return refs;
}

/**
 * V2 不变量：数字串、单位/限定词（only/not/up to/approximately 等闭合语义词）在句级编辑后
 * 必须原样保留；新增非闭类词也判失败。仅判定词面与词性，与商品无关。
 */
export function stageBSentenceInvariantOk(before: string, after: string): boolean {
  const tokenize = (text: string) => String(text).toLowerCase().split(/[^a-z0-9\u00c0-\u024f'’/.-]+/).filter(Boolean);
  const beforeTokens = tokenize(before);
  const afterTokens = new Set(tokenize(after));
  for (const w of beforeTokens) {
    if (/\d/.test(w) && !afterTokens.has(w)) return false;
  }
  const INVARIANT_QUALIFIERS = new Set(["only", "not", "no", "never", "up", "approximately", "about", "around", "max", "maximum", "min", "minimum", "per", "daily", "weekly"]);
  for (const w of beforeTokens) {
    if (INVARIANT_QUALIFIERS.has(w) && !afterTokens.has(w)) return false;
  }
  for (const w of afterTokens) {
    if (!beforeTokens.includes(w) && !CLOSED_GRAMMAR_WORDS.has(w)) return false;
  }
  return true;
}

export function wordSetOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9\u00c0-\u024f'’/-]+/)) {
    const w = raw.trim();
    if (w && w.length > 1) out.add(w);
  }
  return out;
}

/** 严格白名单中的闭类语法词（冠词、代词、连词、介词、助动词/系动词） */
const CLOSED_GRAMMAR_WORDS = new Set([
  "it", "this", "that", "these", "those",
  "a", "an", "the",
  "and", "with", "or", "but",
  "its", "their", "them",
  "for", "to", "in", "on", "at", "by", "from", "of", "as", "after", "before", "when",
  "is", "are", "was", "were", "has", "have", "can", "features", "includes",
]);

/**
 * 安全编辑通用保险丝：编辑若改变 factRefs 或引入新词面，返回 null（保留原句）。
 */
function guardedEdit(
  sentence: string,
  facts: OperatedFact[],
  edit: (s: string) => string,
): string | null {
  const beforeRefs = buildFactRefs(facts);
  const beforeWords = wordSetOf(sentence);
  let edited: string;
  try {
    edited = edit(String(sentence).trim());
  } catch {
    return null;
  }
  if (!edited || edited === String(sentence).trim()) return null;
  const afterRefs = buildFactRefs(facts);
  const afterWords = wordSetOf(edited);
  if (JSON.stringify(afterRefs) !== JSON.stringify(beforeRefs)) return null;

  // V2：数字/单位/限定词句级不变量（丢数/丢单位/丢限定词 → 保险丝熔断回退）
  if (!stageBSentenceInvariantOk(sentence, edited)) return null;
  // 严禁引入非白名单闭类词的任何新词
  for (const w of afterWords) {
    if (CLOSED_GRAMMAR_WORDS.has(w)) continue;
    if (!beforeWords.has(w)) return null;
  }
  // 必须完整保留事实核心词
  for (const f of facts ?? []) {
    const vk = normalizeFactKey(f.value).toLowerCase();
    if (!vk) continue;
    const meaningful = vk.split(/\s+/).filter((w) => w.length > 2);
    for (const w of meaningful) {
      if (!afterWords.has(w)) return null;
    }
  }
  return edited;
}

export type SentenceSyntax = "product-subject" | "action-leading" | "imperative-care" | "feature-noun" | "unknown";

export function classifySyntax(sentence: string): SentenceSyntax {
  const s = String(sentence ?? "").trim();
  if (/^(?:for care|for cleaning|hand\s?wash|wipe|rinse|clean|machine\s?wash)/i.test(s)) return "imperative-care";
  if (/^(?:use the|uses a|after placing|before using|when using)/i.test(s)) return "action-leading";
  if (/^(?:the|this)\b/i.test(s) && /\b(?:includes?|features?)\b/i.test(s) && !/\b(?:is|are|was|were|has|have|measures?|weighs?|fits?|comes?|works?)\b/i.test(s)) return "feature-noun";
  if (/^(?:the|this|it)\b/i.test(s) && /\b(?:is|are|was|were|has|have|includes?|features?|measures?|weighs?|fits?|comes?|works?)\b/i.test(s)) return "product-subject";
  return "unknown";
}

/** 句首形态的规范键（用于节奏去重：相同句首形态最多出现 2 次）。 */
export function openingKeyOf(sentence: string): string {
  const s = String(sentence ?? "").trim();
  const m = s.match(/^([A-Za-z][a-z]*\s+(?:the\s+)?(?:[a-z]+\s+)?(?:is|are|was|were|has|have|includes?|features?|measures?|weighs?|fits?|comes?|works?)\b)/i);
  if (m) return m[1].replace(/\s+/g, " ").toLowerCase();
  const m2 = s.match(/^([A-Za-z][a-z]*[^,.]{0,20})/);
  return (m2 ? m2[1] : s.slice(0, 12)).toLowerCase();
}

/** 获取句子的主语形态类型（the-noun, it, this-noun, other） */
function subjectPatternOf(sentence: string): "the-noun" | "it" | "this-noun" | "other" {
  const s = String(sentence ?? "").trim();
  if (/^it\b/i.test(s)) return "it";
  if (/^this\b/i.test(s)) return "this-noun";
  if (/^the\b/i.test(s)) return "the-noun";
  return "other";
}

function applyOpeningVariant(
  sentence: string,
  role: ListingPlanRole | undefined,
  usedOpenings: Record<string, number> | undefined,
  recentPatterns?: string[],
): string {
  if (!usedOpenings) return sentence;
  const key = openingKeyOf(sentence);
  const count = usedOpenings[key] ?? 0;

  // 检查是否连续 2 句已经是以 "the" 或 "it" 开头
  const prev1 = recentPatterns?.[recentPatterns.length - 1];
  const prev2 = recentPatterns?.[recentPatterns.length - 2];
  const consecutiveThe = prev1 === "the-noun" && prev2 === "the-noun";
  const consecutiveIt = prev1 === "it" && prev2 === "it";

  // 若相同规范化开头已 ≥2 次，或发生连续 2 次相同主语开头 → 触发句式切换
  if (count < 2 && !consecutiveThe && !consecutiveIt) {
    return sentence;
  }

  // 1. 如果连续 2 句为 "The [Noun]"，或该开头已满 2 次：
  if (/^The\s+[A-Za-z]/i.test(sentence)) {
    // 若上一句不是 "it"，优先使用 "It <verb>"
    if (prev1 !== "it" && !consecutiveIt) {
      // The <Subject> <verb> → It <verb>（严格锚定动词，绝不制造悬空句）
      const itVar = sentence.replace(
        /^The\s+[A-Za-z][A-Za-z ]*?(?=\s+(?:is|has|includes?|measures?|weighs?|fits|features?|can|works?|opens?|uses?|comes?|holds?)\b)/i,
        "It"
      ).replace(/\s{2,}/g, " ").trim();
      if (itVar !== sentence) return itVar;
    }
    // 否则使用 "This <Subject> <verb>"
    return sentence.replace(/^The\b/i, "This");
  }

  // 2. 如果连续 2 句为 "It"，切换为 "This <verb>"
  if (/^It\b/i.test(sentence) && consecutiveIt) {
    return sentence.replace(/^It\b/i, "This");
  }

  return sentence;
}

/**
 * 描述段落编辑：把多句机械拼接改为自然连贯段落（factRefs 不变；不增加句子内容）。
 * 顺序：产品身份 → 核心结构/用途 → 适配或规格 → 护理
 * 只重排与自然化已有句序，不新增未经确认的收益/效果。
 */
export function editDescriptionForCoherence(description: string): { text: string; edited: boolean; reason: string } {
  const parts = String(description ?? "")
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length < 2) {
    return { text: String(description ?? ""), edited: false, reason: "单句描述无需编辑" };
  }

  const identity = parts[0];
  const care = parts.slice(1).filter((s) => /^(?:for care|for cleaning|hand\s?wash|wipe|rinse|clean|machine\s?wash)/i.test(s));
  const specs = parts.slice(1).filter((s) => /\b(?:measures|weighs|dimensions|weight)\b/i.test(s) && !care.includes(s));
  const coreFacts = parts.slice(1).filter((s) => !specs.includes(s) && !care.includes(s));

  // 严格顺序：身份 → 核心用途/结构 → 适配/规格 → 护理
  const reordered = [identity, ...coreFacts, ...specs, ...care];

  // 阶段B段落代词与句首去重优化
  const optimizedSentences: string[] = [];
  for (let i = 0; i < reordered.length; i++) {
    let s = reordered[i];
    // 身份句保持完整商品身份；第2句及后续若重复出现 "The <Noun> is/has..."，平滑指代
    if (i > 0 && /^The\s+[A-Za-z][A-Za-z ]*?(?=\s+(?:is|has|includes?|measures?|weighs?|fits|features?|can|works?|opens?|uses?|comes?|holds?)\b)/i.test(s)) {
      if (!optimizedSentences[i - 1]?.startsWith("It")) {
        const candidate = s.replace(
          /^The\s+[A-Za-z][A-Za-z ]*?(?=\s+(?:is|has|includes?|measures?|weighs?|fits|features?|can|works?|opens?|uses?|comes?|holds?)\b)/i,
          "It"
        ).replace(/\s{2,}/g, " ").trim();
        // 确保替换后词数仍 ≥ 6（符合 Runtime Quality 描述每句词数下限合同）
        if (candidate.split(/\s+/).filter(Boolean).length >= 6) {
          s = candidate;
        } else {
          // 词数不足 6 时采用 "This <Subject>" 避免 "The" 重复且保留词数
          s = s.replace(/^The\b/i, "This");
        }
      }
    }
    optimizedSentences.push(s);
  }

  const text = optimizedSentences.join(" ");
  if (text === String(description ?? "").trim()) {
    return { text, edited: false, reason: "已是最佳顺序" };
  }
  return { text, edited: true, reason: "结构按身份→用途→规格→护理重排并平滑指代" };
}

/**
 * 阶段 B 主入口（单句编辑）。
 * 事实或词面不安全时原样返回（fail-closed）。
 */
export function applyStageBEdit(input: StageBInput): StageBOutput {
  const sentence = String(input.sentence ?? "").trim();
  const refs = buildFactRefs(input.facts);
  if (!sentence) {
    return { sentence: "", factRefs: refs, edited: false, reason: "空句" };
  }
  let editedSentence: string | null = null;
  let reason = "";
  const variant = applyOpeningVariant(sentence, input.role, input.usedOpenings, input.recentPatterns);
  if (variant !== sentence) {
    const g = guardedEdit(sentence, input.facts, () => variant);
    if (g) { editedSentence = g; reason = "开头节奏已按角色切换"; }
  }
  if (!editedSentence) {
    const g = guardedEdit(sentence, input.facts, (s) => {
      let t = s.replace(/\.+$/, "") + ".";
      return t;
    });
    if (g && g !== sentence) { editedSentence = g; reason = "句尾标点归一"; }
  }
  return {
    sentence: editedSentence ?? sentence,
    factRefs: refs,
    edited: Boolean(editedSentence),
    reason: reason || (editedSentence ? "编辑" : "无法安全编辑，保留阶段 A 原句"),
  };
}

/** 批量编辑五点（保持顺序；factRefs 单句校验） */
export function applyStageBToBullets(
  sentences: string[],
  factMap: Array<OperatedFact[]>,
  roles?: Array<ListingPlanRole | undefined>,
): { bullets: string[]; factRefs: Array<Record<string, string>>; editedCount: number } {
  const usedOpenings: Record<string, number> = {};
  const recentPatterns: string[] = [];
  const out: string[] = [];
  const refsList: Array<Record<string, string>> = [];
  let edited = 0;
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i];
    const facts = factMap[i] ?? [];
    const outR = applyStageBEdit({
      sentence: s,
      facts,
      role: roles?.[i],
      usedOpenings,
      recentPatterns,
    });
    const key = openingKeyOf(outR.sentence);
    usedOpenings[key] = (usedOpenings[key] ?? 0) + 1;
    recentPatterns.push(subjectPatternOf(outR.sentence));
    if (outR.edited) edited += 1;
    out.push(outR.sentence);
    refsList.push(outR.factRefs);
  }
  return { bullets: out, factRefs: refsList, editedCount: edited };
}
