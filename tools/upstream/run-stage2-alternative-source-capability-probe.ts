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
  buildStage2AlternativeSourceProbeAuthorizationGrant,
  consumeStage2AlternativeSourceProbeAuthorization,
  type Stage2AlternativeSourceProbeAuthorizationRequest,
} from "./stage2-alternative-source-probe-authorization";
import {
  buildStage2AlternativeSourceProbeReauthorizationGrant,
  consumeStage2AlternativeSourceProbeReauthorization,
  type Stage2AlternativeSourceProbeReauthorizationRequest,
} from "./stage2-alternative-source-probe-reauthorization";
import {
  buildMadeInChinaProbeDomExpression,
  buildStage2AlternativeSourcePolicyPreflight,
  classifyMadeInChinaProbePage,
  type MadeInChinaProbeDomSignals,
} from "./stage2-alternative-source-probe";
import {
  buildMadeInChinaUnknownPageDiagnostic,
  buildMadeInChinaUnknownPageDiagnosticDomExpression,
  type MadeInChinaUnknownPageDiagnosticDomSignals,
} from "./stage2-alternative-source-unknown-page-diagnostic";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";

type RobotsFetchResult = {
  body: string;
  status: number;
  contentType: string;
  finalUrl: string;
  elapsedMs: number;
};

type SessionFactory = (input: {
  allowedOrigins: readonly string[];
  maxNavigations: number;
  headless: boolean;
}) => Promise<IsolatedPublicBrowserSession>;

type ProbeAuthorizationRequest = Stage2AlternativeSourceProbeAuthorizationRequest
  | Stage2AlternativeSourceProbeReauthorizationRequest;

const cleanError = (error: unknown): string => {
  const value = error instanceof Error ? error.message : "unknown_runtime_error";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
    || "unknown_runtime_error";
};

const cleanupPassed = (cleanup: HumanAssistedBrowserCleanup | null): cleanup is HumanAssistedBrowserCleanup =>
  cleanup !== null && cleanup.pageClosed && cleanup.browserClosed && cleanup.debugPortReleased
  && cleanup.profileRemoved && cleanup.browserProcessBaselineRestored;

function jsonContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateTermsResearch(value: unknown, brief: Stage2AlternativeSourceBrief): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_RESEARCH_INVALID");
  }
  const research = value as Record<string, unknown>;
  const evidenceHash = typeof research.evidenceHash === "string" ? research.evidenceHash : "";
  const { evidenceHash: _hash, ...body } = research;
  const candidates = Array.isArray(research.candidates) ? research.candidates : [];
  const selected = candidates.find((candidate) => typeof candidate === "object" && candidate !== null
    && (candidate as Record<string, unknown>).platform === "made_in_china") as Record<string, unknown> | undefined;
  const officialEvidence = Array.isArray(selected?.officialEvidence) ? selected.officialEvidence : [];
  const termsReviewed = officialEvidence.some((item) => typeof item === "object" && item !== null
    && (item as Record<string, unknown>).url === brief.policyPreflight.termsUrl);
  if (!/^[a-f0-9]{64}$/.test(evidenceHash) || stableHash(body) !== evidenceHash
    || research.selectedPlatform !== "made_in_china"
    || research.selectedOrigin !== brief.sourceDecision.selectedOrigin || !termsReviewed) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_RESEARCH_INVALID");
  }
  return evidenceHash;
}

async function fetchRobotsOnce(url: string): Promise<RobotsFetchResult> {
  const expected = new URL(url);
  if (expected.protocol !== "https:" || expected.username || expected.password || expected.port
    || expected.pathname !== "/robots.txt" || expected.search || expected.hash) {
    throw new Error("ROBOTS_REQUEST_URL_INVALID");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { Accept: "text/plain" },
      credentials: "omit",
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status !== 200) throw new Error(`ROBOTS_HTTP_STATUS_${response.status}`);
    if (response.url !== url || response.redirected) throw new Error("ROBOTS_REDIRECT_NOT_ALLOWED");
    if (!contentType.toLowerCase().includes("text/plain")) throw new Error("ROBOTS_CONTENT_TYPE_INVALID");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 262_144) throw new Error("ROBOTS_BODY_TOO_LARGE");
    return {
      body: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      status: response.status,
      contentType: contentType.slice(0, 120),
      finalUrl: response.url,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeAuthorizedStage2AlternativeSourceCapabilityProbe(input: {
  brief: Stage2AlternativeSourceBrief;
  offlineValidation: Record<string, unknown>;
  authorizationRequest: ProbeAuthorizationRequest;
  priorAuthorization?: Record<string, unknown>;
  priorRun?: Record<string, unknown>;
  unknownPageDiagnosticValidation?: Record<string, unknown>;
  authorizationPhrase: string;
  capturedAt: string;
  termsEvidenceHash: string;
  fetchRobots: (url: string) => Promise<RobotsFetchResult>;
  openSession: SessionFactory;
}) {
  if (!Number.isFinite(Date.parse(input.capturedAt)) || !/^[a-f0-9]{64}$/.test(input.termsEvidenceHash)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_CAPABILITY_PROBE_INPUT_INVALID");
  }
  const isReauthorization = input.authorizationRequest.schemaVersion
    === "stage2-alternative-source-capability-probe-authorization-request.v2";
  if (isReauthorization && (!input.priorAuthorization || !input.priorRun
    || !input.unknownPageDiagnosticValidation)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_EVIDENCE_REQUIRED");
  }
  const grant = input.authorizationRequest.schemaVersion
    === "stage2-alternative-source-capability-probe-authorization-request.v2"
    ? buildStage2AlternativeSourceProbeReauthorizationGrant({
      request: input.authorizationRequest,
      brief: input.brief,
      baselineOfflineValidation: input.offlineValidation,
      priorAuthorization: input.priorAuthorization!,
      priorRun: input.priorRun!,
      unknownPageDiagnosticValidation: input.unknownPageDiagnosticValidation!,
      authorizationPhrase: input.authorizationPhrase,
      authorizedAt: input.capturedAt,
    })
    : buildStage2AlternativeSourceProbeAuthorizationGrant({
      request: input.authorizationRequest,
      brief: input.brief,
      offlineValidation: input.offlineValidation,
      authorizationPhrase: input.authorizationPhrase,
      authorizedAt: input.capturedAt,
    });
  const runId = `stage2-alternative-real-${stableHash({
    authorizationEvidenceHash: grant.evidenceHash,
    capturedAt: input.capturedAt,
  }).slice(0, 24)}`;
  const authorization = isReauthorization
    ? consumeStage2AlternativeSourceProbeReauthorization({
      authorization: grant as ReturnType<typeof buildStage2AlternativeSourceProbeReauthorizationGrant>,
      consumedAt: input.capturedAt,
      runId,
    })
    : consumeStage2AlternativeSourceProbeAuthorization({
      authorization: grant as ReturnType<typeof buildStage2AlternativeSourceProbeAuthorizationGrant>,
      consumedAt: input.capturedAt,
      runId,
    });

  let robotsResult: RobotsFetchResult | null = null;
  let robotsError: string | null = null;
  try {
    robotsResult = await input.fetchRobots(input.authorizationRequest.policyRequest.url);
    if (robotsResult.finalUrl !== input.authorizationRequest.policyRequest.url
      || robotsResult.status !== 200
      || !robotsResult.contentType.toLowerCase().includes("text/plain")) {
      throw new Error("ROBOTS_RESPONSE_NOT_ACCEPTABLE");
    }
  } catch (error) {
    robotsError = cleanError(error);
    robotsResult = null;
  }
  const policyRequestBody = {
    schemaVersion: "stage2-alternative-source-robots-request.v1" as const,
    requestUrlOrigin: new URL(input.authorizationRequest.policyRequest.url).origin,
    requestUrlPath: new URL(input.authorizationRequest.policyRequest.url).pathname,
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
  const policyPreflight = buildStage2AlternativeSourcePolicyPreflight({
    brief: input.brief,
    robotsText: robotsResult?.body ?? "",
    termsDecision: "reviewed_allows_public_capability_probe",
    evaluatedAt: input.capturedAt,
    requestCount: 1,
  });

  let session: IsolatedPublicBrowserSession | null = null;
  let cleanup: HumanAssistedBrowserCleanup | null = null;
  let page: ReturnType<typeof classifyMadeInChinaProbePage> | null = null;
  let unknownPageDiagnostic: ReturnType<typeof buildMadeInChinaUnknownPageDiagnostic> | null = null;
  let browserSessionStarted = false;
  let navigationUsed = 0;
  let status: "capability_ready" | "failed_closed" = "failed_closed";
  let errorCode: string | null = "policy_preflight_blocked";
  let reasonCodes = [...policyPreflight.reasonCodes, ...(robotsError ? [robotsError] : [])];

  if (policyPreflight.status === "allowed" && robotsError === null) {
    try {
      session = await input.openSession({
        allowedOrigins: [input.brief.sourceDecision.selectedOrigin],
        maxNavigations: 1,
        headless: false,
      });
      browserSessionStarted = true;
      const navigation = await session.navigate(input.brief.search.startUrl);
      navigationUsed = session.navigationCount;
      const domSignals = await session.evaluateDomByValue<MadeInChinaProbeDomSignals>(
        buildMadeInChinaProbeDomExpression(),
      );
      page = classifyMadeInChinaProbePage({ brief: input.brief, navigation, signals: domSignals });
      if (page.classification === "unknown_page") {
        const diagnosticSignals = await session.evaluateDomByValue<MadeInChinaUnknownPageDiagnosticDomSignals>(
          buildMadeInChinaUnknownPageDiagnosticDomExpression(),
        );
        unknownPageDiagnostic = buildMadeInChinaUnknownPageDiagnostic({
          brief: input.brief,
          navigation,
          parentClassification: page.classification,
          parentPageInputHash: page.inputHash,
          signals: diagnosticSignals,
        });
      }
      if (page.classification === "search_results_ready") {
        status = "capability_ready";
        errorCode = null;
        reasonCodes = [];
      } else {
        errorCode = page.classification;
        reasonCodes = [...page.classificationReasonCodes];
      }
    } catch (error) {
      navigationUsed = session?.navigationCount ?? navigationUsed;
      errorCode = "browser_or_navigation_failed";
      reasonCodes = [cleanError(error)];
      const failureCleanup = error && typeof error === "object" && "cleanup" in error
        ? (error as { cleanup?: HumanAssistedBrowserCleanup }).cleanup : undefined;
      if (failureCleanup) cleanup = failureCleanup;
    } finally {
      navigationUsed = session?.navigationCount ?? navigationUsed;
      if (session) {
        try { cleanup = await session.close(); }
        catch (error) {
          cleanup = null;
          errorCode = "browser_cleanup_failed";
          reasonCodes = [...reasonCodes, cleanError(error)];
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
    errorCode = "request_budget_exhausted";
    reasonCodes.push("authorized_external_action_budget_exhausted");
  }
  const runBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-run.v3" as const,
    runId,
    proofLevel: "real_public_capability_probe" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    policyRequestInputHash: policyRequest.inputHash,
    policyPreflightInputHash: policyPreflight.inputHash,
    termsEvidenceHash: input.termsEvidenceHash,
    capturedAt: input.capturedAt,
    status,
    errorCode,
    reasonCodes: [...new Set(reasonCodes)],
    realWebsiteAccessed: true as const,
    browserSessionStarted,
    navigationBudget: {
      maximum: 1 as const,
      used: navigationUsed,
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
    unknownPageDiagnostic,
    allowedProductUrls: status === "capability_ready" ? [...(page?.allowedProductUrls ?? [])].slice(0, 2) : [],
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    cleanup,
  };
  const run = { ...runBody, evidenceHash: stableHash(runBody) };
  const summaryBody = {
    schemaVersion: "stage2-alternative-source-capability-probe-summary.v2" as const,
    runId,
    runEvidenceHash: run.evidenceHash,
    authorizationEvidenceHash: authorization.evidenceHash,
    status,
    errorCode,
    unknownPageDiagnosticInputHash: unknownPageDiagnostic?.inputHash ?? null,
    policyRequests: 1 as const,
    searchPageNavigations: navigationUsed,
    productPageNavigations: 0 as const,
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

export async function runAuthorizedStage2AlternativeSourceCapabilityProbe(input: {
  briefFile: string;
  offlineValidationFile: string;
  authorizationRequestFile: string;
  priorAuthorizationFile?: string;
  priorRunFile?: string;
  unknownPageDiagnosticValidationFile?: string;
  researchFile: string;
  outputDirectory: string;
  authorizationPhrase: string;
  capturedAt: string;
}) {
  const outputDirectory = resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_CAPABILITY_PROBE_OUTPUT_ALREADY_EXISTS");
  }
  const brief = JSON.parse(readFileSync(resolve(input.briefFile), "utf8")) as Stage2AlternativeSourceBrief;
  const offlineValidation = JSON.parse(readFileSync(resolve(input.offlineValidationFile), "utf8")) as Record<string, unknown>;
  const authorizationRequest = JSON.parse(readFileSync(
    resolve(input.authorizationRequestFile), "utf8",
  )) as ProbeAuthorizationRequest;
  const isReauthorization = authorizationRequest.schemaVersion
    === "stage2-alternative-source-capability-probe-authorization-request.v2";
  if (isReauthorization && (!input.priorAuthorizationFile || !input.priorRunFile
    || !input.unknownPageDiagnosticValidationFile)) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_REAUTHORIZATION_EVIDENCE_FILES_REQUIRED");
  }
  const priorAuthorization = isReauthorization
    ? JSON.parse(readFileSync(resolve(input.priorAuthorizationFile!), "utf8")) as Record<string, unknown>
    : undefined;
  const priorRun = isReauthorization
    ? JSON.parse(readFileSync(resolve(input.priorRunFile!), "utf8")) as Record<string, unknown>
    : undefined;
  const unknownPageDiagnosticValidation = isReauthorization
    ? JSON.parse(readFileSync(resolve(input.unknownPageDiagnosticValidationFile!), "utf8")) as Record<string, unknown>
    : undefined;
  const research = JSON.parse(readFileSync(resolve(input.researchFile), "utf8")) as unknown;
  const termsEvidenceHash = validateTermsResearch(research, brief);
  const browser = resolveSystemBrowser();
  if (!browser || browser.browser !== "chrome") throw new Error("STAGE2_ALTERNATIVE_SOURCE_SYSTEM_CHROME_NOT_FOUND");
  const result = await executeAuthorizedStage2AlternativeSourceCapabilityProbe({
    brief,
    offlineValidation,
    authorizationRequest,
    priorAuthorization,
    priorRun,
    unknownPageDiagnosticValidation,
    authorizationPhrase: input.authorizationPhrase,
    capturedAt: input.capturedAt,
    termsEvidenceHash,
    fetchRobots: fetchRobotsOnce,
    openSession: (sessionInput) => openIsolatedPublicBrowserSession({ browser, ...sessionInput }),
  });
  const artifactWrite = writeArtifactsIdempotently(outputDirectory, [
    { relativePath: `stage2-alternative-source-capability-probe-authorization.${isReauthorization ? "v2" : "v1"}.json`, content: jsonContent(result.authorization) },
    { relativePath: "stage2-alternative-source-robots-request.v1.json", content: jsonContent(result.policyRequest) },
    { relativePath: "stage2-alternative-source-policy-preflight.v1.json", content: jsonContent(result.policyPreflight) },
    { relativePath: "stage2-alternative-source-capability-probe-run.v3.json", content: jsonContent(result.run) },
    { relativePath: "generation-summary.stage2-alternative-source-capability-probe.v2.json", content: jsonContent(result.summary) },
  ], "STAGE2_ALTERNATIVE_SOURCE_CAPABILITY_PROBE_OUTPUT_CONFLICT");
  return { ...result, artifactWrite };
}
