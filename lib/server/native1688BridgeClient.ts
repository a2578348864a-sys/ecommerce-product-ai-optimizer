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

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";

export const NATIVE_1688_BRIDGE_VERSION = "authenticated-loopback-bridge.v1";
export const NATIVE_1688_EXTENSION_DRIVER_VERSION = "native-1688-extension-driver.v1";

const BRIDGE_PORT = 53318;
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

export type BridgeCommandType = "getState" | "upload" | "submit" | "collect";

function fail(code: string, status: number, message: string): never {
  throw new SourcingAcquisitionError(code, status, message);
}

export class Native1688BridgeClient {
  private readonly token: string;
  private child: ChildProcess | null = null;
  private readonly baseUrl = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

  constructor(token?: string) {
    this.token = token ?? randomBytes(32).toString("hex");
  }

  /** 启动 bridge 子进程（幂等：已运行则跳过） */
  async start(env: NodeJS.ProcessEnv = process.env): Promise<void> {
    if (this.child && this.child.exitCode === null) return;
    this.child = spawn(process.execPath, [BRIDGE_SCRIPT, "--token", this.token], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env,
    });
    this.child.once("error", () => {
      this.child = null;
    });
    // 等待 health
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${this.baseUrl}/health`, {
          headers: { "x-bridge-token": this.token },
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) return;
      } catch {
        // 未就绪重试
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    fail("extension_bridge_not_available", 503, "1688 扩展桥接服务启动失败。");
  }

  async stop(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    const headers = new Headers(options.headers ?? {});
    headers.set("x-bridge-token", this.token);
    return await fetch(`${this.baseUrl}${path}`, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(15_000) });
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
      fail("extension_bridge_rejected", 502, `桥接服务拒绝注册（${body.code ?? response.status}）。`);
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
      fail("extension_bridge_rejected", 502, `桥接服务拒绝命令（${body.code ?? response.status}）。`);
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

  /** 桥/扩展状态探测（EXTENSION_NOT_INSTALLED / EXTENSION_DISCONNECTED 判定依据） */
  async getStatus(): Promise<{ extensionSeen: boolean; lastExtensionSeenAt: number }> {
    const response = await this.request("/health");
    const body = await this.readJson(response);
    return {
      extensionSeen: body.extensionSeen === true,
      lastExtensionSeenAt: typeof body.lastExtensionSeenAt === "number" ? body.lastExtensionSeenAt : 0,
    };
  }
}

export const NATIVE_1688_BRIDGE_CONFIG = {
  host: BRIDGE_HOST,
  port: BRIDGE_PORT,
  version: NATIVE_1688_BRIDGE_VERSION,
} as const;
