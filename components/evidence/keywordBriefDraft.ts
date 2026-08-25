/**
 * R6 UX 修复：已保存关键词证据 → Keyword Brief 草稿（纯函数，无副作用）。
 *
 * 背景：前端原本没有任何入口调用 listing-handoff 的 action=save_keyword_brief；
 * 证据（keywordEvidence）与结构化 Brief（listingKeywordBrief）之间缺「生成+确认」通路。
 * 本模块只做一件事：从已保存的证据行派生 Brief 草稿（主词 = 第 1 行，辅助词 = 其余去重，有界）。
 * 不写库、不组网络请求；用户确认（confirmed）由 KeywordBriefCreateCard 负责。
 */

import { pickBestKeyword, scoreKeywordRelevance } from "@/lib/research/researchInputQuality";

export type KeywordBriefDraft = {
  primaryKeyword: string;
  supportingKeywords: string[];
  backendSearchTerms: string[];
  /** 与证据来源一致（后端 Brief 需 source 用于追溯展示） */
  source: "sellersprite" | "manual" | "synthetic" | "amazon_search_query" | "ad_search_term_report" | "unknown";
};

export function buildKeywordBriefDraft(
  rows: Array<{ keyword: string | null; rowNumber?: number }>,
  productName?: string | null,
): KeywordBriefDraft | null {
  const words = (rows ?? [])
    .map((row) => String(row?.keyword ?? "").trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  // 主词优先用相关度排序（与竞品搜索/服务端同一算法）；无 productName 或无相关词时回退首行（不静默选无关词——回退仍需非空首行）
  let primary = "";
  let supportingCandidates: string[] = [];
  if (productName && String(productName).trim()) {
    const best = pickBestKeyword(words.map((w) => ({ keyword: w })), String(productName));
    if (best) {
      primary = best.keyword;
      supportingCandidates = words.filter((w) => w.toLocaleLowerCase() !== primary.toLocaleLowerCase());
    }
  }
  if (!primary) {
    primary = words[0];
    supportingCandidates = words.slice(1);
  }
  const seen = new Set<string>([primary.toLocaleLowerCase()]);
  const supporting: string[] = [];
  const hasProductName = productName && String(productName).trim() ? true : false;
  for (const word of supportingCandidates) {
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    // 有权威商品名时：辅助词也只保留有相关度的词（宽词 lunch box 不进入推荐）
    if (hasProductName) {
      const score = scoreKeywordRelevance(word, String(productName));
      if (score <= 0) continue;
    }
    seen.add(key);
    supporting.push(word);
    if (supporting.length >= 5) break;
  }
  return {
    primaryKeyword: primary,
    supportingKeywords: supporting,
    backendSearchTerms: [],
    source: "sellersprite",
  };
}

/** 添加辅助词（去重、≤max、保序）；返回新增后的数组。 */
export function addSupportingToTags(current: string[], word: string, max = 5): string[] {
  const w = String(word ?? "").trim();
  if (!w) return current;
  if (current.some((s) => s.toLowerCase() === w.toLowerCase())) return current;
  return [...current, w].slice(0, max);
}
/** 删除辅助词。 */
export function removeSupportingTag(current: string[], word: string): string[] {
  return current.filter((s) => s !== word);
}
