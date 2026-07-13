import { describe, expect, it } from "vitest";
import { parseCandidateEvidenceReviewV1 } from "@/lib/candidateEvidenceReview";

function verifiedReview() {
  return {
    version: "candidate-evidence-review-v1",
    integrity: "verified_public",
    facts: {
      capturedAt: "2026-07-12T01:00:00.000Z",
      sourceHost: "example.com",
      sourceType: "html",
      sourceRelation: "document",
      documentUrl: "https://example.com/product",
      candidateUrl: "https://example.com/product",
      openUrl: "https://example.com/product",
      httpStatus: 200,
      contentType: "text/html",
      robots: "allowed",
      redirectCount: 0,
      title: "Product",
      categoryHint: null,
      signalText: "Product signal",
      priceText: "$10",
      hasImage: true,
      extractionSignals: ["product_page"],
    },
    assessment: {
      algorithm: "radar-score-v1",
      computedAt: "2026-07-12T01:01:00.000Z",
      candidateType: "product_candidate",
      scores: { demandSignal: 70, supplyEase: 70, risk: 30, beginnerFit: 70, final: 70 },
      riskFlags: [],
      reasons: ["规则评分"],
      queueSuggestion: "review",
    },
  };
}

describe("parseCandidateEvidenceReviewV1", () => {
  it("accepts the bounded server DTO", () => {
    expect(parseCandidateEvidenceReviewV1(verifiedReview())).toMatchObject({
      integrity: "verified_public",
      facts: { openUrl: "https://example.com/product" },
    });
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.com/product",
    "https://user:password@example.com/product",
    "https://example.com:444/product",
  ])("fails closed when a verified DTO contains unsafe openUrl %s", (openUrl) => {
    const value = verifiedReview();
    value.facts.openUrl = openUrl;
    expect(parseCandidateEvidenceReviewV1(value)).toEqual({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
    });
  });

  it("drops unsafe openUrl from an unverified DTO", () => {
    expect(parseCandidateEvidenceReviewV1({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
      openUrl: "javascript:alert(1)",
    })).toEqual({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
    });
  });

  it("fails closed when the server DTO contains an unknown Assessment algorithm", () => {
    const value = verifiedReview();
    value.assessment.algorithm = "future-unreviewed-v9";
    expect(parseCandidateEvidenceReviewV1(value)).toEqual({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
    });
  });
});
