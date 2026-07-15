import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import { validateStage2EvidenceCollectionBrief } from "./stage2-evidence-collection-brief";
import type { buildStage2PublicRunEvidence } from "./stage2-public-evidence-collector";
import type { reviewStage2PublicRunEvidence } from "./run-stage2-public-evidence-collection";

type FailedRun = ReturnType<typeof buildStage2PublicRunEvidence>;
type FailedReview = ReturnType<typeof reviewStage2PublicRunEvidence>;

const SHA256 = /^[a-f0-9]{64}$/;

export type Stage2PublicRevalidationBrief = {
  schemaVersion: "stage2-public-revalidation-brief.v1";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  sampleId: "stage2-high-01";
  productKey: string;
  query: "hanging closet organizer 6 shelf grey";
  sourceEvidence: {
    originalBriefId: string;
    originalBriefHash: string;
    failedRunId: string;
    failedRunEvidenceHash: string;
    failedReviewEvidenceHash: string;
    failedReviewReasonCodes: string[];
  };
  requestedEvidenceFields: Stage2EvidenceCollectionBrief["requestedEvidenceFields"];
  requestedScope: {
    allowedOrigin: "https://www.alibaba.com";
    maxTotalNavigations: 4;
    maxSearchResultPages: 1;
    maxSupplierProductPages: 3;
    maxSamples: 1;
    automaticRetryCount: 0;
  };
  fixProof: {
    everyRedirectOriginFailClosed: true;
    chromeInternalErrorClassified: true;
    diagnosticFinalUrlUsesDomLocation: true;
    privateBrowserStateProbeRejected: true;
    browserCleanupVerified: true;
    proofLevel: "offline_unit_and_full_regression_only";
  };
  stopConditions: Array<
    | "captcha_or_robot_check"
    | "login_wall"
    | "access_denied_or_service_unavailable"
    | "unexpected_final_origin"
    | "unexpected_intermediate_redirect_origin"
    | "browser_internal_error"
    | "unknown_page_state"
    | "variant_identity_cannot_be_confirmed"
    | "requested_navigation_budget_exhausted"
  >;
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  boundary: {
    thisBriefIsNotAuthorization: true;
    priorRunRemainsNonAuthoritative: true;
    noAutomaticWebsiteAccess: true;
    noLoginOrPrivateProfile: true;
    noCookieOrStorageRead: true;
    noCaptchaBypass: true;
    noProxyOrAntiDetection: true;
    noPaidApiOrExternalAi: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage1Rewrite: true;
    stage2SubmissionRequiresConfirmedVariant: true;
  };
  expectedResult: {
    successRequiresConfirmedSameVariant: true;
    failureStillWritesSanitizedRunEvidence: true;
    stage2SubmissionGeneratedAutomatically: false;
    candidateGenerated: false;
    databaseWritten: false;
  };
  briefHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertHash(value: { evidenceHash: string }, code: string): void {
  const { evidenceHash, ...body } = value;
  if (!SHA256.test(evidenceHash) || stableHash(body) !== evidenceHash) throw new Error(code);
}

export function buildStage2PublicRevalidationBrief(input: {
  originalBrief: Stage2EvidenceCollectionBrief;
  failedRun: FailedRun;
  failedReview: FailedReview;
  createdAt: string;
}): Stage2PublicRevalidationBrief {
  if (validateStage2EvidenceCollectionBrief(input.originalBrief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_REVALIDATION_ORIGINAL_BRIEF_INVALID");
  }
  assertHash(input.failedRun, "STAGE2_REVALIDATION_FAILED_RUN_INVALID");
  assertHash(input.failedReview, "STAGE2_REVALIDATION_FAILED_REVIEW_INVALID");
  if (!validIso(input.createdAt)) throw new Error("STAGE2_REVALIDATION_CREATED_AT_INVALID");
  if (input.failedRun.status !== "failed"
    || input.failedRun.briefId !== input.originalBrief.briefId
    || input.failedRun.briefHash !== input.originalBrief.briefHash
    || input.failedReview.sourceRunId !== input.failedRun.runId
    || input.failedReview.sourceRunEvidenceHash !== input.failedRun.evidenceHash
    || input.failedReview.status !== "non_authoritative_failed_evidence"
    || input.failedReview.stage2SubmissionEligible !== false) {
    throw new Error("STAGE2_REVALIDATION_SOURCE_LINKAGE_INVALID");
  }

  const sourceEvidence = {
    originalBriefId: input.originalBrief.briefId,
    originalBriefHash: input.originalBrief.briefHash,
    failedRunId: input.failedRun.runId,
    failedRunEvidenceHash: input.failedRun.evidenceHash,
    failedReviewEvidenceHash: input.failedReview.evidenceHash,
    failedReviewReasonCodes: [...input.failedReview.reasonCodes],
  };
  const body = {
    schemaVersion: "stage2-public-revalidation-brief.v1" as const,
    briefId: `stage2-revalidation-${stableHash(sourceEvidence).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    sampleId: "stage2-high-01" as const,
    productKey: input.originalBrief.sample.productKey,
    query: "hanging closet organizer 6 shelf grey" as const,
    sourceEvidence,
    requestedEvidenceFields: [...input.originalBrief.requestedEvidenceFields],
    requestedScope: {
      allowedOrigin: "https://www.alibaba.com" as const,
      maxTotalNavigations: 4 as const,
      maxSearchResultPages: 1 as const,
      maxSupplierProductPages: 3 as const,
      maxSamples: 1 as const,
      automaticRetryCount: 0 as const,
    },
    fixProof: {
      everyRedirectOriginFailClosed: true as const,
      chromeInternalErrorClassified: true as const,
      diagnosticFinalUrlUsesDomLocation: true as const,
      privateBrowserStateProbeRejected: true as const,
      browserCleanupVerified: true as const,
      proofLevel: "offline_unit_and_full_regression_only" as const,
    },
    stopConditions: [
      "captcha_or_robot_check",
      "login_wall",
      "access_denied_or_service_unavailable",
      "unexpected_final_origin",
      "unexpected_intermediate_redirect_origin",
      "browser_internal_error",
      "unknown_page_state",
      "variant_identity_cannot_be_confirmed",
      "requested_navigation_budget_exhausted",
    ] as Stage2PublicRevalidationBrief["stopConditions"],
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisBriefIsNotAuthorization: true as const,
      priorRunRemainsNonAuthoritative: true as const,
      noAutomaticWebsiteAccess: true as const,
      noLoginOrPrivateProfile: true as const,
      noCookieOrStorageRead: true as const,
      noCaptchaBypass: true as const,
      noProxyOrAntiDetection: true as const,
      noPaidApiOrExternalAi: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage1Rewrite: true as const,
      stage2SubmissionRequiresConfirmedVariant: true as const,
    },
    expectedResult: {
      successRequiresConfirmedSameVariant: true as const,
      failureStillWritesSanitizedRunEvidence: true as const,
      stage2SubmissionGeneratedAutomatically: false as const,
      candidateGenerated: false as const,
      databaseWritten: false as const,
    },
  };
  return { ...body, briefHash: stableHash(body) };
}

export function validateStage2PublicRevalidationBrief(brief: Stage2PublicRevalidationBrief) {
  const reasonCodes: string[] = [];
  const { briefHash, ...body } = brief;
  if (!SHA256.test(briefHash) || stableHash(body) !== briefHash) reasonCodes.push("brief_hash_mismatch");
  if (brief.schemaVersion !== "stage2-public-revalidation-brief.v1") reasonCodes.push("schema_version_invalid");
  if (brief.status !== "pending_user_authorization"
    || brief.authorization.status !== "not_granted"
    || brief.authorization.authorizedAt !== null
    || brief.authorization.authorizedBy !== null) reasonCodes.push("authorization_state_invalid");
  if (!validIso(brief.createdAt)) reasonCodes.push("created_at_invalid");
  if (brief.sampleId !== "stage2-high-01" || !brief.productKey) reasonCodes.push("sample_invalid");
  if (brief.requestedScope.allowedOrigin !== "https://www.alibaba.com"
    || brief.requestedScope.maxTotalNavigations !== 4
    || brief.requestedScope.maxSearchResultPages !== 1
    || brief.requestedScope.maxSupplierProductPages !== 3
    || brief.requestedScope.maxSamples !== 1
    || brief.requestedScope.automaticRetryCount !== 0) reasonCodes.push("navigation_scope_invalid");
  if (!Object.entries(brief.fixProof).every(([key, value]) =>
    key === "proofLevel" ? value === "offline_unit_and_full_regression_only" : value === true)) {
    reasonCodes.push("fix_proof_invalid");
  }
  if (!brief.boundary.thisBriefIsNotAuthorization
    || !brief.boundary.priorRunRemainsNonAuthoritative
    || !brief.boundary.noAutomaticWebsiteAccess
    || !brief.boundary.stage2SubmissionRequiresConfirmedVariant) reasonCodes.push("boundary_invalid");
  if (![brief.sourceEvidence.originalBriefHash, brief.sourceEvidence.failedRunEvidenceHash,
    brief.sourceEvidence.failedReviewEvidenceHash].every((hash) => SHA256.test(hash))) {
    reasonCodes.push("source_hash_invalid");
  }
  return {
    schemaVersion: "stage2-public-revalidation-brief-validation.v1" as const,
    status: reasonCodes.includes("brief_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_pending_authorization" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash, reasonCodes }),
  };
}
