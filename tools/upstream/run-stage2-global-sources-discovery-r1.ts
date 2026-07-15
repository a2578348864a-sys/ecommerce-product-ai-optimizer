import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  openIsolatedPublicBrowserSession,
  resolveSystemBrowser,
  type HumanAssistedBrowserCleanup,
  type IsolatedPublicBrowserSession,
} from "../collectors/amazon/browser-control";
import { writeArtifactsIdempotently } from "./artifact-writer";
import {
  fetchGlobalSourcesRobotsOnce,
  type GlobalSourcesRobotsFetchResult,
} from "./global-sources-robots-request";
import {
  buildGlobalSourcesDiscoveryDomExpression,
  buildGlobalSourcesPolicyPreflight,
  classifyGlobalSourcesDiscoveryPage,
  GLOBAL_SOURCES_HOMEPAGE_URL,
  GLOBAL_SOURCES_ORIGIN,
  GLOBAL_SOURCES_ROBOTS_URL,
  type GlobalSourcesDiscoveryDomSignals,
  type Stage2GlobalSourcesDiscoveryBriefR1,
} from "./stage2-global-sources-discovery-r1";
import {
  buildStage2GlobalSourcesDiscoveryAuthorizationGrant,
  consumeStage2GlobalSourcesDiscoveryAuthorization,
  type Stage2GlobalSourcesDiscoveryAuthorizationRequest,
} from "./stage2-global-sources-discovery-r1-authorization";

type SessionFactory = (input: {
  allowedOrigins: readonly string[];
  maxNavigations: number;
  headless: boolean;
}) => Promise<IsolatedPublicBrowserSession>;

const cleanError = (error: unknown): string => {
  const value = error instanceof Error ? error.message : "unknown_runtime_error";
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\b(?:token|authorization|password)\s*[:=]\s*\S+/gi, "[redacted-sensitive]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200) || "unknown_runtime_error";
};

const cleanupPassed = (cleanup: HumanAssistedBrowserCleanup | null): cleanup is HumanAssistedBrowserCleanup =>
  cleanup !== null && cleanup.pageClosed && cleanup.browserClosed && cleanup.debugPortReleased
  && cleanup.profileRemoved && cleanup.browserProcessBaselineRestored;

const jsonContent = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export async function executeAuthorizedStage2GlobalSourcesDiscoveryR1(input: {
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  offlineValidation: Record<string, unknown>;
  authorizationRequest: Stage2GlobalSourcesDiscoveryAuthorizationRequest;
  authorizationPhrase: string;
  capturedAt: string;
  fetchRobots: (url: string) => Promise<GlobalSourcesRobotsFetchResult>;
  openSession: SessionFactory;
}) {
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_CAPTURED_AT_INVALID");
  }
  const grant = buildStage2GlobalSourcesDiscoveryAuthorizationGrant({
    request: input.authorizationRequest,
    brief: input.brief,
    offlineValidation: input.offlineValidation,
    authorizationPhrase: input.authorizationPhrase,
    authorizedAt: input.capturedAt,
  });
  const runId = `stage2-global-sources-discovery-real-${stableHash({
    authorizationEvidenceHash: grant.evidenceHash,
    capturedAt: input.capturedAt,
  }).slice(0, 24)}`;
  const authorization = consumeStage2GlobalSourcesDiscoveryAuthorization({
    authorization: grant,
    consumedAt: input.capturedAt,
    runId,
  });

  let robotsResult: GlobalSourcesRobotsFetchResult | null = null;
  let robotsError: string | null = null;
  try {
    robotsResult = await input.fetchRobots(input.authorizationRequest.policyRequest.url);
    if (robotsResult.finalUrl !== GLOBAL_SOURCES_ROBOTS_URL || robotsResult.status !== 200
      || !robotsResult.contentType.toLowerCase().includes("text/plain")) {
      throw new Error("ROBOTS_RESPONSE_NOT_ACCEPTABLE");
    }
  } catch (error) {
    robotsError = cleanError(error);
    robotsResult = null;
  }
  const policyRequestBody = {
    schemaVersion: "stage2-global-sources-robots-request.v1" as const,
    requestUrlOrigin: GLOBAL_SOURCES_ORIGIN,
    requestUrlPath: "/robots.txt" as const,
    requestCount: 1 as const,
    finalUrlOrigin: robotsResult ? new URL(robotsResult.finalUrl).origin : null,
    finalUrlPath: robotsResult ? new URL(robotsResult.finalUrl).pathname : null,
    httpStatus: robotsResult?.status ?? null,
    contentType: robotsResult?.contentType ?? null,
    bodyByteLength: robotsResult ? new TextEncoder().encode(robotsResult.body).byteLength : null,
    bodyHash: robotsResult ? stableHash(robotsResult.body) : null,
    elapsedMs: robotsResult?.elapsedMs ?? null,
    errorCode: robotsError,
    responseBodyStored: false as const,
  };
  const policyRequest = { ...policyRequestBody, inputHash: stableHash(policyRequestBody) };
  const policyPreflight = buildGlobalSourcesPolicyPreflight({
    brief: input.brief,
    robotsText: robotsResult?.body ?? "",
    evaluatedAt: input.capturedAt,
    requestCount: 1,
  });

  let session: IsolatedPublicBrowserSession | null = null;
  let cleanup: HumanAssistedBrowserCleanup | null = null;
  let page: ReturnType<typeof classifyGlobalSourcesDiscoveryPage> | null = null;
  let browserSessionStarted = false;
  let navigationUsed = 0;
  let status: "source_discovery_ready" | "failed_closed" = "failed_closed";
  let errorCode: string | null = "policy_preflight_blocked";
  let reasonCodes = [...policyPreflight.reasonCodes, ...(robotsError ? [robotsError] : [])];

  if (policyPreflight.status === "allowed" && robotsError === null) {
    try {
      session = await input.openSession({
        allowedOrigins: [GLOBAL_SOURCES_ORIGIN],
        maxNavigations: 1,
        headless: false,
      });
      browserSessionStarted = true;
      const navigation = await session.navigate(GLOBAL_SOURCES_HOMEPAGE_URL);
      navigationUsed = session.navigationCount;
      const domSignals = await session.evaluateDomByValue<GlobalSourcesDiscoveryDomSignals>(
        buildGlobalSourcesDiscoveryDomExpression(),
      );
      page = classifyGlobalSourcesDiscoveryPage({ brief: input.brief, navigation, signals: domSignals });
      if (page.classification === "homepage_discovery_ready") {
        status = "source_discovery_ready";
        errorCode = null;
        reasonCodes = [];
      } else {
        errorCode = page.classification;
        reasonCodes = [...page.classificationReasonCodes];
      }
    } catch (error) {
      status = "failed_closed";
      errorCode = "browser_runtime_failed";
      reasonCodes = [cleanError(error)];
    } finally {
      if (session) {
        navigationUsed = session.navigationCount;
        try {
          cleanup = await session.close();
        } catch (error) {
          cleanup = null;
          reasonCodes.push(cleanError(error));
        }
      }
    }
  }

  if (browserSessionStarted && !cleanupPassed(cleanup)) {
    status = "failed_closed";
    errorCode = "browser_cleanup_failed";
    reasonCodes.push("owned_browser_resources_not_fully_restored");
  }
  if (navigationUsed > 1 || 1 + navigationUsed > 2) {
    status = "failed_closed";
    errorCode = "external_action_budget_exhausted";
    reasonCodes.push("authorized_external_action_budget_exhausted");
  }
  const runBody = {
    schemaVersion: "stage2-global-sources-discovery-run.v1" as const,
    runId,
    proofLevel: "real_public_homepage_source_discovery" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    policyRequestInputHash: policyRequest.inputHash,
    policyPreflightInputHash: policyPreflight.inputHash,
    capturedAt: input.capturedAt,
    status,
    errorCode,
    reasonCodes: [...new Set(reasonCodes)],
    realWebsiteAccessed: true as const,
    browserSessionStarted,
    navigationBudget: {
      maximum: 1 as const,
      used: navigationUsed,
      homepageNavigations: navigationUsed,
      searchPageNavigations: 0 as const,
      productPageNavigations: 0 as const,
      automaticRetryCount: 0 as const,
    },
    externalActionBudget: {
      countingUnit: "top_level_policy_request_and_main_frame_navigation" as const,
      maximum: 2 as const,
      policyUsed: 1 as const,
      navigationUsed,
      totalUsed: 1 + navigationUsed,
    },
    page,
    candidateSearchPaths: status === "source_discovery_ready" ? [...(page?.candidateSearchPaths ?? [])].slice(0, 5) : [],
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    cleanup,
  };
  const run = { ...runBody, evidenceHash: stableHash(runBody) };
  const summaryBody = {
    schemaVersion: "stage2-global-sources-discovery-summary.v1" as const,
    runId,
    runEvidenceHash: run.evidenceHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    status,
    errorCode,
    policyRequests: 1 as const,
    homepageNavigations: navigationUsed,
    searchPageNavigations: 0 as const,
    productPageNavigations: 0 as const,
    candidateSearchPathCount: run.candidateSearchPaths.length,
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
  };
  return {
    authorization,
    policyRequest,
    policyPreflight,
    run,
    summary: { ...summaryBody, evidenceHash: stableHash(summaryBody) },
  };
}

export async function runAuthorizedStage2GlobalSourcesDiscoveryR1(input: {
  briefFile: string;
  offlineValidationFile: string;
  authorizationRequestFile: string;
  outputDirectory: string;
  authorizationPhrase: string;
  capturedAt: string;
}) {
  const outputDirectory = resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_OUTPUT_ALREADY_EXISTS");
  }
  const brief = JSON.parse(readFileSync(resolve(input.briefFile), "utf8")) as Stage2GlobalSourcesDiscoveryBriefR1;
  const offlineValidation = JSON.parse(readFileSync(resolve(input.offlineValidationFile), "utf8")) as Record<string, unknown>;
  const authorizationRequest = JSON.parse(readFileSync(
    resolve(input.authorizationRequestFile), "utf8",
  )) as Stage2GlobalSourcesDiscoveryAuthorizationRequest;
  const browser = resolveSystemBrowser();
  if (!browser || browser.browser !== "chrome") throw new Error("STAGE2_GLOBAL_SOURCES_R1_SYSTEM_CHROME_NOT_FOUND");
  const result = await executeAuthorizedStage2GlobalSourcesDiscoveryR1({
    brief,
    offlineValidation,
    authorizationRequest,
    authorizationPhrase: input.authorizationPhrase,
    capturedAt: input.capturedAt,
    fetchRobots: fetchGlobalSourcesRobotsOnce,
    openSession: (sessionInput) => openIsolatedPublicBrowserSession({ browser, ...sessionInput }),
  });
  const artifactWrite = writeArtifactsIdempotently(outputDirectory, [
    { relativePath: "stage2-global-sources-discovery-authorization.v1.json", content: jsonContent(result.authorization) },
    { relativePath: "stage2-global-sources-robots-request.v1.json", content: jsonContent(result.policyRequest) },
    { relativePath: "stage2-global-sources-policy-preflight.v1.json", content: jsonContent(result.policyPreflight) },
    { relativePath: "stage2-global-sources-discovery-run.v1.json", content: jsonContent(result.run) },
    { relativePath: "generation-summary.stage2-global-sources-discovery.v1.json", content: jsonContent(result.summary) },
  ], "STAGE2_GLOBAL_SOURCES_R1_OUTPUT_CONFLICT");
  return { ...result, artifactWrite };
}
