/**
 * V3 Final Product Integration — F4 Task Identity Inheritance 测试
 *
 * 覆盖：productUrl Authority（已保存 URL > ASIN+明确 marketplace 派生）、
 * 禁止未知市场默认 amazon.com、非 https/非 Amazon 域名 fail-closed、
 * Browser Evidence ASIN 回退仅限 US 市场。
 */
import { describe, expect, it } from "vitest";
import {
  isTrustedAmazonProductUrl,
  resolveBrowserEvidenceAsinFromResultJson,
  resolveTaskProductUrlFromCandidate,
} from "@/lib/server/taskIdentityInheritance";

const US_ASIN = "B0TEST0001";

const SELLER_SPRITE_META = (asin: string, productUrl: string) => JSON.stringify({
  schema: "sellersprite_candidate_source_v1",
  source: { provider: "SellerSprite", type: "sellersprite_xlsx", marketplace: "Amazon US" },
  identity: { asin, parentAsin: null, productUrl },
});

const BATCH_META = (asin: string, marketplace: string) => JSON.stringify({
  schema: "product-batch-candidate-source.v1",
  source: { marketplace, provider: "product_batch" },
  identity: { asin },
});

describe("isTrustedAmazonProductUrl", () => {
  it("accepts https amazon.com family detail URLs", () => {
    expect(isTrustedAmazonProductUrl(`https://www.amazon.com/dp/${US_ASIN}`)).toBe(true);
    expect(isTrustedAmazonProductUrl("https://www.amazon.co.uk/dp/B0TEST0001")).toBe(true);
    expect(isTrustedAmazonProductUrl("https://www.amazon.co.jp/dp/B0TEST0001")).toBe(true);
  });

  it("rejects http, non-amazon hosts, and garbage", () => {
    expect(isTrustedAmazonProductUrl(`http://www.amazon.com/dp/${US_ASIN}`)).toBe(false);
    expect(isTrustedAmazonProductUrl("https://evil.example.com/dp/B0TEST0001")).toBe(false);
    expect(isTrustedAmazonProductUrl("not-a-url")).toBe(false);
    expect(isTrustedAmazonProductUrl("")).toBe(false);
    expect(isTrustedAmazonProductUrl("https://www.amazon.com.evil.com/dp/B0TEST0001")).toBe(false);
  });
});

describe("resolveTaskProductUrlFromCandidate", () => {
  it("inherits sourceMeta identity.productUrl (SellerSprite direct import)", () => {
    const url = `https://www.amazon.com/dp/${US_ASIN}`;
    const resolved = resolveTaskProductUrlFromCandidate({
      link: url,
      sourceMetaJson: SELLER_SPRITE_META(US_ASIN, url),
    });
    expect(resolved).toBe(url);
  });

  it("falls back to candidate.link when sourceMeta lacks productUrl", () => {
    const url = `https://www.amazon.com/dp/${US_ASIN}`;
    const resolved = resolveTaskProductUrlFromCandidate({
      link: url,
      sourceMetaJson: "{}",
    });
    expect(resolved).toBe(url);
  });

  it("derives canonical URL from ASIN + explicit Amazon US marketplace (ProductBatch origin)", () => {
    const resolved = resolveTaskProductUrlFromCandidate({
      link: null,
      sourceMetaJson: BATCH_META(US_ASIN, "US"),
    });
    expect(resolved).toBe(`https://www.amazon.com/dp/${US_ASIN}`);
  });

  it("derives canonical URL for a known non-US marketplace (Amazon UK)", () => {
    const resolved = resolveTaskProductUrlFromCandidate({
      link: null,
      sourceMetaJson: BATCH_META(US_ASIN, "Amazon UK"),
    });
    expect(resolved).toBe(`https://www.amazon.co.uk/dp/${US_ASIN}`);
  });

  it("fails closed: ASIN with unknown marketplace -> null (never default amazon.com)", () => {
    const resolved = resolveTaskProductUrlFromCandidate({
      link: null,
      sourceMetaJson: BATCH_META(US_ASIN, "Mystery Market"),
    });
    expect(resolved).toBeNull();
  });

  it("fails closed: no identity at all -> null", () => {
    expect(resolveTaskProductUrlFromCandidate({ link: null, sourceMetaJson: "{}" })).toBeNull();
    expect(resolveTaskProductUrlFromCandidate({ link: null, sourceMetaJson: "not json" })).toBeNull();
  });

  it("fails closed: untrusted link is not inherited even when present", () => {
    const resolved = resolveTaskProductUrlFromCandidate({
      link: "https://evil.example.com/dp/B0TEST0001",
      sourceMetaJson: "{}",
    });
    expect(resolved).toBeNull();
  });

  it("fails closed: malformed ASIN cannot derive a URL", () => {
    const resolved = resolveTaskProductUrlFromCandidate({
      link: null,
      sourceMetaJson: BATCH_META("not-an-asin", "US"),
    });
    expect(resolved).toBeNull();
  });
});

describe("resolveBrowserEvidenceAsinFromResultJson", () => {
  const doc = (asin: string, marketplace: string) => JSON.stringify({
    candidateAnalysisContext: { facts: { asin, marketplace } },
  });

  it("returns ASIN when marketplace is Amazon US family", () => {
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "Amazon US"))).toBe(US_ASIN);
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "US"))).toBe(US_ASIN);
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "amazon.com"))).toBe(US_ASIN);
  });

  it("fails closed for non-US marketplaces (collect only supports amazon.com)", () => {
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "Amazon UK"))).toBeNull();
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "DE"))).toBeNull();
    expect(resolveBrowserEvidenceAsinFromResultJson(doc(US_ASIN, "unknown"))).toBeNull();
  });

  it("fails closed for missing/invalid ASIN or missing facts", () => {
    expect(resolveBrowserEvidenceAsinFromResultJson(doc("short", "US"))).toBeNull();
    expect(resolveBrowserEvidenceAsinFromResultJson(JSON.stringify({}))).toBeNull();
    expect(resolveBrowserEvidenceAsinFromResultJson("not json")).toBeNull();
  });
});
