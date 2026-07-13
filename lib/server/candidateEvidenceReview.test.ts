import { describe, expect, it } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1,
  type SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import {
  buildCandidateEvidenceReview,
  toPublicOpportunityCandidate,
} from "@/lib/server/candidateEvidenceReview";

function evidence(): SourceEvidenceV2 {
  return normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "evidence-review-001",
    origin: "public_url",
    capturedAt: "2026-07-12T01:00:00.000Z",
    submittedUrl: "https://Example.com/feed.xml?utm_source=test&token=secret",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/widget?id=7",
    sourceRelation: "document_item",
    sourceHost: "example.com",
    sourceType: "rss",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: "application/rss+xml",
      robots: "allowed",
      redirectCount: 1,
    },
    observations: {
      title: "Foldable Widget",
      categoryHint: "Desk accessories",
      signalText: "Portable product signal",
      priceText: "US$ 12.00",
      hasImage: true,
    },
    extractionSignals: ["rss_item", "price_seen"],
  });
}

function assessment(sourceEvidence: SourceEvidenceV2): RuleAssessmentV1 {
  return normalizeRuleAssessmentV1({
    version: "candidate-rule-v1",
    algorithm: "radar-score-v1",
    evidenceHash: createEvidenceHash(sourceEvidence),
    computedAt: "2026-07-12T01:01:00.000Z",
    candidateType: "product_candidate",
    scores: {
      demandSignal: 81,
      supplyEase: 73,
      risk: 32,
      beginnerFit: 78,
      final: 76,
    },
    riskFlags: ["manual_price_check"],
    reasons: ["公开页面存在商品信号", "价格仍需人工核对"],
    queueSuggestion: "review",
  });
}

function signedRecord(overrides: Record<string, unknown> = {}) {
  const sourceEvidence = evidence();
  const ruleAssessment = assessment(sourceEvidence);
  return {
    id: "candidate-001",
    name: "Foldable Widget",
    link: sourceEvidence.candidateUrl,
    sourceMetaJson: JSON.stringify({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
      evidenceHash: createEvidenceHash(sourceEvidence),
      sourceEvidence,
      proof: {
        issuedAt: "2026-07-12T01:01:00.000Z",
        expiresAt: "2026-07-12T03:01:00.000Z",
        sourceType: sourceEvidence.sourceType,
      },
    }),
    analysisJson: JSON.stringify({
      version: "candidate-analysis-v2",
      integrity: "signed_source_v2",
      assessmentHash: createAssessmentHash(ruleAssessment),
      ruleAssessment,
    }),
    ...overrides,
  };
}

function r22Snapshot() {
  return {
    schemaVersion: "r22-market-decision-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    candidateId: "candidate-001",
    asin: "B000000001",
    briefId: "A",
    frozenRank: 1,
    marketDecision: "market_shortlisted",
    decisionReasons: ["all_preregistered_shortlist_thresholds_met"],
    supportingEvidenceRefs: ["fixture:market"],
    opposingEvidenceRefs: [],
    marketMissingFields: [],
    dataCompleteness: 1,
    confidence: "high",
    stabilityStatus: "stable",
    ruleVersion: "r22-stage1-market-v1",
    inputHash: "a".repeat(64),
    createdAt: "2026-07-13T00:00:00.000Z",
  };
}

describe("CandidateEvidenceReviewV1", () => {
  it("derives a minimal verified source-evidence-chain review from valid stored wrappers", () => {
    const review = buildCandidateEvidenceReview(signedRecord());

    expect(review).toMatchObject({
      version: "candidate-evidence-review-v1",
      integrity: "verified_public",
      facts: {
        sourceHost: "example.com",
        sourceType: "rss",
        sourceRelation: "document_item",
        documentUrl: "https://example.com/feed.xml",
        candidateUrl: "https://example.com/products/widget?id=7",
        openUrl: "https://example.com/products/widget?id=7",
        httpStatus: 200,
        priceText: "US$ 12.00",
        hasImage: true,
      },
      assessment: {
        algorithm: "radar-score-v1",
        queueSuggestion: "review",
        scores: { final: 76 },
      },
    });
  });

  it.each([
    ["invalid source JSON", { sourceMetaJson: "{" }],
    ["unsupported source wrapper", { sourceMetaJson: JSON.stringify({ version: "candidate-source-meta-v3" }) }],
    ["unsupported analysis wrapper", { analysisJson: JSON.stringify({ version: "candidate-analysis-v3" }) }],
  ])("degrades the whole review for %s", (_label, override) => {
    expect(buildCandidateEvidenceReview(signedRecord(override))).toEqual({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
      openUrl: "https://example.com/products/widget?id=7",
    });
  });

  it("degrades when evidenceHash, assessmentHash or their binding is inconsistent", () => {
    const base = signedRecord();
    const sourceMeta = JSON.parse(base.sourceMetaJson);
    const analysis = JSON.parse(base.analysisJson);

    expect(buildCandidateEvidenceReview({
      ...base,
      sourceMetaJson: JSON.stringify({ ...sourceMeta, evidenceHash: "a".repeat(64) }),
    }).integrity).toBe("unverified");
    expect(buildCandidateEvidenceReview({
      ...base,
      analysisJson: JSON.stringify({ ...analysis, assessmentHash: "b".repeat(64) }),
    }).integrity).toBe("unverified");
    expect(buildCandidateEvidenceReview({
      ...base,
      analysisJson: JSON.stringify({
        ...analysis,
        ruleAssessment: { ...analysis.ruleAssessment, evidenceHash: "c".repeat(64) },
      }),
    }).integrity).toBe("unverified");
  });

  it("keeps the known historical algorithm readable but degrades an unknown algorithm", () => {
    expect(buildCandidateEvidenceReview(signedRecord()).integrity).toBe("verified_public");

    const base = signedRecord();
    const analysis = JSON.parse(base.analysisJson);
    const unknownAssessment = normalizeRuleAssessmentV1({
      ...analysis.ruleAssessment,
      algorithm: "future-unreviewed-v9",
    });
    const unknownRecord = {
      ...base,
      analysisJson: JSON.stringify({
        ...analysis,
        assessmentHash: createAssessmentHash(unknownAssessment),
        ruleAssessment: unknownAssessment,
      }),
    };

    expect(buildCandidateEvidenceReview(unknownRecord).integrity).toBe("unverified");
  });

  it.each([
    "ftp://example.com/product",
    "javascript:alert(1)",
    "https://user:password@example.com/product",
    "not a URL",
  ])("does not expose an unsafe legacy openUrl: %s", (link) => {
    expect(buildCandidateEvidenceReview({
      link,
      sourceMetaJson: JSON.stringify({ integrity: "legacy_unverified" }),
      analysisJson: JSON.stringify({ integrity: "legacy_unverified" }),
    })).toEqual({
      version: "candidate-evidence-review-v1",
      integrity: "unverified",
      reason: "legacy_or_invalid",
    });
  });

  it("removes internal JSON and cryptographic metadata from the public Candidate response", () => {
    const response = toPublicOpportunityCandidate({
      ...signedRecord(),
      sourceIntegrity: "verified_public",
      proof: "must-not-leak",
      evidenceHash: "must-not-leak",
      assessmentHash: "must-not-leak",
      demoAccessId: "visitor-private-id",
      futurePrivateField: "must-not-leak",
    });

    expect(response.sourceIntegrity).toBe("verified_public");
    expect(response.sourceReview.integrity).toBe("verified_public");
    expect(response).not.toHaveProperty("sourceMetaJson");
    expect(response).not.toHaveProperty("analysisJson");
    expect(response).not.toHaveProperty("proof");
    expect(response).not.toHaveProperty("evidenceHash");
    expect(response).not.toHaveProperty("assessmentHash");
    expect(response).not.toHaveProperty("demoAccessId");
    expect(response).not.toHaveProperty("futurePrivateField");
    expect(JSON.stringify(response)).not.toContain("must-not-leak");
  });

  it("preserves only the sanitized Evidence snapshot needed by existing Agent context", () => {
    const record = signedRecord();
    const sourceMeta = JSON.parse(record.sourceMetaJson);
    sourceMeta.evidenceSnapshot = {
      version: 1,
      sourceType: "rss",
      sourceName: "example.com",
      sourceUrl: "https://example.com/products/widget",
      evidenceItems: ["product_page"],
      extractionSignals: ["url_available"],
      qualityScore: 76,
      confidence: "medium",
      riskFlags: ["manual_price_check"],
      decision: "cautious",
      decisionReason: "manual review",
      nextAction: "review",
      generatedAt: "2026-07-12T01:01:00.000Z",
      secret: "must-not-leak",
    };

    const response = toPublicOpportunityCandidate({
      ...record,
      sourceMetaJson: JSON.stringify(sourceMeta),
    });

    expect(response.evidenceSnapshot).toMatchObject({
      version: 1,
      sourceType: "rss",
      sourceName: "example.com",
      sourceUrl: "https://example.com/products/widget",
      qualityScore: 76,
    });
    expect(response.evidenceSnapshot).not.toHaveProperty("secret");
  });

  it("exposes only a validated R2.2 market snapshot without leaking analysisJson", () => {
    const record = signedRecord();
    const analysis = JSON.parse(record.analysisJson);
    const response = toPublicOpportunityCandidate({
      ...record,
      analysisJson: JSON.stringify({ ...analysis, r22MarketDecision: r22Snapshot() }),
    });
    expect(response.r22MarketDecisionSnapshot).toEqual(r22Snapshot());
    expect(response).not.toHaveProperty("analysisJson");

    const invalid = toPublicOpportunityCandidate({
      ...record,
      analysisJson: JSON.stringify({ ...analysis, r22MarketDecision: { marketDecision: "market_shortlisted" } }),
    });
    expect(invalid).not.toHaveProperty("r22MarketDecisionSnapshot");
  });
});
