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

/** 评论模块就绪探测的有界等待参数。只读 DOM，不改变 Amazon 访问策略。 */
export const REVIEW_DOM_READY_TIMEOUT_MS = 8_000;
export const REVIEW_DOM_READY_POLL_INTERVAL_MS = 100;
/** 重试窗口内两次「向评论区推进」的最小间隔；总等待 deadline 不变，只修滚动触达。 */
export const REVIEW_DOM_READY_SCROLL_STEP_MS = 500;

export type ReviewDomReadiness = {
  productTitlePresent: boolean;
  reviewNodeCount: number;
  explicitNoReviews: boolean;
  pageTitle: string;
  elapsedMs: number;
  retryAttempt: number;
  scrollTriggered: boolean;
};

/**
 * 浏览器端有界等待：先等待商品标题，再等待评论节点或明确的无评论文案。
 * 第一次没有评论节点时触发一次滚动并进入第二个有界等待窗口；窗口内若评论
 * 仍未出现，按固定间隔继续向评论区推进（评论锚点 → 逐步下翻至页底），
 * 因为评论区位于长页面深处且懒加载：单次 ≤800px 的滚动到不了触发区。
 * 超时只代表未完成提取，调用方不能据此断言“暂无公开评论”。
 */
export const REVIEW_DOM_READINESS_SOURCE = [
  "(() => {",
  "const TIMEOUT_MS = __TIMEOUT_MS__;",
  "const POLL_INTERVAL_MS = __POLL_INTERVAL_MS__;",
  "const SCROLL_STEP_MS = __SCROLL_STEP_MS__;",
  "const startedAt = Date.now();",
  "let retryAttempt = 0;",
  "let scrollTriggered = false;",
  "let lastProgressScrollAt = 0;",
  "const bodyText = () => (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();",
  "const hasExplicitNoReviews = () => /(?:no customer reviews(?: yet)?|there are no reviews|be the first to review|no reviews(?: are)? available)/i.test(bodyText());",
  "const hasProductTitle = () => Boolean(document.querySelector('#productTitle'));",
  "const reviewNodeCount = () => { const nodes = document.querySelectorAll('[data-hook=\"review\"]'); let valid = 0; for (let i = 0; i < nodes.length; i++) { const t = nodes[i].textContent; if (t === undefined || t === null || t.trim().length > 5) valid++; } return valid; };",
  "const reviewAnchor = () => document.querySelector('#reviewsMedley') || document.querySelector('#customer-reviews_feature_div') || document.querySelector('#cm-cr-dp-review-list') || document.querySelector('#customerReviews') || document.querySelector('[data-hook=\"reviews\"]');",
  "const anchorScroll = () => { try { const target = reviewAnchor(); if (target && typeof target.scrollIntoView === 'function') { target.scrollIntoView({ block: 'center', behavior: 'auto' }); return true; } } catch (e) { } return false; };",
  "const scrollViewport = () => { try { const doc = document.documentElement; const maxY = doc ? ((doc.scrollHeight || 0) - (window.innerHeight || 800)) : NaN; if (Number.isFinite(maxY) && maxY > 0 && (window.scrollY || 0) >= maxY - 10) return false; window.scrollBy(0, Math.min(Math.max((window.innerHeight || 800) * 0.9, 400), 900)); return true; } catch (e) { return false; } };",
  "return new Promise((resolve) => {",
  "  const finish = () => { const titlePresent = hasProductTitle(); resolve({ productTitlePresent: titlePresent, reviewNodeCount: reviewNodeCount(), explicitNoReviews: titlePresent && hasExplicitNoReviews(), pageTitle: document.title || '', elapsedMs: Date.now() - startedAt, retryAttempt, scrollTriggered }); }",
  "  const triggerScrollAndRetry = () => {",
  "    retryAttempt = 1;",
  "    scrollTriggered = anchorScroll() || scrollViewport();",
  "    lastProgressScrollAt = Date.now();",
  "    waitForReview(Date.now() + TIMEOUT_MS);",
  "  };",
  "  const waitForReview = (deadline) => {",
  "    const tick = () => {",
  "    const titleReady = hasProductTitle();",
  "    const count = reviewNodeCount();",
  "    const explicitNoReviews = titleReady && hasExplicitNoReviews();",
  "    if (titleReady && (count > 0 || explicitNoReviews)) { finish(); return; }",
  "    if (retryAttempt === 0 && titleReady && count === 0 && (Date.now() - startedAt >= 500)) { triggerScrollAndRetry(); return; }",
  "    if (retryAttempt === 1 && count === 0 && Date.now() - lastProgressScrollAt >= SCROLL_STEP_MS) { lastProgressScrollAt = Date.now(); scrollViewport(); anchorScroll(); }",
  "    if (Date.now() >= deadline) { if (titleReady && retryAttempt === 0) { triggerScrollAndRetry(); } else { finish(); } return; }",
  "    setTimeout(tick, POLL_INTERVAL_MS);",
  "    };",
  "    tick();",
  "  };",
  "  waitForReview(Date.now() + TIMEOUT_MS);",
  "});",
  "})()",
].join("\n");

export function buildReviewDomReadinessExpression(options: {
  timeoutMs?: number;
  pollIntervalMs?: number;
  scrollStepMs?: number;
} = {}): string {
  const timeoutMs = options.timeoutMs ?? REVIEW_DOM_READY_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? REVIEW_DOM_READY_POLL_INTERVAL_MS;
  const scrollStepMs = options.scrollStepMs ?? REVIEW_DOM_READY_SCROLL_STEP_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) {
    throw new Error("REVIEW_DOM_READY_TIMEOUT_INVALID");
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 2_000) {
    throw new Error("REVIEW_DOM_READY_POLL_INTERVAL_INVALID");
  }
  if (!Number.isInteger(scrollStepMs) || scrollStepMs < 10 || scrollStepMs > 5_000) {
    throw new Error("REVIEW_DOM_READY_SCROLL_STEP_INVALID");
  }
  return REVIEW_DOM_READINESS_SOURCE
    .replace("__TIMEOUT_MS__", String(timeoutMs))
    .replace("__POLL_INTERVAL_MS__", String(pollIntervalMs))
    .replace("__SCROLL_STEP_MS__", String(scrollStepMs));
}

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
