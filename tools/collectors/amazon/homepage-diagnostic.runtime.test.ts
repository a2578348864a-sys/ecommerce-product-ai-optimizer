import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stableHash } from "../../../lib/upstream/pipeline";
import { resolveSystemBrowser, runAmazonHomepageDiagnosticBrowser } from "./browser-control";
import { buildAmazonEnvironmentSetupEvidence } from "./environment-evidence";

const RUN_AUTHORIZED = process.env.RUN_AMAZON_HOMEPAGE_DIAGNOSTIC === "authorized-once";

describe("authorized Amazon homepage-only diagnostic runtime", () => {
  it.runIf(RUN_AUTHORIZED)("navigates to the Amazon homepage once and always stops before environment changes", async () => {
    const browser = resolveSystemBrowser();
    if (!browser) throw new Error("BROWSER_EXECUTABLE_NOT_FOUND");
    const capturedAt = new Date().toISOString();
    const browserRun = await runAmazonHomepageDiagnosticBrowser({ browser, capturedAt, headless: false });
    const pageDiagnostic = browserRun.pageDiagnostics[0];
    if (!pageDiagnostic) throw new Error("AMAZON_HOMEPAGE_DIAGNOSTIC_MISSING");

    const cleanup = {
      pageClosed: browserRun.pageClosed,
      browserClosed: browserRun.browserClosed,
      forcedTerminationUsed: browserRun.forcedTerminationUsed,
      debugPortReleased: browserRun.debugPortReleased,
      profileRemoved: browserRun.profileRemoved,
      browserProcessBaselineCount: browserRun.browserProcessBaselineCount,
      browserProcessFinalCount: browserRun.browserProcessFinalCount,
      browserProcessBaselineRestored: browserRun.browserProcessBaselineRestored,
    };
    const environmentEvidence = buildAmazonEnvironmentSetupEvidence({
      capturedAt,
      browser: browserRun.browser,
      browserVersion: browserRun.browserVersion,
      profileIsolation: browserRun.profileLocationType,
      debugTransport: "loopback_cdp_dynamic_port",
      homepageNavigationCount: browserRun.homepageNavigationCount,
      preferencesNavigationCount: browserRun.preferencesNavigationCount,
      searchPageAccessCount: browserRun.explicitSearchNavigationCount,
      searchStarted: browserRun.searchStarted,
      collectionRunGenerated: false,
      gate: browserRun.environmentGate,
      steps: browserRun.environmentSteps,
      pageDiagnostics: browserRun.pageDiagnostics,
      cleanup,
    });
    const artifactCore = {
      schemaVersion: "amazon-homepage-diagnostic-run.v1" as const,
      capturedAt,
      authorizedScope: {
        requestedUrl: "https://www.amazon.com/" as const,
        maxHomepageNavigations: 1 as const,
        searchAllowed: false as const,
        productDetailAllowed: false as const,
        proxyAllowed: false as const,
      },
      actualHomepageNavigationCount: browserRun.homepageNavigationCount,
      actualPreferencesNavigationCount: browserRun.preferencesNavigationCount,
      actualSearchPageAccessCount: browserRun.explicitSearchNavigationCount,
      deliveryContextInteractionCount: browserRun.deliveryContextInteractionCount,
      searchStarted: browserRun.searchStarted,
      collectionRunGenerated: false as const,
      formalCandidateGenerated: false as const,
      productionDatabaseWritten: false as const,
      browser: browserRun.browser,
      browserLocationType: browserRun.browserLocationType,
      browserVersion: browserRun.browserVersion,
      profileIsolation: browserRun.profileLocationType,
      debugTransport: "loopback_cdp_dynamic_port" as const,
      pageDiagnostic,
      environmentEvidence,
      cleanup,
    };
    const artifact = { ...artifactCore, runEvidenceHash: stableHash(artifactCore) };
    const outputDirectory = resolve(process.cwd(), "..", "06_测试与验证", "2026-07-14-Amazon-Homepage-Diagnostic-06");
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(
      resolve(outputDirectory, "amazon-homepage-diagnostic.v1.json"),
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );

    expect(browserRun.homepageNavigationCount).toBe(1);
    expect(browserRun.preferencesNavigationCount).toBe(0);
    expect(browserRun.explicitSearchNavigationCount).toBe(0);
    expect(browserRun.deliveryContextInteractionCount).toBe(0);
    expect(browserRun.searchStarted).toBe(false);
    expect(browserRun.extraction).toBeNull();
    expect(pageDiagnostic.schemaVersion).toBe("amazon-page-diagnostic.v1");
    expect(environmentEvidence.schemaVersion).toBe("amazon-environment-setup-evidence.v2");
    expect(browserRun.pageClosed).toBe(true);
    expect(browserRun.browserClosed).toBe(true);
    expect(browserRun.debugPortReleased).toBe(true);
    expect(browserRun.profileRemoved).toBe(true);
  }, 60_000);
});
