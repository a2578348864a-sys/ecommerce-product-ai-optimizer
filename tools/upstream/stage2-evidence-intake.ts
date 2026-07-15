import { stableHash } from "../../lib/upstream/pipeline";
import { calibrateStage2 } from "../../lib/upstream/ranking";

export const STAGE2_OBJECTIVE_EVIDENCE_FIELDS = [
  "supplierUrl",
  "supplierCapturedAt",
  "moq",
  "bom",
  "packageLengthCm",
  "packageWidthCm",
  "packageHeightCm",
  "packageWeightKg",
  "firstMile",
  "logisticsEvidenceUrl",
  "platformCommission",
  "fba",
  "packaging",
  "storage",
  "returnReserve",
  "complianceEvidenceUrl",
  "executionRiskNotes",
] as const;

export type Stage2EvidenceFieldName = typeof STAGE2_OBJECTIVE_EVIDENCE_FIELDS[number];
export type Stage2EvidenceMode = "real_evidence" | "synthetic_fixture";
export type Stage2EvidenceSourceType = "direct_observation" | "provider_metric" | "derived" | "manual";

export type Stage2EvidenceReference = {
  sourceType: Stage2EvidenceSourceType;
  sourceUrl: string | null;
  capturedAt: string;
  note: string;
  inputHash: string | null;
};

export type Stage2EvidenceValue = {
  value: string | number | null;
  missingReason: string | null;
  evidence: Stage2EvidenceReference | null;
};

export type Stage2VariantIdentity = {
  status: "unknown" | "confirmed" | "mismatch";
  amazonVariant: string | null;
  supplierVariant: string | null;
  confirmedAt: string | null;
  evidence: Stage2EvidenceReference | null;
};

export type Stage2EvidenceSubmissionSample = {
  sampleId: string;
  productKey: string;
  variantIdentity: Stage2VariantIdentity;
  fields: Record<Stage2EvidenceFieldName, Stage2EvidenceValue>;
};

export type Stage2EvidenceSubmission = {
  schemaVersion: "stage2-evidence-submission.v1";
  submissionId: string;
  sourceGapInventoryHash: string;
  createdAt: string;
  submittedBy: string;
  evidenceMode: Stage2EvidenceMode;
  boundary: {
    objectiveEvidenceOnly: true;
    humanDecisionExcluded: true;
    stage1RankingMayNotBeRewritten: true;
    missingValuesMayNotBeEstimated: true;
  };
  samples: Stage2EvidenceSubmissionSample[];
};

export type Stage2EvidenceGapInventory = {
  schemaVersion: "solo-stage2-evidence-gap-inventory.v1";
  packetHash: string;
  samples: Array<{
    sampleId: string;
    productKey: string;
    sourceEvidence: {
      salePrice: number | null;
      currency: "USD";
    };
    evidenceGaps: Array<{ field: string }>;
  }>;
  [key: string]: unknown;
};

const SAMPLE_KEYS = new Set(["sampleId", "productKey", "variantIdentity", "fields"]);
const SUBMISSION_KEYS = new Set([
  "schemaVersion", "submissionId", "sourceGapInventoryHash", "createdAt", "submittedBy", "evidenceMode", "boundary", "samples",
]);
const SUBMISSION_BOUNDARY_KEYS = new Set([
  "objectiveEvidenceOnly", "humanDecisionExcluded", "stage1RankingMayNotBeRewritten", "missingValuesMayNotBeEstimated",
]);
const VARIANT_KEYS = new Set(["status", "amazonVariant", "supplierVariant", "confirmedAt", "evidence"]);
const FIELD_ENTRY_KEYS = new Set(["value", "missingReason", "evidence"]);
const REFERENCE_KEYS = new Set(["sourceType", "sourceUrl", "capturedAt", "note", "inputHash"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const URL_FIELDS = new Set<Stage2EvidenceFieldName>([
  "supplierUrl", "logisticsEvidenceUrl", "complianceEvidenceUrl",
]);
const POSITIVE_NUMBER_FIELDS = new Set<Stage2EvidenceFieldName>([
  "moq", "packageLengthCm", "packageWidthCm", "packageHeightCm", "packageWeightKg",
]);
const COST_FIELDS = [
  "bom", "firstMile", "platformCommission", "fba", "packaging", "storage", "returnReserve",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isSafePublicHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if (hostname === "localhost" || hostname === "::1" || hostname.endsWith(".localhost")) return false;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(hostname)) return false;
    const private172 = hostname.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(hostname)) return false;
    return hostname.includes(".");
  } catch {
    return false;
  }
}

function assertInventory(inventory: Stage2EvidenceGapInventory) {
  const { packetHash, ...body } = inventory;
  if (inventory.schemaVersion !== "solo-stage2-evidence-gap-inventory.v1"
    || !SHA256_PATTERN.test(packetHash)
    || stableHash(body) !== packetHash
    || !Array.isArray(inventory.samples)
    || inventory.samples.length === 0) {
    throw new Error("STAGE2_GAP_INVENTORY_INVALID");
  }
  const ids = inventory.samples.map((sample) => sample.sampleId);
  const productKeys = inventory.samples.map((sample) => sample.productKey);
  if (new Set(ids).size !== ids.length || new Set(productKeys).size !== productKeys.length) {
    throw new Error("STAGE2_GAP_INVENTORY_SAMPLE_MISMATCH");
  }
  for (const sample of inventory.samples) {
    if (sample.sourceEvidence?.currency !== "USD") {
      throw new Error("STAGE2_GAP_INVENTORY_CURRENCY_INVALID");
    }
    const salePrice = sample.sourceEvidence?.salePrice;
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0)) {
      throw new Error("STAGE2_GAP_INVENTORY_SALE_PRICE_INVALID");
    }
    const gapFields = sample.evidenceGaps.map((gap) => gap.field).sort();
    const expected = [...STAGE2_OBJECTIVE_EVIDENCE_FIELDS].sort();
    if (gapFields.length !== expected.length || gapFields.some((field, index) => field !== expected[index])) {
      throw new Error("STAGE2_GAP_INVENTORY_FIELDS_MISMATCH");
    }
  }
}

function emptyFields(): Record<Stage2EvidenceFieldName, Stage2EvidenceValue> {
  return Object.fromEntries(STAGE2_OBJECTIVE_EVIDENCE_FIELDS.map((field) => [field, {
    value: null,
    missingReason: "not_collected",
    evidence: null,
  }])) as Record<Stage2EvidenceFieldName, Stage2EvidenceValue>;
}

export function buildStage2EvidenceSubmissionTemplate(
  inventory: Stage2EvidenceGapInventory,
  options: {
    submissionId: string;
    createdAt: string;
    submittedBy: string;
    evidenceMode: Stage2EvidenceMode;
  },
): Stage2EvidenceSubmission {
  assertInventory(inventory);
  if (!options.submissionId.trim() || !options.submittedBy.trim() || !isIsoTime(options.createdAt)) {
    throw new Error("STAGE2_SUBMISSION_TEMPLATE_OPTIONS_INVALID");
  }
  return {
    schemaVersion: "stage2-evidence-submission.v1",
    submissionId: options.submissionId.trim(),
    sourceGapInventoryHash: inventory.packetHash,
    createdAt: options.createdAt,
    submittedBy: options.submittedBy.trim(),
    evidenceMode: options.evidenceMode,
    boundary: {
      objectiveEvidenceOnly: true,
      humanDecisionExcluded: true,
      stage1RankingMayNotBeRewritten: true,
      missingValuesMayNotBeEstimated: true,
    },
    samples: inventory.samples.map((sample) => ({
      sampleId: sample.sampleId,
      productKey: sample.productKey,
      variantIdentity: {
        status: "unknown",
        amazonVariant: null,
        supplierVariant: null,
        confirmedAt: null,
        evidence: null,
      },
      fields: emptyFields(),
    })),
  };
}

function validateReference(reference: unknown, prefix: string): string[] {
  if (!isRecord(reference)) return [`${prefix}_evidence_invalid`];
  const reasons: string[] = [];
  if (Object.keys(reference).some((key) => !REFERENCE_KEYS.has(key))) reasons.push(`${prefix}_evidence_unexpected_field`);
  if (!["direct_observation", "provider_metric", "derived", "manual"].includes(String(reference.sourceType))) {
    reasons.push(`${prefix}_source_type_invalid`);
  }
  if (!isIsoTime(reference.capturedAt)) reasons.push(`${prefix}_captured_at_invalid`);
  if (typeof reference.note !== "string" || reference.note.trim().length < 3 || reference.note.length > 500) {
    reasons.push(`${prefix}_note_invalid`);
  }
  if (reference.sourceUrl !== null && !isSafePublicHttpsUrl(reference.sourceUrl)) {
    reasons.push(`${prefix}_source_url_invalid`);
  }
  if (reference.sourceType !== "manual" && reference.sourceType !== "derived" && reference.sourceUrl === null) {
    reasons.push(`${prefix}_source_url_missing`);
  }
  if (reference.sourceType === "derived" && (typeof reference.inputHash !== "string" || !SHA256_PATTERN.test(reference.inputHash))) {
    reasons.push(`${prefix}_input_hash_invalid`);
  }
  if (reference.sourceType !== "derived" && reference.inputHash !== null) {
    reasons.push(`${prefix}_input_hash_unexpected`);
  }
  return reasons;
}

function validateField(field: Stage2EvidenceFieldName, entry: unknown): {
  missing: boolean;
  reasons: string[];
  value: string | number | null;
} {
  if (!isRecord(entry)) return { missing: false, reasons: [`${field}_entry_invalid`], value: null };
  const unexpectedEntryField = Object.keys(entry).some((key) => !FIELD_ENTRY_KEYS.has(key));
  const value = entry.value;
  if (value === null) {
    const reasons: string[] = unexpectedEntryField ? [`${field}_entry_unexpected_field`] : [];
    if (typeof entry.missingReason !== "string" || !entry.missingReason.trim()) reasons.push(`${field}_missing_reason_required`);
    if (entry.evidence !== null) reasons.push(`${field}_evidence_unexpected_for_missing_value`);
    return { missing: true, reasons, value: null };
  }

  const reasons: string[] = unexpectedEntryField ? [`${field}_entry_unexpected_field`] : [];
  if (entry.missingReason !== null) reasons.push(`${field}_missing_reason_unexpected`);
  if (entry.evidence === null) reasons.push(`${field}_evidence_missing`);
  else reasons.push(...validateReference(entry.evidence, field));

  if (URL_FIELDS.has(field) && !isSafePublicHttpsUrl(value)) reasons.push(`${field}_value_url_invalid`);
  else if (field === "supplierCapturedAt" && !isIsoTime(value)) reasons.push(`${field}_value_time_invalid`);
  else if (field === "executionRiskNotes"
    && (typeof value !== "string" || value.trim().length < 3 || value.length > 1000)) reasons.push(`${field}_value_text_invalid`);
  else if (POSITIVE_NUMBER_FIELDS.has(field)
    && (typeof value !== "number" || !Number.isFinite(value) || value <= 0
      || (field === "moq" && !Number.isInteger(value)))) reasons.push(`${field}_value_number_invalid`);
  else if (COST_FIELDS.includes(field as typeof COST_FIELDS[number])
    && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) reasons.push(`${field}_value_number_invalid`);
  return { missing: false, reasons, value: value as string | number };
}

function assertSubmissionSampleSet(inventory: Stage2EvidenceGapInventory, submission: Stage2EvidenceSubmission) {
  if (submission.sourceGapInventoryHash !== inventory.packetHash
    || submission.samples.length !== inventory.samples.length) {
    throw new Error("STAGE2_SUBMISSION_SAMPLE_MISMATCH");
  }
  const expected = new Map(inventory.samples.map((sample) => [sample.sampleId, sample.productKey]));
  const seen = new Set<string>();
  for (const sample of submission.samples) {
    if (seen.has(sample.sampleId) || expected.get(sample.sampleId) !== sample.productKey) {
      throw new Error("STAGE2_SUBMISSION_SAMPLE_MISMATCH");
    }
    seen.add(sample.sampleId);
  }
}

export function validateStage2EvidenceSubmission(
  inventory: Stage2EvidenceGapInventory,
  submission: Stage2EvidenceSubmission,
) {
  assertInventory(inventory);
  if (!isRecord(submission)
    || submission.schemaVersion !== "stage2-evidence-submission.v1"
    || !Array.isArray(submission.samples)) {
    throw new Error("STAGE2_SUBMISSION_INVALID");
  }
  assertSubmissionSampleSet(inventory, submission);

  const packageReasons: string[] = [];
  if (Object.keys(submission).some((key) => !SUBMISSION_KEYS.has(key))) packageReasons.push("unexpected_submission_field");
  if (!submission.submissionId.trim()) packageReasons.push("submission_id_invalid");
  if (!submission.submittedBy.trim()) packageReasons.push("submitted_by_invalid");
  if (!isIsoTime(submission.createdAt)) packageReasons.push("created_at_invalid");
  if (!["real_evidence", "synthetic_fixture"].includes(submission.evidenceMode)) packageReasons.push("evidence_mode_invalid");
  if (submission.boundary?.objectiveEvidenceOnly !== true
    || submission.boundary?.humanDecisionExcluded !== true
    || submission.boundary?.stage1RankingMayNotBeRewritten !== true
    || submission.boundary?.missingValuesMayNotBeEstimated !== true) {
    packageReasons.push("submission_boundary_invalid");
  }
  if (isRecord(submission.boundary)
    && Object.keys(submission.boundary).some((key) => !SUBMISSION_BOUNDARY_KEYS.has(key))) {
    packageReasons.push("unexpected_submission_boundary_field");
  }

  const sourceById = new Map(inventory.samples.map((sample) => [sample.sampleId, sample]));
  const samples = submission.samples.map((sample) => {
    const source = sourceById.get(sample.sampleId)!;
    const reasonCodes: string[] = [];
    const unexpectedKeys = Object.keys(sample).filter((key) => !SAMPLE_KEYS.has(key));
    if (unexpectedKeys.length > 0) reasonCodes.push("unexpected_sample_field");

    if (!isRecord(sample.variantIdentity)) {
      reasonCodes.push("variant_identity_invalid");
    } else if (sample.variantIdentity.status === "mismatch") {
      reasonCodes.push("variant_identity_mismatch");
    } else if (sample.variantIdentity.status !== "confirmed" && sample.variantIdentity.status !== "unknown") {
      reasonCodes.push("variant_identity_invalid");
    }
    if (isRecord(sample.variantIdentity)
      && Object.keys(sample.variantIdentity).some((key) => !VARIANT_KEYS.has(key))) {
      reasonCodes.push("variant_identity_unexpected_field");
    }
    let variantMissing = sample.variantIdentity?.status === "unknown";
    if (sample.variantIdentity?.status === "confirmed") {
      if (!sample.variantIdentity.amazonVariant?.trim() || !sample.variantIdentity.supplierVariant?.trim()
        || !isIsoTime(sample.variantIdentity.confirmedAt)) reasonCodes.push("variant_identity_confirmation_invalid");
      if (sample.variantIdentity.evidence === null) reasonCodes.push("variant_identity_evidence_missing");
      else reasonCodes.push(...validateReference(sample.variantIdentity.evidence, "variant_identity"));
      variantMissing = false;
    }

    const missingFields: Stage2EvidenceFieldName[] = [];
    const values = {} as Record<Stage2EvidenceFieldName, string | number | null>;
    if (!isRecord(sample.fields)
      || Object.keys(sample.fields).some((key) => !STAGE2_OBJECTIVE_EVIDENCE_FIELDS.includes(key as Stage2EvidenceFieldName))) {
      reasonCodes.push("unexpected_objective_field");
    }
    for (const field of STAGE2_OBJECTIVE_EVIDENCE_FIELDS) {
      const result = validateField(field, sample.fields?.[field]);
      if (result.missing) missingFields.push(field);
      reasonCodes.push(...result.reasons);
      values[field] = result.value;
    }
    const calibration = calibrateStage2({
      candidateId: sample.sampleId,
      currency: "USD",
      salePrice: source.sourceEvidence.salePrice,
      bom: typeof values.bom === "number" ? values.bom : null,
      firstMile: typeof values.firstMile === "number" ? values.firstMile : null,
      platformCommission: typeof values.platformCommission === "number" ? values.platformCommission : null,
      fba: typeof values.fba === "number" ? values.fba : null,
      packaging: typeof values.packaging === "number" ? values.packaging : null,
      storage: typeof values.storage === "number" ? values.storage : null,
      returnReserve: typeof values.returnReserve === "number" ? values.returnReserve : null,
    });
    const invalid = reasonCodes.length > 0;
    return {
      sampleId: sample.sampleId,
      productKey: sample.productKey,
      status: invalid ? "rejected" as const
        : missingFields.length > 0 || variantMissing || calibration.status !== "calculated" ? "incomplete" as const
          : "ready_for_calibration" as const,
      missingFields: [...new Set(missingFields)],
      reasonCodes: [...new Set(reasonCodes)],
      calibration,
    };
  });

  const rejectedCount = samples.filter((sample) => sample.status === "rejected").length;
  const readyForCalibrationCount = samples.filter((sample) => sample.status === "ready_for_calibration").length;
  const profitInsufficientEvidenceCount = samples.filter((sample) => sample.calibration.status === "profit_insufficient_evidence").length;
  const submissionHash = stableHash(submission);
  const body = {
    schemaVersion: "stage2-evidence-validation-result.v1" as const,
    status: packageReasons.length > 0 || rejectedCount > 0 ? "rejected" as const
      : readyForCalibrationCount === samples.length ? "ready_for_calibration" as const
        : "incomplete" as const,
    sourceGapInventoryHash: inventory.packetHash,
    submissionHash,
    inputHash: stableHash({ sourceGapInventoryHash: inventory.packetHash, submissionHash }),
    evidenceMode: submission.evidenceMode,
    packageReasonCodes: packageReasons,
    boundary: {
      businessValidationProven: false,
      databaseTransactionProven: false,
      apiAuthorizationProven: false,
      stage1RankingModified: false,
    },
    summary: {
      sampleCount: samples.length,
      readyForCalibrationCount,
      incompleteCount: samples.filter((sample) => sample.status === "incomplete").length,
      rejectedCount,
      profitInsufficientEvidenceCount,
    },
    samples,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function buildStage2CalibrationFromSubmission(
  inventory: Stage2EvidenceGapInventory,
  submission: Stage2EvidenceSubmission,
) {
  const validation = validateStage2EvidenceSubmission(inventory, submission);
  const body = {
    schemaVersion: "stage2-evidence-calibration-run.v1" as const,
    status: validation.status === "rejected" ? "rejected" as const
      : validation.status === "incomplete" ? "profit_insufficient_evidence" as const
        : submission.evidenceMode === "synthetic_fixture" ? "synthetic_fixture_calculated" as const
          : "real_evidence_ready_for_human_decision" as const,
    sourceGapInventoryHash: inventory.packetHash,
    sourceSubmissionHash: validation.submissionHash,
    sourceValidationHash: validation.evidenceHash,
    boundary: {
      businessValidationProven: false,
      humanDecisionRecorded: false,
      candidateCreated: false,
      databaseWritten: false,
      stage1RankingModified: false,
    },
    samples: validation.samples.map((sample) => ({
      sampleId: sample.sampleId,
      productKey: sample.productKey,
      evidenceStatus: sample.status,
      calibration: sample.calibration,
    })),
  };
  return { ...body, inputHash: stableHash(body) };
}
