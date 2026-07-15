import { stableHash } from "../../lib/upstream/pipeline";
import { validateStage2PublicCostResearchBrief, type Stage2PublicCostResearchBrief } from "./stage2-public-cost-research-brief";
import type { Stage2PublicCostEvidence } from "./stage2-public-cost-evidence";
import type { Stage2PublicCostResearchRun } from "./stage2-public-cost-research-run";

type EvidenceValidation = { status: string; evidenceHash: string; inputHash: string; reasonCodes: string[] };
type DerivationPreview = {
  status: string;
  inputHash: string;
  derivedStage2Fields: { bom: { value: number | null; inputHash: string }; platformCommission: { value: number | null }; fba: { value: number | null } };
  boundary: { stage2SubmissionMutated: false; profitCalculated: false; humanDecisionRecorded: false; candidateCreated: false; databaseWritten: false };
};
type PatchPreview = {
  schemaVersion: "stage2-public-cost-submission-patch-preview.v1";
  briefId: string;
  briefHash: string;
  runId: string;
  runHash: string;
  sourceEvidenceHash: string;
  status: "partial_patch_requires_manual_review";
  proposedStage2Fields: { bom: { value: number; currency: "USD"; unit: "per_item"; status: "review_required"; inputHash: string } };
  boundary: { previewOnly: true; stage2SubmissionMutated: false; profitCalculated: false; humanDecisionRecorded: false; candidateCreated: false; databaseWritten: false };
  previewHash: string;
};
export type Stage2PublicCostReviewSources = {
  brief: Stage2PublicCostResearchBrief;
  run: Stage2PublicCostResearchRun;
  evidence: Stage2PublicCostEvidence;
  validation: EvidenceValidation;
  preview: DerivationPreview;
  patchPreview: PatchPreview;
};

export type Stage2PublicCostReviewRequest = {
  schemaVersion: "stage2-public-cost-review-request.v1";
  requestId: string;
  status: "pending_user_review";
  createdAt: string;
  briefId: string;
  briefHash: string;
  runId: string;
  runHash: string;
  evidenceHash: string;
  derivationPreviewHash: string;
  patchPreviewHash: string;
  proposedBom: { value: number; currency: "USD"; unit: "per_item" };
  exactConfirmationText: string;
  stage2SubmissionMutated: false;
  requestHash: string;
};

export type Stage2PublicCostReviewDecision = {
  schemaVersion: "stage2-public-cost-review-decision.v1";
  decisionId: string;
  requestId: string;
  requestHash: string;
  decision: "accepted_as_provisional_derived_input";
  decidedAt: string;
  decidedBy: "user";
  confirmationTextHash: string;
  stage2SubmissionMutated: false;
  decisionHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function validateSources(sources: Stage2PublicCostReviewSources) {
  const reasons: string[] = [];
  if (validateStage2PublicCostResearchBrief(sources.brief).status !== "valid_pending_authorization") reasons.push("brief_invalid");
  const { runHash, ...runBody } = sources.run;
  if (stableHash(runBody) !== runHash) reasons.push("run_hash_mismatch");
  if (sources.run.briefId !== sources.brief.briefId || sources.run.briefHash !== sources.brief.briefHash) reasons.push("run_binding_mismatch");
  if (stableHash(sources.evidence) !== sources.validation.evidenceHash || sources.validation.status !== "valid_partial") reasons.push("evidence_invalid");
  const { previewHash, ...patchBody } = sources.patchPreview;
  if (stableHash(patchBody) !== previewHash) reasons.push("patch_preview_hash_mismatch");
  const bom = sources.preview.derivedStage2Fields.bom.value;
  if (typeof bom !== "number" || !Number.isFinite(bom) || bom <= 0
    || sources.patchPreview.proposedStage2Fields.bom.value !== bom
    || sources.patchPreview.proposedStage2Fields.bom.inputHash !== sources.preview.derivedStage2Fields.bom.inputHash) reasons.push("bom_binding_invalid");
  if (sources.preview.derivedStage2Fields.platformCommission.value !== null
    || sources.preview.derivedStage2Fields.fba.value !== null) reasons.push("unsupported_cost_field_present");
  if (sources.patchPreview.runHash !== sources.run.runHash
    || sources.patchPreview.sourceEvidenceHash !== sources.validation.evidenceHash
    || sources.patchPreview.boundary.stage2SubmissionMutated !== false) reasons.push("patch_preview_binding_invalid");
  return reasons;
}

export function buildStage2PublicCostReviewRequest(
  input: Stage2PublicCostReviewSources & { createdAt: string },
): Stage2PublicCostReviewRequest {
  if (!validIso(input.createdAt)) throw new Error("STAGE2_PUBLIC_COST_REVIEW_CREATED_AT_INVALID");
  const sourceReasons = validateSources(input);
  if (sourceReasons.length > 0) throw new Error(`STAGE2_PUBLIC_COST_REVIEW_SOURCE_INVALID:${sourceReasons.join(",")}`);
  const bom = input.preview.derivedStage2Fields.bom.value as number;
  const body = {
    schemaVersion: "stage2-public-cost-review-request.v1" as const,
    requestId: `stage2-public-cost-review-${stableHash({ runHash: input.run.runHash, patchPreviewHash: input.patchPreview.previewHash }).slice(0, 24)}`,
    status: "pending_user_review" as const,
    createdAt: input.createdAt,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    runId: input.run.runId,
    runHash: input.run.runHash,
    evidenceHash: input.validation.evidenceHash,
    derivationPreviewHash: stableHash(input.preview),
    patchPreviewHash: input.patchPreview.previewHash,
    proposedBom: { value: bom, currency: "USD" as const, unit: "per_item" as const },
    exactConfirmationText: `我确认将 BOM ${bom.toFixed(2)} USD/件作为 Stage 2 暂定派生输入；它不代表最终报价，其余未知成本继续保持 null。`,
    stage2SubmissionMutated: false as const,
  };
  return { ...body, requestHash: stableHash(body) };
}

export function validateStage2PublicCostReviewRequest(
  sources: Stage2PublicCostReviewSources,
  request: Stage2PublicCostReviewRequest,
) {
  const reasonCodes = validateSources(sources);
  const { requestHash, ...body } = request;
  if (stableHash(body) !== requestHash) reasonCodes.push("request_hash_mismatch");
  if (request.schemaVersion !== "stage2-public-cost-review-request.v1" || request.status !== "pending_user_review") reasonCodes.push("request_state_invalid");
  if (!validIso(request.createdAt)) reasonCodes.push("created_at_invalid");
  if (request.briefId !== sources.brief.briefId || request.briefHash !== sources.brief.briefHash
    || request.runId !== sources.run.runId || request.runHash !== sources.run.runHash
    || request.evidenceHash !== sources.validation.evidenceHash
    || request.derivationPreviewHash !== stableHash(sources.preview)
    || request.patchPreviewHash !== sources.patchPreview.previewHash) reasonCodes.push("source_binding_mismatch");
  const expectedBom = sources.preview.derivedStage2Fields.bom.value;
  if (request.proposedBom.value !== expectedBom || request.proposedBom.currency !== "USD" || request.proposedBom.unit !== "per_item") reasonCodes.push("bom_binding_invalid");
  const expectedText = `我确认将 BOM ${(expectedBom as number).toFixed(2)} USD/件作为 Stage 2 暂定派生输入；它不代表最终报价，其余未知成本继续保持 null。`;
  if (request.exactConfirmationText !== expectedText || request.stage2SubmissionMutated !== false) reasonCodes.push("confirmation_boundary_invalid");
  const unique = [...new Set(reasonCodes)];
  return {
    schemaVersion: "stage2-public-cost-review-request-validation.v1" as const,
    status: unique.includes("request_hash_mismatch") ? "invalid_hash" as const
      : unique.length > 0 ? "invalid_contract" as const
        : "valid_pending_user_review" as const,
    reasonCodes: unique,
    inputHash: stableHash({ requestHash, sourceHashes: [sources.run.runHash, sources.validation.evidenceHash, stableHash(sources.preview), sources.patchPreview.previewHash], reasonCodes: unique }),
  };
}

export function buildStage2PublicCostReviewDecision(input: {
  request: Stage2PublicCostReviewRequest;
  confirmationText: string;
  decidedAt: string;
}): Stage2PublicCostReviewDecision {
  if (input.confirmationText !== input.request.exactConfirmationText) throw new Error("STAGE2_PUBLIC_COST_REVIEW_TEXT_MISMATCH");
  if (!validIso(input.decidedAt)) throw new Error("STAGE2_PUBLIC_COST_REVIEW_DECIDED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-public-cost-review-decision.v1" as const,
    decisionId: `stage2-public-cost-review-decision-${stableHash({ requestHash: input.request.requestHash, decidedAt: input.decidedAt }).slice(0, 24)}`,
    requestId: input.request.requestId,
    requestHash: input.request.requestHash,
    decision: "accepted_as_provisional_derived_input" as const,
    decidedAt: input.decidedAt,
    decidedBy: "user" as const,
    confirmationTextHash: stableHash(input.confirmationText),
    stage2SubmissionMutated: false as const,
  };
  return { ...body, decisionHash: stableHash(body) };
}

export function validateStage2PublicCostReviewDecision(
  request: Stage2PublicCostReviewRequest,
  decision: Stage2PublicCostReviewDecision,
) {
  const reasonCodes: string[] = [];
  const { decisionHash, ...body } = decision;
  if (stableHash(body) !== decisionHash) reasonCodes.push("decision_hash_mismatch");
  if (decision.requestId !== request.requestId || decision.requestHash !== request.requestHash) reasonCodes.push("request_binding_mismatch");
  if (decision.confirmationTextHash !== stableHash(request.exactConfirmationText)) reasonCodes.push("confirmation_text_hash_mismatch");
  if (!validIso(decision.decidedAt) || decision.decidedBy !== "user"
    || decision.decision !== "accepted_as_provisional_derived_input" || decision.stage2SubmissionMutated !== false) reasonCodes.push("decision_state_invalid");
  return {
    schemaVersion: "stage2-public-cost-review-decision-validation.v1" as const,
    status: reasonCodes.includes("decision_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_accepted_not_applied" as const,
    reasonCodes,
    inputHash: stableHash({ requestHash: request.requestHash, decisionHash, reasonCodes }),
  };
}
