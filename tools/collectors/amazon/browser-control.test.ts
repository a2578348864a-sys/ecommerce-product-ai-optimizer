import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAmazonBrowserLaunchArguments,
  buildAmazonHomeUrl,
  buildAmazonPreferencesUrl,
  buildAmazonSearchCanaryUrl,
  classifyBrowserControlError,
  cleanupIsolatedBrowserProfile,
  createIsolatedBrowserProfile,
  isLoopbackPortReleased,
  isAllowedAmazonSearchPageUrl,
  isAllowedPublicNavigationUrl,
  validatePublicDomExpression,
  openIsolatedPublicBrowserSession,
  openHumanAssistedAmazonBrowser,
  resolveSystemBrowser,
  runLocalBrowserControlSmoke,
  shouldContinueAfterHomepageDiagnostic,
  type BrowserExecutableCandidate,
  type LocalBrowserControlFailure,
  type LocalBrowserControlResult,
} from "./browser-control";

const localFixturePath = fileURLToPath(new URL("./fixtures/browser-control-local.html", import.meta.url));

describe("amazon collector isolated browser control", () => {
  it("stops after the homepage in diagnostic-only mode even when Amazon markers are normal", () => {
    expect(shouldContinueAfterHomepageDiagnostic("amazon_normal", true)).toBe(false);
    expect(shouldContinueAfterHomepageDiagnostic("amazon_normal_variant", true)).toBe(false);
    expect(shouldContinueAfterHomepageDiagnostic("amazon_normal", false)).toBe(true);
    expect(shouldContinueAfterHomepageDiagnostic("captcha", false)).toBe(false);
  });

  it("builds only the fixed first-page public search URL and rejects escaped main-frame URLs", () => {
    expect(buildAmazonHomeUrl()).toBe("https://www.amazon.com/");
    expect(buildAmazonPreferencesUrl()).toBe(
      "https://www.amazon.com/customer-preferences/edit?ie=UTF8&preferencesReturnUrl=%2F",
    );
    const url = buildAmazonSearchCanaryUrl("closet organizer");
    expect(url).toBe("https://www.amazon.com/s?k=closet+organizer&language=en_US&currency=USD");
    expect(isAllowedAmazonSearchPageUrl(url)).toBe(true);
    expect(isAllowedAmazonSearchPageUrl("https://www.amazon.com/errors/validateCaptcha")).toBe(false);
    expect(isAllowedAmazonSearchPageUrl("https://amazon.example/s?k=closet+organizer")).toBe(false);
    expect(isAllowedAmazonSearchPageUrl("http://www.amazon.com/s?k=closet+organizer")).toBe(false);
  });

  it("allows only exact HTTPS origins for isolated public navigation", () => {
    expect(isAllowedPublicNavigationUrl("https://www.alibaba.com/trade/search?SearchText=test", ["https://www.alibaba.com"]))
      .toBe(true);
    expect(isAllowedPublicNavigationUrl("https://login.alibaba.com/", ["https://www.alibaba.com"])).toBe(false);
    expect(isAllowedPublicNavigationUrl("http://www.alibaba.com/trade/search", ["https://www.alibaba.com"])).toBe(false);
    expect(isAllowedPublicNavigationUrl("https://www.alibaba.com.evil.example/", ["https://www.alibaba.com"])).toBe(false);
    expect(isAllowedPublicNavigationUrl("https://user:secret@www.alibaba.com/", ["https://www.alibaba.com"])).toBe(false);
  });

  it("rejects DOM probes that could read private browser state", () => {
    expect(() => validatePublicDomExpression("document.title")).not.toThrow();
    expect(() => validatePublicDomExpression("document.cookie")).toThrow("PUBLIC_DOM_EXPRESSION_FORBIDDEN");
    expect(() => validatePublicDomExpression("localStorage.getItem('x')")).toThrow("PUBLIC_DOM_EXPRESSION_FORBIDDEN");
    expect(() => validatePublicDomExpression("document.querySelector('input[type=password]').value"))
      .toThrow("PUBLIC_DOM_EXPRESSION_FORBIDDEN");
  });

  it("uses a loopback dynamic CDP port and an isolated profile without the local-only network block", async () => {
    const profile = await createIsolatedBrowserProfile();
    try {
      const args = buildAmazonBrowserLaunchArguments(profile, false);
      expect(args).toContain(`--user-data-dir=${profile.profilePath}`);
      expect(args).toContain("--remote-debugging-address=127.0.0.1");
      expect(args).toContain("--remote-debugging-port=0");
      expect(args).not.toContain("--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost");
      expect(args.at(-1)).toBe("about:blank");
    } finally {
      await cleanupIsolatedBrowserProfile(profile);
    }
  });
  it("resolves the first existing supported system browser without consulting a user profile", () => {
    const candidates: BrowserExecutableCandidate[] = [
      { browser: "chrome", locationType: "system", executablePath: "C:\\missing\\chrome.exe" },
      { browser: "edge", locationType: "system", executablePath: "C:\\browser\\msedge.exe" },
    ];

    expect(resolveSystemBrowser(candidates, (path) => path === "C:\\browser\\msedge.exe")).toEqual(candidates[1]);
  });

  it("creates and removes a new isolated profile only inside the supplied safe temp root", async () => {
    const profile = await createIsolatedBrowserProfile();

    expect(profile.locationType).toBe("system_temp");
    expect(profile.profilePath).toContain("amazon-collector-browser-");
    expect(existsSync(profile.profilePath)).toBe(true);

    await cleanupIsolatedBrowserProfile(profile);
    expect(existsSync(profile.profilePath)).toBe(false);
  });

  it.each([
    [new TypeError("Cannot redefine property: process"), "browser_plugin_runtime_incompatible"],
    [Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" }), "debug_port_in_use"],
    [new Error("DevToolsActivePort timed out"), "browser_debug_endpoint_unavailable"],
    [new Error("browser exited before ready"), "browser_exited_before_ready"],
  ])("classifies initialization failures without hiding the failed stage", (error, expectedCode) => {
    expect(classifyBrowserControlError(error).code).toBe(expectedCode);
  });

  it("detects an occupied loopback port and observes its release", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_PORT_ADDRESS_UNAVAILABLE");

    expect(await isLoopbackPortReleased(address.port)).toBe(false);
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    expect(await isLoopbackPortReleased(address.port)).toBe(true);
  });

  const installedBrowser = resolveSystemBrowser();
  it.runIf(Boolean(installedBrowser))(
    "opens and cleans the budgeted public session without external navigation",
    async () => {
      const session = await openIsolatedPublicBrowserSession({
        browser: installedBrowser!,
        allowedOrigins: ["https://www.alibaba.com"],
        maxNavigations: 4,
        headless: true,
      });
      expect(await session.evaluateDomByValue<string>("document.title")).toBe("");
      expect(session.navigationCount).toBe(0);
      const cleanup = await session.close();
      expect(cleanup).toMatchObject({
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      });
    },
    30_000,
  );
  it.runIf(Boolean(installedBrowser))(
    "opens the human-assisted session on about:blank and cleans it without external navigation",
    async () => {
      const session = await openHumanAssistedAmazonBrowser({ browser: installedBrowser!, headless: false });
      expect(session.profileLocationType).toBe("system_temp");
      expect(session.debugPort).toBeGreaterThan(0);
      const inspection = await session.inspectCurrentPage({
        query: "closet organizer",
        capturedAt: "2026-07-14T05:00:00.000Z",
        maxAppearances: 20,
        expectedPostalCode: "10001",
      });
      expect(inspection.diagnostic.classification).toBe("blank_page");
      expect(inspection.allowedSearchPage).toBe(false);
      expect(inspection.extraction).toBeNull();
      const cleanup = await session.close();
      expect(cleanup).toMatchObject({
        pageClosed: true,
        browserClosed: true,
        debugPortReleased: true,
        profileRemoved: true,
        browserProcessBaselineRestored: true,
      });
    },
    30_000,
  );

  it.runIf(Boolean(installedBrowser))(
    "starts, controls, closes, and cleans two independent visible local-browser runs",
    async () => {
      const first = await runLocalBrowserControlSmoke({
        browser: installedBrowser!,
        localFixturePath,
        headless: false,
      });
      const second = await runLocalBrowserControlSmoke({
        browser: installedBrowser!,
        localFixturePath,
        headless: false,
      });

      for (const result of [first, second]) {
        expect(result.pageUrlProtocol).toBe("file:");
        expect(result.title).toBe("Amazon Collector Local Control Fixture");
        expect(result.probeText).toBe("local-browser-control-ok");
        expect(result.diagnosticClassification).toBe("unexpected_redirect");
        expect(result.pageCreated).toBe(true);
        expect(result.pageClosed).toBe(true);
        expect(result.browserClosed).toBe(true);
        expect(result.forcedTerminationUsed).toBe(false);
        expect(result.debugPortReleased).toBe(true);
        expect(result.profileRemoved).toBe(true);
      }
      expect(first.profileId).not.toBe(second.profileId);
      expect(first.debugPort).not.toBe(0);
      expect(second.debugPort).not.toBe(0);
    },
    60_000,
  );

  it.runIf(Boolean(installedBrowser))(
    "closes the browser, releases the port, and removes the profile after an offline probe exception",
    async () => {
      const outcome: LocalBrowserControlResult | LocalBrowserControlFailure = await runLocalBrowserControlSmoke({
        browser: installedBrowser!,
        localFixturePath,
        headless: false,
        expectedProbeText: "intentional-mismatch",
      }).catch((error: unknown) => error as LocalBrowserControlFailure);

      expect(outcome).toBeInstanceOf(Error);
      if (!(outcome instanceof Error)) throw new Error("EXPECTED_LOCAL_BROWSER_CONTROL_FAILURE");
      const failure = outcome as LocalBrowserControlFailure;
      expect(failure.message).toBe("LOCAL_BROWSER_PROBE_MISMATCH");
      expect(failure.cleanup).toEqual({
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: true,
        profileRemoved: true,
      });
    },
    30_000,
  );
});
