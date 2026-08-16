/**
 * V3 Final Operability Correction — Package C：Review Snippet 提取表达式工件
 *
 * 与 detail-page-expression-source.ts 同机制（P1-A 教训）：浏览器端代码必须是
 * 显式字符串工件（自包含 IIFE + 固定名 + `__OPTIONS__` 占位替换），
 * 生产 SWC minify 不会改写字符串常量 → MINIFICATION-SAFE。
 *
 * 数据来源语义（V3.4 smoke 已实证）：Amazon 评论全文页需要登录（不绕过），
 * 因此从商品详情页公开可见的 "Top reviews" 片段提取真实星级/日期/标题
 * （正文折叠不可见 → 如实记录为已知限制，collectorVersion 标注）。
 */

export type ReviewSnippetExtractionOptions = {
  /** 单页最多提取条数（详情页 Top Reviews 片段通常 3-10 条；上限 ≤20） */
  maxItems: number;
};

/**
 * 浏览器端源码工件（自包含 IIFE；`__MAX_ITEMS__` 为数值占位）。
 * 注意：本字符串是 JS 手写版，逻辑与 v3-4-voc-review.smoke.test.ts 的
 * buildTopReviewsExtractionExpression 保持一致；改动任一侧必须同步。
 */
export const REVIEW_SNIPPET_EXTRACTOR_SOURCE = [
  "(() => {",
  "const MAX_ITEMS = __MAX_ITEMS__;",
  "const out = [];",
  "const nodes = document.querySelectorAll('[data-hook=\"review\"]');",
  "for (const node of nodes) {",
  "  if (out.length >= MAX_ITEMS) break;",
  "  const raw = (node.textContent || '').replace(/\\s+/g, ' ').trim();",
  "  if (!raw) continue;",
  "  const ratingMatch = raw.match(/([0-9](?:\\.[0-9])?) out of 5 stars/);",
  "  const dateMatch = raw.match(/Reviewed in .*? on ([A-Z][a-z]+ [0-9]{1,2}, [0-9]{4})/);",
  "  const rating = ratingMatch ? Number(ratingMatch[1]) : null;",
  "  const date = dateMatch ? dateMatch[1] : '';",
  "  let title = raw;",
  "  if (ratingMatch) title = title.replace(ratingMatch[0], ' ');",
  "  if (dateMatch) title = title.replace(dateMatch[0], ' ');",
  "  title = title.replace(/Verified Purchase|Brief content visible[\\s\\S]*|double tap to read full content/gi, ' ').trim();",
  "  const username = ratingMatch ? raw.slice(0, ratingMatch.index).replace(/<[^>]+>/g, '').trim() : '';",
  "  if (username) title = title.replace(username, ' ').trim();",
  "  if (!title) continue;",
  "  out.push({ rating: rating, date: date, title: title });",
  "}",
  "return out;",
  "})()",
].join("\n");

/** 构造 Runtime.evaluate 表达式：`__MAX_ITEMS__` 占位替换为数值 */
export function buildReviewSnippetExtractionExpression(options: ReviewSnippetExtractionOptions): string {
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1 || options.maxItems > 20) {
    throw new Error("REVIEW_SNIPPET_MAX_ITEMS_INVALID");
  }
  return REVIEW_SNIPPET_EXTRACTOR_SOURCE.replace("__MAX_ITEMS__", String(options.maxItems));
}

/** 提取结果类型（页面作用域返回值的形状） */
export type ReviewSnippet = {
  rating: number | null;
  date: string;
  title: string;
};
