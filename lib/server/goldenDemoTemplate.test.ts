/**
 * V3 UX Closure — Golden Demo Lazy Seed / Backfill / 隔离测试（行为优先）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDemoSandboxStore } from "@/lib/server/demoSandboxStore.internal";
import {
  ensureVisitorDemoCopy,
  findVisitorDemoCopy,
  GOLDEN_DEMO_CANDIDATE_ID,
  GOLDEN_DEMO_TEMPLATE_ID,
  readDemoTemplateMarker,
} from "@/lib/server/goldenDemoTemplate";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v3u-golden-demo");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

beforeEach(() => {
  const dir = join(tmpdir(), "v3u-golden-demo");
  rmSync(join(dir, "sandbox.json"), { force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ensureVisitorDemoCopy（Lazy Seed）", () => {
  it("新 Visitor 首次调用 → 创建独立副本（task + candidate，带 demoTemplate 标记）", async () => {
    const copy = await ensureVisitorDemoCopy("demo-visitor-a");
    expect(copy).not.toBeNull();
    expect(copy?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
    expect(copy?.sourceProductKey).toBe("amazon:US:B0F2BF31PW");
    expect(copy?.taskId).toMatch(/^sandbox_task_/);

    const store = readDemoSandboxStore();
    const task = store.tasks.find((t) => t.id === copy?.taskId);
    expect(task).toBeDefined();
    expect(task?.demoAccessId).toBe("demo-visitor-a");
    const marker = readDemoTemplateMarker(task?.resultJson ?? "");
    expect(marker?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
    // candidate 同步创建（research 绑定）
    const candidate = store.candidates.find((c) => c.id === GOLDEN_DEMO_CANDIDATE_ID);
    expect(candidate).toBeDefined();
    expect(candidate?.demoAccessId).toBe("demo-visitor-a");
    expect(candidate?.convertedTaskId).toBe(copy?.taskId);
    // 模板完整性：证据 + researchRecord + completion + handoff
    const rj = JSON.parse(task?.resultJson ?? "{}");
    expect(rj.browserEvidence.snapshots.length).toBeGreaterThan(0);
    expect(rj.researchRecord.schema).toBe("product-research-record.v1");
    expect(rj.researchCompletion.status).toBe("completed");
    expect(rj.creativeHandoff).toBeDefined();
    expect(rj.aiImageDraftSnapshot.items.length).toBeGreaterThan(0);
  });

  it("重复调用 → 幂等（不重复创建）", async () => {
    await ensureVisitorDemoCopy("demo-visitor-b");
    const first = readDemoSandboxStore().tasks.length;
    const again = await ensureVisitorDemoCopy("demo-visitor-b");
    const second = readDemoSandboxStore().tasks.length;
    expect(second).toBe(first);
    expect(again?.taskId).toBe(readDemoSandboxStore().tasks[0].id);
  });

  it("跨 Visitor 隔离：每个 Visitor 独立副本，不共享 Task", async () => {
    const a = await ensureVisitorDemoCopy("demo-visitor-c");
    const b = await ensureVisitorDemoCopy("demo-visitor-d");
    expect(a?.taskId).not.toBe(b?.taskId);
    const store = readDemoSandboxStore();
    const tasksA = store.tasks.filter((t) => t.demoAccessId === "demo-visitor-c");
    const tasksB = store.tasks.filter((t) => t.demoAccessId === "demo-visitor-d");
    expect(tasksA.length).toBe(1);
    expect(tasksB.length).toBe(1);
    // 同一 candidateId 在不同 Visitor 下各自独立存在
    const candsA = store.candidates.filter((c) => c.demoAccessId === "demo-visitor-c" && c.id === GOLDEN_DEMO_CANDIDATE_ID);
    const candsB = store.candidates.filter((c) => c.demoAccessId === "demo-visitor-d" && c.id === GOLDEN_DEMO_CANDIDATE_ID);
    expect(candsA.length).toBe(1);
    expect(candsB.length).toBe(1);
  });

  it("Backfill：已有 THERMOS 历史副本（无标记）→ 补标记，不新建", async () => {
    // 模拟历史手动副本（无 demoTemplate 标记）
    const { createTrustedSandboxTask } = await import("@/lib/server/demoSandbox");
    const task = await createTrustedSandboxTask("demo-visitor-e", {
      title: "THERMOS FUNTAINER Water Bottle with Straw, 12oz, Construction",
      source: "demo_acquisition_sample",
      productUrl: "https://www.amazon.com/dp/B0F2BF31PW?language=en_US",
      resultJson: JSON.stringify({ productName: "THERMOS FUNTAINER", sourceMeta: {} }),
    });
    expect(readDemoTemplateMarker(task.resultJson)).toBeNull();

    const copy = await ensureVisitorDemoCopy("demo-visitor-e");
    expect(copy?.taskId).toBe(task.id); // 复用历史任务，不新建
    const store = readDemoSandboxStore();
    expect(store.tasks.filter((t) => t.demoAccessId === "demo-visitor-e").length).toBe(1);
    const updated = store.tasks.find((t) => t.id === task.id);
    expect(readDemoTemplateMarker(updated?.resultJson ?? "")?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
  });

  it("findVisitorDemoCopy：不创建，仅查找", async () => {
    expect(await findVisitorDemoCopy("demo-visitor-f")).toBeNull();
    await ensureVisitorDemoCopy("demo-visitor-f");
    const found = await findVisitorDemoCopy("demo-visitor-f");
    expect(found?.taskId).toBeDefined();
    expect(readDemoSandboxStore().tasks.length).toBe(1);
  });
});
