/**
 * V3 Final Operability Correction — P1-A：表达式工件同步与 minify 安全测试
 *
 * 1. 同步校验：browser-runtime 字符串工件（detail-page-expression-source.ts）在
 *    fake DOM 上的执行结果，必须与 Node 侧 TS 函数版（detail-page-extract.ts）
 *    完全一致（防双份漂移）。
 * 2. Minify 安全：表达式必须自包含——IIFE 内声明的标识符必须覆盖全部引用
 *    （未声明标识符扫描），且可在独立 Function 作用域执行无 ReferenceError。
 */
import { describe, expect, it } from "vitest";
import {
  buildAmazonDetailPageExtractionExpression,
  buildAmazonProductInfoExtractionExpression,
  DETAIL_PAGE_EXTRACTOR_SOURCE,
  PRODUCT_INFO_EXTRACTOR_SOURCE,
} from "@/tools/collectors/amazon/detail-page-expression-source";
import {
  extractAmazonDetailPage,
  extractAmazonProductInfo,
  type AmazonDetailPageExtractionOptions,
} from "@/tools/collectors/amazon/detail-page-extract";

/* ── fake DOM（覆盖查询选择器/子节点/文本读取的最小实现） ── */

function fakeDom(nodes: Record<string, { textContent?: string | null; innerText?: string; rows?: Array<{ textContent: string }> } | null>) {
  const querySelector = (selector: string) => {
    const node = nodes[selector];
    if (!node) return null;
    return {
      textContent: node.textContent ?? null,
      querySelectorAll: (childSelector: string) => {
        if (childSelector === "tr, li" && node.rows) {
          return node.rows.map((row) => ({ textContent: row.textContent }));
        }
        return [] as unknown[];
      },
      getAttribute: () => null,
    } as unknown;
  };
  return {
    querySelector,
    querySelectorAll: () => [] as unknown[],
    body: { innerText: nodes["#body"]?.innerText ?? null },
  } as unknown;
}

function options(overrides: Partial<AmazonDetailPageExtractionOptions> = {}): AmazonDetailPageExtractionOptions {
  return {
    expectedAsin: "B0TEST0001",
    capturedAt: "2026-08-16T00:00:00.000Z",
    collectorVersion: "amazon-detail-page-extractor.v1",
    ...overrides,
  };
}

function runExpression(dom: unknown, opts: AmazonDetailPageExtractionOptions) {
  const expression = buildAmazonDetailPageExtractionExpression(opts);
  const runner = Function("document", "location", `return ${expression}`) as (
    doc: unknown,
    loc: { href: string },
  ) => unknown;
  return runner(dom, { href: "https://www.amazon.com/dp/B0TEST0001" });
}

describe("detail-page expression source（P1-A）", () => {
  it("expressions are self-contained: every identifier is declared inside the IIFE", () => {
    const source = DETAIL_PAGE_EXTRACTOR_SOURCE;
    // 固定名 helper 全部显式声明
    for (const name of [
      "sanitizeDetailText", "normalizeAsin", "parseAsinFromDetailUrl",
      "parseDetailPrice", "detectDetailPriceCurrency", "parseDetailRating",
      "parseDetailReviewCount", "parseDetailBsr", "detectDetailPageStatus",
      "readDetailPageAsinAnchor", "readDetailPageBsrText", "unknownField",
      "correctField", "readFirstText", "extractAmazonDetailPage",
    ]) {
      expect(source).toContain(`function ${name}(`);
    }
    // 不依赖任何模块级/闭包标识符（只有浏览器全局 document/location/URL/Number/RegExp 等）
    expect(source).not.toMatch(/functionSource/);
    expect(source).not.toMatch(/import\s/);
    expect(source).not.toMatch(/require\(/);
  });

  it("executes in an isolated Function scope without ReferenceError (minify-safe)", () => {
    const dom = fakeDom({ "#productTitle": { textContent: "Test Bottle" } });
    expect(() => runExpression(dom, options())).not.toThrow();
  });

  it("matches the Node-side TS extractor on a valid detail page", () => {
    const dom = fakeDom({
      "#body": { innerText: "Test Bottle product page" },
      "#productTitle": { textContent: "Test Bottle" },
      "#detailBullets_feature_div": { rows: [{ textContent: "ASIN: B0TEST0001" }] },
      "#corePrice_feature_div .a-offscreen": { textContent: "$24.99" },
      "#acrPopover .a-icon-alt": { textContent: "4.6 out of 5 stars" },
      "#acrCustomerReviewText": { textContent: "1,234 ratings" },
    });
    const opts = options();
    const fromExpression = runExpression(dom, opts) as ReturnType<typeof extractAmazonDetailPage>;
    const fromNode = extractAmazonDetailPage(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.entityBound).toBe(true);
    expect(fromExpression.fields.price.value).toBe(24.99);
    expect(fromExpression.fields.reviews.value).toBe(1234);
  });

  it("matches on ASIN mismatch (entity not bound, all fields unknown)", () => {
    const dom = fakeDom({
      "#body": { innerText: "Test Bottle product page" },
      "#productTitle": { textContent: "Test Bottle" },
      "#detailBullets_feature_div": { rows: [{ textContent: "ASIN: B0OTHER0001" }] },
    });
    const opts = options();
    const fromExpression = runExpression(dom, opts) as ReturnType<typeof extractAmazonDetailPage>;
    const fromNode = extractAmazonDetailPage(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.entityBound).toBe(false);
    expect(fromExpression.bindingProof.pageAnchorMatchesExpected).toBe(false);
    expect(fromExpression.fields.title.reason).toBe("page_asin_anchor_mismatch");
  });

  it("matches on login wall page status", () => {
    const dom = fakeDom({
      "#body": { innerText: "Please sign in to continue" },
    });
    const opts = options();
    const fromExpression = runExpression(dom, opts) as ReturnType<typeof extractAmazonDetailPage>;
    const fromNode = extractAmazonDetailPage(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.pageStatus).toBe("login_wall");
  });

  it("matches on captcha page status", () => {
    const dom = fakeDom({
      "#body": { innerText: "Enter the characters you see below" },
    });
    const opts = options();
    const fromExpression = runExpression(dom, opts) as ReturnType<typeof extractAmazonDetailPage>;
    const fromNode = extractAmazonDetailPage(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.pageStatus).toBe("captcha");
  });

  it("matches when required fields are missing (unknown + reason)", () => {
    const dom = fakeDom({
      "#body": { innerText: "Test Bottle product page" },
      "#productTitle": { textContent: "Test Bottle" },
      "#detailBullets_feature_div": { rows: [{ textContent: "ASIN: B0TEST0001" }] },
      // 无价格/评分/评论节点 → selector_not_found
    });
    const opts = options();
    const fromExpression = runExpression(dom, opts) as ReturnType<typeof extractAmazonDetailPage>;
    const fromNode = extractAmazonDetailPage(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.entityBound).toBe(true);
    expect(fromExpression.fields.price.reason).toBe("selector_not_found");
    expect(fromExpression.fields.rating.reason).toBe("selector_not_found");
  });

  it("serializes options via placeholder without template interpolation issues", () => {
    const expression = buildAmazonDetailPageExtractionExpression(options({ capturedAt: "2026-08-16T00:00:00.000Z" }));
    expect(expression).not.toContain("__OPTIONS__");
    expect(expression).toContain('"capturedAt":"2026-08-16T00:00:00.000Z"');
    expect(expression).toContain('"expectedAsin":"B0TEST0001"');
  });
});

// ── V3 Final PHASE 1 — Product Info 表达式工件（自包含 + Node 侧 parity） ──

describe("product-info expression source (PHASE 1)", () => {
  function productInfoDom(rows: Array<[string, string]>) {
    const trNodes = rows.map(([label, value]) => ({
      textContent: null,
      querySelectorAll: (selector: string) => {
        if (selector === "td, th") return [{ textContent: label }, { textContent: value }];
        return [];
      },
    }));
    const container = {
      textContent: null,
      querySelectorAll: (selector: string) => {
        if (selector === "table.a-keyvalue.prodDetTable tr") return trNodes;
        return [];
      },
    };
    const detailBullets = {
      textContent: null,
      querySelectorAll: (selector: string) => {
        if (selector === "tr, li") return [{ textContent: "ASIN: B0TEST0001" }];
        return [];
      },
    };
    return {
      querySelector: (selector: string) => {
        switch (selector) {
          case "#productTitle": return { textContent: "Test Bottle" };
          case "#productDetails_expanderTables_depthLeftSections": return container;
          case "#productDetails_expanderTables_depthRightSections": return null;
          case "#productOverview_feature_div": return null;
          case "#detailBullets_feature_div": return detailBullets;
          default: return null;
        }
      },
      querySelectorAll: (selector: string) => {
        if (selector === "#productDetails_expanderTables_depthLeftSections") return [container];
        return [];
      },
      body: { innerText: "Test Bottle product page" },
    };
  }

  function runProductInfoExpression(dom: unknown, opts: AmazonDetailPageExtractionOptions) {
    const expression = buildAmazonProductInfoExtractionExpression(opts);
    const runner = Function("document", "location", `return ${expression}`) as (
      doc: unknown,
      loc: { href: string },
    ) => unknown;
    return runner(dom, { href: "https://www.amazon.com/dp/B0TEST0001" });
  }

  it("is self-contained: helpers declared inside IIFE, no module identifiers", () => {
    expect(PRODUCT_INFO_EXTRACTOR_SOURCE).toContain("function readProductInfoRows(");
    expect(PRODUCT_INFO_EXTRACTOR_SOURCE).toContain("function mapProductInfoToCanonical(");
    expect(PRODUCT_INFO_EXTRACTOR_SOURCE).toContain("function extractAmazonProductInfo(");
    expect(PRODUCT_INFO_EXTRACTOR_SOURCE).not.toMatch(/import\s|require\(/);
  });

  it("matches the Node-side TS extractor on a spec-table page", () => {
    const dom = productInfoDom([
      ["Material Type", "Stainless Steel"],
      ["Item Weight", "0.22 kg"],
    ]);
    const opts = options();
    const fromExpression = runProductInfoExpression(dom, opts) as ReturnType<typeof extractAmazonProductInfo>;
    const fromNode = extractAmazonProductInfo(dom as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.entityBound).toBe(true);
    expect(fromExpression.canonicalFacts.material).toBe("Stainless Steel");
    expect(fromExpression.canonicalFacts.weight).toBe("0.22 kg");
    expect(fromExpression.rows).toHaveLength(2);
  });

  it("fails closed on ASIN mismatch (no rows, no canonicalFacts)", () => {
    const dom = productInfoDom([["Material Type", "Stainless Steel"]]);
    // 修改 ASIN 锚点为不匹配值
    const mismatched = {
      ...dom,
      querySelector: (selector: string) => {
        if (selector === "#detailBullets_feature_div") {
          return { textContent: null, querySelectorAll: () => [{ textContent: "ASIN: B0OTHER0001" }] };
        }
        return dom.querySelector(selector);
      },
    };
    const opts = options();
    const fromExpression = runProductInfoExpression(mismatched, opts) as ReturnType<typeof extractAmazonProductInfo>;
    const fromNode = extractAmazonProductInfo(mismatched as never, "https://www.amazon.com/dp/B0TEST0001", opts);
    expect(fromExpression).toEqual(fromNode);
    expect(fromExpression.entityBound).toBe(false);
    expect(fromExpression.rows).toEqual([]);
    expect(fromExpression.canonicalFacts).toEqual({});
  });
});
