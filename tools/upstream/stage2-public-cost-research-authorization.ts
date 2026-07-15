import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage2PublicCostResearchBrief,
  type Stage2PublicCostResearchBrief,
} from "./stage2-public-cost-research-brief";

export const STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT =
  "我明确授权按 Stage2-Public-Cost-Research-01 固定范围执行一次只读公开研究；仅访问 Federal Reserve 与 Amazon 官方公开页面，最多6次导航、0次重试，不登录、不绕过阻断、不写数据库、不调用AI、不Commit、不Push、不部署。";

type FixedScope = Stage2PublicCostResearchBrief["requestedScope"];

export type Stage2PublicCostResearchAuthorizationRequest = {
  schemaVersion: "stage2-public-cost-research-authorization-request.v1";
  requestId: string;
  briefId: string;
  briefHash: string;
  status: "not_granted";
  createdAt: string;
  exactAuthorizationText: typeof STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT;
  requestedScope: FixedScope;
  authorizationGrantGenerated: false;
  requestHash: string;
};

export type Stage2PublicCostResearchAuthorizationGrant = {
  schemaVersion: "stage2-public-cost-research-authorization-grant.v1";
  grantId: string;
  requestId: string;
  requestHash: string;
  briefId: string;
  briefHash: string;
  status: "granted";
  authorizedAt: string;
  authorizedBy: "user";
  authorizationTextHash: string;
  requestedScope: FixedScope;
  singleUse: true;
  consumed: false;
  grantHash: string;
};

export type Stage2PublicCostResearchAuthorizationConsumption = {
  schemaVersion: "stage2-public-cost-research-authorization-consumption.v1";
  grantId: string;
  grantHash: string;
  requestId: string;
  requestHash: string;
  briefId: string;
  briefHash: string;
  runId: string;
  consumedAt: string;
  consumed: true;
  requestedScope: FixedScope;
  consumptionHash: string;
};

function validIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function sameScope(actual: FixedScope, expected: FixedScope) {
  return actual.maxTotalNavigations === expected.maxTotalNavigations
    && actual.automaticRetryCount === expected.automaticRetryCount
    && actual.maxSamples === expected.maxSamples
    && actual.allowedOrigins.length === expected.allowedOrigins.length
    && actual.allowedOrigins.every((origin, index) => origin === expected.allowedOrigins[index]);
}

export function buildStage2PublicCostResearchAuthorizationRequest(
  brief: Stage2PublicCostResearchBrief,
  createdAt: string,
): Stage2PublicCostResearchAuthorizationRequest {
  if (validateStage2PublicCostResearchBrief(brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_BRIEF_INVALID");
  }
  if (!validIso(createdAt)) throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_CREATED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-public-cost-research-authorization-request.v1" as const,
    requestId: `stage2-public-cost-auth-${stableHash({ briefHash: brief.briefHash, createdAt }).slice(0, 24)}`,
    briefId: brief.briefId,
    briefHash: brief.briefHash,
    status: "not_granted" as const,
    createdAt,
    exactAuthorizationText: STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT as typeof STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT,
    requestedScope: structuredClone(brief.requestedScope),
    authorizationGrantGenerated: false as const,
  };
  return { ...body, requestHash: stableHash(body) };
}

export function validateStage2PublicCostResearchAuthorizationRequest(
  brief: Stage2PublicCostResearchBrief,
  request: Stage2PublicCostResearchAuthorizationRequest,
) {
  const reasonCodes: string[] = [];
  if (validateStage2PublicCostResearchBrief(brief).status !== "valid_pending_authorization") {
    reasonCodes.push("brief_invalid");
  }
  const { requestHash, ...body } = request;
  if (stableHash(body) !== requestHash) reasonCodes.push("request_hash_mismatch");
  if (request.schemaVersion !== "stage2-public-cost-research-authorization-request.v1") reasonCodes.push("schema_version_invalid");
  if (request.briefId !== brief.briefId || request.briefHash !== brief.briefHash) reasonCodes.push("brief_binding_mismatch");
  if (!validIso(request.createdAt)) reasonCodes.push("created_at_invalid");
  if (request.status !== "not_granted" || request.authorizationGrantGenerated !== false) reasonCodes.push("authorization_state_invalid");
  if (request.exactAuthorizationText !== STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT) reasonCodes.push("authorization_text_mismatch");
  if (!sameScope(request.requestedScope, brief.requestedScope)) reasonCodes.push("requested_scope_mismatch");
  return {
    schemaVersion: "stage2-public-cost-research-authorization-request-validation.v1" as const,
    status: reasonCodes.includes("request_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_not_granted" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash: brief.briefHash, requestHash, reasonCodes }),
  };
}

export function buildStage2PublicCostResearchAuthorizationGrant(input: {
  brief: Stage2PublicCostResearchBrief;
  request: Stage2PublicCostResearchAuthorizationRequest;
  authorizationText: string;
  authorizedAt: string;
  authorizedBy: "user";
}): Stage2PublicCostResearchAuthorizationGrant {
  if (validateStage2PublicCostResearchAuthorizationRequest(input.brief, input.request).status !== "valid_not_granted") {
    throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_REQUEST_INVALID");
  }
  if (input.authorizationText !== STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT) {
    throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT_MISMATCH");
  }
  if (!validIso(input.authorizedAt)) throw new Error("STAGE2_PUBLIC_COST_AUTHORIZED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-public-cost-research-authorization-grant.v1" as const,
    grantId: `stage2-public-cost-grant-${stableHash({ requestHash: input.request.requestHash, authorizedAt: input.authorizedAt }).slice(0, 24)}`,
    requestId: input.request.requestId,
    requestHash: input.request.requestHash,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    status: "granted" as const,
    authorizedAt: input.authorizedAt,
    authorizedBy: input.authorizedBy,
    authorizationTextHash: stableHash(input.authorizationText),
    requestedScope: structuredClone(input.request.requestedScope),
    singleUse: true as const,
    consumed: false as const,
  };
  return { ...body, grantHash: stableHash(body) };
}

export function validateStage2PublicCostResearchAuthorizationGrant(
  brief: Stage2PublicCostResearchBrief,
  request: Stage2PublicCostResearchAuthorizationRequest,
  grant: Stage2PublicCostResearchAuthorizationGrant,
) {
  const reasonCodes: string[] = [];
  if (validateStage2PublicCostResearchAuthorizationRequest(brief, request).status !== "valid_not_granted") {
    reasonCodes.push("request_invalid");
  }
  const { grantHash, ...body } = grant;
  if (stableHash(body) !== grantHash) reasonCodes.push("grant_hash_mismatch");
  if (grant.requestId !== request.requestId || grant.requestHash !== request.requestHash
    || grant.briefId !== brief.briefId || grant.briefHash !== brief.briefHash) reasonCodes.push("binding_mismatch");
  if (grant.authorizationTextHash !== stableHash(STAGE2_PUBLIC_COST_AUTHORIZATION_TEXT)) reasonCodes.push("authorization_text_hash_mismatch");
  if (!validIso(grant.authorizedAt) || grant.authorizedBy !== "user") reasonCodes.push("authorization_identity_invalid");
  if (grant.status !== "granted" || grant.singleUse !== true || grant.consumed !== false) reasonCodes.push("grant_state_invalid");
  if (!sameScope(grant.requestedScope, request.requestedScope)) reasonCodes.push("requested_scope_mismatch");
  return {
    schemaVersion: "stage2-public-cost-research-authorization-grant-validation.v1" as const,
    status: reasonCodes.includes("grant_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_unconsumed_grant" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash: brief.briefHash, requestHash: request.requestHash, grantHash, reasonCodes }),
  };
}

export function consumeStage2PublicCostResearchAuthorizationGrant(input: {
  brief: Stage2PublicCostResearchBrief;
  request: Stage2PublicCostResearchAuthorizationRequest;
  grant: Stage2PublicCostResearchAuthorizationGrant;
  runId: string;
  consumedAt: string;
}): Stage2PublicCostResearchAuthorizationConsumption {
  if (validateStage2PublicCostResearchAuthorizationGrant(input.brief, input.request, input.grant).status
    !== "valid_unconsumed_grant") throw new Error("STAGE2_PUBLIC_COST_AUTHORIZATION_GRANT_INVALID");
  if (!/^stage2-public-cost-run-[a-f0-9]{24}$/.test(input.runId)) {
    throw new Error("STAGE2_PUBLIC_COST_RUN_ID_INVALID");
  }
  if (!validIso(input.consumedAt)) throw new Error("STAGE2_PUBLIC_COST_CONSUMED_AT_INVALID");
  const body = {
    schemaVersion: "stage2-public-cost-research-authorization-consumption.v1" as const,
    grantId: input.grant.grantId,
    grantHash: input.grant.grantHash,
    requestId: input.request.requestId,
    requestHash: input.request.requestHash,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    runId: input.runId,
    consumedAt: input.consumedAt,
    consumed: true as const,
    requestedScope: structuredClone(input.grant.requestedScope),
  };
  return { ...body, consumptionHash: stableHash(body) };
}

export function validateStage2PublicCostResearchAuthorizationConsumption(
  brief: Stage2PublicCostResearchBrief,
  request: Stage2PublicCostResearchAuthorizationRequest,
  grant: Stage2PublicCostResearchAuthorizationGrant,
  consumption: Stage2PublicCostResearchAuthorizationConsumption,
) {
  const reasonCodes: string[] = [];
  if (validateStage2PublicCostResearchAuthorizationGrant(brief, request, grant).status !== "valid_unconsumed_grant") {
    reasonCodes.push("grant_invalid");
  }
  const { consumptionHash, ...body } = consumption;
  if (stableHash(body) !== consumptionHash) reasonCodes.push("consumption_hash_mismatch");
  if (consumption.grantId !== grant.grantId || consumption.grantHash !== grant.grantHash
    || consumption.requestId !== request.requestId || consumption.requestHash !== request.requestHash
    || consumption.briefId !== brief.briefId || consumption.briefHash !== brief.briefHash) {
    reasonCodes.push("binding_mismatch");
  }
  if (!/^stage2-public-cost-run-[a-f0-9]{24}$/.test(consumption.runId)) reasonCodes.push("run_id_invalid");
  if (!validIso(consumption.consumedAt) || consumption.consumed !== true) reasonCodes.push("consumption_state_invalid");
  if (!sameScope(consumption.requestedScope, grant.requestedScope)) reasonCodes.push("requested_scope_mismatch");
  return {
    schemaVersion: "stage2-public-cost-research-authorization-consumption-validation.v1" as const,
    status: reasonCodes.includes("consumption_hash_mismatch") ? "invalid_hash" as const
      : reasonCodes.length > 0 ? "invalid_contract" as const
        : "valid_consumed" as const,
    reasonCodes,
    inputHash: stableHash({ briefHash: brief.briefHash, requestHash: request.requestHash, grantHash: grant.grantHash, consumptionHash, reasonCodes }),
  };
}
