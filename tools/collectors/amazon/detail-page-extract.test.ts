import { describe, expect, it } from "vitest";
import {
  buildAmazonDetailPageExtractionExpression,
  extractAmazonDetailPage,
  extractAmazonProductInfo,
  mapProductInfoToCanonical,
  parseAsinFromDetailUrl,
  parseDetailBsr,
  parseDetailPrice,
  parseDetailRating,
  parseDetailReviewCount,
  readProductInfoRows,
  type AmazonDetailDomRoot,
} from "./detail-page-extract";

const ASIN = "B00063QBL8";
const URL = `https://www.amazon.com/dp/${ASIN}`;
const VERSION = "v3.1-spike.1";

type Node = {
  textContent?: string | null;
  querySelector?: (selector: string) => Node | null;
  querySelectorAll?: (selector: string) => ReadonlyArray<Node>;
};

function node(text: string | null = null, children: Record<string, Node | ReadonlyArray<Node>> = {}): Node {
  return {
    textContent: text,
    querySelector(selector: string) {
      return (children[selector] as Node | undefined) ?? null;
    },
    querySelectorAll(selector: string) {
      const list = children[`${selector}[]`];
      return Array.isArray(list) ? list : [];
    },
  };
}

function buildRoot(input: {
  bodyText?: string;
  title?: string | null;
  priceText?: string | null;
  newBuyboxPriceText?: string | null;
  ratingText?: string | null;
  reviewsText?: string | null;
  detailRows?: Array<{ text: string }>;
  includeRecommended?: boolean;
}): AmazonDetailDomRoot {
  const rows = input.detailRows ?? [
    { text: `Best Sellers Rank: #2,541 in Kitchen & Dining (See Top 100 in Kitchen & Dining)` },
    { text: `ASIN: ${ASIN}` },
  ];
  const detailContainer = node(null, {
    "tr, li[]": rows.map((row) => node(row.text)),
    "tr, li": node(rows[0].text),
  });
  const root: AmazonDetailDomRoot = {
    body: { innerText: input.bodyText ?? "" },
    querySelector(selector: string) {
      switch (selector) {
        case "#productTitle": return input.title ? node(input.title) : null;
        case "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen": return input.newBuyboxPriceText ? node(input.newBuyboxPriceText) : null;
        case "#corePriceDisplay_mobile_feature_div .a-price .a-offscreen": return null;
        case "#corePrice_feature_div .a-offscreen": return input.priceText ? node(input.priceText) : null;
        case "#corePrice_feature_div .a-price .a-offscreen": return null;
        case ".priceToPay .a-offscreen": return null;
        case "#priceblock_ourprice": return null;
        case "#priceblock_dealprice": return null;
        case "#acrPopover .a-icon-alt": return input.ratingText ? node(input.ratingText) : null;
        case "#acrCustomerReviewText": return input.reviewsText ? node(input.reviewsText) : null;
        case "#detailBullets_feature_div": return detailContainer;
        case "#productDetails_detailBullets_sections1": return null;
        case "#prodDetails": return null;
        case "#detailBulletsWrapper_feature_div": return null;
        default: return null;
      }
    },
    querySelectorAll(selector: string) {
      if (selector === "#productTitle") return input.title ? [node(input.title)] : [];
      return [];
    },
  };
  void input.includeRecommended;
  return root;
}

function options(expectedAsin: string | null = ASIN) {
  return { expectedAsin, capturedAt: "2026-08-15T00:00:00.000Z", collectorVersion: VERSION };
}

describe("Amazon detail page extractor (V3.1 Spike)", () => {
  it("extracts all six fields with entity binding proven", () => {
    const root = buildRoot({
      title: "John Boos Chop-N-Slice Series Rectangular Maple Cutting Board",
      priceText: "$48.95",
      ratingText: "4.2 out of 5 stars",
      reviewsText: "4,958 ratings",
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.entityBound).toBe(true);
    expect(result.pageStatus).toBe("ok");
    expect(result.fields.asin).toMatchObject({ status: "correct", value: ASIN });
    expect(result.fields.title).toMatchObject({ status: "correct" });
    expect(result.fields.price).toMatchObject({ status: "correct", value: 48.95 });
    expect(result.fields.bsr).toMatchObject({ status: "correct", value: 2541 });
    expect(result.fields.rating).toMatchObject({ status: "correct", value: 4.2 });
    expect(result.fields.reviews).toMatchObject({ status: "correct", value: 4958 });
  });

  it("extracts price from the new buybox container (V3R)", () => {
    const root = buildRoot({
      title: "New Buybox Product",
      newBuyboxPriceText: "$39.99",
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.entityBound).toBe(true);
    expect(result.fields.price).toMatchObject({ status: "correct", value: 39.99 });
  });

  it("fails closed when URL ASIN does not match the expected entity", () => {
    const root = buildRoot({ title: "Some Other Product" });
    const result = extractAmazonDetailPage(root, "https://www.amazon.com/dp/B0C3NFB3CZ", options(ASIN));
    expect(result.entityBound).toBe(false);
    expect(result.bindingProof.urlMatchesExpected).toBe(false);
    for (const field of Object.values(result.fields)) {
      expect(field).toMatchObject({ status: "unknown", reason: "url_asin_mismatch" });
    }
  });

  it("fails closed when the page ASIN anchor does not match", () => {
    const root = buildRoot({
      title: "Product",
      detailRows: [
        { text: "Best Sellers Rank: #100 in Kitchen & Dining" },
        { text: "ASIN: B0C3NFB3CZ" },
      ],
    });
    const result = extractAmazonDetailPage(root, URL, options(ASIN));
    expect(result.entityBound).toBe(false);
    expect(result.bindingProof.pageAnchorMatchesExpected).toBe(false);
    expect(result.fields.title).toMatchObject({ status: "unknown", reason: "page_asin_anchor_mismatch" });
  });

  it("marks missing price as unknown without falling back to recommended cards", () => {
    const root = buildRoot({
      title: "Product Title",
      priceText: null,
      ratingText: "4.2 out of 5 stars",
      reviewsText: "1,044 ratings",
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.fields.price).toMatchObject({ status: "unknown", reason: "selector_not_found" });
    expect(result.fields.rating).toMatchObject({ status: "correct", value: 4.2 });
  });

  it("marks missing BSR as unknown", () => {
    const root = buildRoot({
      title: "Product Title",
      priceText: "$10.00",
      detailRows: [{ text: `ASIN: ${ASIN}` }],
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.fields.bsr).toMatchObject({ status: "unknown", reason: "selector_not_found" });
  });

  it("marks invalid formats as unknown (not 'approximate correct')", () => {
    const root = buildRoot({
      title: "Product Title",
      priceText: "$1,234.5678", // 非法小数位
      ratingText: "9.9 out of 5 stars", // 超范围
      reviewsText: "about four thousand", // 非数字
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.fields.price).toMatchObject({ status: "unknown", reason: "format_invalid" });
    expect(result.fields.rating).toMatchObject({ status: "unknown", reason: "format_invalid" });
    expect(result.fields.reviews).toMatchObject({ status: "unknown", reason: "format_invalid" });
  });

  it("fails closed on captcha pages without extracting anything", () => {
    const root = buildRoot({
      bodyText: "Please enter the characters you see below to continue",
      title: "Product Title",
      priceText: "$10.00",
    });
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.pageStatus).toBe("captcha");
    expect(result.entityBound).toBe(false);
    for (const field of Object.values(result.fields)) {
      expect(field.status).toBe("unknown");
    }
  });

  it("fails closed on unknown pages (no product container)", () => {
    const root = buildRoot({});
    const result = extractAmazonDetailPage(root, URL, options());
    expect(result.pageStatus).toBe("unknown_page");
    expect(result.entityBound).toBe(false);
    expect(result.fields.title.reason).toBe("page_status_unknown_page");
  });

  it("parses ASIN from common detail URL shapes", () => {
    expect(parseAsinFromDetailUrl("https://www.amazon.com/dp/B00063QBL8")).toBe(ASIN);
    expect(parseAsinFromDetailUrl("https://www.amazon.com/dp/B00063QBL8?th=1&psc=1")).toBe(ASIN);
    expect(parseAsinFromDetailUrl("https://www.amazon.com/gp/aw/d/B00063QBL8/ref=aw_un")).toBe(ASIN);
    expect(parseAsinFromDetailUrl("https://www.amazon.com/gp/product/B00063QBL8")).toBe(ASIN);
    expect(parseAsinFromDetailUrl("https://www.amazon.com/product/B00063QBL8")).toBe(ASIN);
    expect(parseAsinFromDetailUrl("https://www.amazon.com/s?k=water")).toBeNull();
    expect(parseAsinFromDetailUrl("https://evil.example.com/dp/B00063QBL8")).toBeNull();
  });

  it("parses detail field formats strictly", () => {
    expect(parseDetailPrice("$48.95")).toBe(48.95);
    expect(parseDetailPrice("US$48.95")).toBe(48.95);
    expect(parseDetailPrice("48.95")).toBeNull(); // 缺 $ 前缀 → 不猜
    expect(parseDetailRating("4.2 out of 5 stars")).toBe(4.2);
    expect(parseDetailRating("5")).toBe(5);
    expect(parseDetailRating("5.1")).toBeNull();
    expect(parseDetailReviewCount("4,958 ratings")).toBe(4958);
    expect(parseDetailReviewCount("82")).toBe(82);
    expect(parseDetailReviewCount("N/A")).toBeNull();
    expect(parseDetailBsr("#2,541 in Kitchen & Dining")).toBe(2541);
    expect(parseDetailBsr("Best Sellers Rank: #1,270 in Our Brands")).toBe(1270);
    expect(parseDetailBsr("Not ranked")).toBeNull();
  });

  it("builds a browser expression without touching storage or credentials", () => {
    const expression = buildAmazonDetailPageExtractionExpression(options());
    expect(expression).toContain("extractAmazonDetailPage(document, location.href");
    expect(expression).not.toMatch(/cookie|localStorage|sessionStorage|credentials|password/i);
  });
});

// ── V3 Final PHASE 1 — Product Information 提取（Bounded DOM） ──

describe("Amazon product info extractor (PHASE 1)", () => {
  function specTableRoot(rows: Array<[string, string]>, overrides: { title?: string | null; bodyText?: string; asinAnchor?: string } = {}): AmazonDetailDomRoot {
    const trNodes = rows.map(([label, value]) => node(undefined, { "td, th[]": [node(label), node(value)] }));
    const tableContainer = node(undefined, { "table.a-keyvalue.prodDetTable tr[]": trNodes });
    const root: AmazonDetailDomRoot = {
      body: { innerText: overrides.bodyText ?? "" },
      querySelector(selector: string) {
        switch (selector) {
          case "#productTitle": return overrides.title ? node(overrides.title) : null;
          case "#productDetails_expanderTables_depthLeftSections": return tableContainer;
          case "#productDetails_expanderTables_depthRightSections": return null;
          case "#productOverview_feature_div": return null;
          case "#detailBullets_feature_div": return node(undefined, {
            "tr, li[]": [node(overrides.asinAnchor ?? `ASIN: ${ASIN}`)],
            "tr, li": node(overrides.asinAnchor ?? `ASIN: ${ASIN}`),
          });
          default: return null;
        }
      },
      querySelectorAll(selector: string) {
        if (selector === "#productDetails_expanderTables_depthLeftSections") return [tableContainer];
        return [];
      },
    };
    return root;
  }

  it("readProductInfoRows：限定规格容器内行（label/value）", () => {
    const root = specTableRoot([
      ["Material Type", "Stainless Steel"],
      ["Item Weight", "0.22 kg"],
    ]);
    const rows = readProductInfoRows(root);
    expect(rows).toEqual([
      { label: "Material Type", value: "Stainless Steel", sourceSection: "productDetails_depthLeftSections" },
      { label: "Item Weight", value: "0.22 kg", sourceSection: "productDetails_depthLeftSections" },
    ]);
  });

  it("mapProductInfoToCanonical：label 映射到 canonical 字段（首个匹配优先）", () => {
    const mapped = mapProductInfoToCanonical([
      { label: "Material Type", value: "Stainless Steel" },
      { label: "Brand", value: "THERMOS" },
      { label: "Item Dimensions W x H", value: "2.7\"W x 6.9\"H" },
      { label: "Price", value: "JPY 3,192" }, // 非 canonical label → 忽略
    ]);
    expect(mapped.material).toBe("Stainless Steel");
    expect(mapped.brand).toBe("THERMOS");
    expect(mapped.dimensions).toBe("2.7\"W x 6.9\"H");
    expect(mapped.price).toBeUndefined();
  });

  it("extractAmazonProductInfo：实体绑定证明 → 提取 + canonicalFacts；未绑定 → fail-closed 空", () => {
    const bound = specTableRoot([["Material Type", "Wood"]], { title: "Test Board" });
    const ok = extractAmazonProductInfo(bound, URL, options());
    expect(ok.entityBound).toBe(true);
    expect(ok.canonicalFacts.material).toBe("Wood");

    const unbound = specTableRoot([["Material Type", "Wood"]], { title: "Test Board", asinAnchor: "B0OTHER0001" });
    const bad = extractAmazonProductInfo(unbound, URL, options());
    expect(bad.entityBound).toBe(false);
    expect(bad.rows).toEqual([]);
    expect(bad.canonicalFacts).toEqual({});
  });
});
