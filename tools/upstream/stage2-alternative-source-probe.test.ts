import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validatePublicDomExpression, type PublicPageNavigationResult } from "../collectors/amazon/browser-control";
import type { Stage2AlternativeSourceBrief } from "./stage2-alternative-source-brief";
import {
  buildMadeInChinaProbeDomExpression,
  buildStage2AlternativeSourcePolicyPreflight,
  classifyMadeInChinaProbePage,
  validateMadeInChinaProbeUrl,
  type MadeInChinaProbeDomSignals,
} from "./stage2-alternative-source-probe";

const PROJECT_ROOT = resolve(import.meta.dirname, "../../..");
const brief = JSON.parse(readFileSync(resolve(PROJECT_ROOT,
  "06_测试与验证/2026-07-15-Phase-Stage2-Alternative-Source-Brief-02-Authoritative/stage2-alternative-source-brief.v1.json"),
"utf8")) as Stage2AlternativeSourceBrief;

const navigation: PublicPageNavigationResult = {
  requestedUrl: brief.search.startUrl,
  finalUrl: brief.search.startUrl,
  redirectOrigins: [],
  redirectCount: 0,
  mainDocumentHttpStatus: 200,
  mainDocumentContentType: "text/html; charset=UTF-8",
  navigationElapsedMs: 240,
  domWaitElapsedMs: 80,
  readyState: "complete",
  allowedFinalOrigin: true,
};

const normalSignals: MadeInChinaProbeDomSignals = {
  pageUrl: brief.search.startUrl,
  title: "Hanging Organizer Manufacturers & Suppliers - Made-in-China.com",
  visibleTextLength: 6200,
  brandMarker: true,
  brandTitleMarker: true,
  searchContainerMarker: true,
  alternateSearchContainerMarker: false,
  captchaMarker: false,
  loginOrInquiryMarker: false,
  accessDeniedMarker: false,
  serviceUnavailableMarker: false,
  candidateProductLinks: [
    "https://www.made-in-china.com/price/prodetail_example-ABC123.html?source=search#details",
  ],
};

describe("Stage 2 alternative source capability probe contract", () => {
  it("accepts only the frozen search and exact product paths and strips query/hash", () => {
    expect(validateMadeInChinaProbeUrl(brief.search.startUrl, "search", brief)).toEqual({
      allowed: true,
      safeUrl: brief.search.startUrl,
      reasonCode: null,
    });
    expect(validateMadeInChinaProbeUrl(
      "https://www.made-in-china.com/price/prodetail_example-ABC123.html?source=search#details",
      "product",
      brief,
    )).toEqual({
      allowed: true,
      safeUrl: "https://www.made-in-china.com/price/prodetail_example-ABC123.html",
      reasonCode: null,
    });
    expect(validateMadeInChinaProbeUrl(
      "https://www.made-in-china.com/showroom/acme/product-detailABC123/China-Closet-Organizer.html",
      "product",
      brief,
    ).allowed).toBe(true);
  });

  it.each([
    ["http://www.made-in-china.com/price/prodetail_example-ABC123.html", "http_not_allowed"],
    ["https://supplier.en.made-in-china.com/product/example.html", "origin_not_allowed"],
    ["https://www.made-in-china.com/showroom/", "product_path_not_allowed"],
    ["https://example.com/products-search/example", "origin_not_allowed"],
    ["not a url", "url_invalid"],
  ])("rejects unsafe or over-broad URL %s", (url, reasonCode) => {
    expect(validateMadeInChinaProbeUrl(url, "product", brief)).toMatchObject({
      allowed: false,
      safeUrl: null,
      reasonCode,
    });
  });

  it("allows policy preflight only when robots and reviewed terms both allow the probe", () => {
    const allowed = buildStage2AlternativeSourcePolicyPreflight({
      brief,
      robotsText: "User-agent: *\nDisallow: /private/\nAllow: /products-search/\n",
      termsDecision: "reviewed_allows_public_capability_probe",
      evaluatedAt: "2026-07-15T02:00:00.000Z",
      requestCount: 1,
    });
    expect(allowed).toMatchObject({
      status: "allowed",
      robotsDecision: "allowed",
      termsDecision: "reviewed_allows_public_capability_probe",
      reasonCodes: [],
      requestCount: 1,
    });
    expect(allowed).not.toHaveProperty("robotsText");

    const disallowed = buildStage2AlternativeSourcePolicyPreflight({
      brief,
      robotsText: "User-agent: *\nDisallow: /\n",
      termsDecision: "reviewed_allows_public_capability_probe",
      evaluatedAt: "2026-07-15T02:00:00.000Z",
      requestCount: 1,
    });
    expect(disallowed).toMatchObject({
      status: "blocked",
      robotsDecision: "disallowed",
      reasonCodes: ["robots_disallows_search_path"],
    });

    const unknown = buildStage2AlternativeSourcePolicyPreflight({
      brief,
      robotsText: "",
      termsDecision: "unknown",
      evaluatedAt: "2026-07-15T02:00:00.000Z",
      requestCount: 1,
    });
    expect(unknown.status).toBe("blocked");
    expect(unknown.reasonCodes).toEqual(expect.arrayContaining([
      "robots_policy_unknown",
      "terms_policy_unknown",
    ]));
    expect(new Set([allowed.inputHash, disallowed.inputHash, unknown.inputHash]).size).toBe(3);
  });

  it("builds a whitelist-only DOM expression accepted by the shared sensitive API guard", () => {
    const expression = buildMadeInChinaProbeDomExpression();
    expect(() => validatePublicDomExpression(expression)).not.toThrow();
    expect(expression).not.toMatch(/document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB/i);
    expect(expression).toContain("candidateProductLinks");
  });

  it("classifies standard and mildly changed search DOM as ready using the real classifier", () => {
    const standard = classifyMadeInChinaProbePage({ brief, navigation, signals: normalSignals });
    expect(standard).toMatchObject({
      classification: "search_results_ready",
      classificationReasonCodes: ["search_page_markers_and_allowed_links_present"],
      allowedProductUrls: ["https://www.made-in-china.com/price/prodetail_example-ABC123.html"],
      rejectedProductLinkCount: 0,
    });

    const mildChange = classifyMadeInChinaProbePage({
      brief,
      navigation,
      signals: {
        ...normalSignals,
        brandMarker: false,
        brandTitleMarker: true,
        searchContainerMarker: false,
        alternateSearchContainerMarker: true,
      },
    });
    expect(mildChange.classification).toBe("search_results_ready");
  });

  it("changes the page input hash when a key navigation or diagnostic field changes", () => {
    const baseline = classifyMadeInChinaProbePage({ brief, navigation, signals: normalSignals });
    const changedTiming = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...navigation, navigationElapsedMs: navigation.navigationElapsedMs + 1 },
      signals: normalSignals,
    });
    const changedMarker = classifyMadeInChinaProbePage({
      brief,
      navigation,
      signals: { ...normalSignals, brandMarker: false },
    });
    expect(new Set([baseline.inputHash, changedTiming.inputHash, changedMarker.inputHash]).size).toBe(3);
  });

  it.each([
    ["loading", { readyState: "loading" }, {}, "page_still_loading"],
    ["captcha_or_robot_check", {}, { captchaMarker: true }, "captcha_marker_present"],
    ["login_or_inquiry_required", {}, { loginOrInquiryMarker: true }, "login_or_inquiry_marker_present"],
    ["access_denied", { mainDocumentHttpStatus: 403 }, { accessDeniedMarker: true }, "access_denied_marker_present"],
    ["service_unavailable", { mainDocumentHttpStatus: 503 }, { serviceUnavailableMarker: true }, "service_unavailable_marker_present"],
    ["browser_internal_error", { finalUrl: "chrome-error://chromewebdata/", allowedFinalOrigin: false },
      { pageUrl: "chrome-error://chromewebdata/" }, "browser_internal_error_page"],
    ["unknown_page", {}, { brandMarker: false, brandTitleMarker: false }, "brand_marker_missing"],
  ])("fails closed for %s", (classification, navigationPatch, signalPatch, reasonCode) => {
    const result = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...navigation, ...navigationPatch },
      signals: { ...normalSignals, ...signalPatch },
    });
    expect(result.classification).toBe(classification);
    expect(result.classificationReasonCodes).toContain(reasonCode);
  });

  it("fails closed when selected product-card links include an unsafe origin or no allowed link", () => {
    const unsafe = classifyMadeInChinaProbePage({
      brief,
      navigation,
      signals: {
        ...normalSignals,
        candidateProductLinks: [
          normalSignals.candidateProductLinks[0],
          "https://supplier.en.made-in-china.com/product/example.html",
        ],
      },
    });
    expect(unsafe).toMatchObject({
      classification: "unexpected_origin_redirect",
      classificationReasonCodes: ["candidate_product_link_origin_not_allowed"],
      rejectedProductLinkCount: 1,
    });

    const none = classifyMadeInChinaProbePage({
      brief,
      navigation,
      signals: { ...normalSignals, candidateProductLinks: [] },
    });
    expect(none).toMatchObject({
      classification: "unknown_page",
      classificationReasonCodes: ["no_allowed_product_links"],
    });
  });

  it("distinguishes HTTP status evidence from a DOM error marker", () => {
    const accessByStatus = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...navigation, mainDocumentHttpStatus: 403 },
      signals: { ...normalSignals, accessDeniedMarker: false },
    });
    expect(accessByStatus.classificationReasonCodes).toEqual(["access_denied_http_status"]);

    const serviceByStatus = classifyMadeInChinaProbePage({
      brief,
      navigation: { ...navigation, mainDocumentHttpStatus: 503 },
      signals: { ...normalSignals, serviceUnavailableMarker: false },
    });
    expect(serviceByStatus.classificationReasonCodes).toEqual(["service_unavailable_http_status"]);
  });
});
