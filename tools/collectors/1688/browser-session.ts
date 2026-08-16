/**
 * V3.5 — 1688 专用持久浏览器会话（Local1688BrowserDriver 底层）
 *
 * 架构裁决（详见 docs/v3/changes/v3-5-implementation/architecture-decision.md）：
 * 复用 V3.3 成熟架构模式（loopback CDP + profile + fail-closed 分类），
 * 为 1688 提供 dedicated persistent profile（用户首次正常登录后由专用 profile 合法保留 session）。
 *
 * 安全：
 * - 只监听 127.0.0.1 loopback CDP；不复制任何 Cookie/Token；不读取其他浏览器 profile。
 * - 专用 profile 路径可配置（V35_1688_BROWSER_PROFILE），默认 %USERPROFILE%/.qingxuan/1688-browser-profile。
 * - 页面域白名单在 driver 层强制（s.1688.com / air.1688.com）。
 * - 前台窗口为硬前置：CDP 输入事件在窗口未聚焦时被浏览器丢弃 → 上传不响应 → fail-closed。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { basename, join, isAbsolute } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export type BrowserKind = "chrome" | "edge";

export type BrowserExecutable = {
  browser: BrowserKind;
  executablePath: string;
};

export type PersistentBrowserSession = {
  browser: BrowserKind;
  browserVersion: string | null;
  profilePath: string;
  debugPort: number;
  attached: "existing" | "launched";
  evaluate<T>(expression: string): Promise<T>;
  evaluateWithSession<T>(expression: string, sessionId: string): Promise<T>;
  /** 发送到页面 target session（Page/DOM/Input/Runtime 等页面域命令） */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** 发送到浏览器根 session（Browser/Target 等浏览器域命令） */
  sendRoot(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: (method: string, params: Record<string, unknown>, sessionId?: string) => void): () => void;
  windowState: Promise<string>;
  close(): void;
};

export class BrowserSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "BrowserSessionError";
  }
}

export const DEFAULT_1688_PROFILE_DIR = join(homedir(), ".qingxuan", "1688-browser-profile");
export const BROWSER_SESSION_DRIVER_VERSION = "local-1688-browser-driver.v1";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLoopbackPortOpen(port: number): Promise<boolean> {
  return new Promise((resolveCheck) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveCheck(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

function defaultBrowserCandidates(): BrowserExecutable[] {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const candidates: BrowserExecutable[] = [];
  if (programFiles) candidates.push({ browser: "chrome", executablePath: join(programFiles, "Google", "Chrome", "Application", "chrome.exe") });
  if (programFilesX86) candidates.push({ browser: "edge", executablePath: join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe") });
  if (programFilesX86) candidates.push({ browser: "chrome", executablePath: join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe") });
  if (programFiles) candidates.push({ browser: "edge", executablePath: join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe") });
  return candidates;
}

export function resolveBrowserExecutable(candidates = defaultBrowserCandidates()): BrowserExecutable | null {
  return candidates.find((candidate) => isAbsolute(candidate.executablePath) && existsSync(candidate.executablePath)) ?? null;
}

/** 解析持久 profile 路径：env 优先，默认用户目录（不读其他 profile） */
export function resolve1688ProfilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.V35_1688_BROWSER_PROFILE;
  if (configured && configured.trim()) return configured.trim();
  return DEFAULT_1688_PROFILE_DIR;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/** DevToolsActivePort 文件（持久 profile 每次启动会重写） */
function devToolsPortFile(profilePath: string): string {
  return join(profilePath, "DevToolsActivePort");
}

/** 尝试 attach 已运行的实例（profile 锁存在 + 端口存活） */
async function tryAttachExisting(profilePath: string): Promise<number | null> {
  if (!existsSync(devToolsPortFile(profilePath))) return null;
  const content = readFileSync(devToolsPortFile(profilePath), "utf8");
  const port = Number(content.split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  if (!(await isLoopbackPortOpen(port))) return null;
  return port;
}

async function waitForDevToolsPort(profilePath: string, browserProcess: ChildProcess | null, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (browserProcess && browserProcess.exitCode !== null) {
      throw new BrowserSessionError("browser_not_ready", 503, "浏览器启动后异常退出。");
    }
    if (existsSync(devToolsPortFile(profilePath))) {
      try {
        const content = readFileSync(devToolsPortFile(profilePath), "utf8");
        const port = Number(content.split(/\r?\n/)[0]);
        if (Number.isInteger(port) && port > 0 && port <= 65_535 && (await isLoopbackPortOpen(port))) return port;
      } catch {
        // 文件被占用时重试
      }
    }
    await delay(100);
  }
  throw new BrowserSessionError("browser_not_ready", 503, "浏览器调试端口等待超时。");
}

async function getBrowserWebSocketUrl(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new BrowserSessionError("browser_not_ready", 503, "浏览器调试端点不可用。");
  const body = await response.json() as { webSocketDebuggerUrl?: unknown };
  if (typeof body.webSocketDebuggerUrl !== "string") {
    throw new BrowserSessionError("browser_not_ready", 503, "浏览器调试端点缺少 WebSocket URL。");
  }
  const url = new URL(body.webSocketDebuggerUrl);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new BrowserSessionError("browser_not_ready", 503, "浏览器调试端点不是 loopback，已拒绝。");
  }
  return body.webSocketDebuggerUrl;
}

type CdpResponse = {
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type PendingCdpCall = { resolve: (value: unknown) => void; reject: (error: Error) => void };

class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCdpCall>();
  private readonly listeners = new Set<(method: string, params: Record<string, unknown>, sessionId?: string) => void>();

  constructor(url: string) {
    if (typeof WebSocket !== "function") throw new BrowserSessionError("browser_not_ready", 503, "WebSocket 不可用。");
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
      this.socket.addEventListener("error", () => finish(() => rejectConnection(new Error("BROWSER_DEBUG_SOCKET_ERROR"))), { once: true });
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

  onEvent(listener: (method: string, params: Record<string, unknown>, sessionId?: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data) as CdpResponse;
    if (typeof message.id !== "number") {
      if (typeof message.method === "string") {
        for (const listener of this.listeners) listener(message.method, message.params ?? {}, message.sessionId);
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`CDP_${message.error.code ?? "ERROR"}: ${message.error.message ?? "unknown"}`));
      return;
    }
    pending.resolve(message.result);
  }
}

async function evaluateIn<T>(client: CdpClient, sessionId: string, expression: string): Promise<T> {
  const evaluated = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }, sessionId) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: unknown; exception?: { description?: unknown } };
  };
  if (evaluated.exceptionDetails) {
    const text = typeof evaluated.exceptionDetails.text === "string" ? evaluated.exceptionDetails.text : "";
    throw new Error(`CDP_RUNTIME_EVALUATION_FAILED: ${text}`);
  }
  return evaluated.result?.value as T;
}

/** 打开（或 attach）1688 持久浏览器会话；前台窗口，loopback CDP */
export async function open1688BrowserSession(input: {
  env?: NodeJS.ProcessEnv;
  profilePath?: string;
  headless?: boolean;
} = {}): Promise<PersistentBrowserSession> {
  const env = input.env ?? process.env;
  const profilePath = input.profilePath ?? resolve1688ProfilePath(env);
  const executable = resolveBrowserExecutable();
  if (!executable) {
    throw new BrowserSessionError("browser_not_ready", 503, "未找到可用的 Chrome/Edge 浏览器。");
  }

  // 1) 已有实例优先 attach（session 持久）
  const existingPort = await tryAttachExisting(profilePath);
  if (existingPort !== null) {
    return await attachToBrowser(profilePath, existingPort, executable.browser, "existing");
  }

  // 2) 启动新实例（持久 profile；前台窗口）
  await mkdir(profilePath, { recursive: true });
  const args = [
    `--user-data-dir=${profilePath}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-breakpad",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-search-engine-choice-screen",
    "--no-pings",
    "--no-service-autorun",
    ...(input.headless ? ["--headless=new"] : []),
    "about:blank",
  ];
  const browserProcess = spawn(executable.executablePath, args, {
    stdio: "ignore",
    windowsHide: input.headless ?? false,
  });
  browserProcess.once("error", () => { /* waitForDevToolsPort 会兜底 */ });
  const debugPort = await waitForDevToolsPort(profilePath, browserProcess, 15_000);
  return await attachToBrowser(profilePath, debugPort, executable.browser, "launched");
}

async function attachToBrowser(
  profilePath: string,
  debugPort: number,
  browser: BrowserKind,
  attached: "existing" | "launched",
): Promise<PersistentBrowserSession> {
  const client = new CdpClient(await getBrowserWebSocketUrl(debugPort));
  await client.connect();

  let sessionId = "";
  let browserVersion: string | null = null;
  try {
    const version = await client.send("Browser.getVersion") as { product?: unknown };
    browserVersion = typeof version.product === "string" ? version.product : null;
    // 主页面 target：取现有页面或创建 about:blank
    const targets = await client.send("Target.getTargets") as { targetInfos?: Array<{ targetId?: unknown; type?: unknown; url?: unknown }> };
    const page = Array.isArray(targets.targetInfos)
      ? targets.targetInfos.find((info) => info.type === "page")
      : undefined;
    let targetId: string;
    if (page && typeof page.targetId === "string") {
      targetId = page.targetId;
    } else {
      const created = await client.send("Target.createTarget", { url: "about:blank" }) as { targetId?: unknown };
      if (typeof created.targetId !== "string") throw new Error("CDP_TARGET_CREATE_FAILED");
      targetId = created.targetId;
    }
    const attachedTarget = await client.send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId?: unknown };
    if (typeof attachedTarget.sessionId !== "string") throw new Error("CDP_TARGET_ATTACH_FAILED");
    sessionId = attachedTarget.sessionId;
    await client.send("Page.enable", {}, sessionId);
    await client.send("Runtime.enable", {}, sessionId);
  } catch (error) {
    client.close();
    throw new BrowserSessionError("browser_not_ready", 503, `浏览器会话初始化失败：${errorMessage(error)}`);
  }

  const windowStatePromise = (async () => {
    try {
      const result = await client.send("Browser.getWindowForTarget", { targetId: undefined }) as { windowState?: unknown };
      return typeof result.windowState === "string" ? result.windowState : "unknown";
    } catch {
      return "unknown";
    }
  })();

  return {
    browser,
    browserVersion,
    profilePath,
    debugPort,
    attached,
    evaluate: (expression) => evaluateIn(client, sessionId, expression),
    evaluateWithSession: (expression, targetSessionId) => evaluateIn(client, targetSessionId, expression),
    send: (method, params = {}) => client.send(method, params, sessionId),
    sendRoot: (method, params = {}) => client.send(method, params),
    onEvent: (listener) => client.onEvent(listener),
    windowState: windowStatePromise,
    close: () => {
      client.close();
    },
  };
}
