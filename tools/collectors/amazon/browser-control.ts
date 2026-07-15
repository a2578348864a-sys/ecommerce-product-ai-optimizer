import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  buildAmazonPageContextExpression,
  buildAmazonSearchPageExtractionExpression,
  deriveObservedAmazonMarketContext,
  type AmazonCollectorOptions,
} from "./extract-search-page";
import {
  evaluateAmazonEnvironment,
  type AmazonEnvironmentGateResult,
  type AmazonEnvironmentSignals,
} from "./environment-gate";
import {
  buildAmazonPageDiagnostic,
  buildAmazonPageDiagnosticDomExpression,
  type AmazonPageClassification,
  type AmazonPageDiagnosticInput,
  type AmazonPageDomSignals,
} from "./page-diagnostics";

export type BrowserExecutableCandidate = {
  browser: "chrome" | "edge";
  locationType: "system" | "system_x86";
  executablePath: string;
};

export type IsolatedBrowserProfile = {
  locationType: "system_temp";
  safeRoot: string;
  profilePath: string;
  profileId: string;
};

export type BrowserControlError = {
  code:
    | "browser_plugin_runtime_incompatible"
    | "browser_runtime_websocket_unavailable"
    | "browser_executable_not_found"
    | "browser_exited_before_ready"
    | "browser_debug_endpoint_unavailable"
    | "debug_port_in_use"
    | "browser_control_unknown";
  stage: "plugin_bootstrap" | "path_resolution" | "browser_launch" | "debug_endpoint" | "unknown";
  message: string;
};

export type LocalBrowserControlResult = {
  browser: "chrome" | "edge";
  browserLocationType: "system" | "system_x86";
  profileId: string;
  profileLocationType: "system_temp";
  debugPort: number;
  pageUrlProtocol: "file:";
  title: string;
  probeText: string | null;
  diagnosticClassification: AmazonPageClassification;
  pageCreated: boolean;
  pageClosed: boolean;
  browserClosed: boolean;
  forcedTerminationUsed: boolean;
  debugPortReleased: boolean;
  profileRemoved: boolean;
};

export type LocalBrowserControlFailure = Error & {
  cleanup?: Pick<LocalBrowserControlResult,
    "pageClosed" | "browserClosed" | "forcedTerminationUsed" | "debugPortReleased" | "profileRemoved">;
};

export type AmazonBrowserCanaryResult = {
  status: "completed" | "failed";
  errorCode: string | null;
  browser: "chrome" | "edge";
  browserLocationType: "system" | "system_x86";
  browserVersion: string | null;
  profileId: string;
  profileLocationType: "system_temp";
  debugPort: number;
  homepageNavigationCount: number;
  preferencesNavigationCount: number;
  explicitSearchNavigationCount: number;
  searchStarted: boolean;
  deliveryContextInteractionCount: number;
  environmentGate: AmazonEnvironmentGateResult;
  environmentSteps: AmazonEnvironmentStep[];
  pageDiagnostics: Array<ReturnType<typeof buildAmazonPageDiagnostic>>;
  extraction: ReturnType<typeof import("./extract-search-page").extractAmazonSearchPage> | null;
  pageClosed: boolean;
  browserClosed: boolean;
  forcedTerminationUsed: boolean;
  debugPortReleased: boolean;
  profileRemoved: boolean;
  browserProcessBaselineCount: number;
  browserProcessFinalCount: number;
  browserProcessBaselineRestored: boolean;
};

export type HumanAssistedBrowserCleanup = {
  pageClosed: boolean;
  browserClosed: boolean;
  forcedTerminationUsed: boolean;
  debugPortReleased: boolean;
  profileRemoved: boolean;
  browserProcessBaselineRestored: boolean;
};

export type HumanAssistedPageInspection = {
  diagnostic: ReturnType<typeof buildAmazonPageDiagnostic>;
  allowedSearchPage: boolean;
  environmentGate: AmazonEnvironmentGateResult;
  extraction: ReturnType<typeof import("./extract-search-page").extractAmazonSearchPage> | null;
};

export type HumanAssistedBrowserSession = {
  browser: "chrome" | "edge";
  browserLocationType: "system" | "system_x86";
  browserVersion: string | null;
  profileId: string;
  profileLocationType: "system_temp";
  debugPort: number;
  inspectCurrentPage(input: {
    query: "closet organizer";
    capturedAt: string;
    maxAppearances: number;
    expectedPostalCode: "10001";
  }): Promise<HumanAssistedPageInspection>;
  close(): Promise<HumanAssistedBrowserCleanup>;
};

export type PublicPageNavigationResult = {
  requestedUrl: string;
  finalUrl: string;
  redirectOrigins: string[];
  redirectCount: number;
  mainDocumentHttpStatus: number | null;
  mainDocumentContentType: string | null;
  navigationElapsedMs: number;
  domWaitElapsedMs: number;
  readyState: string | null;
  allowedFinalOrigin: boolean;
};

export type IsolatedPublicBrowserSession = {
  browser: "chrome" | "edge";
  browserLocationType: "system" | "system_x86";
  browserVersion: string | null;
  profileId: string;
  profileLocationType: "system_temp";
  debugPort: number;
  readonly navigationCount: number;
  navigate(url: string): Promise<PublicPageNavigationResult>;
  evaluateDomByValue<T>(expression: string): Promise<T>;
  close(): Promise<HumanAssistedBrowserCleanup>;
};

export type AmazonEnvironmentStep = {
  stage: string;
  selector: string | null;
  status: "completed" | "failed" | "skipped";
  textBefore: string | null;
  textAfter: string | null;
  detailCode: string | null;
};

type AmazonHomeSignals = Omit<AmazonEnvironmentSignals, "currencyPreference">;

type DeliverySetupResult = {
  confirmed: boolean;
  steps: AmazonEnvironmentStep[];
  finalSignals: AmazonHomeSignals;
};

type PreferenceSetupResult = {
  confirmed: boolean;
  currencyPreference: string | null;
  steps: AmazonEnvironmentStep[];
};

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type CdpEventListener = (method: string, params: Record<string, unknown>, sessionId?: string) => void;

type PendingCdpCall = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type LocalPageState = {
  readyState?: unknown;
  title?: unknown;
  probeText?: unknown;
  href?: unknown;
};

const PROFILE_PREFIX = "amazon-collector-browser-";
const LOOPBACK_HOST = "127.0.0.1";

export function buildAmazonHomeUrl(): string {
  return "https://www.amazon.com/";
}

export function buildAmazonPreferencesUrl(): string {
  return "https://www.amazon.com/customer-preferences/edit?ie=UTF8&preferencesReturnUrl=%2F";
}

export function buildAmazonSearchCanaryUrl(query: string): string {
  if (query.trim() !== "closet organizer") throw new Error("CANARY_QUERY_NOT_AUTHORIZED");
  const url = new URL("https://www.amazon.com/s");
  url.searchParams.set("k", query.trim());
  url.searchParams.set("language", "en_US");
  url.searchParams.set("currency", "USD");
  return url.href.replace(/%20/g, "+");
}

export function isAllowedAmazonSearchPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "www.amazon.com" || url.hostname === "amazon.com")
      && url.pathname === "/s";
  } catch {
    return false;
  }
}

export function isAllowedPublicNavigationUrl(value: string, allowedOrigins: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.port === ""
      && allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}

export function validatePublicDomExpression(expression: string): void {
  if (typeof expression !== "string" || expression.length === 0 || expression.length > 30_000) {
    throw new Error("PUBLIC_DOM_EXPRESSION_INVALID");
  }
  const forbidden = [
    /document\s*\.\s*cookie/i,
    /cookieStore/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /navigator\s*\.\s*credentials/i,
    /input[^\n]{0,120}password[^\n]{0,120}\.\s*value/i,
  ];
  if (forbidden.some((pattern) => pattern.test(expression))) {
    throw new Error("PUBLIC_DOM_EXPRESSION_FORBIDDEN");
  }
}

function isAllowedAmazonHostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.amazon.com" || url.hostname === "amazon.com");
  } catch {
    return false;
  }
}

function defaultBrowserCandidates(): BrowserExecutableCandidate[] {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  return [
    ...(programFiles
      ? [{
          browser: "chrome" as const,
          locationType: "system" as const,
          executablePath: join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        }]
      : []),
    ...(programFilesX86
      ? [{
          browser: "edge" as const,
          locationType: "system_x86" as const,
          executablePath: join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        }]
      : []),
    ...(programFilesX86
      ? [{
          browser: "chrome" as const,
          locationType: "system_x86" as const,
          executablePath: join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        }]
      : []),
    ...(programFiles
      ? [{
          browser: "edge" as const,
          locationType: "system" as const,
          executablePath: join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        }]
      : []),
  ];
}

export function resolveSystemBrowser(
  candidates = defaultBrowserCandidates(),
  pathExists: (path: string) => boolean = existsSync,
): BrowserExecutableCandidate | null {
  return candidates.find((candidate) => isAbsolute(candidate.executablePath) && pathExists(candidate.executablePath)) ?? null;
}

export async function createIsolatedBrowserProfile(safeRoot = tmpdir()): Promise<IsolatedBrowserProfile> {
  const resolvedRoot = resolve(safeRoot);
  const profilePath = await mkdtemp(join(resolvedRoot, PROFILE_PREFIX));
  return {
    locationType: "system_temp",
    safeRoot: resolvedRoot,
    profilePath,
    profileId: basename(profilePath),
  };
}

function assertSafeProfilePath(profile: IsolatedBrowserProfile): void {
  const resolvedRoot = resolve(profile.safeRoot);
  const resolvedProfile = resolve(profile.profilePath);
  const pathFromRoot = relative(resolvedRoot, resolvedProfile);
  if (
    !pathFromRoot
    || pathFromRoot.startsWith("..")
    || isAbsolute(pathFromRoot)
    || !basename(resolvedProfile).startsWith(PROFILE_PREFIX)
  ) {
    throw new Error("BROWSER_PROFILE_CLEANUP_PATH_UNSAFE");
  }
}

export async function cleanupIsolatedBrowserProfile(profile: IsolatedBrowserProfile): Promise<void> {
  assertSafeProfilePath(profile);
  await rm(profile.profilePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function classifyBrowserControlError(error: unknown): BrowserControlError {
  const message = errorMessage(error);
  const normalized = message.toLowerCase();
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (normalized.includes("cannot redefine property: process")) {
    return { code: "browser_plugin_runtime_incompatible", stage: "plugin_bootstrap", message };
  }
  if (code === "EADDRINUSE" || normalized.includes("eaddrinuse")) {
    return { code: "debug_port_in_use", stage: "browser_launch", message };
  }
  if (normalized.includes("devtoolsactiveport") || normalized.includes("debug endpoint")) {
    return { code: "browser_debug_endpoint_unavailable", stage: "debug_endpoint", message };
  }
  if (normalized.includes("exited before ready")) {
    return { code: "browser_exited_before_ready", stage: "browser_launch", message };
  }
  if (normalized.includes("websocket") && normalized.includes("unavailable")) {
    return { code: "browser_runtime_websocket_unavailable", stage: "debug_endpoint", message };
  }
  if (normalized.includes("executable") && normalized.includes("not found")) {
    return { code: "browser_executable_not_found", stage: "path_resolution", message };
  }
  return { code: "browser_control_unknown", stage: "unknown", message };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function isLoopbackPortReleased(port: number, timeoutMs = 300): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("DEBUG_PORT_INVALID");
  return await new Promise<boolean>((resolveCheck) => {
    const socket = createConnection({ host: LOOPBACK_HOST, port });
    let settled = false;
    const finish = (released: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveCheck(released);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
    socket.setTimeout(timeoutMs, () => finish(true));
  });
}

async function waitForReleasedPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isLoopbackPortReleased(port)) return true;
    await delay(100);
  }
  return await isLoopbackPortReleased(port);
}

async function waitForDevToolsPort(
  profile: IsolatedBrowserProfile,
  browserProcess: ChildProcess,
  getLaunchError: () => Error | null,
  timeoutMs = 10_000,
): Promise<number> {
  const portFile = join(profile.profilePath, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const launchError = getLaunchError();
    if (launchError) throw launchError;
    if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) {
      throw new Error("browser exited before ready");
    }
    try {
      const [portLine] = (await readFile(portFile, "utf8")).split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    } catch (error) {
      const fileErrorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (fileErrorCode !== "ENOENT" && fileErrorCode !== "EBUSY") throw error;
    }
    await delay(50);
  }
  throw new Error("DevToolsActivePort timed out");
}

async function getBrowserWebSocketUrl(port: number, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${LOOPBACK_HOST}:${port}/json/version`, {
        cache: "no-store",
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        const body = await response.json() as { webSocketDebuggerUrl?: unknown };
        if (typeof body.webSocketDebuggerUrl === "string") {
          const url = new URL(body.webSocketDebuggerUrl);
          if (url.protocol !== "ws:" || ![LOOPBACK_HOST, "localhost"].includes(url.hostname)) {
            throw new Error("BROWSER_DEBUG_ENDPOINT_NOT_LOOPBACK");
          }
          return body.webSocketDebuggerUrl;
        }
      }
    } catch (error) {
      if (errorMessage(error) === "BROWSER_DEBUG_ENDPOINT_NOT_LOOPBACK") throw error;
    }
    await delay(50);
  }
  throw new Error("browser debug endpoint unavailable");
}

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCdpCall>();
  private readonly eventListeners = new Set<CdpEventListener>();

  constructor(url: string) {
    if (typeof WebSocket !== "function") throw new Error("WebSocket unavailable");
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("BROWSER_DEBUG_SOCKET_CLOSED"));
      this.pending.clear();
    });
  }

  async connect(timeoutMs = 5_000): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolveConnection, rejectConnection) => {
      const timeout = setTimeout(() => rejectConnection(new Error("BROWSER_DEBUG_SOCKET_TIMEOUT")), timeoutMs);
      const finish = (callback: () => void) => {
        clearTimeout(timeout);
        callback();
      };
      this.socket.addEventListener("open", () => finish(resolveConnection), { once: true });
      this.socket.addEventListener("error", () => finish(() => rejectConnection(new Error("BROWSER_DEBUG_SOCKET_ERROR"))), {
        once: true,
      });
    });
  }

  async send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = this.nextId++;
    const response = new Promise<unknown>((resolveResponse, rejectResponse) => {
      this.pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
    });
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return await response;
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close();
  }

  onEvent(listener: CdpEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as CdpResponse;
    if (typeof message.id !== "number") {
      if (typeof message.method === "string") {
        for (const listener of this.eventListeners) listener(message.method, message.params ?? {}, message.sessionId);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`CDP_${message.error.code ?? "ERROR"}: ${message.error.message ?? "unknown error"}`));
      return;
    }
    pending.resolve(message.result);
  }
}

async function evaluateByValue<T>(client: CdpClient, sessionId: string, expression: string): Promise<T> {
  const evaluated = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  if (evaluated.exceptionDetails) throw new Error("CDP_RUNTIME_EVALUATION_FAILED");
  return evaluated.result?.value as T;
}

async function waitForProcessExit(browserProcess: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (browserProcess.exitCode !== null || browserProcess.signalCode !== null) return true;
  return await Promise.race([
    once(browserProcess, "exit").then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

function forceTerminateOwnedProcess(browserProcess: ChildProcess): void {
  if (!browserProcess.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(browserProcess.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  browserProcess.kill("SIGKILL");
}

function browserLaunchArguments(profile: IsolatedBrowserProfile, headless: boolean): string[] {
  return [
    `--user-data-dir=${profile.profilePath}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-extensions",
    "--disable-search-engine-choice-screen",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-pings",
    "--no-service-autorun",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost",
    ...(headless ? ["--headless=new"] : []),
    "about:blank",
  ];
}

export function buildAmazonBrowserLaunchArguments(profile: IsolatedBrowserProfile, headless: boolean): string[] {
  return browserLaunchArguments(profile, headless).filter((argument) => !argument.startsWith("--host-resolver-rules="));
}

function listBrowserProcessIds(browser: "chrome" | "edge"): number[] {
  if (process.platform !== "win32") return [];
  const imageName = browser === "chrome" ? "chrome.exe" : "msedge.exe";
  const result = spawnSync("tasklist.exe", ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout.split(/\r?\n/).map((line) => line.match(/^"[^"]+","(\d+)"/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => Number(match[1]))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
}

function sameProcessBaseline(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((pid, index) => pid === right[index]);
}

async function waitForDocument(client: CdpClient, sessionId: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let href = "";
  while (Date.now() < deadline) {
    const state = await evaluateByValue<{ readyState?: unknown; href?: unknown }>(client, sessionId,
      "({ readyState: document.readyState, href: location.href })");
    href = typeof state?.href === "string" ? state.href : "";
    if (state?.readyState === "complete") return href;
    await delay(100);
  }
  throw new Error("AMAZON_PAGE_LOAD_TIMEOUT");
}

async function observeDocumentState(client: CdpClient, sessionId: string, timeoutMs = 20_000): Promise<{
  href: string;
  readyState: string | null;
  domWaitElapsedMs: number;
}> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let href = "";
  let readyState: string | null = null;
  while (Date.now() < deadline) {
    try {
      const state = await evaluateByValue<{ readyState?: unknown; href?: unknown }>(client, sessionId,
        "({ readyState: document.readyState, href: location.href })");
      href = typeof state?.href === "string" ? state.href : href;
      readyState = typeof state?.readyState === "string" ? state.readyState : readyState;
      if (readyState === "complete") break;
    } catch {
      // A main-frame swap may briefly make Runtime unavailable; preserve fail-closed diagnostics and keep polling.
    }
    await delay(100);
  }
  return { href, readyState, domWaitElapsedMs: Date.now() - startedAt };
}

type MainDocumentNavigationCapture = {
  requestedUrl: string;
  finalUrl: string;
  redirectUrls: string[];
  mainFrameId: string | null;
  mainDocumentHttpStatus: number | null;
  mainDocumentContentType: string | null;
};

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | null {
  return typeof record?.[key] === "string" ? record[key] as string : null;
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string): number | null {
  return typeof record?.[key] === "number" && Number.isFinite(record[key]) ? record[key] as number : null;
}

function captureMainDocumentEvent(
  capture: MainDocumentNavigationCapture,
  method: string,
  params: Record<string, unknown>,
): void {
  if (method === "Network.requestWillBeSent" && params.type === "Document") {
    const frameId = typeof params.frameId === "string" ? params.frameId : null;
    if (capture.mainFrameId && frameId && capture.mainFrameId !== frameId) return;
    if (!capture.mainFrameId) capture.mainFrameId = frameId;
    const request = params.request as Record<string, unknown> | undefined;
    const requestUrl = stringRecordValue(request, "url");
    if (params.redirectResponse && requestUrl) capture.redirectUrls.push(requestUrl);
    if (requestUrl) capture.finalUrl = requestUrl;
    return;
  }
  if (method === "Network.responseReceived" && params.type === "Document") {
    const frameId = typeof params.frameId === "string" ? params.frameId : null;
    if (capture.mainFrameId && frameId && capture.mainFrameId !== frameId) return;
    const response = params.response as Record<string, unknown> | undefined;
    capture.mainDocumentHttpStatus = numberRecordValue(response, "status");
    capture.mainDocumentContentType = stringRecordValue(response, "mimeType");
    capture.finalUrl = stringRecordValue(response, "url") ?? capture.finalUrl;
    return;
  }
  if (method === "Page.frameNavigated") {
    const frame = params.frame as Record<string, unknown> | undefined;
    if (frame && frame.parentId === undefined) {
      capture.mainFrameId = stringRecordValue(frame, "id") ?? capture.mainFrameId;
      capture.finalUrl = stringRecordValue(frame, "url") ?? capture.finalUrl;
    }
  }
}

function emptyDomSignals(readyState: string | null): AmazonPageDomSignals {
  return {
    readyState,
    title: null,
    visibleText: "",
    visibleTextLength: 0,
    markerSources: { amazonBrand: null, searchBox: null, deliveryEntry: null },
    markers: {
      amazonBrand: false,
      searchBox: false,
      deliveryEntry: false,
      regionSelection: false,
      privacyPrompt: {
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
      loginWall: {
        state: "absent",
        markerSource: "none",
        selectorCategory: null,
        tagName: null,
        role: null,
        visible: null,
        hasInteractiveControls: null,
        insideNavigation: null,
        blocksMainContent: null,
        matchedText: null,
        reasonCodes: ["login_signal_absent"],
      },
      errorPage: false,
      browserInternalError: false,
    },
  };
}

async function navigateWithPageDiagnostic(
  client: CdpClient,
  sessionId: string,
  requestedUrl: string,
): Promise<{ diagnostic: ReturnType<typeof buildAmazonPageDiagnostic>; pageUrl: string }> {
  const navigationStartedAt = Date.now();
  const capture: MainDocumentNavigationCapture = {
    requestedUrl,
    finalUrl: requestedUrl,
    redirectUrls: [],
    mainFrameId: null,
    mainDocumentHttpStatus: null,
    mainDocumentContentType: null,
  };
  const unsubscribe = client.onEvent((method, params, eventSessionId) => {
    if (eventSessionId === sessionId) captureMainDocumentEvent(capture, method, params);
  });
  try {
    await client.send("Page.navigate", { url: requestedUrl }, sessionId);
    const documentState = await observeDocumentState(client, sessionId);
    capture.finalUrl = documentState.href || capture.finalUrl;
    let domSignals = emptyDomSignals(documentState.readyState);
    try {
      domSignals = await evaluateByValue<AmazonPageDomSignals>(client, sessionId, buildAmazonPageDiagnosticDomExpression());
    } catch {
      // Runtime or DOM access failure is represented as unknown_page rather than bypassing the gate.
    }
    const diagnosticInput: AmazonPageDiagnosticInput = {
      requestedUrl: capture.requestedUrl,
      finalUrl: capture.finalUrl,
      redirectUrls: capture.redirectUrls,
      mainDocumentHttpStatus: capture.mainDocumentHttpStatus,
      mainDocumentContentType: capture.mainDocumentContentType,
      navigationElapsedMs: Date.now() - navigationStartedAt,
      domWaitElapsedMs: documentState.domWaitElapsedMs,
      readyState: domSignals.readyState ?? documentState.readyState,
      title: domSignals.title,
      visibleText: domSignals.visibleText,
      visibleTextLength: domSignals.visibleTextLength,
      markerSources: domSignals.markerSources,
      markers: domSignals.markers,
    };
    return { diagnostic: buildAmazonPageDiagnostic(diagnosticInput), pageUrl: capture.finalUrl };
  } finally {
    unsubscribe();
  }
}

async function inspectCurrentPageWithDiagnostic(
  client: CdpClient,
  sessionId: string,
  capture: MainDocumentNavigationCapture,
): Promise<{ diagnostic: ReturnType<typeof buildAmazonPageDiagnostic>; pageUrl: string }> {
  const documentState = await observeDocumentState(client, sessionId, 5_000);
  capture.finalUrl = documentState.href || capture.finalUrl;
  let domSignals = emptyDomSignals(documentState.readyState);
  try {
    domSignals = await evaluateByValue<AmazonPageDomSignals>(client, sessionId, buildAmazonPageDiagnosticDomExpression());
  } catch {
    // Runtime/DOM errors remain fail-closed as unknown_page.
  }
  const contentType = await evaluateByValue<string | null>(client, sessionId,
    "typeof document.contentType === 'string' ? document.contentType : null").catch(() => null);
  const finalUrl = capture.finalUrl || documentState.href || "about:blank";
  const diagnostic = buildAmazonPageDiagnostic({
    requestedUrl: finalUrl,
    finalUrl,
    redirectUrls: capture.redirectUrls,
    mainDocumentHttpStatus: capture.mainDocumentHttpStatus,
    mainDocumentContentType: capture.mainDocumentContentType ?? contentType,
    navigationElapsedMs: 0,
    domWaitElapsedMs: documentState.domWaitElapsedMs,
    readyState: domSignals.readyState ?? documentState.readyState,
    title: domSignals.title,
    visibleText: domSignals.visibleText,
    visibleTextLength: domSignals.visibleTextLength,
    markerSources: domSignals.markerSources,
    markers: domSignals.markers,
  });
  return { diagnostic, pageUrl: finalUrl };
}

function classificationToPageStatus(classification: AmazonPageClassification): AmazonEnvironmentSignals["pageStatus"] {
  if (classification === "amazon_normal" || classification === "amazon_normal_variant") return "ok";
  if (classification === "captcha") return "captcha";
  if (classification === "login_wall") return "login_wall";
  if (classification === "access_denied" || classification === "browser_error_page") return "error_page";
  return "unknown_page";
}

export function shouldContinueAfterHomepageDiagnostic(
  classification: AmazonPageClassification,
  homepageDiagnosticOnly: boolean,
): boolean {
  return !homepageDiagnosticOnly
    && (classification === "amazon_normal" || classification === "amazon_normal_variant");
}

async function waitForSelector(client: CdpClient, sessionId: string, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateByValue<boolean>(client, sessionId, `document.querySelector(${JSON.stringify(selector)}) !== null`)) {
      return true;
    }
    await delay(100);
  }
  return false;
}

async function readAmazonHomeSignals(client: CdpClient, sessionId: string): Promise<AmazonHomeSignals> {
  return await evaluateByValue<AmazonHomeSignals>(client, sessionId, `(() => {
    const clean = (value, maxLength) => typeof value === 'string'
      ? (value.replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, maxLength) || null)
      : null;
    const body = clean(document.body?.innerText, 4000) ?? '';
    const pageStatus = /captcha|robot check|enter the characters you see|type the characters you see/i.test(body)
      ? 'captcha'
      : /sign in to continue|login to continue|please sign in/i.test(body)
        ? 'login_wall'
        : /sorry[, ]+something went wrong|service unavailable|internal server error/i.test(body)
          ? 'error_page'
          : document.querySelector('#nav-logo, [aria-label="Amazon"], [aria-label^="Amazon"]')
            ? 'ok'
            : 'unknown_page';
    return {
      pageStatus,
      pageUrl: location.href,
      amazonBrandMarkerPresent: document.querySelector('#nav-logo, [aria-label="Amazon"], [aria-label^="Amazon"]') !== null,
      deliveryRegion: clean(document.querySelector('#glow-ingress-line2, #glow-ingress-block')?.textContent, 160),
      language: clean(document.documentElement?.getAttribute('lang'), 40)?.toLowerCase() ?? null,
    };
  })()`);
}

async function applyDeliveryPostalCode(
  client: CdpClient,
  sessionId: string,
  postalCode: string,
): Promise<DeliverySetupResult> {
  const steps: AmazonEnvironmentStep[] = [];
  const before = await readAmazonHomeSignals(client, sessionId);
  const clicked = await evaluateByValue<boolean>(client, sessionId, `(() => {
    const trigger = document.querySelector('#nav-global-location-popover-link');
    if (!(trigger instanceof HTMLElement)) return false;
    trigger.click();
    return true;
  })()`);
  const inputAppeared = clicked && await waitForSelector(client, sessionId, "#GLUXZipUpdateInput", 5_000);
  steps.push({
    stage: "open_delivery_dialog",
    selector: "#nav-global-location-popover-link",
    status: inputAppeared ? "completed" : "failed",
    textBefore: before.deliveryRegion,
    textAfter: inputAppeared ? "#GLUXZipUpdateInput visible" : null,
    detailCode: clicked ? (inputAppeared ? null : "postal_input_not_found") : "delivery_trigger_not_found",
  });
  if (!inputAppeared) return { confirmed: false, steps, finalSignals: await readAmazonHomeSignals(client, sessionId) };

  const inputSet = await evaluateByValue<{ success: boolean; value: string | null }>(client, sessionId, `(() => {
    const input = document.querySelector('#GLUXZipUpdateInput');
    if (!(input instanceof HTMLInputElement)) return { success: false, value: null };
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return { success: false, value: null };
    setter.call(input, ${JSON.stringify(postalCode)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: input.value === ${JSON.stringify(postalCode)}, value: input.value };
  })()`);
  steps.push({
    stage: "enter_postal_code",
    selector: "#GLUXZipUpdateInput",
    status: inputSet.success ? "completed" : "failed",
    textBefore: null,
    textAfter: inputSet.value,
    detailCode: inputSet.success ? null : "postal_input_set_failed",
  });
  if (!inputSet.success) return { confirmed: false, steps, finalSignals: await readAmazonHomeSignals(client, sessionId) };

  const submitted = await evaluateByValue<{ success: boolean; tagName: string | null }>(client, sessionId, `(() => {
    const submit = document.querySelector('#GLUXZipUpdate');
    if (!(submit instanceof HTMLElement)) return { success: false, tagName: null };
    const clickable = submit.matches('input, button') ? submit : submit.querySelector('input, button') ?? submit;
    if (!(clickable instanceof HTMLElement)) return { success: false, tagName: submit.tagName };
    clickable.click();
    return { success: true, tagName: clickable.tagName };
  })()`);
  steps.push({
    stage: "submit_postal_code",
    selector: "#GLUXZipUpdate",
    status: submitted.success ? "completed" : "failed",
    textBefore: inputSet.value,
    textAfter: submitted.tagName,
    detailCode: submitted.success ? null : "postal_submit_not_found",
  });
  if (!submitted.success) return { confirmed: false, steps, finalSignals: await readAmazonHomeSignals(client, sessionId) };

  const deadline = Date.now() + 8_000;
  let confirmed = false;
  while (Date.now() < deadline) {
    const context = await evaluateByValue<{ href?: unknown; deliveryRegion?: unknown }>(client, sessionId, `(() => ({
      href: location.href,
      deliveryRegion: document.querySelector('#glow-ingress-line2, #glow-ingress-block')?.textContent ?? null,
    }))()`);
    if (typeof context.href === "string" && !isAllowedAmazonHostUrl(context.href)) {
      throw new Error("AMAZON_MAIN_FRAME_DOMAIN_NOT_ALLOWED");
    }
    if (typeof context.deliveryRegion === "string" && context.deliveryRegion.includes(postalCode)) {
      confirmed = true;
      break;
    }
    const confirmExists = await evaluateByValue<boolean>(client, sessionId,
      "document.querySelector('#GLUXConfirmClose') !== null");
    if (confirmExists) {
      await evaluateByValue<boolean>(client, sessionId, `(() => {
        const confirm = document.querySelector('#GLUXConfirmClose');
        if (!(confirm instanceof HTMLElement)) return false;
        confirm.click();
        return true;
      })()`);
    }
    await delay(200);
  }
  await client.send("Page.reload", { ignoreCache: false }, sessionId);
  await waitForDocument(client, sessionId);
  const finalSignals = await readAmazonHomeSignals(client, sessionId);
  const explicitUsRegion = finalSignals.deliveryRegion?.includes(postalCode) === true
    && /\b(?:new york|ny|united states|usa)\b/i.test(finalSignals.deliveryRegion);
  confirmed = explicitUsRegion;
  const dialogFeedback = await evaluateByValue<string | null>(client, sessionId, `(() => {
    const text = document.querySelector('#GLUXZipError, .a-alert-content')?.textContent;
    return typeof text === 'string' ? (text.replace(/\\s+/g, ' ').trim().slice(0, 240) || null) : null;
  })()`);
  steps.push({
    stage: "verify_delivery_after_refresh",
    selector: "#glow-ingress-line2, #glow-ingress-block",
    status: confirmed ? "completed" : "failed",
    textBefore: before.deliveryRegion,
    textAfter: finalSignals.deliveryRegion,
    detailCode: confirmed ? null : (dialogFeedback ? `delivery_feedback:${dialogFeedback}` : "delivery_region_not_us"),
  });
  return { confirmed, steps, finalSignals };
}

async function applyEnglishUsdPreferences(client: CdpClient, sessionId: string): Promise<PreferenceSetupResult> {
  const steps: AmazonEnvironmentStep[] = [];
  const before = await evaluateByValue<{ language: string | null; currency: string | null }>(client, sessionId, `(() => ({
    language: document.querySelector('input[name="lop"]:checked')?.getAttribute('value') ?? null,
    currency: document.querySelector('#icp-currency-dropdown-id') instanceof HTMLSelectElement
      ? document.querySelector('#icp-currency-dropdown-id').value
      : null,
  }))()`);
  const setResult = await evaluateByValue<{
    languageFound: boolean;
    currencyFound: boolean;
    saveFound: boolean;
    language: string | null;
    currency: string | null;
  }>(client, sessionId, `(() => {
    const language = document.querySelector('input[name="lop"][value="en_US"]');
    const currency = document.querySelector('#icp-currency-dropdown-id');
    const save = document.querySelector('#icp-save-button');
    if (language instanceof HTMLInputElement) language.click();
    if (currency instanceof HTMLSelectElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(currency, 'USD');
      currency.dispatchEvent(new Event('input', { bubbles: true }));
      currency.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const result = {
      languageFound: language instanceof HTMLInputElement,
      currencyFound: currency instanceof HTMLSelectElement,
      saveFound: save instanceof HTMLElement,
      language: language instanceof HTMLInputElement && language.checked ? language.value : null,
      currency: currency instanceof HTMLSelectElement ? currency.value : null,
    };
    if (result.language === 'en_US' && result.currency === 'USD' && save instanceof HTMLElement) save.click();
    return result;
  })()`);
  steps.push({
    stage: "set_english_usd_preferences",
    selector: "input[name=lop][value=en_US] + #icp-currency-dropdown-id + #icp-save-button",
    status: setResult.language === "en_US" && setResult.currency === "USD" && setResult.saveFound ? "completed" : "failed",
    textBefore: `language=${before.language ?? "unknown"};currency=${before.currency ?? "unknown"}`,
    textAfter: `language=${setResult.language ?? "unknown"};currency=${setResult.currency ?? "unknown"}`,
    detailCode: !setResult.languageFound ? "language_control_not_found"
      : !setResult.currencyFound ? "currency_control_not_found"
        : !setResult.saveFound ? "preference_save_not_found"
          : setResult.language !== "en_US" ? "language_set_failed"
            : setResult.currency !== "USD" ? "currency_set_failed"
              : null,
  });
  return {
    confirmed: setResult.language === "en_US" && setResult.currency === "USD" && setResult.saveFound,
    currencyPreference: setResult.currency,
    steps,
  };
}

export async function runAmazonSearchCanaryBrowser(input: {
  browser: BrowserExecutableCandidate;
  query: "closet organizer";
  postalCode: "10001";
  capturedAt: string;
  maxAppearances: number;
  headless?: boolean;
  homepageDiagnosticOnly?: boolean;
}): Promise<AmazonBrowserCanaryResult> {
  if (!isAbsolute(input.browser.executablePath) || !existsSync(input.browser.executablePath)) {
    throw new Error("browser executable not found");
  }
  if (input.maxAppearances < 1 || input.maxAppearances > 20) throw new Error("CANARY_SAMPLE_BUDGET_INVALID");
  const searchUrl = buildAmazonSearchCanaryUrl(input.query);
  const processBaseline = listBrowserProcessIds(input.browser.browser);
  const profile = await createIsolatedBrowserProfile();
  let browserProcess: ChildProcess | null = null;
  let launchError: Error | null = null;
  let client: CdpClient | null = null;
  let debugPort = 0;
  let targetId: string | null = null;
  let pageClosed = false;
  let browserClosed = false;
  let forcedTerminationUsed = false;
  let debugPortReleased = false;
  let profileRemoved = false;
  let browserVersion: string | null = null;
  let homepageNavigationCount = 0;
  let preferencesNavigationCount = 0;
  let explicitSearchNavigationCount = 0;
  let searchStarted = false;
  let deliveryContextInteractionCount = 0;
  let environmentSteps: AmazonEnvironmentStep[] = [];
  const pageDiagnostics: Array<ReturnType<typeof buildAmazonPageDiagnostic>> = [];
  let environmentGate = evaluateAmazonEnvironment({
    pageStatus: "unknown_page",
    pageUrl: "",
    amazonBrandMarkerPresent: false,
    deliveryRegion: null,
    language: null,
    currencyPreference: null,
  });
  let extraction: AmazonBrowserCanaryResult["extraction"] = null;
  let primaryError: unknown = null;

  try {
    browserProcess = spawn(input.browser.executablePath, buildAmazonBrowserLaunchArguments(profile, input.headless ?? false), {
      stdio: "ignore",
      windowsHide: input.headless ?? false,
    });
    browserProcess.once("error", (error) => { launchError = error; });
    debugPort = await waitForDevToolsPort(profile, browserProcess, () => launchError);
    client = new CdpClient(await getBrowserWebSocketUrl(debugPort));
    await client.connect();
    const version = await client.send("Browser.getVersion") as { product?: unknown };
    browserVersion = typeof version.product === "string" ? version.product : null;
    const created = await client.send("Target.createTarget", { url: "about:blank" }) as { targetId?: unknown };
    if (typeof created.targetId !== "string") throw new Error("CDP_TARGET_CREATE_FAILED");
    targetId = created.targetId;
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId?: unknown };
    if (typeof attached.sessionId !== "string") throw new Error("CDP_TARGET_ATTACH_FAILED");
    const sessionId = attached.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    const homepage = await navigateWithPageDiagnostic(client, sessionId, buildAmazonHomeUrl());
    pageDiagnostics.push(homepage.diagnostic);
    homepageNavigationCount = 1;
    let pageUrl = homepage.pageUrl;

    const initialPageStatus = classificationToPageStatus(homepage.diagnostic.classification);
    const initialHomeSignals: AmazonHomeSignals = initialPageStatus === "ok"
      ? {
          ...await readAmazonHomeSignals(client, sessionId),
          pageStatus: initialPageStatus,
          pageErrorCode: null,
          amazonBrandMarkerPresent: homepage.diagnostic.amazonBrandMarker,
        }
      : {
          pageStatus: initialPageStatus,
          pageErrorCode: homepage.diagnostic.classification,
          pageUrl,
          amazonBrandMarkerPresent: homepage.diagnostic.amazonBrandMarker,
          deliveryRegion: null,
          language: null,
        };
    environmentSteps.push({
      stage: "open_amazon_home",
      selector: "#nav-logo, #glow-ingress-line2",
      status: initialHomeSignals.pageStatus === "ok" ? "completed" : "failed",
      textBefore: null,
      textAfter: initialHomeSignals.deliveryRegion,
      detailCode: initialHomeSignals.pageStatus === "ok"
        ? null
        : initialHomeSignals.pageErrorCode ?? initialHomeSignals.pageStatus,
    });
    environmentGate = evaluateAmazonEnvironment({ ...initialHomeSignals, currencyPreference: null });

    let finalHomeSignals = initialHomeSignals;
    let verifiedCurrencyPreference: string | null = null;
    if (shouldContinueAfterHomepageDiagnostic(
      homepage.diagnostic.classification,
      input.homepageDiagnosticOnly ?? false,
    )) {
      deliveryContextInteractionCount = 1;
      const delivery = await applyDeliveryPostalCode(client, sessionId, input.postalCode);
      environmentSteps = [...environmentSteps, ...delivery.steps];
      finalHomeSignals = delivery.finalSignals;

      if (delivery.confirmed) {
        await client.send("Page.navigate", { url: buildAmazonPreferencesUrl() }, sessionId);
        preferencesNavigationCount = 1;
        pageUrl = await waitForDocument(client, sessionId);
        if (!isAllowedAmazonHostUrl(pageUrl)) throw new Error("AMAZON_MAIN_FRAME_DOMAIN_NOT_ALLOWED");
        const preferences = await applyEnglishUsdPreferences(client, sessionId);
        environmentSteps = [...environmentSteps, ...preferences.steps];

        if (preferences.confirmed) {
          await delay(500);
          await client.send("Page.navigate", { url: buildAmazonPreferencesUrl() }, sessionId);
          preferencesNavigationCount = 2;
          await waitForDocument(client, sessionId);
          const verifiedPreferences = await evaluateByValue<{ language: string | null; currency: string | null }>(
            client,
            sessionId,
            `(() => ({
              language: document.querySelector('input[name="lop"]:checked')?.getAttribute('value') ?? null,
              currency: document.querySelector('#icp-currency-dropdown-id') instanceof HTMLSelectElement
                ? document.querySelector('#icp-currency-dropdown-id').value
                : null,
            }))()`,
          );
          verifiedCurrencyPreference = verifiedPreferences.currency;
          environmentSteps.push({
            stage: "verify_english_usd_preferences",
            selector: "input[name=lop]:checked + #icp-currency-dropdown-id",
            status: verifiedPreferences.language === "en_US" && verifiedPreferences.currency === "USD"
              ? "completed"
              : "failed",
            textBefore: null,
            textAfter: `language=${verifiedPreferences.language ?? "unknown"};currency=${verifiedPreferences.currency ?? "unknown"}`,
            detailCode: verifiedPreferences.language !== "en_US" ? "language_preference_not_confirmed"
              : verifiedPreferences.currency !== "USD" ? "currency_preference_not_confirmed"
                : null,
          });
        }

        await client.send("Page.navigate", { url: buildAmazonHomeUrl() }, sessionId);
        homepageNavigationCount = 2;
        await waitForDocument(client, sessionId);
        await client.send("Page.reload", { ignoreCache: false }, sessionId);
        await waitForDocument(client, sessionId);
        finalHomeSignals = await readAmazonHomeSignals(client, sessionId);
      }
    }

    environmentGate = evaluateAmazonEnvironment({
      ...finalHomeSignals,
      currencyPreference: verifiedCurrencyPreference,
    });
    environmentSteps.push({
      stage: "final_environment_gate",
      selector: "#nav-logo + #glow-ingress-line2 + html[lang] + #icp-currency-dropdown-id",
      status: environmentGate.status === "passed" ? "completed" : "failed",
      textBefore: initialHomeSignals.deliveryRegion,
      textAfter: `${finalHomeSignals.deliveryRegion ?? "unknown"};language=${finalHomeSignals.language ?? "unknown"};currency=${verifiedCurrencyPreference ?? "unknown"}`,
      detailCode: environmentGate.errorCodes[0] ?? null,
    });

    const requested = { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const };
    const unknownObserved = {
      marketplace: null,
      market: null,
      currency: null,
      deliveryRegion: null,
      deliveryRegionMarket: null,
      language: null,
    };
    const preliminaryOptions: AmazonCollectorOptions = {
      query: input.query,
      page: 1,
      maxAppearances: input.maxAppearances,
      capturedAt: input.capturedAt,
      requested,
      observed: unknownObserved,
    };
    if (environmentGate.canSearch && !(input.homepageDiagnosticOnly ?? false)) {
      await client.send("Page.navigate", { url: searchUrl }, sessionId);
      explicitSearchNavigationCount = 1;
      searchStarted = true;
      pageUrl = await waitForDocument(client, sessionId);
      if (!isAllowedAmazonHostUrl(pageUrl)) throw new Error("AMAZON_MAIN_FRAME_DOMAIN_NOT_ALLOWED");
      const preliminary = await evaluateByValue<AmazonBrowserCanaryResult["extraction"]>(client, sessionId,
        buildAmazonSearchPageExtractionExpression(preliminaryOptions));
      if (!preliminary) throw new Error("AMAZON_EXTRACTION_EMPTY");
      const signals = await evaluateByValue<ReturnType<typeof import("./extract-search-page").inspectAmazonPageContext>>(
        client, sessionId, buildAmazonPageContextExpression(),
      );
      const observed = deriveObservedAmazonMarketContext(
        signals,
        preliminary.observations.map((item) => item.priceCurrency),
        input.postalCode,
      );
      extraction = await evaluateByValue<AmazonBrowserCanaryResult["extraction"]>(client, sessionId,
        buildAmazonSearchPageExtractionExpression({ ...preliminaryOptions, observed }));
      if (!extraction) throw new Error("AMAZON_EXTRACTION_EMPTY");
      if (!isAllowedAmazonSearchPageUrl(signals.pageUrl) && extraction.pageStatus === "ok") {
        extraction = { ...extraction, pageStatus: "unknown_page", blocked: true };
      }
    }

    const closed = await client.send("Target.closeTarget", { targetId }) as { success?: unknown };
    pageClosed = closed.success === true;
    targetId = null;
    await client.send("Browser.close");
    browserClosed = await waitForProcessExit(browserProcess, 5_000);
  } catch (error) {
    primaryError = error;
  } finally {
    if (client && targetId) {
      try {
        const closed = await client.send("Target.closeTarget", { targetId }) as { success?: unknown };
        pageClosed = closed.success === true;
      } catch {
        pageClosed = false;
      }
    }
    client?.close();
    if (browserProcess && !browserClosed) {
      browserClosed = await waitForProcessExit(browserProcess, 1_000);
      if (!browserClosed) {
        forcedTerminationUsed = true;
        forceTerminateOwnedProcess(browserProcess);
        browserClosed = await waitForProcessExit(browserProcess, 5_000);
      }
    }
    if (debugPort > 0) debugPortReleased = await waitForReleasedPort(debugPort, 5_000);
    try {
      await cleanupIsolatedBrowserProfile(profile);
      profileRemoved = !existsSync(profile.profilePath);
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }
  const processFinal = listBrowserProcessIds(input.browser.browser);
  const errorCode = primaryError
    ? classifyBrowserControlError(primaryError).code
    : environmentGate.status === "failed" ? environmentGate.errorCodes[0] ?? "environment_gate_failed" : null;
  return {
    status: primaryError || environmentGate.status === "failed" ? "failed" : "completed",
    errorCode,
    browser: input.browser.browser,
    browserLocationType: input.browser.locationType,
    browserVersion,
    profileId: profile.profileId,
    profileLocationType: profile.locationType,
    debugPort,
    homepageNavigationCount,
    preferencesNavigationCount,
    explicitSearchNavigationCount,
    searchStarted,
    deliveryContextInteractionCount,
    environmentGate,
    environmentSteps,
    pageDiagnostics,
    extraction,
    pageClosed,
    browserClosed,
    forcedTerminationUsed,
    debugPortReleased,
    profileRemoved,
    browserProcessBaselineCount: processBaseline.length,
    browserProcessFinalCount: processFinal.length,
    browserProcessBaselineRestored: sameProcessBaseline(processBaseline, processFinal),
  };
}

export async function openIsolatedPublicBrowserSession(input: {
  browser: BrowserExecutableCandidate;
  allowedOrigins: readonly string[];
  maxNavigations: number;
  headless?: boolean;
}): Promise<IsolatedPublicBrowserSession> {
  if (!isAbsolute(input.browser.executablePath) || !existsSync(input.browser.executablePath)) {
    throw new Error("browser executable not found");
  }
  if (input.allowedOrigins.length === 0 || input.allowedOrigins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin !== origin || parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "";
    } catch {
      return true;
    }
  })) throw new Error("PUBLIC_ALLOWED_ORIGIN_INVALID");
  if (!Number.isInteger(input.maxNavigations) || input.maxNavigations < 1 || input.maxNavigations > 10) {
    throw new Error("PUBLIC_NAVIGATION_BUDGET_INVALID");
  }

  const processBaseline = listBrowserProcessIds(input.browser.browser);
  const profile = await createIsolatedBrowserProfile();
  let browserProcess: ChildProcess | null = null;
  let client: CdpClient | null = null;
  let targetId: string | null = null;
  let debugPort = 0;
  let launchError: Error | null = null;
  let closed = false;
  let navigationCount = 0;
  let failClosed = false;
  let unsubscribeCapture: (() => void) | null = null;
  const capture: MainDocumentNavigationCapture = {
    requestedUrl: "about:blank",
    finalUrl: "about:blank",
    redirectUrls: [],
    mainFrameId: null,
    mainDocumentHttpStatus: null,
    mainDocumentContentType: null,
  };

  const closeOwnedSession = async (): Promise<HumanAssistedBrowserCleanup> => {
    if (closed) {
      return {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: debugPort === 0 || await isLoopbackPortReleased(debugPort),
        profileRemoved: !existsSync(profile.profilePath),
        browserProcessBaselineRestored: sameProcessBaseline(processBaseline, listBrowserProcessIds(input.browser.browser)),
      };
    }
    closed = true;
    let pageClosed = targetId === null;
    let browserClosed = browserProcess === null;
    let forcedTerminationUsed = false;
    unsubscribeCapture?.();
    unsubscribeCapture = null;
    if (client && targetId) {
      try {
        const result = await client.send("Target.closeTarget", { targetId }) as { success?: unknown };
        pageClosed = result.success === true;
      } catch {
        pageClosed = browserProcess?.exitCode !== null || browserProcess?.signalCode !== null;
      }
      targetId = null;
    }
    if (client) {
      try {
        await client.send("Browser.close");
      } catch {
        // The owned process fallback below completes cleanup.
      }
      client.close();
      client = null;
    }
    if (browserProcess) {
      browserClosed = await waitForProcessExit(browserProcess, 2_000);
      if (!browserClosed) {
        forcedTerminationUsed = true;
        forceTerminateOwnedProcess(browserProcess);
        browserClosed = await waitForProcessExit(browserProcess, 5_000);
      }
    }
    const debugPortReleased = debugPort === 0 || await waitForReleasedPort(debugPort, 5_000);
    let profileRemoved = false;
    try {
      await cleanupIsolatedBrowserProfile(profile);
      profileRemoved = !existsSync(profile.profilePath);
    } catch {
      profileRemoved = false;
    }
    return {
      pageClosed,
      browserClosed,
      forcedTerminationUsed,
      debugPortReleased,
      profileRemoved,
      browserProcessBaselineRestored: sameProcessBaseline(processBaseline, listBrowserProcessIds(input.browser.browser)),
    };
  };

  try {
    browserProcess = spawn(input.browser.executablePath, buildAmazonBrowserLaunchArguments(profile, input.headless ?? false), {
      stdio: "ignore",
      windowsHide: input.headless ?? false,
    });
    browserProcess.once("error", (error) => { launchError = error; });
    debugPort = await waitForDevToolsPort(profile, browserProcess, () => launchError);
    client = new CdpClient(await getBrowserWebSocketUrl(debugPort));
    await client.connect();
    const version = await client.send("Browser.getVersion") as { product?: unknown };
    const browserVersion = typeof version.product === "string" ? version.product : null;
    const created = await client.send("Target.createTarget", { url: "about:blank" }) as { targetId?: unknown };
    if (typeof created.targetId !== "string") throw new Error("CDP_TARGET_CREATE_FAILED");
    targetId = created.targetId;
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId?: unknown };
    if (typeof attached.sessionId !== "string") throw new Error("CDP_TARGET_ATTACH_FAILED");
    const sessionId = attached.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    unsubscribeCapture = client.onEvent((method, params, eventSessionId) => {
      if (eventSessionId === sessionId) captureMainDocumentEvent(capture, method, params);
    });

    return {
      browser: input.browser.browser,
      browserLocationType: input.browser.locationType,
      browserVersion,
      profileId: profile.profileId,
      profileLocationType: profile.locationType,
      debugPort,
      get navigationCount() { return navigationCount; },
      navigate: async (url) => {
        if (closed || !client) throw new Error("PUBLIC_BROWSER_SESSION_CLOSED");
        if (failClosed) throw new Error("PUBLIC_BROWSER_SESSION_FAIL_CLOSED");
        if (!isAllowedPublicNavigationUrl(url, input.allowedOrigins)) throw new Error("PUBLIC_NAVIGATION_URL_NOT_ALLOWED");
        if (navigationCount >= input.maxNavigations) throw new Error("PUBLIC_NAVIGATION_BUDGET_EXHAUSTED");
        navigationCount += 1;
        Object.assign(capture, {
          requestedUrl: url,
          finalUrl: url,
          redirectUrls: [],
          mainFrameId: null,
          mainDocumentHttpStatus: null,
          mainDocumentContentType: null,
        });
        const startedAt = Date.now();
        const navigation = await client.send("Page.navigate", { url }, sessionId) as { errorText?: unknown };
        if (typeof navigation.errorText === "string" && navigation.errorText.length > 0) {
          failClosed = true;
          throw new Error(`PUBLIC_NAVIGATION_FAILED:${navigation.errorText}`);
        }
        const state = await observeDocumentState(client, sessionId, 20_000);
        const finalUrl = state.href || capture.finalUrl;
        const allowedFinalOrigin = isAllowedPublicNavigationUrl(finalUrl, input.allowedOrigins);
        if (!allowedFinalOrigin) failClosed = true;
        return {
          requestedUrl: url,
          finalUrl,
          redirectOrigins: [...new Set(capture.redirectUrls.map((redirectUrl) => {
            try { return new URL(redirectUrl).origin; } catch { return "invalid_url"; }
          }))],
          redirectCount: capture.redirectUrls.length,
          mainDocumentHttpStatus: capture.mainDocumentHttpStatus,
          mainDocumentContentType: capture.mainDocumentContentType,
          navigationElapsedMs: Date.now() - startedAt,
          domWaitElapsedMs: state.domWaitElapsedMs,
          readyState: state.readyState,
          allowedFinalOrigin,
        };
      },
      evaluateDomByValue: async <T>(expression: string) => {
        if (closed || !client) throw new Error("PUBLIC_BROWSER_SESSION_CLOSED");
        validatePublicDomExpression(expression);
        return await evaluateByValue<T>(client, sessionId, expression);
      },
      close: closeOwnedSession,
    };
  } catch (error) {
    const cleanup = await closeOwnedSession();
    const failure = error instanceof Error ? error : new Error(errorMessage(error));
    (failure as LocalBrowserControlFailure).cleanup = cleanup;
    throw failure;
  }
}

export async function openHumanAssistedAmazonBrowser(input: {
  browser: BrowserExecutableCandidate;
  headless?: boolean;
}): Promise<HumanAssistedBrowserSession> {
  if (!isAbsolute(input.browser.executablePath) || !existsSync(input.browser.executablePath)) {
    throw new Error("browser executable not found");
  }
  const processBaseline = listBrowserProcessIds(input.browser.browser);
  const profile = await createIsolatedBrowserProfile();
  let browserProcess: ChildProcess | null = null;
  let client: CdpClient | null = null;
  let targetId: string | null = null;
  let debugPort = 0;
  let launchError: Error | null = null;
  let closed = false;
  let unsubscribeCapture: (() => void) | null = null;
  const capture: MainDocumentNavigationCapture = {
    requestedUrl: "about:blank",
    finalUrl: "about:blank",
    redirectUrls: [],
    mainFrameId: null,
    mainDocumentHttpStatus: null,
    mainDocumentContentType: null,
  };

  const closeOwnedSession = async (): Promise<HumanAssistedBrowserCleanup> => {
    if (closed) {
      return {
        pageClosed: true,
        browserClosed: true,
        forcedTerminationUsed: false,
        debugPortReleased: debugPort === 0 || await isLoopbackPortReleased(debugPort),
        profileRemoved: !existsSync(profile.profilePath),
        browserProcessBaselineRestored: sameProcessBaseline(processBaseline, listBrowserProcessIds(input.browser.browser)),
      };
    }
    closed = true;
    let pageClosed = targetId === null;
    let browserClosed = browserProcess === null;
    let forcedTerminationUsed = false;
    unsubscribeCapture?.();
    unsubscribeCapture = null;
    if (client && targetId) {
      try {
        const result = await client.send("Target.closeTarget", { targetId }) as { success?: unknown };
        pageClosed = result.success === true;
      } catch {
        pageClosed = browserProcess?.exitCode !== null || browserProcess?.signalCode !== null;
      }
      targetId = null;
    }
    if (client) {
      try {
        await client.send("Browser.close");
      } catch {
        // The owned-process fallback below is responsible for final cleanup.
      }
      client.close();
      client = null;
    }
    if (browserProcess) {
      browserClosed = await waitForProcessExit(browserProcess, 2_000);
      if (!browserClosed) {
        forcedTerminationUsed = true;
        forceTerminateOwnedProcess(browserProcess);
        browserClosed = await waitForProcessExit(browserProcess, 5_000);
      }
    }
    const debugPortReleased = debugPort === 0 || await waitForReleasedPort(debugPort, 5_000);
    let profileRemoved = false;
    try {
      await cleanupIsolatedBrowserProfile(profile);
      profileRemoved = !existsSync(profile.profilePath);
    } catch {
      profileRemoved = false;
    }
    return {
      pageClosed,
      browserClosed,
      forcedTerminationUsed,
      debugPortReleased,
      profileRemoved,
      browserProcessBaselineRestored: sameProcessBaseline(processBaseline, listBrowserProcessIds(input.browser.browser)),
    };
  };

  try {
    browserProcess = spawn(input.browser.executablePath, buildAmazonBrowserLaunchArguments(profile, input.headless ?? false), {
      stdio: "ignore",
      windowsHide: input.headless ?? false,
    });
    browserProcess.once("error", (error) => { launchError = error; });
    debugPort = await waitForDevToolsPort(profile, browserProcess, () => launchError);
    client = new CdpClient(await getBrowserWebSocketUrl(debugPort));
    await client.connect();
    const version = await client.send("Browser.getVersion") as { product?: unknown };
    const browserVersion = typeof version.product === "string" ? version.product : null;
    const created = await client.send("Target.createTarget", { url: "about:blank" }) as { targetId?: unknown };
    if (typeof created.targetId !== "string") throw new Error("CDP_TARGET_CREATE_FAILED");
    targetId = created.targetId;
    const attached = await client.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId?: unknown };
    if (typeof attached.sessionId !== "string") throw new Error("CDP_TARGET_ATTACH_FAILED");
    const sessionId = attached.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    unsubscribeCapture = client.onEvent((method, params, eventSessionId) => {
      if (eventSessionId !== sessionId) return;
      if (method === "Network.requestWillBeSent" && params.type === "Document") {
        const request = params.request as Record<string, unknown> | undefined;
        const requestUrl = stringRecordValue(request, "url");
        if (requestUrl && requestUrl !== "about:blank") capture.requestedUrl = requestUrl;
      }
      captureMainDocumentEvent(capture, method, params);
    });

    return {
      browser: input.browser.browser,
      browserLocationType: input.browser.locationType,
      browserVersion,
      profileId: profile.profileId,
      profileLocationType: profile.locationType,
      debugPort,
      inspectCurrentPage: async (inspectionInput) => {
        if (inspectionInput.query !== "closet organizer") throw new Error("CANARY_QUERY_NOT_AUTHORIZED");
        if (!Number.isInteger(inspectionInput.maxAppearances)
          || inspectionInput.maxAppearances < 1 || inspectionInput.maxAppearances > 20) {
          throw new Error("CANARY_SAMPLE_BUDGET_INVALID");
        }
        if (closed || !client) throw new Error("HUMAN_ASSISTED_SESSION_CLOSED");
        const inspected = await inspectCurrentPageWithDiagnostic(client, sessionId, capture);
        const pageStatus = classificationToPageStatus(inspected.diagnostic.classification);
        const allowedSearchPage = pageStatus === "ok" && isAllowedAmazonSearchPageUrl(inspected.pageUrl);
        const context = isAllowedAmazonHostUrl(inspected.pageUrl)
          ? await evaluateByValue<ReturnType<typeof import("./extract-search-page").inspectAmazonPageContext>>(
              client, sessionId, buildAmazonPageContextExpression(),
            ).catch(() => null)
          : null;
        let environmentGate = evaluateAmazonEnvironment({
          pageStatus: allowedSearchPage ? "unknown_page" : pageStatus,
          pageErrorCode: pageStatus === "ok"
            ? "not_amazon_search_page"
            : inspected.diagnostic.classification,
          pageUrl: inspected.pageUrl,
          amazonBrandMarkerPresent: context?.amazonBrandMarkerPresent ?? inspected.diagnostic.amazonBrandMarker,
          deliveryRegion: context?.deliveryRegion ?? null,
          language: context?.language ?? null,
          currencyPreference: null,
        });
        if (!allowedSearchPage) {
          return { diagnostic: inspected.diagnostic, allowedSearchPage, environmentGate, extraction: null };
        }
        const requested = { marketplace: "amazon.com" as const, market: "US" as const, currency: "USD" as const };
        const unknownObserved = {
          marketplace: null,
          market: null,
          currency: null,
          deliveryRegion: null,
          deliveryRegionMarket: null,
          language: null,
        };
        const options: AmazonCollectorOptions = {
          query: inspectionInput.query,
          page: 1,
          maxAppearances: inspectionInput.maxAppearances,
          capturedAt: inspectionInput.capturedAt,
          requested,
          observed: unknownObserved,
        };
        const preliminary = await evaluateByValue<NonNullable<HumanAssistedPageInspection["extraction"]>>(
          client, sessionId, buildAmazonSearchPageExtractionExpression(options),
        );
        const verifiedContext = context ?? await evaluateByValue<ReturnType<typeof import("./extract-search-page").inspectAmazonPageContext>>(
          client, sessionId, buildAmazonPageContextExpression(),
        );
        const observed = deriveObservedAmazonMarketContext(
          verifiedContext,
          preliminary.observations.map((observation) => observation.priceCurrency),
          inspectionInput.expectedPostalCode,
        );
        environmentGate = evaluateAmazonEnvironment({
          pageStatus: preliminary.pageStatus,
          pageErrorCode: preliminary.pageStatus === "ok" ? null : preliminary.pageStatus,
          pageUrl: verifiedContext.pageUrl,
          amazonBrandMarkerPresent: verifiedContext.amazonBrandMarkerPresent,
          deliveryRegion: verifiedContext.deliveryRegion,
          language: verifiedContext.language,
          currencyPreference: observed.currency,
        });
        if (environmentGate.status === "failed") {
          return { diagnostic: inspected.diagnostic, allowedSearchPage, environmentGate, extraction: null };
        }
        const extraction = await evaluateByValue<NonNullable<HumanAssistedPageInspection["extraction"]>>(
          client, sessionId, buildAmazonSearchPageExtractionExpression({ ...options, observed }),
        );
        if (extraction.observations.length > inspectionInput.maxAppearances) throw new Error("CANARY_SAMPLE_BUDGET_EXCEEDED");
        return { diagnostic: inspected.diagnostic, allowedSearchPage, environmentGate, extraction };
      },
      close: closeOwnedSession,
    };
  } catch (error) {
    const cleanup = await closeOwnedSession();
    const failure = error instanceof Error ? error : new Error(errorMessage(error));
    (failure as LocalBrowserControlFailure).cleanup = cleanup;
    throw failure;
  }
}

export async function runAmazonHomepageDiagnosticBrowser(input: {
  browser: BrowserExecutableCandidate;
  capturedAt: string;
  headless?: boolean;
}): Promise<AmazonBrowserCanaryResult> {
  return await runAmazonSearchCanaryBrowser({
    browser: input.browser,
    query: "closet organizer",
    postalCode: "10001",
    capturedAt: input.capturedAt,
    maxAppearances: 1,
    headless: input.headless,
    homepageDiagnosticOnly: true,
  });
}

export async function runLocalBrowserControlSmoke(input: {
  browser: BrowserExecutableCandidate;
  localFixturePath: string;
  headless?: boolean;
  expectedProbeText?: string;
}): Promise<LocalBrowserControlResult> {
  if (!isAbsolute(input.browser.executablePath) || !existsSync(input.browser.executablePath)) {
    throw new Error("browser executable not found");
  }
  const fixtureStats = await stat(input.localFixturePath);
  if (!fixtureStats.isFile()) throw new Error("LOCAL_BROWSER_FIXTURE_NOT_FILE");
  const fixtureUrl = pathToFileURL(resolve(input.localFixturePath));
  if (fixtureUrl.protocol !== "file:") throw new Error("LOCAL_BROWSER_FIXTURE_PROTOCOL_INVALID");

  const profile = await createIsolatedBrowserProfile();
  let browserProcess: ChildProcess | null = null;
  let launchError: Error | null = null;
  let client: CdpClient | null = null;
  let targetId: string | null = null;
  let debugPort = 0;
  let pageCreated = false;
  let pageClosed = false;
  let browserClosed = false;
  let forcedTerminationUsed = false;
  let debugPortReleased = false;
  let profileRemoved = false;
  let title = "";
  let probeText: string | null = null;
  let diagnosticClassification: AmazonPageClassification = "unknown_page";
  let primaryError: unknown = null;

  try {
    browserProcess = spawn(
      input.browser.executablePath,
      browserLaunchArguments(profile, input.headless ?? false),
      { stdio: "ignore", windowsHide: input.headless ?? false },
    );
    browserProcess.once("error", (error) => {
      launchError = error;
    });
    debugPort = await waitForDevToolsPort(profile, browserProcess, () => launchError);
    const browserWebSocketUrl = await getBrowserWebSocketUrl(debugPort);
    client = new CdpClient(browserWebSocketUrl);
    await client.connect();

    const created = await client.send("Target.createTarget", { url: "about:blank" }) as { targetId?: unknown };
    if (typeof created.targetId !== "string") throw new Error("CDP_TARGET_CREATE_FAILED");
    targetId = created.targetId;
    pageCreated = true;
    const attached = await client.send("Target.attachToTarget", { targetId: created.targetId, flatten: true }) as {
      sessionId?: unknown;
    };
    if (typeof attached.sessionId !== "string") throw new Error("CDP_TARGET_ATTACH_FAILED");
    await client.send("Page.enable", {}, attached.sessionId);
    await client.send("Runtime.enable", {}, attached.sessionId);
    await client.send("Network.enable", {}, attached.sessionId);
    const localDiagnostic = await navigateWithPageDiagnostic(client, attached.sessionId, fixtureUrl.href);
    diagnosticClassification = localDiagnostic.diagnostic.classification;

    const pageDeadline = Date.now() + 5_000;
    let pageState: LocalPageState | null = null;
    while (Date.now() < pageDeadline) {
      const evaluated = await client.send("Runtime.evaluate", {
        expression: "({ readyState: document.readyState, title: document.title, probeText: document.querySelector('#probe')?.textContent ?? null, href: location.href })",
        returnByValue: true,
      }, attached.sessionId) as { result?: { value?: unknown } };
      pageState = evaluated.result?.value as LocalPageState | null;
      if (pageState?.readyState === "complete") break;
      await delay(50);
    }
    if (pageState?.readyState !== "complete") throw new Error("LOCAL_BROWSER_PAGE_LOAD_TIMEOUT");
    if (typeof pageState.href !== "string" || new URL(pageState.href).protocol !== "file:") {
      throw new Error("LOCAL_BROWSER_NAVIGATION_ESCAPED_FILE_PROTOCOL");
    }
    title = typeof pageState.title === "string" ? pageState.title : "";
    probeText = typeof pageState.probeText === "string" ? pageState.probeText : null;
    if (input.expectedProbeText !== undefined && probeText !== input.expectedProbeText) {
      throw new Error("LOCAL_BROWSER_PROBE_MISMATCH");
    }

    const closed = await client.send("Target.closeTarget", { targetId: created.targetId }) as { success?: unknown };
    pageClosed = closed.success === true;
    if (!pageClosed) throw new Error("CDP_TARGET_CLOSE_FAILED");
    targetId = null;
    await client.send("Browser.close");
    browserClosed = await waitForProcessExit(browserProcess, 5_000);
  } catch (error) {
    primaryError = error;
  } finally {
    if (client && targetId) {
      try {
        const closed = await client.send("Target.closeTarget", { targetId }) as { success?: unknown };
        pageClosed = closed.success === true;
        targetId = null;
      } catch {
        pageClosed = false;
      }
      try {
        await client.send("Browser.close");
        if (browserProcess) browserClosed = await waitForProcessExit(browserProcess, 5_000);
      } catch {
        // The owned process fallback below remains responsible for cleanup.
      }
    }
    client?.close();
    if (browserProcess && !browserClosed) {
      browserClosed = await waitForProcessExit(browserProcess, 1_000);
      if (!browserClosed) {
        forcedTerminationUsed = true;
        forceTerminateOwnedProcess(browserProcess);
        browserClosed = await waitForProcessExit(browserProcess, 5_000);
      }
    }
    if (debugPort > 0) debugPortReleased = await waitForReleasedPort(debugPort, 5_000);
    try {
      await cleanupIsolatedBrowserProfile(profile);
      profileRemoved = !existsSync(profile.profilePath);
    } catch (cleanupError) {
      if (!primaryError) primaryError = cleanupError;
    }
  }

  if (primaryError) {
    const failure = (primaryError instanceof Error ? primaryError : new Error(errorMessage(primaryError))) as LocalBrowserControlFailure;
    failure.cleanup = { pageClosed, browserClosed, forcedTerminationUsed, debugPortReleased, profileRemoved };
    throw failure;
  }
  if (!browserClosed) throw new Error("BROWSER_PROCESS_CLOSE_TIMEOUT");
  if (!debugPortReleased) throw new Error("BROWSER_DEBUG_PORT_NOT_RELEASED");
  if (!profileRemoved) throw new Error("BROWSER_PROFILE_CLEANUP_FAILED");

  return {
    browser: input.browser.browser,
    browserLocationType: input.browser.locationType,
    profileId: profile.profileId,
    profileLocationType: profile.locationType,
    debugPort,
    pageUrlProtocol: "file:",
    title,
    probeText,
    diagnosticClassification,
    pageCreated,
    pageClosed,
    browserClosed,
    forcedTerminationUsed,
    debugPortReleased,
    profileRemoved,
  };
}
