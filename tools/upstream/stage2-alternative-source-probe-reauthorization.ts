import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2AlternativeSourceBrief,
  type Stage2AlternativeSourceBrief,
} from "./stage2-alternative-source-brief";

export const STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE =
  "我明确授权按 Capability-Probe-02 固定范围，使用独立临时 Chrome 对 Made-in-China.com 执行一次 unknown_page 重新验证；最多1次 robots 请求、1次搜索页导航、0次商品页、0次重试，不采集供应商字段。";

type Evidence = Record<string, unknown>;

export type Stage2AlternativeSourceProbeReauthorizationRequest = {
  schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v2";
  authorizationRequestId: string;
  status: "pending_user_authorization";
  createdAt: string;
  briefId: string;
  briefHash: string;
  baselineOfflineValidationEvidenceHash: string;
  priorAuthorizationEvidenceHash: string;
  priorRunEvidenceHash: string;
  priorRunId: string;
  unknownPageDiagnosticValidationEvidenceHash: string;
  supersedesAuthorizationRequestId: string;
  purpose: "public_source_unknown_page_revalidation_only";
  selectedOrigin: "https://www.made-in-china.com";
  policyRequest: { url: string; maximumRequests: 1 };
  browserScope: {
    startUrl: string;
    maximumSearchPageNavigations: 1;
    maximumProductPageNavigations: 0;
    maximumTotalNavigations: 1;
  };
  maximumTotalExternalRequests: 2;
  automaticRetryCount: 0;
  maximumDiscoveredProductUrls: 2;
  supplierFieldsCollected: 0;
  stopConditions: string[];
  authorizationPhrase: string;
  authorization: { status: "not_granted"; authorizedAt: null; authorizedBy: null };
  boundary: {
    thisRequestIsNotAuthorization: true;
    userMustAuthorizeInCurrentConversation: true;
    singleUseOnly: true;
    diagnosticCannotAuthorizeCollection: true;
    noProductPageNavigation: true;
    noSupplierFieldCollection: true;
    noLoginOrInquiry: true;
    noCaptchaHandling: true;
    noAutomaticRetry: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noExternalAiOrPaidApi: true;
  };
  requestHash: string;
};

export type Stage2AlternativeSourceProbeReauthorizationGrant = {
  schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2";
  authorizationRequestId: string;
  authorizationRequestHash: string;
  briefId: string;
  briefHash: string;
  baselineOfflineValidationEvidenceHash: string;
  priorAuthorizationEvidenceHash: string;
  priorRunEvidenceHash: string;
  unknownPageDiagnosticValidationEvidenceHash: string;
  status: "granted_single_use";
  authorizedAt: string;
  authorizedBy: "user_current_conversation";
  authorizationPhraseHash: string;
  scope: {
    policyRequests: 1;
    searchPageNavigations: 1;
    productPageNavigations: 0;
    automaticRetries: 0;
    supplierFieldsCollected: 0;
    maximumTotalExternalActions: 2;
  };
  consumption: {
    status: "not_consumed" | "consumed";
    consumedAt: string | null;
    runId: string | null;
  };
  evidenceHash: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function hashIsValid(value: Evidence): boolean {
  if (typeof value.evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(value.evidenceHash)) return false;
  const { evidenceHash, ...body } = value;
  return stableHash(body) === evidenceHash;
}

function baselineIsValid(value: Evidence, brief: Stage2AlternativeSourceBrief): boolean {
  return value.schemaVersion === "stage2-alternative-source-capability-probe-offline-validation.v1"
    && value.status === "offline_validation_passed"
    && value.proofLevel === "offline_fixture_only"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && value.realWebsiteAccessed === false
    && value.runtimeProbeExecuted === false
    && Array.isArray(value.failedScenarioIds)
    && value.failedScenarioIds.length === 0
    && hashIsValid(value);
}

function priorAuthorizationIsValid(value: Evidence, brief: Stage2AlternativeSourceBrief): boolean {
  const consumption = isRecord(value.consumption) ? value.consumption : {};
  return value.schemaVersion === "stage2-alternative-source-capability-probe-authorization.v1"
    && value.status === "granted_single_use"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && consumption.status === "consumed"
    && typeof consumption.runId === "string"
    && consumption.runId.length > 0
    && hashIsValid(value);
}

function priorRunIsValid(
  value: Evidence,
  priorAuthorization: Evidence,
  brief: Stage2AlternativeSourceBrief,
): boolean {
  const page = isRecord(value.page) ? value.page : {};
  const navigationBudget = isRecord(value.navigationBudget) ? value.navigationBudget : {};
  return value.schemaVersion === "stage2-alternative-source-capability-probe-run.v2"
    && value.status === "failed_closed"
    && value.errorCode === "unknown_page"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && value.authorizationEvidenceHash === priorAuthorization.evidenceHash
    && value.runId === (isRecord(priorAuthorization.consumption) ? priorAuthorization.consumption.runId : null)
    && page.classification === "unknown_page"
    && navigationBudget.productPageNavigations === 0
    && navigationBudget.automaticRetryCount === 0
    && value.supplierFieldsCollected === 0
    && value.stage2SubmissionGenerated === false
    && value.candidateGenerated === false
    && value.databaseWritten === false
    && hashIsValid(value);
}

function diagnosticIsValid(value: Evidence, brief: Stage2AlternativeSourceBrief): boolean {
  return value.schemaVersion === "stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1"
    && value.status === "offline_validation_passed"
    && value.proofLevel === "offline_fixture_only"
    && value.briefId === brief.briefId
    && value.briefHash === brief.briefHash
    && value.realWebsiteAccessed === false
    && value.failClosedPreserved === true
    && value.selectorOrThresholdChanged === false
    && Array.isArray(value.failedScenarioIds)
    && value.failedScenarioIds.length === 0
    && hashIsValid(value);
}

function evidenceHashes(input: {
  baselineOfflineValidation: Evidence;
  priorAuthorization: Evidence;
  priorRun: Evidence;
  unknownPageDiagnosticValidation: Evidence;
}) {
  return {
    baselineOfflineValidationEvidenceHash: typeof input.baselineOfflineValidation.evidenceHash === "string"
      ? input.baselineOfflineValidation.evidenceHash : "",
    priorAuthorizationEvidenceHash: typeof input.priorAuthorization.evidenceHash === "string"
      ? input.priorAuthorization.evidenceHash : "",
    priorRunEvidenceHash: typeof input.priorRun.evidenceHash === "string" ? input.priorRun.evidenceHash : "",
    priorRunId: typeof input.priorRun.runId === "string" ? input.priorRun.runId : "",
    unknownPageDiagnosticValidationEvidenceHash:
      typeof input.unknownPageDiagnosticValidation.evidenceHash === "string"
        ? input.unknownPageDiagnosticValidation.evidenceHash : "",
    supersedesAuthorizationRequestId: typeof input.priorAuthorization.authorizationRequestId === "string"
      ? input.priorAuthorization.authorizationRequestId : "",
  };
}

function expectedBody(input: {
  brief: Stage2AlternativeSourceBrief;
  hashes: ReturnType<typeof evidenceHashes>;
  createdAt: string;
}) {
  const authorizationRequestId = `stage2-alternative-probe-auth-02-${stableHash({
    briefHash: input.brief.briefHash,
    ...input.hashes,
    createdAt: input.createdAt,
  }).slice(0, 24)}`;
  return {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v2" as const,
    authorizationRequestId,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    ...input.hashes,
    purpose: "public_source_unknown_page_revalidation_only" as const,
    selectedOrigin: "https://www.made-in-china.com" as const,
    policyRequest: { url: input.brief.policyPreflight.robotsUrl, maximumRequests: 1 as const },
    browserScope: {
      startUrl: input.brief.search.startUrl,
      maximumSearchPageNavigations: 1 as const,
      maximumProductPageNavigations: 0 as const,
      maximumTotalNavigations: 1 as const,
    },
    maximumTotalExternalRequests: 2 as const,
    automaticRetryCount: 0 as const,
    maximumDiscoveredProductUrls: 2 as const,
    supplierFieldsCollected: 0 as const,
    stopConditions: [
      "robots_policy_unknown_or_disallows",
      "captcha_or_robot_check",
      "login_wall_or_inquiry_required",
      "access_denied_or_service_unavailable",
      "unexpected_final_origin",
      "unexpected_intermediate_redirect_origin",
      "browser_internal_error",
      "unknown_page_state_after_diagnostic",
      "request_budget_exhausted",
      "cleanup_incomplete",
    ],
    authorizationPhrase: STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE,
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisRequestIsNotAuthorization: true as const,
      userMustAuthorizeInCurrentConversation: true as const,
      singleUseOnly: true as const,
      diagnosticCannotAuthorizeCollection: true as const,
      noProductPageNavigation: true as const,
      noSupplierFieldCollection: true as const,
      noLoginOrInquiry: true as const,
      noCaptchaHandling: true as const,
      noAutomaticRetry: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noExternalAiOrPaidApi: true as const,
    },
  };
}

function validationResult(request: unknown, briefHash: string, hashes: ReturnType<typeof evidenceHashes>, reasons: string[]) {
  const record = isRecord(request) ? request : {};
  const body = {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v2" as const,
    status: reasons.length === 0 ? "valid_pending_user_authorization" as const : "invalid" as const,
    authorizationRequestId: typeof record.authorizationRequestId === "string" ? record.authorizationRequestId : null,
    requestHash: typeof record.requestHash === "string" ? record.requestHash : null,
    briefHash,
    ...hashes,
    reasonCodes: [...new Set(reasons)],
  };
  return { ...body, inputHash: stableHash(body) };
}

type ReauthorizationEvidenceInput = {
  brief: Stage2AlternativeSourceBrief;
  baselineOfflineValidation: Evidence;
  priorAuthorization: Evidence;
  priorRun: Evidence;
  unknownPageDiagnosticValidation: Evidence;
};

export function buildStage2AlternativeSourceProbeReauthorizationRequest(
  input: ReauthorizationEvidenceInput & { createdAt: string },
): Stage2AlternativeSourceProbeReauthorizationRequest {
  if (validateStage2AlternativeSourceBrief(input.brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_BRIEF_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_CREATED_AT_INVALID");
  }
  if (!baselineIsValid(input.baselineOfflineValidation, input.brief)
    || !priorAuthorizationIsValid(input.priorAuthorization, input.brief)
    || !priorRunIsValid(input.priorRun, input.priorAuthorization, input.brief)
    || !diagnosticIsValid(input.unknownPageDiagnosticValidation, input.brief)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_EVIDENCE_INVALID");
  }
  const body = expectedBody({ brief: input.brief, hashes: evidenceHashes(input), createdAt: input.createdAt });
  return { ...body, requestHash: stableHash(body) };
}

export function validateStage2AlternativeSourceProbeReauthorizationRequest(
  input: ReauthorizationEvidenceInput & { request: unknown },
) {
  const reasons: string[] = [];
  const hashes = evidenceHashes(input);
  if (!baselineIsValid(input.baselineOfflineValidation, input.brief)) {
    reasons.push("baseline_offline_validation_evidence_invalid");
  }
  if (!priorAuthorizationIsValid(input.priorAuthorization, input.brief)) {
    reasons.push("prior_probe_authorization_evidence_invalid");
  }
  if (!priorRunIsValid(input.priorRun, input.priorAuthorization, input.brief)) {
    reasons.push("prior_probe_failure_evidence_invalid");
  }
  if (!diagnosticIsValid(input.unknownPageDiagnosticValidation, input.brief)) {
    reasons.push("unknown_page_diagnostic_evidence_invalid");
  }
  if (!isRecord(input.request)) {
    return validationResult(input.request, input.brief.briefHash, hashes,
      [...reasons, "authorization_request_not_object"]);
  }
  const request = input.request;
  const createdAt = typeof request.createdAt === "string" ? request.createdAt : "";
  const expected = expectedBody({ brief: input.brief, hashes, createdAt });
  const { requestHash, ...body } = request;
  if (typeof requestHash !== "string" || stableHash(body) !== requestHash) {
    reasons.push("authorization_request_hash_mismatch");
  }
  if (request.schemaVersion !== expected.schemaVersion) reasons.push("authorization_request_schema_invalid");
  if (request.authorizationRequestId !== expected.authorizationRequestId) reasons.push("authorization_request_id_mismatch");
  if (request.status !== expected.status) reasons.push("authorization_request_status_invalid");
  if (!Number.isFinite(Date.parse(createdAt))) reasons.push("authorization_request_created_at_invalid");
  if (request.briefId !== expected.briefId || request.briefHash !== expected.briefHash) {
    reasons.push("authorization_request_brief_mismatch");
  }
  for (const [key, value] of Object.entries(hashes)) {
    if (request[key] !== value) reasons.push("authorization_request_evidence_hash_mismatch");
  }
  if (request.purpose !== expected.purpose || request.selectedOrigin !== expected.selectedOrigin) {
    reasons.push("authorization_request_purpose_or_origin_invalid");
  }
  if (stableHash(request.policyRequest) !== stableHash(expected.policyRequest)
    || stableHash(request.browserScope) !== stableHash(expected.browserScope)
    || request.maximumTotalExternalRequests !== 2
    || request.automaticRetryCount !== 0
    || request.maximumDiscoveredProductUrls !== 2
    || request.supplierFieldsCollected !== 0) reasons.push("authorization_request_scope_invalid");
  if (stableHash(request.stopConditions) !== stableHash(expected.stopConditions)) {
    reasons.push("stop_conditions_mismatch");
  }
  if (request.authorizationPhrase !== STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE) {
    reasons.push("authorization_phrase_mismatch");
  }
  const authorization = isRecord(request.authorization) ? request.authorization : {};
  if (authorization.status !== "not_granted" || authorization.authorizedAt !== null
    || authorization.authorizedBy !== null) reasons.push("authorization_request_must_remain_not_granted");
  if (stableHash(request.boundary) !== stableHash(expected.boundary)) {
    reasons.push("authorization_request_boundary_invalid");
  }
  return validationResult(request, input.brief.briefHash, hashes, reasons);
}

export function buildStage2AlternativeSourceProbeReauthorizationGrant(
  input: ReauthorizationEvidenceInput & {
    request: Stage2AlternativeSourceProbeReauthorizationRequest;
    authorizationPhrase: string;
    authorizedAt: string;
  },
): Stage2AlternativeSourceProbeReauthorizationGrant {
  const validation = validateStage2AlternativeSourceProbeReauthorizationRequest(input);
  if (validation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_REQUEST_INVALID");
  }
  if (input.authorizationPhrase !== STAGE2_ALTERNATIVE_SOURCE_PROBE_REAUTHORIZATION_PHRASE) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_PHRASE_MISMATCH");
  }
  if (!Number.isFinite(Date.parse(input.authorizedAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZED_AT_INVALID");
  }
  const body = {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2" as const,
    authorizationRequestId: input.request.authorizationRequestId,
    authorizationRequestHash: input.request.requestHash,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    baselineOfflineValidationEvidenceHash: input.request.baselineOfflineValidationEvidenceHash,
    priorAuthorizationEvidenceHash: input.request.priorAuthorizationEvidenceHash,
    priorRunEvidenceHash: input.request.priorRunEvidenceHash,
    unknownPageDiagnosticValidationEvidenceHash: input.request.unknownPageDiagnosticValidationEvidenceHash,
    status: "granted_single_use" as const,
    authorizedAt: input.authorizedAt,
    authorizedBy: "user_current_conversation" as const,
    authorizationPhraseHash: stableHash(input.authorizationPhrase),
    scope: {
      policyRequests: 1 as const,
      searchPageNavigations: 1 as const,
      productPageNavigations: 0 as const,
      automaticRetries: 0 as const,
      supplierFieldsCollected: 0 as const,
      maximumTotalExternalActions: 2 as const,
    },
    consumption: { status: "not_consumed" as const, consumedAt: null, runId: null },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function consumeStage2AlternativeSourceProbeReauthorization(input: {
  authorization: Stage2AlternativeSourceProbeReauthorizationGrant;
  consumedAt: string;
  runId: string;
}): Stage2AlternativeSourceProbeReauthorizationGrant {
  const { evidenceHash, ...body } = input.authorization;
  if (stableHash(body) !== evidenceHash
    || input.authorization.status !== "granted_single_use"
    || input.authorization.consumption.status !== "not_consumed"
    || input.authorization.consumption.consumedAt !== null
    || input.authorization.consumption.runId !== null) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_NOT_CONSUMABLE");
  }
  if (!Number.isFinite(Date.parse(input.consumedAt)) || !input.runId) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_CONSUMPTION_INVALID");
  }
  const consumedBody = {
    ...body,
    consumption: { status: "consumed" as const, consumedAt: input.consumedAt, runId: input.runId },
  };
  return { ...consumedBody, evidenceHash: stableHash(consumedBody) };
}
