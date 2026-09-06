/**
 * Security & Regression Tests for 1688 Native Bridge:
 * 1. Foreign Port Occupant: Unrelated process on bridge port must NOT be killed -> throws native_1688_bridge_port_conflict
 * 2. Orphan Owned Bridge: Verifies ownership -> safely terminates only exact owned bridge PID -> frees port
 * 3. Bridge Split-Brain: HMR/module reload reuses stable token and single bridge -> no split to 53319
 */
import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  freePortIfOccupied,
  verifyBridgeProcessOwnership,
  Native1688BridgeClient,
} from "@/lib/server/native1688BridgeClient";
import { SourcingAcquisitionError } from "@/lib/upstream/1688/contracts";

const BRIDGE_SCRIPT = resolve(process.cwd(), "extensions", "qingxuan-1688-helper", "bridge", "server.mjs");

describe("1688 Bridge 安全与防误杀审查 (P0 门禁)", () => {
  it("P0: Foreign Port Occupant — 外部非项目进程占用端口时绝对禁止 kill，并抛出 native_1688_bridge_port_conflict", async () => {
    const testPort = 53327;
    // 启动一个完全独立的外部 Node 进程占用 testPort（不含 bridge 特征）
    const foreignServer = spawn(
      process.execPath,
      ["-e", `const http = require('http'); http.createServer((_, res) => res.end('ok')).listen(${testPort}, '127.0.0.1'); setInterval(() => {}, 1000);`],
      { shell: false, windowsHide: true, stdio: "ignore" }
    );

    // 等待服务监听
    const deadline = Date.now() + 5000;
    let foreignListening = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${testPort}`);
        if (resp.status === 200) {
          foreignListening = true;
          break;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(foreignListening).toBe(true);

    const foreignPid = foreignServer.pid!;
    expect(foreignPid).toBeGreaterThan(0);

    try {
      // 验证 ownership 必须判定为 false
      const isOwned = verifyBridgeProcessOwnership(foreignPid);
      expect(isOwned).toBe(false);

      // freePortIfOccupied 遇到外部占用者时必须拒绝 kill 并抛出 typed error
      let errorThrown: SourcingAcquisitionError | null = null;
      try {
        await freePortIfOccupied(testPort);
      } catch (err) {
        if (err instanceof SourcingAcquisitionError) {
          errorThrown = err;
        }
      }

      expect(errorThrown).not.toBeNull();
      expect(errorThrown?.code).toBe("native_1688_bridge_port_conflict");
      expect(errorThrown?.status).toBe(503);

      // 验证外部服务未被杀死，仍然存活且能响应请求
      const resp = await fetch(`http://127.0.0.1:${testPort}`);
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toBe("ok");
    } finally {
      foreignServer.kill("SIGTERM");
    }
  });

  it("P0: Orphan Owned Bridge — 属于本项目的孤儿 bridge 进程可被精确识别并安全终止释放端口", async () => {
    const testPort = 53326;
    const tempToken = randomBytes(32).toString("hex");

    // 启动一个真实但孤儿的 bridge 进程（指定 testPort）
    const orphanBridge = spawn(
      process.execPath,
      [BRIDGE_SCRIPT, "--token", tempToken, "--port", String(testPort)],
      {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      }
    );

    // 等待就绪
    const deadline = Date.now() + 5000;
    let started = false;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(`http://127.0.0.1:${testPort}/health`);
        if (resp.status === 200) {
          started = true;
          break;
        }
      } catch {
        // wait
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(started).toBe(true);

    const orphanPid = orphanBridge.pid!;
    expect(orphanPid).toBeGreaterThan(0);

    // 验证 ownership 必须返回 true
    const isOwned = verifyBridgeProcessOwnership(orphanPid);
    expect(isOwned).toBe(true);

    // 执行 freePortIfOccupied 必须安全终止该 exact PID 并释放端口
    await freePortIfOccupied(testPort);

    // 验证该孤儿 bridge 端口已被释放（连接被拒）
    let portClosed = false;
    try {
      await fetch(`http://127.0.0.1:${testPort}/health`, { signal: AbortSignal.timeout(600) });
    } catch {
      portClosed = true;
    }
    expect(portClosed).toBe(true);
  });

  it("Split-Brain 防御: HMR/模块重载创建新 client 时复用同一 stable Token 与 53318 bridge，不产生分裂", async () => {
    // 实例化 clientA 并获取状态
    const clientA = new Native1688BridgeClient();
    await clientA.start();
    const statusA = await clientA.getStatus();
    expect(statusA.bridgeVersion).toBe("authenticated-loopback-bridge.v1");

    // 模拟 Next.js 热重载创建新客户端 clientB
    const clientB = new Native1688BridgeClient();
    await clientB.start();
    const statusB = await clientB.getStatus();

    // 两个客户端都成功与 bridge 通信
    expect(statusB.bridgeVersion).toBe("authenticated-loopback-bridge.v1");

    // 二者使用的 token 一致（通过能访问同一受 token 保护的端点验证）
    expect(statusB.lastExtensionSeenAt).toBe(statusA.lastExtensionSeenAt);
  });
});
