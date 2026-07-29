import { describe, expect, it } from "vitest";

import { parseCandidateResearchContext } from "@/lib/candidateResearchContext";

const BASE_CONTEXT = {
  candidateId: "candidate-owner-a",
  productName: "Travel Mug",
  sourceType: "legacy_market_screening",
  sourceLabel: "Market screening",
  evidenceStatus: "verified_public",
  researchPriority: "review",
  promotionEligible: false,
  capturedAt: "2026-07-29T00:00:00.000Z",
  contextHash: "a".repeat(64),
} as const;

describe("Candidate research context", () => {
  it("accepts a bounded JPEG data URL returned by the authenticated context API", () => {
    expect(parseCandidateResearchContext({
      ...BASE_CONTEXT,
      productImage: {
        dataUrl: "data:image/jpeg;base64,/9j/",
        mimeType: "image/jpeg",
        contentHash: "b".repeat(64),
        provenance: "candidate_fallback",
      },
    })?.productImage).toMatchObject({
      mimeType: "image/jpeg",
      contentHash: "b".repeat(64),
    });
  });

  it("fails closed for an image whose declared type does not match its bytes", () => {
    expect(parseCandidateResearchContext({
      ...BASE_CONTEXT,
      productImage: {
        dataUrl: "data:image/png;base64,/9j/",
        mimeType: "image/png",
        contentHash: "b".repeat(64),
        provenance: "candidate_fallback",
      },
    })).toBeNull();
  });
});
