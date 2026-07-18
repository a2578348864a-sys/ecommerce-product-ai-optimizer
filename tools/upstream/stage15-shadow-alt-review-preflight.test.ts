import { describe, expect, it } from "vitest";
import type { AltReviewAccessLogEntry } from "./stage15-shadow-alt-review-contract";
import { evaluateStage15ShadowAltReviewPreflight } from "./stage15-shadow-alt-review-preflight";
import {
  fixtureAuthorization,
  fixtureBrief,
  fixturePageLog,
  fixtureRegistry,
  fixtureRequest,
  fixtureSearchLog,
} from "./stage15-shadow-alt-review-test-fixtures";

function evaluate(accessLog: AltReviewAccessLogEntry[] = []) {
  return evaluateStage15ShadowAltReviewPreflight({
    brief: fixtureBrief(),
    registry: fixtureRegistry(),
    request: fixtureRequest(),
    authorization: fixtureAuthorization(),
    accessLog,
  });
}

describe("Stage 1.5 alternative review preflight", () => {
  it("stays blocked without matching authorization", () => {
    const result = evaluateStage15ShadowAltReviewPreflight({
      brief: fixtureBrief(),
      registry: fixtureRegistry(),
      request: fixtureRequest(),
      authorization: null,
      accessLog: [],
    });

    expect(result).toMatchObject({
      status: "pending_user_access_approval",
      executionAllowed: false,
      remainingSearchQueries: 3,
      remainingPageOpens: 6,
      quarantinedSourceIds: [],
    });
  });

  it("allows only frozen actions after exact authorization", () => {
    expect(evaluate()).toMatchObject({
      status: "probe_in_progress",
      executionAllowed: true,
      remainingSearchQueries: 3,
      remainingPageOpens: 6,
    });
  });

  it.each([
    ["duplicate query", [fixtureSearchLog(), fixtureSearchLog()], "SHADOW_ALT_REVIEW_DUPLICATE_QUERY"],
    ["retry", [{ ...fixtureSearchLog(), attempt: 2 }], "SHADOW_ALT_REVIEW_RETRY_FORBIDDEN"],
    ["unregistered url", [{ ...fixturePageLog(), url: "https://unapproved.example/p/1" }], "SHADOW_ALT_REVIEW_URL_NOT_REGISTERED"],
    ["duplicate url", [fixturePageLog(), fixturePageLog()], "SHADOW_ALT_REVIEW_DUPLICATE_URL"],
    ["early timestamp", [{ ...fixtureSearchLog(), requestedAt: "2026-07-17T09:02:59.000Z" }], "SHADOW_ALT_REVIEW_LOG_BEFORE_AUTHORIZATION"],
  ])("fails closed on %s", (_label, accessLog, code) => {
    expect(() => evaluate(accessLog as AltReviewAccessLogEntry[])).toThrow(code);
  });

  it("quarantines only the stopped source and preserves the other frozen source", () => {
    const stopped = { ...fixturePageLog(), outcome: "login_wall" as const };

    expect(evaluate([fixtureSearchLog(), stopped])).toMatchObject({
      status: "probe_in_progress",
      executionAllowed: true,
      remainingSearchQueries: 2,
      remainingPageOpens: 5,
      quarantinedSourceIds: ["public-retailer-a"],
    });
  });

  it("rejects any later page from a quarantined source", () => {
    const stopped = { ...fixturePageLog(), outcome: "login_wall" as const };
    const laterPage = {
      ...fixturePageLog(),
      url: "https://retailer-a.example.test/product/B0D7Q1DWPF/reviews",
      requestedAt: "2026-07-17T09:06:00.000Z",
    };

    expect(() => evaluate([fixtureSearchLog(), stopped, laterPage]))
      .toThrow("SHADOW_ALT_REVIEW_SOURCE_QUARANTINED");
  });

  it("rejects a page logged before its frozen search query", () => {
    expect(() => evaluate([fixturePageLog()])).toThrow("SHADOW_ALT_REVIEW_PAGE_BEFORE_QUERY");
  });

  it("rejects request and authorization drift", () => {
    const request = fixtureRequest();
    expect(() => evaluateStage15ShadowAltReviewPreflight({
      brief: fixtureBrief(),
      registry: fixtureRegistry(),
      request,
      authorization: { ...fixtureAuthorization(), requestHash: "f".repeat(64) },
      accessLog: [],
    })).toThrow("SHADOW_ALT_REVIEW_AUTHORIZATION_DRIFT");
  });
});
