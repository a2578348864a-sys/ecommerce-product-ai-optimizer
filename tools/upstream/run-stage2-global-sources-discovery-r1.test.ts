import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type {
  HumanAssistedBrowserCleanup,
  IsolatedPublicBrowserSession,
  PublicPageNavigationResult,
} from "../collectors/amazon/browser-control";
import { buildStage2GlobalSourcesDiscoveryBriefR1, type GlobalSourcesDiscoveryDomSignals } from "./stage2-global-sources-discovery-r1";
import {
  GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
  buildStage2GlobalSourcesDiscoveryAuthorizationRequest,
} from "./stage2-global-sources-discovery-r1-authorization";
import { executeAuthorizedStage2GlobalSourcesDiscoveryR1 } from "./run-stage2-global-sources-discovery-r1";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(PROJECT_ROOT, path), "utf8")) as Record<string, unknown>;

function brief() {
  return buildStage2GlobalSourcesDiscoveryBriefR1({
    selection: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-alternative-source-selection.v1.json"),
    historicalBrief: readJson("06_测试与验证/2026-07-15-Phase-Stage2-Global-Sources-Discovery-C1A-01/stage2-global-sources-discovery-brief.v1.json"),
    createdAt: "2026-07-15T06:00:00.000Z",
  });
}

function offlineValidation() {
  const b = brief();
  const body = {
    schemaVersion: "stage2-global-sources-discovery-offline-validation.v1",
    status: "offline_validation_passed",
    proofLevel: "offline_fixture_only",
    briefId: b.briefId,
    briefHash: b.briefHash,
    fixtureSchemaVersion: "stage2-global-sources-discovery-r1-fixture.v1",
    scenarioCount: 14,
    passedScenarioCount: 14,
    failedScenarioIds: [],
    realWebsiteAccessed: false,
    runtimeDiscoveryExecuted: false,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

function authorizationRequest() {
  return buildStage2GlobalSourcesDiscoveryAuthorizationRequest({
    brief: brief(), offlineValidation: offlineValidation(), createdAt: "2026-07-15T06:10:00.000Z",
  });
}

const navigation: PublicPageNavigationResult = {
  requestedUrl: "https://www.globalsources.com/",
  finalUrl: "https://www.globalsources.com/",
  redirectOrigins: [],
  redirectCount: 0,
  mainDocumentHttpStatus: 200,
  mainDocumentContentType: "text/html; charset=utf-8",
  navigationElapsedMs: 400,
  domWaitElapsedMs: 100,
  readyState: "complete",
  allowedFinalOrigin: true,
};

const signals: GlobalSourcesDiscoveryDomSignals = {
  pageUrl: "https://www.globalsources.com/",
  title: "Global Sources - Product Search",
  visibleTextLength: 5000,
  brandMarker: true,
  brandTitleMarker: true,
  searchFormMarker: true,
  searchInputMarker: true,
  registrationMarker: false,
  loginMarker: false,
  captchaMarker: false,
  accessDeniedMarker: false,
  serviceUnavailableMarker: false,
  candidateSearchLinks: ["https://www.globalsources.com/search?q=closet"],
};

const cleanupOk: HumanAssistedBrowserCleanup = {
  pageClosed: true,
  browserClosed: true,
  forcedTerminationUsed: false,
  debugPortReleased: true,
  profileRemoved: true,
  browserProcessBaselineRestored: true,
};

function fakeSession(input?: {
  navigation?: PublicPageNavigationResult;
  signals?: GlobalSourcesDiscoveryDomSignals;
  evaluateError?: Error;
  cleanup?: HumanAssistedBrowserCleanup;
}) {
  let count = 0;
  const close = vi.fn(async () => input?.cleanup ?? cleanupOk);
  const session: IsolatedPublicBrowserSession = {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/test",
    profileId: "temporary-profile-test",
    profileLocationType: "system_temp",
    debugPort: 49152,
    get navigationCount() { return count; },
    navigate: vi.fn(async () => {
      count += 1;
      return input?.navigation ?? navigation;
    }),
    evaluateDomByValue: vi.fn(async () => {
      if (input?.evaluateError) throw input.evaluateError;
      return (input?.signals ?? signals) as never;
    }),
    close,
  };
  return { session, close };
}

function execute(overrides?: Partial<Parameters<typeof executeAuthorizedStage2GlobalSourcesDiscoveryR1>[0]>) {
  return executeAuthorizedStage2GlobalSourcesDiscoveryR1({
    brief: brief(),
    offlineValidation: offlineValidation(),
    authorizationRequest: authorizationRequest(),
    authorizationPhrase: GLOBAL_SOURCES_DISCOVERY_R1_AUTHORIZATION_PHRASE,
    capturedAt: "2026-07-15T06:20:00.000Z",
    fetchRobots: async () => ({
      body: "User-agent: *\nDisallow: /private",
      status: 200,
      contentType: "text/plain",
      finalUrl: "https://www.globalsources.com/robots.txt",
      elapsedMs: 30,
    }),
    openSession: async () => fakeSession().session,
    ...overrides,
  });
}

describe("Global Sources C1A-R1 controlled runner", () => {
  it("uses exactly one policy request and one homepage navigation on a ready page", async () => {
    const holder = fakeSession();
    const result = await execute({ openSession: async () => holder.session });
    expect(result.run).toMatchObject({
      schemaVersion: "stage2-global-sources-discovery-run.v1",
      status: "source_discovery_ready",
      errorCode: null,
      realWebsiteAccessed: true,
      navigationBudget: { maximum: 1, used: 1, searchPageNavigations: 0, productPageNavigations: 0, automaticRetryCount: 0 },
      supplierFieldsCollected: 0,
      stage2SubmissionGenerated: false,
      candidateGenerated: false,
      databaseWritten: false,
      externalAiOrPaidApiCalled: false,
    });
    expect(result.run.page?.candidateSearchPaths).toEqual(["/search"]);
    expect(holder.session.navigate).toHaveBeenCalledTimes(1);
    expect(holder.close).toHaveBeenCalledTimes(1);
    expect(result.authorization.consumption.status).toBe("consumed");
  });

  it("does not start the browser when robots disallows the homepage", async () => {
    const openSession = vi.fn(async () => fakeSession().session);
    const result = await execute({
      fetchRobots: async () => ({
        body: "User-agent: *\nDisallow: /", status: 200, contentType: "text/plain",
        finalUrl: "https://www.globalsources.com/robots.txt", elapsedMs: 30,
      }),
      openSession,
    });
    expect(result.run).toMatchObject({
      status: "failed_closed",
      errorCode: "policy_preflight_blocked",
      browserSessionStarted: false,
      realWebsiteAccessed: true,
    });
    expect(result.run.reasonCodes).toContain("robots_disallows_homepage");
    expect(openSession).not.toHaveBeenCalled();
  });

  it("fails closed on unknown page and still closes the owned session", async () => {
    const holder = fakeSession({ signals: { ...signals, brandMarker: false, brandTitleMarker: false } });
    const result = await execute({ openSession: async () => holder.session });
    expect(result.run).toMatchObject({ status: "failed_closed", errorCode: "unknown_page" });
    expect(holder.close).toHaveBeenCalledTimes(1);
  });

  it("closes the session after a DOM evaluation error", async () => {
    const holder = fakeSession({ evaluateError: new Error("DOM exploded with token=secret") });
    const result = await execute({ openSession: async () => holder.session });
    expect(result.run.status).toBe("failed_closed");
    expect(result.run.reasonCodes.join(" ")).not.toContain("secret");
    expect(holder.close).toHaveBeenCalledTimes(1);
  });

  it("overrides a ready page when owned browser cleanup is incomplete", async () => {
    const holder = fakeSession({ cleanup: { ...cleanupOk, profileRemoved: false } });
    const result = await execute({ openSession: async () => holder.session });
    expect(result.run).toMatchObject({ status: "failed_closed", errorCode: "browser_cleanup_failed" });
    expect(result.run.reasonCodes).toContain("owned_browser_resources_not_fully_restored");
  });
});
