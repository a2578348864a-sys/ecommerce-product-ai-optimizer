import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SelectionBrief } from "../../../lib/upstream/contracts";
import type { HumanAssistedBrowserSession } from "./browser-control";
import { evaluateAmazonEnvironment } from "./environment-gate";
import {
  runHumanAssistedAmazonCurrentPage,
  validateHumanAssistedAmazonRun,
} from "./human-assisted";
import { buildAmazonPageDiagnostic } from "./page-diagnostics";

type FixtureCase = {
  id: string;
  requestedSampleLimit: number;
  rawCardCount: number;
  observationCount: number;
  invalidIdentityPositions: number[];
  missingTitlePositions: number[];
  missingPricePositions: number[];
  missingRatingPositions: number[];
  missingReviewPositions: number[];
  missingImagePositions: number[];
  sponsoredStates: Array<boolean | null>;
  keyContainerFound: boolean;
};

const expectedOutcomes: Record<string, {
  quality: "passed" | "failed";
  layout: "passed" | "failed";
  reasons: string[];
}> = {
  "normal-five": { quality: "passed", layout: "passed", reasons: [] },
  "no-product-cards": { quality: "failed", layout: "failed", reasons: ["key_container_missing"] },
  "cards-present-observations-zero": { quality: "failed", layout: "failed", reasons: ["observation_extraction_empty"] },
  "identity-incomplete": { quality: "passed", layout: "failed", reasons: ["identity_completeness_below_threshold"] },
  "price-incomplete": { quality: "passed", layout: "failed", reasons: ["price_completeness_below_threshold"] },
  "rating-review-incomplete": { quality: "passed", layout: "passed", reasons: [] },
  "title-incomplete": { quality: "passed", layout: "passed", reasons: [] },
  "sponsored-all-unknown": { quality: "passed", layout: "failed", reasons: ["sponsored_known_completeness_below_threshold"] },
  "below-rate-check-minimum": { quality: "passed", layout: "passed", reasons: [] },
  "multiple-layout-failures": {
    quality: "passed",
    layout: "failed",
    reasons: [
      "identity_completeness_below_threshold",
      "price_completeness_below_threshold",
      "sponsored_known_completeness_below_threshold",
    ],
  },
  "quality-only-failure": { quality: "failed", layout: "passed", reasons: [] },
  "canary-09-equivalent-sample-cap": { quality: "passed", layout: "passed", reasons: [] },
  "image-incomplete-but-gates-pass": { quality: "passed", layout: "passed", reasons: [] },
  "partial-sampling-three": { quality: "passed", layout: "passed", reasons: [] },
  "identity-exact-threshold": { quality: "passed", layout: "passed", reasons: [] },
  "raw-ten-complete-five": { quality: "passed", layout: "passed", reasons: [] },
  "extracted-exceeds-expected": {
    quality: "failed",
    layout: "failed",
    reasons: ["extracted_count_exceeds_expected_sample_count"],
  },
};

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/human-assisted-layout-cases.v1.json", import.meta.url),
  "utf8",
)) as { schemaVersion: string; cases: FixtureCase[] };
const canary09Path = resolve(
  process.cwd(),
  "..",
  "06_测试与验证",
  "2026-07-14-Phase-Amazon-Human-Assisted-Canary-09",
  "human-assisted-amazon-5-canary.v1.json",
);
const canary10Path = resolve(
  process.cwd(),
  "..",
  "06_测试与验证",
  "2026-07-14-Phase-Amazon-Human-Assisted-Canary-10",
  "human-assisted-amazon-run.v2.json",
);
const canary14Path = resolve(
  process.cwd(),
  "..",
  "06_测试与验证",
  "2026-07-14-Phase-Amazon-Human-Assisted-Canary-14",
  "human-assisted-amazon-run.v2.json",
);

const brief: SelectionBrief = {
  schemaVersion: "selection-brief.v1",
  briefId: "brief-human-assisted-evidence-v2",
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
  createdAt: "2026-07-14T08:00:00.000Z",
  approvedBy: "offline-layout-fixture",
};

function buildExtraction(testCase: FixtureCase) {
  const observations = Array.from({ length: testCase.observationCount }, (_, index) => {
    const asin = testCase.invalidIdentityPositions.includes(index)
      ? null
      : `B0FIX${String(index + 1).padStart(5, "0")}`;
    const priceMissing = testCase.missingPricePositions.includes(index);
    const sponsored = testCase.sponsoredStates[index] ?? null;
    return {
      appearanceKey: `fixture-${testCase.id}-${index + 1}`,
      page: 1,
      position: index + 1,
      sponsored,
      sponsoredDiagnostic: sponsored === true ? {
        schemaVersion: "amazon-sponsored-placement-diagnostic.v1" as const,
        state: true as const,
        markerSource: "known_dom_selector" as const,
        selectorCategory: "aria_label_sponsored" as const,
        reasonCode: "sponsored_marker_present" as const,
        matchedText: "Sponsored",
      } : sponsored === false ? {
        schemaVersion: "amazon-sponsored-placement-diagnostic.v1" as const,
        state: false as const,
        markerSource: "known_card_structure" as const,
        selectorCategory: "standard_search_result_card" as const,
        reasonCode: "known_organic_structure" as const,
        matchedText: null,
      } : {
        schemaVersion: "amazon-sponsored-placement-diagnostic.v1" as const,
        state: null,
        markerSource: "visible_text" as const,
        selectorCategory: "ambiguous_ad_text" as const,
        reasonCode: "ambiguous_ad_text_without_known_marker" as const,
        matchedText: "Promoted",
      },
      asin,
      identityMissingReason: asin ? null : "asin_not_found",
      title: testCase.missingTitlePositions.includes(index) ? null : `Fixture product ${index + 1}`,
      priceText: priceMissing ? null : "$29.99",
      priceCurrency: priceMissing ? null : "USD" as const,
      ratingText: testCase.missingRatingPositions.includes(index) ? null : "4.5 out of 5 stars",
      reviewCountText: testCase.missingReviewPositions.includes(index) ? null : "120",
      brand: null,
      productUrl: asin ? `https://www.amazon.com/dp/${asin}` : null,
      imageUrl: testCase.missingImagePositions.includes(index)
        ? null
        : `https://images-na.ssl-images-amazon.com/fixture-${index + 1}.jpg`,
      capturedAt: brief.createdAt,
      fieldMissingReasons: {
        brand: "not_exposed_on_search_card",
        ...(priceMissing ? { price: "not_visible" } : {}),
      },
    };
  });
  return {
    schemaVersion: "amazon-search-page-extraction.v2" as const,
    requested: { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const },
    observed: {
      marketplace: "amazon.com",
      market: "US",
      currency: "USD",
      deliveryRegion: "Deliver to New York 10001",
      deliveryRegionMarket: "US",
      language: "en-us",
    },
    query: "closet organizer" as const,
    page: 1,
    capturedAt: brief.createdAt,
    pageStatus: "ok" as const,
    blocked: false,
    keyContainerFound: testCase.keyContainerFound,
    rawCardCount: testCase.rawCardCount,
    sampledObservationIds: observations.map((item) => item.appearanceKey),
    diagnosticVisiblePriceNodeCount: observations.filter((item) => item.priceText !== null).length,
    observations,
  };
}

function diagnostic(privacyState: "absent" | "page_text_only" = "absent") {
  return buildAmazonPageDiagnostic({
    requestedUrl: "https://www.amazon.com/s?k=closet+organizer",
    finalUrl: "https://www.amazon.com/s?k=closet+organizer",
    redirectUrls: [],
    mainDocumentHttpStatus: 200,
    mainDocumentContentType: "text/html",
    navigationElapsedMs: 0,
    domWaitElapsedMs: 10,
    readyState: "complete",
    title: "Amazon.com : closet organizer",
    visibleText: "Deliver to New York 10001 search results Privacy Notice",
    visibleTextLength: 60,
    markerSources: { amazonBrand: "primary", searchBox: "primary", deliveryEntry: "primary" },
    markers: {
      amazonBrand: true,
      searchBox: true,
      deliveryEntry: true,
      regionSelection: false,
      privacyPrompt: privacyState === "page_text_only" ? {
        state: "page_text_only",
        markerSource: "known_amazon_container",
        selectorCategory: "amazon_cookie_container",
        tagName: "div",
        role: null,
        visible: false,
        hasInteractiveControls: false,
        insideFooter: false,
        blocksMainContent: false,
        matchedText: "Privacy Notice",
        reasonCodes: ["privacy_inactive_dom_only"],
      } : {
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
      },
      captcha: false,
      loginWall: false,
      errorPage: false,
      browserInternalError: false,
    },
  });
}

function sessionFor(testCase: FixtureCase): HumanAssistedBrowserSession {
  const pageDiagnostic = diagnostic(testCase.id === "canary-09-equivalent-sample-cap" ? "page_text_only" : "absent");
  return {
    browser: "chrome",
    browserLocationType: "system",
    browserVersion: "Chrome/offline-fixture",
    profileId: "offline-fixture-profile",
    profileLocationType: "system_temp",
    debugPort: 43123,
    inspectCurrentPage: async () => ({
      diagnostic: pageDiagnostic,
      allowedSearchPage: true,
      environmentGate: evaluateAmazonEnvironment({
        pageStatus: "ok",
        pageUrl: "https://www.amazon.com/s?k=closet+organizer",
        amazonBrandMarkerPresent: true,
        deliveryRegion: "Deliver to New York 10001",
        language: "en-us",
        currencyPreference: "USD",
      }),
      extraction: buildExtraction(testCase),
    }),
    close: async () => ({
      pageClosed: true,
      browserClosed: true,
      forcedTerminationUsed: false,
      debugPortReleased: true,
      profileRemoved: true,
      browserProcessBaselineRestored: true,
    }),
  };
}

async function runCase(testCase: FixtureCase) {
  const caseBrief = {
    ...brief,
    sampleBudget: { ...brief.sampleBudget, maxAppearances: testCase.requestedSampleLimit },
  };
  return await runHumanAssistedAmazonCurrentPage({
    brief: caseBrief,
    collectorVersion: "amazon-human-assisted-cdp.v1",
    capturedAt: brief.createdAt,
    timeoutMs: 100,
    openSession: async () => sessionFor(testCase),
    waitForExplicitTrigger: async () => "confirmed",
  });
}

describe("human-assisted extraction attempt v2 offline matrix", () => {
  it("loads the versioned fixture", () => {
    expect(fixture.schemaVersion).toBe("human-assisted-layout-cases.v1");
    expect(fixture.cases).toHaveLength(17);
    expect(Object.keys(expectedOutcomes).sort()).toEqual(fixture.cases.map((item) => item.id).sort());
  });

  for (const testCase of fixture.cases) {
    it(`preserves gate evidence for ${testCase.id}`, async () => {
      const result = await runCase(testCase);
      const attempt = result.extractionAttempt;
      const expected = expectedOutcomes[testCase.id];
      expect(attempt.captureMode).toBe("human_current_page");
      expect(attempt.collectorNavigationPerformed).toBe(false);
      expect(attempt.rawCardCount).toBe(testCase.rawCardCount);
      expect(attempt.requestedSampleLimit).toBe(testCase.requestedSampleLimit);
      expect(attempt.expectedSampleCount).toBe(Math.min(testCase.rawCardCount, testCase.requestedSampleLimit));
      expect(attempt.extractedObservationCount).toBe(testCase.observationCount);
      expect(attempt.sampledObservationIds).toHaveLength(testCase.observationCount);
      expect(attempt.qualityGate?.status).toBe(expected.quality);
      expect(attempt.layoutGate?.status).toBe(expected.layout);
      expect(attempt.layoutGate?.reasonCodes).toEqual(expected.reasons);
      expect(attempt.layoutMetrics).not.toBeNull();
      expect(attempt.thresholds).toEqual({
        minimumRawCardsForRateChecks: 5,
        minimumIdentityCompleteness: 0.6,
        minimumPriceCompleteness: 0.4,
        minimumSponsoredKnownCompleteness: 0.4,
      });
      expect(attempt.inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(attempt.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(validateHumanAssistedAmazonRun(result).evidenceStatus).toBe("complete");
      expect(JSON.stringify(result)).not.toMatch(/authorization|bearer|set-cookie|localstorage|sessionstorage|<html/i);

      const failed = expected.quality === "failed" || expected.layout === "failed";
      expect(result.status).toBe(failed ? "failed" : "completed");
      if (failed) {
        expect(result.sourceAdapter).toBeNull();
        expect(result.formalCandidateGenerated).toBe(false);
        expect(result.productionDatabaseWritten).toBe(false);
        expect(attempt.reasonCodes.length).toBeGreaterThan(0);
      }
    });
  }

  it("keeps unknown ratios null with an explicit reason instead of zero", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "no-product-cards")!);
    expect(result.extractionAttempt.identityCompleteness).toEqual({
      observedCount: 0,
      denominator: 0,
      ratio: null,
      missingReason: "no_extracted_observations",
    });
    expect(result.extractionAttempt.samplingCoverage).toEqual({
      observedCount: 0,
      denominator: 0,
      ratio: null,
      missingReason: "no_expected_sample",
    });
  });

  it("records zero sampling coverage and explicit extraction failure when cards exist but nothing is extracted", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "cards-present-observations-zero")!);
    expect(result.extractionAttempt.samplingCoverage).toEqual({
      observedCount: 0,
      denominator: 5,
      ratio: 0,
      missingReason: null,
    });
    expect(result.extractionAttempt.identityCompleteness).toMatchObject({
      denominator: 0,
      ratio: null,
      missingReason: "no_extracted_observations",
    });
    expect(result.extractionAttempt.layoutGate?.reasonCodes).toContain("observation_extraction_empty");
  });

  it("does not invent a below-minimum failure when the frozen rate check is not applied", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "below-rate-check-minimum")!);
    expect(result.extractionAttempt.layoutGate).toMatchObject({
      status: "passed",
      rateChecksApplied: false,
      reasonCodes: [],
    });
  });

  it("does not fail a Canary 09-equivalent fixture merely because the page has more cards than the sample limit", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "canary-09-equivalent-sample-cap")!);
    expect(result.diagnostic?.privacyPrompt.state).toBe("page_text_only");
    expect(result.environmentGate?.status).toBe("passed");
    expect(result.status).toBe("completed");
    expect(result.extractionAttempt.samplingCoverage.ratio).toBe(1);
    expect(result.extractionAttempt.identityCompleteness.ratio).toBe(1);
    expect(result.extractionAttempt.layoutGate?.reasonCodes).toEqual([]);
    expect(result.sourceAdapter).not.toBeNull();
  });

  it("separates sampling coverage from field completeness without adding a sampling threshold", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "partial-sampling-three")!);
    expect(result.extractionAttempt.samplingCoverage).toEqual({
      observedCount: 3,
      denominator: 5,
      ratio: 0.6,
      missingReason: null,
    });
    expect(result.extractionAttempt.identityCompleteness.ratio).toBe(1);
    expect(result.extractionAttempt.priceCompleteness.ratio).toBe(1);
    expect(result.extractionAttempt.layoutGate?.status).toBe("passed");
  });

  it("uses extracted observations as every field completeness denominator", async () => {
    const exactThreshold = await runCase(fixture.cases.find((item) => item.id === "identity-exact-threshold")!);
    expect(exactThreshold.extractionAttempt.identityCompleteness).toMatchObject({
      observedCount: 3,
      denominator: 5,
      ratio: 0.6,
    });
    const priceFailure = await runCase(fixture.cases.find((item) => item.id === "price-incomplete")!);
    expect(priceFailure.extractionAttempt.priceCompleteness).toMatchObject({ denominator: 5, ratio: 0.2 });
    const sponsoredFailure = await runCase(fixture.cases.find((item) => item.id === "sponsored-all-unknown")!);
    expect(sponsoredFailure.extractionAttempt.sponsoredKnownCompleteness).toMatchObject({ denominator: 5, ratio: 0 });
  });

  it("fails closed when sampled IDs and extracted observations disagree", async () => {
    const testCase = fixture.cases[0];
    const broken = buildExtraction(testCase);
    broken.sampledObservationIds = broken.sampledObservationIds.slice(1);
    const custom = { ...testCase, id: "sample-id-mismatch" };
    const pageDiagnostic = diagnostic();
    const result = await runHumanAssistedAmazonCurrentPage({
      brief: { ...brief, sampleBudget: { ...brief.sampleBudget, maxAppearances: 5 } },
      collectorVersion: "amazon-human-assisted-cdp.v1",
      capturedAt: brief.createdAt,
      timeoutMs: 100,
      openSession: async () => ({
        ...sessionFor(custom),
        inspectCurrentPage: async () => ({
          diagnostic: pageDiagnostic,
          allowedSearchPage: true,
          environmentGate: evaluateAmazonEnvironment({
            pageStatus: "ok",
            pageUrl: "https://www.amazon.com/s?k=closet+organizer",
            amazonBrandMarkerPresent: true,
            deliveryRegion: "Deliver to New York 10001",
            language: "en-us",
            currencyPreference: "USD",
          }),
          extraction: broken,
        }),
      }),
      waitForExplicitTrigger: async () => "confirmed",
    });
    expect(result.status).toBe("failed");
    expect(result.extractionAttempt.qualityGate?.errorCodes).toContain("sampled_observation_count_mismatch");
    expect(result.sourceAdapter).toBeNull();
    expect(validateHumanAssistedAmazonRun(result).evidenceStatus).toBe("complete");
  });

  it("fails closed when extracted observations exceed the discovered bounded sample", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "extracted-exceeds-expected")!);
    expect(result.extractionAttempt.samplingCoverage).toMatchObject({
      observedCount: 5,
      denominator: 4,
      ratio: 1.25,
    });
    expect(result.extractionAttempt.qualityGate?.errorCodes)
      .toContain("extracted_count_exceeds_expected_sample_count");
    expect(result.extractionAttempt.layoutGate?.reasonCodes)
      .toContain("extracted_count_exceeds_expected_sample_count");
    expect(result.sourceAdapter).toBeNull();
    expect(validateHumanAssistedAmazonRun(result).evidenceStatus).toBe("complete");
  });

  it("binds sampling diagnostics to hashes and rejects derived-value tampering", async () => {
    const first = await runCase(fixture.cases.find((item) => item.id === "raw-ten-complete-five")!);
    const second = await runCase(fixture.cases.find((item) => item.id === "partial-sampling-three")!);
    expect(first.extractionAttempt.inputHash).not.toBe(second.extractionAttempt.inputHash);
    expect(first.extractionAttempt.evidenceHash).not.toBe(second.extractionAttempt.evidenceHash);

    const fieldComplete = await runCase(fixture.cases.find((item) => item.id === "normal-five")!);
    const fieldIncomplete = await runCase(fixture.cases.find((item) => item.id === "identity-exact-threshold")!);
    expect(fieldComplete.extractionAttempt.inputHash).not.toBe(fieldIncomplete.extractionAttempt.inputHash);
    expect(fieldComplete.extractionAttempt.evidenceHash).not.toBe(fieldIncomplete.extractionAttempt.evidenceHash);

    const tampered = structuredClone(first) as unknown as Record<string, unknown>;
    const attempt = tampered.extractionAttempt as Record<string, unknown>;
    attempt.samplingCoverage = {
      ...(attempt.samplingCoverage as Record<string, unknown>),
      ratio: 0.4,
    };
    expect(() => validateHumanAssistedAmazonRun(tampered)).toThrow();
  });

  it("preserves per-card sponsored diagnostics in failed evidence and binds them to the hashes", async () => {
    const result = await runCase(fixture.cases.find((item) => item.id === "sponsored-all-unknown")!);
    expect(result.status).toBe("failed");
    expect(result.extractionAttempt.sponsoredDiagnostics).toHaveLength(5);
    expect(result.extractionAttempt.sponsoredDiagnostics?.every((item) => (
      item.state === null
      && item.reasonCode === "ambiguous_ad_text_without_known_marker"
      && item.matchedText === "Promoted"
    ))).toBe(true);

    const tampered = structuredClone(result) as unknown as Record<string, unknown>;
    const attempt = tampered.extractionAttempt as Record<string, unknown>;
    const diagnostics = attempt.sponsoredDiagnostics as Array<Record<string, unknown>>;
    diagnostics[0].matchedText = "Advertisement";
    expect(() => validateHumanAssistedAmazonRun(tampered))
      .toThrow("HUMAN_ASSISTED_RUN_V2_HASH_INVALID");
  });

  it("rejects malformed nested v2 gate metrics before hash validation", async () => {
    const valid = await runCase(fixture.cases[0]);
    const malformed = structuredClone(valid) as unknown as Record<string, unknown>;
    const attempt = malformed.extractionAttempt as Record<string, unknown>;
    attempt.layoutMetrics = { ...(attempt.layoutMetrics as Record<string, unknown>), rawCardCount: "5" };
    expect(() => validateHumanAssistedAmazonRun(malformed)).toThrow("HUMAN_ASSISTED_RUN_V2_INVALID");
  });

  it("runtime-validates cleanup and top-level success consistency", async () => {
    const valid = await runCase(fixture.cases[0]);
    const malformedCleanup = structuredClone(valid) as unknown as Record<string, unknown>;
    malformedCleanup.cleanup = {
      ...(malformedCleanup.cleanup as Record<string, unknown>),
      pageClosed: "yes",
    };
    expect(() => validateHumanAssistedAmazonRun(malformedCleanup))
      .toThrow("HUMAN_ASSISTED_RUN_V2_INVALID");

    const missingSource = structuredClone(valid) as unknown as Record<string, unknown>;
    missingSource.sourceAdapter = null;
    expect(() => validateHumanAssistedAmazonRun(missingSource))
      .toThrow("HUMAN_ASSISTED_RUN_V2_INVALID");
  });

  it("round-trips a v2 failed run through JSON before runtime validation", async () => {
    const failed = await runCase(fixture.cases.find((item) => item.id === "multiple-layout-failures")!);
    const parsed: unknown = JSON.parse(JSON.stringify(failed));
    expect(validateHumanAssistedAmazonRun(parsed).evidenceStatus).toBe("complete");
  });

  it.skipIf(!existsSync(canary09Path))("reads the unchanged Canary 09 v1 as historical evidence insufficient", () => {
    const historical: unknown = JSON.parse(readFileSync(canary09Path, "utf8"));
    expect(validateHumanAssistedAmazonRun(historical).evidenceStatus)
      .toBe("historical_evidence_insufficient");
    expect(historical).toMatchObject({
      schemaVersion: "human-assisted-amazon-run.v1",
      status: "failed",
      errorCode: "suspected_layout_change",
    });
    expect(historical).not.toHaveProperty("extractionAttempt");
  });

  it.skipIf(!existsSync(canary10Path))("keeps the unchanged Canary 10 v2 evidence runtime-valid", () => {
    const historical: unknown = JSON.parse(readFileSync(canary10Path, "utf8"));
    expect(validateHumanAssistedAmazonRun(historical).evidenceStatus).toBe("complete");
    expect(historical).not.toHaveProperty("extractionAttempt.sponsoredDiagnostics");
  });

  it.skipIf(!existsSync(canary14Path))("keeps the unchanged Canary 14 Login Wall failure runtime-valid", () => {
    const historical: unknown = JSON.parse(readFileSync(canary14Path, "utf8"));
    expect(validateHumanAssistedAmazonRun(historical).evidenceStatus).toBe("complete");
    expect(historical).toMatchObject({
      schemaVersion: "human-assisted-amazon-run.v2",
      status: "failed",
      errorCode: "login_wall",
    });
  });
});
