import { describe, expect, it } from "vitest";
import {
  calculateCandidateQualityScore,
  deriveCandidateDecision,
  deriveCandidateRiskFlags,
  normalizeCandidateEvidence,
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
