import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAssessmentHash,
  createEvidenceHash,
  normalizeRuleAssessmentV1,
  normalizeSourceEvidenceV2,
  type RuleAssessmentV1,
  type SourceEvidenceV2,
} from "@/lib/sourceEvidenceContract";
import { createSourceProof } from "@/lib/server/sourceProof";
import { parseCandidateEvidenceSnapshot } from "@/lib/candidateEvidence";
import { assessSourceEvidenceV2 } from "@/lib/server/sourceEvidenceAssessment";
import { LEGACY_RULE_ASSESSMENT_ALGORITHM } from "@/lib/ruleAssessmentPolicy";

vi.mock("@/lib/server/accessPassword", () => ({
  getAccessPassword: () => "candidate-source-save-test-password",
}));

import {
  CandidateSourceSaveError,
  normalizeCandidateIdentity,
  parseStoredCandidateSourceMeta,
  preflightCandidateSaveBatch,
} from "@/lib/server/candidateSourceSave";

const NOW = Date.parse("2026-07-11T12:00:00.000Z");

function buildEvidence(overrides: Partial<SourceEvidenceV2> = {}): SourceEvidenceV2 {
  return normalizeSourceEvidenceV2({
    version: "candidate-source-v2",
    evidenceId: "source-evidence-a",
    origin: "public_url",
    capturedAt: "2026-07-11T11:59:00.000Z",
    submittedUrl: "https://example.com/feed.xml",
    finalUrl: "https://example.com/feed.xml",
    candidateUrl: "https://example.com/products/widget",
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
      title: "  Foldable   Widget Stand  ",
      categoryHint: "Desk accessories",
      signalText: "Portable lightweight generic metal stand",
      priceText: null,
      hasImage: null,
    },
    extractionSignals: ["rss_item"],
    ...overrides,
  });
}

function buildAssessment(
  evidence: SourceEvidenceV2,
  overrides: Partial<RuleAssessmentV1> = {},
): RuleAssessmentV1 {
  const base = assessSourceEvidenceV2(evidence, "2026-07-11T11:59:30.000Z");
  return normalizeRuleAssessmentV1({
    ...base,
    ...overrides,
    scores: overrides.scores ?? base.scores,
  });
}

function signedItem(options: {
  subject?: string;
  evidence?: SourceEvidenceV2;
  assessment?: RuleAssessmentV1;
  proofNow?: number;
} = {}) {
  const evidence = options.evidence ?? buildEvidence();
  const assessment = options.assessment ?? buildAssessment(evidence);
  const sourceProof = createSourceProof({
    subject: options.subject ?? "owner",
    evidenceHash: createEvidenceHash(evidence),
    assessmentHash: createAssessmentHash(assessment),
    sourceType: evidence.sourceType,
    now: options.proofNow ?? NOW,
  });
  return {
    name: "forged client name",
    link: "https://attacker.invalid/forged",
    score: 100,
    status: "analyzed",
    sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", evidenceHash: "forged" }),
    analysisJson: JSON.stringify({ result: "forged" }),
    sourceEvidence: evidence,
    ruleAssessment: assessment,
    sourceProof,
  };
}

function expectCode(fn: () => unknown, code: string) {
  expect(fn).toThrowError(CandidateSourceSaveError);
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("candidate signed source save contract", () => {
  it("derives every trusted Candidate field from signed Evidence and Assessment", () => {
    const input = signedItem();
    const result = preflightCandidateSaveBatch(
      [input],
      { mode: "owner" },
      NOW + 1_000,
    );

    expect(result.mode).toBe("signed_source_v2");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      name: "Foldable Widget Stand",
      rawInput: "Foldable Widget Stand",
      link: "https://example.com/products/widget",
      score: 72,
      source: "RSS抓取 · example.com",
      keyword: "Desk accessories",
      riskLevel: "green",
      riskLabel: "低风险",
      status: "pending",
      convertedTaskId: null,
      evidenceHash: createEvidenceHash(buildEvidence()),
    });
    expect(result.items[0].name).not.toContain("forged");
    expect(result.items[0].link).not.toContain("attacker.invalid");
    const storedSourceMeta = JSON.parse(result.items[0].sourceMetaJson);
    expect(storedSourceMeta).toMatchObject({
      version: "candidate-source-meta-v2",
      integrity: "signed_source_v2",
    });
    expect(parseCandidateEvidenceSnapshot(storedSourceMeta.evidenceSnapshot)).not.toBeNull();
    expect(parseStoredCandidateSourceMeta(result.items[0].sourceMetaJson)).toEqual({
      integrity: "signed_source_v2",
      evidenceHash: createEvidenceHash(input.sourceEvidence),
    });
    expect(JSON.parse(result.items[0].analysisJson)).toMatchObject({
      version: "candidate-analysis-v2",
      integrity: "signed_source_v2",
    });
  });

  it("rejects partial and mixed signed batches before persistence", () => {
    const complete = signedItem();
    const partial = { ...complete, sourceProof: undefined };
    expectCode(
      () => preflightCandidateSaveBatch([partial], { mode: "owner" }, NOW + 1_000),
      "candidate_batch_invalid",
    );
    expectCode(
      () => preflightCandidateSaveBatch([
        complete,
        { name: "manual item" },
      ], { mode: "owner" }, NOW + 1_000),
      "candidate_batch_invalid",
    );
    expectCode(
      () => preflightCandidateSaveBatch([complete, "not-an-object"], { mode: "owner" }, NOW + 1_000),
      "candidate_batch_invalid",
    );
  });

  it("rejects tampered Evidence, Assessment, expired proof and wrong subject", () => {
    const original = signedItem();
    const tamperedEvidence = {
      ...original,
      sourceEvidence: {
        ...original.sourceEvidence,
        observations: { ...original.sourceEvidence.observations, title: "Tampered title" },
      },
    };
    expectCode(
      () => preflightCandidateSaveBatch([tamperedEvidence], { mode: "owner" }, NOW + 1_000),
      "source_proof_invalid",
    );

    const tamperedAssessment = {
      ...original,
      ruleAssessment: {
        ...original.ruleAssessment,
        scores: { ...original.ruleAssessment.scores, final: 99 },
      },
    };
    expectCode(
      () => preflightCandidateSaveBatch([tamperedAssessment], { mode: "owner" }, NOW + 1_000),
      "source_proof_invalid",
    );
    expectCode(
      () => preflightCandidateSaveBatch([original], { mode: "demo", demoAccessId: "visitor-a" }, NOW + 1_000),
      "source_proof_invalid",
    );
    expectCode(
      () => preflightCandidateSaveBatch([original], { mode: "owner" }, NOW + 2 * 60 * 60 * 1_000),
      "source_proof_invalid",
    );
  });

  it("recomputes the signed Assessment and rejects a valid proof over non-reproducible rules", () => {
    const sourceEvidence = buildEvidence();
    const base = buildAssessment(sourceEvidence);
    const forgedAssessment = buildAssessment(sourceEvidence, {
      scores: { ...base.scores, final: base.scores.final + 1 },
    });

    expectCode(
      () => preflightCandidateSaveBatch([
        signedItem({ evidence: sourceEvidence, assessment: forgedAssessment }),
      ], { mode: "owner" }, NOW + 1_000),
      "source_proof_invalid",
    );
  });

  it("accepts only current product review/watch assessments", () => {
    const watchEvidence = buildEvidence({
      observations: {
        title: "Widget",
        categoryHint: null,
        signalText: "Unknown widget",
        priceText: null,
        hasImage: null,
      },
    });
    const watch = preflightCandidateSaveBatch(
      [signedItem({ evidence: watchEvidence })],
      { mode: "owner" },
      NOW + 1_000,
    );
    expect(watch.items[0].summaryLabel).toContain("人工观察");

    for (const title of ["Shop by Kitchen", "Privacy Policy"]) {
      const blockedEvidence = buildEvidence({
        evidenceId: `source-${title.replace(/\s+/g, "-").toLowerCase()}`,
        observations: {
          title,
          categoryHint: null,
          signalText: title,
          priceText: null,
          hasImage: null,
        },
      });
      expectCode(
        () => preflightCandidateSaveBatch(
          [signedItem({ evidence: blockedEvidence })],
          { mode: "owner" },
          NOW + 1_000,
        ),
        "candidate_batch_invalid",
      );
    }
  });

  it("rejects stale signed source-import algorithms without downgrading to legacy", () => {
    const sourceEvidence = buildEvidence();
    const current = buildAssessment(sourceEvidence);
    const legacy = buildAssessment(sourceEvidence, {
      algorithm: LEGACY_RULE_ASSESSMENT_ALGORITHM,
      scores: current.scores,
    });

    expectCode(
      () => preflightCandidateSaveBatch(
        [signedItem({ evidence: sourceEvidence, assessment: legacy })],
        { mode: "owner" },
        NOW + 1_000,
      ),
      "candidate_batch_invalid",
    );
  });

  it("collapses same Evidence but rejects same normalized name with different Evidence", () => {
    const first = signedItem();
    const collapsed = preflightCandidateSaveBatch(
      [first, { ...first }],
      { mode: "owner" },
      NOW + 1_000,
    );
    expect(collapsed.items).toHaveLength(1);

    const changedEvidence = buildEvidence({ evidenceId: "source-evidence-b" });
    const second = signedItem({ evidence: changedEvidence });
    expectCode(
      () => preflightCandidateSaveBatch([first, second], { mode: "owner" }, NOW + 1_000),
      "candidate_source_conflict",
    );
  });

  it("keeps legacy compatibility while discarding client source and analysis JSON", () => {
    const result = preflightCandidateSaveBatch([{
      name: "  Manual   Product  ",
      rawInput: "manual product input",
      link: "https://example.com/manual-product",
      score: 66,
      source: "人工录入",
      keyword: "manual",
      riskLevel: "yellow",
      riskLabel: "需注意",
      summaryLabel: "人工候选",
      sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", secret: "forged" }),
      analysisJson: JSON.stringify({ trusted: true }),
    }], { mode: "owner" }, NOW);

    expect(result.mode).toBe("legacy_unverified");
    expect(result.items[0]).toMatchObject({
      name: "Manual Product",
      rawInput: "manual product input",
      score: 66,
      source: "人工录入",
      status: "pending",
      convertedTaskId: null,
    });
    const storedSourceMeta = JSON.parse(result.items[0].sourceMetaJson);
    expect(storedSourceMeta).toMatchObject({
      version: "candidate-source-meta-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
    });
    expect(parseCandidateEvidenceSnapshot(storedSourceMeta.evidenceSnapshot)).not.toBeNull();
    expect(result.items[0].sourceMetaJson).not.toContain("secret");
    expect(JSON.parse(result.items[0].analysisJson)).toEqual({
      version: "candidate-analysis-v2",
      integrity: "legacy_unverified",
      origin: "manual_or_legacy",
    });
  });

  it.each(["worth_analyzing", "analyzed", "paused", "rejected"])(
    "forces legacy initial status %s back to pending",
    (status) => {
      const result = preflightCandidateSaveBatch([{
        name: "Manual Product",
        status,
        convertedTaskId: "client-task-id",
      }], { mode: "owner" }, NOW);

      expect(result.items[0]).toMatchObject({ status: "pending", convertedTaskId: null });
    },
  );

  it("normalizes Candidate identity consistently", () => {
    expect(normalizeCandidateIdentity("  Foldable   WIDGET Stand ")).toBe("foldable widget stand");
  });
});
