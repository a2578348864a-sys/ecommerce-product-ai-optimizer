/**
 * V3.5-R1 Formal Smoke（生产版驱动全链；跑完即删）
 *
 * 流程：候选图（本地）→ acquireByImage（Native1688ExtensionDriver + 生产 bridge + 生产扩展）
 * → ≥3 候选 → 1688-cli detail 交叉验证 → Preview → Human Confirm → sourcing-evidence.v1 → GET 读回。
 *
 * 前置：生产版扩展已加载；普通 Chrome 已打开 s.1688.com 上传页且在前台。
 */
import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask, getSandboxTask } from "@/lib/server/demoSandbox";
import { acquireByImage } from "@/lib/server/sourcingImageAcquisition";
import { getOfferDetailById, resetCliVersionCacheForTests } from "@/lib/server/sourcingAcquisition";
import { GET, POST } from "@/app/api/tasks/[id]/sourcing/route";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v35-formal-smoke-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const authState: { context: { mode: "demo"; demoAccessId: string } } = {
  context: { mode: "demo", demoAccessId: "demo-access-formal" },
};

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: authState.context }),
  requireOwnerOnly: () => ({ ok: true, context: authState.context }),
}));

const DEMO = "demo-access-formal";
const REAL_CLI = join(tmpdir(), "v35-spike-audit", "1688-cli", "dist", "cli.js");
const CANDIDATE = join(process.cwd(), "candidate-test.webp");

describe("V3.5-R1 正式生产 smoke（全链）", () => {
  it("正式驱动图搜 → ≥3 候选（生产扩展 + 生产 bridge）", { timeout: 300_000 }, async () => {
    const { candidates, trace } = await acquireByImage({
      localImagePath: CANDIDATE,
      taskId: "smoke-task",
      candidateId: "smoke-candidate",
    });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.every((c) => /^\d{5,20}$/.test(c.offerId))).toBe(true);
    expect(candidates.every((c) => c.acquisitionMethod === "image")).toBe(true);
    expect(trace.driverVersion).toContain("native-1688-extension-driver");
    expect(trace.success).toBe(true);
    console.log(`FORMAL_SMOKE_ACQUIRE: ${candidates.length} candidates, first=${candidates[0].offerId}`);
  });

  it("详情交叉验证（1 offerId via 1688-cli）", { timeout: 180_000 }, async () => {
    resetCliVersionCacheForTests();
    const env = { ...process.env, V35_1688_CLI_PATH: REAL_CLI };
    const { candidates } = await acquireByImage({
      localImagePath: CANDIDATE,
      taskId: "smoke-task",
      candidateId: "smoke-candidate",
    });
    const { detail } = await getOfferDetailById({ offerId: candidates[0].offerId, env });
    expect(detail.offerId).toBe(candidates[0].offerId);
    console.log(`FORMAL_SMOKE_DETAIL: offerId=${detail.offerId} title=${detail.title.slice(0, 40)}`);
  });

  it("Preview → Human Confirm → sourcing-evidence.v1 → GET 读回（真实图搜候选）", { timeout: 300_000 }, async () => {
    process.env.V35_1688_CLI_PATH = REAL_CLI;
    resetCliVersionCacheForTests();
    authState.context = { mode: "demo", demoAccessId: DEMO };
    const taskId = (await createTrustedSandboxTask(DEMO, { type: "research" })).id;
    const routeContext = { params: Promise.resolve({ id: taskId }) };
    const toStorageVersion = () => {
      const task = getSandboxTask(DEMO, taskId);
      if (!task) throw new Error("task missing");
      return {
        resultJsonHash: createHash("sha256").update(task.resultJson, "utf8").digest("hex"),
        updatedAt: task.updatedAt,
      };
    };

    // action=image（正式驱动）
    const imageResponse = await POST(new NextRequest("http://localhost/api/tasks/x/sourcing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "image", imageUrl: "https://cbu01.alicdn.com/img/ibank/O1CN01LLSym41g0EbyPnAgE_!!2218992714079-0-cib.jpg_.webp" }),
    }), routeContext);
    const imageBody = await imageResponse.json() as {
      ok: boolean;
      error?: { code: string };
      data?: { preview: { previewId: string; candidates: Array<{ offerId: string }> } };
    };
    expect(imageResponse.status).toBe(200);
    expect(imageBody.ok).toBe(true);
    const preview = imageBody.data?.preview;
    expect(preview?.candidates.length).toBeGreaterThanOrEqual(3);

    // save（确认 1 个；详情补全会走 CLI）
    const saveResponse = await POST(new NextRequest("http://localhost/api/tasks/x/sourcing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "save",
        previewId: preview?.previewId,
        selectedOfferIds: [preview?.candidates[0].offerId],
        expectedStorageVersion: toStorageVersion(),
      }),
    }), routeContext);
    const saveBody = await saveResponse.json() as { ok: boolean; data?: { evidence: { schema: string; candidates: unknown[]; humanConfirmed: unknown[] } } };
    expect(saveResponse.status).toBe(200);
    expect(saveBody.ok).toBe(true);
    expect(saveBody.data?.evidence.schema).toBe("sourcing-evidence.v1");
    expect(saveBody.data?.evidence.humanConfirmed).toHaveLength(1);

    // GET 读回
    const getResponse = await GET(new NextRequest("http://localhost/api/tasks/x/sourcing"), routeContext);
    const getBody = await getResponse.json() as { ok: boolean; data?: { evidence: { candidates: unknown[] } } };
    expect(getResponse.status).toBe(200);
    expect(getBody.data?.evidence.candidates).toHaveLength(1);
    console.log(`FORMAL_SMOKE_EVIDENCE: saved=${saveBody.data?.evidence.candidates.length} offerId=${preview?.candidates[0].offerId}`);
  });
});
