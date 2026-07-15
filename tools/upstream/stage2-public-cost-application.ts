import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildStage2CalibrationFromSubmission,
  validateStage2EvidenceSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import {
  validateStage2PublicCostReviewDecision,
  validateStage2PublicCostReviewRequest,
  type Stage2PublicCostReviewDecision,
  type Stage2PublicCostReviewRequest,
  type Stage2PublicCostReviewSources,
} from "./stage2-public-cost-review";

export type Stage2PublicCostApplicationInput = {
  inventory: Stage2EvidenceGapInventory;
  submission: Stage2EvidenceSubmission;
  sources: Stage2PublicCostReviewSources;
  request: Stage2PublicCostReviewRequest;
  decision: Stage2PublicCostReviewDecision;
  appliedAt: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function applyStage2PublicCostReviewDecision(input: Stage2PublicCostApplicationInput) {
  if (!validIso(input.appliedAt)) {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_APPLIED_AT_INVALID");
  }

  const requestValidation = validateStage2PublicCostReviewRequest(input.sources, input.request);
  if (requestValidation.status !== "valid_pending_user_review") {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_SOURCE_INVALID");
  }
  const decisionValidation = validateStage2PublicCostReviewDecision(input.request, input.decision);
  if (decisionValidation.status !== "valid_accepted_not_applied") {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_DECISION_INVALID");
  }

  let sourceValidation: ReturnType<typeof validateStage2EvidenceSubmission>;
  try {
    sourceValidation = validateStage2EvidenceSubmission(input.inventory, input.submission);
  } catch {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_SUBMISSION_INVALID");
  }
  if (sourceValidation.status === "rejected" || sourceValidation.evidenceMode !== "real_evidence") {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_SUBMISSION_INVALID");
  }

  const targetId = input.sources.brief.sample.sampleId;
  const sourceTarget = input.submission.samples.find((sample) => sample.sampleId === targetId);
  if (!sourceTarget || sourceTarget.productKey !== input.sources.brief.sample.productKey) {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_TARGET_INVALID");
  }
  if (sourceTarget.fields.bom.value !== null
    || sourceTarget.fields.bom.evidence !== null
    || !sourceTarget.fields.bom.missingReason) {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_BOM_OVERWRITE_FORBIDDEN");
  }
  if (sourceValidation.submissionHash !== input.sources.brief.sourceSubmissionHash
    || input.submission.sourceGapInventoryHash !== input.sources.brief.sourceGapInventoryHash) {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_SUBMISSION_INVALID");
  }

  const bom = input.request.proposedBom.value;
  const bomInputHash = input.sources.patchPreview.proposedStage2Fields.bom.inputHash;
  const submission = structuredClone(input.submission);
  const target = submission.samples.find((sample) => sample.sampleId === targetId)!;
  target.fields.bom = {
    value: bom,
    missingReason: null,
    evidence: {
      sourceType: "derived",
      sourceUrl: null,
      capturedAt: input.appliedAt,
      note: `Provisional reviewed derivation: 18.50 CNY / 6.7766 CNY_PER_USD = ${bom.toFixed(2)} USD per item; not a final supplier quote.`,
      inputHash: bomInputHash,
    },
  };
  submission.submissionId = `stage2-evidence-submission-${stableHash({
    sourceSubmissionHash: sourceValidation.submissionHash,
    decisionHash: input.decision.decisionHash,
    targetId,
    bomInputHash,
  }).slice(0, 24)}`;
  submission.createdAt = input.appliedAt;
  submission.submittedBy = "project_owner_reviewed_public_cost_derivation";

  const validation = validateStage2EvidenceSubmission(input.inventory, submission);
  if (validation.status === "rejected") {
    throw new Error("STAGE2_PUBLIC_COST_APPLICATION_OUTPUT_INVALID");
  }
  const calibration = buildStage2CalibrationFromSubmission(input.inventory, submission);
  const body = {
    schemaVersion: "stage2-public-cost-application-result.v1" as const,
    status: "provisional_bom_applied_locally" as const,
    appliedAt: input.appliedAt,
    targetSampleId: targetId,
    sourceSubmissionHash: sourceValidation.submissionHash,
    sourceRequestHash: input.request.requestHash,
    sourceDecisionHash: input.decision.decisionHash,
    sourcePatchPreviewHash: input.request.patchPreviewHash,
    appliedField: {
      field: "bom" as const,
      value: bom,
      currency: "USD" as const,
      unit: "per_item" as const,
      inputHash: bomInputHash,
    },
    outputSubmissionHash: validation.submissionHash,
    outputValidationHash: validation.evidenceHash,
    outputCalibrationHash: calibration.inputHash,
    boundary: {
      provisionalBomOnly: true as const,
      profitCalculated: false as const,
      humanDecisionPreserved: true as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
      stage1RankingModified: false as const,
    },
  };
  return {
    ...body,
    applicationHash: stableHash(body),
    submission,
    validation,
    calibration,
  };
}
