import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type {
  HumanAssistedBrowserCleanup,
  IsolatedPublicBrowserSession,
  PublicPageNavigationResult,
} from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildStage2AlternativeSourcePolicyPreflight,
  type MadeInChinaProbeDomSignals,
} from "./stage2-alternative-source-probe";
import { runOfflineStage2AlternativeSourceCapabilityProbe } from "./run-stage2-alternative-source-probe";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;

const navigation: PublicPageNavigationResult = {
  requestedUrl: brief.search.startUrl,
  finalUrl: brief.search.startUrl,
  redirectOrigins: [],
  redirectCount: 0,
  mainDocumentHttpStatus: 200,
  mainDocumentContentType: "text/html; charset=UTF-8",
  navigationElapsedMs: 200,
  domWaitElapsedMs: 50,
  readyState: "complete",
  allowedFinalOrigin: true,
};

const signals: MadeInChinaProbeDomSignals = {
  pageUrl: brief.search.startUrl,
  title: "Hanging Organizer - Made-in-China.com",
  visibleTextLength: 5000,
  brandMarker: true,
  brandTitleMarker: true,
  searchContainerMarker: true,
  alternateSearchContainerMarker: false,
  captchaMarker: false,
  loginOrInquiryMarker: false,
  accessDeniedMarker: false,
  serviceUnavailableMarker: false,
  candidateProductLinks: [
    "https://www.made-in-china.com/price/prodetail_example-ABC123.html",
  ],
};

const cleanup: HumanAssistedBrowserCleanup = {
  pageClosed: true,
  browserClosed: true,
  forcedTerminationUsed: false,
  debugPortReleased: true,
  profileRemoved: true,
  browserProcessBaselineRestored: true,
};

function policy(robotsText = "User-agent: *\nAllow: /products-search/\n") {
  return buildStage2AlternativeSourcePolicyPreflight({
    brief,
    robotsText,
    termsDecision: "reviewed_allows_public_capability_probe",
    evaluatedAt: "2026-07-15T02:00:00.000Z",
    requestCount: 1,
  });
}

function sessionFixture(input?: {
  navigationResult?: PublicPageNavigationResult;
  signalsResult?: MadeInChinaProbeDomSignals;
  cleanupResult?: HumanAssistedBrowserCleanup;
  navigationError?: Error;
  navigationCountAfterNavigate?: number;
}) {
  let navigationCount = 0;
  const navigate = vi.fn(async () => {
    navigationCount += 1;
    if (input?.navigationCountAfterNavigate !== undefined) {
      navigationCount = input.navigationCountAfterNavigate;
    }
    if (input?.navigationError) throw input.navigationError;
    return input?.navigationResult ?? navigation;
  });
  const evaluateDomByValue = vi.fn(async () => input?.signalsResult ?? signals);
  const close = vi.fn(async () => input?.cleanupResult ?? cleanup);
  const session = {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/offline-fixture",
    profileId: "offline-fixture-profile",
    profileLocationType: "system_temp",
    debugPort: 0,
    get navigationCount() { return navigationCount; },
    navigate,
    evaluateDomByValue,
    close,
  } as IsolatedPublicBrowserSession;
  return { session, navigate, evaluateDomByValue, close };
}

describe("offline Stage 2 alternative source capability probe orchestration", () => {
  it("uses the shared session contract once and returns offline-fixture-only readiness", async () => {
    const fixture = sessionFixture();
    const openSession = vi.fn(async () => ({ kind: "offline_fixture" as const, session: fixture.session }));
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession,
    });

    expect(openSession).toHaveBeenCalledWith({
      allowedOrigins: ["https://www.made-in-china.com"],
      maxNavigations: 3,
      headless: false,
    });
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.navigate).toHaveBeenCalledWith(brief.search.startUrl);
    expect(fixture.evaluateDomByValue).toHaveBeenCalledTimes(1);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-run.v1",
      proofLevel: "offline_fixture_only",
      status: "capability_ready",
      errorCode: null,
      reasonCodes: [],
      realWebsiteAccessed: false,
      allowedProductUrls: ["https://www.made-in-china.com/price/prodetail_example-ABC123.html"],
      navigationBudget: { maximum: 3, used: 1, automaticRetryCount: 0 },
      externalRequestBudget: { maximum: 4, policyUsed: 1, navigationUsed: 1, totalUsed: 2 },
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
      cleanup,
    });
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    const { evidenceHash, ...resultBody } = result;
    expect(evidenceHash).toBe(stableHash(resultBody));
  });

  it("does not start a browser session when policy preflight is blocked", async () => {
    const openSession = vi.fn();
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy("User-agent: *\nDisallow: /\n"),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession,
    });
    expect(openSession).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "failed_closed",
      errorCode: "policy_preflight_blocked",
      browserSessionStarted: false,
      page: null,
      cleanup: null,
      navigationBudget: { used: 0 },
    });
  });

  it("closes the browser after a page blocker and never navigates a product page", async () => {
    const fixture = sessionFixture({ signalsResult: { ...signals, captchaMarker: true } });
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession: async () => ({ kind: "offline_fixture", session: fixture.session }),
    });
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed_closed",
      errorCode: "captcha_or_robot_check",
      cleanup,
      allowedProductUrls: [],
    });
  });

  it("closes the browser when navigation throws and records a bounded error", async () => {
    const fixture = sessionFixture({ navigationError: new Error("PUBLIC_NAVIGATION_FAILED:offline fixture") });
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession: async () => ({ kind: "offline_fixture", session: fixture.session }),
    });
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed_closed");
    expect(result.errorCode).toBe("browser_or_navigation_failed");
    expect(result.reasonCodes[0].length).toBeLessThanOrEqual(200);
  });

  it("overrides apparent readiness when owned browser cleanup is incomplete", async () => {
    const fixture = sessionFixture({ cleanupResult: { ...cleanup, profileRemoved: false } });
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession: async () => ({ kind: "offline_fixture", session: fixture.session }),
    });
    expect(result).toMatchObject({
      status: "failed_closed",
      errorCode: "browser_cleanup_failed",
    });
    expect(result.reasonCodes).toContain("owned_browser_resources_not_fully_restored");
  });

  it("fails closed when the fixture reports navigation or total request budget exhaustion", async () => {
    const fixture = sessionFixture({ navigationCountAfterNavigate: 4 });
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession: async () => ({ kind: "offline_fixture", session: fixture.session }),
    });
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed_closed",
      errorCode: "request_budget_exhausted",
      navigationBudget: { maximum: 3, used: 4 },
      externalRequestBudget: { maximum: 4, totalUsed: 5 },
    });
    expect(result.reasonCodes).toContain("requested_external_request_budget_exhausted");
  });

  it("rejects mutated policy evidence before invoking the session adapter", async () => {
    const invalid = { ...policy(), requestCount: 0 };
    const openSession = vi.fn();
    await expect(runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: invalid,
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession,
    })).rejects.toThrow("STAGE2_ALTERNATIVE_SOURCE_POLICY_PREFLIGHT_INVALID");
    expect(openSession).not.toHaveBeenCalled();
  });

  it("rejects a hash-consistent policy whose allowed status conflicts with disallow evidence", async () => {
    const blocked = policy("User-agent: *\nDisallow: /\n");
    const { inputHash: _oldHash, ...blockedBody } = blocked;
    const forgedBody = { ...blockedBody, status: "allowed" as const, reasonCodes: [] };
    const forged = { ...forgedBody, inputHash: stableHash(forgedBody) };
    const openSession = vi.fn();
    await expect(runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: forged,
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession,
    })).rejects.toThrow("STAGE2_ALTERNATIVE_SOURCE_POLICY_PREFLIGHT_INVALID");
    expect(openSession).not.toHaveBeenCalled();
  });

  it("closes an opened session even when its offline fixture marker is invalid", async () => {
    const fixture = sessionFixture();
    const result = await runOfflineStage2AlternativeSourceCapabilityProbe({
      brief,
      policyPreflight: policy(),
      capturedAt: "2026-07-15T02:05:00.000Z",
      openSession: async () => ({
        kind: "unexpected_runtime" as unknown as "offline_fixture",
        session: fixture.session,
      }),
    });
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "failed_closed",
      errorCode: "browser_or_navigation_failed",
    });
  });
});
