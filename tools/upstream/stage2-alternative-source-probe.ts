import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";

export type MadeInChinaProbeUrlKind = "search" | "product";

export type MadeInChinaProbeDomSignals = {
  pageUrl: string;
  title: string;
  visibleTextLength: number;
  brandMarker: boolean;
  brandTitleMarker: boolean;
  searchContainerMarker: boolean;
  alternateSearchContainerMarker: boolean;
  captchaMarker: boolean;
  loginOrInquiryMarker: boolean;
  accessDeniedMarker: boolean;
  serviceUnavailableMarker: boolean;
  candidateProductLinks: string[];
};

export type Stage2AlternativeSourcePolicyPreflight = {
  schemaVersion: "stage2-alternative-source-policy-preflight.v1";
  briefId: string;
  briefHash: string;
  evaluatedAt: string;
  status: "allowed" | "blocked";
  robotsDecision: "allowed" | "disallowed" | "unknown";
  termsDecision: "reviewed_allows_public_capability_probe" | "prohibited" | "unknown";
  requestCount: number;
  robotsBodyHash: string | null;
  reasonCodes: string[];
  inputHash: string;
};

export type MadeInChinaProbePageClassification =
  | "search_results_ready"
  | "loading"
  | "captcha_or_robot_check"
  | "login_or_inquiry_required"
  | "access_denied"
  | "service_unavailable"
  | "browser_internal_error"
  | "unexpected_origin_redirect"
  | "unknown_page";

const cleanText = (value: string, limit: number): string => value
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
  .replace(/\b(?:token|authorization|password)\s*[:=]\s*\S+/gi, "[redacted-sensitive]")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

function safeUrlParts(value: string): { origin: string | null; path: string | null } {
  try {
    const url = new URL(value);
    return { origin: url.origin, path: url.pathname.slice(0, 300) };
  } catch {
    return { origin: null, path: null };
  }
}

export function validateMadeInChinaProbeUrl(
  value: string,
  kind: MadeInChinaProbeUrlKind,
  brief: Stage2AlternativeSourceBrief,
): { allowed: boolean; safeUrl: string | null; reasonCode: string | null } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { allowed: false, safeUrl: null, reasonCode: "url_invalid" };
  }
  if (url.protocol === "http:") return { allowed: false, safeUrl: null, reasonCode: "http_not_allowed" };
  if (url.protocol !== "https:") return { allowed: false, safeUrl: null, reasonCode: "protocol_not_allowed" };
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return { allowed: false, safeUrl: null, reasonCode: "url_authority_not_allowed" };
  }
  if (url.origin !== brief.sourceDecision.selectedOrigin) {
    return { allowed: false, safeUrl: null, reasonCode: "origin_not_allowed" };
  }
  if (kind === "search" && !url.pathname.startsWith(brief.search.allowedSearchPathPrefix)) {
    return { allowed: false, safeUrl: null, reasonCode: "search_path_not_allowed" };
  }
  if (kind === "product"
    && !brief.search.allowedProductPathPatterns.some((pattern) => new RegExp(pattern).test(url.pathname))) {
    return { allowed: false, safeUrl: null, reasonCode: "product_path_not_allowed" };
  }
  return { allowed: true, safeUrl: `${url.origin}${url.pathname}`, reasonCode: null };
}

type RobotsRule = { directive: "allow" | "disallow"; path: string };

function parseWildcardRobotsRules(robotsText: string): RobotsRule[] | null {
  const lines = robotsText.split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const rules: RobotsRule[] = [];
  let applies = false;
  let groupHasRules = false;
  let wildcardGroupSeen = false;
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (groupHasRules) {
        applies = false;
        groupHasRules = false;
      }
      if (value === "*") {
        applies = true;
        wildcardGroupSeen = true;
      }
      continue;
    }
    if ((name === "allow" || name === "disallow") && applies) {
      groupHasRules = true;
      rules.push({ directive: name, path: value });
    }
  }
  return wildcardGroupSeen ? rules : null;
}

function evaluateRobotsPath(robotsText: string, targetPath: string): "allowed" | "disallowed" | "unknown" {
  const rules = parseWildcardRobotsRules(robotsText);
  if (rules === null) return "unknown";
  const matches = rules
    .filter((rule) => rule.path !== "" && targetPath.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length
      || (left.directive === "allow" ? -1 : 1));
  if (matches.length === 0) return "allowed";
  return matches[0].directive === "allow" ? "allowed" : "disallowed";
}

export function buildStage2AlternativeSourcePolicyPreflight(input: {
  brief: Stage2AlternativeSourceBrief;
  robotsText: string;
  termsDecision: Stage2AlternativeSourcePolicyPreflight["termsDecision"];
  evaluatedAt: string;
  requestCount: number;
}): Stage2AlternativeSourcePolicyPreflight {
  const targetPath = new URL(input.brief.search.startUrl).pathname;
  const robotsDecision = evaluateRobotsPath(input.robotsText, targetPath);
  const reasonCodes: string[] = [];
  if (!Number.isFinite(Date.parse(input.evaluatedAt))) reasonCodes.push("policy_evaluated_at_invalid");
  if (input.requestCount !== 1 || input.requestCount > input.brief.requestedScope.maxPolicyRequests) {
    reasonCodes.push("policy_request_budget_invalid");
  }
  if (robotsDecision === "disallowed") reasonCodes.push("robots_disallows_search_path");
  if (robotsDecision === "unknown") reasonCodes.push("robots_policy_unknown");
  if (input.termsDecision === "unknown") reasonCodes.push("terms_policy_unknown");
  if (input.termsDecision === "prohibited") reasonCodes.push("terms_policy_prohibits_probe");
  const body = {
    schemaVersion: "stage2-alternative-source-policy-preflight.v1" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    evaluatedAt: input.evaluatedAt,
    status: reasonCodes.length === 0 ? "allowed" as const : "blocked" as const,
    robotsDecision,
    termsDecision: input.termsDecision,
    requestCount: input.requestCount,
    robotsBodyHash: input.robotsText.length > 0 ? stableHash(input.robotsText) : null,
    reasonCodes,
  };
  return { ...body, inputHash: stableHash(body) };
}

export function buildMadeInChinaProbeDomExpression(): string {
  return `(() => {
    const clean = (value, limit) => String(value ?? "").replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, limit);
    const title = clean(document.title, 240);
    const bodyText = clean(document.body?.innerText ?? "", 12000);
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const candidateProductLinks = anchors.map((node) => node.href).filter((href) => /\\/(?:price\\/prodetail_|showroom\\/.+\\/product-detail)/i.test(href)).slice(0, 20);
    return {
      pageUrl: location.href,
      title,
      visibleTextLength: Number(document.body?.innerText?.length ?? 0),
      brandMarker: Boolean(document.querySelector('a[href="/"], a[href="https://www.made-in-china.com/"]')),
      brandTitleMarker: /made-in-china/i.test(title),
      searchContainerMarker: Boolean(document.querySelector('[data-role="product-list"], .product-list, #product-list')),
      alternateSearchContainerMarker: candidateProductLinks.length > 0 && Boolean(document.querySelector('main, [role="main"]')),
      captchaMarker: Boolean(document.querySelector('[class*="captcha" i], iframe[src*="captcha" i]')) || /captcha|robot check|verify you are human/i.test(bodyText),
      loginOrInquiryMarker: Boolean(document.querySelector('form[action*="login" i], [role="dialog"] form[action*="inquiry" i]')),
      accessDeniedMarker: /access denied|request blocked|forbidden/i.test(title + " " + bodyText),
      serviceUnavailableMarker: /service unavailable|temporarily unavailable|maintenance/i.test(title + " " + bodyText),
      candidateProductLinks,
    };
  })()`;
}

export function classifyMadeInChinaProbePage(input: {
  brief: Stage2AlternativeSourceBrief;
  navigation: PublicPageNavigationResult;
  signals: MadeInChinaProbeDomSignals;
}) {
  const requested = safeUrlParts(input.navigation.requestedUrl);
  const final = safeUrlParts(input.signals.pageUrl || input.navigation.finalUrl);
  const base = {
    schemaVersion: "stage2-alternative-source-probe-page.v1" as const,
    requestedOrigin: requested.origin,
    requestedPath: requested.path,
    finalOrigin: final.origin,
    finalPath: final.path,
    redirectCount: input.navigation.redirectCount,
    redirectOrigins: [...input.navigation.redirectOrigins],
    httpStatus: input.navigation.mainDocumentHttpStatus,
    contentType: cleanText(input.navigation.mainDocumentContentType ?? "", 120) || null,
    navigationElapsedMs: input.navigation.navigationElapsedMs,
    domWaitElapsedMs: input.navigation.domWaitElapsedMs,
    readyState: input.navigation.readyState,
    title: cleanText(input.signals.title, 240),
    visibleTextLength: Math.max(0, Math.trunc(input.signals.visibleTextLength)),
    markers: {
      brand: input.signals.brandMarker,
      brandTitle: input.signals.brandTitleMarker,
      searchContainer: input.signals.searchContainerMarker,
      alternateSearchContainer: input.signals.alternateSearchContainerMarker,
      captcha: input.signals.captchaMarker,
      loginOrInquiry: input.signals.loginOrInquiryMarker,
      accessDenied: input.signals.accessDeniedMarker,
      serviceUnavailable: input.signals.serviceUnavailableMarker,
    },
  };
  const finish = (
    classification: MadeInChinaProbePageClassification,
    classificationReasonCodes: string[],
    allowedProductUrls: string[] = [],
    rejectedProductLinkCount = 0,
  ) => {
    const body = {
      ...base,
      classification,
      classificationReasonCodes,
      allowedProductUrls,
      rejectedProductLinkCount,
    };
    return { ...body, inputHash: stableHash(body) };
  };

  if (/^(?:chrome-error|edge-error):\/\//i.test(input.signals.pageUrl)
    || /^(?:chrome-error|edge-error):\/\//i.test(input.navigation.finalUrl)) {
    return finish("browser_internal_error", ["browser_internal_error_page"]);
  }
  const requestedGate = validateMadeInChinaProbeUrl(input.navigation.requestedUrl, "search", input.brief);
  const finalGate = validateMadeInChinaProbeUrl(input.navigation.finalUrl, "search", input.brief);
  const domGate = validateMadeInChinaProbeUrl(input.signals.pageUrl, "search", input.brief);
  if (!requestedGate.allowed || !finalGate.allowed || !domGate.allowed || !input.navigation.allowedFinalOrigin) {
    return finish("unexpected_origin_redirect", ["final_or_dom_origin_not_allowed"]);
  }
  if (input.navigation.redirectOrigins.some((origin) => origin !== input.brief.sourceDecision.selectedOrigin)) {
    return finish("unexpected_origin_redirect", ["intermediate_redirect_origin_not_allowed"]);
  }
  if (finalGate.safeUrl !== domGate.safeUrl) {
    return finish("unexpected_origin_redirect", ["navigation_dom_url_mismatch"]);
  }
  if (input.navigation.readyState !== "complete" && input.navigation.readyState !== "interactive") {
    return finish("loading", ["page_still_loading"]);
  }
  if (input.signals.captchaMarker) return finish("captcha_or_robot_check", ["captcha_marker_present"]);
  if (input.signals.loginOrInquiryMarker) {
    return finish("login_or_inquiry_required", ["login_or_inquiry_marker_present"]);
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

  const brandKnown = input.signals.brandMarker || input.signals.brandTitleMarker;
  const searchKnown = input.signals.searchContainerMarker || input.signals.alternateSearchContainerMarker;
  const reasonCodes: string[] = [];
  if (!brandKnown) reasonCodes.push("brand_marker_missing");
  if (!searchKnown) reasonCodes.push("search_container_marker_missing");
  if (reasonCodes.length > 0) return finish("unknown_page", reasonCodes);

  const allowedProductUrls: string[] = [];
  const rejectedReasonCodes: string[] = [];
  for (const link of input.signals.candidateProductLinks) {
    const result = validateMadeInChinaProbeUrl(link, "product", input.brief);
    if (result.allowed && result.safeUrl) allowedProductUrls.push(result.safeUrl);
    else if (result.reasonCode) rejectedReasonCodes.push(result.reasonCode);
  }
  const uniqueAllowed = [...new Set(allowedProductUrls)].slice(0, input.brief.requestedScope.maxSupplierProductPages);
  if (rejectedReasonCodes.some((code) => code === "origin_not_allowed" || code === "http_not_allowed"
    || code === "protocol_not_allowed" || code === "url_authority_not_allowed")) {
    return finish("unexpected_origin_redirect", ["candidate_product_link_origin_not_allowed"],
      uniqueAllowed, rejectedReasonCodes.length);
  }
  if (rejectedReasonCodes.length > 0) {
    return finish("unknown_page", ["candidate_product_link_path_not_allowed"],
      uniqueAllowed, rejectedReasonCodes.length);
  }
  if (uniqueAllowed.length === 0) return finish("unknown_page", ["no_allowed_product_links"]);
  return finish("search_results_ready", ["search_page_markers_and_allowed_links_present"], uniqueAllowed, 0);
}
