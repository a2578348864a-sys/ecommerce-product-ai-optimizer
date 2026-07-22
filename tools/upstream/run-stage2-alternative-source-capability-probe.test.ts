import { TEST_PROJECT_MATERIALS_ROOT } from "../../tests/helpers/project-materials";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  HumanAssistedBrowserCleanup,
  IsolatedPublicBrowserSession,
  PublicPageNavigationResult,
} from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import type { Stage2AlternativeSourceProbeAuthorizationRequest } from "./stage2-alternative-source-probe-authorization";
import { buildStage2AlternativeSourceProbeReauthorizationRequest } from "./stage2-alternative-source-probe-reauthorization";
import type { MadeInChinaProbeDomSignals } from "./stage2-alternative-source-probe";
import type { MadeInChinaUnknownPageDiagnosticDomSignals } from "./stage2-alternative-source-unknown-page-diagnostic";
import { executeAuthorizedStage2AlternativeSourceCapabilityProbe } from "./run-stage2-alternative-source-capability-probe";

const PROJECT_ROOT = TEST_PROJECT_MATERIALS_ROOT;
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;
const offlineValidation = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Probe-Offline-01/stage2-alternative-source-capability-probe-offline-validation.v1.json"),
"utf8")) as Record<string, unknown>;
const authorizationRequest = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-Authorization-01/stage2-alternative-source-capability-probe-authorization-request.v1.json"),
"utf8")) as Stage2AlternativeSourceProbeAuthorizationRequest;
const priorAuthorization = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-authorization.v1.json"),
"utf8")) as Record<string, unknown>;
const priorRun = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Capability-Probe-01/stage2-alternative-source-capability-probe-run.v2.json"),
"utf8")) as Record<string, unknown>;
const unknownPageDiagnosticValidation = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Unknown-Page-Diagnostic-Offline-01/stage2-alternative-source-unknown-page-diagnostic-offline-validation.v1.json"),
"utf8")) as Record<string, unknown>;

const navigation: PublicPageNavigationResult = {
  requestedUrl: brief.search.startUrl,
  finalUrl: brief.search.startUrl,
  redirectOrigins: [],
  redirectCount: 0,
  mainDocumentHttpStatus: 200,
  mainDocumentContentType: "text/html; charset=UTF-8",
  navigationElapsedMs: 180,
  domWaitElapsedMs: 40,
  readyState: "complete",
  allowedFinalOrigin: true,
};
const signals: MadeInChinaProbeDomSignals = {
  pageUrl: brief.search.startUrl,
  title: "Hanging Organizer - Made-in-China.com",
  visibleTextLength: 4000,
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
    "https://www.made-in-china.com/price/prodetail_example-DEF456.html",
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

function sessionFixture(
  cleanupResult = cleanup,
  evaluations: unknown[] = [signals],
) {
  let navigationCount = 0;
  const navigate = vi.fn(async () => { navigationCount += 1; return navigation; });
  let evaluationIndex = 0;
  const evaluateDomByValue = vi.fn(async () => evaluations[evaluationIndex++]);
  const close = vi.fn(async () => cleanupResult);
  const session = {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/test",
    profileId: "isolated-test-profile",
    profileLocationType: "system_temp",
    debugPort: 49152,
    get navigationCount() { return navigationCount; },
    navigate,
    evaluateDomByValue,
    close,
  } as IsolatedPublicBrowserSession;
  return { session, navigate, evaluateDomByValue, close };
}

function common() {
  return {
    brief,
    offlineValidation,
    authorizationRequest,
    authorizationPhrase: authorizationRequest.authorizationPhrase,
    capturedAt: "2026-07-15T04:00:00.000Z",
    termsEvidenceHash: "a".repeat(64),
  };
}

function commonV2() {
  const request = buildStage2AlternativeSourceProbeReauthorizationRequest({
    brief,
    baselineOfflineValidation: offlineValidation,
    priorAuthorization,
    priorRun,
    unknownPageDiagnosticValidation,
    createdAt: "2026-07-15T04:30:00.000Z",
  });
  return {
    brief,
    offlineValidation,
    priorAuthorization,
    priorRun,
    unknownPageDiagnosticValidation,
    authorizationRequest: request,
    authorizationPhrase: request.authorizationPhrase,
    capturedAt: "2026-07-15T04:35:00.000Z",
    termsEvidenceHash: "a".repeat(64),
  };
}

describe("authorized real Stage 2 alternative source capability probe", () => {
  it("uses one robots request and one search navigation, discovers URLs without visiting products", async () => {
    const fixture = sessionFixture();
    const fetchRobots = vi.fn(async () => ({
      body: "User-agent: *\nAllow: /products-search/\n",
      status: 200,
      contentType: "text/plain",
      finalUrl: brief.policyPreflight.robotsUrl,
      elapsedMs: 25,
    }));
    const openSession = vi.fn(async () => fixture.session);
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...common(), fetchRobots, openSession,
    });
    expect(fetchRobots).toHaveBeenCalledTimes(1);
    expect(openSession).toHaveBeenCalledWith({
      allowedOrigins: ["https://www.made-in-china.com"],
      maxNavigations: 1,
      headless: false,
    });
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(result.authorization.consumption.status).toBe("consumed");
    expect(result.run).toMatchObject({
      proofLevel: "real_public_capability_probe",
      status: "capability_ready",
      realWebsiteAccessed: true,
      navigationBudget: { maximum: 1, used: 1, productPageNavigations: 0 },
      externalActionBudget: { maximum: 2, policyUsed: 1, navigationUsed: 1, totalUsed: 2 },
      supplierFieldsCollected: 0,
      cleanup,
    });
    expect(result.run.allowedProductUrls).toHaveLength(2);
    expect(result.run.unknownPageDiagnostic).toBeNull();
    expect(fixture.evaluateDomByValue).toHaveBeenCalledTimes(1);
  });

  it("captures a separate fail-closed diagnostic when the primary classifier returns unknown_page", async () => {
    const unknownSignals: MadeInChinaProbeDomSignals = {
      ...signals,
      searchContainerMarker: false,
      candidateProductLinks: [],
    };
    const diagnosticSignals: MadeInChinaUnknownPageDiagnosticDomSignals = {
      pageUrl: brief.search.startUrl,
      title: signals.title,
      visibleTextLength: 4000,
      mainElementCount: 1,
      headingCount: 12,
      imageCount: 30,
      anchorCount: 80,
      sameOriginAnchorCount: 70,
      knownSearchContainerCount: 0,
      genericProductClassElementCount: 15,
      exactAllowedProductPathCount: 0,
      looseSameOriginProductPathCount: 10,
      supplierSubdomainProductPathCount: 0,
      safeSameOriginPathSamples: ["/unrecognized-product/example.html"],
      missingReasons: [],
    };
    const fixture = sessionFixture(cleanup, [unknownSignals, diagnosticSignals]);
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...common(),
      fetchRobots: async () => ({
        body: "User-agent: *\nAllow: /products-search/\n", status: 200, contentType: "text/plain",
        finalUrl: brief.policyPreflight.robotsUrl, elapsedMs: 20,
      }),
      openSession: async () => fixture.session,
    });
    expect(fixture.evaluateDomByValue).toHaveBeenCalledTimes(2);
    expect(result.run).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-run.v3",
      status: "failed_closed",
      errorCode: "unknown_page",
      unknownPageDiagnostic: {
        schemaVersion: "stage2-alternative-source-unknown-page-diagnostic.v1",
        status: "diagnostic_evidence_present",
        parentPageInputHash: result.run.page?.inputHash,
        failClosedRequired: true,
        allowsCollection: false,
      },
    });
    expect(result.run.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a fully bound Probe-02 request and emits a v2 single-use authorization", async () => {
    const fixture = sessionFixture();
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...commonV2(),
      fetchRobots: async () => ({
        body: "User-agent: *\nAllow: /products-search/\n", status: 200, contentType: "text/plain",
        finalUrl: brief.policyPreflight.robotsUrl, elapsedMs: 20,
      }),
      openSession: async () => fixture.session,
    });
    expect(result.authorization).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-authorization.v2",
      status: "granted_single_use",
      priorRunEvidenceHash: priorRun.evidenceHash,
      unknownPageDiagnosticValidationEvidenceHash: unknownPageDiagnosticValidation.evidenceHash,
      consumption: { status: "consumed", runId: result.run.runId },
    });
    expect(result.run).toMatchObject({
      schemaVersion: "stage2-alternative-source-capability-probe-run.v3",
      status: "capability_ready",
      authorizationEvidenceHash: result.authorization.evidenceHash,
    });
    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(fixture.evaluateDomByValue).toHaveBeenCalledTimes(1);
  });

  it("fails closed before browser launch when robots disallows the search path", async () => {
    const openSession = vi.fn();
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...common(),
      fetchRobots: vi.fn(async () => ({
        body: "User-agent: *\nDisallow: /\n", status: 200, contentType: "text/plain",
        finalUrl: brief.policyPreflight.robotsUrl, elapsedMs: 20,
      })),
      openSession,
    });
    expect(openSession).not.toHaveBeenCalled();
    expect(result.run).toMatchObject({
      status: "failed_closed",
      errorCode: "policy_preflight_blocked",
      browserSessionStarted: false,
      navigationBudget: { used: 0 },
    });
  });

  it("fails closed without retry when the single robots request fails", async () => {
    const fetchRobots = vi.fn(async () => { throw new Error("ROBOTS_HTTP_STATUS_503"); });
    const openSession = vi.fn();
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...common(), fetchRobots, openSession,
    });
    expect(fetchRobots).toHaveBeenCalledTimes(1);
    expect(openSession).not.toHaveBeenCalled();
    expect(result.run.reasonCodes).toEqual(expect.arrayContaining([
      "robots_policy_unknown", "ROBOTS_HTTP_STATUS_503",
    ]));
  });

  it("overrides apparent readiness when isolated browser cleanup is incomplete", async () => {
    const fixture = sessionFixture({ ...cleanup, profileRemoved: false });
    const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
      ...common(),
      fetchRobots: async () => ({
        body: "User-agent: *\nAllow: /products-search/\n", status: 200, contentType: "text/plain",
        finalUrl: brief.policyPreflight.robotsUrl, elapsedMs: 20,
      }),
      openSession: async () => fixture.session,
    });
    expect(result.run).toMatchObject({ status: "failed_closed", errorCode: "browser_cleanup_failed" });
  });
});
