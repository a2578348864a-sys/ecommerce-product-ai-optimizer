import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildSourceNativeApprovalText,
  buildSourceNativeAccessRequest,
  buildSourceNativeAuthorization,
  buildSourceNativeSourceQualification,
  evaluateSourceNativeAccessPreflight,
} from "./stage15-source-native-source-gate";

function qualification() {
  return buildSourceNativeSourceQualification({
    schemaVersion: "stage15-source-native-qualification.v1",
    sourceId: "synthetic-catalogue",
    sourceKind: "public_source_native_site",
    sourceOrigin: "https://catalogue.synthetic.invalid",
    loginRequired: false,
    robotsStatus: "allowed",
    licenseStatus: "verified",
    stableIdentifierKinds: ["manufacturer_number"],
  });
}

function request(sourceQualification = qualification()) {
  return buildSourceNativeAccessRequest({
    schemaVersion: "stage15-source-native-access-request.v1",
    requestId: "synthetic-source-gate-request-01",
    qualificationHash: sourceQualification.qualificationHash,
    requestedActions: ["api_request", "page_open"],
    policy: { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] },
    budget: { maxApiRequests: 2, maxReviewPages: 2, maxPaidAmountUsd: 0 },
  });
}

function canonicalApprovalText(accessRequest: ReturnType<typeof request>) {
  return buildSourceNativeApprovalText(accessRequest);
}

function authorization(
  accessRequest: ReturnType<typeof request>,
  sourceQualification: ReturnType<typeof qualification>,
  approvedLedgerHeadHash: string | null = null,
) {
  return buildSourceNativeAuthorization({
    request: accessRequest,
    qualification: sourceQualification,
    approvedText: canonicalApprovalText(accessRequest),
    approvedLedgerHeadHash,
  });
}

function fixture() {
  const sourceQualification = qualification();
  const accessRequest = request(sourceQualification);
  return { sourceQualification, accessRequest, sourceAuthorization: authorization(accessRequest, sourceQualification) };
}

function proposedAction(patch: Record<string, unknown> = {}) {
  return {
    kind: "page_open" as const,
    target: "https://catalogue.synthetic.invalid/products/SN-001/reviews",
    estimatedPaidAmountUsd: 0,
    attempt: 1,
    ...patch,
  };
}

function accessLog(
  input: ReturnType<typeof fixture>,
  kind: "api_request" | "page_open" = "page_open",
  patch: Record<string, unknown> = {},
) {
  const body = {
    schemaVersion: "stage15-source-native-access-log-entry.v1" as const,
    requestHash: input.accessRequest.requestHash,
    kind,
    sourceId: input.sourceQualification.sourceId,
    target: kind === "api_request" ? "/v1/products" : "https://catalogue.synthetic.invalid/products/SN-001/reviews",
    requestedAt: "2026-07-17T10:00:00.000Z",
    attempt: 1,
    paidAmountUsd: 0,
    previousLogHash: null,
    outcome: "success" as const,
    ...patch,
  };
  return { ...body, logHash: stableHash(body) };
}

function chainedLog(previousLog: ReturnType<typeof accessLog>, patch: Record<string, unknown> = {}) {
  const input = fixture();
  return accessLog(input, "page_open", {
    requestHash: previousLog.requestHash,
    sourceId: previousLog.sourceId,
    previousLogHash: previousLog.logHash,
    requestedAt: "2026-07-17T10:01:00.000Z",
    ...patch,
  });
}

function evaluate(
  input = fixture(),
  accessLog: unknown = [],
  action: unknown = proposedAction(),
  sourceAuthorization: ReturnType<typeof authorization> | null = input.sourceAuthorization,
) {
  return evaluateSourceNativeAccessPreflight({
    qualification: input.sourceQualification,
    request: input.accessRequest,
    authorization: sourceAuthorization,
    accessLog: accessLog as never,
    proposedAction: action as never,
  });
}

function rehashAuthorization(sourceAuthorization: ReturnType<typeof authorization>, patch: Record<string, unknown>) {
  const { authorizationHash: _authorizationHash, ...body } = { ...sourceAuthorization, ...patch };
  return { ...body, authorizationHash: stableHash(body) };
}

describe("Stage 1.5 source-native access gate", () => {
  it("requires an explicit canonical approval text exact match before creating authorization", () => {
    const input = fixture();
    expect(() => buildSourceNativeAuthorization({
      request: input.accessRequest,
      qualification: input.sourceQualification,
      approvedLedgerHeadHash: null,
    } as never)).toThrow("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
    expect(() => buildSourceNativeAuthorization({
      request: input.accessRequest,
      qualification: input.sourceQualification,
      approvedText: "Approve something else",
      approvedLedgerHeadHash: null,
    })).toThrow("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
  });

  it("rebuilds remaining budgets from the verified ledger before allowing a proposed action", () => {
    const input = fixture();
    expect(evaluate(input, [accessLog(input, "api_request")])).toEqual({
      executionAllowed: true,
      remainingApiRequests: 1,
      remainingReviewPages: 2,
      remainingPaidAmountUsd: 0,
    });
  });

  it.each([
    ["missing authorization", () => { const input = fixture(); return evaluate(input, [], proposedAction(), null); }, "SOURCE_NATIVE_AUTHORIZATION_MISSING"],
    ["request hash mismatch", () => { const input = fixture(); return evaluate(input, [], proposedAction(), rehashAuthorization(input.sourceAuthorization, { requestHash: "a".repeat(64) })); }, "SOURCE_NATIVE_REQUEST_HASH_MISMATCH"],
    ["qualification hash mismatch", () => { const input = fixture(); return evaluateSourceNativeAccessPreflight({ qualification: input.sourceQualification, request: { ...input.accessRequest, qualificationHash: "b".repeat(64) }, authorization: input.sourceAuthorization, accessLog: [], proposedAction: proposedAction() } as never); }, "SOURCE_NATIVE_QUALIFICATION_HASH_MISMATCH"],
    ["approval text mismatch", () => { const input = fixture(); return evaluate(input, [], proposedAction(), rehashAuthorization(input.sourceAuthorization, { approvedTextSha256: "c".repeat(64) })); }, "SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH"],
    ["unregistered proposed action", () => evaluate(fixture(), [], proposedAction({ kind: "unknown_action" })), "SOURCE_NATIVE_ACTION_NOT_REGISTERED"],
    ["unapproved proposed URL", () => evaluate(fixture(), [], proposedAction({ target: "https://catalogue.synthetic.invalid/private/SN-001" })), "SOURCE_NATIVE_URL_NOT_ALLOWED"],
    ["review-page budget before execution", () => { const input = fixture(); const first = accessLog(input); const second = chainedLog(first); return evaluate(input, [first, second]); }, "SOURCE_NATIVE_PAGE_BUDGET_EXCEEDED"],
    ["API budget before execution", () => { const input = fixture(); const first = accessLog(input, "api_request"); const second = chainedLog(first, { kind: "api_request", target: "/v1/products" }); return evaluate(input, [first, second], proposedAction({ kind: "api_request", target: "/v1/products" })); }, "SOURCE_NATIVE_API_BUDGET_EXCEEDED"],
    ["automatic retry before execution", () => evaluate(fixture(), [], proposedAction({ attempt: 2 })), "SOURCE_NATIVE_RETRY_FORBIDDEN"],
    ["paid limit before execution", () => evaluate(fixture(), [], proposedAction({ kind: "api_request", target: "/v1/products", estimatedPaidAmountUsd: 0.01 })), "SOURCE_NATIVE_PAID_LIMIT_EXCEEDED"],
    ["malformed request", () => { const input = fixture(); return evaluateSourceNativeAccessPreflight({ qualification: input.sourceQualification, request: null, authorization: input.sourceAuthorization, accessLog: [], proposedAction: proposedAction() } as never); }, "SOURCE_NATIVE_REQUEST_HASH_MISMATCH"],
    ["null access log", () => { const input = fixture(); return evaluateSourceNativeAccessPreflight({ qualification: input.sourceQualification, request: input.accessRequest, authorization: input.sourceAuthorization, accessLog: null, proposedAction: proposedAction() } as never); }, "SOURCE_NATIVE_ACTION_NOT_REGISTERED"],
    ["null proposed action", () => { const input = fixture(); return evaluateSourceNativeAccessPreflight({ qualification: input.sourceQualification, request: input.accessRequest, authorization: input.sourceAuthorization, accessLog: [], proposedAction: null } as never); }, "SOURCE_NATIVE_ACTION_NOT_REGISTERED"],
  ])("fails closed on %s", (_label, action, expectedCode) => {
    expect(action).toThrow(expectedCode);
  });

  it("rejects a recomputed authorization that contains plaintext credential fields", () => {
    const input = fixture();
    expect(() => evaluate(input, [], proposedAction(), rehashAuthorization(input.sourceAuthorization, {
      password: "not-allowed",
      cookie: "not-allowed",
      secret: "not-allowed",
      token: "not-allowed",
      key: "not-allowed",
      approvalText: canonicalApprovalText(input.accessRequest),
      approvedText: canonicalApprovalText(input.accessRequest),
    }))).toThrow("SOURCE_NATIVE_APPROVAL_TEXT_MISMATCH");
  });

  it("permanently stops the same source after a different request records a captcha", () => {
    const input = fixture();
    const stopped = accessLog(input, "page_open", { requestHash: "d".repeat(64), outcome: "captcha" });
    const sourceAuthorization = authorization(input.accessRequest, input.sourceQualification, stopped.logHash);
    expect(() => evaluate(input, [stopped], proposedAction(), sourceAuthorization))
      .toThrow("SOURCE_NATIVE_STOP_CONDITION_ACTIVE");
  });

  it("uses same-source cross-request history only for chain and stop checks, not this request's budget", () => {
    const input = fixture();
    const first = accessLog(input, "api_request", { requestHash: "e".repeat(64) });
    const second = chainedLog(first, { kind: "api_request", target: "/v1/products" });
    const sourceAuthorization = authorization(input.accessRequest, input.sourceQualification, second.logHash);
    expect(evaluate(input, [first, second], proposedAction({ kind: "api_request", target: "/v1/products" }), sourceAuthorization))
      .toMatchObject({ executionAllowed: true, remainingApiRequests: 2, remainingReviewPages: 2 });
  });

  it("rejects a non-contiguous append-only log chain", () => {
    const input = fixture();
    const first = accessLog(input);
    const unlinked = chainedLog(first, { previousLogHash: null });
    expect(() => evaluate(input, [first, unlinked])).toThrow("SOURCE_NATIVE_ACTION_NOT_REGISTERED");
  });
});
