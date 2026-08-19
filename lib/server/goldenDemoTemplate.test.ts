/**
 * V3 UX Closure — Golden Demo Lazy Seed / Backfill / 隔离测试（行为优先，经公开 adapter 验证）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSandboxCandidates, listSandboxTasks } from "@/lib/server/demoSandbox";
import {
  ensureVisitorDemoCopy,
  findVisitorDemoCopy,
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

    const tasks = await listSandboxTasks("demo-visitor-a");
    const task = tasks.find((t) => t.id === copy?.taskId);
    expect(task).toBeDefined();
    expect(task?.demoAccessId).toBe("demo-visitor-a");
    const marker = readDemoTemplateMarker(task?.resultJson ?? "");
    expect(marker?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
    // 模板完整性：证据 + researchRecord + completion（含 evidenceHash）+ handoff
    const rj = JSON.parse(task?.resultJson ?? "{}");
    expect(rj.browserEvidence.snapshots.length).toBeGreaterThan(0);
    expect(rj.researchRecord.schema).toBe("product-research-record.v1");
    expect(rj.researchCompletion.status).toBe("completed");
    // Staleness 契约：seed 时注入 evidenceHash（演示任务启用重新确认体验）
    expect(rj.researchCompletion.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rj.creativeHandoff).toBeDefined();
    expect(rj.aiImageDraftSnapshot.items.length).toBeGreaterThan(0);
  });

  it("重复调用 → 幂等（不重复创建）", async () => {
    await ensureVisitorDemoCopy("demo-visitor-b");
    const first = (await listSandboxTasks("demo-visitor-b")).length;
    const again = await ensureVisitorDemoCopy("demo-visitor-b");
    const second = (await listSandboxTasks("demo-visitor-b")).length;
    expect(second).toBe(first);
    expect(again?.taskId).toBe((await listSandboxTasks("demo-visitor-b"))[0].id);
  });

  // ── V3 Final HWF FIX-5：并发双 seed 原子化（check-then-act 移入写锁） ──
  it("并发双 seed（同 Visitor 同时触发）→ 仅 1 个副本（task + candidate 各一，同一 taskId）", async () => {
    const [a, b] = await Promise.all([
      ensureVisitorDemoCopy("demo-visitor-concurrent"),
      ensureVisitorDemoCopy("demo-visitor-concurrent"),
    ]);
    // 两个调用都解析到同一任务
    expect(a?.taskId).toBeDefined();
    expect(b?.taskId).toBe(a?.taskId);
    // 物理上只有 1 个 task + 1 个固定 id 候选
    const tasks = await listSandboxTasks("demo-visitor-concurrent");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(a?.taskId);
    const candidates = await listSandboxCandidates("demo-visitor-concurrent");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("fixture-vr-cand-001");
    expect(candidates[0].convertedTaskId).toBe(a?.taskId);
  });

  it("并发双 seed 不破坏标记/证据完整性（单一副本带 demoTemplate 标记）", async () => {
    await Promise.all([
      ensureVisitorDemoCopy("demo-visitor-concurrent-2"),
      ensureVisitorDemoCopy("demo-visitor-concurrent-2"),
    ]);
    const tasks = await listSandboxTasks("demo-visitor-concurrent-2");
    expect(tasks).toHaveLength(1);
    expect(readDemoTemplateMarker(tasks[0].resultJson)?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
    const rj = JSON.parse(tasks[0].resultJson);
    expect(rj.researchCompletion.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("跨 Visitor 隔离：每个 Visitor 独立副本，不共享 Task", async () => {
    const a = await ensureVisitorDemoCopy("demo-visitor-c");
    const b = await ensureVisitorDemoCopy("demo-visitor-d");
    expect(a?.taskId).not.toBe(b?.taskId);
    const tasksA = await listSandboxTasks("demo-visitor-c");
    const tasksB = await listSandboxTasks("demo-visitor-d");
    expect(tasksA.length).toBe(1);
    expect(tasksB.length).toBe(1);
    expect(tasksA[0].id).not.toBe(tasksB[0].id);
  });

  it("Backfill：已有 THERMOS 历史副本（无标记）→ 补标记，不新建", async () => {
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
    const tasks = await listSandboxTasks("demo-visitor-e");
    expect(tasks.length).toBe(1);
    const updated = tasks.find((t) => t.id === task.id);
    expect(readDemoTemplateMarker(updated?.resultJson ?? "")?.demoTemplateId).toBe(GOLDEN_DEMO_TEMPLATE_ID);
  });

  it("findVisitorDemoCopy：不创建，仅查找", async () => {
    expect(await findVisitorDemoCopy("demo-visitor-f")).toBeNull();
    await ensureVisitorDemoCopy("demo-visitor-f");
    const found = await findVisitorDemoCopy("demo-visitor-f");
    expect(found?.taskId).toBeDefined();
    expect((await listSandboxTasks("demo-visitor-f")).length).toBe(1);
  });
});
