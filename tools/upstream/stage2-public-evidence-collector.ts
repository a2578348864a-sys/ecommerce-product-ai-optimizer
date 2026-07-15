import { stableHash } from "../../lib/upstream/pipeline";
import type { HumanAssistedBrowserCleanup, PublicPageNavigationResult } from "../collectors/amazon/browser-control";

export type AlibabaDomSignals = {
  pageUrl: string;
  title: string;
  visibleTextLength: number;
  diagnosticText: string;
  productLinks: string[];
  productTitle: string | null;
  moqText: string | null;
  priceText: string | null;
  packageText: string | null;
};

export type AlibabaPageStatus =
  | "search_results"
  | "supplier_product"
  | "captcha_or_robot_check"
  | "login_wall"
  | "access_denied_or_service_unavailable"
  | "browser_internal_error"
  | "unexpected_origin_redirect"
  | "unknown_page_state";

export type Stage2PublicPageEvidence = {
  requestedOrigin: string;
  requestedPath: string;
  finalOrigin: string | null;
  finalPath: string | null;
  redirectCount: number;
  redirectOrigins: string[];
  httpStatus: number | null;
  contentType: string | null;
  navigationElapsedMs: number;
  domWaitElapsedMs: number;
  readyState: string | null;
  title: string;
  visibleTextLength: number;
  diagnosticTextHash: string;
  classification: AlibabaPageStatus;
  classificationReasonCodes: string[];
  productLinks: string[];
  productTitle: string | null;
  objectiveFields: ReturnType<typeof parseAlibabaObjectiveFields> | null;
  variantIdentity: ReturnType<typeof assessStage2VariantIdentity> | null;
};

const ALIBABA_ORIGIN = "https://www.alibaba.com";

function cleanText(value: string, limit: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:token|authorization|password)\s*[:=]\s*\S+/gi, "[redacted-sensitive]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeUrlParts(value: string): { origin: string | null; path: string | null } {
  try {
    const url = new URL(value);
    return { origin: url.origin, path: url.pathname.slice(0, 300) };
  } catch {
    return { origin: null, path: null };
  }
}

function safeProductUrl(value: string): string | null {
  try {
    const url = new URL(value, ALIBABA_ORIGIN);
    if (url.origin !== ALIBABA_ORIGIN || !url.pathname.includes("/product-detail/")) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export function buildAlibabaDomInspectionExpression(): string {
  return `(() => {
    const clean = (value, limit) => String(value ?? "").replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, limit);
    const body = clean(document.body?.innerText ?? "", 20000);
    const title = clean(document.title, 240);
    const productTitle = clean(document.querySelector("h1")?.textContent ?? document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "", 400) || null;
    const links = Array.from(document.querySelectorAll('a[href*="/product-detail/"]'))
      .map((node) => node.href).filter(Boolean).slice(0, 20);
    const match = (pattern, limit = 300) => clean(body.match(pattern)?.[0] ?? "", limit) || null;
    return {
      pageUrl: location.href,
      title,
      visibleTextLength: Number(document.body?.innerText?.length ?? 0),
      diagnosticText: clean(body.slice(0, 1200), 1200),
      productLinks: links,
      productTitle,
      moqText: match(/(?:minimum order(?: quantity)?|min\\.? order|moq)[^\\n]{0,120}/i),
      priceText: match(/(?:US\\s*\\$|USD|\\$)\\s*\\d+(?:\\.\\d+)?(?:\\s*[-–~]\\s*(?:US\\s*\\$|USD|\\$)?\\s*\\d+(?:\\.\\d+)?)?[^\\n]{0,80}/i),
      packageText: match(/(?:single package size|package size|single gross weight|gross weight)[^\\n]{0,240}/i, 360),
    };
  })()`;
}

export function classifyAlibabaPage(signals: AlibabaDomSignals): { status: AlibabaPageStatus; reasonCodes: string[] } {
  if (/^chrome-error:\/\//i.test(signals.pageUrl)) {
    return { status: "browser_internal_error", reasonCodes: ["chrome_internal_error_page"] };
  }
  let url: URL;
  try { url = new URL(signals.pageUrl); } catch {
    return { status: "unknown_page_state", reasonCodes: ["final_url_invalid"] };
  }
  if (url.origin !== ALIBABA_ORIGIN) {
    return { status: "unexpected_origin_redirect", reasonCodes: ["final_origin_not_allowed"] };
  }
  const text = `${signals.title} ${signals.diagnosticText}`.toLowerCase();
  if (/captcha|robot check|security verification|verify you are human/.test(text)) {
    return { status: "captcha_or_robot_check", reasonCodes: ["captcha_marker_present"] };
  }
  if (/access denied|service unavailable|temporarily unavailable|request blocked/.test(text)) {
    return { status: "access_denied_or_service_unavailable", reasonCodes: ["access_error_marker_present"] };
  }
  if (/login\.alibaba\.com|passport\.alibaba\.com/.test(signals.pageUrl)
    || (signals.visibleTextLength < 1200 && /sign in to continue|log in to continue/.test(text))) {
    return { status: "login_wall", reasonCodes: ["login_wall_marker_present"] };
  }
  if (url.pathname.includes("/product-detail/") && Boolean(signals.productTitle)) {
    return { status: "supplier_product", reasonCodes: ["product_path_and_title_present"] };
  }
  if ((url.pathname.includes("/trade/search") || url.pathname.includes("/showroom/"))
    && signals.productLinks.some((link) => safeProductUrl(link) !== null)) {
    return { status: "search_results", reasonCodes: ["search_path_and_product_links_present"] };
  }
  return { status: "unknown_page_state", reasonCodes: ["required_structured_markers_missing"] };
}

export function hasUnexpectedAlibabaRedirectOrigin(redirectOrigins: readonly string[]): boolean {
  return redirectOrigins.some((origin) => origin !== ALIBABA_ORIGIN);
}

export function parseAlibabaObjectiveFields(input: Pick<AlibabaDomSignals, "moqText" | "priceText" | "packageText">) {
  const moqMatch = input.moqText?.match(/(?:quantity|order|moq)\D{0,30}(\d[\d,]*)/i);
  const packageMatch = input.packageText?.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*cm/i);
  const weightMatch = input.packageText?.match(/(?:gross weight|weight)\D{0,30}(\d+(?:\.\d+)?)\s*kg/i);
  const priceRange = Boolean(input.priceText && /\d\s*[-–~]\s*(?:US\s*\$|USD|\$)?\s*\d/i.test(input.priceText));
  const moq = moqMatch ? Number(moqMatch[1].replace(/,/g, "")) : null;
  return {
    moq: Number.isInteger(moq) && Number(moq) > 0 ? moq : null,
    bom: null,
    packageLengthCm: packageMatch ? Number(packageMatch[1]) : null,
    packageWidthCm: packageMatch ? Number(packageMatch[2]) : null,
    packageHeightCm: packageMatch ? Number(packageMatch[3]) : null,
    packageWeightKg: weightMatch ? Number(weightMatch[1]) : null,
    missingReasons: {
      bom: priceRange ? "price_range_is_not_confirmed_same_variant_bom" : "same_variant_unit_cost_not_confirmed",
    },
  };
}

export type Stage2VariantAssessment = {
  status: "unknown" | "mismatch" | "confirmed";
  reasonCodes: string[];
};

export function assessStage2VariantIdentity(
  amazonTitle: string | null,
  supplierTitle: string | null,
): Stage2VariantAssessment {
  if (!amazonTitle || !supplierTitle) return { status: "unknown" as const, reasonCodes: ["variant_title_missing"] };
  const supplier = supplierTitle.toLowerCase();
  const required = [/hanging/, /closet/, /organi[sz]er/, /(?:6|six)[ -]?(?:shelf|tier|compartment)/];
  if (required.some((term) => !term.test(supplier))) {
    return { status: "mismatch" as const, reasonCodes: ["required_variant_title_feature_mismatch"] };
  }
  return {
    status: "unknown" as const,
    reasonCodes: ["title_similarity_insufficient_for_same_variant_confirmation"],
  };
}

export function buildStage2PublicPageEvidence(input: {
  navigation: PublicPageNavigationResult;
  signals: AlibabaDomSignals;
  amazonTitle: string | null;
}): Stage2PublicPageEvidence {
  const requested = safeUrlParts(input.navigation.requestedUrl);
  const final = safeUrlParts(input.signals.pageUrl || input.navigation.finalUrl);
  const classification = classifyAlibabaPage(input.signals);
  const product = classification.status === "supplier_product";
  return {
    requestedOrigin: requested.origin ?? "invalid_url",
    requestedPath: requested.path ?? "invalid_url",
    finalOrigin: final.origin,
    finalPath: final.path,
    redirectCount: input.navigation.redirectCount,
    redirectOrigins: input.navigation.redirectOrigins,
    httpStatus: input.navigation.mainDocumentHttpStatus,
    contentType: input.navigation.mainDocumentContentType,
    navigationElapsedMs: input.navigation.navigationElapsedMs,
    domWaitElapsedMs: input.navigation.domWaitElapsedMs,
    readyState: input.navigation.readyState,
    title: cleanText(input.signals.title, 240),
    visibleTextLength: input.signals.visibleTextLength,
    diagnosticTextHash: stableHash(cleanText(input.signals.diagnosticText, 1200)),
    classification: classification.status,
    classificationReasonCodes: classification.reasonCodes,
    productLinks: [...new Set(input.signals.productLinks.map(safeProductUrl).filter((url): url is string => url !== null))]
      .slice(0, 10),
    productTitle: product ? cleanText(input.signals.productTitle ?? "", 400) || null : null,
    objectiveFields: product ? parseAlibabaObjectiveFields(input.signals) : null,
    variantIdentity: product ? assessStage2VariantIdentity(input.amazonTitle, input.signals.productTitle) : null,
  };
}

export function buildStage2PublicRunEvidence(input: {
  runId: string;
  briefId: string;
  briefHash: string;
  capturedAt: string;
  status: "completed" | "failed";
  errorCode: string | null;
  reasonCodes: string[];
  pages: Stage2PublicPageEvidence[];
  navigationBudget: { maximum: 4; used: number };
  cleanup: HumanAssistedBrowserCleanup;
}) {
  const { evidenceHash: _ignored, ...inputWithoutHash } = input as typeof input & { evidenceHash?: string };
  const body = {
    schemaVersion: "stage2-public-evidence-collection-run.v1" as const,
    ...inputWithoutHash,
    allowedOrigin: ALIBABA_ORIGIN,
    sampleId: "stage2-high-01" as const,
    requestedEvidenceFields: [
      "supplierUrl", "supplierCapturedAt", "moq", "bom",
      "packageLengthCm", "packageWidthCm", "packageHeightCm", "packageWeightKg",
    ],
    boundary: {
      loginUsed: false,
      privateProfileUsed: false,
      cookieOrStorageRead: false,
      captchaBypassed: false,
      proxyOrAntiDetectionUsed: false,
      databaseWritten: false,
      candidateCreated: false,
      stage1Modified: false,
      paidApiOrExternalAiCalled: false,
      automaticRetryCount: 0,
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}
