import { stableHash } from "../../lib/upstream/pipeline";
import type {
  HumanAssistedBrowserCleanup,
  IsolatedPublicBrowserSession,
} from "../collectors/amazon/browser-control";
import {
  buildMadeInChinaProbeDomExpression,
  classifyMadeInChinaProbePage,
  type MadeInChinaProbeDomSignals,
  type Stage2AlternativeSourcePolicyPreflight,
} from "./stage2-alternative-source-probe";
import {
  validateStage2AlternativeSourceBrief,
  type Stage2AlternativeSourceBrief,
} from "./stage2-alternative-source-brief";

type OfflineProbeSessionFactory = (input: {
  allowedOrigins: readonly string[];
  maxNavigations: number;
  headless: boolean;
}) => Promise<{
  kind: "offline_fixture";
  session: IsolatedPublicBrowserSession;
}>;

function validCleanup(cleanup: HumanAssistedBrowserCleanup | null): cleanup is HumanAssistedBrowserCleanup {
  return cleanup !== null
    && cleanup.pageClosed
    && cleanup.browserClosed
    && cleanup.debugPortReleased
    && cleanup.profileRemoved
    && cleanup.browserProcessBaselineRestored;
}

function validatePolicyPreflight(
  brief: Stage2AlternativeSourceBrief,
  preflight: Stage2AlternativeSourcePolicyPreflight,
): void {
  const { inputHash, ...body } = preflight;
  const semanticAllowed = preflight.robotsDecision === "allowed"
    && preflight.termsDecision === "reviewed_allows_public_capability_probe"
    && preflight.reasonCodes.length === 0;
  if (stableHash(body) !== inputHash
    || preflight.schemaVersion !== "stage2-alternative-source-policy-preflight.v1"
    || preflight.briefId !== brief.briefId
    || preflight.briefHash !== brief.briefHash
    || preflight.requestCount !== 1
    || preflight.requestCount > brief.requestedScope.maxPolicyRequests
    || (preflight.status === "allowed") !== semanticAllowed) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_POLICY_PREFLIGHT_INVALID");
  }
}

function boundedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "unknown_runtime_error";
  return raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
    || "unknown_runtime_error";
}

function buildProbeRun(input: {
  brief: Stage2AlternativeSourceBrief;
  policyPreflight: Stage2AlternativeSourcePolicyPreflight;
  capturedAt: string;
  status: "capability_ready" | "failed_closed";
  errorCode: string | null;
  reasonCodes: string[];
  browserSessionStarted: boolean;
  navigationUsed: number;
  page: ReturnType<typeof classifyMadeInChinaProbePage> | null;
  cleanup: HumanAssistedBrowserCleanup | null;
}) {
  const inputHash = stableHash({
    briefHash: input.brief.briefHash,
    policyPreflightInputHash: input.policyPreflight.inputHash,
    capturedAt: input.capturedAt,
    pageInputHash: input.page?.inputHash ?? null,
    cleanup: input.cleanup,
  });
  const body = {
    schemaVersion: "stage2-alternative-source-capability-probe-run.v1" as const,
    probeId: `stage2-alternative-probe-${stableHash({
      briefHash: input.brief.briefHash,
      policyPreflightInputHash: input.policyPreflight.inputHash,
      capturedAt: input.capturedAt,
    }).slice(0, 24)}`,
    proofLevel: "offline_fixture_only" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    capturedAt: input.capturedAt,
    status: input.status,
    errorCode: input.errorCode,
    reasonCodes: [...new Set(input.reasonCodes)],
    policyPreflightInputHash: input.policyPreflight.inputHash,
    realWebsiteAccessed: false as const,
    browserSessionStarted: input.browserSessionStarted,
    navigationBudget: {
      maximum: input.brief.requestedScope.maxTotalNavigations,
      used: input.navigationUsed,
      automaticRetryCount: input.brief.requestedScope.automaticRetryCount,
    },
    externalRequestBudget: {
      maximum: input.brief.requestedScope.maxTotalExternalRequests,
      policyUsed: input.policyPreflight.requestCount,
      navigationUsed: input.navigationUsed,
      totalUsed: input.policyPreflight.requestCount + input.navigationUsed,
    },
    page: input.page,
    allowedProductUrls: input.status === "capability_ready" ? [...(input.page?.allowedProductUrls ?? [])] : [],
    supplierFieldsCollected: 0 as const,
    stage2SubmissionGenerated: false as const,
    candidateGenerated: false as const,
    databaseWritten: false as const,
    externalAiOrPaidApiCalled: false as const,
    cleanup: input.cleanup,
    inputHash,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export async function runOfflineStage2AlternativeSourceCapabilityProbe(input: {
  brief: Stage2AlternativeSourceBrief;
  policyPreflight: Stage2AlternativeSourcePolicyPreflight;
  capturedAt: string;
  openSession: OfflineProbeSessionFactory;
}) {
  if (validateStage2AlternativeSourceBrief(input.brief).status !== "valid_pending_authorization") {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_BRIEF_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new Error("STAGE2_ALTERNATIVE_SOURCE_PROBE_CAPTURED_AT_INVALID");
  }
  validatePolicyPreflight(input.brief, input.policyPreflight);
  if (input.policyPreflight.status !== "allowed") {
    return buildProbeRun({
      brief: input.brief,
      policyPreflight: input.policyPreflight,
      capturedAt: input.capturedAt,
      status: "failed_closed",
      errorCode: "policy_preflight_blocked",
      reasonCodes: input.policyPreflight.reasonCodes,
      browserSessionStarted: false,
      navigationUsed: 0,
      page: null,
      cleanup: null,
    });
  }

  let session: IsolatedPublicBrowserSession | null = null;
  let page: ReturnType<typeof classifyMadeInChinaProbePage> | null = null;
  let cleanup: HumanAssistedBrowserCleanup | null = null;
  let status: "capability_ready" | "failed_closed" = "failed_closed";
  let errorCode: string | null = "run_not_completed";
  let reasonCodes = ["run_not_completed"];
  let browserSessionStarted = false;
  let navigationUsed = 0;

  try {
    const opened = await input.openSession({
      allowedOrigins: [...input.brief.requestedScope.allowedOrigins],
      maxNavigations: input.brief.requestedScope.maxTotalNavigations,
      headless: false,
    });
    session = opened.session;
    browserSessionStarted = true;
    if (opened.kind !== "offline_fixture") throw new Error("OFFLINE_FIXTURE_SESSION_REQUIRED");
    const navigation = await session.navigate(input.brief.search.startUrl);
    navigationUsed = session.navigationCount;
    const signals = await session.evaluateDomByValue<MadeInChinaProbeDomSignals>(
      buildMadeInChinaProbeDomExpression(),
    );
    page = classifyMadeInChinaProbePage({ brief: input.brief, navigation, signals });
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
    reasonCodes = [boundedError(error)];
    const failureCleanup = error && typeof error === "object" && "cleanup" in error
      ? (error as { cleanup?: HumanAssistedBrowserCleanup }).cleanup
      : undefined;
    if (failureCleanup) cleanup = failureCleanup;
  } finally {
    navigationUsed = session?.navigationCount ?? navigationUsed;
    if (session) {
      try {
        cleanup = await session.close();
      } catch (error) {
        cleanup = null;
        status = "failed_closed";
        errorCode = "browser_cleanup_failed";
        reasonCodes = [...reasonCodes, boundedError(error)];
      }
    }
  }

  if (browserSessionStarted && !validCleanup(cleanup)) {
    status = "failed_closed";
    errorCode = "browser_cleanup_failed";
    reasonCodes = [...reasonCodes, "owned_browser_resources_not_fully_restored"];
  }
  if (navigationUsed > input.brief.requestedScope.maxTotalNavigations
    || input.policyPreflight.requestCount + navigationUsed > input.brief.requestedScope.maxTotalExternalRequests) {
    status = "failed_closed";
    errorCode = "request_budget_exhausted";
    reasonCodes = [...reasonCodes, "requested_external_request_budget_exhausted"];
  }

  return buildProbeRun({
    brief: input.brief,
    policyPreflight: input.policyPreflight,
    capturedAt: input.capturedAt,
    status,
    errorCode,
    reasonCodes,
    browserSessionStarted,
    navigationUsed,
    page,
    cleanup,
  });
}
