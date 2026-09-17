/**
 * V3 Final Operability Correction — Package C：Review Snippet 提取表达式工件测试
 *
 * 与 detail-page-expression.test.ts 同职责：
 * 1. 表达式自包含（fixed-name helpers、无 `${...}` 运行时拼接、无 fn.toString() 模式）
 * 2. 占位替换正确（__MAX_ITEMS__ → 数值）
 * 3. 在隔离作用域执行（new Function + fake DOM）验证真实提取语义
 */
import { describe, expect, it } from "vitest";
import {
  REVIEW_SNIPPET_EXTRACTOR_SOURCE,
  buildReviewDomReadinessExpression,
  buildReviewSnippetExtractionExpression,
  REVIEW_DOM_READINESS_SOURCE,
  type ReviewSnippet,
} from "@/tools/collectors/amazon/review-snippet-extract";

/** fake DOM：模拟 Amazon 详情页 Top Reviews 片段（[data-hook="review"]） */
function fakeDom(): { document: { querySelectorAll: () => Array<{ textContent: string }> } } {
  const nodes = [
    // 典型片段：rating + 日期 + Verified Purchase + 标题
    '<div data-hook="review"><span>5.0 out of 5 stars</span><span>Reviewed in the United States on August 1, 2026</span>Verified Purchase<div>Fits perfectly and feels premium.</div><span>Brief content visible, double tap to read full content.</span></div>',
    // 无 rating 的片段（标题仍可提取）
    '<div data-hook="review">Assembly instructions are confusing.</div>',
  ];
  return {
    document: {
      querySelectorAll: () => nodes.map((html) => {
        // textContent 模拟：剥掉标签
        const textContent = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        return { textContent };
      }),
    },
  };
}

function runExpression<T>(expression: string, dom: ReturnType<typeof fakeDom>): T {
  const factory = new Function("document", `return ${expression}`) as (document: unknown) => T;
  return factory(dom.document);
}

describe("REVIEW_SNIPPET_EXTRACTOR_SOURCE（自包含工件）", () => {
  it("不含运行时拼接模式（P1-A 防线）", () => {
    expect(REVIEW_SNIPPET_EXTRACTOR_SOURCE).not.toMatch(/\$\{/);
    expect(REVIEW_SNIPPET_EXTRACTOR_SOURCE).not.toContain("functionSource");
    expect(REVIEW_SNIPPET_EXTRACTOR_SOURCE).toContain("__MAX_ITEMS__");
    expect(REVIEW_SNIPPET_EXTRACTOR_SOURCE).toContain("document.querySelectorAll");
  });

  it("buildReviewSnippetExtractionExpression 替换占位并校验上限", () => {
    const expression = buildReviewSnippetExtractionExpression({ maxItems: 5 });
    expect(expression).toContain("const MAX_ITEMS = 5;");
    expect(expression).not.toContain("__MAX_ITEMS__");
    expect(() => buildReviewSnippetExtractionExpression({ maxItems: 0 })).toThrow();
    expect(() => buildReviewSnippetExtractionExpression({ maxItems: 21 })).toThrow();
  });

  it("隔离作用域执行：提取星级/日期/标题", () => {
    const expression = buildReviewSnippetExtractionExpression({ maxItems: 10 });
    const result = runExpression<ReviewSnippet[]>(expression, fakeDom());
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      rating: 5,
      date: "August 1, 2026",
      title: "Fits perfectly and feels premium.",
    });
    // 第二条无 rating/日期 → null 字段
    expect(result[1].rating).toBeNull();
    expect(result[1].date).toBe("");
    expect(result[1].title).toContain("Assembly instructions are confusing.");
  });

  it("maxItems 截断生效", () => {
    const expression = buildReviewSnippetExtractionExpression({ maxItems: 1 });
    const result = runExpression<ReviewSnippet[]>(expression, fakeDom());
    expect(result).toHaveLength(1);
  });
});

describe("Review DOM readiness（有界等待与诚实空态）", () => {
  function readinessDom(input: { title: boolean; reviewCount: number; body: string; onScroll?: () => void; reviewCountAfterScroll?: number }) {
    let reviewCount = input.reviewCount;
    return {
      title: "Amazon product",
      body: { innerText: input.body },
      querySelector: (selector: string) => selector === "#productTitle" && input.title ? {} : null,
      querySelectorAll: (selector: string) => selector === '[data-hook="review"]' ? Array.from({ length: reviewCount }, () => ({})) : [],
      window: {
        innerHeight: 800,
        scrollBy: () => {
          input.onScroll?.();
          if (typeof input.reviewCountAfterScroll === "number") reviewCount = input.reviewCountAfterScroll;
        },
      },
    };
  }

  it("商品标题和 review DOM 都就绪时返回节点数", async () => {
    const expression = buildReviewDomReadinessExpression({ timeoutMs: 0, pollIntervalMs: 10 });
    const factory = new Function("document", "window", `return ${expression}`) as (document: unknown, window: unknown) => Promise<unknown>;
    const dom = readinessDom({ title: true, reviewCount: 3, body: "Product details" });
    const result = await factory(dom, dom.window);
    expect(result).toMatchObject({ productTitlePresent: true, reviewNodeCount: 3, explicitNoReviews: false, pageTitle: "Amazon product", retryAttempt: 0, scrollTriggered: false });
  });

  it("首次为空时触发一次轻量滚动，第二次出现评论则通过", async () => {
    const expression = buildReviewDomReadinessExpression({ timeoutMs: 0, pollIntervalMs: 10 });
    const factory = new Function("document", "window", `return ${expression}`) as (document: unknown, window: unknown) => Promise<any>;
    let scrolled = 0;
    const dom = readinessDom({ title: true, reviewCount: 0, body: "Product details", onScroll: () => { scrolled += 1; }, reviewCountAfterScroll: 2 });
    const result = await factory(dom, dom.window);
    expect(scrolled).toBe(1);
    expect(result).toMatchObject({ productTitlePresent: true, reviewNodeCount: 2, explicitNoReviews: false, retryAttempt: 1, scrollTriggered: true });
  });

  it("重试窗口内评论仍未出现时，按固定间隔继续向评论区推进直至懒加载触发", async () => {
    const expression = buildReviewDomReadinessExpression({ timeoutMs: 600, pollIntervalMs: 10, scrollStepMs: 20 });
    const factory = new Function("document", "window", `return ${expression}`) as (document: unknown, window: unknown) => Promise<any>;
    let scrollCalls = 0;
    let reviewCount = 0;
    const dom = {
      title: "Amazon product",
      body: { innerText: "Product details" },
      querySelector: (selector: string) => (selector === "#productTitle" ? {} : null),
      querySelectorAll: (selector: string) => (selector === '[data-hook="review"]' ? Array.from({ length: reviewCount }, () => ({})) : []),
      documentElement: null,
      window: {
        innerHeight: 800,
        scrollY: 0,
        scrollBy: () => {
          scrollCalls += 1;
          if (scrollCalls >= 3) reviewCount = 2;
        },
      },
    };
    const result = await factory(dom, dom.window);
    expect(scrollCalls).toBeGreaterThanOrEqual(3);
    expect(result).toMatchObject({ productTitlePresent: true, reviewNodeCount: 2, retryAttempt: 1, scrollTriggered: true });
  });

  it("评论始终不出现时如实报未完成提取，滚动有界且页底后停止", async () => {
    const expression = buildReviewDomReadinessExpression({ timeoutMs: 300, pollIntervalMs: 10, scrollStepMs: 40 });
    const factory = new Function("document", "window", `return ${expression}`) as (document: unknown, window: unknown) => Promise<any>;
    let scrollCalls = 0;
    const dom = {
      title: "Amazon product",
      body: { innerText: "Product details" },
      querySelector: (selector: string) => (selector === "#productTitle" ? {} : null),
      querySelectorAll: () => [],
      documentElement: { scrollHeight: 3000 },
      window: {
        innerHeight: 800,
        get scrollY() { return scrollCalls * 900; },
        scrollBy: () => { scrollCalls += 1; },
      },
    };
    const result = await factory(dom, dom.window);
    expect(result).toMatchObject({ productTitlePresent: true, reviewNodeCount: 0, explicitNoReviews: false, retryAttempt: 1, scrollTriggered: true });
    // 页高 3000、视口 800：渐进步进 900px，触底后 scrollViewport 返回 false，次数受页高约束
    expect(scrollCalls).toBeLessThanOrEqual(4);
  });

  it("明确无评论信号与提取为空严格分开", async () => {
    const expression = buildReviewDomReadinessExpression({ timeoutMs: 0, pollIntervalMs: 10 });
    const factory = new Function("document", "window", `return ${expression}`) as (document: unknown, window: unknown) => Promise<any>;
    const confirmedDom = readinessDom({ title: true, reviewCount: 0, body: "Be the first to review this product" });
    const emptyDom = readinessDom({ title: true, reviewCount: 0, body: "Product details" });
    const confirmed = await factory(confirmedDom, confirmedDom.window);
    const empty = await factory(emptyDom, emptyDom.window);
    expect(confirmed.explicitNoReviews).toBe(true);
    expect(empty.explicitNoReviews).toBe(false);
    expect(empty.reviewNodeCount).toBe(0);
    expect(empty.retryAttempt).toBe(1);
    expect(empty.scrollTriggered).toBe(true);
  });

  it("源码是显式自包含工件并替换有界参数", () => {
    expect(REVIEW_DOM_READINESS_SOURCE).toContain("__TIMEOUT_MS__");
    expect(REVIEW_DOM_READINESS_SOURCE).toContain("__POLL_INTERVAL_MS__");
    expect(REVIEW_DOM_READINESS_SOURCE).toContain("__SCROLL_STEP_MS__");
    expect(buildReviewDomReadinessExpression({ timeoutMs: 500, pollIntervalMs: 50 })).toContain("const TIMEOUT_MS = 500;");
    expect(() => buildReviewDomReadinessExpression({ timeoutMs: 30_001 })).toThrow();
    expect(() => buildReviewDomReadinessExpression({ scrollStepMs: 5_001 })).toThrow();
  });
});
