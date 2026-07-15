import { stableHash } from "../../lib/upstream/pipeline";
import {
  GLOBAL_SOURCES_HOMEPAGE_URL,
  GLOBAL_SOURCES_ORIGIN,
  GLOBAL_SOURCES_ROBOTS_URL,
  hasCanonicalStage2GlobalSourcesDiscoveryBriefR1,
  type Stage2GlobalSourcesDiscoveryBriefR1,
} from "./stage2-global-sources-discovery-r1";

const SHA256 = /^[a-f0-9]{64}$/;

export const GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE =
  "我明确授权按 Global-Sources-Discovery-C1A-R1 固定范围，使用独立临时 Chrome 对 GlobalSources.com 执行一次真实来源发现；最多1次 robots 请求、1次首页导航、0次搜索页、0次商品页、0次重试，不采集供应商字段。";

export type Stage2GlobalSourcesDiscoveryAuthorizationRequest = {
  schemaVersion: "stage2-global-sources-discovery-authorization-request.v1";
  authorizationRequestId: string;
  status: "pending_user_authorization";
  createdAt: string;
  briefId: string;
  briefHash: string;
  offlineValidationEvidenceHash: string;
  purpose: "public_homepage_source_discovery_only";
  selectedOrigin: typeof GLOBAL_SOURCES_ORIGIN;
  policyRequest: { url: typeof GLOBAL_SOURCES_ROBOTS_URL; maximumRequests: 1 };
  browserScope: {
    startUrl: typeof GLOBAL_SOURCES_HOMEPAGE_URL;
    maximumHomepageNavigations: 1;
    maximumSearchPageNavigations: 0;
    maximumProductPageNavigations: 0;
    maximumTotalNavigations: 1;
  };
  maximumTotalExternalActions: 2;
  automaticRetryCount: 0;
  maximumCandidateSearchPaths: 5;
  supplierFieldsCollected: 0;
  stopConditions: string[];
  authorizationPhrase: string;
  authorization: { status: "not_granted"; authorizedAt: null; authorizedBy: null };
  boundary: {
    thisRequestIsNotAuthorization: true;
    userMustAuthorizeInCurrentConversation: true;
    singleUseOnly: true;
    noSearchPageNavigation: true;
    noProductPageNavigation: true;
    noSupplierFieldCollection: true;
    noLoginRegistrationOrInquiry: true;
    noCaptchaHandling: true;
    noAutomaticRetry: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noExternalAiOrPaidApi: true;
  };
  requestHash: string;
};

export type Stage2GlobalSourcesDiscoveryAuthorizationGrant = {
  schemaVersion: "stage2-global-sources-discovery-authorization.v1";
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
    homepageNavigations: 1;
    searchPageNavigations: 0;
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

function validOfflineValidation(
  value: OfflineValidation,
  brief: Stage2GlobalSourcesDiscoveryBriefR1,
): value is OfflineValidation & { evidenceHash: string } {
  if (value.schemaVersion !== "stage2-global-sources-discovery-offline-validation.v1"
    || value.status !== "offline_validation_passed"
    || value.proofLevel !== "offline_fixture_only"
    || value.briefId !== brief.briefId
    || value.briefHash !== brief.briefHash
    || value.fixtureSchemaVersion !== "stage2-global-sources-discovery-r1-fixture.v1"
    || value.scenarioCount !== 14
    || value.passedScenarioCount !== 14
    || value.realWebsiteAccessed !== false
    || value.runtimeDiscoveryExecuted !== false
    || !Array.isArray(value.failedScenarioIds)
    || value.failedScenarioIds.length !== 0
    || typeof value.evidenceHash !== "string"
    || !SHA256.test(value.evidenceHash)) return false;
  const { evidenceHash, ...body } = value;
  return stableHash(body) === evidenceHash;
}

function expectedRequestBody(input: {
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  offlineValidationEvidenceHash: string;
  createdAt: string;
}) {
  return {
    schemaVersion: "stage2-global-sources-discovery-authorization-request.v1" as const,
    authorizationRequestId: `stage2-global-sources-discovery-r1-auth-${stableHash({
      briefHash: input.brief.briefHash,
      offlineValidationEvidenceHash: input.offlineValidationEvidenceHash,
      createdAt: input.createdAt,
    }).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: input.offlineValidationEvidenceHash,
    purpose: "public_homepage_source_discovery_only" as const,
    selectedOrigin: GLOBAL_SOURCES_ORIGIN,
    policyRequest: { url: GLOBAL_SOURCES_ROBOTS_URL, maximumRequests: 1 as const },
    browserScope: {
      startUrl: GLOBAL_SOURCES_HOMEPAGE_URL,
      maximumHomepageNavigations: 1 as const,
      maximumSearchPageNavigations: 0 as const,
      maximumProductPageNavigations: 0 as const,
      maximumTotalNavigations: 1 as const,
    },
    maximumTotalExternalActions: 2 as const,
    automaticRetryCount: 0 as const,
    maximumCandidateSearchPaths: 5 as const,
    supplierFieldsCollected: 0 as const,
    stopConditions: [...input.brief.stopConditions],
    authorizationPhrase: GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisRequestIsNotAuthorization: true as const,
      userMustAuthorizeInCurrentConversation: true as const,
      singleUseOnly: true as const,
      noSearchPageNavigation: true as const,
      noProductPageNavigation: true as const,
      noSupplierFieldCollection: true as const,
      noLoginRegistrationOrInquiry: true as const,
      noCaptchaHandling: true as const,
      noAutomaticRetry: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noExternalAiOrPaidApi: true as const,
    },
  };
}

export function buildStage2GlobalSourcesDiscoveryAuthorizationRequest(input: {
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  offlineValidation: OfflineValidation;
  createdAt: string;
}): Stage2GlobalSourcesDiscoveryAuthorizationRequest {
  if (!hasCanonicalStage2GlobalSourcesDiscoveryBriefR1(input.brief)) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_BRIEF_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_CREATED_AT_INVALID");
  }
  if (!validOfflineValidation(input.offlineValidation, input.brief)) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_OFFLINE_VALIDATION_INVALID");
  }
  const body = expectedRequestBody({
    brief: input.brief,
    offlineValidationEvidenceHash: input.offlineValidation.evidenceHash,
    createdAt: input.createdAt,
  });
  return { ...body, requestHash: stableHash(body) };
}

export function validateStage2GlobalSourcesDiscoveryAuthorizationRequest(input: {
  request: unknown;
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  offlineValidation: OfflineValidation;
}) {
  const request = isRecord(input.request) ? input.request : {};
  const reasonCodes: string[] = [];
  if (!hasCanonicalStage2GlobalSourcesDiscoveryBriefR1(input.brief)) reasonCodes.push("brief_invalid");
  if (!validOfflineValidation(input.offlineValidation, input.brief)) reasonCodes.push("offline_validation_invalid");
  if (typeof request.requestHash !== "string" || !SHA256.test(request.requestHash)) {
    reasonCodes.push("authorization_request_hash_invalid");
  } else {
    const { requestHash, ...body } = request;
    if (stableHash(body) !== requestHash) reasonCodes.push("authorization_request_hash_invalid");
  }
  const expected = expectedRequestBody({
    brief: input.brief,
    offlineValidationEvidenceHash: typeof input.offlineValidation.evidenceHash === "string"
      ? input.offlineValidation.evidenceHash : "invalid",
    createdAt: typeof request.createdAt === "string" ? request.createdAt : "invalid",
  });
  if (request.schemaVersion !== expected.schemaVersion || request.status !== expected.status
    || request.authorizationRequestId !== expected.authorizationRequestId
    || !Number.isFinite(Date.parse(typeof request.createdAt === "string" ? request.createdAt : ""))
    || request.briefId !== expected.briefId || request.briefHash !== expected.briefHash
    || request.offlineValidationEvidenceHash !== expected.offlineValidationEvidenceHash
    || request.purpose !== expected.purpose || request.selectedOrigin !== expected.selectedOrigin) {
    reasonCodes.push("authorization_request_semantics_invalid");
  }
  if (stableHash(request.policyRequest) !== stableHash(expected.policyRequest)) reasonCodes.push("policy_request_scope_invalid");
  if (stableHash(request.browserScope) !== stableHash(expected.browserScope)) reasonCodes.push("browser_scope_invalid");
  if (request.maximumTotalExternalActions !== 2 || request.automaticRetryCount !== 0
    || request.maximumCandidateSearchPaths !== 5 || request.supplierFieldsCollected !== 0) {
    reasonCodes.push("external_action_scope_invalid");
  }
  if (stableHash(request.stopConditions) !== stableHash(expected.stopConditions)
    || request.authorizationPhrase !== GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE
    || stableHash(request.authorization) !== stableHash(expected.authorization)
    || stableHash(request.boundary) !== stableHash(expected.boundary)) {
    reasonCodes.push("authorization_request_boundary_invalid");
  }
  const body = {
    schemaVersion: "stage2-global-sources-discovery-authorization-validation.v1" as const,
    status: reasonCodes.length === 0 ? "valid_pending_user_authorization" as const : "invalid" as const,
    authorizationRequestId: typeof request.authorizationRequestId === "string" ? request.authorizationRequestId : null,
    requestHash: typeof request.requestHash === "string" ? request.requestHash : null,
    briefHash: input.brief.briefHash,
    offlineValidationEvidenceHash: typeof input.offlineValidation.evidenceHash === "string"
      ? input.offlineValidation.evidenceHash : null,
    reasonCodes: [...new Set(reasonCodes)],
  };
  return { ...body, inputHash: stableHash(body) };
}

export function buildStage2GlobalSourcesDiscoveryAuthorizationGrant(input: {
  request: Stage2GlobalSourcesDiscoveryAuthorizationRequest;
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  offlineValidation: OfflineValidation;
  authorizationPhrase: string;
  authorizedAt: string;
}): Stage2GlobalSourcesDiscoveryAuthorizationGrant {
  if (validateStage2GlobalSourcesDiscoveryAuthorizationRequest({
    request: input.request, brief: input.brief, offlineValidation: input.offlineValidation,
  }).status !== "valid_pending_user_authorization") {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_REQUEST_INVALID");
  }
  if (input.authorizationPhrase !== GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_PHRASE_MISMATCH");
  }
  if (!Number.isFinite(Date.parse(input.authorizedAt))) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZED_AT_INVALID");
  }
  const body = {
    schemaVersion: "stage2-global-sources-discovery-authorization.v1" as const,
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
      homepageNavigations: 1 as const,
      searchPageNavigations: 0 as const,
      productPageNavigations: 0 as const,
      automaticRetries: 0 as const,
      supplierFieldsCollected: 0 as const,
      maximumTotalExternalActions: 2 as const,
    },
    consumption: { status: "not_consumed" as const, consumedAt: null, runId: null },
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function consumeStage2GlobalSourcesDiscoveryAuthorization(input: {
  authorization: Stage2GlobalSourcesDiscoveryAuthorizationGrant;
  consumedAt: string;
  runId: string;
}): Stage2GlobalSourcesDiscoveryAuthorizationGrant {
  const { evidenceHash, ...body } = input.authorization;
  if (!SHA256.test(evidenceHash) || stableHash(body) !== evidenceHash
    || input.authorization.status !== "granted_single_use"
    || input.authorization.consumption.status !== "not_consumed"
    || input.authorization.consumption.consumedAt !== null
    || input.authorization.consumption.runId !== null) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_ALREADY_CONSUMED_OR_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.consumedAt)) || !input.runId) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_AUTHORIZATION_CONSUMPTION_INVALID");
  }
  const consumedBody = {
    ...body,
    consumption: { status: "consumed" as const, consumedAt: input.consumedAt, runId: input.runId },
  };
  return { ...consumedBody, evidenceHash: stableHash(consumedBody) };
}
