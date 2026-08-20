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

  // ── P1-IMG-01 LAYER-2：Image Draft Snapshot accessMode 契约 ──
  it("GOLDEN_DEMO_IMAGE_ACCESS_MODE：Visitor 副本快照 accessMode = visitor（snapshot + items）", async () => {
    const copy = await ensureVisitorDemoCopy("demo-visitor-access-1");
    const tasks = await listSandboxTasks("demo-visitor-access-1");
    const rj = JSON.parse(tasks.find((t) => t.id === copy?.taskId)?.resultJson ?? "{}");
    expect(rj.aiImageDraftSnapshot.accessMode).toBe("visitor");
    expect(rj.aiImageDraftSnapshot.items.length).toBeGreaterThan(0);
    for (const item of rj.aiImageDraftSnapshot.items) {
      expect(item.accessMode).toBe("visitor");
    }
  });

  it("OWNER_IMAGE_ACCESS_MODE：模板静态素材保持 owner（Owner 上下文不被规范化路径覆盖）", async () => {
    const { GOLDEN_DEMO_TEMPLATE_RESULT_JSON } = await import("@/lib/server/goldenDemoTemplateData");
    const snap = GOLDEN_DEMO_TEMPLATE_RESULT_JSON.aiImageDraftSnapshot as {
      accessMode?: string;
      items?: { accessMode?: string }[];
    };
    // 素材保真：模板静态数据保留原始 owner 采集快照（owner 正式任务路径不经 sandbox producer）
    expect(snap.accessMode).toBe("owner");
    expect((snap.items ?? []).length).toBeGreaterThan(0);
    for (const item of snap.items ?? []) {
      expect(item.accessMode).toBe("owner");
    }
    // 只读防改：seed 产物必须与静态素材解耦（新副本永远 visitor）
    const copy = await ensureVisitorDemoCopy("demo-visitor-access-2");
    const tasks = await listSandboxTasks("demo-visitor-access-2");
    const rj = JSON.parse(tasks.find((t) => t.id === copy?.taskId)?.resultJson ?? "{}");
    expect(rj.aiImageDraftSnapshot.accessMode).toBe("visitor");
  });

  it("NO_OWNER_TO_VISITOR_LEAKAGE：副本不含 owner 私有标识 / 凭据 / 绝对路径", async () => {
    const copy = await ensureVisitorDemoCopy("demo-visitor-leak");
    const tasks = await listSandboxTasks("demo-visitor-leak");
    const raw = tasks.find((t) => t.id === copy?.taskId)?.resultJson ?? "";
    const leaks: string[] = [];
    for (const needle of [
      "ACCESS_PASSWORD=",
      "PROOF_SIGNING_SECRET",
      "D:\\",
      "/Users/",
      "/home/",
      "cmsw7363z0002cih40bujcawy",
      "authorization",
      "Bearer ",
      "sessionStorage",
    ]) {
      if (raw.includes(needle)) leaks.push(needle);
    }
    // API key 形态：词边界 + sk- + 长 key 体（避免命中 risk-/task- 等普通词）
    if (/\bsk-[A-Za-z0-9]{8,}/.test(raw)) leaks.push("sk-<key>");
    expect(leaks).toEqual([]);
  });

  it("NO_SECOND_AUTHORITY + Recreate 回归：重复 seed / 多 Visitor 副本一律 visitor（不依赖一次性迁移）", async () => {
    // 同 Visitor 幂等重入
    await ensureVisitorDemoCopy("demo-visitor-recreate-1");
    await ensureVisitorDemoCopy("demo-visitor-recreate-1");
    // 全新 Visitor（等价 DELETE_AND_RECREATE 的新副本）
    await ensureVisitorDemoCopy("demo-visitor-recreate-2");
    for (const vid of ["demo-visitor-recreate-1", "demo-visitor-recreate-2"]) {
      const tasks = await listSandboxTasks(vid);
      expect(tasks).toHaveLength(1);
      const rj = JSON.parse(tasks[0].resultJson);
      expect(rj.aiImageDraftSnapshot.accessMode).toBe("visitor");
      for (const item of rj.aiImageDraftSnapshot.items) {
        expect(item.accessMode).toBe("visitor");
      }
    }
  });

  // ── V3.1 FINAL CLOSURE：B0F2BF31PW exact-product reference image（IMAGE_REAL_ACCEPTANCE 前置） ──
  it("参考图资产：seeded candidate 携带 identity-locked productImageSnapshot（exact B0F2BF31PW，无变体污染）", async () => {
    await ensureVisitorDemoCopy("demo-visitor-refimg-1");
    const candidates = await listSandboxCandidates("demo-visitor-refimg-1");
    const cand = candidates.find((c) => c.id === "fixture-vr-cand-001");
    expect(cand).toBeDefined();
    const sourceMeta = JSON.parse(cand?.sourceMetaJson ?? "{}");
    const snapshot = sourceMeta.productImageSnapshot as Record<string, unknown> | undefined;
    expect(snapshot).toBeDefined();
    // Identity Lock：productKey = exact ASIN；identityHash === facts.itemHash（exact item 绑定）
    expect(sourceMeta.marketScreeningIdentity.productKey).toBe("amazon:US:B0F2BF31PW");
    expect(sourceMeta.marketScreeningIdentity.identityHash).toBe("8414c17ff9c728a83df01eebfa3ff2ae0bbb0fb2fcdd51a3bc2576c41e05b67d");
    expect(snapshot?.productKey).toBe("amazon:US:B0F2BF31PW");
    expect(snapshot?.candidateIdentityHash).toBe(sourceMeta.marketScreeningIdentity.identityHash);
    expect(snapshot?.mimeType).toBe("image/jpeg");
    expect(snapshot?.status).toBe("available");
    // 资产真实性：contentHash === sha256(dataUrl 解码字节)；bytes 一致
    const b64 = String(snapshot?.dataUrl).replace(/^data:image\/jpeg;base64,/, "");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
    expect(snapshot?.contentHash).toBe(digest);
    expect(snapshot?.bytes).toBe(Buffer.from(b64, "base64").length);
    expect(Buffer.from(b64, "base64").length).toBeLessThan(2 * 1024 * 1024);
  });

  it("模板 resultJson：sourceMeta.candidateSnapshot 可解析 + visualReferences 指纹 = sha256(visual-reference:contentHash)（视觉参考门禁输入）", async () => {
    const { parseProductImageSnapshot } = await import("@/lib/productResearchImage");
    const copy = await ensureVisitorDemoCopy("demo-visitor-refimg-2");
    const tasks = await listSandboxTasks("demo-visitor-refimg-2");
    const rj = JSON.parse(tasks.find((t) => t.id === copy?.taskId)?.resultJson ?? "{}");
    // task_snapshot 权威路径（researchContext.productImage 数据源）
    const snap = rj.sourceMeta?.candidateSnapshot?.productImageSnapshot as unknown;
    const parsed = parseProductImageSnapshot(snap);
    expect(parsed).not.toBeNull();
    expect(parsed?.productKey).toBe("amazon:US:B0F2BF31PW");
    expect(parsed?.candidateIdentityHash).toBe("8414c17ff9c728a83df01eebfa3ff2ae0bbb0fb2fcdd51a3bc2576c41e05b67d");
    // 批准参考指纹 = gate 判定条件：assetFingerprint === sha256("visual-reference:" + contentHash)
    const { createHash } = await import("node:crypto");
    const handoffVersions = rj.creativeHandoff?.versions as Array<{ visualReferences?: Array<{ assetFingerprint?: string }> }> | undefined;
    const ref = handoffVersions?.[handoffVersions.length - 1]?.visualReferences?.[0];
    expect(ref?.assetFingerprint).toBe(
      createHash("sha256").update("visual-reference:" + parsed?.contentHash).digest("hex"),
    );
  });

  it("门禁输入路径：adaptResearchContextForHandoff 从 seeded 副本解析出 productImage（task_snapshot）", async () => {
    const { adaptResearchContextForHandoff } = await import("@/lib/server/researchContextAdapter");
    const copy = await ensureVisitorDemoCopy("demo-visitor-refimg-3");
    const tasks = await listSandboxTasks("demo-visitor-refimg-3");
    const task = tasks.find((t) => t.id === copy?.taskId);
    const rj = JSON.parse(task?.resultJson ?? "{}");
    const candidates = await listSandboxCandidates("demo-visitor-refimg-3");
    const cand = candidates.find((c) => c.id === "fixture-vr-cand-001");
    const adapted = adaptResearchContextForHandoff(rj, {
      candidateSourceMetaJson: cand?.sourceMetaJson,
    });
    expect(adapted.ok).toBe(true);
    if (adapted.ok) {
      expect(adapted.context.productImage?.provenance).toBe("task_snapshot");
      expect(adapted.context.productImage?.contentHash).toBe("f6d01ad0df1007568b1ad6baf8acd5bac0b352f4273256d8eff8ddb52afc2685");
      expect(adapted.context.productImage?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(adapted.context.asin).toBe("B0F2BF31PW");
    }
  });
});
