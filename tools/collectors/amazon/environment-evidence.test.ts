import { describe, expect, it } from "vitest";
import { buildAmazonEnvironmentSetupEvidence } from "./environment-evidence";
import { evaluateAmazonEnvironment } from "./environment-gate";
import { buildAmazonPageDiagnostic } from "./page-diagnostics";

describe("Amazon environment setup evidence", () => {
  const pageDiagnostic = buildAmazonPageDiagnostic({
    requestedUrl: "https://www.amazon.com/",
    finalUrl: "https://www.amazon.com/",
    redirectUrls: [],
    mainDocumentHttpStatus: 200,
    mainDocumentContentType: "text/html",
    navigationElapsedMs: 500,
    domWaitElapsedMs: 300,
    readyState: "complete",
    title: "Unexpected page",
    visibleText: "Unrecognized page",
    markerSources: { amazonBrand: null, searchBox: null, deliveryEntry: null },
    markers: {
      amazonBrand: false,
      searchBox: false,
      deliveryEntry: false,
      regionSelection: false,
      privacyPrompt: {
        state: "absent", markerSource: "none", selectorCategory: null, tagName: null, role: null,
        visible: null, hasInteractiveControls: null, insideFooter: null, blocksMainContent: null,
        matchedText: null, reasonCodes: ["privacy_signal_absent"],
      },
      captcha: false,
      loginWall: false,
      errorPage: false,
      browserInternalError: false,
    },
  });

  it("records a failed pre-search gate without creating CollectionRun semantics", () => {
    const evidence = buildAmazonEnvironmentSetupEvidence({
      capturedAt: "2026-07-14T05:00:00.000Z",
      browser: "chrome",
      browserVersion: "Chrome/test",
      profileIsolation: "system_temp",
      debugTransport: "loopback_cdp_dynamic_port",
      homepageNavigationCount: 1,
      preferencesNavigationCount: 0,
      searchPageAccessCount: 0,
      searchStarted: false,
      collectionRunGenerated: false,
      gate: evaluateAmazonEnvironment({
        pageStatus: "ok", pageUrl: "https://www.amazon.com/", amazonBrandMarkerPresent: true,
        deliveryRegion: "Deliver to Japan", language: "en-us", currencyPreference: null,
      }),
      steps: [{
        stage: "verify_delivery_after_refresh",
        selector: "#glow-ingress-line2",
        status: "failed",
        textBefore: "Deliver to Japan",
        textAfter: "Deliver to Japan",
        detailCode: "delivery_region_not_us",
      }],
      pageDiagnostics: [pageDiagnostic],
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineCount: 21,
        browserProcessFinalCount: 21,
        browserProcessBaselineRestored: true,
      },
    });

    expect(evidence.schemaVersion).toBe("amazon-environment-setup-evidence.v2");
    expect(evidence.requested).toEqual({
      marketplace: "amazon.com",
      market: "US",
      deliveryRegion: "New York 10001",
      language: "en-us",
      currency: "USD",
    });
    expect(evidence.searchStarted).toBe(false);
    expect(evidence.collectionRunGenerated).toBe(false);
    expect(evidence.pageDiagnostics[0].classification).toBe("unknown_page");
    expect(evidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence).not.toHaveProperty("collectionRun");
  });

  it("includes page diagnostics in the run evidence Hash", () => {
    const common = {
      capturedAt: "2026-07-14T05:00:00.000Z",
      browser: "chrome" as const,
      browserVersion: "Chrome/test",
      profileIsolation: "system_temp" as const,
      debugTransport: "loopback_cdp_dynamic_port" as const,
      homepageNavigationCount: 1,
      preferencesNavigationCount: 0,
      searchPageAccessCount: 0,
      searchStarted: false,
      collectionRunGenerated: false,
      gate: evaluateAmazonEnvironment({
        pageStatus: "unknown_page" as const, pageUrl: "https://www.amazon.com/",
        amazonBrandMarkerPresent: false, deliveryRegion: null, language: null, currencyPreference: null,
      }),
      steps: [],
      cleanup: {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineCount: 0,
        browserProcessFinalCount: 0,
        browserProcessBaselineRestored: true,
      },
    };
    const first = buildAmazonEnvironmentSetupEvidence({ ...common, pageDiagnostics: [pageDiagnostic] });
    const secondDiagnostic = buildAmazonPageDiagnostic({
      requestedUrl: "https://www.amazon.com/",
      finalUrl: "https://www.amazon.com/",
      redirectUrls: [],
      mainDocumentHttpStatus: 503,
      mainDocumentContentType: "text/html",
      navigationElapsedMs: 500,
      domWaitElapsedMs: 300,
      readyState: "complete",
      title: "Service Unavailable",
      visibleText: "Service Unavailable",
      markerSources: { amazonBrand: null, searchBox: null, deliveryEntry: null },
      markers: { amazonBrand: false, searchBox: false, deliveryEntry: false, regionSelection: false,
        privacyPrompt: {
          state: "absent", markerSource: "none", selectorCategory: null, tagName: null, role: null,
          visible: null, hasInteractiveControls: null, insideFooter: null, blocksMainContent: null,
          matchedText: null, reasonCodes: ["privacy_signal_absent"],
        },
        captcha: false, loginWall: false, errorPage: true, browserInternalError: false },
    });
    const second = buildAmazonEnvironmentSetupEvidence({ ...common, pageDiagnostics: [secondDiagnostic] });

    expect(second.evidenceHash).not.toBe(first.evidenceHash);
  });
});
