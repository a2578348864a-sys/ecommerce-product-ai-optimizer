import { describe, expect, it, vi } from "vitest";
import type { SelectionBrief } from "../../../lib/upstream/contracts";
import { buildAmazonPageDiagnostic } from "./page-diagnostics";
import { evaluateAmazonEnvironment } from "./environment-gate";
import type {
  HumanAssistedBrowserCleanup,
  HumanAssistedBrowserSession,
  HumanAssistedPageInspection,
} from "./browser-control";
import * as humanAssisted from "./human-assisted";

const { runHumanAssistedAmazonCurrentPage } = humanAssisted;

const brief: SelectionBrief = {
  schemaVersion: "selection-brief.v1",
  briefId: "brief-human-assisted-amazon-v1",
  marketplace: "amazon.com",
  market: "US",
  query: "closet organizer",
  category: null,
  targetScenario: "small-space closet organization",
  targetPriceRange: { currency: "USD", min: 15, max: 45 },
  requiredEvidence: ["identity", "title", "price", "rating", "review_count"],
  hardExclusions: [],
  sampleBudget: { maxPages: 1, maxAppearances: 20 },
  rankingRuleVersion: "stage1-deterministic-v1.1",
  createdAt: "2026-07-14T05:00:00.000Z",
  approvedBy: "fixture-human-assisted-test",
};

const cleanup: HumanAssistedBrowserCleanup = {
  pageClosed: true,
  browserClosed: true,
  forcedTerminationUsed: false,
  debugPortReleased: true,
  profileRemoved: true,
  browserProcessBaselineRestored: true,
};

function normalDiagnostic(classification: "amazon_normal" | "captcha" = "amazon_normal") {
  const captcha = classification === "captcha";
  return buildAmazonPageDiagnostic({
    requestedUrl: "https://www.amazon.com/s?k=closet+organizer",
    finalUrl: "https://www.amazon.com/s?k=closet+organizer",
    redirectUrls: [],
    mainDocumentHttpStatus: 200,
    mainDocumentContentType: "text/html",
    navigationElapsedMs: 100,
    domWaitElapsedMs: 50,
    readyState: "complete",
    title: captcha ? "Robot Check" : "Amazon.com : closet organizer",
    visibleText: captcha ? "Robot Check enter the characters you see" : "Amazon search results",
    visibleTextLength: 40,
    markerSources: { amazonBrand: captcha ? null : "primary", searchBox: "primary", deliveryEntry: captcha ? null : "primary" },
    markers: {
      amazonBrand: !captcha,
      searchBox: true,
      deliveryEntry: !captcha,
      regionSelection: false,
      privacyPrompt: {
        state: "absent", markerSource: "none", selectorCategory: null, tagName: null, role: null,
        visible: null, hasInteractiveControls: null, insideFooter: null, blocksMainContent: null,
        matchedText: null, reasonCodes: ["privacy_signal_absent"],
      },
      captcha,
      loginWall: false,
      errorPage: false,
      browserInternalError: false,
    },
  });
}

function unexpectedDomainDiagnostic() {
  return buildAmazonPageDiagnostic({
    requestedUrl: "https://www.amazon.com/",
    finalUrl: "https://example.com/redirected",
    redirectUrls: ["https://example.com/redirected"],
    mainDocumentHttpStatus: 200,
    mainDocumentContentType: "text/html",
    navigationElapsedMs: 100,
    domWaitElapsedMs: 50,
    readyState: "complete",
    title: "Unexpected page",
    visibleText: "Not Amazon",
    visibleTextLength: 10,
    markerSources: { amazonBrand: null, searchBox: null, deliveryEntry: null },
    markers: {
      amazonBrand: false, searchBox: false, deliveryEntry: false, regionSelection: false,
      privacyPrompt: {
        state: "absent", markerSource: "none", selectorCategory: null, tagName: null, role: null,
        visible: null, hasInteractiveControls: null, insideFooter: null, blocksMainContent: null,
        matchedText: null, reasonCodes: ["privacy_signal_absent"],
      },
      captcha: false, loginWall: false, errorPage: false, browserInternalError: false,
    },
  });
}

function extraction() {
  return {
    schemaVersion: "amazon-search-page-extraction.v2" as const,
    requested: { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const },
    observed: {
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      deliveryRegion: "Delivering to New York 10001",
      deliveryRegionMarket: "US",
      language: "en-us",
    },
    query: "closet organizer",
    page: 1,
    capturedAt: "2026-07-14T05:00:00.000Z",
    pageStatus: "ok" as const,
    blocked: false,
    keyContainerFound: true,
    rawCardCount: 1,
    sampledObservationIds: ["canary-p1-01"],
    diagnosticVisiblePriceNodeCount: 1,
    observations: [{
      appearanceKey: "canary-p1-01",
      page: 1,
      position: 1,
      sponsored: null,
      sponsoredDiagnostic: {
        schemaVersion: "amazon-sponsored-placement-diagnostic.v1" as const,
        state: null,
        markerSource: "none" as const,
        selectorCategory: "unrecognized_card_structure" as const,
        reasonCode: "insufficient_sponsored_evidence" as const,
        matchedText: null,
      },
      asin: "B0CANARY01",
      identityMissingReason: null,
      title: "Closet organizer",
      priceText: "$29.99",
      priceCurrency: "USD" as const,
      ratingText: "4.5 out of 5 stars",
      reviewCountText: "1.2K",
      brand: null,
      productUrl: "https://www.amazon.com/dp/B0CANARY01",
      imageUrl: "https://images-na.ssl-images-amazon.com/example.jpg",
      capturedAt: "2026-07-14T05:00:00.000Z",
      fieldMissingReasons: { brand: "not_exposed_on_search_card", sponsored: "not_determined" },
    }],
  };
}

function passedInspection(): HumanAssistedPageInspection {
  return {
    diagnostic: normalDiagnostic(),
    allowedSearchPage: true,
    environmentGate: evaluateAmazonEnvironment({
      pageStatus: "ok",
      pageUrl: "https://www.amazon.com/s?k=closet+organizer",
      amazonBrandMarkerPresent: true,
      deliveryRegion: "Delivering to New York 10001",
      language: "en-us",
      currencyPreference: "USD",
    }),
    extraction: extraction(),
  };
}

function fakeSession(inspection = passedInspection()) {
  const inspectCurrentPage = vi.fn(async () => inspection);
  const close = vi.fn(async () => cleanup);
  const session: HumanAssistedBrowserSession = {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/test",
    profileId: "anonymous-temp-profile",
    profileLocationType: "system_temp",
    debugPort: 43123,
    inspectCurrentPage,
    close,
  };
  return { session, inspectCurrentPage, close };
}

describe("human-assisted Amazon current-page collection", () => {
  it("does not inspect or collect before explicit confirmation", async () => {
    const fake = fakeSession();
    const result = await runHumanAssistedAmazonCurrentPage({
      brief,
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 100,
      openSession: async () => fake.session,
      waitForExplicitTrigger: async () => "cancelled",
    });
    expect(result.status).toBe("cancelled");
    expect(result.sourceAdapter).toBeNull();
    expect(result.extractionAttempt).toMatchObject({
      rawCardCount: null,
      extractedObservationCount: null,
      sampledObservationIds: null,
      missingReasons: {
        rawCardCount: "collection_not_started",
        sampledObservationIds: "collection_not_started",
      },
    });
    expect(fake.inspectCurrentPage).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("times out fail-closed and always cleans the owned browser session", async () => {
    vi.useFakeTimers();
    const fake = fakeSession();
    let triggerSignal: AbortSignal | null = null;
    const run = runHumanAssistedAmazonCurrentPage({
      brief,
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 20,
      openSession: async () => fake.session,
      waitForExplicitTrigger: async (signal) => {
        triggerSignal = signal;
        return await new Promise<"cancelled">((resolve) => {
          signal.addEventListener("abort", () => resolve("cancelled"), { once: true });
        });
      },
    });
    await vi.advanceTimersByTimeAsync(21);
    const result = await run;
    vi.useRealTimers();
    expect(result.status).toBe("timed_out");
    expect(result.errorCode).toBe("human_confirmation_timeout");
    expect((triggerSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(result.cleanup).toEqual(cleanup);
    expect(fake.close).toHaveBeenCalledOnce();
  });

  it("blocks Captcha, non-search pages, and market-context conflicts without a source package", async () => {
    const cases: HumanAssistedPageInspection[] = [
      {
        ...passedInspection(),
        diagnostic: normalDiagnostic("captcha"),
        allowedSearchPage: false,
        environmentGate: evaluateAmazonEnvironment({
          pageStatus: "captcha", pageUrl: "https://www.amazon.com/", amazonBrandMarkerPresent: false,
          deliveryRegion: null, language: null, currencyPreference: null,
        }),
        extraction: null,
      },
      {
        ...passedInspection(),
        diagnostic: unexpectedDomainDiagnostic(),
        allowedSearchPage: false,
        environmentGate: evaluateAmazonEnvironment({
          pageStatus: "unknown_page", pageUrl: "https://example.com/redirected", amazonBrandMarkerPresent: false,
          deliveryRegion: null, language: null, currencyPreference: null,
        }),
        extraction: null,
      },
      { ...passedInspection(), allowedSearchPage: false, extraction: null },
      {
        ...passedInspection(),
        environmentGate: evaluateAmazonEnvironment({
          pageStatus: "ok", pageUrl: "https://www.amazon.com/s?k=closet+organizer", amazonBrandMarkerPresent: true,
          deliveryRegion: "Delivering to Japan", language: "ja-jp", currencyPreference: "JPY",
        }),
        extraction: null,
      },
    ];
    for (const inspection of cases) {
      const fake = fakeSession(inspection);
      const result = await runHumanAssistedAmazonCurrentPage({
        brief, collectorVersion: "amazon-human-assisted-cdp.v1", capturedAt: brief.createdAt, timeoutMs: 100,
        openSession: async () => fake.session, waitForExplicitTrigger: async () => "confirmed",
      });
      expect(result.status).toBe("failed");
      expect(result.sourceAdapter).toBeNull();
      expect(result.pageReadCount).toBe(1);
      expect(result.cleanup).toEqual(cleanup);
    }
  });

  it("uses one Privacy reason across the diagnostic, environment gate, and top-level run", async () => {
    const base = normalDiagnostic();
    const diagnostic = buildAmazonPageDiagnostic({
      requestedUrl: "https://www.amazon.com/s?k=closet+organizer",
      finalUrl: "https://www.amazon.com/s?k=closet+organizer",
      redirectUrls: [],
      mainDocumentHttpStatus: 200,
      mainDocumentContentType: "text/html",
      navigationElapsedMs: 0,
      domWaitElapsedMs: 10,
      readyState: "complete",
      title: base.title,
      visibleText: "Deliver to New York 10001 Privacy choices",
      markerSources: { amazonBrand: "primary", searchBox: "primary", deliveryEntry: "primary" },
      markers: {
        amazonBrand: true,
        searchBox: true,
        deliveryEntry: true,
        regionSelection: false,
        privacyPrompt: {
          state: "visible_blocking_prompt", markerSource: "known_amazon_container",
          selectorCategory: "amazon_cookie_container", tagName: "div", role: "banner", visible: true,
          hasInteractiveControls: true, insideFooter: false, blocksMainContent: false,
          matchedText: "Privacy choices Accept Reject", reasonCodes: ["privacy_visible_interactive_prompt"],
        },
        captcha: false,
        loginWall: false,
        errorPage: false,
        browserInternalError: false,
      },
    });
    const environmentGate = evaluateAmazonEnvironment({
      pageStatus: "unknown_page",
      pageErrorCode: diagnostic.classification,
      pageUrl: "https://www.amazon.com/s?k=closet+organizer",
      amazonBrandMarkerPresent: true,
      deliveryRegion: "Delivering to New York 10001",
      language: "en-us",
      currencyPreference: null,
    });
    const fake = fakeSession({ diagnostic, allowedSearchPage: false, environmentGate, extraction: null });

    const result = await runHumanAssistedAmazonCurrentPage({
      brief, collectorVersion: "amazon-human-assisted-cdp.v1", capturedAt: brief.createdAt, timeoutMs: 100,
      openSession: async () => fake.session, waitForExplicitTrigger: async () => "confirmed",
    });

    expect(result.errorCode).toBe("privacy_prompt_visible");
    expect(result.diagnostic?.classification).toBe("privacy_prompt_visible");
    expect(result.environmentGate?.errorCodes).toEqual(["privacy_prompt_visible"]);
    expect(result.environmentGate?.observed).toMatchObject({
      marketplace: "amazon.com",
      market: "US",
      deliveryRegion: "Delivering to New York 10001",
      language: "en-us",
    });
    expect(result.sourceAdapter).toBeNull();
  });

  it("reads at most 20 current-page observations and never adds pagination or detail navigation", async () => {
    const fake = fakeSession();
    const result = await runHumanAssistedAmazonCurrentPage({
      brief, collectorVersion: "amazon-human-assisted-cdp.v1", capturedAt: brief.createdAt, timeoutMs: 100,
      openSession: async () => fake.session, waitForExplicitTrigger: async () => "confirmed",
    });
    expect(result.status).toBe("completed");
    expect(fake.inspectCurrentPage).toHaveBeenCalledWith(expect.objectContaining({ maxAppearances: 20 }));
    expect(result.paginationNavigationCount).toBe(0);
    expect(result.detailNavigationCount).toBe(0);
    expect(result.sourceAdapter?.sourceType).toBe("human_assisted_amazon");
    expect(result.sourceAdapter?.pipeline?.rawObservations).toHaveLength(1);
  });

  it("emits only bounded evidence and no sensitive browser/session payloads", async () => {
    const fake = fakeSession();
    const result = await runHumanAssistedAmazonCurrentPage({
      brief, collectorVersion: "amazon-human-assisted-cdp.v1", capturedAt: brief.createdAt, timeoutMs: 100,
      openSession: async () => fake.session, waitForExplicitTrigger: async () => "confirmed",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/authorization|bearer|localstorage|sessionstorage|set-cookie|fullhtml/i);
    expect(result.sensitiveBrowserDataStored).toBe(false);
    expect(result.formalCandidateGenerated).toBe(false);
    expect(result.productionDatabaseWritten).toBe(false);
  });

  it("retains a v2 extraction attempt when the layout gate fails", async () => {
    const layoutFailedExtraction = {
      ...extraction(),
      rawCardCount: 10,
    };
    const fake = fakeSession({
      ...passedInspection(),
      extraction: layoutFailedExtraction,
    });

    const result = await runHumanAssistedAmazonCurrentPage({
      brief,
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 100,
      openSession: async () => fake.session,
      waitForExplicitTrigger: async () => "confirmed",
    });

    expect(result.schemaVersion).toBe("human-assisted-amazon-run.v2");
    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("suspected_layout_change");
    expect(result.sourceAdapter).toBeNull();
    expect(result.extractionAttempt).toMatchObject({
      schemaVersion: "human-assisted-extraction-attempt.v1",
      captureMode: "human_current_page",
      collectorNavigationPerformed: false,
      requestedSampleLimit: 20,
      rawCardCount: 10,
      expectedSampleCount: 10,
      extractedObservationCount: 1,
      samplingCoverage: {
        observedCount: 1,
        denominator: 10,
        ratio: 0.1,
        missingReason: null,
      },
      sampledObservationIds: ["canary-p1-01"],
      sponsoredCounts: { true: 0, false: 0, null: 1 },
      qualityGate: { status: "passed", errorCodes: [] },
      layoutGate: {
        status: "failed",
        reasonCodes: [
          "sponsored_known_completeness_below_threshold",
        ],
      },
      thresholds: {
        minimumRawCardsForRateChecks: 5,
        minimumIdentityCompleteness: 0.6,
        minimumPriceCompleteness: 0.4,
        minimumSponsoredKnownCompleteness: 0.4,
      },
    });
    expect(result.extractionAttempt?.identityCompleteness).toMatchObject({
      observedCount: 1,
      denominator: 1,
      ratio: 1,
      missingReason: null,
    });
    expect(result.extractionAttempt?.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.extractionAttempt?.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the failed-attempt hash when a critical layout metric changes", async () => {
    const run = async (rawCardCount: number) => {
      const fake = fakeSession({
        ...passedInspection(),
        extraction: { ...extraction(), rawCardCount },
      });
      return await runHumanAssistedAmazonCurrentPage({
        brief,
        collectorVersion: "amazon-human-assisted-cdp.v1",
        capturedAt: brief.createdAt,
        timeoutMs: 100,
        openSession: async () => fake.session,
        waitForExplicitTrigger: async () => "confirmed",
      });
    };

    const first = await run(10);
    const second = await run(11);
    expect(first.extractionAttempt?.evidenceHash).not.toBe(second.extractionAttempt?.evidenceHash);
  });

  it("runtime-validates v2 and marks readable v1 evidence as historically insufficient", async () => {
    const validator = (humanAssisted as unknown as {
      validateHumanAssistedAmazonRun?: (input: unknown) => {
        evidenceStatus: string;
        run: unknown;
      };
    }).validateHumanAssistedAmazonRun;
    expect(validator).toBeTypeOf("function");
    if (!validator) return;

    const fake = fakeSession({
      ...passedInspection(),
      extraction: { ...extraction(), rawCardCount: 10 },
    });
    const current = await runHumanAssistedAmazonCurrentPage({
      brief,
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 100,
      openSession: async () => fake.session,
      waitForExplicitTrigger: async () => "confirmed",
    });
    expect(validator(current).evidenceStatus).toBe("complete");

    const historical = { ...current, schemaVersion: "human-assisted-amazon-run.v1" } as Record<string, unknown>;
    delete historical.extractionAttempt;
    expect(validator(historical).evidenceStatus).toBe("historical_evidence_insufficient");
    expect(() => validator({ ...current, schemaVersion: "human-assisted-amazon-run.v99" }))
      .toThrow("HUMAN_ASSISTED_RUN_VERSION_INVALID");
    expect(() => validator({
      ...current,
      extractionAttempt: { ...current.extractionAttempt, rawCardCount: -1 },
    })).toThrow("HUMAN_ASSISTED_RUN_V2_INVALID");
  });

  it("keeps null gate evidence with reasons when evidence construction throws", async () => {
    const fake = fakeSession({
      ...passedInspection(),
      extraction: { ...extraction(), query: "different query" },
    });
    const result = await runHumanAssistedAmazonCurrentPage({
      brief,
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 100,
      openSession: async () => fake.session,
      waitForExplicitTrigger: async () => "confirmed",
    });

    expect(result.status).toBe("failed");
    expect(result.errorCode).toBe("human_assisted_runtime_failed");
    expect(result.sourceAdapter).toBeNull();
    expect(result.extractionAttempt).toMatchObject({
      rawCardCount: 1,
      qualityGate: null,
      layoutGate: null,
      layoutMetrics: null,
      missingReasons: {
        qualityGate: "gate_evaluation_unavailable",
        layoutGate: "gate_evaluation_unavailable",
        layoutMetrics: "gate_evaluation_unavailable",
      },
    });
  });
});
