import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2AlternativeSourceBrief,
  type Stage2AlternativeSourceBrief,
} from "./stage2-alternative-source-brief";

export const STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE =
  "我明确授权按 Capability-Probe-01 固定范围，使用独立临时 Chrome 对 Made-in-China.com 执行一次真实来源能力探针；最多1次 robots 请求、1次搜索页导航、0次商品页、0次重试，不采集供应商字段。";

export type Stage2AlternativeSourceProbeAuthorizationRequest = {
  schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v1";
  authorizationRequestId: string;
  status: "pending_user_authorization";
  createdAt: string;
  briefId: string;
  briefHash: string;
  offlineValidationEvidenceHash: string;
  purpose: "public_source_capability_probe_only";
  selectedOrigin: "https://www.made-in-china.com";
  policyRequest: {
    url: string;
    maximumRequests: 1;
  };
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
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  boundary: {
    thisRequestIsNotAuthorization: true;
    userMustAuthorizeInCurrentConversation: true;
    singleUseOnly: true;
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

export type Stage2AlternativeSourceProbeAuthorizationGrant = {
  schemaVersion: "stage2-alternative-source-capability-probe-authorization.v1";
  authorizationRequestId: string;
  authorizationRequestHash: string;
  briefId: string;
  briefHash: string;
  offlineValidationEvidenceHash: string;
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

type OfflineValidation = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAuthorizationValidationResult(input: {
  request: unknown;
  briefHash: string;
  offlineValidationEvidenceHash: string | null;
  reasonCodes: string[];
}) {
  const request = isRecord(input.request) ? input.request : {};
  const body = {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization-validation.v1" as const,
    status: input.reasonCodes.length === 0
      ? "valid_pending_user_authorization" as const
      : "invalid" as const,
    authorizationRequestId: typeof request.authorizationRequestId === "string"
      ? request.authorizationRequestId : null,
    requestHash: typeof request.requestHash === "string" ? request.requestHash : null,
    briefHash: input.briefHash,
    offlineValidationEvidenceHash: input.offlineValidationEvidenceHash,
    reasonCodes: [...new Set(input.reasonCodes)],
  };
  return { ...body, inputHash: stableHash(body) };
}

function hasValidOfflineEvidence(
  offlineValidation: OfflineValidation,
  brief: Stage2AlternativeSourceBrief,
): boolean {
  if (offlineValidation.schemaVersion
      !== "stage2-alternative-source-capability-probe-offline-validation.v1"
    || offlineValidation.status !== "offline_validation_passed"
    || offlineValidation.proofLevel !== "offline_fixture_only"
    || offlineValidation.briefId !== brief.briefId
    || offlineValidation.briefHash !== brief.briefHash
    || offlineValidation.realWebsiteAccessed !== false
    || offlineValidation.runtimeProbeExecuted !== false
    || !Array.isArray(offlineValidation.failedScenarioIds)
    || offlineValidation.failedScenarioIds.length !== 0
    || typeof offlineValidation.evidenceHash !== "string") return false;
  const { evidenceHash, ...body } = offlineValidation;
  return /^[a-f0-9]{64}$/.test(evidenceHash) && stableHash(body) === evidenceHash;
}

function expectedRequestBody(input: {
  brief: Stage2AlternativeSourceBrief;
  offlineValidationEvidenceHash: string;
  createdAt: string;
}) {
  const authorizationRequestId = `stage2-alternative-probe-auth-${stableHash({
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: input.offlineValidationEvidenceHash,
    createdAt: input.createdAt,
  }).slice(0, 24)}`;
  return {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization-request.v1" as const,
    authorizationRequestId,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: input.offlineValidationEvidenceHash,
    purpose: "public_source_capability_probe_only" as const,
    selectedOrigin: "https://www.made-in-china.com" as const,
    policyRequest: {
      url: input.brief.policyPreflight.robotsUrl,
      maximumRequests: 1 as const,
    },
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
      "unknown_page_state",
      "request_budget_exhausted",
      "cleanup_incomplete",
    ],
    authorizationPhrase: STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE,
    authorization: {
      status: "not_granted" as const,
      authorizedAt: null,
      authorizedBy: null,
    },
    boundary: {
      thisRequestIsNotAuthorization: true as const,
      userMustAuthorizeInCurrentConversation: true as const,
      singleUseOnly: true as const,
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

export function buildStage2AlternativeSourceProbeAuthorizationRequest(input: {
  brief: Stage2AlternativeSourceBrief;
  offlineValidation: OfflineValidation;
  createdAt: string;
}): Stage2AlternativeSourceProbeAuthorizationRequest {
  if (validateStage2AlternativeSourceBrief(input.brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_BRIEF_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_CREATED_AT_INVALID");
  }
  if (!hasValidOfflineEvidence(input.offlineValidation, input.brief)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_OFFLINE_EVIDENCE_INVALID");
  }
  const body = expectedRequestBody({
    brief: input.brief,
    offlineValidationEvidenceHash: input.offlineValidation.evidenceHash as string,
    createdAt: input.createdAt,
  });
  return { ...body, requestHash: stableHash(body) };
}

export function validateStage2AlternativeSourceProbeAuthorizationRequest(input: {
  request: unknown;
  brief: Stage2AlternativeSourceBrief;
  offlineValidation: OfflineValidation;
}) {
  const reasonCodes: string[] = [];
  const offlineEvidenceHash = typeof input.offlineValidation.evidenceHash === "string"
    ? input.offlineValidation.evidenceHash : null;
  if (!isRecord(input.request)) {
    return buildAuthorizationValidationResult({
      request: input.request,
      briefHash: input.brief.briefHash,
      offlineValidationEvidenceHash: offlineEvidenceHash,
      reasonCodes: ["authorization_request_not_object"],
    });
  }
  const request = input.request;
  const createdAt = typeof request.createdAt === "string" ? request.createdAt : "";
  if (!hasValidOfflineEvidence(input.offlineValidation, input.brief)
    || request.offlineValidationEvidenceHash !== offlineEvidenceHash) {
    reasonCodes.push("offline_validation_evidence_hash_mismatch");
  }
  const expected = expectedRequestBody({
    brief: input.brief,
    offlineValidationEvidenceHash: offlineEvidenceHash ?? "",
    createdAt,
  });
  const { requestHash, ...actualBody } = request;
  if (typeof requestHash !== "string" || stableHash(actualBody) !== requestHash) {
    reasonCodes.push("authorization_request_hash_mismatch");
  }
  if (request.schemaVersion !== expected.schemaVersion) reasonCodes.push("authorization_request_schema_invalid");
  if (request.authorizationRequestId !== expected.authorizationRequestId) {
    reasonCodes.push("authorization_request_id_mismatch");
  }
  if (request.status !== "pending_user_authorization") reasonCodes.push("authorization_request_status_invalid");
  if (!Number.isFinite(Date.parse(createdAt))) reasonCodes.push("authorization_request_created_at_invalid");
  if (request.briefId !== input.brief.briefId || request.briefHash !== input.brief.briefHash) {
    reasonCodes.push("authorization_request_brief_mismatch");
  }
  if (request.selectedOrigin !== expected.selectedOrigin) reasonCodes.push("authorization_request_origin_mismatch");
  if (request.purpose !== expected.purpose) reasonCodes.push("authorization_request_purpose_invalid");
  if (!isRecord(request.policyRequest)
    || request.policyRequest.url !== expected.policyRequest.url
    || request.policyRequest.maximumRequests !== 1) reasonCodes.push("policy_request_scope_invalid");
  if (!isRecord(request.browserScope)
    || request.browserScope.startUrl !== expected.browserScope.startUrl
    || request.browserScope.maximumSearchPageNavigations !== 1
    || request.browserScope.maximumTotalNavigations !== 1) reasonCodes.push("browser_scope_invalid");
  if (!isRecord(request.browserScope) || request.browserScope.maximumProductPageNavigations !== 0) {
    reasonCodes.push("product_page_navigation_not_allowed");
  }
  if (request.maximumTotalExternalRequests !== 2 || request.automaticRetryCount !== 0) {
    reasonCodes.push("external_request_budget_invalid");
  }
  if (request.maximumDiscoveredProductUrls !== expected.maximumDiscoveredProductUrls) {
    reasonCodes.push("discovered_product_url_limit_invalid");
  }
  if (request.supplierFieldsCollected !== 0) reasonCodes.push("supplier_field_collection_not_allowed");
  if (!Array.isArray(request.stopConditions)
    || stableHash(request.stopConditions) !== stableHash(expected.stopConditions)) {
    reasonCodes.push("stop_conditions_mismatch");
  }
  if (request.authorizationPhrase !== STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE) {
    reasonCodes.push("authorization_phrase_mismatch");
  }
  if (!isRecord(request.authorization)
    || request.authorization.status !== "not_granted"
    || request.authorization.authorizedAt !== null
    || request.authorization.authorizedBy !== null) {
    reasonCodes.push("authorization_request_must_remain_not_granted");
  }
  if (!isRecord(request.boundary)
    || request.boundary.thisRequestIsNotAuthorization !== true
    || request.boundary.userMustAuthorizeInCurrentConversation !== true
    || request.boundary.singleUseOnly !== true
    || request.boundary.noProductPageNavigation !== true
    || request.boundary.noSupplierFieldCollection !== true
    || request.boundary.noLoginOrInquiry !== true
    || request.boundary.noCaptchaHandling !== true
    || request.boundary.noAutomaticRetry !== true
    || request.boundary.noDatabaseWrite !== true
    || request.boundary.noCandidateCreation !== true
    || request.boundary.noExternalAiOrPaidApi !== true) reasonCodes.push("authorization_request_boundary_invalid");
  return buildAuthorizationValidationResult({
    request,
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: offlineEvidenceHash,
    reasonCodes,
  });
}

export function buildStage2AlternativeSourceProbeAuthorizationGrant(input: {
  request: Stage2AlternativeSourceProbeAuthorizationRequest;
  brief: Stage2AlternativeSourceBrief;
  offlineValidation: OfflineValidation;
  authorizationPhrase: string;
  authorizedAt: string;
}): Stage2AlternativeSourceProbeAuthorizationGrant {
  const requestValidation = validateStage2AlternativeSourceProbeAuthorizationRequest({
    request: input.request,
    brief: input.brief,
    offlineValidation: input.offlineValidation,
  });
  if (requestValidation.status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_REQUEST_INVALID");
  }
  if (input.authorizationPhrase !== STAGE2_ALTERNATIVE_SOURCE_PROBE_AUTHORIZATION_PHRASE) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_PHRASE_MISMATCH");
  }
  if (!Number.isFinite(Date.parse(input.authorizedAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZED_AT_INVALID");
  }
  const body = {
    schemaVersion: "stage2-alternative-source-capability-probe-authorization.v1" as const,
    authorizationRequestId: input.request.authorizationRequestId,
    authorizationRequestHash: input.request.requestHash,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: input.request.offlineValidationEvidenceHash,
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
    consumption: {
      status: "not_consumed" as const,
      consumedAt: null,
      runId: null,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function consumeStage2AlternativeSourceProbeAuthorization(input: {
  authorization: Stage2AlternativeSourceProbeAuthorizationGrant;
  consumedAt: string;
  runId: string;
}): Stage2AlternativeSourceProbeAuthorizationGrant {
  const { evidenceHash, ...body } = input.authorization;
  if (stableHash(body) !== evidenceHash
    || input.authorization.status !== "granted_single_use"
    || input.authorization.consumption.status !== "not_consumed"
    || input.authorization.consumption.consumedAt !== null
    || input.authorization.consumption.runId !== null) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_NOT_CONSUMABLE");
  }
  if (!Number.isFinite(Date.parse(input.consumedAt)) || !input.runId) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_AUTHORIZATION_CONSUMPTION_INVALID");
  }
  const consumedBody = {
    ...body,
    consumption: {
      status: "consumed" as const,
      consumedAt: input.consumedAt,
      runId: input.runId,
    },
  };
  return { ...consumedBody, evidenceHash: stableHash(consumedBody) };
}
