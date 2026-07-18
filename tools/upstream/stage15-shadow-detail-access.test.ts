import { describe, expect, it } from "vitest";
import {
  buildStage15ShadowDetailAccessRequest,
  evaluateStage15ShadowDetailAccessPreflight,
} from "./stage15-shadow-detail-access";

function targets() {
  return Array.from({ length: 20 }, (_, index) => {
    const platformProductId = `B0${String(index + 1).padStart(8, "0")}`;
    return {
      productKey: `amazon:US:${platformProductId}`,
      platformProductId,
      sourceUrl: `https://www.amazon.com/example-${index + 1}/dp/${platformProductId}`,
    };
  });
}

function request() {
  return buildStage15ShadowDetailAccessRequest({
    schemaVersion: "stage15-shadow-detail-access-request-input.v1",
    batchId: "stage15-shadow-calibration-c-20260717-01",
    role: "calibration",
    sourceManifest: {
      manifestId: "stage15-shadow-calibration-c-manifest-20260717-01",
      manifestHash: "a".repeat(64),
      fileSha256: "b".repeat(64),
    },
    targets: targets(),
    proposedBudget: {
      maxDetailPageRequests: 20,
      maxRequestsPerProduct: 1,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
    },
    createdAt: "2026-07-17T06:30:00.000Z",
  });
}

describe("Stage 1.5 shadow detail access request", () => {
  it("freezes a pending, non-executable Batch C request with exact targets and stop conditions", () => {
    const value = request();
    expect(value.authorizationStatus).toBe("pending_user_approval");
    expect(value.executionAllowed).toBe(false);
    expect(value.targets).toHaveLength(20);
    expect(value.allowedFields).toEqual([
      "dimensions",
      "material",
      "monthly_bought",
      "first_available_at",
      "exact_variant_rating",
      "exact_variant_review_count",
      "exact_variant_positive_reviews",
      "exact_variant_negative_reviews",
    ]);
    expect(value.stopConditions).toEqual(["login_wall", "captcha", "access_denied", "variant_binding_unverified"]);
    expect(value.forbiddenActions).toContain("automatic_retry");
    expect(value.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(request()).toEqual(value);
  });

  it("keeps preflight blocked until a matching explicit approval is supplied", () => {
    const value = request();
    expect(evaluateStage15ShadowDetailAccessPreflight({ request: value, authorization: null, accessLog: [] }))
      .toMatchObject({ status: "blocked_pending_user_approval", executionAllowed: false, remainingRequests: 20 });

    const authorization = {
      schemaVersion: "stage15-shadow-detail-access-authorization.v1" as const,
      batchId: value.batchId,
      requestHash: value.requestHash,
      status: "approved" as const,
      approvedAt: "2026-07-17T07:00:00.000Z",
      approvedBudget: value.proposedBudget,
    };
    expect(evaluateStage15ShadowDetailAccessPreflight({ request: value, authorization, accessLog: [] }))
      .toMatchObject({ status: "ready", executionAllowed: true, remainingRequests: 20 });
  });

  it("fails closed on approval drift, duplicate access, retries, wrong URL or budget overflow", () => {
    const value = request();
    const authorization = {
      schemaVersion: "stage15-shadow-detail-access-authorization.v1" as const,
      batchId: value.batchId,
      requestHash: value.requestHash,
      status: "approved" as const,
      approvedAt: "2026-07-17T07:00:00.000Z",
      approvedBudget: value.proposedBudget,
    };
    expect(() => evaluateStage15ShadowDetailAccessPreflight({
      request: value,
      authorization: { ...authorization, requestHash: "c".repeat(64) },
      accessLog: [],
    })).toThrow("SHADOW_DETAIL_AUTHORIZATION_DRIFT");

    const first = value.targets[0];
    const log = {
      productKey: first.productKey,
      sourceUrl: first.sourceUrl,
      attempt: 1,
      outcome: "success" as const,
      requestedAt: "2026-07-17T07:01:00.000Z",
    };
    expect(() => evaluateStage15ShadowDetailAccessPreflight({
      request: value,
      authorization,
      accessLog: [log, log],
    })).toThrow("SHADOW_DETAIL_ACCESS_DUPLICATE_PRODUCT");
    expect(() => evaluateStage15ShadowDetailAccessPreflight({
      request: value,
      authorization,
      accessLog: [{ ...log, attempt: 2 }],
    })).toThrow("SHADOW_DETAIL_ACCESS_RETRY_FORBIDDEN");
    expect(() => evaluateStage15ShadowDetailAccessPreflight({
      request: value,
      authorization,
      accessLog: [{ ...log, sourceUrl: "https://example.com/not-approved" }],
    })).toThrow("SHADOW_DETAIL_ACCESS_TARGET_DRIFT");
  });

  it("blocks the whole batch after the first approved stop condition instead of exposing the remaining budget", () => {
    const value = request();
    const authorization = {
      schemaVersion: "stage15-shadow-detail-access-authorization.v1" as const,
      batchId: value.batchId,
      requestHash: value.requestHash,
      status: "approved" as const,
      approvedAt: "2026-07-17T07:00:00.000Z",
      approvedBudget: value.proposedBudget,
    };
    const first = value.targets[0];

    expect(evaluateStage15ShadowDetailAccessPreflight({
      request: value,
      authorization,
      accessLog: [{
        productKey: first.productKey,
        sourceUrl: first.sourceUrl,
        attempt: 1,
        outcome: "login_wall",
        requestedAt: "2026-07-17T07:01:00.000Z",
      }],
    })).toMatchObject({
      status: "blocked_stop_condition",
      executionAllowed: false,
      completedRequests: 1,
      remainingRequests: 19,
      stopCondition: "login_wall",
      stoppedProductKey: first.productKey,
    });
  });

  it("rejects non-calibration, non-Amazon, duplicate or overbroad requests", () => {
    const base = {
      schemaVersion: "stage15-shadow-detail-access-request-input.v1" as const,
      batchId: "stage15-shadow-calibration-c-20260717-01",
      role: "calibration" as const,
      sourceManifest: { manifestId: "manifest", manifestHash: "a".repeat(64), fileSha256: "b".repeat(64) },
      targets: targets(),
      proposedBudget: { maxDetailPageRequests: 20, maxRequestsPerProduct: 1, maxAutomaticRetries: 0, maxImageDownloads: 0 },
      createdAt: "2026-07-17T06:30:00.000Z",
    };
    expect(() => buildStage15ShadowDetailAccessRequest({ ...base, role: "validation" as never }))
      .toThrow("SHADOW_DETAIL_ACCESS_REQUEST_INVALID");
    expect(() => buildStage15ShadowDetailAccessRequest({ ...base, targets: [...base.targets.slice(0, 19), base.targets[0]] }))
      .toThrow("SHADOW_DETAIL_ACCESS_TARGET_INVALID");
    expect(() => buildStage15ShadowDetailAccessRequest({
      ...base,
      targets: base.targets.map((target, index) => index === 0 ? { ...target, sourceUrl: "https://example.com/item" } : target),
    })).toThrow("SHADOW_DETAIL_ACCESS_TARGET_INVALID");
    expect(() => buildStage15ShadowDetailAccessRequest({
      ...base,
      proposedBudget: { ...base.proposedBudget, maxAutomaticRetries: 1 },
    })).toThrow("SHADOW_DETAIL_ACCESS_BUDGET_INVALID");
  });
});
