import { stableHash } from "../../lib/upstream/pipeline";
import {
  assertSourceNativeAccessLogEntryIntegrity,
  assertSourceNativeAccessRequestIntegrity,
  assertSourceNativeAuthorizationIntegrity,
  assertSourceNativeQualificationIntegrity,
  type SourceNativeAccessLogEntry,
  type SourceNativeAccessRequest,
  type SourceNativeAuthorization,
  type SourceNativeSourceQualification,
} from "./stage15-source-native-contract";

type SourceNativeSourceQualificationInput = Omit<SourceNativeSourceQualification, "qualificationHash">;
type SourceNativeAccessRequestInput = Omit<SourceNativeAccessRequest, "requestHash">;

// This pure function verifies only supplied approval text; human origin is guaranteed by upstream authentication.
export type SourceNativeAuthorizationInput = {
  request: SourceNativeAccessRequest;
  qualification: SourceNativeSourceQualification;
  approvedText: string;
  approvedLedgerHeadHash: string | null;
};

export type SourceNativeProposedAction = {
  kind: "api_request" | "page_open";
  target: string;
  estimatedPaidAmountUsd: number;
  attempt: number;
};

// The supplied ledger must be authoritative, complete, and ordered; omitted history and tamper resistance are guaranteed by upstream storage.
export type SourceNativeAccessPreflightInput = {
  qualification: SourceNativeSourceQualification;
  request: SourceNativeAccessRequest;
  authorization: SourceNativeAuthorization | null;
  accessLog: ReadonlyArray<SourceNativeAccessLogEntry>;
  proposedAction: SourceNativeProposedAction;
};

export type SourceNativeAccessPreflightResult = {
  executionAllowed: boolean;
  remainingApiRequests: number;
  remainingReviewPages: number;
  remainingPaidAmountUsd: number;
};

const STOP_OUTCOMES = new Set([
  "login_wall",
  "captcha",
  "access_denied",
  "robots_unknown",
  "license_unknown",
]);

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

export function buildSourceNativeApprovalText(request: SourceNativeAccessRequest): string {
  return `Approve source-native request ${request.requestHash} with actions ${stableHash(request.requestedActions)}, policy ${stableHash(request.policy)} and budget ${stableHash(request.budget)}; retries=0.`;
}

export function hashSourceNativeApprovalText(request: SourceNativeAccessRequest): string {
  return stableHash(buildSourceNativeApprovalText(request));
}

function fail(code: string): never {
  throw new Error(code);
}

function validPageTarget(target: string, qualification: SourceNativeSourceQualification, request: SourceNativeAccessRequest): boolean {
  try {
    const url = new URL(target);
    return url.protocol === "https:" && !url.username && !url.password
      && url.origin === qualification.sourceOrigin
      && request.policy.allowedPagePathPrefixes.some((prefix) => url.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

export function buildSourceNativeSourceQualification(
  input: SourceNativeSourceQualificationInput,
): SourceNativeSourceQualification {
  const qualification = selfHash(input, "qualificationHash");
  assertSourceNativeQualificationIntegrity(qualification);
  return qualification;
}

export function buildSourceNativeAccessRequest(
  input: SourceNativeAccessRequestInput,
): SourceNativeAccessRequest {
  const request = selfHash(input, "requestHash");
  assertSourceNativeAccessRequestIntegrity(request);
  return request;
}

export function buildSourceNativeAuthorization(
  input: SourceNativeAuthorizationInput,
): SourceNativeAuthorization {
  assertSourceNativeQualificationIntegrity(input.qualification);
  assertSourceNativeAccessRequestIntegrity(input.request);
  if (input.request.qualificationHash !== input.qualification.qualificationHash) {
    fail("SOURCE_NATIVE_QUALIFICATION_HASH_MISMATCH");
  }
  if (input.approvedText !== buildSourceNativeApprovalText(input.request)
    || (input.approvedLedgerHeadHash !== null && !/^[a-f0-9]{64}$/u.test(input.approvedLedgerHeadHash))) {
    fail("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
  }

  const authorization = selfHash({
    schemaVersion: "stage15-source-native-authorization.v1" as const,
    requestHash: input.request.requestHash,
    qualificationHash: input.qualification.qualificationHash,
    approvedTextSha256: hashSourceNativeApprovalText(input.request),
    approvedActions: input.request.requestedActions,
    approvedPolicy: input.request.policy,
    approvedBudget: input.request.budget,
    maxAutomaticRetries: 0 as const,
    approvedLedgerHeadHash: input.approvedLedgerHeadHash,
  }, "authorizationHash");
  assertSourceNativeAuthorizationIntegrity(authorization);
  return authorization;
}

export function evaluateSourceNativeAccessPreflight(
  input: SourceNativeAccessPreflightInput,
): SourceNativeAccessPreflightResult {
  if (!input || typeof input !== "object") fail("SOURCE_NATIVE_REQUEST_HASH_MISMATCH");
  const candidate = input as SourceNativeAccessPreflightInput;
  try {
    assertSourceNativeQualificationIntegrity(candidate.qualification);
  } catch {
    fail("SOURCE_NATIVE_QUALIFICATION_HASH_MISMATCH");
  }
  if (!candidate.request || typeof candidate.request !== "object") fail("SOURCE_NATIVE_REQUEST_HASH_MISMATCH");
  if (candidate.request.qualificationHash !== candidate.qualification.qualificationHash) {
    fail("SOURCE_NATIVE_QUALIFICATION_HASH_MISMATCH");
  }
  try {
    assertSourceNativeAccessRequestIntegrity(candidate.request);
  } catch {
    fail("SOURCE_NATIVE_REQUEST_HASH_MISMATCH");
  }
  if (!candidate.authorization) fail("SOURCE_NATIVE_AUTHORIZATION_MISSING");
  try {
    assertSourceNativeAuthorizationIntegrity(candidate.authorization);
  } catch {
    fail("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
  }
  if (candidate.authorization.requestHash !== candidate.request.requestHash) {
    fail("SOURCE_NATIVE_REQUEST_HASH_MISMATCH");
  }
  if (candidate.authorization.qualificationHash !== candidate.qualification.qualificationHash) {
    fail("SOURCE_NATIVE_QUALIFICATION_HASH_MISMATCH");
  }
  if (candidate.authorization.approvedTextSha256 !== hashSourceNativeApprovalText(candidate.request)
    || stableHash(candidate.authorization.approvedPolicy) !== stableHash(candidate.request.policy)
    || stableHash(candidate.authorization.approvedBudget) !== stableHash(candidate.request.budget)
    || stableHash(candidate.authorization.approvedActions) !== stableHash(candidate.request.requestedActions)
    || candidate.authorization.maxAutomaticRetries !== 0) {
    fail("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
  }
  if (!Array.isArray(candidate.accessLog)) fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");

  let apiRequests = 0;
  let reviewPages = 0;
  let paidAmountUsd = 0;
  let stopConditionActive = false;
  let previousLogHash: string | null = null;
  let approvedLedgerHeadFound = candidate.authorization.approvedLedgerHeadHash === null;
  for (const entry of candidate.accessLog) {
    if (!entry || typeof entry !== "object" || (entry as { kind?: unknown }).kind !== "api_request"
      && (entry as { kind?: unknown }).kind !== "page_open") {
      fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
    }
    try {
      assertSourceNativeAccessLogEntryIntegrity(entry);
    } catch {
      fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
    }
    if (entry.sourceId !== candidate.qualification.sourceId || entry.previousLogHash !== previousLogHash) {
      fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
    }
    previousLogHash = entry.logHash;
    if (entry.logHash === candidate.authorization.approvedLedgerHeadHash) approvedLedgerHeadFound = true;
    if (entry.requestHash === candidate.request.requestHash) {
      if (entry.attempt !== 1) fail("SOURCE_NATIVE_RETRY_FORBIDDEN");
      if (!candidate.request.requestedActions.includes(entry.kind) || !candidate.authorization.approvedActions.includes(entry.kind)) fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
      if (entry.kind === "api_request") {
        if (!candidate.request.policy.allowedApiEndpoints.includes(entry.target)) fail("SOURCE_NATIVE_URL_NOT_ALLOWED");
        apiRequests += 1;
      } else {
        if (!validPageTarget(entry.target, candidate.qualification, candidate.request)) fail("SOURCE_NATIVE_URL_NOT_ALLOWED");
        reviewPages += 1;
      }
      paidAmountUsd += entry.paidAmountUsd;
    }
    if (STOP_OUTCOMES.has(entry.outcome)) stopConditionActive = true;
  }
  if (!approvedLedgerHeadFound) fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
  if (stopConditionActive) fail("SOURCE_NATIVE_STOP_CONDITION_ACTIVE");

  const proposedAction = candidate.proposedAction;
  if (!proposedAction || typeof proposedAction !== "object"
    || (proposedAction.kind !== "api_request" && proposedAction.kind !== "page_open")) {
    fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
  }
  if (!Number.isInteger(proposedAction.attempt) || proposedAction.attempt !== 1) fail("SOURCE_NATIVE_RETRY_FORBIDDEN");
  if (typeof proposedAction.estimatedPaidAmountUsd !== "number" || !Number.isFinite(proposedAction.estimatedPaidAmountUsd)
    || proposedAction.estimatedPaidAmountUsd < 0) fail("SOURCE_NATIVE_PAID_LIMIT_EXCEEDED");
  if (!candidate.request.requestedActions.includes(proposedAction.kind) || !candidate.authorization.approvedActions.includes(proposedAction.kind)) fail("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
  if (proposedAction.kind === "api_request") {
    if (!candidate.request.policy.allowedApiEndpoints.includes(proposedAction.target)) fail("SOURCE_NATIVE_URL_NOT_ALLOWED");
    if (apiRequests + 1 > candidate.authorization.approvedBudget.maxApiRequests) fail("SOURCE_NATIVE_API_BUDGET_EXCEEDED");
  } else {
    if (!validPageTarget(proposedAction.target, candidate.qualification, candidate.request)) fail("SOURCE_NATIVE_URL_NOT_ALLOWED");
    if (reviewPages + 1 > candidate.authorization.approvedBudget.maxReviewPages) fail("SOURCE_NATIVE_PAGE_BUDGET_EXCEEDED");
  }
  if (paidAmountUsd + proposedAction.estimatedPaidAmountUsd > candidate.authorization.approvedBudget.maxPaidAmountUsd) {
    fail("SOURCE_NATIVE_PAID_LIMIT_EXCEEDED");
  }

  const remainingApiRequests = candidate.authorization.approvedBudget.maxApiRequests - apiRequests;
  const remainingReviewPages = candidate.authorization.approvedBudget.maxReviewPages - reviewPages;
  return {
    executionAllowed: true,
    remainingApiRequests,
    remainingReviewPages,
    remainingPaidAmountUsd: candidate.authorization.approvedBudget.maxPaidAmountUsd - paidAmountUsd,
  };
}
