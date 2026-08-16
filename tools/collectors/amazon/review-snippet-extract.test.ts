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
  buildReviewSnippetExtractionExpression,
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
