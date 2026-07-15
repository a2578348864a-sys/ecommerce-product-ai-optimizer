import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStage2PublicCostReviewDecision } from "./stage2-public-cost-review";
import {
  applyStage2PublicCostReviewDecision,
  type Stage2PublicCostApplicationInput,
} from "./stage2-public-cost-application";

const PROJECT_ROOT = resolve(process.cwd(), "..");
const read = <T>(relative: string) => JSON.parse(readFileSync(resolve(PROJECT_ROOT, relative), "utf8")) as T;

function fixture(): Stage2PublicCostApplicationInput {
  const researchRoot = "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Research-Run-01";
  const sources = {
    brief: read(`${researchRoot.replace("Research-Run", "Research-Brief").replace("-Run-01", "-Brief-01")}/stage2-public-cost-research-brief.v1.json`),
    run: read(`${researchRoot}/stage2-public-cost-research-run.v1.json`),
    evidence: read(`${researchRoot}/stage2-public-cost-evidence.v1.json`),
    validation: read(`${researchRoot}/stage2-public-cost-evidence-validation.v1.json`),
    preview: read(`${researchRoot}/stage2-public-cost-derivation-preview.v1.json`),
    patchPreview: read(`${researchRoot}/stage2-public-cost-submission-patch.preview.v1.json`),
  } as Stage2PublicCostApplicationInput["sources"];
  const request = read<Stage2PublicCostApplicationInput["request"]>(
    "06_测试与验证/2026-07-15-Phase-Stage2-Public-Cost-Review-01/stage2-public-cost-review-request.v1.json",
  );
  const decision = buildStage2PublicCostReviewDecision({
    request,
    confirmationText: request.exactConfirmationText,
    decidedAt: "2026-07-15T18:30:00+08:00",
  });
  return {
    inventory: read("06_测试与验证/2026-07-14-Phase-Stage1-Solo-Validation-01/05-Stage2证据缺口清单/stage2-evidence-gap-inventory.v1.json"),
    submission: read("06_测试与验证/2026-07-15-Phase-Stage2-Manual-Evidence-A-03/stage2-evidence-submission.partial.v1.json"),
    sources,
    request,
    decision,
    appliedAt: "2026-07-15T18:31:00+08:00",
  };
}

describe("Stage 2 public-cost provisional BOM application", () => {
  it("applies only the reviewed BOM and remains profit_insufficient_evidence", () => {
    const input = fixture();
    const original = structuredClone(input.submission);
    const result = applyStage2PublicCostReviewDecision(input);
    const target = result.submission.samples.find((sample) => sample.sampleId === "stage2-high-01")!;

    expect(input.submission).toEqual(original);
    expect(target.fields.bom).toMatchObject({
      value: 2.73,
      missingReason: null,
      evidence: { sourceType: "derived", sourceUrl: null },
    });
    expect(target.fields.bom.evidence?.inputHash).toBe(input.sources.patchPreview.proposedStage2Fields.bom.inputHash);
    expect(result.validation).toMatchObject({
      status: "incomplete",
      summary: { readyForCalibrationCount: 0 },
    });
    expect(result.calibration.status).toBe("profit_insufficient_evidence");
    expect(result.boundary).toEqual({
      provisionalBomOnly: true,
      profitCalculated: false,
      humanDecisionPreserved: true,
      candidateCreated: false,
      databaseWritten: false,
      stage1RankingModified: false,
    });
  });

  it("preserves every non-BOM field and every non-target sample", () => {
    const input = fixture();
    const result = applyStage2PublicCostReviewDecision(input);
    const beforeTarget = input.submission.samples.find((sample) => sample.sampleId === "stage2-high-01")!;
    const afterTarget = result.submission.samples.find((sample) => sample.sampleId === "stage2-high-01")!;

    expect(result.submission.samples.filter((sample) => sample.sampleId !== "stage2-high-01"))
      .toEqual(input.submission.samples.filter((sample) => sample.sampleId !== "stage2-high-01"));
    expect({ ...afterTarget.fields, bom: beforeTarget.fields.bom }).toEqual(beforeTarget.fields);
    expect(afterTarget.variantIdentity).toEqual(beforeTarget.variantIdentity);
  });

  it("is deterministic for identical inputs", () => {
    const input = fixture();
    expect(applyStage2PublicCostReviewDecision(input)).toEqual(
      applyStage2PublicCostReviewDecision(structuredClone(input)),
    );
  });

  it("fails closed for a tampered decision", () => {
    const input = fixture();
    input.decision.decisionHash = "0".repeat(64);
    expect(() => applyStage2PublicCostReviewDecision(input))
      .toThrow("STAGE2_PUBLIC_COST_APPLICATION_DECISION_INVALID");
  });

  it("never overwrites an existing BOM", () => {
    const input = fixture();
    const target = input.submission.samples.find((sample) => sample.sampleId === "stage2-high-01")!;
    target.fields.bom = {
      value: 9.99,
      missingReason: null,
      evidence: {
        sourceType: "manual",
        sourceUrl: null,
        capturedAt: "2026-07-15T18:00:00+08:00",
        note: "Existing manually supplied BOM.",
        inputHash: null,
      },
    };
    expect(() => applyStage2PublicCostReviewDecision(input))
      .toThrow("STAGE2_PUBLIC_COST_APPLICATION_BOM_OVERWRITE_FORBIDDEN");
  });

  it("fails closed when the brief target is absent from the submission", () => {
    const input = fixture();
    input.sources.brief.sample.sampleId = "stage2-missing-01";
    expect(() => applyStage2PublicCostReviewDecision(input))
      .toThrow("STAGE2_PUBLIC_COST_APPLICATION_SOURCE_INVALID");
  });
});
