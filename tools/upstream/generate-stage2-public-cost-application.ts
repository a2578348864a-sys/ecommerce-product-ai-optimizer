import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import { applyStage2PublicCostReviewDecision } from "./stage2-public-cost-application";
import {
  buildStage2PublicCostReviewDecision,
  validateStage2PublicCostReviewDecision,
  type Stage2PublicCostReviewRequest,
  type Stage2PublicCostReviewSources,
} from "./stage2-public-cost-review";
import type { Stage2EvidenceGapInventory, Stage2EvidenceSubmission } from "./stage2-evidence-intake";

type Input = {
  inventoryFile: string;
  submissionFile: string;
  briefFile: string;
  runFile: string;
  evidenceFile: string;
  evidenceValidationFile: string;
  derivationPreviewFile: string;
  patchPreviewFile: string;
  requestFile: string;
  confirmationText: string;
  decidedAt: string;
  appliedAt: string;
  outputDirectory: string;
};

export function generateStage2PublicCostApplication(input: Input) {
  const read = <T>(file: string) => JSON.parse(readFileSync(resolve(file), "utf8")) as T;
  const inventory = read<Stage2EvidenceGapInventory>(input.inventoryFile);
  const sourceSubmission = read<Stage2EvidenceSubmission>(input.submissionFile);
  const sources = {
    brief: read(input.briefFile),
    run: read(input.runFile),
    evidence: read(input.evidenceFile),
    validation: read(input.evidenceValidationFile),
    preview: read(input.derivationPreviewFile),
    patchPreview: read(input.patchPreviewFile),
  } as Stage2PublicCostReviewSources;
  const request = read<Stage2PublicCostReviewRequest>(input.requestFile);
  const decision = buildStage2PublicCostReviewDecision({
    request,
    confirmationText: input.confirmationText,
    decidedAt: input.decidedAt,
  });
  const decisionValidation = validateStage2PublicCostReviewDecision(request, decision);
  if (decisionValidation.status !== "valid_accepted_not_applied") {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_DECISION_INVALID");
  }

  const applied = applyStage2PublicCostReviewDecision({
    inventory,
    submission: sourceSubmission,
    sources,
    request,
    decision,
    appliedAt: input.appliedAt,
  });
  const { submission, validation, calibration, ...application } = applied;
  const files = [
    "stage2-public-cost-review-decision.v1.json",
    "stage2-public-cost-application-result.v1.json",
    "stage2-evidence-submission.public-cost-applied.v1.json",
    "stage2-evidence-validation.public-cost-applied.v1.json",
    "stage2-calibration-run.public-cost-applied.v1.json",
    "generation-summary.stage2-public-cost-application.v1.json",
  ];
  const summaryBody = {
    schemaVersion: "stage2-public-cost-application-generation-summary.v1" as const,
    status: application.status,
    decisionId: decision.decisionId,
    decisionHash: decision.decisionHash,
    applicationHash: application.applicationHash,
    outputSubmissionHash: validation.submissionHash,
    outputValidationHash: validation.evidenceHash,
    outputCalibrationHash: calibration.inputHash,
    evidenceStatus: validation.status,
    calibrationStatus: calibration.status,
    readyForCalibrationCount: validation.summary.readyForCalibrationCount,
    profitInsufficientEvidenceCount: validation.summary.profitInsufficientEvidenceCount,
    boundary: application.boundary,
    files,
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(decision) },
    { relativePath: files[1], content: json(application) },
    { relativePath: files[2], content: json(submission) },
    { relativePath: files[3], content: json(validation) },
    { relativePath: files[4], content: json(calibration) },
    { relativePath: files[5], content: json({ ...summaryBody, evidenceHash: stableHash(summaryBody) }) },
  ], "STAGE2_PUBLIC_COST_APPLICATION_OUTPUT_CONFLICT");

  return {
    decision,
    decisionValidation,
    application,
    submission,
    validation,
    calibration,
    files,
    artifactWrite,
  };
}
