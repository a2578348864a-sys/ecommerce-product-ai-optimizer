/**
 * V3.5 — Native1688ExtensionDriver Bridge 客户端（服务端侧）
 *
 * 职责：启动/管理 Authenticated Loopback Bridge 子进程，并封装客户端 API
 * （注册 job / 下发命令 / 轮询结果 / 状态探测）。
 *
 * §12 安全：仅 127.0.0.1；启动时生成 256bit token（内存持有，不落盘）；
 * 所有客户端请求带 `x-bridge-token`。桥进程退出/异常 → 明确错误（EXTENSION_BRIDGE_NOT_AVAILABLE）。
 *
 * §48：job 绑定 taskId/candidateId/imageHash 由调用方（route 层）强校验后传入。
 */

import "server-only";

import { spawn, spawnSync, execSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";

export const NATIVE_1688_BRIDGE_VERSION = "authenticated-loopback-bridge.v1";
export const NATIVE_1688_EXTENSION_DRIVER_VERSION = "native-1688-extension-driver.v1";
/** V3 Final R13：期望的 Helper SW 版本（与 extensions/qingxuan-1688-helper SW_VERSION / manifest version 一致）。
 *  版本不匹配 → readiness = PROTOCOL_MISMATCH（UI 显示"浏览器助手需要更新"，不假绿）。 */
export const NATIVE_1688_HELPER_SW_VERSION = "0.3.2";

const BRIDGE_PORT_START = 53318;
const BRIDGE_PORT_RANGE = 10;
const BRIDGE_HOST = "127.0.0.1";
const BRIDGE_SCRIPT = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "bridge", "server.mjs");
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

export type BridgeJobMeta = {
  taskId: string;
  candidateId: string;
  imageHash: string;
  contentType: string;
};

export type BridgeCommandType = "getState" | "upload" | "submit" | "collect" | "navigateUploadPage";

function fail(code: string, status: number, message: string): never {
  throw new SourcingAcquisitionError(code, status, message);
}

const BRIDGE_TOKEN_ENV = "QINGXUAN_1688_BRIDGE_TOKEN";
const BRIDGE_TOKEN_FILE = resolve(process.cwd(), ".next", "1688-bridge-token.txt");

function resolveBridgeToken(providedToken?: string): string {
  if (providedToken && /^[a-f0-9]{64}$/.test(providedToken)) {
    return providedToken;
  }
  const envToken = process.env[BRIDGE_TOKEN_ENV];
  if (envToken && /^[a-f0-9]{64}$/.test(envToken)) {
    return envToken;
  }
  try {
    if (existsSync(BRIDGE_TOKEN_FILE)) {
      const saved = readFileSync(BRIDGE_TOKEN_FILE, "utf8").trim();
      if (/^[a-f0-9]{64}$/.test(saved)) {
        return saved;
      }
    }
  } catch {
    // ignore
  }
  const token = randomBytes(32).toString("hex");
  try {
    const dir = dirname(BRIDGE_TOKEN_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(BRIDGE_TOKEN_FILE, token, "utf8");
  } catch {
    // ignore
  }
  return token;
}

/**
 * 验证目标 PID 是否属于当前项目自己的 1688 bridge 进程（P0 安全边界）。
 * 只有同时满足以下条件才判定为 owned：
 * 1. 进程可执行文件为 node
 * 2. 命令行包含 qingxuan-1688-helper、bridge、server.mjs
 * 3. 脚本路径属于当前项目工作区
 */
export function verifyBridgeProcessOwnership(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    let cmd = "";
    if (process.platform === "win32") {
      const res = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
      ], { encoding: "utf8", windowsHide: true, timeout: 3000 });
      cmd = (res.stdout || "").trim();
    } else {
      const res = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        timeout: 3000,
      });
      cmd = (res.stdout || "").trim();
    }
    if (!cmd) return false;
    const lowerCmd = cmd.toLowerCase().replace(/\\/g, "/");
    // 1. 验证可执行程序为 node
    if (!/node(\.exe)?/i.test(cmd)) return false;
    // 2. 验证 CommandLine 必须包含助手 bridge server 特征
    if (!lowerCmd.includes("qingxuan-1688-helper") || !lowerCmd.includes("bridge") || !lowerCmd.includes("server.mjs")) {
      return false;
    }
    // 3. 验证 script 路径属于当前工作区
    const lowerExpected = BRIDGE_SCRIPT.toLowerCase().replace(/\\/g, "/");
    if (!lowerCmd.includes(lowerExpected)) {
      const worktreeDir = process.cwd().toLowerCase().replace(/\\/g, "/");
      if (!lowerCmd.includes(worktreeDir)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function freePortIfOccupied(port: number): Promise<void> {
  const pids: number[] = [];
  if (process.platform === "win32") {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
      const lines = out.split(/\r?\n/).filter((l) => l.includes(`:${port}`) && l.includes("LISTENING"));
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (pid && pid !== process.pid && !pids.includes(pid)) {
          pids.push(pid);
        }
      }
    } catch {
      // 端口未监听
    }
  } else {
    try {
      const out = execSync(`lsof -t -i :${port} -sTCP:LISTEN`, { encoding: "utf8" });
      for (const line of out.trim().split(/\s+/)) {
        const pid = parseInt(line, 10);
        if (pid && pid !== process.pid && !pids.includes(pid)) {
          pids.push(pid);
        }
      }
    } catch {
      // 端口未监听
    }
  }

  if (pids.length === 0) return;

  for (const pid of pids) {
    const isOwned = verifyBridgeProcessOwnership(pid);
    if (!isOwned) {
      fail(
        "native_1688_bridge_port_conflict",
        503,
        `1688 图片扩展桥接端口 (${port}) 被外部非项目进程 (PID ${pid}) 占用，请释放该端口后重试。`
      );
    }
    // ownership 已严格证明为当前工作区自己的孤儿 bridge 进程，安全终止该 exact PID
    try {
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(pid), "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // 进程可能已退出
    }
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 400));
}

export class Native1688BridgeClient {
  private readonly token: string;
  private child: ChildProcess | null = null;
  private port: number | null = null;
  private readonly baseHost = BRIDGE_HOST;

  constructor(token?: string) {
    this.token = resolveBridgeToken(token);
  }

  /** 探测候选端口中是否有同 token 的活 bridge（含本实例已解析端口） */
  private async findActivePort(): Promise<number | null> {
    const candidates = [...(this.port !== null ? [this.port] : []), ...Array.from({ length: BRIDGE_PORT_RANGE }, (_, i) => BRIDGE_PORT_START + i)];
    const seen = new Set<number>();
    for (const port of candidates) {
      if (seen.has(port)) continue;
      seen.add(port);
      try {
        const response = await fetch(`http://${this.baseHost}:${port}/health`, {
          headers: { "x-bridge-token": this.token },
          signal: AbortSignal.timeout(600),
        });
        if (response.ok) return port;
      } catch {
        // 该端口无监听或非本 bridge
      }
    }
    return null;
  }

  /** 启动 bridge 子进程（幂等：同 token 桥在任一候选端口运行则复用；否则 spawn 并探测实际端口） */
  async start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    const existing = await this.findActivePort();
    if (existing !== null) {
      this.port = existing;
      return;
    }
    // 若 53318 被孤儿/旧 token 桥占用，先清理释放，防止 split-brain 到 53319
    await freePortIfOccupied(BRIDGE_PORT_START);

    const args = [
      BRIDGE_SCRIPT,
      "--token", this.token,
      "--parent-pid", String(process.pid),
    ];
    this.child = spawn(process.execPath, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env,
    });
    this.child.once("error", () => {
      this.child = null;
    });
    this.child.once("exit", () => {
      this.child = null;
    });
    // 等待任一候选端口 health 就绪（优先 53318）
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      const found = await this.findActivePort();
      if (found !== null) {
        this.port = found;
        return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    }
    fail("extension_bridge_not_available", 503, "1688 扩展桥接服务启动失败（端口被占用或进程异常）。");
  }

  async stop(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.port = null;
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (this.port === null) {
      const found = await this.findActivePort();
      if (found === null) fail("extension_bridge_not_available", 503, "1688 扩展桥接服务未就绪。");
      this.port = found;
    }
    const headers = new Headers(options.headers ?? {});
    headers.set("x-bridge-token", this.token);
    return await fetch(`http://${this.baseHost}:${this.port}${path}`, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(15_000) });
  }

  private async readJson(response: Response): Promise<{ ok: boolean; code?: string; [key: string]: unknown }> {
    if (response.status === 204) return { ok: true };
    return await response.json() as { ok: boolean; code?: string; [key: string]: unknown };
  }

  /** 注册 job（图片 base64 + 绑定元数据）；返回 jobId */
  async registerJob(input: {
    imageBase64: string;
    meta: BridgeJobMeta;
  }): Promise<string> {
    const image = Buffer.from(input.imageBase64, "base64");
    if (image.length < 1 || image.length > MAX_IMAGE_BYTES) {
      fail("invalid_image_url", 400, "候选图片大小超出限制（≤30MB）。");
    }
    if (!ALLOWED_MIME.has(input.meta.contentType)) {
      fail("invalid_image_url", 400, `候选图片类型不支持（${input.meta.contentType}）。`);
    }
    if (!input.meta.taskId || !input.meta.candidateId || !input.meta.imageHash) {
      fail("invalid_job_binding", 400, "job 绑定信息缺失（taskId/candidateId/imageHash）。");
    }
    const response = await this.request("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ imageBase64: input.imageBase64, meta: input.meta }),
    });
    const body = await this.readJson(response);
    if (!response.ok || !body.ok) {
      // V3 Final R13（§210/§211）：内部 code 只进日志，用户文案不泄漏协议细节
       
      console.error("[1688-bridge] job registration rejected", { code: body.code ?? response.status });
      fail("extension_bridge_rejected", 502, "1688 图片助手未能接收任务，请确认浏览器助手状态后重试。");
    }
    return String(body.jobId);
  }

  /** 下发命令（带 nonce 防重放；submit 幂等由 bridge phase 门禁保证） */
  async enqueue(jobId: string, command: { type: BridgeCommandType; payload?: Record<string, unknown> }): Promise<{ duplicate: boolean }> {
    const nonce = randomBytes(16).toString("hex");
    const response = await this.request("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, command, nonce }),
    });
    const body = await this.readJson(response);
    if (!response.ok || !body.ok) {
      // V3 Final R13（§210/§211）：内部 code（如 job_image_consumed）只进日志，用户文案友好
       
      console.error("[1688-bridge] command rejected", { code: body.code ?? response.status, commandType: command.type });
      fail("extension_bridge_rejected", 502, "1688 图片助手未能执行操作，请确认浏览器助手状态后重试。");
    }
    return { duplicate: body.duplicate === true };
  }

  /** 轮询命令结果（一次性消费） */
  async waitResult(jobId: string, timeoutMs = 120_000): Promise<Record<string, unknown>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request(`/results/${jobId}`);
      if (response.status === 200) {
        const body = await this.readJson(response);
        return (body.result ?? { ok: false, code: "empty_result" }) as Record<string, unknown>;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    return { ok: false, code: "client_timeout" };
  }

  /** 桥/扩展状态探测（EXTENSION_NOT_INSTALLED / EXTENSION_DISCONNECTED 判定依据；
   *  V3 Final R13：透出 extensionSwVersion + bridgeVersion 供 Protocol Handshake） */
  async getStatus(): Promise<{
    extensionSeen: boolean;
    lastExtensionSeenAt: number;
    extensionSwVersion: string | null;
    bridgeVersion: string;
  }> {
    const response = await this.request("/health");
    const body = await this.readJson(response);
    return {
      extensionSeen: body.extensionSeen === true,
      lastExtensionSeenAt: typeof body.lastExtensionSeenAt === "number" ? body.lastExtensionSeenAt : 0,
      extensionSwVersion: typeof body.extensionSwVersion === "string" ? body.extensionSwVersion : null,
      bridgeVersion: typeof body.bridgeVersion === "string" ? body.bridgeVersion : NATIVE_1688_BRIDGE_VERSION,
    };
  }
}

export const NATIVE_1688_BRIDGE_CONFIG = {
  host: BRIDGE_HOST,
  portStart: BRIDGE_PORT_START,
  portRange: BRIDGE_PORT_RANGE,
  version: NATIVE_1688_BRIDGE_VERSION,
} as const;

/** 进程级共享 bridge 单例（globalThis 持久化，防止 Next.js HMR/模块重载导致多实例分裂） */
const globalForBridge = globalThis as unknown as {
  sharedBridgeClient?: Native1688BridgeClient;
};

export function getSharedBridge(): Native1688BridgeClient {
  if (!globalForBridge.sharedBridgeClient) {
    globalForBridge.sharedBridgeClient = new Native1688BridgeClient();
  }
  return globalForBridge.sharedBridgeClient;
}

/** 测试/关闭：停止共享 bridge 子进程 */
export async function stopSharedBridge(): Promise<void> {
  if (globalForBridge.sharedBridgeClient) {
    await globalForBridge.sharedBridgeClient.stop();
    globalForBridge.sharedBridgeClient = undefined;
  }
}
