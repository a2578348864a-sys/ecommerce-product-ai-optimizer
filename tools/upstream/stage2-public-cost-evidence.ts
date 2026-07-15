import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2PublicCostResearchBrief,
  type Stage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";

type EvidenceReference = {
  sourceType: "direct_observation" | "manual";
  sourceUrl: string;
  capturedAt: string;
  note: string;
  contentHash: string;
};

type EvidenceValue<T> = {
  value: T | null;
  missingReason: string | null;
  evidence: EvidenceReference | null;
};

type ExchangeRateObservation = {
  quoteDirection: "CNY_PER_USD";
  rate: number;
  effectiveDate: string;
};

type ReferralFeeObservation = {
  matchedCategory: string;
  rate: number;
  minimumFeeUsd: number;
  effectiveDate: string;
};

type FbaFeeObservation = {
  feeUsd: number;
  sizeTier: string;
  shippingWeightBasis: string;
  effectiveDate: string;
  applicability: "exact_package_match" | "blocked_package_dimension_conflict";
};

export type Stage2PublicCostEvidence = {
  schemaVersion: "stage2-public-cost-evidence.v1";
  evidenceId: string;
  briefId: string;
  briefHash: string;
  sampleId: string;
  productKey: string;
  status: "not_collected" | "partial" | "complete" | "blocked";
  capturedAt: string | null;
  boundary: {
    officialPublicEvidenceOnly: true;
    rawAndDerivedValuesSeparated: true;
    stage2SubmissionMutated: false;
    profitCalculated: false;
    candidateCreated: false;
    databaseWritten: false;
  };
  observations: {
    supplierUnitPriceCny: EvidenceValue<number>;
    exchangeRate: EvidenceValue<ExchangeRateObservation>;
    referralFee: EvidenceValue<ReferralFeeObservation>;
    fbaFulfillmentFee: EvidenceValue<FbaFeeObservation>;
  };
};

const OBSERVATION_KEYS = [
  "supplierUnitPriceCny",
  "exchangeRate",
  "referralFee",
  "fbaFulfillmentFee",
] as const;

function missingEntry<T>(): EvidenceValue<T> {
  return { value: null, missingReason: "pending_authorized_research", evidence: null };
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function sourceOrigin(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function validateReference(
  field: keyof Stage2PublicCostEvidence["observations"],
  reference: EvidenceReference | null,
  brief: Stage2PublicCostResearchBrief,
) {
  if (reference === null) return [`${field}_evidence_missing`];
  const reasons: string[] = [];
  if (!validIso(reference.capturedAt)) reasons.push(`${field}_captured_at_invalid`);
  if (typeof reference.note !== "string" || reference.note.trim().length < 3 || reference.note.length > 500) {
    reasons.push(`${field}_note_invalid`);
  }
  if (!/^[a-f0-9]{64}$/i.test(reference.contentHash)) reasons.push(`${field}_content_hash_invalid`);
  const origin = sourceOrigin(reference.sourceUrl);
  if (field === "supplierUnitPriceCny") {
    if (origin !== "https://detail.1688.com") reasons.push(`${field}_source_origin_invalid`);
    if (origin === "https://detail.1688.com"
      && !/[\/]offer[\/]\d+\.html$/.test(new URL(reference.sourceUrl).pathname)) {
      reasons.push(`${field}_source_path_invalid`);
    }
    if (!['manual', 'direct_observation'].includes(reference.sourceType)) reasons.push(`${field}_source_type_invalid`);
  } else {
    if (!origin || !brief.requestedScope.allowedOrigins.includes(origin as never)) {
      reasons.push(`${field}_source_origin_invalid`);
    }
    if (reference.sourceType !== "direct_observation") reasons.push(`${field}_source_type_invalid`);
  }
  return reasons;
}

function validateEntry<T>(
  field: keyof Stage2PublicCostEvidence["observations"],
  entry: EvidenceValue<T>,
  brief: Stage2PublicCostResearchBrief,
) {
  const reasons: string[] = [];
  if (entry.value === null) {
    if (typeof entry.missingReason !== "string" || !entry.missingReason.trim()) reasons.push(`${field}_missing_reason_required`);
    if (entry.evidence !== null) reasons.push(`${field}_evidence_unexpected_for_missing_value`);
    return reasons;
  }
  if (entry.missingReason !== null) reasons.push(`${field}_missing_reason_unexpected`);
  reasons.push(...validateReference(field, entry.evidence, brief));
  return reasons;
}

export function buildStage2PublicCostEvidenceTemplate(
  brief: Stage2PublicCostResearchBrief,
): Stage2PublicCostEvidence {
  if (validateStage2PublicCostResearchBrief(brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_PUBLIC_COST_BRIEF_INVALID");
  }
  return {
    schemaVersion: "stage2-public-cost-evidence.v1",
    evidenceId: `stage2-public-cost-evidence-${brief.briefHash.slice(0, 24)}`,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    sampleId: brief.sample.sampleId,
    productKey: brief.sample.productKey,
    status: "not_collected",
    capturedAt: null,
    boundary: {
      officialPublicEvidenceOnly: true,
      rawAndDerivedValuesSeparated: true,
      stage2SubmissionMutated: false,
      profitCalculated: false,
      candidateCreated: false,
      databaseWritten: false,
    },
    observations: {
      supplierUnitPriceCny: missingEntry<number>(),
      exchangeRate: missingEntry<ExchangeRateObservation>(),
      referralFee: missingEntry<ReferralFeeObservation>(),
      fbaFulfillmentFee: missingEntry<FbaFeeObservation>(),
    },
  };
}

export function validateStage2PublicCostEvidence(
  brief: Stage2PublicCostResearchBrief,
  evidence: Stage2PublicCostEvidence,
) {
  const reasonCodes: string[] = [];
  if (validateStage2PublicCostResearchBrief(brief).status !== "valid_pending_authorization") {
    reasonCodes.push("source_brief_invalid");
  }
  if (evidence.schemaVersion !== "stage2-public-cost-evidence.v1") reasonCodes.push("schema_version_invalid");
  if (evidence.briefId !== brief.briefId || evidence.briefHash !== brief.briefHash
    || evidence.sampleId !== brief.sample.sampleId || evidence.productKey !== brief.sample.productKey) {
    reasonCodes.push("source_binding_invalid");
  }
  if (evidence.boundary?.officialPublicEvidenceOnly !== true
    || evidence.boundary?.rawAndDerivedValuesSeparated !== true
    || evidence.boundary?.stage2SubmissionMutated !== false
    || evidence.boundary?.profitCalculated !== false
    || evidence.boundary?.candidateCreated !== false
    || evidence.boundary?.databaseWritten !== false) reasonCodes.push("boundary_invalid");
  const keys = Object.keys(evidence.observations ?? {});
  if (keys.length !== OBSERVATION_KEYS.length || OBSERVATION_KEYS.some((key) => !keys.includes(key))) {
    reasonCodes.push("observation_fields_invalid");
  }
  for (const field of OBSERVATION_KEYS) {
    const entry = evidence.observations?.[field];
    if (!entry || typeof entry !== "object") reasonCodes.push(`${field}_entry_invalid`);
    else reasonCodes.push(...validateEntry(field, entry as never, brief));
  }

  const supplierPrice = evidence.observations?.supplierUnitPriceCny.value;
  if (supplierPrice !== null && (typeof supplierPrice !== "number" || !Number.isFinite(supplierPrice) || supplierPrice <= 0)) {
    reasonCodes.push("supplierUnitPriceCny_value_invalid");
  }
  const exchangeRate = evidence.observations?.exchangeRate.value;
  if (exchangeRate !== null && (exchangeRate.quoteDirection !== "CNY_PER_USD"
    || !Number.isFinite(exchangeRate.rate) || exchangeRate.rate <= 0
    || !validDate(exchangeRate.effectiveDate))) reasonCodes.push("exchangeRate_value_invalid");
  const referralFee = evidence.observations?.referralFee.value;
  if (referralFee !== null && (!referralFee.matchedCategory.trim()
    || !Number.isFinite(referralFee.rate) || referralFee.rate < 0 || referralFee.rate > 1
    || !Number.isFinite(referralFee.minimumFeeUsd) || referralFee.minimumFeeUsd < 0
    || !validDate(referralFee.effectiveDate))) reasonCodes.push("referralFee_value_invalid");
  const fbaFee = evidence.observations?.fbaFulfillmentFee.value;
  if (fbaFee !== null && (!Number.isFinite(fbaFee.feeUsd) || fbaFee.feeUsd < 0
    || !fbaFee.sizeTier.trim() || !fbaFee.shippingWeightBasis.trim()
    || !validDate(fbaFee.effectiveDate)
    || !["exact_package_match", "blocked_package_dimension_conflict"].includes(fbaFee.applicability))) {
    reasonCodes.push("fbaFulfillmentFee_value_invalid");
  }

  const presentCount = OBSERVATION_KEYS.filter((key) => evidence.observations?.[key].value !== null).length;
  const complete = presentCount === OBSERVATION_KEYS.length && fbaFee?.applicability === "exact_package_match";
  if (evidence.status === "not_collected") {
    if (presentCount !== 0 || evidence.capturedAt !== null) reasonCodes.push("evidence_status_invalid");
  } else {
    if (!validIso(evidence.capturedAt) || presentCount === 0) reasonCodes.push("evidence_status_invalid");
    if (evidence.status === "complete" && !complete) reasonCodes.push("evidence_status_invalid");
    if (evidence.status === "partial" && complete) reasonCodes.push("evidence_status_invalid");
  }
  if (!['not_collected', 'partial', 'complete', 'blocked'].includes(evidence.status)) {
    reasonCodes.push("evidence_status_invalid");
  }

  const uniqueReasons = [...new Set(reasonCodes)];
  const evidenceHash = stableHash(evidence);
  return {
    schemaVersion: "stage2-public-cost-evidence-validation.v1" as const,
    status: uniqueReasons.length > 0 ? "rejected" as const
      : evidence.status === "not_collected" ? "valid_pending_research" as const
        : complete ? "valid_complete" as const
          : "valid_partial" as const,
    reasonCodes: uniqueReasons,
    evidenceHash,
    inputHash: stableHash({ briefHash: brief.briefHash, evidenceHash, reasonCodes: uniqueReasons }),
  };
}

function roundUsd(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function buildStage2PublicCostDerivationPreview(
  brief: Stage2PublicCostResearchBrief,
  evidence: Stage2PublicCostEvidence,
) {
  const validation = validateStage2PublicCostEvidence(brief, evidence);
  const inputHash = stableHash({ briefHash: brief.briefHash, evidence: validation.evidenceHash });
  if (validation.status === "rejected") {
    return {
      schemaVersion: "stage2-public-cost-derivation-preview.v1" as const,
      status: "rejected" as const,
      inputHash,
      reasonCodes: validation.reasonCodes,
      derivedStage2Fields: {
        bom: { value: null, status: "source_evidence_rejected" as const, inputHash },
        platformCommission: { value: null, status: "source_evidence_rejected" as const, inputHash },
        fba: { value: null, status: "source_evidence_rejected" as const, inputHash },
      },
      boundary: {
        stage2SubmissionMutated: false as const,
        profitCalculated: false as const,
        humanDecisionRecorded: false as const,
        candidateCreated: false as const,
        databaseWritten: false as const,
      },
    };
  }

  const supplierPrice = evidence.observations.supplierUnitPriceCny.value;
  const rate = evidence.observations.exchangeRate.value;
  const referral = evidence.observations.referralFee.value;
  const fba = evidence.observations.fbaFulfillmentFee.value;
  const bom = supplierPrice !== null && rate !== null
    ? { value: roundUsd(supplierPrice / rate.rate), status: "derived" as const, inputHash }
    : { value: null, status: "missing_raw_inputs" as const, inputHash };
  const commission = referral !== null
    ? {
        value: roundUsd(Math.max(brief.sample.salePriceUsd * referral.rate, referral.minimumFeeUsd)),
        status: "derived" as const,
        inputHash,
      }
    : { value: null, status: "missing_official_fee" as const, inputHash };
  const fbaDerived = fba?.applicability === "exact_package_match"
    ? { value: roundUsd(fba.feeUsd), status: "direct_official_schedule_match" as const, inputHash }
    : fba?.applicability === "blocked_package_dimension_conflict"
      ? { value: null, status: "blocked_package_dimension_conflict" as const, inputHash }
      : { value: null, status: "missing_official_fee" as const, inputHash };
  const allReady = bom.value !== null && commission.value !== null && fbaDerived.value !== null;
  return {
    schemaVersion: "stage2-public-cost-derivation-preview.v1" as const,
    status: validation.status === "valid_pending_research"
      ? "pending_research" as const
      : allReady
      ? "public_cost_inputs_ready_for_stage2_submission_review" as const
      : "partial_cost_inputs" as const,
    inputHash,
    reasonCodes: [],
    derivedStage2Fields: { bom, platformCommission: commission, fba: fbaDerived },
    boundary: {
      stage2SubmissionMutated: false as const,
      profitCalculated: false as const,
      humanDecisionRecorded: false as const,
      candidateCreated: false as const,
      databaseWritten: false as const,
    },
  };
}
