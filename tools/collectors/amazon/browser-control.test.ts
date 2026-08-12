import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
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
  resolveSystemBrowser,
  shouldContinueAfterHomepageDiagnostic,
  type BrowserExecutableCandidate,
} from "./browser-control";
import {
  forceTerminateOwnedProcessTree,
  isRecordedProcessAlive,
  waitForRecordedProcessIdsToExit,
} from "./owned-process-tree";

const controlledNodeProcessTreeFixturePath = fileURLToPath(
  new URL("./fixtures/controlled-node-process-tree.mjs", import.meta.url),
);
type ControlledReady = {
  type: "controlled-ready";
  mode: "root" | "sentinel";
  runId: string;
  pid: number;
  grandchildPid: number | null;
};
const forceTerminableTestProcesses = new Set<ChildProcess>();
const sentinelTestProcesses = new Map<ChildProcess, string>();
const forceTerminableProcessIds = new Set<number>();
const recordedTestProcessIds = new Set<number>();

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function recordTestProcess(child: ChildProcess, mode: "root" | "sentinel" | "exit-before-ready", runId: string): ChildProcess {
  if (!isPositiveInteger(child.pid)) throw new Error("CONTROLLED_PROCESS_PID_UNAVAILABLE");
  recordedTestProcessIds.add(child.pid);
  if (mode === "sentinel") sentinelTestProcesses.set(child, runId);
  else {
    forceTerminableTestProcesses.add(child);
    forceTerminableProcessIds.add(child.pid);
  }
  return child;
}

function spawnControlledTestProcess(mode: "root" | "sentinel" | "exit-before-ready", runId: string): ChildProcess {
  return recordTestProcess(spawn(process.execPath, [controlledNodeProcessTreeFixturePath, mode, runId], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  }), mode, runId);
}

function parseControlledReady(value: unknown, runId: string): ControlledReady | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;
  if (
    message.type !== "controlled-ready"
    || message.runId !== runId
    || (message.mode !== "root" && message.mode !== "sentinel")
    || !isPositiveInteger(message.pid)
    || (message.grandchildPid !== null && !isPositiveInteger(message.grandchildPid))
  ) return null;
  return {
    type: "controlled-ready",
    mode: message.mode,
    runId,
    pid: message.pid,
    grandchildPid: message.grandchildPid as number | null,
  };
}

async function waitForControlledReady(child: ChildProcess, runId: string): Promise<ControlledReady> {
  return await new Promise<ControlledReady>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: ControlledReady | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    };
    const onMessage = (message: unknown) => {
      const ready = parseControlledReady(message, runId);
      if (ready) finish(ready);
    };
    const onExit = () => finish(new Error("CONTROLLED_PROCESS_EXITED_BEFORE_READY"));
    const onError = () => finish(new Error("CONTROLLED_PROCESS_START_FAILED"));
    const timeout = setTimeout(() => finish(new Error("CONTROLLED_PROCESS_READY_TIMEOUT")), 2_000);
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function requestControlledShutdown(child: ChildProcess, runId: string): Promise<void> {
  if (!isPositiveInteger(child.pid) || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.connected) {
    const alreadyExited = await waitForRecordedProcessIdsToExit([child.pid], 2_000);
    if (alreadyExited.exited) return;
    throw new Error("CONTROLLED_SENTINEL_IPC_UNAVAILABLE");
  }
  child.send({ type: "controlled-shutdown", runId });
  const cleanup = await waitForRecordedProcessIdsToExit([child.pid], 2_000);
  if (!cleanup.exited) throw new Error("CONTROLLED_SENTINEL_GRACEFUL_CLEANUP_INCOMPLETE");
}

afterEach(async () => {
  for (const child of forceTerminableTestProcesses) {
    if (child.exitCode === null && child.signalCode === null) forceTerminateOwnedProcessTree(child);
  }
  const forcedCleanup = await waitForRecordedProcessIdsToExit([...forceTerminableProcessIds], 2_000);
  for (const [sentinel, runId] of sentinelTestProcesses) await requestControlledShutdown(sentinel, runId);
  const sentinelProcessIds = [...sentinelTestProcesses.keys()]
    .map((child) => child.pid)
    .filter(isPositiveInteger);
  const sentinelCleanup = await waitForRecordedProcessIdsToExit(sentinelProcessIds, 2_000);
  forceTerminableTestProcesses.clear();
  sentinelTestProcesses.clear();
  forceTerminableProcessIds.clear();
  recordedTestProcessIds.clear();
  if (!forcedCleanup.exited || !sentinelCleanup.exited) throw new Error("CONTROLLED_PROCESS_CLEANUP_INCOMPLETE");
});
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
    // 平台中立路径（Windows 与 Linux 均为绝对路径）
    const firstPath = resolve(process.cwd(), "synthetic-first.exe");
    const secondPath = resolve(process.cwd(), "synthetic-second.exe");
    const candidates: BrowserExecutableCandidate[] = [
      { browser: "chrome", locationType: "system", executablePath: firstPath },
      { browser: "edge", locationType: "system", executablePath: secondPath },
    ];

    expect(resolveSystemBrowser(candidates, (path) => path === secondPath)).toEqual(candidates[1]);
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

  // Manual-only integration scope is retained: isolated executable launch,
  // DevTools transport, offline page control, and cleanup require explicit
  // human authorization and never run in the default automated suite.
  it("closes only the recorded root process tree while leaving an independent sentinel running", async () => {
    const runId = randomUUID();
    const root = spawnControlledTestProcess("root", runId);
    const rootReady = await waitForControlledReady(root, runId);
    expect(rootReady.mode).toBe("root");
    expect(rootReady.pid).toBe(root.pid);
    expect(rootReady.grandchildPid).toEqual(expect.any(Number));
    if (!isPositiveInteger(rootReady.grandchildPid)) throw new Error("CONTROLLED_GRANDCHILD_PID_UNAVAILABLE");
    recordedTestProcessIds.add(rootReady.grandchildPid);
    forceTerminableProcessIds.add(rootReady.grandchildPid);

    const sentinel = spawnControlledTestProcess("sentinel", runId);
    const sentinelReady = await waitForControlledReady(sentinel, runId);
    expect(sentinelReady.mode).toBe("sentinel");
    expect(sentinelReady.pid).toBe(sentinel.pid);
    expect(sentinelReady.grandchildPid).toBeNull();
    expect(isRecordedProcessAlive(sentinelReady.pid)).toBe(true);

    const timeout = await waitForRecordedProcessIdsToExit([sentinelReady.pid], 50);
    expect(timeout).toEqual({ exited: false, remainingProcessIds: [sentinelReady.pid] });

    forceTerminateOwnedProcessTree(root);
    const treeCleanup = await waitForRecordedProcessIdsToExit([rootReady.pid, rootReady.grandchildPid], 2_000);
    expect(treeCleanup).toEqual({ exited: true, remainingProcessIds: [] });
    forceTerminateOwnedProcessTree(root);
    expect(isRecordedProcessAlive(sentinelReady.pid)).toBe(true);
    await requestControlledShutdown(sentinel, runId);
    sentinelTestProcesses.delete(sentinel);
    await expect(waitForRecordedProcessIdsToExit([sentinelReady.pid], 2_000))
      .resolves.toEqual({ exited: true, remainingProcessIds: [] });
  });

  it("reports a controlled start failure before a root process is ready", async () => {
    const child = spawnControlledTestProcess("exit-before-ready", randomUUID());
    await expect(waitForControlledReady(child, "unused")).rejects.toThrow("CONTROLLED_PROCESS_EXITED_BEFORE_READY");
    await expect(waitForRecordedProcessIdsToExit([child.pid!], 2_000))
      .resolves.toEqual({ exited: true, remainingProcessIds: [] });
  });
});
