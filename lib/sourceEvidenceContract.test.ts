import { describe, expect, it } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1Input,
  type SourceEvidenceV2Input,
} from "@/lib/sourceEvidenceContract";

const HASH_PATTERN = /^[a-f0-9]{64}$/;

function evidenceFixture(overrides: Partial<SourceEvidenceV2Input> = {}): SourceEvidenceV2Input {
  return {
    version: "candidate-source-v2",
    evidenceId: "evidence-001",
    origin: "public_url",
    capturedAt: "2026-07-11T08:00:00+08:00",
    submittedUrl: "https://Example.com/products/stand?utm_source=mail&id=42&token=secret#reviews",
    finalUrl: "https://example.com/products/stand?variant=blue&id=42",
    candidateUrl: "https://example.com/products/stand?variant=blue&id=42",
    sourceRelation: "document",
    sourceHost: "EXAMPLE.COM",
    sourceType: "html",
    transportSecurity: "https",
    retrieval: {
      status: "retrieved",
      httpStatus: 200,
      contentType: " text/html; charset=UTF-8 ",
      robots: "allowed",
      redirectCount: 1,
    },
    observations: {
      title: "  Adjustable   Phone Stand ",
      categoryHint: "  ",
      signalText: "  Foldable   desktop stand ",
      priceText: " US$ 9.99 ",
      hasImage: true,
    },
    extractionSignals: [" product page ", "price visible", "product page"],
    ...overrides,
  };
}

function assessmentFixture(overrides: Partial<RuleAssessmentV1Input> = {}): RuleAssessmentV1Input {
  return {
    version: "candidate-rule-v1",
    algorithm: "radar-score-v1",
    evidenceHash: "a".repeat(64),
    computedAt: "2026-07-11T08:05:00+08:00",
    candidateType: "product_candidate",
    scores: {
      demandSignal: 82,
      supplyEase: 76,
      risk: 31,
      beginnerFit: 79,
      final: 77,
    },
    riskFlags: [" weak_brand_evidence ", "manual_price_check", "weak_brand_evidence"],
    reasons: [" Demand signal is visible ", "Manual price check required"],
    queueSuggestion: "review",
    ...overrides,
  };
}

describe("SourceEvidenceV2 contract", () => {
  it("normalizes time, whitespace, nullable values, URL query order and source host", () => {
    const normalized = normalizeSourceEvidenceV2(evidenceFixture());

    expect(normalized).toEqual({
      version: "candidate-source-v2",
      evidenceId: "evidence-001",
      origin: "public_url",
      capturedAt: "2026-07-11T00:00:00.000Z",
      submittedUrl: "https://example.com/products/stand?id=42",
      finalUrl: "https://example.com/products/stand?id=42&variant=blue",
      candidateUrl: "https://example.com/products/stand?id=42&variant=blue",
      sourceRelation: "document",
      sourceHost: "example.com",
      sourceType: "html",
      transportSecurity: "https",
      retrieval: {
        status: "retrieved",
        httpStatus: 200,
        contentType: "text/html; charset=utf-8",
        robots: "allowed",
        redirectCount: 1,
      },
      observations: {
        title: "Adjustable Phone Stand",
        categoryHint: null,
        signalText: "Foldable desktop stand",
        priceText: "US$ 9.99",
        hasImage: true,
      },
      extractionSignals: ["price visible", "product page"],
    });
  });

  it("produces the same evidence hash for equivalent key, set and empty-value ordering", () => {
    const first = evidenceFixture();
    const second: SourceEvidenceV2Input = {
      extractionSignals: ["price visible", "product page"],
      observations: {
        hasImage: true,
        priceText: "US$ 9.99",
        signalText: "Foldable desktop stand",
        categoryHint: null,
        title: "Adjustable Phone Stand",
      },
      retrieval: {
        redirectCount: 1,
        robots: "allowed",
        contentType: "text/html; charset=utf-8",
        httpStatus: 200,
        status: "retrieved",
      },
      transportSecurity: "https",
      sourceType: "html",
      sourceHost: "example.com",
      finalUrl: "https://example.com/products/stand?id=42&variant=blue",
      candidateUrl: "https://example.com/products/stand?id=42&variant=blue",
      sourceRelation: "document",
      submittedUrl: "https://example.com/products/stand?id=42&utm_medium=email",
      capturedAt: "2026-07-11T00:00:00.000Z",
      origin: "public_url",
      evidenceId: "evidence-001",
      version: "candidate-source-v2",
    };

    expect(createEvidenceHash(first)).toMatch(HASH_PATTERN);
    expect(createEvidenceHash(second)).toBe(createEvidenceHash(first));
  });

  it.each([
    ["title", { observations: { ...evidenceFixture().observations, title: "Different product" } }],
    ["product URL", {
      finalUrl: "https://example.com/products/stand?id=43&variant=blue",
      candidateUrl: "https://example.com/products/stand?id=43&variant=blue",
    }],
    ["capture time", { capturedAt: "2026-07-11T00:00:01.000Z" }],
    ["transport security", { transportSecurity: "http" }],
    ["source relation", { sourceRelation: "document_item" }],
    ["image fact", { observations: { ...evidenceFixture().observations, hasImage: false } }],
  ])("changes evidenceHash when the critical %s fact changes", (_label, change) => {
    expect(createEvidenceHash(evidenceFixture(change as Partial<SourceEvidenceV2Input>)))
      .not.toBe(createEvidenceHash(evidenceFixture()));
  });

  it("changes evidenceHash when a document item candidate URL changes", () => {
    const first = evidenceFixture({ sourceRelation: "document_item" });
    const second = evidenceFixture({
      sourceRelation: "document_item",
      candidateUrl: "https://example.com/products/stand?id=42&variant=green",
    });
    expect(createEvidenceHash(second)).not.toBe(createEvidenceHash(first));
  });

  it.each([
    "https://user:pass@example.com/product",
    "ftp://example.com/product",
    "https://example.com:8443/product",
  ])("rejects unsafe source URLs: %s", (url) => {
    expect(() => normalizeSourceEvidenceV2(evidenceFixture({ finalUrl: url }))).toThrow();
  });

  it("rejects invalid timestamps instead of inventing a capture time", () => {
    expect(() => normalizeSourceEvidenceV2(evidenceFixture({ capturedAt: "not-a-date" }))).toThrow();
  });

  it("treats blank manual retrieval metadata as empty and rejects invalid runtime enums", () => {
    expect(normalizeSourceEvidenceV2({
      version: "candidate-source-v2",
      evidenceId: "manual-001",
      origin: "manual",
      capturedAt: "2026-07-11T00:00:00.000Z",
      candidateUrl: null,
      sourceRelation: "manual",
      sourceType: "manual",
      transportSecurity: "manual",
      retrieval: {
        status: "manual",
        contentType: "   ",
        robots: "manual",
      },
      observations: { title: "Manual candidate" },
    }).retrieval.contentType).toBeNull();

    expect(() => normalizeSourceEvidenceV2({
      ...evidenceFixture(),
      sourceType: "client-forged" as "html",
    })).toThrow("SOURCE_TYPE_INVALID");
  });

  it("allows a document item without a trustworthy candidate link", () => {
    const normalized = normalizeSourceEvidenceV2(evidenceFixture({
      candidateUrl: null,
      sourceRelation: "document_item",
    }));

    expect(normalized.candidateUrl).toBeNull();
    expect(normalized.sourceRelation).toBe("document_item");
  });

  it("rejects a document relation whose candidate URL is not the fetched final URL", () => {
    expect(() => normalizeSourceEvidenceV2(evidenceFixture({
      candidateUrl: "https://example.com/products/another-item",
      sourceRelation: "document",
    }))).toThrow("DOCUMENT_CANDIDATE_URL_MISMATCH");
  });

  it("rejects public and manual source relation mixing", () => {
    expect(() => normalizeSourceEvidenceV2(evidenceFixture({
      sourceRelation: "manual",
      candidateUrl: null,
    }))).toThrow("PUBLIC_SOURCE_RELATION_INVALID");
  });
});

describe("RuleAssessmentV1 contract", () => {
  it("normalizes rule output and produces a stable hash", () => {
    const first = assessmentFixture();
    const second: RuleAssessmentV1Input = {
      queueSuggestion: "review",
      reasons: ["Manual price check required", "Demand signal is visible"],
      riskFlags: ["manual_price_check", "weak_brand_evidence"],
      scores: {
        final: 77,
        beginnerFit: 79,
        risk: 31,
        supplyEase: 76,
        demandSignal: 82,
      },
      candidateType: " product_candidate ",
      computedAt: "2026-07-11T00:05:00.000Z",
      evidenceHash: "A".repeat(64),
      algorithm: "radar-score-v1",
      version: "candidate-rule-v1",
    };

    expect(normalizeRuleAssessmentV1(first).computedAt).toBe("2026-07-11T00:05:00.000Z");
    expect(createAssessmentHash(first)).toMatch(HASH_PATTERN);
    expect(createAssessmentHash(second)).toBe(createAssessmentHash(first));
  });

  it.each([
    ["evidence", { evidenceHash: "b".repeat(64) }],
    ["score", { scores: { ...assessmentFixture().scores, final: 78 } }],
    ["suggestion", { queueSuggestion: "watch" }],
    ["algorithm", { algorithm: "radar-score-v2" }],
  ])("changes assessmentHash when %s changes", (_label, change) => {
    expect(createAssessmentHash(assessmentFixture(change as Partial<RuleAssessmentV1Input>)))
      .not.toBe(createAssessmentHash(assessmentFixture()));
  });

  it("rejects an invalid queue suggestion received at runtime", () => {
    expect(() => normalizeRuleAssessmentV1(assessmentFixture({
      queueSuggestion: "completed" as "review",
    }))).toThrow("QUEUE_SUGGESTION_INVALID");
  });
});
