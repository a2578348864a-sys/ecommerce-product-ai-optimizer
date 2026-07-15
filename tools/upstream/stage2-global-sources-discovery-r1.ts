import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";

const SHA256 = /^[a-f0-9]{64}$/;
export const GLOBAL_SOURCES_ORIGIN = "https://www.globalsources.com" as const;
export const GLOBAL_SOURCES_HOMEPAGE_URL = "https://www.globalsources.com/" as const;
export const GLOBAL_SOURCES_ROBOTS_URL = "https://www.globalsources.com/robots.txt" as const;
const GLOBAL_SOURCES_HELP_ORIGIN = "https://s.globalsources.com" as const;
const GLOBAL_SOURCES_HELP_PATH = "/HELP/GSOLHELP/SUPPTIP.HTM" as const;
const GLOBAL_SOURCES_DISCOVERY_R1_STOP_CONDITIONS = [
  "robots_policy_unknown_or_disallows",
  "unexpected_final_origin_or_path",
  "unexpected_redirect",
  "login_or_registration_required",
  "captcha_or_robot_check",
  "access_denied_or_service_unavailable",
  "browser_internal_error",
  "unknown_page_state",
  "external_action_budget_exhausted",
  "cleanup_incomplete",
] as const;

type EvidenceRecord = Record<string, unknown>;

export type Stage2GlobalSourcesDiscoveryBriefR1 = {
  schemaVersion: "stage2-global-sources-discovery-brief.v2";
  briefId: string;
  status: "pending_user_authorization";
  createdAt: string;
  selectedPlatform: "global_sources";
  selectedOrigin: typeof GLOBAL_SOURCES_ORIGIN;
  purpose: "public_homepage_source_discovery_only";
  successorOf: {
    historicalBriefId: string;
    historicalBriefHash: string;
    selectionId: string;
    selectionHash: string;
    revisionReason: "close_cross_origin_robots_scope_and_add_runtime_gates";
  };
  policyPreflight: {
    robotsUrl: typeof GLOBAL_SOURCES_ROBOTS_URL;
    robotsStatus: "unknown_pending_runtime_check";
    robotsUnknownOrDisallowsBlocksNavigation: true;
  };
  homepage: {
    origin: typeof GLOBAL_SOURCES_ORIGIN;
    path: "/";
    url: typeof GLOBAL_SOURCES_HOMEPAGE_URL;
  };
  offlineReference: {
    origin: typeof GLOBAL_SOURCES_HELP_ORIGIN;
    path: typeof GLOBAL_SOURCES_HELP_PATH;
    evidenceClass: "offline_reference_only";
    liveNavigationAllowed: false;
  };
  requestedScope: {
    maxRobotsRequests: 1;
    maxHomepageNavigations: 1;
    maxSearchPageNavigations: 0;
    maxProductPageNavigations: 0;
    maxTotalExternalActions: 2;
    maxSupplierFields: 0;
    automaticRetryCount: 0;
  };
  outputPolicy: {
    maxCandidateSearchPaths: 5;
    safePathsExcludeQueryAndHash: true;
    fullHtmlStored: false;
    fullBodyStored: false;
    credentialsOrBrowserStorageRead: false;
  };
  stopConditions: readonly string[];
  authorization: {
    status: "not_granted";
    authorizedAt: null;
    authorizedBy: null;
  };
  boundary: {
    thisBriefIsNotAuthorization: true;
    exactHomepageOnly: true;
    redirectsFailClosed: true;
    noSearchPageNavigation: true;
    noProductPageNavigation: true;
    noSupplierFieldCollection: true;
    noLoginRegistrationOrInquiry: true;
    noCaptchaHandling: true;
    noAutomaticRetry: true;
    noDatabaseWrite: true;
    noCandidateCreation: true;
    noStage2Submission: true;
    noExternalAiOrPaidApi: true;
  };
  sourceCapabilityValidated: false;
  briefHash: string;
};

export type GlobalSourcesDiscoveryDomSignals = {
  pageUrl: string;
  title: string;
  visibleTextLength: number;
  brandMarker: boolean;
  brandTitleMarker: boolean;
  searchFormMarker: boolean;
  searchInputMarker: boolean;
  registrationMarker: boolean;
  loginMarker: boolean;
  captchaMarker: boolean;
  accessDeniedMarker: boolean;
  serviceUnavailableMarker: boolean;
  candidateSearchLinks: string[];
};

export type GlobalSourcesDiscoveryPageClassification =
  | "homepage_discovery_ready"
  | "loading"
  | "captcha_or_robot_check"
  | "login_or_registration_required"
  | "access_denied"
  | "service_unavailable"
  | "browser_internal_error"
  | "unexpected_origin_redirect"
  | "unexpected_path_redirect"
  | "unexpected_redirect"
  | "unknown_page";

export type GlobalSourcesPolicyPreflight = {
  schemaVersion: "stage2-global-sources-policy-preflight.v1";
  briefId: string;
  briefHash: string;
  evaluatedAt: string;
  status: "allowed" | "blocked";
  robotsDecision: "allowed" | "disallowed" | "unknown";
  requestCount: number;
  robotsBodyHash: string | null;
  reasonCodes: string[];
  inputHash: string;
};

function isRecord(value: unknown): value is EvidenceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidHash(value: unknown, key: "selectionHash" | "briefHash"): value is EvidenceRecord {
  if (!isRecord(value) || typeof value[key] !== "string" || !SHA256.test(value[key])) return false;
  const { [key]: _hash, ...body } = value;
  return stableHash(body) === value[key];
}

export function hasCanonicalStage2GlobalSourcesDiscoveryBriefR1(
  value: unknown,
): value is Stage2GlobalSourcesDiscoveryBriefR1 {
  if (!hasValidHash(value, "briefHash")
    || value.schemaVersion !== "stage2-global-sources-discovery-brief.v2"
    || value.status !== "pending_user_authorization"
    || value.selectedPlatform !== "global_sources"
    || value.selectedOrigin !== GLOBAL_SOURCES_ORIGIN
    || value.purpose !== "public_homepage_source_discovery_only"
    || value.sourceCapabilityValidated !== false
    || !Number.isFinite(Date.parse(typeof value.createdAt === "string" ? value.createdAt : ""))) return false;
  if (!isRecord(value.successorOf)
    || typeof value.successorOf.historicalBriefId !== "string"
    || value.successorOf.historicalBriefId.length === 0
    || typeof value.successorOf.historicalBriefHash !== "string"
    || !SHA256.test(value.successorOf.historicalBriefHash)
    || typeof value.successorOf.selectionId !== "string"
    || value.successorOf.selectionId.length === 0
    || typeof value.successorOf.selectionHash !== "string"
    || !SHA256.test(value.successorOf.selectionHash)
    || value.successorOf.revisionReason !== "close_cross_origin_robots_scope_and_add_runtime_gates") return false;
  const expectedBriefId = `stage2-global-sources-discovery-r1-${stableHash({
    selectionHash: value.successorOf.selectionHash,
    historicalBriefHash: value.successorOf.historicalBriefHash,
  }).slice(0, 24)}`;
  if (value.briefId !== expectedBriefId) return false;
  const expectedPolicy = {
    robotsUrl: GLOBAL_SOURCES_ROBOTS_URL,
    robotsStatus: "unknown_pending_runtime_check",
    robotsUnknownOrDisallowsBlocksNavigation: true,
  };
  const expectedHomepage = { origin: GLOBAL_SOURCES_ORIGIN, path: "/", url: GLOBAL_SOURCES_HOMEPAGE_URL };
  const expectedOfflineReference = {
    origin: GLOBAL_SOURCES_HELP_ORIGIN,
    path: GLOBAL_SOURCES_HELP_PATH,
    evidenceClass: "offline_reference_only",
    liveNavigationAllowed: false,
  };
  const expectedScope = {
    maxRobotsRequests: 1,
    maxHomepageNavigations: 1,
    maxSearchPageNavigations: 0,
    maxProductPageNavigations: 0,
    maxTotalExternalActions: 2,
    maxSupplierFields: 0,
    automaticRetryCount: 0,
  };
  const expectedOutputPolicy = {
    maxCandidateSearchPaths: 5,
    safePathsExcludeQueryAndHash: true,
    fullHtmlStored: false,
    fullBodyStored: false,
    credentialsOrBrowserStorageRead: false,
  };
  const expectedAuthorization = { status: "not_granted", authorizedAt: null, authorizedBy: null };
  const expectedBoundary = {
    thisBriefIsNotAuthorization: true,
    exactHomepageOnly: true,
    redirectsFailClosed: true,
    noSearchPageNavigation: true,
    noProductPageNavigation: true,
    noSupplierFieldCollection: true,
    noLoginRegistrationOrInquiry: true,
    noCaptchaHandling: true,
    noAutomaticRetry: true,
    noDatabaseWrite: true,
    noCandidateCreation: true,
    noStage2Submission: true,
    noExternalAiOrPaidApi: true,
  };
  return stableHash(value.policyPreflight) === stableHash(expectedPolicy)
    && stableHash(value.homepage) === stableHash(expectedHomepage)
    && stableHash(value.offlineReference) === stableHash(expectedOfflineReference)
    && stableHash(value.requestedScope) === stableHash(expectedScope)
    && stableHash(value.outputPolicy) === stableHash(expectedOutputPolicy)
    && stableHash(value.authorization) === stableHash(expectedAuthorization)
    && stableHash(value.boundary) === stableHash(expectedBoundary)
    && stableHash(value.stopConditions) === stableHash(GLOBAL_SOURCES_DISCOVERY_R1_STOP_CONDITIONS);
}

function validHistoricalEvidence(selection: EvidenceRecord, historicalBrief: EvidenceRecord): boolean {
  if (!hasValidHash(selection, "selectionHash") || !hasValidHash(historicalBrief, "briefHash")) return false;
  if (selection.schemaVersion !== "stage2-alternative-source-selection.v1"
    || selection.status !== "selected_pending_source_discovery"
    || selection.selectedPlatform !== "global_sources"
    || selection.selectedApproach !== "global_sources_minimal_discovery"
    || selection.sourceCapabilityValidated !== false) return false;
  if (historicalBrief.schemaVersion !== "stage2-global-sources-discovery-brief.v1"
    || historicalBrief.status !== "pending_user_authorization"
    || historicalBrief.selectionId !== selection.selectionId
    || historicalBrief.selectionHash !== selection.selectionHash
    || historicalBrief.sourceCapabilityValidated !== false) return false;
  const targets = Array.isArray(historicalBrief.navigationTargets) ? historicalBrief.navigationTargets : [];
  return targets.some((target) => isRecord(target)
      && target.url === GLOBAL_SOURCES_HOMEPAGE_URL)
    && targets.some((target) => isRecord(target)
      && target.origin === GLOBAL_SOURCES_HELP_ORIGIN
      && target.path === GLOBAL_SOURCES_HELP_PATH);
}

function expectedBriefBody(input: {
  selection: EvidenceRecord;
  historicalBrief: EvidenceRecord;
  createdAt: string;
}) {
  return {
    schemaVersion: "stage2-global-sources-discovery-brief.v2" as const,
    briefId: `stage2-global-sources-discovery-r1-${stableHash({
      selectionHash: input.selection.selectionHash,
      historicalBriefHash: input.historicalBrief.briefHash,
    }).slice(0, 24)}`,
    status: "pending_user_authorization" as const,
    createdAt: input.createdAt,
    selectedPlatform: "global_sources" as const,
    selectedOrigin: GLOBAL_SOURCES_ORIGIN,
    purpose: "public_homepage_source_discovery_only" as const,
    successorOf: {
      historicalBriefId: input.historicalBrief.briefId as string,
      historicalBriefHash: input.historicalBrief.briefHash as string,
      selectionId: input.selection.selectionId as string,
      selectionHash: input.selection.selectionHash as string,
      revisionReason: "close_cross_origin_robots_scope_and_add_runtime_gates" as const,
    },
    policyPreflight: {
      robotsUrl: GLOBAL_SOURCES_ROBOTS_URL,
      robotsStatus: "unknown_pending_runtime_check" as const,
      robotsUnknownOrDisallowsBlocksNavigation: true as const,
    },
    homepage: {
      origin: GLOBAL_SOURCES_ORIGIN,
      path: "/" as const,
      url: GLOBAL_SOURCES_HOMEPAGE_URL,
    },
    offlineReference: {
      origin: GLOBAL_SOURCES_HELP_ORIGIN,
      path: GLOBAL_SOURCES_HELP_PATH,
      evidenceClass: "offline_reference_only" as const,
      liveNavigationAllowed: false as const,
    },
    requestedScope: {
      maxRobotsRequests: 1 as const,
      maxHomepageNavigations: 1 as const,
      maxSearchPageNavigations: 0 as const,
      maxProductPageNavigations: 0 as const,
      maxTotalExternalActions: 2 as const,
      maxSupplierFields: 0 as const,
      automaticRetryCount: 0 as const,
    },
    outputPolicy: {
      maxCandidateSearchPaths: 5 as const,
      safePathsExcludeQueryAndHash: true as const,
      fullHtmlStored: false as const,
      fullBodyStored: false as const,
      credentialsOrBrowserStorageRead: false as const,
    },
    stopConditions: [...GLOBAL_SOURCES_DISCOVERY_R1_STOP_CONDITIONS],
    authorization: { status: "not_granted" as const, authorizedAt: null, authorizedBy: null },
    boundary: {
      thisBriefIsNotAuthorization: true as const,
      exactHomepageOnly: true as const,
      redirectsFailClosed: true as const,
      noSearchPageNavigation: true as const,
      noProductPageNavigation: true as const,
      noSupplierFieldCollection: true as const,
      noLoginRegistrationOrInquiry: true as const,
      noCaptchaHandling: true as const,
      noAutomaticRetry: true as const,
      noDatabaseWrite: true as const,
      noCandidateCreation: true as const,
      noStage2Submission: true as const,
      noExternalAiOrPaidApi: true as const,
    },
    sourceCapabilityValidated: false as const,
  };
}

export function buildStage2GlobalSourcesDiscoveryBriefR1(input: {
  selection: EvidenceRecord;
  historicalBrief: EvidenceRecord;
  createdAt: string;
}): Stage2GlobalSourcesDiscoveryBriefR1 {
  if (!validHistoricalEvidence(input.selection, input.historicalBrief)) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_HISTORICAL_EVIDENCE_INVALID");
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("STAGE2_GLOBAL_SOURCES_R1_CREATED_AT_INVALID");
  }
  const body = expectedBriefBody(input);
  return { ...body, briefHash: stableHash(body) };
}

export function validateStage2GlobalSourcesDiscoveryBriefR1(input: {
  selection: EvidenceRecord;
  historicalBrief: EvidenceRecord;
  brief: unknown;
}) {
  const brief = isRecord(input.brief) ? input.brief : {};
  const reasonCodes: string[] = [];
  if (!validHistoricalEvidence(input.selection, input.historicalBrief)) reasonCodes.push("historical_evidence_invalid");
  if (!hasValidHash(brief, "briefHash")) reasonCodes.push("brief_hash_invalid");
  const expected = expectedBriefBody({
    selection: input.selection,
    historicalBrief: input.historicalBrief,
    createdAt: typeof brief.createdAt === "string" ? brief.createdAt : "invalid",
  });
  if (brief.schemaVersion !== expected.schemaVersion || brief.status !== expected.status
    || brief.briefId !== expected.briefId
    || !Number.isFinite(Date.parse(typeof brief.createdAt === "string" ? brief.createdAt : ""))
    || brief.selectedPlatform !== expected.selectedPlatform
    || brief.selectedOrigin !== expected.selectedOrigin || brief.purpose !== expected.purpose
    || stableHash(brief.successorOf) !== stableHash(expected.successorOf)) reasonCodes.push("brief_semantics_invalid");
  if (stableHash(brief.policyPreflight) !== stableHash(expected.policyPreflight)
    || stableHash(brief.homepage) !== stableHash(expected.homepage)
    || stableHash(brief.offlineReference) !== stableHash(expected.offlineReference)) reasonCodes.push("brief_target_scope_invalid");
  if (stableHash(brief.requestedScope) !== stableHash(expected.requestedScope)) reasonCodes.push("brief_scope_invalid");
  if (stableHash(brief.outputPolicy) !== stableHash(expected.outputPolicy)
    || stableHash(brief.boundary) !== stableHash(expected.boundary)
    || stableHash(brief.stopConditions) !== stableHash(expected.stopConditions)
    || stableHash(brief.authorization) !== stableHash(expected.authorization)
    || brief.sourceCapabilityValidated !== false) reasonCodes.push("brief_boundary_invalid");
  const body = {
    schemaVersion: "stage2-global-sources-discovery-brief-validation.v2" as const,
    status: reasonCodes.length === 0 ? "valid_pending_user_authorization" as const : "invalid" as const,
    briefId: typeof brief.briefId === "string" ? brief.briefId : null,
    briefHash: typeof brief.briefHash === "string" ? brief.briefHash : null,
    reasonCodes: [...new Set(reasonCodes)],
  };
  return { ...body, inputHash: stableHash(body) };
}

const cleanText = (value: string, limit: number): string => value
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
  .replace(/\b(?:token|authorization|password)\s*[:=]\s*\S+/gi, "[redacted-sensitive]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

function safeUrl(value: string): URL | null {
  try { return new URL(value); } catch { return null; }
}

function exactHomepageUrl(value: string): { allowed: boolean; reasonCode: string } {
  const url = safeUrl(value);
  if (!url || url.protocol !== "https:" || url.username || url.password || url.port
    || url.origin !== GLOBAL_SOURCES_ORIGIN) {
    return { allowed: false, reasonCode: "origin_not_allowed" };
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return { allowed: false, reasonCode: "path_not_allowed" };
  }
  return { allowed: true, reasonCode: "allowed" };
}

function candidateSearchPaths(values: readonly string[], maximum: number) {
  const paths: string[] = [];
  const rejected: string[] = [];
  for (const value of values) {
    const url = safeUrl(value);
    if (!url || url.protocol !== "https:" || url.username || url.password || url.port
      || url.origin !== GLOBAL_SOURCES_ORIGIN) {
      rejected.push("candidate_search_path_origin_not_allowed");
      continue;
    }
    const path = url.pathname.slice(0, 300);
    if (!path || path === "/" || !/(?:search|product|supplier)/i.test(path)
      || /(?:login|register|account|inquiry|cart)/i.test(path)) {
      rejected.push("candidate_search_path_not_recognized");
      continue;
    }
    if (!paths.includes(path)) paths.push(path);
    if (paths.length >= maximum) break;
  }
  return { paths, rejected };
}

export function buildGlobalSourcesDiscoveryDomExpression(): string {
  return `(() => {
    const clean = (value, limit) => String(value ?? "").replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, limit);
    const title = clean(document.title, 240);
    const visibleText = clean(document.body?.innerText ?? "", 12000);
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const forms = Array.from(document.querySelectorAll('form[action]'));
    const candidateSearchLinks = [...forms.map((node) => node.action), ...anchors.map((node) => node.href)]
      .filter((href) => /(?:search|product|supplier)/i.test(href) && !/(?:login|register|account|inquiry|cart)/i.test(href)).slice(0, 20);
    return {
      pageUrl: location.href,
      title,
      visibleTextLength: Number(document.body?.innerText?.length ?? 0),
      brandMarker: Boolean(document.querySelector('a[href="/"], [class*="logo" i], [aria-label*="Global Sources" i]')),
      brandTitleMarker: /global sources/i.test(title),
      searchFormMarker: Boolean(document.querySelector('form[action*="search" i], [role="search"]')),
      searchInputMarker: Boolean(document.querySelector('input[type="search"], input[name*="search" i], input[placeholder*="search" i]')),
      registrationMarker: Boolean(document.querySelector('form[action*="register" i], [role="dialog"] a[href*="register" i]')),
      loginMarker: Boolean(document.querySelector('form[action*="login" i], [role="dialog"] form[action*="signin" i]')),
      captchaMarker: Boolean(document.querySelector('[class*="captcha" i], iframe[src*="captcha" i]')) || /captcha|robot check|verify you are human/i.test(visibleText),
      accessDeniedMarker: /access denied|request blocked|forbidden/i.test(title + " " + visibleText),
      serviceUnavailableMarker: /service unavailable|temporarily unavailable|maintenance/i.test(title + " " + visibleText),
      candidateSearchLinks,
    };
  })()`;
}

export function classifyGlobalSourcesDiscoveryPage(input: {
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  navigation: PublicPageNavigationResult;
  signals: GlobalSourcesDiscoveryDomSignals;
}) {
  const requested = safeUrl(input.navigation.requestedUrl);
  const final = safeUrl(input.navigation.finalUrl);
  const dom = safeUrl(input.signals.pageUrl);
  const base = {
    schemaVersion: "stage2-global-sources-discovery-page.v1" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    requestedOrigin: requested?.origin ?? null,
    requestedPath: requested?.pathname.slice(0, 300) ?? null,
    finalOrigin: final?.origin ?? null,
    finalPath: final?.pathname.slice(0, 300) ?? null,
    redirectCount: Math.max(0, Math.trunc(input.navigation.redirectCount)),
    redirectOrigins: [...input.navigation.redirectOrigins].slice(0, 10),
    httpStatus: input.navigation.mainDocumentHttpStatus,
    contentType: cleanText(input.navigation.mainDocumentContentType ?? "", 120) || null,
    navigationElapsedMs: Math.max(0, Math.trunc(input.navigation.navigationElapsedMs)),
    domWaitElapsedMs: Math.max(0, Math.trunc(input.navigation.domWaitElapsedMs)),
    readyState: cleanText(input.navigation.readyState ?? "", 40) || null,
    title: cleanText(input.signals.title, 240),
    visibleTextLength: Math.max(0, Math.trunc(input.signals.visibleTextLength)),
    markers: {
      brand: input.signals.brandMarker,
      brandTitle: input.signals.brandTitleMarker,
      searchForm: input.signals.searchFormMarker,
      searchInput: input.signals.searchInputMarker,
      registration: input.signals.registrationMarker,
      login: input.signals.loginMarker,
      captcha: input.signals.captchaMarker,
      accessDenied: input.signals.accessDeniedMarker,
      serviceUnavailable: input.signals.serviceUnavailableMarker,
    },
  };
  const finish = (
    classification: GlobalSourcesDiscoveryPageClassification,
    classificationReasonCodes: string[],
    paths: string[] = [],
    rejectedCandidatePathCount = 0,
  ) => {
    const body = {
      ...base,
      classification,
      classificationReasonCodes: [...new Set(classificationReasonCodes)],
      candidateSearchPaths: paths,
      rejectedCandidatePathCount,
    };
    return { ...body, inputHash: stableHash(body) };
  };

  if (/^(?:chrome-error|edge-error):\/\//i.test(input.signals.pageUrl)
    || /^(?:chrome-error|edge-error):\/\//i.test(input.navigation.finalUrl)) {
    return finish("browser_internal_error", ["browser_internal_error_page"]);
  }
  const requestedGate = exactHomepageUrl(input.navigation.requestedUrl);
  const finalGate = exactHomepageUrl(input.navigation.finalUrl);
  const domGate = exactHomepageUrl(input.signals.pageUrl);
  if (requestedGate.reasonCode === "origin_not_allowed" || finalGate.reasonCode === "origin_not_allowed"
    || domGate.reasonCode === "origin_not_allowed" || !input.navigation.allowedFinalOrigin) {
    return finish("unexpected_origin_redirect", ["final_or_dom_origin_not_allowed"]);
  }
  if (!requestedGate.allowed || !finalGate.allowed || !domGate.allowed) {
    return finish("unexpected_path_redirect", ["final_or_dom_path_not_allowed"]);
  }
  if (input.navigation.redirectCount !== 0 || input.navigation.redirectOrigins.length !== 0) {
    return finish("unexpected_redirect", ["redirect_not_allowed"]);
  }
  if (input.navigation.readyState !== "complete" && input.navigation.readyState !== "interactive") {
    return finish("loading", ["page_still_loading"]);
  }
  if (input.signals.captchaMarker) return finish("captcha_or_robot_check", ["captcha_marker_present"]);
  if (input.signals.loginMarker || input.signals.registrationMarker) {
    return finish("login_or_registration_required", [
      ...(input.signals.loginMarker ? ["login_marker_present"] : []),
      ...(input.signals.registrationMarker ? ["registration_marker_present"] : []),
    ]);
  }
  if (input.navigation.mainDocumentHttpStatus === 403 || input.signals.accessDeniedMarker) {
    return finish("access_denied", [
      ...(input.navigation.mainDocumentHttpStatus === 403 ? ["access_denied_http_status"] : []),
      ...(input.signals.accessDeniedMarker ? ["access_denied_marker_present"] : []),
    ]);
  }
  if ((input.navigation.mainDocumentHttpStatus !== null && input.navigation.mainDocumentHttpStatus >= 500)
    || input.signals.serviceUnavailableMarker) {
    return finish("service_unavailable", [
      ...(input.navigation.mainDocumentHttpStatus !== null && input.navigation.mainDocumentHttpStatus >= 500
        ? ["service_unavailable_http_status"] : []),
      ...(input.signals.serviceUnavailableMarker ? ["service_unavailable_marker_present"] : []),
    ]);
  }
  if (input.navigation.mainDocumentHttpStatus === null
    || input.navigation.mainDocumentHttpStatus < 200
    || input.navigation.mainDocumentHttpStatus >= 400) {
    return finish("unknown_page", ["main_document_status_not_confirmed"]);
  }
  if (!input.navigation.mainDocumentContentType?.toLowerCase().includes("text/html")) {
    return finish("unknown_page", ["main_document_content_type_not_html"]);
  }
  const candidates = candidateSearchPaths(
    input.signals.candidateSearchLinks,
    input.brief.outputPolicy.maxCandidateSearchPaths,
  );
  if (candidates.rejected.includes("candidate_search_path_origin_not_allowed")) {
    return finish("unexpected_origin_redirect", ["candidate_search_path_origin_not_allowed"],
      candidates.paths, candidates.rejected.length);
  }
  const reasonCodes: string[] = [];
  if (!input.signals.brandMarker && !input.signals.brandTitleMarker) reasonCodes.push("brand_marker_missing");
  if (!input.signals.searchFormMarker && !input.signals.searchInputMarker) reasonCodes.push("search_marker_missing");
  if (candidates.paths.length === 0) reasonCodes.push("candidate_search_path_missing");
  if (candidates.rejected.length > 0) reasonCodes.push("candidate_search_path_not_recognized");
  if (reasonCodes.length > 0) return finish("unknown_page", reasonCodes, candidates.paths, candidates.rejected.length);
  return finish("homepage_discovery_ready", ["homepage_markers_and_safe_search_path_present"], candidates.paths, 0);
}

type RobotsRule = { directive: "allow" | "disallow"; path: string };

function parseRobotsRules(text: string): RobotsRule[] | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const rules: RobotsRule[] = [];
  let applies = false;
  let groupHasRules = false;
  let wildcardSeen = false;
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (groupHasRules) { applies = false; groupHasRules = false; }
      if (value === "*") { applies = true; wildcardSeen = true; }
      continue;
    }
    if ((name === "allow" || name === "disallow") && applies) {
      groupHasRules = true;
      rules.push({ directive: name, path: value });
    }
  }
  return wildcardSeen ? rules : null;
}

function robotsHomepageDecision(text: string): "allowed" | "disallowed" | "unknown" {
  const rules = parseRobotsRules(text);
  if (rules === null) return "unknown";
  if (rules.some((rule) => /[*$]/.test(rule.path))) return "unknown";
  const matches = rules.filter((rule) => rule.path !== "" && "/".startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length
      || (left.directive === "allow" ? -1 : 1));
  if (matches.length === 0) return "allowed";
  return matches[0].directive === "allow" ? "allowed" : "disallowed";
}

export function buildGlobalSourcesPolicyPreflight(input: {
  brief: Stage2GlobalSourcesDiscoveryBriefR1;
  robotsText: string;
  evaluatedAt: string;
  requestCount: number;
}): GlobalSourcesPolicyPreflight {
  const robotsDecision = robotsHomepageDecision(input.robotsText);
  const reasonCodes: string[] = [];
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) reasonCodes.push("policy_evaluated_at_invalid");
  if (input.requestCount !== 1 || input.requestCount > input.brief.requestedScope.maxRobotsRequests) {
    reasonCodes.push("policy_request_budget_invalid");
  }
  if (robotsDecision === "disallowed") reasonCodes.push("robots_disallows_homepage");
  if (robotsDecision === "unknown") reasonCodes.push("robots_policy_unknown");
  const body = {
    schemaVersion: "stage2-global-sources-policy-preflight.v1" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    evaluatedAt: input.evaluatedAt,
    status: reasonCodes.length === 0 ? "allowed" as const : "blocked" as const,
    robotsDecision,
    requestCount: input.requestCount,
    robotsBodyHash: input.robotsText.length > 0 ? stableHash(input.robotsText) : null,
    reasonCodes,
  };
  return { ...body, inputHash: stableHash(body) };
}
