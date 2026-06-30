import { describe, expect, it } from "vitest";
import {
  calculateCandidateQualityScore,
  deriveCandidateDecision,
  deriveCandidateRiskFlags,
  getRiskFlagLabel,
  normalizeCandidateEvidence,
  sanitizeUrlForDisplay,
} from "@/lib/candidateEvidence";

describe("candidate evidence normalization", () => {
  it("recommends a specific product page with bounded score and clear evidence", () => {
    const snapshot = normalizeCandidateEvidence({
      title: "Adjustable Desk Phone Stand",
      sourceType: "web",
      sourceName: "source importer",
      sourceUrl: "https://example.com/products/desk-phone-stand",
      candidateType: "product_candidate",
      score: 88.8,
      demandSignalScore: 82,
      beginnerFitScore: 91,
      riskScore: 12,
      priceText: "$12.99",
      hasImage: true,
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.qualityScore).toBe(89);
    expect(snapshot.confidence).toBe("high");
    expect(snapshot.decision).toBe("recommended");
    expect(snapshot.riskFlags).toEqual([]);
    expect(snapshot.evidenceItems).toContain("product_page");
    expect(snapshot.evidenceItems).toContain("price_seen");
    expect(snapshot.evidenceItems).toContain("image_seen");
  });

  it("rejects category, sitemap, login, and error-like pages", () => {
    expect(deriveCandidateDecision({
      title: "Shop All Storage",
      sourceUrl: "https://example.com/collections/storage",
      candidateType: "category_hint",
    }).decision).toBe("rejected");

    expect(deriveCandidateDecision({
      title: "sitemap.xml",
      sourceUrl: "https://example.com/sitemap.xml",
    }).decision).toBe("rejected");

    expect(deriveCandidateDecision({
      title: "Please log in to continue",
      failureReason: "login_required",
    }).decision).toBe("rejected");

    expect(deriveCandidateDecision({
      title: "404 page not found",
      failureReason: "http_error",
    }).decision).toBe("rejected");
  });

  it("keeps manual candidates without URL compatible but low confidence", () => {
    const snapshot = normalizeCandidateEvidence({
      title: "desktop organizer tray",
      sourceName: "manual",
      sourceType: "manual",
      score: 64,
    });

    expect(snapshot.decision).toBe("cautious");
    expect(snapshot.confidence).toBe("low");
    expect(snapshot.riskFlags).toContain("missing_source_url");
    expect(snapshot.nextAction).toContain("manual");
  });

  it("dedupes risk flags and never persists sensitive input fields", () => {
    const snapshot = normalizeCandidateEvidence({
      title: "USB charger",
      sourceUrl: "https://example.com/products/usb-charger?token=secret-token",
      sourceType: "web",
      sourceName: "public page",
      riskHint: "battery battery password=123",
      riskFlags: ["battery", "battery", "token"],
      cookie: "session=abc",
      password: "secret",
      apiKey: "sk-test",
    });

    expect(deriveCandidateRiskFlags({ riskFlags: ["battery", "battery"], title: "battery item" }))
      .toEqual(["battery"]);
    const serialized = JSON.stringify(snapshot).toLowerCase();
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("session=abc");
    expect(serialized).not.toContain("password=123");
    expect(serialized).not.toContain("sk-test");
  });

  it("calculates a bounded score for old and partial candidate data", () => {
    expect(calculateCandidateQualityScore({ score: 140 })).toBe(100);
    expect(calculateCandidateQualityScore({ score: -10 })).toBe(0);
    expect(calculateCandidateQualityScore({ riskScore: 80, beginnerFitScore: 40 })).toBeGreaterThanOrEqual(0);
  });
});

describe("risk flag Chinese labels", () => {
  it("maps known flags to Chinese", () => {
    expect(getRiskFlagLabel("missing_source_url")).toBe("缺少标准化 URL");
    expect(getRiskFlagLabel("battery")).toBe("含电池/充电品类");
    expect(getRiskFlagLabel("children_product")).toBe("儿童品类");
    expect(getRiskFlagLabel("ip_risk")).toBe("知识产权风险");
    expect(getRiskFlagLabel("login_required")).toBe("需要登录");
    expect(getRiskFlagLabel("source_unavailable")).toBe("来源不可用");
    expect(getRiskFlagLabel("missing_price")).toBe("缺少价格信号");
  });

  it("falls back to raw code for unknown flags", () => {
    expect(getRiskFlagLabel("custom_flag")).toBe("custom_flag");
    expect(getRiskFlagLabel("")).toBe("");
  });
});

describe("sanitizeUrlForDisplay", () => {
  it("returns empty for null/undefined/empty", () => {
    expect(sanitizeUrlForDisplay(null)).toBe("");
    expect(sanitizeUrlForDisplay(undefined)).toBe("");
    expect(sanitizeUrlForDisplay("")).toBe("");
    expect(sanitizeUrlForDisplay("   ")).toBe("");
  });

  it("redacts sensitive query params", () => {
    const result = sanitizeUrlForDisplay("https://example.com/product?id=123&token=abc123&secret=xyz");
    expect(result).toContain("id=123");
    expect(result).toContain("token=[redacted]");
    expect(result).toContain("secret=[redacted]");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("xyz");
  });

  it("redacts api_key, password, session", () => {
    const result = sanitizeUrlForDisplay("https://shop.com/item?api_key=sk-test&password=hunter2&session=sess-id");
    expect(result).toContain("api_key=[redacted]");
    expect(result).toContain("password=[redacted]");
    expect(result).toContain("session=[redacted]");
    expect(result).not.toContain("sk-test");
    expect(result).not.toContain("hunter2");
    expect(result).not.toContain("sess-id");
  });

  it("strips hash fragment", () => {
    expect(sanitizeUrlForDisplay("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("preserves non-sensitive params", () => {
    const result = sanitizeUrlForDisplay("https://example.com/search?q=desk&page=1&sort=asc");
    expect(result).toContain("q=desk");
    expect(result).toContain("page=1");
    expect(result).toContain("sort=asc");
  });

  it("handles invalid URL as plain text (trimmed)", () => {
    const result = sanitizeUrlForDisplay("not-a-valid-url");
    expect(result).toBe("not-a-valid-url");
  });

  it("caps very long non-URL text", () => {
    const long = "x".repeat(250);
    const result = sanitizeUrlForDisplay(long);
    expect(result.length).toBeLessThanOrEqual(203); // 200 + "…"
  });
});
