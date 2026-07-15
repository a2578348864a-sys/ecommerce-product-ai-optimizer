import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SelectionBrief } from "../../../lib/upstream/contracts";
import { stableHash } from "../../../lib/upstream/pipeline";
import { resolveSystemBrowser, runAmazonSearchCanaryBrowser } from "./browser-control";
import { buildAmazonEnvironmentSetupEvidence } from "./environment-evidence";
import { buildLiveAmazonCanaryEvidence } from "./live-canary";

const RUN_AUTHORIZED = process.env.RUN_AMAZON_ENVIRONMENT_FIRST_CANARY === "authorized-once";
const COLLECTOR_VERSION = "amazon-public-search-cdp.v2.1";

function buildBrief(capturedAt: string): SelectionBrief {
  return {
    schemaVersion: "selection-brief.v1",
    briefId: "brief-amazon-us-closet-organizer-canary-v2",
    marketplace: "amazon.com",
    market: "US",
    query: "closet organizer",
    category: null,
    targetScenario: "small-space closet organization",
    targetPriceRange: { currency: "USD", min: 15, max: 45 },
    requiredEvidence: ["identity", "title", "price", "rating", "review_count"],
    hardExclusions: ["confirmed_ip_risk", "regulated_product", "price_out_of_budget", "logistics_blocked"],
    sampleBudget: { maxPages: 1, maxAppearances: 20 },
    rankingRuleVersion: "stage1-deterministic-v1.1",
    createdAt: capturedAt,
    approvedBy: "user_authorized_live_canary_2026-07-14",
  };
}

describe("authorized Amazon V2 live canary runtime", () => {
  it.runIf(RUN_AUTHORIZED)("validates the anonymous US environment before any optional search-page collection", async () => {
    const browser = resolveSystemBrowser();
    if (!browser) throw new Error("BROWSER_EXECUTABLE_NOT_FOUND");
    const capturedAt = new Date().toISOString();
    const browserRun = await runAmazonSearchCanaryBrowser({
      browser,
      query: "closet organizer",
      postalCode: "10001",
      capturedAt,
      maxAppearances: 20,
      headless: false,
    });
    const outputDirectory = resolve(process.cwd(), "..", "06_测试与验证", "2026-07-14-Amazon-V2-Canary-05");
    mkdirSync(outputDirectory, { recursive: true });
    let liveEvidence: ReturnType<typeof buildLiveAmazonCanaryEvidence> | null = null;
    if (browserRun.extraction) {
      liveEvidence = buildLiveAmazonCanaryEvidence({
        brief: buildBrief(capturedAt),
        extraction: browserRun.extraction,
        collectorVersion: COLLECTOR_VERSION,
      });
      const execution = {
        schemaVersion: "amazon-live-canary-execution.v1" as const,
        actualSearchPageAccessCount: browserRun.explicitSearchNavigationCount,
        deliveryContextInteractionCount: browserRun.deliveryContextInteractionCount,
        browser: browserRun.browser,
        browserLocationType: browserRun.browserLocationType,
        browserVersion: browserRun.browserVersion,
        profileIsolation: browserRun.profileLocationType,
        profileId: browserRun.profileId,
        debugTransport: "loopback_cdp_dynamic_port" as const,
        runStatus: browserRun.status,
        runErrorCode: browserRun.errorCode,
        cleanup: {
          pageClosed: browserRun.pageClosed,
          browserClosed: browserRun.browserClosed,
          forcedTerminationUsed: browserRun.forcedTerminationUsed,
          debugPortReleased: browserRun.debugPortReleased,
          profileRemoved: browserRun.profileRemoved,
          browserProcessBaselineCount: browserRun.browserProcessBaselineCount,
          browserProcessFinalCount: browserRun.browserProcessFinalCount,
          browserProcessBaselineRestored: browserRun.browserProcessBaselineRestored,
        },
      };
      const artifactCore = { ...liveEvidence, execution };
      const artifact = { ...artifactCore, runEvidenceHash: stableHash(artifactCore) };
      writeFileSync(resolve(outputDirectory, "amazon-v2-canary-page1.v2.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    }

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
      collectionRunGenerated: liveEvidence !== null,
      gate: browserRun.environmentGate,
      steps: browserRun.environmentSteps,
      pageDiagnostics: browserRun.pageDiagnostics,
      cleanup: {
        pageClosed: browserRun.pageClosed,
        browserClosed: browserRun.browserClosed,
        forcedTerminationUsed: browserRun.forcedTerminationUsed,
        debugPortReleased: browserRun.debugPortReleased,
        profileRemoved: browserRun.profileRemoved,
        browserProcessBaselineCount: browserRun.browserProcessBaselineCount,
        browserProcessFinalCount: browserRun.browserProcessFinalCount,
        browserProcessBaselineRestored: browserRun.browserProcessBaselineRestored,
      },
    });
    writeFileSync(
      resolve(outputDirectory, "amazon-environment-setup.v2.json"),
      `${JSON.stringify(environmentEvidence, null, 2)}\n`,
      "utf8",
    );

    expect(browserRun.explicitSearchNavigationCount).toBeLessThanOrEqual(1);
    expect(browserRun.searchStarted).toBe(browserRun.environmentGate.canSearch);
    expect(Boolean(browserRun.extraction)).toBe(browserRun.environmentGate.canSearch);
    expect(browserRun.browserClosed).toBe(true);
    expect(browserRun.debugPortReleased).toBe(true);
    expect(browserRun.profileRemoved).toBe(true);
    expect(liveEvidence?.formalCandidateGenerated ?? false).toBe(false);
    expect(liveEvidence?.productionDatabaseWritten ?? false).toBe(false);
  }, 60_000);
});
