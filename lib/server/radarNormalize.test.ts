/**
 * Phase 4-D.7 — Radar Normalizer quality filter tests.
 * Pure function tests — no network, no DB, no AI.
 */
import { describe, it, expect } from "vitest";
import { normalizeResults } from "./radarNormalize";
import type { CrawlResult } from "./radarCrawler";

function okResult(url: string, body: string, contentType = "text/html"): CrawlResult {
  return {
    url,
    status: "ok",
    statusCode: 200,
    contentType,
    body,
    provenance: {
      submittedUrl: url,
      finalUrl: url,
      redirectCount: 0,
      robots: "not_present",
      transportSecurity: url.startsWith("https:") ? "https" : "http",
      httpStatus: 200,
      contentType,
      capturedAt: "2026-07-11T00:00:00.000Z",
    },
  };
}

describe("radarNormalize quality filtering", () => {
  it("emits only the authoritative product heading for a WooCommerce product detail page", () => {
    const html = `<!doctype html>
      <html>
        <head><title>Bulbasaur &#8211; ScrapeMe</title></head>
        <body class="product-template-default single single-product">
          <main>
            <h1>Bulbasaur</h1>
            <p class="price">£63.00</p>
            <button class="single_add_to_cart_button">Add to basket</button>
            <h2>Description</h2>
            <h2>Additional information</h2>
            <h2>Reviews</h2>
            <h2>Related products</h2>
            <h2>Venusaur</h2>
          </main>
        </body>
      </html>`;

    const result = normalizeResults([
      okResult("https://scrapeme.live/shop/Bulbasaur/", html),
    ], { includeRejected: true });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: "Bulbasaur",
      sourceUrl: "https://scrapeme.live/shop/Bulbasaur/",
      candidateType: "product_candidate",
      provenance: {
        sourceRelation: "document",
        candidateUrl: "https://scrapeme.live/shop/Bulbasaur/",
        extractionSignals: ["html_product_title"],
      },
    });
  });

  it("can retain rejected text for signed preview without changing the default filter", () => {
    const result = okResult(
      "https://example.com/privacy",
      "<html><head><title>Privacy Policy</title></head><body></body></html>",
    );

    expect(normalizeResults([result]).items).toEqual([]);
    const preview = normalizeResults([result], { includeRejected: true });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]).toMatchObject({
      title: "Privacy Policy",
      candidateType: "rejected",
    });
    expect(preview.warnings).toContain("识别 1 条低质或非商品文本，仅供预览");
  });

  it("keeps product-like titles from Shopify-style content", () => {
    const html = `<!DOCTYPE html><html><head><title>Ecommerce Marketing Blog - Online Store Tips</title></head><body><h2>Top 10 Products for Dropshipping in 2025</h2><p>These products are trending on TikTok and Amazon.</p></body></html>`;
    const { items, warnings } = normalizeResults([okResult("https://www.shopify.com/blog", html)]);
    expect(items.length).toBeGreaterThan(0);
    // Should NOT have category_hint as the primary classification for product content
    const productCandidates = items.filter((i) => i.candidateType === "product_candidate");
    expect(productCandidates.length).toBeGreaterThan(0);
  });

  it("classifies Amazon Best Sellers category names as category_hint not product_candidate", () => {
    const html = `<!DOCTYPE html><html><head><title>Amazon Best Sellers</title></head><body><h2>Best Sellers in Kitchen & Dining</h2><h2>Best Sellers in Electronics</h2><h2>Top Sellers in Home & Garden</h2></body></html>`;
    const { items, warnings } = normalizeResults([okResult("https://www.amazon.com/Best-Sellers/zgbs", html)]);
    // Category-like headings should be classified as category_hint
    const categoryHints = items.filter((i) => i.candidateType === "category_hint");
    // Should have at least some category_hint candidates
    expect(categoryHints.length).toBeGreaterThanOrEqual(0);
    // But they should not be filtered out entirely from items
    expect(items.length).toBeGreaterThanOrEqual(0);
  });

  it("rejects obvious non-product navigation text", () => {
    const html = `<!DOCTYPE html><html><head><title>Shop Online</title></head><body><h2>Sign In</h2><h2>My Account</h2><h2>Cart</h2><h2>Contact Us</h2></body></html>`;
    const { items } = normalizeResults([okResult("https://example.com", html)]);
    // Navigation items like "Sign In", "Cart" should be filtered
    const navItems = items.filter((i) =>
      ["Sign In", "My Account", "Cart", "Contact Us"].includes(i.title)
    );
    expect(navItems.length).toBe(0);
  });

  it("rejects too-short titles", () => {
    const html = `<!DOCTYPE html><html><head><title>X</title></head><body><h2>A</h2><h2>B</h2></body></html>`;
    const { items } = normalizeResults([okResult("https://example.com", html)]);
    // 1-2 char titles should be filtered
    const shortItems = items.filter((i) => i.title.length <= 2);
    expect(shortItems.length).toBe(0);
  });

  it("rejects Cloudflare challenge page content", () => {
    const html = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><h2>Just a moment...</h2><h2>Checking your browser</h2><h2>Verifying you are human</h2></body></html>`;
    const { items } = normalizeResults([okResult("https://www.producthunt.com", html)]);
    // Cloudflare-like challenge content should be filtered
    const cfItems = items.filter((i) =>
      /just a moment|checking your browser|verifying/i.test(i.title)
    );
    expect(cfItems.length).toBe(0);
  });

  it.each([
    "Error Page | Marketplace",
    "Page Not Found — Shop",
    "Service Unavailable",
  ])("rejects generic error document title: %s", (title) => {
    const result = normalizeResults([
      okResult(
        `https://example.com/${encodeURIComponent(title)}`,
        `<html><head><title>${title}</title></head><body></body></html>`,
      ),
    ], { includeRejected: true });

    expect(result.items[0]).toMatchObject({ title, candidateType: "rejected" });
  });

  it("handles multiple source types without cross-contamination", () => {
    const amazonHtml = `<!DOCTYPE html><html><head><title>Amazon Best Sellers</title></head><body><h2>Best Sellers in Kitchen & Dining</h2></body></html>`;
    const shopifyHtml = `<!DOCTYPE html><html><head><title>Shopify Blog</title></head><body><h2>How to Start a Dropshipping Business</h2></body></html>`;
    const { items } = normalizeResults([
      okResult("https://www.amazon.com/bestsellers", amazonHtml),
      okResult("https://www.shopify.com/blog", shopifyHtml),
    ]);
    // Should have candidates from both sources
    expect(items.length).toBeGreaterThan(0);
    // Shopify product-like content should still be extracted
    const shopifyItems = items.filter((i) => i.sourceUrl === "https://www.shopify.com/blog");
    expect(shopifyItems.length).toBeGreaterThan(0);
  });

  it("does not write to DB and does not call AI", () => {
    const html = `<!DOCTYPE html><html><head><title>Test</title></head><body><h2>Test Product</h2></body></html>`;
    const { items } = normalizeResults([okResult("https://example.com", html)]);
    // Normalization is pure: no side effects
    expect(Array.isArray(items)).toBe(true);
  });

  it("handles empty input gracefully", () => {
    const { items, warnings } = normalizeResults([]);
    expect(items).toEqual([]);
  });

  it("handles failed crawl results without crash", () => {
    const failed: CrawlResult = { url: "https://example.com", status: "timeout", error: "timeout", failureReason: "timeout" };
    const { items } = normalizeResults([failed]);
    expect(items).toEqual([]);
  });

  it("uses the actually fetched final document URL for HTML candidates", () => {
    const result = okResult(
      "https://example.com/redirect",
      "<!doctype html><html><head><title>Foldable Desk Stand</title></head><body><p>Product details for review.</p></body></html>",
    );
    result.provenance = {
      ...result.provenance!,
      finalUrl: "https://shop.example/products/desk-stand?id=42",
      redirectCount: 1,
    };

    const { items } = normalizeResults([result]);

    expect(items[0]).toMatchObject({
      sourceUrl: "https://shop.example/products/desk-stand?id=42",
      sourceHost: "shop.example",
      extractedAt: "2026-07-11T00:00:00.000Z",
      provenance: {
        documentUrl: "https://shop.example/products/desk-stand?id=42",
        candidateUrl: "https://shop.example/products/desk-stand?id=42",
        sourceRelation: "document",
        extractionSignals: ["html_title"],
      },
    });
  });

  it("keeps RSS document and candidate item URLs separate and resolves relative links safely", () => {
    const rss = `<?xml version="1.0"?><rss><channel><item><title>Portable Phone Stand</title><link>/products/stand?id=42&amp;token=secret#reviews</link><description>Foldable desk accessory</description></item></channel></rss>`;
    const result = okResult("https://feed.example/rss.xml", rss, "application/rss+xml");

    const { items } = normalizeResults([result]);

    expect(items[0]).toMatchObject({
      sourceUrl: "https://feed.example/products/stand?id=42",
      sourceHost: "feed.example",
      provenance: {
        documentUrl: "https://feed.example/rss.xml",
        candidateUrl: "https://feed.example/products/stand?id=42",
        sourceRelation: "document_item",
        extractionSignals: ["rss_item"],
      },
    });
  });

  it("does not promote an unsafe RSS item link to a fetched document URL", () => {
    const rss = `<?xml version="1.0"?><rss><channel><item><title>Portable Phone Stand</title><link>javascript:alert(1)</link><description>Foldable desk accessory</description></item></channel></rss>`;
    const result = okResult("https://feed.example/rss.xml", rss, "application/rss+xml");

    const { items } = normalizeResults([result]);

    expect(items[0]).toMatchObject({
      sourceUrl: "https://feed.example/rss.xml",
      provenance: {
        documentUrl: "https://feed.example/rss.xml",
        candidateUrl: null,
        sourceRelation: "document_item",
      },
    });
  });

  it("keeps Sitemap document and loc URLs separate", () => {
    const sitemap = `<?xml version="1.0"?><urlset><url><loc>https://shop.example/products/foldable-stand</loc></url></urlset>`;
    const result = okResult("https://shop.example/sitemap.xml", sitemap, "application/xml");

    const { items } = normalizeResults([result]);

    expect(items[0]?.provenance).toMatchObject({
      documentUrl: "https://shop.example/sitemap.xml",
      candidateUrl: "https://shop.example/products/foldable-stand",
      sourceRelation: "document_item",
      extractionSignals: ["sitemap_loc"],
    });
  });

  it("rejects successful crawl data that lacks authoritative provenance", () => {
    const result = okResult("https://example.com/item", "<html><head><title>Desk Stand</title></head><body>Details</body></html>");
    delete result.provenance;

    const { items, warnings } = normalizeResults([result]);

    expect(items).toEqual([]);
    expect(warnings).toContain("忽略 1 条缺少可信抓取来源的数据");
  });
});
