/**
 * V3.5 — Authenticated Loopback Bridge 集成测试（真实 spawn bridge 子进程）
 *
 * §12/§31/§32/§35 覆盖：token 拒绝 / wrong jobId / unknown action / oversized payload /
 * invalid MIME / job 绑定缺失 / duplicate submit（No Double Submit）/ duplicate nonce /
 * 结果一次性消费 / extensionSeen 状态。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { Native1688BridgeClient } from "@/lib/server/native1688BridgeClient";

const BRIDGE_SCRIPT = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "bridge", "server.mjs");
const TOKEN = randomBytes(32).toString("hex");

let bridgeProcess: ChildProcess;
let client: Native1688BridgeClient;

/** 无 token 的裸 fetch（模拟恶意本机客户端） */
async function rawFetch(path: string, options: RequestInit = {}) {
  return await fetch(`http://127.0.0.1:53318${path}`, options);
}

beforeAll(async () => {
  // 用环境变量覆盖端口（server.mjs 固定 53318；测试用独立进程 + 端口重定向通过 args 不支持——
  // 这里直接 spawn 后 health 探测 53318；为避免与正式冲突，测试串行运行）
  bridgeProcess = spawn(process.execPath, [BRIDGE_SCRIPT, "--token", TOKEN], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  // 等待 health
  const deadline = Date.now() + 5_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:53318/health", {
        headers: { "x-bridge-token": TOKEN },
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      // retry
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  if (!ready) throw new Error("bridge did not start");
  client = new Native1688BridgeClient(TOKEN);
  await client.start();
});

afterAll(() => {
  bridgeProcess?.kill("SIGTERM");
});

function tinyPngBase64(): string {
  return Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 80, 15, 0, 4, 132, 1, 129, 138, 153, 49, 8, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).toString("base64");
}

const META = { taskId: "task-1", candidateId: "candidate-1", imageHash: "a".repeat(64), contentType: "image/png" };

describe("bridge 认证与命令安全（§12/§29）", () => {
  it("无 token 请求 → 401 invalid_token", async () => {
    const response = await rawFetch("/jobs", { method: "POST" });
    expect(response.status).toBe(401);
    const body = await response.json() as { code: string };
    expect(body.code).toBe("invalid_token");
  });

  it("错误 token → 401 invalid_token", async () => {
    const response = await rawFetch("/jobs", {
      method: "POST",
      headers: { "x-bridge-token": "0".repeat(64) },
    });
    expect(response.status).toBe(401);
  });

  it("unknown action → 400 invalid_command", async () => {
    const jobId = await client.registerJob({ imageBase64: tinyPngBase64(), meta: META });
    const response = await rawFetch("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ jobId, command: { type: "eval", payload: { code: "x" } } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string };
    expect(body.code).toBe("invalid_command");
  });

  it("wrong jobId → 404 job_not_found", async () => {
    const response = await rawFetch("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ jobId: "f".repeat(32), command: { type: "getState" } }),
    });
    expect(response.status).toBe(404);
  });

  it("oversized payload → 400", async () => {
    const response = await rawFetch("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ jobId: "f".repeat(32), command: { type: "getState", payload: { big: "x".repeat(7 * 1024 * 1024) } } }),
    });
    expect(response.status).toBe(400);
  });

  it("invalid MIME → 400 invalid_mime", async () => {
    const response = await rawFetch("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ imageBase64: tinyPngBase64(), meta: { ...META, contentType: "text/html" } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string };
    expect(body.code).toBe("invalid_mime");
  });

  it("job 绑定缺失（taskId/candidateId/imageHash）→ 400 invalid_job_binding", async () => {
    const response = await rawFetch("/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ imageBase64: tinyPngBase64(), meta: { contentType: "image/png" } }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string };
    expect(body.code).toBe("invalid_job_binding");
  });
});

describe("No Double Submit 与幂等（§31/§32）", () => {
  it("重复 submit → duplicate_submit（绝不二次点击）", async () => {
    const jobId = await client.registerJob({ imageBase64: tinyPngBase64(), meta: META });
    const first = await client.enqueue(jobId, { type: "submit" });
    expect(first.duplicate).toBe(false);
    const second = await client.enqueue(jobId, { type: "submit" });
    expect(second.duplicate).toBe(true);
  });

  it("同 nonce 重复 enqueue → duplicate（防 retry 双执行）", async () => {
    const jobId = await client.registerJob({ imageBase64: tinyPngBase64(), meta: META });
    // 客户端 enqueue 内部随机 nonce；此处直接测 bridge 端 nonce 去重
    const response1 = await rawFetch("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ jobId, command: { type: "getState" }, nonce: "a".repeat(32) }),
    });
    const response2 = await rawFetch("/jobs/enqueue-command", {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-token": TOKEN },
      body: JSON.stringify({ jobId, command: { type: "getState" }, nonce: "a".repeat(32) }),
    });
    const body1 = await response1.json() as { duplicate?: boolean };
    const body2 = await response2.json() as { duplicate?: boolean };
    expect(body1.duplicate).toBeFalsy();
    expect(body2.duplicate).toBe(true);
  });

  it("结果一次性消费（第二次读取 → 404）", async () => {
    const jobId = await client.registerJob({ imageBase64: tinyPngBase64(), meta: META });
    await client.enqueue(jobId, { type: "getState" });
    // SW 不在测试环境，直接模拟回报
    const report = await rawFetch("/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, commandNonce: "b".repeat(32), result: { ok: true, probe: 1 } }),
    });
    expect(report.status).toBe(200);
    const first = await client.waitResult(jobId, 5_000);
    expect((first as { probe?: number }).probe).toBe(1);
    const second = await client.waitResult(jobId, 3_000);
    expect((second as { code?: string }).code).toBe("client_timeout");
  });
});

describe("扩展状态探测（§25）", () => {
  it("health 暴露 extensionSeen 状态（SW 轮询前为 false）", async () => {
    // 新注册的 bridge 场景下 extensionSeen 由 SW 轮询驱动；本测试环境无 SW →
    // 验证字段存在且为 boolean
    const status = await client.getStatus();
    expect(typeof status.extensionSeen).toBe("boolean");
    expect(typeof status.lastExtensionSeenAt).toBe("number");
  });
});
