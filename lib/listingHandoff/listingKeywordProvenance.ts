/**
 * Listing Keyword Provenance（R1.2）
 *
 * 服务器确定性派生 usedKeywordIds——AI 不再生成内部 keywordId。
 *
 * 合同：
 * - 输入最终 Listing copy（title/bullets/description/backendSearchTerms）+ Keyword Brief
 * - 输出 usedKeywordIds[]，只允许 brief 已有稳定 id：
 *   - primaryKeyword → "kw:primary"
 *   - supportingKeywords[i] → "kw:i"
 *   - backendSearchTerms[j] → "kw:backend:j"
 * - 匹配规则：Unicode NFC + lowercase + trim + collapse whitespace + phrase-boundary
 *   安全字面匹配（全文/整词边界，子串不命中）
 * - 未匹配 → 不进入 usedKeywordIds；禁止 AI 判断/embedding/模糊/同义/虚构
 *
 * 纯函数；无 DB/网络；同输入同输出。
 */

import type { ListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";

export type KeywordProvenanceEntry = {
  id: string;
  text: string;
};

/** 确定性归一化：NFC + lowercase + trim + collapse whitespace */
export function normalizeKeywordText(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** 短语边界安全匹配：候选词归一化后，在归一化文案中以整词边界出现（不 substring 命中） */
export function keywordAppearsInCopy(keyword: string, copy: string): boolean {
  const needle = normalizeKeywordText(keyword);
  const haystack = normalizeKeywordText(copy);
  if (!needle || !haystack) return false;
  if (haystack === needle) return true;
  // 边界：词首/空白/标点后均可；词中连写（如 bottlecarry）不命中
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}(?=\\W|$)`, "iu").test(haystack);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 收集 brief 全部关键词的稳定身份（ID 与文本均来自 Brief，ID 为服务器构造） */
export function collectKeywordProvenanceEntries(brief: ListingKeywordBrief): KeywordProvenanceEntry[] {
  const entries: KeywordProvenanceEntry[] = [];
  const seen = new Set<string>();
  if (brief.primaryKeyword) {
    entries.push({ id: "kw:primary", text: brief.primaryKeyword });
    seen.add(normalizeKeywordText(brief.primaryKeyword));
  }
  brief.supportingKeywords.forEach((kw, i) => {
    const normalized = normalizeKeywordText(kw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ id: `kw:${i}`, text: kw });
  });
  brief.backendSearchTerms.forEach((term, j) => {
    const normalized = normalizeKeywordText(term);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    entries.push({ id: `kw:backend:${j}`, text: term });
  });
  return entries;
}

/** 服务器确定性派生 usedKeywordIds：只返回实际出现在最终 copy 中的 brief 关键词 id */
export function deriveUsedKeywordIds(input: {
  title: string;
  bullets: string[];
  description: string;
  backendSearchTerms: string[];
  keywordBrief: ListingKeywordBrief | null;
}): string[] {
  if (!input.keywordBrief) return [];
  const copyParts = [
    input.title,
    ...input.bullets,
    input.description,
    ...input.backendSearchTerms,
  ].join(" ");
  const used: string[] = [];
  for (const entry of collectKeywordProvenanceEntries(input.keywordBrief)) {
    if (keywordAppearsInCopy(entry.text, copyParts)) used.push(entry.id);
  }
  return used;
}
