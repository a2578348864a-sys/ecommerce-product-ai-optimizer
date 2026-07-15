import { stableHash } from "../../lib/upstream/pipeline";
import type { PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  validateMadeInChinaProbeUrl,
  type MadeInChinaProbePageClassification,
} from "./stage2-alternative-source-probe";

export type MadeInChinaUnknownPageDiagnosticStatus =
  | "diagnostic_evidence_present"
  | "diagnostic_evidence_absent"
  | "diagnostic_evidence_insufficient"
  | "diagnostic_context_blocked"
  | "diagnostic_input_invalid"
  | "not_applicable";

export type MadeInChinaUnknownPageDiagnosticDomSignals = {
  pageUrl: string;
  title: string;
  visibleTextLength: number;
  mainElementCount: number | null;
  headingCount: number | null;
  imageCount: number | null;
  anchorCount: number | null;
  sameOriginAnchorCount: number | null;
  knownSearchContainerCount: number | null;
  genericProductClassElementCount: number | null;
  exactAllowedProductPathCount: number | null;
  looseSameOriginProductPathCount: number | null;
  supplierSubdomainProductPathCount: number | null;
  safeSameOriginPathSamples: string[];
  missingReasons: string[];
};

const COUNT_KEYS = [
  "mainElementCount",
  "headingCount",
  "imageCount",
  "anchorCount",
  "sameOriginAnchorCount",
  "knownSearchContainerCount",
  "genericProductClassElementCount",
  "exactAllowedProductPathCount",
  "looseSameOriginProductPathCount",
  "supplierSubdomainProductPathCount",
] as const;

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

function safePathSamples(value: string[]): { samples: string[]; invalid: boolean } {
  if (!Array.isArray(value) || value.length > 8) return { samples: [], invalid: true };
  let invalid = false;
  const samples: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string" || raw.length > 180 || !raw.startsWith("/")
      || raw.includes("?") || raw.includes("#") || /[\u0000-\u001f\u007f-\u009f]/.test(raw)) {
      invalid = true;
      continue;
    }
    if (!samples.includes(raw)) samples.push(raw);
  }
  return { samples, invalid };
}

function cleanMissingReasons(value: string[]): { reasons: string[]; invalid: boolean } {
  if (!Array.isArray(value) || value.length > 12) return { reasons: [], invalid: true };
  const reasons = [...new Set(value.filter((reason) => typeof reason === "string"
    && /^[a-z0-9_]{1,100}$/.test(reason)))];
  return { reasons, invalid: reasons.length !== value.length };
}

export function buildMadeInChinaUnknownPageDiagnosticDomExpression(): string {
  return `(() => {
    const clean = (value, limit) => String(value ?? "").replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g, " ").replace(/\\s+/g, " ").trim().slice(0, limit);
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const parsed = anchors.map((node) => {
      try { return new URL(node.getAttribute('href') || '', location.href); } catch { return null; }
    }).filter(Boolean);
    const sameOrigin = parsed.filter((url) => url.origin === location.origin);
    const exactAllowed = sameOrigin.filter((url) => /^\\/price\\/prodetail_[A-Za-z0-9_-]+\\.html$/.test(url.pathname) || /^\\/showroom\\/[A-Za-z0-9_-]+\\/product-detail[A-Za-z0-9_-]+\\/China-[^/?#]+\\.html$/.test(url.pathname));
    const looseProduct = sameOrigin.filter((url) => /(?:product|detail|prodetail|showroom|offer)/i.test(url.pathname));
    const supplierProduct = parsed.filter((url) => /(?:^|\\.)en\\.made-in-china\\.com$/i.test(url.hostname) && /(?:product|detail|offer)/i.test(url.pathname));
    const safeSameOriginPathSamples = Array.from(new Set(looseProduct.map((url) => url.pathname.slice(0, 180)).filter((path) => path.startsWith('/')))).slice(0, 8);
    return {
      pageUrl: location.href,
      title: clean(document.title, 240),
      visibleTextLength: Number(document.body?.textContent?.length ?? 0),
      mainElementCount: document.querySelectorAll('main, [role="main"]').length,
      headingCount: document.querySelectorAll('h1, h2, h3').length,
      imageCount: document.querySelectorAll('img').length,
      anchorCount: anchors.length,
      sameOriginAnchorCount: sameOrigin.length,
      knownSearchContainerCount: document.querySelectorAll('[data-role="product-list"], .product-list, #product-list').length,
      genericProductClassElementCount: document.querySelectorAll('[class*="product" i]').length,
      exactAllowedProductPathCount: exactAllowed.length,
      looseSameOriginProductPathCount: looseProduct.length,
      supplierSubdomainProductPathCount: supplierProduct.length,
      safeSameOriginPathSamples,
      missingReasons: [],
    };
  })()`;
}

export function buildMadeInChinaUnknownPageDiagnostic(input: {
  brief: Stage2AlternativeSourceBrief;
  navigation: PublicPageNavigationResult;
  parentClassification: MadeInChinaProbePageClassification;
  parentPageInputHash: string;
  signals: MadeInChinaUnknownPageDiagnosticDomSignals;
}) {
  const requested = safeUrlParts(input.navigation.requestedUrl);
  const final = safeUrlParts(input.navigation.finalUrl);
  const dom = safeUrlParts(input.signals.pageUrl);
  const paths = safePathSamples(input.signals.safeSameOriginPathSamples);
  const missing = cleanMissingReasons(input.signals.missingReasons);
  const normalizedCounts = Object.fromEntries(COUNT_KEYS.map((key) => [key, input.signals[key]])) as {
    [K in typeof COUNT_KEYS[number]]: number | null;
  };
  const invalidCounts = COUNT_KEYS.some((key) => {
    const value = normalizedCounts[key];
    return value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000);
  });
  const missingCounts = COUNT_KEYS.filter((key) => normalizedCounts[key] === null);
  const base = {
    schemaVersion: "stage2-alternative-source-unknown-page-diagnostic.v1" as const,
    briefId: input.brief.briefId,
    briefHash: input.brief.briefHash,
    parentClassification: input.parentClassification,
    parentPageInputHash: input.parentPageInputHash,
    requestedOrigin: requested.origin,
    requestedPath: requested.path,
    finalOrigin: final.origin,
    finalPath: final.path,
    domOrigin: dom.origin,
    domPath: dom.path,
    httpStatus: input.navigation.mainDocumentHttpStatus,
    contentType: cleanText(input.navigation.mainDocumentContentType ?? "", 120) || null,
    readyState: input.navigation.readyState,
    title: cleanText(input.signals.title, 240),
    visibleTextLength: Number.isInteger(input.signals.visibleTextLength)
      && input.signals.visibleTextLength >= 0 ? input.signals.visibleTextLength : null,
    structureCounts: normalizedCounts,
    safeSameOriginPathSamples: paths.samples,
    missingReasons: missing.reasons,
    diagnosticEvidenceHash: stableHash({
      structureCounts: normalizedCounts,
      safeSameOriginPathSamples: paths.samples,
      missingReasons: missing.reasons,
    }),
    failClosedRequired: true as const,
    allowsCollection: false as const,
    fullHtmlStored: false as const,
    pageBodyTextStored: false as const,
  };
  const finish = (status: MadeInChinaUnknownPageDiagnosticStatus, reasonCodes: string[]) => {
    const body = { ...base, status, reasonCodes: [...new Set(reasonCodes)] };
    return { ...body, inputHash: stableHash(body) };
  };

  if (!/^[a-f0-9]{64}$/.test(input.parentPageInputHash)) {
    return finish("diagnostic_input_invalid", ["parent_page_input_hash_invalid"]);
  }
  if (input.parentClassification !== "unknown_page") {
    return finish("not_applicable", ["primary_classification_not_unknown_page"]);
  }
  if (paths.invalid || missing.invalid || invalidCounts || base.visibleTextLength === null) {
    return finish("diagnostic_input_invalid", [
      ...(paths.invalid ? ["diagnostic_safe_path_sample_invalid"] : []),
      ...(missing.invalid ? ["diagnostic_missing_reason_invalid"] : []),
      ...(invalidCounts ? ["diagnostic_structure_count_invalid"] : []),
      ...(base.visibleTextLength === null ? ["diagnostic_visible_text_length_invalid"] : []),
    ]);
  }
  const requestedGate = validateMadeInChinaProbeUrl(input.navigation.requestedUrl, "search", input.brief);
  const finalGate = validateMadeInChinaProbeUrl(input.navigation.finalUrl, "search", input.brief);
  const domGate = validateMadeInChinaProbeUrl(input.signals.pageUrl, "search", input.brief);
  if (!requestedGate.allowed || !finalGate.allowed || !domGate.allowed || !input.navigation.allowedFinalOrigin
    || finalGate.safeUrl !== domGate.safeUrl) {
    return finish("diagnostic_context_blocked", ["diagnostic_origin_or_path_not_allowed"]);
  }
  if ((input.navigation.readyState !== "complete" && input.navigation.readyState !== "interactive")
    || input.navigation.mainDocumentHttpStatus !== 200
    || !input.navigation.mainDocumentContentType?.toLowerCase().includes("text/html")) {
    return finish("diagnostic_context_blocked", ["diagnostic_page_not_stable"]);
  }
  if (missingCounts.length > 0) {
    return finish("diagnostic_evidence_insufficient", [
      "required_structure_counts_missing",
      ...(missing.reasons.length === 0 ? ["missing_reason_not_recorded"] : []),
    ]);
  }

  const reasons = [
    normalizedCounts.knownSearchContainerCount! > 0
      ? "known_search_container_present" : "known_search_container_absent",
    normalizedCounts.mainElementCount! > 0 ? "main_structure_present" : "main_structure_absent",
    normalizedCounts.genericProductClassElementCount! > 0
      ? "generic_product_class_elements_present" : "generic_product_class_elements_absent",
    normalizedCounts.exactAllowedProductPathCount! > 0
      ? "exact_allowed_product_paths_present" : "exact_allowed_product_paths_absent",
    normalizedCounts.looseSameOriginProductPathCount! > 0
      ? "loose_same_origin_product_paths_present" : "loose_same_origin_product_paths_absent",
    normalizedCounts.supplierSubdomainProductPathCount! > 0
      ? "supplier_subdomain_product_paths_present" : "supplier_subdomain_product_paths_absent",
  ];
  if (normalizedCounts.supplierSubdomainProductPathCount! > 0) {
    reasons.push("unsafe_supplier_subdomain_paths_observed");
  }
  const evidencePresent = normalizedCounts.knownSearchContainerCount! > 0
    || normalizedCounts.genericProductClassElementCount! > 0
    || normalizedCounts.exactAllowedProductPathCount! > 0
    || normalizedCounts.looseSameOriginProductPathCount! > 0
    || normalizedCounts.supplierSubdomainProductPathCount! > 0;
  return finish(evidencePresent ? "diagnostic_evidence_present" : "diagnostic_evidence_absent", reasons);
}
