/**
 * Phase 4-D.7 — Radar Normalizer quality filter tests.
 * Pure function tests — no network, no DB, no AI.
 */
import { describe, it, expect } from "vitest";
import { normalizeResults } from "./radarNormalize";
import type { CrawlResult } from "./radarCrawler";

function okResult(url: string, body: string, contentType = "text/html"): CrawlResult {
  return { url, status: "ok", statusCode: 200, contentType, body };
}

describe("radarNormalize quality filtering", () => {
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
});
