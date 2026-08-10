/**
 * Listing Backend Search Term Fact Safety（R1.6 + R1.6-Final）
 *
 * Backend Search Terms 是 Listing/Search Metadata，不是 Product Facts。
 * 有搜索需求 ≠ 商品具有该属性。
 *
 * 合同（R1.6-Final 冻结）：
 * 1. Brief Authority：最终 backend terms 必须首先来自 Listing Keyword Brief
 *    （AI 不能创建 Brief 外 keyword；normalize 后做确定性 membership 匹配）。
 * 2. Directional Evidence：较弱事实不得证明更强 claim
 *    （leak-resistant ≠ leakproof；water-resistant ≠ waterproof）。
 *    只允许同义等价或纯词形变化（leak-proof↔leakproof、insulation↔insulated、
 *    dishwasher-safe↔dishwasher safe）。
 * 3. always_blocked：best seller / guaranteed / 100% 等永久禁止，无论 Brief/事实。
 *
 * 处理顺序：raw AI terms → Brief membership → always-blocked → fact-bearing evidence
 * → generic relevance → dedupe → 250-byte（由调用方 Quality 层保证）。
 *
 * 裁决为 deterministic + 人工确认输入（Keyword Brief / confirmedFacts），
 * 禁止 AI 判定（AI 不得产生 keywordEvidenceIds）。
 *
 * 纯函数；无 DB/网络；同输入同输出。
 */

import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

/** 证据事实的最小形态（field/value + listing 使用范围） */
export type BackendEvidenceFact = { field: string; value: string; usageScopes: string[] };

/** 涉及商品具体属性/能力/安全/认证的 fact-bearing 危险词根（无事实证据即不可进 backend terms） */
const FACT_BEARING_TERM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "leakproof", pattern: /\bleak[-\s]?proof\b/i },
  { label: "waterproof", pattern: /\bwater[-\s]?proof\b/i },
  { label: "BPA-free", pattern: /\bBPA[-\s]?free\b/i },
  { label: "PFOA-free", pattern: /\bPFOA[-\s]?free\b/i },
  { label: "FDA approved", pattern: /\bFDA\s+approved\b/i },
  { label: "LFGB", pattern: /\bLFGB\b/i },
  { label: "food grade", pattern: /\bfood[-\s]?grade\b/i },
  { label: "medical grade", pattern: /\bmedical[-\s]?grade\b/i },
  { label: "non-toxic", pattern: /\bnon[-\s]?toxic\b/i },
  { label: "dishwasher-safe", pattern: /\b(?:dishwasher|dish-washer)[-\s]?safe\b/i },
  { label: "child safe", pattern: /\bchild[-\s]?safe\b/i },
  { label: "eco-friendly", pattern: /\beco[-\s]?friendly\b/i },
  { label: "insulated", pattern: /\binsulated\b/i },
  { label: "certified", pattern: /\bcertified\b/i },
  { label: "compatible with", pattern: /\bcompatible\s+with\b/i },
  { label: "anti-slip", pattern: /\banti[-\s]?slip\b/i },
  { label: "spill-proof", pattern: /\bspill[-\s]?proof\b/i },
  { label: "unbreakable", pattern: /\bunbreakable\b/i },
];

/** 永久禁止类：无论证据如何都不可进入 backend terms（沿用 prohibited claim 合同语义） */
const ALWAYS_BLOCKED_TERM_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "best seller", pattern: /\bbest[\s-]?seller\b/i },
  { label: "guaranteed", pattern: /\bguarantee[ds]\b/i },
  { label: "100%", pattern: /\b100\s*%\b/ },
];

/**
 * 方向性证据：危险词根 → 可支持的 fact 词（只允许同义等价/纯词形变化，禁止语义强化）。
 * 语义强度映射由人工冻结，非 AI 判定。
 * 注意方向：term 危险根（强 claim）只能由同强度 fact 支持；较弱 fact（如 leak-resistant）
 * 不在 factWords 中 → 不支持。
 */
const DIRECTIONAL_EVIDENCE: Array<{ dangerWord: string; supportedFactWords: string[] }> = [
  // leakproof（强）仅由 leakproof 词形支持；leak/leak-resistant 不在列 → 不支持
  { dangerWord: "leakproof", supportedFactWords: ["leakproof", "leak-proof"] },
  { dangerWord: "waterproof", supportedFactWords: ["waterproof", "water-proof"] },
  { dangerWord: "insulated", supportedFactWords: ["insulated", "insulation", "insulate"] },
  { dangerWord: "dishwasher safe", supportedFactWords: ["dishwasher", "dishwasher safe", "dishwasher-safe"] },
  { dangerWord: "bpa free", supportedFactWords: ["bpa free", "bpa-free"] },
];

/** 确定性归一化：NFC + lowercase + trim + collapse whitespace + 安全连字符归一化 */
export function normalizeBackendTermForMatch(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 方向性证据检查：term 命中的危险词根，只能由同强度/同形 fact 支持。
 * matchedDangerWords 为已归一化的危险词根词。
 */
function hasDirectionalFactEvidence(
  term: string,
  dangerRoots: string[],
  facts: BackendEvidenceFact[],
): boolean {
  if (dangerRoots.length === 0) return false;
  const normalize = normalizeBackendTermForMatch;
  const normalizedTerm = normalize(term);
  const termWords = new Set(normalizedTerm.split(" ").filter((w) => w.length >= 3));
  const dangerWords = new Set(dangerRoots.map(normalize).filter((w) => w.length >= 3));
  // 取 term 中与危险词根匹配的词/短语（word 级 + 短语包含）
  const matchedDangerWords = new Set<string>();
  for (const word of termWords) {
    for (const root of dangerWords) {
      if (word === root) matchedDangerWords.add(word);
    }
  }
  for (const root of dangerWords) {
    if (root.includes(" ") && normalizedTerm.includes(root)) matchedDangerWords.add(root);
  }
  if (matchedDangerWords.size === 0) return false;
  for (const fact of facts) {
    if (!fact.usageScopes.includes("listing")) continue;
    const valueWords = new Set(normalize(fact.value).split(" ").filter((w) => w.length >= 3));
    if (valueWords.size === 0) continue;
    // 直接同词命中（leakproof → leakproof）
    for (const word of matchedDangerWords) {
      if (valueWords.has(word)) return true;
    }
    // 方向性桥接：仅同强度词形
    for (const entry of DIRECTIONAL_EVIDENCE) {
      if (!matchedDangerWords.has(entry.dangerWord)) continue;
      const factHit = entry.supportedFactWords.some((w) => valueWords.has(normalize(w)));
      if (factHit) return true;
    }
  }
  return false;
}

/** 分类单个 backend term：generic / fact_bearing / safe_fact_bearing / always_blocked */
export function classifyBackendTerm(
  term: string,
  facts: BackendEvidenceFact[],
): { classification: "generic" | "fact_bearing" | "safe_fact_bearing" | "always_blocked"; matchedLabels: string[] } {
  const matchedLabels: string[] = [];
  for (const entry of ALWAYS_BLOCKED_TERM_PATTERNS) {
    if (entry.pattern.test(term)) matchedLabels.push(entry.label);
  }
  if (matchedLabels.length > 0) return { classification: "always_blocked", matchedLabels };
  const matchedDangerRoots: string[] = [];
  for (const entry of FACT_BEARING_TERM_PATTERNS) {
    if (entry.pattern.test(term)) {
      matchedLabels.push(entry.label);
      matchedDangerRoots.push(entry.label);
    }
  }
  if (matchedLabels.length === 0) return { classification: "generic", matchedLabels };
  if (hasDirectionalFactEvidence(term, matchedDangerRoots, facts)) return { classification: "safe_fact_bearing", matchedLabels };
  return { classification: "fact_bearing", matchedLabels };
}

/** 收集 Brief backend terms 的归一化集合（权威关键词集合） */
function briefBackendTermSet(brief: ListingKeywordBrief | null): Set<string> {
  const set = new Set<string>();
  if (!brief) return set;
  for (const term of brief.backendSearchTerms) {
    const normalized = normalizeBackendTermForMatch(term);
    if (normalized) set.add(normalized);
  }
  return set;
}

export type BackendTermSafetyResult = {
  /** 过滤后的安全 backend terms（保持原顺序、去重） */
  terms: string[];
  /** 被过滤 term 的人工可读警告 */
  warnings: string[];
  /** 过滤前原始 terms */
  rawTerms: string[];
};

/**
 * 过滤 backend search terms（R1.6-Final 处理顺序冻结）：
 * raw AI terms → Brief membership → always-blocked → fact-bearing evidence → generic → dedupe。
 * 不抛错（局部过滤，不使整个 Listing 退化）。
 */
export function filterBackendSearchTerms(input: {
  backendSearchTerms: string[];
  keywordBrief: ListingKeywordBrief | null;
  confirmedFacts: BackendEvidenceFact[];
}): BackendTermSafetyResult {
  const briefSet = briefBackendTermSet(input.keywordBrief);
  const seen = new Set<string>();
  const terms: string[] = [];
  const warnings: string[] = [];
  for (const term of input.backendSearchTerms) {
    const normalized = term.normalize("NFC").trim();
    if (!normalized) continue;
    // 去重基于归一化匹配键（连字符/空格/大小写等价视为同一 term）
    const key = normalizeBackendTermForMatch(normalized);
    if (seen.has(key)) continue;
    seen.add(key);

    // 1. Brief Authority：term 必须存在于 Keyword Brief（归一化后）
    if (!briefSet.has(normalizeBackendTermForMatch(normalized))) {
      warnings.push(`${normalized} 未在关键词资料中，未采用`);
      continue;
    }

    const { classification, matchedLabels } = classifyBackendTerm(normalized, input.confirmedFacts);
    if (classification === "fact_bearing") {
      warnings.push(`${normalized} 缺少足够商品事实依据（涉及：${matchedLabels.join("/")}），未采用`);
      continue;
    }
    if (classification === "always_blocked") {
      warnings.push(`${normalized} 属禁止词（${matchedLabels.join("/")}），未采用`);
      continue;
    }
    terms.push(normalized);
  }
  return { terms, warnings, rawTerms: [...input.backendSearchTerms] };
}
