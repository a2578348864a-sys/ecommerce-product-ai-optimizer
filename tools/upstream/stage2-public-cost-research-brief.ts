import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2EvidenceSubmission,
  type Stage2EvidenceGapInventory,
  type Stage2EvidenceSubmission,
} from "./stage2-evidence-intake";

const ALLOWED_ORIGINS = [
  "https://www.federalreserve.gov",
  "https://sell.amazon.com",
] as const;

const RESEARCH_KEYS = [
  "cny_usd_exchange_rate",
  "amazon_us_referral_fee",
  "amazon_us_fba_fulfillment_fee",
] as const;

const STOP_CONDITIONS = [
  "login_required",
  "captcha_or_robot_check",
  "access_denied_or_service_unavailable",
  "unexpected_origin_redirect",
  "official_source_cannot_be_confirmed",
  "fee_category_or_effective_date_unknown",
  "navigation_budget_exhausted",
] as const;

type ResearchKey = typeof RESEARCH_KEYS[number];
export type Stage2EvidenceValidationResult = ReturnType<typeof validateStage2EvidenceSubmission>;

export type Stage2PublicCostResearchBrief = {
  schemaVersion: "stage2-public-cost-research-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  sourceGapInventoryHash: string;
  sourceSubmissionHash: string;
  sourceValidationHash: string;
  sample: {
    sampleId: string;
    productKey: string;
    salePriceUsd: number;
    currentEvidenceStatus: "incomplete";
    currentMissingFields: string[];
  };
  decisionPurpose: "obtain_official_exchange_rate_and_amazon_us_fee_evidence";
  requestedResearch: Array<{
    researchKey: ResearchKey;
    sourcePolicy: "official_primary_source_only";
    requiredObservations: string[];
    mayPopulateStage2Field: "bom" | "platformCommission" | "fba";
    directPopulationAllowed: false;
  }>;
  requestedScope: {
    allowedOrigins: [...typeof ALLOWED_ORIGINS];
    maxTotalNavigations: 6;
    automaticRetryCount: 0;
    maxSamples: 1;
  };
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  unresolvedOutsideThisResearch: string[];
  applicationRules: {
    preserveRawSupplierPriceCny: true;
    preserveRawExchangeRate: true;
    derivedBomRequiresBothInputs: true;
    referralFeeRequiresMatchingCategory: true;
    fbaFeeRequiresExactPackageDimensionsAndWeight: true;
    packageHeightConflictRemainsBlocking: true;
    noAutomaticStage2Decision: true;
    noCandidateCreation: true;
  };
  stopConditions: [...typeof STOP_CONDITIONS];
  boundary: {
    publicReadOnlySourcesOnly: true;
    noLogin: true;
    noCookieOrPrivateProfile: true;
    noCaptchaBypass: true;
    noProxyOrAntiDetection: true;
    noPaidApi: true;
    noExternalAi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage1Rewrite: true;
    thisBriefIsNotAuthorization: true;
  };
  expectedOutput: {
    schemaVersion: "stage2-public-cost-evidence.v1";
    missingValuesRemainNull: true;
    rawAndDerivedValuesSeparated: true;
    stage2SubmissionIsNotAutomaticallyMutated: true;
  };
  briefHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function exactArray(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

export function buildStage2PublicCostResearchBrief(input: {
  inventory: Stage2EvidenceGapInventory;
  submission: Stage2EvidenceSubmission;
  sourceValidation: Stage2EvidenceValidationResult;
  sampleId: string;
  createdAt: string;
}): Stage2PublicCostResearchBrief {
  if (!validIso(input.createdAt)) throw new Error("STAGE2_PUBLIC_COST_CREATED_AT_INVALID");
  let validation: ReturnType<typeof validateStage2EvidenceSubmission>;
  try {
    validation = validateStage2EvidenceSubmission(input.inventory, input.submission);
  } catch {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_INVALID");
  }
  if (validation.status === "rejected" || validation.evidenceMode !== "real_evidence") {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_INVALID");
  }
  if (stableHash(input.sourceValidation) !== stableHash(validation)) {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_INVALID");
  }
  const sourceSample = input.inventory.samples.find((sample) => sample.sampleId === input.sampleId);
  const validationSample = validation.samples.find((sample) => sample.sampleId === input.sampleId);
  if (!sourceSample || !validationSample) throw new Error("STAGE2_PUBLIC_COST_SAMPLE_NOT_FOUND");
  if (validationSample.productKey !== sourceSample.productKey
    || validationSample.status !== "incomplete"
    || sourceSample.sourceEvidence.salePrice === null
    || sourceSample.sourceEvidence.salePrice <= 0) {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_INVALID");
  }
  const researchTargetFields = ["bom", "platformCommission", "fba"];
  if (researchTargetFields.some((field) => !validationSample.missingFields.includes(field as never))) {
    throw new Error("STAGE2_PUBLIC_COST_SOURCE_INVALID");
  }

  const body = {
    schemaVersion: "stage2-public-cost-research-brief.v1" as const,
    briefId: `stage2-public-cost-${stableHash({
      sampleId: input.sampleId,
      sourceGapInventoryHash: input.inventory.packetHash,
      sourceSubmissionHash: validation.submissionHash,
    }).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    sourceGapInventoryHash: input.inventory.packetHash,
    sourceSubmissionHash: validation.submissionHash,
    sourceValidationHash: validation.evidenceHash,
    sample: {
      sampleId: input.sampleId,
      productKey: sourceSample.productKey,
      salePriceUsd: sourceSample.sourceEvidence.salePrice,
      currentEvidenceStatus: "incomplete" as const,
      currentMissingFields: [...validationSample.missingFields],
    },
    decisionPurpose: "obtain_official_exchange_rate_and_amazon_us_fee_evidence" as const,
    requestedResearch: [
      {
        researchKey: "cny_usd_exchange_rate" as const,
        sourcePolicy: "official_primary_source_only" as const,
        requiredObservations: ["rate_value", "quote_direction", "effective_date", "source_url", "captured_at", "content_hash"],
        mayPopulateStage2Field: "bom" as const,
        directPopulationAllowed: false as const,
      },
      {
        researchKey: "amazon_us_referral_fee" as const,
        sourcePolicy: "official_primary_source_only" as const,
        requiredObservations: ["matched_category", "fee_rate", "minimum_fee_usd", "effective_date", "source_url", "captured_at", "content_hash"],
        mayPopulateStage2Field: "platformCommission" as const,
        directPopulationAllowed: false as const,
      },
      {
        researchKey: "amazon_us_fba_fulfillment_fee" as const,
        sourcePolicy: "official_primary_source_only" as const,
        requiredObservations: ["fee_schedule_version", "size_tier", "shipping_weight_basis", "fee_usd", "effective_date", "source_url", "captured_at", "content_hash"],
        mayPopulateStage2Field: "fba" as const,
        directPopulationAllowed: false as const,
      },
    ],
    requestedScope: {
      allowedOrigins: [...ALLOWED_ORIGINS] as [...typeof ALLOWED_ORIGINS],
      maxTotalNavigations: 6 as const,
      automaticRetryCount: 0 as const,
      maxSamples: 1 as const,
    },
    authorization: {
      status: "not_granted" as const,
      authorizedAt: null,
      authorizedBy: null,
    },
    unresolvedOutsideThisResearch: validationSample.missingFields.filter(
      (field) => !researchTargetFields.includes(field),
    ),
    applicationRules: {
      preserveRawSupplierPriceCny: true as const,
      preserveRawExchangeRate: true as const,
      derivedBomRequiresBothInputs: true as const,
      referralFeeRequiresMatchingCategory: true as const,
      fbaFeeRequiresExactPackageDimensionsAndWeight: true as const,
      packageHeightConflictRemainsBlocking: true as const,
      noAutomaticStage2Decision: true as const,
      noCandidateCreation: true as const,
    },
    stopConditions: [...STOP_CONDITIONS] as [...typeof STOP_CONDITIONS],
    boundary: {
      publicReadOnlySourcesOnly: true as const,
      noLogin: true as const,
      noCookieOrPrivateProfile: true as const,
      noCaptchaBypass: true as const,
      noProxyOrAntiDetection: true as const,
      noPaidApi: true as const,
      noExternalAi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
      thisBriefIsNotAuthorization: true as const,
    },
    expectedOutput: {
      schemaVersion: "stage2-public-cost-evidence.v1" as const,
      missingValuesRemainNull: true as const,
      rawAndDerivedValuesSeparated: true as const,
      stage2SubmissionIsNotAutomaticallyMutated: true as const,
    },
  };
  return { ...body, briefHash: stableHash(body) };
}

export function validateStage2PublicCostResearchBrief(brief: Stage2PublicCostResearchBrief) {
  const reasonCodes: string[] = [];
  const { briefHash, ...body } = brief;
  if (stableHash(body) !== briefHash) reasonCodes.push("brief_hash_mismatch");
  if (brief.schemaVersion !== "stage2-public-cost-research-brief.v1") reasonCodes.push("schema_version_invalid");
  if (!validIso(brief.createdAt)) reasonCodes.push("created_at_invalid");
  if (brief.status !== "pending_user_authorization"
    || brief.authorization.status !== "not_granted"
    || brief.authorization.authorizedAt !== null
    || brief.authorization.authorizedBy !== null) reasonCodes.push("authorization_state_invalid");
  if (!exactArray(brief.requestedScope.allowedOrigins, ALLOWED_ORIGINS)) reasonCodes.push("allowed_origins_invalid");
  if (brief.requestedScope.maxTotalNavigations !== 6
    || brief.requestedScope.automaticRetryCount !== 0
    || brief.requestedScope.maxSamples !== 1) reasonCodes.push("research_scope_invalid");
  if (!exactArray(brief.requestedResearch.map((item) => item.researchKey), RESEARCH_KEYS)
    || brief.requestedResearch.some((item) => item.sourcePolicy !== "official_primary_source_only"
      || item.directPopulationAllowed !== false)) reasonCodes.push("requested_research_invalid");
  if (!exactArray(brief.stopConditions, STOP_CONDITIONS)) reasonCodes.push("stop_conditions_invalid");
  if (brief.boundary.publicReadOnlySourcesOnly !== true
    || brief.boundary.noLogin !== true
    || brief.boundary.noCookieOrPrivateProfile !== true
    || brief.boundary.noCaptchaBypass !== true
    || brief.boundary.noProxyOrAntiDetection !== true
    || brief.boundary.noPaidApi !== true
    || brief.boundary.noExternalAi !== true
    || brief.boundary.noDatabaseWrite !== true
    || brief.boundary.noCandidateCreation !== true
    || brief.boundary.noStage1Rewrite !== true
    || brief.boundary.thisBriefIsNotAuthorization !== true) reasonCodes.push("boundary_invalid");
  return {
    schemaVersion: "stage2-public-cost-research-brief-validation.v1" as const,
    status: reasonCodes.includes("brief_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_pending_authorization" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash, reasonCodes }),
  };
}
