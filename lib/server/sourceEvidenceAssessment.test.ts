import { describe, expect, it } from "vitest";
import {
  createAssessmentHash,
  normalizeSourceEvidenceV2,
  type SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { CURRENT_RULE_ASSESSMENT_ALGORITHM } from "@/lib/ruleAssessmentPolicy";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";

const COMPUTED_AT = "2026-07-12T08:00:00.000Z";

function evidence(overrides: Partial<SourceEvidenceV2> = {}): SourceEvidenceV2 {
  return normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "source-evidence-assessment-a",
    origin: "public_url",
    capturedAt: "2026-07-12T07:59:00.000Z",
    submittedUrl: "https://example.com/feed.xml",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/foldable-stand",
    sourceRelation: "document_item",
    sourceHost: "example.com",
    sourceType: "rss",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "application/rss+xml",
      robots: "allowed",
      redirectCount: 0,
    },
    observations: {
      title: "Foldable Phone Stand",
      categoryHint: "Desk accessories",
      signalText: "Portable lightweight generic metal stand",
      priceText: null,
      hasImage: null,
    },
    extractionSignals: ["rss_item"],
    ...overrides,
  });
}

describe("SourceEvidenceV2 deterministic assessment", () => {
  it("produces the same assessment and hash from the same normalized Evidence", () => {
    const first = assessSourceEvidenceV2(evidence(), COMPUTED_AT);
    const second = assessSourceEvidenceV2(evidence(), COMPUTED_AT);

    expect(first).toEqual(second);
    expect(createAssessmentHash(first)).toBe(createAssessmentHash(second));
    expect(first).toMatchObject({
      algorithm: CURRENT_RULE_ASSESSMENT_ALGORITHM,
      candidateType: "product_candidate",
      queueSuggestion: "review",
      computedAt: COMPUTED_AT,
    });
  });

  it("derives scores and risk flags only from immutable Evidence observations", () => {
    const safe = assessSourceEvidenceV2(evidence(), COMPUTED_AT);
    const risky = assessSourceEvidenceV2(evidence({
      observations: {
        title: "Rechargeable Baby Magnetic Toy",
        categoryHint: "Baby products",
        signalText: "Battery powered magnetic toy for newborn children",
        priceText: null,
        hasImage: null,
      },
    }), COMPUTED_AT);

    expect(risky.scores.risk).toBeGreaterThan(safe.scores.risk);
    expect(risky.riskFlags).toEqual(expect.arrayContaining(["儿童用品合规", "带电/电池运输", "磁铁安全"]));
    expect(createAssessmentHash(risky)).not.toBe(createAssessmentHash(safe));
  });

  it.each([
    ["Shop by Kitchen", "category_hint", "watch"],
    ["Privacy Policy", "rejected", "reject"],
  ] as const)("classifies %s as %s", (title, candidateType, queueSuggestion) => {
    const result = assessSourceEvidenceV2(evidence({
      observations: {
        title,
        categoryHint: null,
        signalText: title,
        priceText: null,
        hasImage: null,
      },
    }), COMPUTED_AT);

    expect(result).toMatchObject({ candidateType, queueSuggestion });
  });

  it("keeps computedAt bound to the assessment hash", () => {
    const first = assessSourceEvidenceV2(evidence(), COMPUTED_AT);
    const later = assessSourceEvidenceV2(evidence(), "2026-07-12T08:01:00.000Z");

    expect(first.scores).toEqual(later.scores);
    expect(createAssessmentHash(first)).not.toBe(createAssessmentHash(later));
  });
});
