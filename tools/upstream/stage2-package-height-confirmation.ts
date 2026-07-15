import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  buildStage2CalibrationFromSubmission,
  validateStage2EvidenceSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";
import { buildStage2RemainingEvidenceRequest } from "./stage2-remaining-evidence-request";

export type Stage2PackageHeightConflictEvidence = {
  schemaVersion: string;
  status: string;
  sourceSubmissionHash: string;
  sourceValidationHash: string;
  target: { sampleId: string; productKey: string; supplierUrl: string };
  observation: { packageHeightCm: number; packageLengthCm: number; packageWidthCm: number; packageWeightKg: number };
  conflictAssessment: {
    existingObservedHeightsCm: number[];
    status: string;
    packageHeightCmApplied: number | null;
  };
  boundary: { submissionMutated: boolean };
  evidenceHash: string;
  [key: string]: unknown;
};

export type Stage2PackageHeightConfirmationInput = {
  inventory: Stage2EvidenceGapInventory;
  submission: Stage2EvidenceSubmission;
  conflictEvidence: Stage2PackageHeightConflictEvidence;
  confirmationText: string;
  confirmedAt: string;
};

export type Stage2PackageHeightConfirmationDecision = ReturnType<
  typeof buildStage2PackageHeightConfirmationDecision
>;

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function assertSource(input: Stage2PackageHeightConfirmationInput) {
  let validation: ReturnType<typeof validateStage2EvidenceSubmission>;
  try {
    validation = validateStage2EvidenceSubmission(input.inventory, input.submission);
  } catch {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_SOURCE_INVALID");
  }
  const { evidenceHash, ...conflictBody } = input.conflictEvidence;
  const target = input.submission.samples.find(
    (sample) => sample.sampleId === input.conflictEvidence.target.sampleId,
  );
  const heights = input.conflictEvidence.conflictAssessment.existingObservedHeightsCm;
  if (validation.status === "rejected"
    || validation.evidenceMode !== "real_evidence"
    || stableHash(conflictBody) !== evidenceHash
    || input.conflictEvidence.schemaVersion !== "stage2-package-height-conflict-evidence.v1"
    || input.conflictEvidence.status !== "valid_counterevidence_not_applied"
    || input.conflictEvidence.sourceSubmissionHash !== stableHash(input.submission)
    || input.conflictEvidence.sourceValidationHash !== validation.evidenceHash
    || !target
    || target.productKey !== input.conflictEvidence.target.productKey
    || target.fields.packageHeightCm.value !== null
    || target.fields.packageHeightCm.missingReason !== "conflicting_page_values_3_5_vs_3_8"
    || input.conflictEvidence.observation.packageHeightCm !== 3.5
    || heights.length !== 2
    || heights[0] !== 3.5
    || heights[1] !== 3.8
    || input.conflictEvidence.conflictAssessment.status !== "conflict_confirmed_not_resolved"
    || input.conflictEvidence.conflictAssessment.packageHeightCmApplied !== null
    || input.conflictEvidence.boundary.submissionMutated !== false) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_SOURCE_INVALID");
  }
  return { validation, target };
}

export function buildStage2PackageHeightConfirmationDecision(
  input: Stage2PackageHeightConfirmationInput,
) {
  const { validation, target } = assertSource(input);
  if (input.confirmationText.trim() !== "是3.5cm") {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_TEXT_INVALID");
  }
  if (!validIso(input.confirmedAt)) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_TIME_INVALID");
  }
  const body = {
    schemaVersion: "stage2-package-height-confirmation-decision.v1" as const,
    decisionId: `stage2-package-height-confirmation-${stableHash({
      conflictEvidenceHash: input.conflictEvidence.evidenceHash,
      confirmationText: input.confirmationText.trim(),
      confirmedAt: input.confirmedAt,
    }).slice(0, 24)}`,
    status: "accepted_manual_working_value_not_supplier_confirmation" as const,
    decidedAt: input.confirmedAt,
    decidedBy: "project_owner" as const,
    confirmationText: input.confirmationText.trim(),
    target: {
      sampleId: target.sampleId,
      productKey: target.productKey,
      supplierUrl: input.conflictEvidence.target.supplierUrl,
    },
    confirmedField: "packageHeightCm" as const,
    confirmedValueCm: 3.5 as const,
    supplierConfirmed: false as const,
    sourceConflictEvidenceHash: input.conflictEvidence.evidenceHash,
    sourceSubmissionHash: input.conflictEvidence.sourceSubmissionHash,
    sourceValidationHash: validation.evidenceHash,
    reasonCodes: [
      "project_owner_explicitly_confirmed_3_5_cm",
      "structured_table_value_selected_as_working_value",
      "earlier_3_8_cm_counterevidence_preserved",
      "supplier_confirmation_not_claimed",
    ],
    boundary: {
      manualWorkingValueOnly: true as const,
      originalObservationsPreserved: true as const,
      supplierConfirmationClaimed: false as const,
      otherFieldsMayNotBeFilled: true as const,
    },
  };
  return { ...body, decisionHash: stableHash(body) };
}

export function applyStage2PackageHeightConfirmation(
  input: Stage2PackageHeightConfirmationInput & { decision: Stage2PackageHeightConfirmationDecision },
) {
  const { validation: sourceValidation, target: sourceTarget } = assertSource(input);
  const expectedDecision = buildStage2PackageHeightConfirmationDecision(input);
  if (JSON.stringify(input.decision) !== JSON.stringify(expectedDecision)) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_DECISION_INVALID");
  }
  const bom = sourceTarget.fields.bom.value;
  if (typeof bom !== "number" || !Number.isFinite(bom) || bom <= 0) {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_BOM_INVALID");
  }

  const submission = structuredClone(input.submission);
  const target = submission.samples.find((sample) => sample.sampleId === sourceTarget.sampleId)!;
  target.fields.packageHeightCm = {
    value: 3.5,
    missingReason: null,
    evidence: {
      sourceType: "manual",
      sourceUrl: null,
      capturedAt: input.confirmedAt,
      note: "Project owner explicitly confirmed 3.5 cm as the current working package height for the grey six-shelf variant; prior 3.8 cm counterevidence remains preserved and this is not represented as supplier confirmation.",
      inputHash: null,
    },
  };
  target.fields.executionRiskNotes = {
    value: "原始页面3.5cm与3.8cm冲突继续保留；项目所有者明确采用3.5cm作为当前工作值，但不代表供应商确认。BOM仍为暂定派生值，页面国内运费不可作为Amazon US头程。",
    missingReason: null,
    evidence: {
      sourceType: "manual",
      sourceUrl: null,
      capturedAt: input.confirmedAt,
      note: "Updated only to separate the selected working value from the preserved source conflict and remaining logistics uncertainty.",
      inputHash: null,
    },
  };
  submission.submissionId = `stage2-evidence-submission-${stableHash({
    sourceSubmissionHash: sourceValidation.submissionHash,
    decisionHash: input.decision.decisionHash,
    targetId: target.sampleId,
  }).slice(0, 24)}`;
  submission.createdAt = input.confirmedAt;
  submission.submittedBy = "project_owner_manual_package_height_confirmation";

  const validation = validateStage2EvidenceSubmission(input.inventory, submission);
  if (validation.status === "rejected") {
    throw new Error("STAGE2_PACKAGE_HEIGHT_CONFIRMATION_OUTPUT_INVALID");
  }
  const calibration = buildStage2CalibrationFromSubmission(input.inventory, submission);
  const applicationBody = {
    schemaVersion: "stage2-package-height-confirmation-application.v1" as const,
    status: "package_height_manual_confirmation_applied_locally" as const,
    appliedAt: input.confirmedAt,
    targetSampleId: target.sampleId,
    sourceSubmissionHash: sourceValidation.submissionHash,
    sourceValidationHash: sourceValidation.evidenceHash,
    sourceConflictEvidenceHash: input.conflictEvidence.evidenceHash,
    sourceDecisionHash: input.decision.decisionHash,
    acceptedProvisionalBomUsd: bom,
    appliedField: {
      field: "packageHeightCm" as const,
      value: 3.5 as const,
      unit: "cm" as const,
      sourceType: "manual" as const,
    },
    derivedDiagnostics: {
      packageVolumeCm3: 31 * 31 * 3.5,
      packageWeightKg: input.conflictEvidence.observation.packageWeightKg,
      fbaFee: null,
      fbaFeeMissingReason: "amazon_fee_category_and_applicable_rate_not_confirmed",
    },
    outputSubmissionHash: validation.submissionHash,
    outputValidationHash: validation.evidenceHash,
    outputCalibrationHash: calibration.inputHash,
    boundary: {
      originalConflictEvidencePreserved: true as const,
      supplierConfirmationClaimed: false as const,
      otherUnknownFieldsRemainNull: true as const,
      fbaCalculated: false as const,
      profitCalculated: false as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
      stage1RankingModified: false as const,
    },
  };
  const application = { ...applicationBody, applicationHash: stableHash(applicationBody) };
  return { application, submission, validation, calibration };
}

export function generateStage2PackageHeightConfirmation(
  input: Stage2PackageHeightConfirmationInput & { outputDirectory: string },
) {
  const decision = buildStage2PackageHeightConfirmationDecision(input);
  const applied = applyStage2PackageHeightConfirmation({ ...input, decision });
  const request = buildStage2RemainingEvidenceRequest({
    application: applied.application,
    validation: applied.validation,
    createdAt: input.confirmedAt,
  });
  const files = [
    "stage2-package-height-confirmation-decision.v1.json",
    "stage2-package-height-confirmation-application.v1.json",
    "stage2-evidence-submission.package-height-applied.v1.json",
    "stage2-evidence-validation.package-height-applied.v1.json",
    "stage2-calibration-run.package-height-applied.v1.json",
    "stage2-remaining-evidence-request.v1.json",
    "generation-summary.stage2-package-height-confirmation.v1.json",
    "README-3.5cm已作为人工工作值.md",
  ];
  const summaryBody = {
    schemaVersion: "stage2-package-height-confirmation-generation-summary.v1" as const,
    status: applied.application.status,
    decisionHash: decision.decisionHash,
    applicationHash: applied.application.applicationHash,
    outputSubmissionHash: applied.validation.submissionHash,
    outputValidationHash: applied.validation.evidenceHash,
    outputCalibrationHash: applied.calibration.inputHash,
    remainingEvidenceRequestHash: request.requestHash,
    missingFieldCount: request.missingFields.length,
    boundary: applied.application.boundary,
    files,
  };
  const summary = { ...summaryBody, evidenceHash: stableHash(summaryBody) };
  const readme = `# 包装高度人工确认应用结果

- 项目所有者明确确认：灰色六层当前工作包装高度为 **3.5 cm**。
- 原始页面的 3.5cm / 3.8cm 冲突证据继续保留；本次不是供应商确认，也不改写历史截图。
- 新 successor submission 只填入 packageHeightCm=3.5；其他未知成本继续为 null。
- 由 31 × 31 × 3.5 cm 得到的诊断体积为 3363.5 cm³；没有据此猜算 FBA 或利润。
- 剩余缺口 ${request.missingFields.length} 项；当前继续输出 profit_insufficient_evidence。
`;
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const artifactWrite = writeArtifactsIdempotently(resolve(input.outputDirectory), [
    { relativePath: files[0], content: json(decision) },
    { relativePath: files[1], content: json(applied.application) },
    { relativePath: files[2], content: json(applied.submission) },
    { relativePath: files[3], content: json(applied.validation) },
    { relativePath: files[4], content: json(applied.calibration) },
    { relativePath: files[5], content: json(request) },
    { relativePath: files[6], content: json(summary) },
    { relativePath: files[7], content: readme },
  ], "STAGE2_PACKAGE_HEIGHT_CONFIRMATION_OUTPUT_CONFLICT");
  return { decision, ...applied, request, summary, files, artifactWrite };
}
