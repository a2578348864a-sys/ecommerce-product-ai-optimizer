import { stableHash } from "../../../lib/upstream/pipeline";

export type AmazonPageClassification =
  | "amazon_normal"
  | "amazon_normal_variant"
  | "loading"
  | "region_selection"
  | "privacy_prompt_visible"
  | "privacy_prompt_unknown"
  | "login_wall"
  | "captcha"
  | "access_denied"
  | "browser_error_page"
  | "blank_page"
  | "unexpected_redirect"
  | "unknown_page";

export type AmazonPageMarkerSource = "primary" | "alternate" | null;

export type AmazonPrivacyPromptState = "absent" | "visible_blocking_prompt" | "page_text_only" | "unknown";
export type AmazonPrivacyMarkerSource =
  | "known_amazon_container"
  | "known_generic_container"
  | "semantic_candidate"
  | "footer_link"
  | "page_text"
  | "none";
export type AmazonPrivacySelectorCategory =
  | "amazon_cookie_container"
  | "generic_consent_banner"
  | "semantic_dialog_or_banner"
  | "privacy_named_container"
  | "footer_privacy_link"
  | "page_text"
  | null;

export type AmazonPrivacyPromptCandidate = {
  markerSource: AmazonPrivacyMarkerSource;
  selectorCategory: AmazonPrivacySelectorCategory;
  tagName: string | null;
  role: string | null;
  visible: boolean;
  hasInteractiveControls: boolean;
  insideFooter: boolean;
  blocksMainContent: boolean;
  matchedText: string | null;
};

export type AmazonPrivacyPromptDiagnostic = {
  state: AmazonPrivacyPromptState;
  markerSource: AmazonPrivacyMarkerSource;
  selectorCategory: AmazonPrivacySelectorCategory;
  tagName: string | null;
  role: string | null;
  visible: boolean | null;
  hasInteractiveControls: boolean | null;
  insideFooter: boolean | null;
  blocksMainContent: boolean | null;
  matchedText: string | null;
  reasonCodes: string[];
};

export type AmazonLoginWallState = "absent" | "visible_blocking_login" | "hidden_or_navigation_signin" | "unknown";
export type AmazonLoginMarkerSource =
  | "known_signin_form"
  | "known_email_input"
  | "explicit_page_text"
  | "legacy_boolean"
  | "none";
export type AmazonLoginSelectorCategory =
  | "signin_form_name"
  | "signin_form_action"
  | "amazon_email_input"
  | "explicit_continue_text"
  | "legacy_boolean"
  | null;

export type AmazonLoginWallCandidate = {
  markerSource: AmazonLoginMarkerSource;
  selectorCategory: AmazonLoginSelectorCategory;
  tagName: string | null;
  role: string | null;
  visible: boolean;
  hasInteractiveControls: boolean;
  insideNavigation: boolean;
  blocksMainContent: boolean;
  matchedText: string | null;
};

export type AmazonLoginWallDiagnostic = {
  state: AmazonLoginWallState;
  markerSource: AmazonLoginMarkerSource;
  selectorCategory: AmazonLoginSelectorCategory;
  tagName: string | null;
  role: string | null;
  visible: boolean | null;
  hasInteractiveControls: boolean | null;
  insideNavigation: boolean | null;
  blocksMainContent: boolean | null;
  matchedText: string | null;
  reasonCodes: string[];
};

export type AmazonPageDiagnosticMarkers = {
  amazonBrand: boolean;
  searchBox: boolean;
  deliveryEntry: boolean;
  regionSelection: boolean;
  privacyPrompt: AmazonPrivacyPromptDiagnostic;
  captcha: boolean;
  loginWall: AmazonLoginWallDiagnostic | boolean;
  errorPage: boolean;
  browserInternalError: boolean;
};

export type AmazonPageDiagnosticInput = {
  requestedUrl: string;
  finalUrl: string;
  redirectUrls: string[];
  mainDocumentHttpStatus: number | null;
  mainDocumentContentType: string | null;
  navigationElapsedMs: number;
  domWaitElapsedMs: number;
  readyState: string | null;
  title: string | null;
  visibleText: string;
  visibleTextLength?: number;
  markerSources: {
    amazonBrand: AmazonPageMarkerSource;
    searchBox: AmazonPageMarkerSource;
    deliveryEntry: AmazonPageMarkerSource;
  };
  markers: AmazonPageDiagnosticMarkers;
};

export type AmazonPageDomSignals = Pick<
  AmazonPageDiagnosticInput,
  "readyState" | "title" | "visibleText" | "visibleTextLength" | "markerSources" | "markers"
>;

type SafeUrlEvidence = {
  origin: string | null;
  path: string | null;
};

const MAX_SAFE_PATH_LENGTH = 160;
const MAX_TITLE_LENGTH = 160;
const MAX_DIAGNOSTIC_SNIPPET_LENGTH = 320;
const MAX_DIAGNOSTIC_HASH_INPUT_LENGTH = 2_000;

function cleanWhitespace(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeDiagnosticText(value: string | null | undefined, maxLength: number): string | null {
  if (typeof value !== "string" || maxLength < 1) return null;
  const redacted = cleanWhitespace(value)
    .replace(/\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi, "Authorization: [REDACTED]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:cookie|set-cookie|password|passwd|token|access_token|refresh_token|session(?:id)?)\s*[:=]\s*[^\s,;]+/gi,
      (match) => `${match.split(/[:=]/, 1)[0]}=[REDACTED]`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED]");
  return redacted ? redacted.slice(0, maxLength) : null;
}

function privacyPromptFromCandidate(
  state: AmazonPrivacyPromptState,
  candidate: AmazonPrivacyPromptCandidate,
  reasonCodes: string[],
): AmazonPrivacyPromptDiagnostic {
  return {
    state,
    markerSource: candidate.markerSource,
    selectorCategory: candidate.selectorCategory,
    tagName: sanitizeDiagnosticText(candidate.tagName, 40)?.toLowerCase() ?? null,
    role: sanitizeDiagnosticText(candidate.role, 60)?.toLowerCase() ?? null,
    visible: candidate.visible,
    hasInteractiveControls: candidate.hasInteractiveControls,
    insideFooter: candidate.insideFooter,
    blocksMainContent: candidate.blocksMainContent,
    matchedText: sanitizeDiagnosticText(candidate.matchedText, 160),
    reasonCodes,
  };
}

function isConfirmedPrivacyContainer(candidate: AmazonPrivacyPromptCandidate): boolean {
  if (candidate.markerSource !== "known_amazon_container" && candidate.markerSource !== "known_generic_container") {
    return false;
  }
  const role = candidate.role?.toLowerCase() ?? null;
  const tagName = candidate.tagName?.toLowerCase() ?? null;
  return role === "dialog" || role === "alertdialog" || role === "banner" || tagName === "dialog"
    || candidate.selectorCategory === "amazon_cookie_container"
    || candidate.selectorCategory === "generic_consent_banner";
}

export function classifyAmazonPrivacyPrompt(input: {
  candidates: AmazonPrivacyPromptCandidate[];
  pageTextMatched: boolean;
}): AmazonPrivacyPromptDiagnostic {
  const confirmed = input.candidates.find((candidate) => candidate.visible
    && !candidate.insideFooter
    && candidate.hasInteractiveControls
    && isConfirmedPrivacyContainer(candidate));
  if (confirmed) {
    return privacyPromptFromCandidate("visible_blocking_prompt", confirmed, ["privacy_visible_interactive_prompt"]);
  }

  const uncertain = input.candidates.find((candidate) => candidate.visible && !candidate.insideFooter);
  if (uncertain) {
    const reason = uncertain.markerSource === "semantic_candidate"
      ? "privacy_candidate_selector_unconfirmed"
      : !uncertain.hasInteractiveControls
        ? "privacy_candidate_controls_unconfirmed"
        : "privacy_candidate_blocking_state_unconfirmed";
    return privacyPromptFromCandidate("unknown", uncertain, [reason]);
  }

  const nonBlocking = input.candidates[0];
  if (nonBlocking) {
    const reason = nonBlocking.insideFooter
      ? "privacy_footer_link_only"
      : !nonBlocking.visible ? "privacy_inactive_dom_only" : "privacy_page_text_only";
    return privacyPromptFromCandidate("page_text_only", nonBlocking, [reason]);
  }
  if (input.pageTextMatched) {
    return {
      state: "page_text_only",
      markerSource: "page_text",
      selectorCategory: "page_text",
      tagName: null,
      role: null,
      visible: null,
      hasInteractiveControls: null,
      insideFooter: null,
      blocksMainContent: null,
      matchedText: null,
      reasonCodes: ["privacy_page_text_only"],
    };
  }
  return {
    state: "absent",
    markerSource: "none",
    selectorCategory: null,
    tagName: null,
    role: null,
    visible: null,
    hasInteractiveControls: null,
    insideFooter: null,
    blocksMainContent: null,
    matchedText: null,
    reasonCodes: ["privacy_signal_absent"],
  };
}

export function emptyAmazonLoginWallDiagnostic(): AmazonLoginWallDiagnostic {
  return {
    state: "absent",
    markerSource: "none",
    selectorCategory: null,
    tagName: null,
    role: null,
    visible: null,
    hasInteractiveControls: null,
    insideNavigation: null,
    blocksMainContent: null,
    matchedText: null,
    reasonCodes: ["login_signal_absent"],
  };
}

export function normalizeAmazonLoginWallDiagnostic(
  value: AmazonLoginWallDiagnostic | boolean,
): AmazonLoginWallDiagnostic {
  if (typeof value !== "boolean") return value;
  if (!value) return emptyAmazonLoginWallDiagnostic();
  return {
    state: "unknown",
    markerSource: "legacy_boolean",
    selectorCategory: "legacy_boolean",
    tagName: null,
    role: null,
    visible: null,
    hasInteractiveControls: null,
    insideNavigation: null,
    blocksMainContent: null,
    matchedText: null,
    reasonCodes: ["login_legacy_boolean_marker_unconfirmed"],
  };
}

function safeUrlEvidence(value: string): SafeUrlEvidence {
  try {
    const url = new URL(value);
    const origin = url.origin !== "null"
      ? url.origin
      : url.hostname ? `${url.protocol}//${url.hostname}` : url.protocol;
    return {
      origin: sanitizeDiagnosticText(origin, 120),
      path: sanitizeDiagnosticText(url.pathname || (url.protocol === "about:" ? url.href.slice(6) : "/"), MAX_SAFE_PATH_LENGTH),
    };
  } catch {
    return { origin: null, path: null };
  }
}

function isAllowedAmazonFinalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "amazon.com" || url.hostname === "www.amazon.com");
  } catch {
    return false;
  }
}

function isBrowserInternalUrl(value: string): boolean {
  try {
    return ["chrome-error:", "chrome:", "edge:", "about:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function classifyPage(input: AmazonPageDiagnosticInput): {
  classification: AmazonPageClassification;
  reasonCodes: string[];
} {
  const visibleLength = input.visibleTextLength ?? input.visibleText.length;
  const status = input.mainDocumentHttpStatus;
  const contentType = input.mainDocumentContentType?.toLowerCase() ?? null;
  const sources = Object.values(input.markerSources);
  const loginWall = normalizeAmazonLoginWallDiagnostic(input.markers.loginWall);

  if (input.markers.browserInternalError || isBrowserInternalUrl(input.finalUrl)) {
    return { classification: input.finalUrl === "about:blank" ? "blank_page" : "browser_error_page", reasonCodes: [
      input.finalUrl === "about:blank" ? "blank_internal_page" : "browser_internal_error_page",
    ] };
  }
  if (!isAllowedAmazonFinalUrl(input.finalUrl)) {
    return { classification: "unexpected_redirect", reasonCodes: ["final_origin_not_allowed"] };
  }
  if (input.readyState !== "complete") {
    return { classification: "loading", reasonCodes: ["document_not_complete"] };
  }
  if (input.markers.captcha) return { classification: "captcha", reasonCodes: ["captcha_marker_present"] };
  if (loginWall.state === "visible_blocking_login") {
    return { classification: "login_wall", reasonCodes: ["login_wall_visible"] };
  }
  if (loginWall.state === "unknown") {
    return { classification: "login_wall", reasonCodes: ["login_wall_unknown"] };
  }
  if (input.markers.errorPage || status === 403 || status === 429 || (status !== null && status >= 500)) {
    return { classification: "access_denied", reasonCodes: [
      status === 403 ? "http_403" : status === 429 ? "http_429" : status !== null && status >= 500 ? "http_5xx" : "error_page_marker_present",
    ] };
  }
  if (input.markers.regionSelection) {
    return { classification: "region_selection", reasonCodes: ["region_selection_marker_present"] };
  }
  if (input.markers.privacyPrompt.state === "visible_blocking_prompt") {
    return { classification: "privacy_prompt_visible", reasonCodes: ["privacy_prompt_visible"] };
  }
  if (input.markers.privacyPrompt.state === "unknown") {
    return { classification: "privacy_prompt_unknown", reasonCodes: ["privacy_prompt_unknown"] };
  }
  const anyMarker = input.markers.amazonBrand || input.markers.searchBox || input.markers.deliveryEntry
    || input.markers.regionSelection || input.markers.privacyPrompt.state !== "absent" || input.markers.captcha
    || loginWall.state !== "absent" || input.markers.errorPage || input.markers.browserInternalError;
  if (!input.title?.trim() && visibleLength === 0 && !anyMarker) {
    return { classification: "blank_page", reasonCodes: ["empty_document"] };
  }
  if (status === null || status < 200 || status >= 400) {
    return { classification: "unknown_page", reasonCodes: ["main_document_status_unconfirmed"] };
  }
  if (!contentType || !contentType.includes("text/html")) {
    return { classification: "unknown_page", reasonCodes: ["main_document_content_type_unconfirmed"] };
  }
  if (input.markers.amazonBrand && input.markers.searchBox && input.markers.deliveryEntry) {
    const alternate = sources.some((source) => source === "alternate");
    return {
      classification: alternate ? "amazon_normal_variant" : "amazon_normal",
      reasonCodes: [alternate ? "required_markers_present_alternate_selector" : "required_markers_present"],
    };
  }
  return { classification: "unknown_page", reasonCodes: ["required_amazon_markers_incomplete"] };
}

export function buildAmazonPageDiagnostic(input: AmazonPageDiagnosticInput) {
  const requestedUrl = safeUrlEvidence(input.requestedUrl);
  const finalUrl = safeUrlEvidence(input.finalUrl);
  const redirectOrigins = input.redirectUrls.map((url) => safeUrlEvidence(url).origin)
    .filter((origin): origin is string => origin !== null);
  const title = sanitizeDiagnosticText(input.title, MAX_TITLE_LENGTH);
  const safeDiagnosticText = sanitizeDiagnosticText(input.visibleText, MAX_DIAGNOSTIC_HASH_INPUT_LENGTH);
  const diagnosticTextSnippet = sanitizeDiagnosticText(safeDiagnosticText, MAX_DIAGNOSTIC_SNIPPET_LENGTH);
  const loginWall = normalizeAmazonLoginWallDiagnostic(input.markers.loginWall);
  const classification = classifyPage(input);
  const core = {
    schemaVersion: "amazon-page-diagnostic.v2" as const,
    requestedUrl,
    finalUrl,
    redirectCount: input.redirectUrls.length,
    redirectOrigins,
    mainDocumentHttpStatus: input.mainDocumentHttpStatus,
    mainDocumentContentType: sanitizeDiagnosticText(input.mainDocumentContentType, 120)?.toLowerCase() ?? null,
    navigationElapsedMs: Math.max(0, Math.round(input.navigationElapsedMs)),
    domWaitElapsedMs: Math.max(0, Math.round(input.domWaitElapsedMs)),
    documentReadyState: sanitizeDiagnosticText(input.readyState, 40)?.toLowerCase() ?? null,
    title,
    visibleTextLength: Math.max(0, Math.round(input.visibleTextLength ?? input.visibleText.length)),
    diagnosticTextSnippet,
    diagnosticTextHash: stableHash(safeDiagnosticText ?? ""),
    amazonBrandMarker: input.markers.amazonBrand,
    searchBoxMarker: input.markers.searchBox,
    deliveryEntryMarker: input.markers.deliveryEntry,
    regionSelectionMarker: input.markers.regionSelection,
    privacyPrompt: {
      ...input.markers.privacyPrompt,
      tagName: sanitizeDiagnosticText(input.markers.privacyPrompt.tagName, 40)?.toLowerCase() ?? null,
      role: sanitizeDiagnosticText(input.markers.privacyPrompt.role, 60)?.toLowerCase() ?? null,
      matchedText: sanitizeDiagnosticText(input.markers.privacyPrompt.matchedText, 160),
      reasonCodes: [...input.markers.privacyPrompt.reasonCodes],
    },
    captchaRobotCheckMarker: input.markers.captcha,
    loginWall: {
      ...loginWall,
      tagName: sanitizeDiagnosticText(loginWall.tagName, 40)?.toLowerCase() ?? null,
      role: sanitizeDiagnosticText(loginWall.role, 60)?.toLowerCase() ?? null,
      matchedText: sanitizeDiagnosticText(loginWall.matchedText, 160),
      reasonCodes: [...loginWall.reasonCodes],
    },
    loginWallMarker: loginWall.state === "visible_blocking_login" || loginWall.state === "unknown",
    errorUnavailableMarker: input.markers.errorPage,
    browserInternalErrorMarker: input.markers.browserInternalError,
    markerSources: { ...input.markerSources },
    classification: classification.classification,
    classificationReasonCodes: [...classification.reasonCodes],
  };
  return { ...core, evidenceHash: stableHash(core) };
}

function markerSource(root: Document, primarySelector: string, alternateSelector: string): AmazonPageMarkerSource {
  if (root.querySelector(primarySelector)) return "primary";
  return root.querySelector(alternateSelector) ? "alternate" : null;
}

function privacyTextMatches(value: string): boolean {
  return /\bcookie(?:s| preferences| choices| settings)?\b|\bprivacy(?: notice| choices| preferences)?\b|\bbefore you continue\b/i
    .test(value);
}

function privacyControlMatches(value: string): boolean {
  return /\baccept(?: all)?\b|\breject(?: all)?\b|\bagree\b|\bmanage preferences\b|\bcookie settings\b|\bcustomi[sz]e\b/i
    .test(value);
}

function elementIsVisible(root: Document, element: Element): boolean {
  if (element.hasAttribute?.("hidden") || element.getAttribute?.("aria-hidden") === "true") return false;
  const style = root.defaultView?.getComputedStyle?.(element);
  if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
  const rect = element.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

function privacyElementCandidate(
  root: Document,
  element: Element,
  markerSourceValue: AmazonPrivacyMarkerSource,
  selectorCategory: AmazonPrivacySelectorCategory,
): AmazonPrivacyPromptCandidate {
  const text = cleanWhitespace(element.textContent ?? "");
  const controls = Array.from(element.querySelectorAll?.("button, input[type='button'], input[type='submit'], [role='button'], a") ?? []);
  const hasInteractiveControls = controls.some((control) => elementIsVisible(root, control)
    && privacyControlMatches(cleanWhitespace(control.textContent ?? control.getAttribute?.("aria-label") ?? "")));
  const role = element.getAttribute?.("role")?.toLowerCase() ?? null;
  const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : null;
  const style = root.defaultView?.getComputedStyle?.(element);
  const blocksMainContent = element.getAttribute?.("aria-modal") === "true" || role === "dialog" || role === "alertdialog"
    || style?.position === "fixed";
  const insideFooter = Boolean(element.closest?.("footer, #navFooter, [role='contentinfo']"));
  return {
    markerSource: markerSourceValue,
    selectorCategory,
    tagName,
    role,
    visible: elementIsVisible(root, element),
    hasInteractiveControls,
    insideFooter,
    blocksMainContent,
    matchedText: sanitizeDiagnosticText(text, 160),
  };
}

function inspectAmazonPrivacyPromptDom(root: Document, textSample: string): AmazonPrivacyPromptDiagnostic {
  const candidates: AmazonPrivacyPromptCandidate[] = [];
  const seen = new Set<Element>();
  const addCandidates = (
    selector: string,
    source: AmazonPrivacyMarkerSource,
    category: AmazonPrivacySelectorCategory,
    requirePrivacyText: boolean,
  ) => {
    const elements = Array.from(root.querySelectorAll?.(selector) ?? []);
    for (const element of elements) {
      if (seen.has(element)) continue;
      const text = cleanWhitespace(element.textContent ?? "");
      if (requirePrivacyText && !privacyTextMatches(text)) continue;
      seen.add(element);
      candidates.push(privacyElementCandidate(root, element, source, category));
    }
  };
  addCandidates("#sp-cc, [data-cel-widget='sp-cc']",
    "known_amazon_container", "amazon_cookie_container", false);
  addCandidates("[data-testid='consent-banner'], [data-testid='cookie-banner'], [data-testid='privacy-banner'], [data-consent-banner]",
    "known_generic_container", "generic_consent_banner", false);
  addCandidates("[role='dialog'], [role='alertdialog'], [role='banner'], dialog, [aria-modal='true']",
    "semantic_candidate", "semantic_dialog_or_banner", true);
  addCandidates("[id*='cookie'], [id*='privacy'], [id*='consent'], [class*='cookie'], [class*='privacy'], [class*='consent']",
    "semantic_candidate", "privacy_named_container", true);
  addCandidates("footer a, #navFooter a, [role='contentinfo'] a", "footer_link", "footer_privacy_link", true);
  return classifyAmazonPrivacyPrompt({ candidates, pageTextMatched: privacyTextMatches(textSample) });
}

function loginTextMatches(value: string): boolean {
  return /\bsign in to continue\b|\blogin to continue\b|\bplease sign in to continue\b/i.test(value);
}

function loginControlMatches(element: Element): boolean {
  const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : null;
  const type = element.getAttribute?.("type")?.toLowerCase() ?? null;
  if (tagName === "input" && ["email", "password", "submit"].includes(type ?? "")) return true;
  const role = element.getAttribute?.("role")?.toLowerCase() ?? null;
  if (tagName !== "button" && tagName !== "a" && role !== "button") return false;
  const label = cleanWhitespace(element.textContent ?? element.getAttribute?.("aria-label") ?? "");
  return /\bsign in\b|\bcontinue\b|\blog in\b/i.test(label);
}

function loginWallFromCandidate(
  state: AmazonLoginWallState,
  candidate: AmazonLoginWallCandidate,
  reasonCodes: string[],
): AmazonLoginWallDiagnostic {
  return {
    state,
    markerSource: candidate.markerSource,
    selectorCategory: candidate.selectorCategory,
    tagName: sanitizeDiagnosticText(candidate.tagName, 40)?.toLowerCase() ?? null,
    role: sanitizeDiagnosticText(candidate.role, 60)?.toLowerCase() ?? null,
    visible: candidate.visible,
    hasInteractiveControls: candidate.hasInteractiveControls,
    insideNavigation: candidate.insideNavigation,
    blocksMainContent: candidate.blocksMainContent,
    matchedText: sanitizeDiagnosticText(candidate.matchedText, 160),
    reasonCodes,
  };
}

function loginElementCandidate(
  root: Document,
  element: Element,
  markerSourceValue: AmazonLoginMarkerSource,
  selectorCategory: AmazonLoginSelectorCategory,
): AmazonLoginWallCandidate {
  const controls = Array.from(element.querySelectorAll?.(
    "button, input[type='email'], input[type='password'], input[type='submit'], [role='button']",
  ) ?? []);
  const elementItselfIsControl = loginControlMatches(element);
  const hasInteractiveControls = elementItselfIsControl || controls.some((control) =>
    elementIsVisible(root, control) && loginControlMatches(control));
  const role = element.getAttribute?.("role")?.toLowerCase() ?? null;
  const tagName = typeof element.tagName === "string" ? element.tagName.toLowerCase() : null;
  const style = root.defaultView?.getComputedStyle?.(element);
  const blocksMainContent = element.getAttribute?.("aria-modal") === "true" || role === "dialog" || role === "alertdialog"
    || style?.position === "fixed";
  const insideNavigation = Boolean(element.closest?.(
    "header, nav, footer, #navbar, #nav-belt, #nav-main, #navFooter, [role='navigation'], [role='contentinfo']",
  ));
  return {
    markerSource: markerSourceValue,
    selectorCategory,
    tagName,
    role,
    visible: elementIsVisible(root, element),
    hasInteractiveControls,
    insideNavigation,
    blocksMainContent,
    matchedText: sanitizeDiagnosticText(cleanWhitespace(element.textContent ?? ""), 160),
  };
}

export function classifyAmazonLoginWall(input: {
  candidates: AmazonLoginWallCandidate[];
  pageTextMatched: boolean;
}): AmazonLoginWallDiagnostic {
  const confirmed = input.candidates.find((candidate) => candidate.visible
    && !candidate.insideNavigation
    && candidate.hasInteractiveControls
    && (candidate.markerSource === "known_signin_form" || candidate.markerSource === "known_email_input"));
  if (confirmed) {
    return loginWallFromCandidate("visible_blocking_login", confirmed, ["login_visible_interactive_container"]);
  }

  const uncertain = input.candidates.find((candidate) => candidate.visible && !candidate.insideNavigation);
  if (uncertain) {
    return loginWallFromCandidate("unknown", uncertain, ["login_visible_candidate_controls_unconfirmed"]);
  }

  const inactive = input.candidates[0];
  if (inactive) {
    const reason = inactive.insideNavigation ? "login_navigation_signin_only" : "login_inactive_dom_only";
    return loginWallFromCandidate("hidden_or_navigation_signin", inactive, [reason]);
  }

  if (input.pageTextMatched) {
    return {
      state: "unknown",
      markerSource: "explicit_page_text",
      selectorCategory: "explicit_continue_text",
      tagName: null,
      role: null,
      visible: null,
      hasInteractiveControls: null,
      insideNavigation: null,
      blocksMainContent: null,
      matchedText: null,
      reasonCodes: ["login_page_text_without_container"],
    };
  }
  return emptyAmazonLoginWallDiagnostic();
}

function inspectAmazonLoginWallDom(root: Document, textSample: string): AmazonLoginWallDiagnostic {
  const candidates: AmazonLoginWallCandidate[] = [];
  const seen = new Set<Element>();
  const addCandidates = (
    selector: string,
    source: AmazonLoginMarkerSource,
    category: AmazonLoginSelectorCategory,
  ) => {
    const elements = Array.from(root.querySelectorAll?.(selector) ?? []);
    for (const element of elements) {
      if (seen.has(element)) continue;
      seen.add(element);
      candidates.push(loginElementCandidate(root, element, source, category));
    }
  };
  addCandidates("form[name='signIn']", "known_signin_form", "signin_form_name");
  addCandidates("form[action*='signin']", "known_signin_form", "signin_form_action");
  addCandidates("#ap_email", "known_email_input", "amazon_email_input");
  return classifyAmazonLoginWall({ candidates, pageTextMatched: loginTextMatches(textSample) });
}

export function inspectAmazonPageDiagnosticDom(root: Document): AmazonPageDomSignals {
  const bodyText = typeof root.body?.innerText === "string" ? root.body.innerText : root.body?.textContent ?? "";
  const visibleText = typeof bodyText === "string" ? bodyText : "";
  const textSample = cleanWhitespace(visibleText).slice(0, 4_000);
  const amazonBrand = markerSource(root, "#nav-logo", "[aria-label='Amazon'], [aria-label^='Amazon'], a[href='/ref=nav_logo']");
  const searchBox = markerSource(root, "#twotabsearchtextbox", "input[name='field-keywords'], form[role='search'] input[type='text']");
  const deliveryEntry = markerSource(root, "#nav-global-location-popover-link, #glow-ingress-line2",
    "#glow-ingress-block, [aria-label*='location' i], [aria-label*='deliver' i]");
  const regionSelection = Boolean(root.querySelector("#GLUXZipUpdateInput, #GLUXZipUpdate"))
    || /\bchoose your location\b|\bselect your address\b/i.test(textSample);
  const privacyPrompt = inspectAmazonPrivacyPromptDom(root, textSample);
  const captcha = Boolean(root.querySelector("form[action*='validateCaptcha'], #captchacharacters, img[src*='captcha']"))
    || /\brobot check\b|\benter the characters you see\b|\btype the characters you see\b/i.test(textSample);
  const loginWall = inspectAmazonLoginWallDom(root, textSample);
  const errorPage = /\baccess denied\b|\bservice unavailable\b|\binternal server error\b|\bsorry[, ]+something went wrong\b/i
    .test(textSample);
  const browserInternalError = /\bERR_[A-Z_]+\b|\bthis site can['’]?t be reached\b/i.test(textSample);
  return {
    readyState: typeof root.readyState === "string" ? root.readyState : null,
    title: typeof root.title === "string" ? root.title : null,
    visibleText: textSample,
    visibleTextLength: visibleText.length,
    markerSources: { amazonBrand, searchBox, deliveryEntry },
    markers: {
      amazonBrand: amazonBrand !== null,
      searchBox: searchBox !== null,
      deliveryEntry: deliveryEntry !== null,
      regionSelection,
      privacyPrompt,
      captcha,
      loginWall,
      errorPage,
      browserInternalError,
    },
  };
}

function functionSource(fn: (...args: never[]) => unknown): string {
  return fn.toString();
}

export function buildAmazonPageDiagnosticDomExpression(): string {
  return `(() => {
    const cleanWhitespace = ${functionSource(cleanWhitespace)};
    const sanitizeDiagnosticText = ${functionSource(sanitizeDiagnosticText)};
    const markerSource = ${functionSource(markerSource)};
    const privacyPromptFromCandidate = ${functionSource(privacyPromptFromCandidate)};
    const isConfirmedPrivacyContainer = ${functionSource(isConfirmedPrivacyContainer)};
    const classifyAmazonPrivacyPrompt = ${functionSource(classifyAmazonPrivacyPrompt)};
    const privacyTextMatches = ${functionSource(privacyTextMatches)};
    const privacyControlMatches = ${functionSource(privacyControlMatches)};
    const elementIsVisible = ${functionSource(elementIsVisible)};
    const privacyElementCandidate = ${functionSource(privacyElementCandidate)};
    const inspectAmazonPrivacyPromptDom = ${functionSource(inspectAmazonPrivacyPromptDom)};
    const emptyAmazonLoginWallDiagnostic = ${functionSource(emptyAmazonLoginWallDiagnostic)};
    const loginTextMatches = ${functionSource(loginTextMatches)};
    const loginControlMatches = ${functionSource(loginControlMatches)};
    const loginWallFromCandidate = ${functionSource(loginWallFromCandidate)};
    const loginElementCandidate = ${functionSource(loginElementCandidate)};
    const classifyAmazonLoginWall = ${functionSource(classifyAmazonLoginWall)};
    const inspectAmazonLoginWallDom = ${functionSource(inspectAmazonLoginWallDom)};
    const inspectAmazonPageDiagnosticDom = ${functionSource(inspectAmazonPageDiagnosticDom)};
    return inspectAmazonPageDiagnosticDom(document);
  })()`;
}
