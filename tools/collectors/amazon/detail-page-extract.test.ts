import { describe, expect, it } from "vitest";
import {
  buildAmazonDetailPageExtractionExpression,
  extractAmazonDetailPage,
  parseAsinFromDetailUrl,
  parseDetailBsr,
  parseDetailPrice,
  parseDetailRating,
  parseDetailReviewCount,
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

function node(text: string | null = null, children: Record<string, Node> = {}): Node {
  return {
    textContent: text,
    querySelector(selector: string) {
      return children[selector] ?? null;
    },
    querySelectorAll(selector: string) {
      const list = children[`${selector}[]`];
      return list ? [list] : [];
    },
  };
}

function buildRoot(input: {
  bodyText?: string;
  title?: string | null;
  priceText?: string | null;
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
    "tr, li[]": node(rows.map((row) => row.text).join(" ")),
    "tr, li": node(rows[0].text),
  });
  const root: AmazonDetailDomRoot = {
    body: { innerText: input.bodyText ?? "" },
    querySelector(selector: string) {
      switch (selector) {
        case "#productTitle": return input.title ? node(input.title) : null;
        case "#corePrice_feature_div .a-offscreen": return input.priceText ? node(input.priceText) : null;
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
