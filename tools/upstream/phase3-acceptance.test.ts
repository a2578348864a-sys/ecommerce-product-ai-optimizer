import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPhase3AcceptanceReport,
  phase3AcceptanceReportHashIsValid,
} from "./phase3-acceptance";

const ROOT = resolve(TEST_PROJECT_MATERIALS_ROOT, "06_测试与验证");

function readJson(path: string) {
  const content = readFileSync(resolve(ROOT, path));
  return {
    value: JSON.parse(content.toString("utf8")) as unknown,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function validInput() {
  const responses = readJson("2026-07-14-Phase-Stage1-Solo-Validation-01/01-新手盲评-先填写/novice-blind-review-responses.v1.json");
  return {
    stage1Summary: readJson("2026-07-14-Phase-Amazon-Human-Assisted-Canary-15/stage1-offline-run-summary.v1.json").value,
    responses: responses.value,
    responsesFileSha256: responses.sha256,
    comparison: readJson("2026-07-14-Phase-Stage1-Solo-Validation-01/03-盲评对照/novice-stage1-comparison.v1.json").value,
    candidatePreview: readJson("2026-07-14-Phase-Stage1-Solo-Validation-01/07-Stage2人工决定与Candidate预览/candidate-advancement-preview.blocked.v1.json").value,
    evaluatedAt: "2026-07-14T14:48:00.000Z",
  };
}

describe("Phase 3 acceptance report", () => {
  it("accepts deterministic Stage 1 plus the locked novice blind review while preserving business boundaries", () => {
    const report = buildPhase3AcceptanceReport(validInput());

    expect(report.status).toBe("passed");
    expect(report.validationConclusion).toBe("limited_scope_reduction_not_business_validated");
    expect(report.counts).toEqual({
      inputCount: 20,
      promoted: 16,
      rejected: 3,
      insufficientEvidence: 1,
      completedBlindReviewAnswers: 20,
      formalCandidateCount: 0,
    });
    expect(report.scopeReduction).toEqual({ count: 4, rate: 0.2, reliablyReducedHumanInvestigation: false });
    expect(report.criteria).toMatchObject({
      stage1Deterministic: true,
      stage1EvidenceHashValid: true,
      blindReviewCompleted: true,
      systemRankingHiddenUntilResponsesLocked: true,
      comparisonLinkedToStage1AndResponses: true,
      systemCountsMatch: true,
      scopeReductionMeasured: true,
      reliabilityBoundaryPreserved: true,
      noviceReviewNotClaimedAsExpert: true,
      previewModeExplicit: true,
      formalCandidateNotGenerated: true,
      productionDatabaseNotWritten: true,
      aiNotCalled: true,
    });
    expect(report.businessValidationProven).toBe(false);
    expect(report.expertReviewProven).toBe(false);
    expect(phase3AcceptanceReportHashIsValid(report)).toBe(true);
  });

  it("fails closed when comparison provenance no longer matches Stage 1", () => {
    const input = structuredClone(validInput());
    (input.comparison as { source: { rankingRunId: string } }).source.rankingRunId = "ranking-wrong";
    const report = buildPhase3AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.reasonCodes).toContain("comparison_source_mismatch");
  });

  it("fails closed when the blind review is incomplete", () => {
    const input = structuredClone(validInput());
    (input.responses as { answers: unknown[] }).answers.pop();
    const report = buildPhase3AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.reasonCodes).toContain("blind_review_incomplete");
  });

  it("fails closed if a formal Candidate appears in the preview-only stage", () => {
    const input = structuredClone(validInput());
    (input.candidatePreview as { boundary: { candidateCreated: boolean } }).boundary.candidateCreated = true;
    const report = buildPhase3AcceptanceReport(input);

    expect(report.status).toBe("failed");
    expect(report.reasonCodes).toContain("formal_candidate_generated");
  });

  it("binds the acceptance conclusion and counts into the evidence hash", () => {
    const report = buildPhase3AcceptanceReport(validInput());
    const changed = structuredClone(report);
    changed.scopeReduction.count = 5;
    expect(phase3AcceptanceReportHashIsValid(changed)).toBe(false);
  });
});
