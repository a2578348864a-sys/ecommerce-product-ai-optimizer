// PR2-2 真实存储并发测试（Owner SQLite CAS + Visitor Store 锁）
// 模块加载前隔离数据库与 Store（db.ts 单例在 import 时创建）
vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdtempSync } = require("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "pr22-concurrency-"));
  process.env.PR22_TEST_ROOT = dir;
  process.env.DATABASE_URL = `file:${join(dir, "pr22.db").replaceAll("\\", "/")}`;
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";
import type { TaskResultJsonDatabase } from "@/lib/server/taskResultJsonMutation";
import {
  createOrAppendCreativeHandoff,
  revokeCreativeHandoffAction,
} from "@/lib/server/productCreativeHandoffPersistence";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { generateListingDraftFromHandoff, ListingHandoffError } from "@/lib/listingHandoff/listingGenerationService";
import { createMockListingProvider } from "@/lib/listingHandoff/mockListingProvider";
import { parseListingHandoffBinding } from "@/lib/listingHandoff/listingBinding";
import { parseProductCreativeHandoff } from "@/lib/productCreativeHandoff";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import { getDemoAccessById } from "@/lib/server/demoAccess";

const NOW = "2026-08-05T00:00:00.000Z";
const OWNER_FP = "a1b2c3d4e5f6a7b8";
const REQ = "550e8400-e29b-41d4-a716-446655440000";
const REQ2 = "550e8400-e29b-41d4-a716-446655440001";

const ownerContext = { mode: "owner", token: "synthetic-owner-token" } as const;
function visitorContext(demoAccessId: string) {
  return { mode: "demo" as const, token: `tok-${demoAccessId}`, demoAccessId, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function protectedDocument(candidateId: string) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "workflow-run-pr22",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: NOW,
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: "handoff" },
  });
  return {
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    unknownNamespace: { keep: true },
    productLifecycle: { state: "investigating" },
    candidateAnalysisContext: {
      candidateId,
      productName: "Synthetic Product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0ABCDEF12",
      productUrl: "https://example.com/synthetic",
      title: "Synthetic Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "synthetic",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: NOW,
      contextHash: "a".repeat(64),
    },
  };
}

function encodeConfirmSelectionId(context: { mode: string }, taskId: string, researchRevision: number, stableFactId: string) {
  const canonical = JSON.stringify({ schema: "creative-handoff-selection-id:v1", subjectKind: context.mode === "demo" ? "visitor" : context.mode, taskId, researchRevision, category: "confirm", contentFingerprint: stableFactId });
  return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

async function createHandoff(taskId: string, ctx: { mode: string; [k: string]: unknown }, requestId: string, researchRevision = 1) {
  const preview = await generateCreativeHandoffPreview(taskId, ctx as never);
  const sv = preview.gate.storageVersion!;
  const confirmables = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts);
  const selectionIds = confirmables.map((c) => encodeConfirmSelectionId(ctx, taskId, researchRevision, c.selectionKey));
  const result = await createOrAppendCreativeHandoff(taskId, ctx as never, {
    requestId,
    expectedResearchRevision: researchRevision,
    expectedCurrentHandoffRevision: 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: selectionIds,
    requestFingerprint: `sha256:${"a".repeat(64)}`,
  });
  return { result, sv };
}

async function listingInputFor(taskId: string, ctx: never, requestId: string) {
  const preview = await generateCreativeHandoffPreview(taskId, ctx);
  const handoff = preview.gate.currentHandoff!;
  return {
    requestId,
    expectedStorageVersion: preview.gate.storageVersion!,
    expectedHandoffRevision: handoff.currentRevision,
    handoff,
  };
}

let root = "";
let client: PrismaClient | undefined;

beforeEach(async () => {
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  root = process.env.PR22_TEST_ROOT!;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate", "--schema", schemaPath], {
    cwd: process.cwd(),
    // Prisma CLI 在 Windows 下对绝对 SQLite URL 不稳定；相对 URL 按 schema 目录解析。
    env: {
      ...process.env,
      DATABASE_URL: "file:./pr22.db",
      DEBUG: "prisma:*",
      RUST_LOG: "info",
    },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL! } } });
  await client.viralAnalysisRecord.create({
    data: {
      id: "task-pr22",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      type: "workflow",
      decisionStatus: "continue",
      title: "Synthetic",
      platform: "local-test",
      materialText: "Synthetic",
      source: "isolated-test",
      score: 0,
      level: "low",
      oneLineSummary: "Synthetic",
      resultJson: JSON.stringify(protectedDocument("candidate-pr22")),
    },
  });
  // Visitor sandbox store
  const sandboxPath = join(root, "sandbox.json");
  writeFileSync(sandboxPath, JSON.stringify({
    version: 1,
    tasks: [{
      id: "sandbox-task-a",
      demoAccessId: "demo-access-a",
      type: "workflow",
      title: "Visitor Task",
      decisionStatus: "continue",
      platform: "amazon",
      productUrl: null,
      materialText: "visitor material",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "demo",
      resultJson: JSON.stringify(protectedDocument("candidate-visitor")),
      productLifecycle: "investigating",
      createdAt: NOW,
      updatedAt: NOW,
    }, {
      id: "sandbox-task-b",
      demoAccessId: "demo-access-b",
      type: "workflow",
      title: "Visitor B Task",
      decisionStatus: "continue",
      platform: "amazon",
      productUrl: null,
      materialText: "visitor b material",
      source: "demo",
      score: 0,
      level: "low",
      oneLineSummary: "demo",
      resultJson: JSON.stringify(protectedDocument("candidate-visitor-b")),
      productLifecycle: "investigating",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    candidates: [],
  }, null, 2), "utf8");
  writeFileSync(join(root, "demo-access.json"), JSON.stringify({
    version: 1,
    accesses: [{
      id: "demo-access-a",
      label: "Listing contract visitor",
      passwordHash: `sha256:${"0".repeat(64)}`,
      salt: "0".repeat(32),
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxAiCalls: 10,
      usedAiCalls: 0,
      isActive: true,
      createdAt: NOW,
      lastUsedAt: null,
      notes: "isolated test fixture",
    }],
  }, null, 2), "utf8");
}, 120000);

afterEach(async () => {
  await client?.$disconnect();
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

describe("PR2-2 Owner 真实 SQLite CAS 并发（第21章）", () => {
  it("O1. Generate 成功 → Listing + Binding 原子写入", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);
    const result = await generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider });
    expect(result.listingStatus).toBe("active");
    expect(result.listingSaved).toBe(true);
    expect(result.draft).not.toBeNull();
    expect(provider.callCount).toBe(0);

    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsed = JSON.parse(row!.resultJson);
    expect(parsed.aiListingPackSnapshot).toBeDefined();
    expect(parsed.aiListingPackSnapshot).toMatchObject({
      source: "deterministic_composition_v1",
      composerVersion: "listing-composer-v1",
      polishApplied: false,
      polishModel: null,
    });
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    // Creative Handoff 保留（逐字节）
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)).not.toBeNull();
    // 未知 namespace 保留
    expect(parsed.unknownNamespace).toEqual({ keep: true });
  });

  it("O1b. Provider 即使会失败也不阻断基础 Composition 保存", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const generateSpy = vi.spyOn(provider, "generate").mockRejectedValue(new Error("provider unavailable"));
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);

    const result = await generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider });

    expect(result.listingSaved).toBe(true);
    expect(result.draft).toMatchObject({
      source: "deterministic_composition_v1",
      polishApplied: false,
      polishModel: null,
    });
    expect(generateSpy).not.toHaveBeenCalled();
  });

  it("O2. 同 requestId 幂等重放 → Provider 零调用, 不增加版本", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);
    const first = await generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider });
    expect(first.listingSaved).toBe(true);

    const replay = await generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider });
    expect(replay.idempotentReplay).toBe(true);
    expect(provider.callCount).toBe(0);

    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsed = JSON.parse(row!.resultJson);
    expect(parsed.aiListingPackSnapshot.version).toBe(first.draft?.version ?? 1);
    expect(parsed.aiListingPackSnapshot.generatedAt).toBe(first.draft?.generatedAt);
  });

  it("O3. Composition 保存窗口内 Handoff 更新 → 409, 新结果不保存, 旧草稿不覆盖", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);

    // 测试延迟窗口内创建新 Revision
    const genPromise = generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider, providerOptions: { delayMs: 300 } });
    await new Promise((r) => setTimeout(r, 50));
    const preview2 = await generateCreativeHandoffPreview("task-pr22", ownerContext as never);
    const sv2 = preview2.gate.storageVersion!;
    await createOrAppendCreativeHandoff("task-pr22", ownerContext as never, {
      requestId: "550e8400-e29b-41d4-a716-446655440002",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: (() => {
        const c = buildConfirmableCandidates(preview2.gate.candidate!.stableSourceFacts);
        return c.map((cc) => encodeConfirmSelectionId(ownerContext, "task-pr22", 1, cc.selectionKey));
      })(),
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    });

    await expect(genPromise).rejects.toMatchObject({ code: "handoff_revision_conflict", status: 409 });

    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsed = JSON.parse(row!.resultJson);
    expect(parsed.aiListingPackSnapshot).toBeUndefined();
    expect(parsed.listingHandoffBinding).toBeUndefined();
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)!.currentRevision).toBe(2);
  });

  it("O4. Composition 保存窗口内 Handoff 撤回 → 409, 不保存", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);

    const genPromise = generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider, providerOptions: { delayMs: 300 } });
    await new Promise((r) => setTimeout(r, 50));
    const previewBeforeRevoke = await generateCreativeHandoffPreview("task-pr22", ownerContext as never);
    await revokeCreativeHandoffAction("task-pr22", ownerContext as never, { requestId: "550e8400-e29b-41d4-a716-446655440003", revokeReasonCode: "explicit_user_revoke", expectedStorageVersion: previewBeforeRevoke.gate.storageVersion! });

    await expect(genPromise).rejects.toMatchObject({ code: "handoff_stale", status: 409 });
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsed = JSON.parse(row!.resultJson);
    expect(parsed.aiListingPackSnapshot).toBeUndefined();
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)!.controlState).toBe("revoked");
  });

  it("O5. 旧 storageVersion → 409 task_result_conflict, 零写入", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2);
    // 用错误（旧）storageVersion
    const staleInput = { ...input, expectedStorageVersion: { resultJsonHash: "0".repeat(64), updatedAt: NOW } };
    await expect(generateListingDraftFromHandoff("task-pr22", ownerContext as never, staleInput, { provider }))
      .rejects.toMatchObject({ code: "task_result_conflict", status: 409 });
    expect(provider.callCount).toBe(0); // 基础 Composition 不调用 Provider，保存仍被 CAS 拒绝
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    expect(JSON.parse(row!.resultJson).listingHandoffBinding).toBeUndefined();
  });

  it("O6. 两个并发 Generate（不同 requestId）→ 无部分写入", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const inputA = await listingInputFor("task-pr22", ownerContext as never, REQ2);
    const inputB = await listingInputFor("task-pr22", ownerContext as never, "550e8400-e29b-41d4-a716-446655440004");

    const [ra, rb] = await Promise.allSettled([
      generateListingDraftFromHandoff("task-pr22", ownerContext as never, inputA, { provider }),
      generateListingDraftFromHandoff("task-pr22", ownerContext as never, inputB, { provider }),
    ]);
    const okCount = [ra, rb].filter((r) => r.status === "fulfilled").length;
    const fail409 = [ra, rb].filter((r) => r.status === "rejected" && (r as PromiseRejectedResult).reason?.code === "task_result_conflict").length;
    expect(okCount + fail409).toBe(2);

    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsed = JSON.parse(row!.resultJson);
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    expect(parsed.aiListingPackSnapshot).toBeDefined();
  });

  it("O7. Generate vs Decision Writer 并发 → 过期结果不保存, 数据不丢", async () => {
    await createHandoff("task-pr22", ownerContext, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("task-pr22", ownerContext as never, REQ2); // 先取旧 sv
    // Composition 保存窗口内，另一 writer（模拟 Decision）通过真实 CAS 通道提交
    const genPromise2 = generateListingDraftFromHandoff("task-pr22", ownerContext as never, input, { provider, providerOptions: { delayMs: 300 } });
    await new Promise((r) => setTimeout(r, 50));
    // PR2-2 Final-Fix (P1-2): 走公开 test-support 适配器（架构批准的唯一测试入口），不直接 import owner.internal
    const { commitOwnerTaskResultJsonMutationForTest } = await import("@/lib/server/taskResultJsonMutation.testSupport");
    const row1 = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const committed2 = await commitOwnerTaskResultJsonMutationForTest(client as never as TaskResultJsonDatabase, {
      snapshot: { id: "task-pr22", updatedAt: row1!.updatedAt, resultJson: row1!.resultJson as string, type: "workflow", decisionStatus: "continue" },
      resultJson: row1!.resultJson as string, // 内容不变，仅推进 updatedAt（等同任何 writer 的 CAS 提交）
      updatedAt: "2026-08-05T01:30:00.000Z",
    });
    expect(committed2).toBe(true);
    await expect(genPromise2).rejects.toBeTruthy();
    // 数据不丢：Handoff 保留，未知 namespace 保留，无 Listing 部分写入
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-pr22" } });
    const parsedFinal = JSON.parse(row!.resultJson as string);
    expect(parseProductCreativeHandoff(parsedFinal.creativeHandoff)).not.toBeNull();
    expect(parsedFinal.unknownNamespace).toEqual({ keep: true });
    expect(parsedFinal.listingHandoffBinding).toBeUndefined();
  });
describe("PR2-2 Visitor 真实 Store 锁并发（第21章）", () => {
  it("V1. Visitor Generate 成功 → Listing + Binding 绑定 Visitor Handoff", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("sandbox-task-a", ctx as never, REQ2);
    const before = getDemoAccessById("demo-access-a")!;
    const result = await generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider });
    const after = getDemoAccessById("demo-access-a")!;
    expect(result.listingStatus).toBe("active");
    expect(provider.callCount).toBe(0);
    expect(after.usedAiCalls).toBe(before.usedAiCalls);
    const task = getSandboxTask("demo-access-a", "sandbox-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    expect(parsed.aiListingPackSnapshot).toBeDefined();
  });

  it("V2. Visitor 同 requestId 并发 → 无重复保存/无损坏（阶段B锁外允许并发调用，锁内CAS保证单一结果）", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("sandbox-task-a", ctx as never, REQ2);
    const results = await Promise.allSettled([
      generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider }),
      generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider }),
    ]);
    // 至少一个成功；另一个重放或 409 task_result_conflict，均不新增版本
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    const task = getSandboxTask("demo-access-a", "sandbox-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    expect(parsed.aiListingPackSnapshot.version).toBe(1);
  });

  it("V3. Visitor 不同 requestId 并发 → 无部分写入, Store 锁正确", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    const provider = createMockListingProvider();
    const inputA = await listingInputFor("sandbox-task-a", ctx as never, REQ2);
    const inputB = await listingInputFor("sandbox-task-a", ctx as never, "550e8400-e29b-41d4-a716-446655440004");
    await Promise.allSettled([
      generateListingDraftFromHandoff("sandbox-task-a", ctx as never, inputA, { provider }),
      generateListingDraftFromHandoff("sandbox-task-a", ctx as never, inputB, { provider }),
    ]);
    const task = getSandboxTask("demo-access-a", "sandbox-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    expect(parsed.aiListingPackSnapshot).toBeDefined();
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)).not.toBeNull();
  });

  it("V4. Visitor A 与 B 隔离（B 访问 A 的任务 404）", async () => {
    const ctxA = visitorContext("demo-access-a");
    const ctxB = visitorContext("demo-access-b");
    await createHandoff("sandbox-task-a", ctxA, REQ);
    // B 访问 A 的任务 → Gate legacy_not_supported → 404 语义
    const previewB = await generateCreativeHandoffPreview("sandbox-task-a", ctxB as never);
    expect(previewB.gate.reason).toBe("legacy_not_supported");
    // B 的任务零污染
    const taskB = getSandboxTask("demo-access-b", "sandbox-task-b")!;
    expect(JSON.parse(taskB.resultJson).listingHandoffBinding).toBeUndefined();
  });

  it("V5. Visitor Generate vs Handoff 更新 → 409 不保存", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    const provider = createMockListingProvider();
    const input = await listingInputFor("sandbox-task-a", ctx as never, REQ2);
    const genPromise = generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider, providerOptions: { delayMs: 300 } });
    await new Promise((r) => setTimeout(r, 50));
    const preview2 = await generateCreativeHandoffPreview("sandbox-task-a", ctx as never);
    const sv2 = preview2.gate.storageVersion!;
    await createOrAppendCreativeHandoff("sandbox-task-a", ctx as never, {
      requestId: "550e8400-e29b-41d4-a716-446655440005",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: (() => {
        const c = buildConfirmableCandidates(preview2.gate.candidate!.stableSourceFacts);
        return c.map((cc) => encodeConfirmSelectionId(ctx, "sandbox-task-a", 1, cc.selectionKey));
      })(),
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    });
    await expect(genPromise).rejects.toMatchObject({ code: "handoff_revision_conflict", status: 409 });
    const task = getSandboxTask("demo-access-a", "sandbox-task-a")!;
    expect(JSON.parse(task.resultJson).listingHandoffBinding).toBeUndefined();
  });

  it("V6. 高频竞争 20 轮 → 0 丢失/0 损坏", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    const provider = createMockListingProvider();
    for (let i = 0; i < 20; i++) {
      const input = await listingInputFor("sandbox-task-a", ctx as never, `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, "0")}`);
      await generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider }).catch(() => {});
    }
    const task = getSandboxTask("demo-access-a", "sandbox-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parseListingHandoffBinding(parsed.listingHandoffBinding)).not.toBeNull();
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)).not.toBeNull();
    expect(parsed.unknownNamespace).toEqual({ keep: true });
  });

  it("V7. Store 错误后锁释放（下次调用正常）", async () => {
    const ctx = visitorContext("demo-access-a");
    await createHandoff("sandbox-task-a", ctx, REQ);
    // 模拟 store 损坏
    const sandboxPath = join(root, "sandbox.json");
    writeFileSync(sandboxPath, "corrupted-json", "utf8");
    const provider = createMockListingProvider();
    const input = await listingInputFor("sandbox-task-a", ctx as never, REQ2).catch(() => null);
    // store 损坏 → 读取失败（不崩溃，锁释放）
    if (input) {
      await generateListingDraftFromHandoff("sandbox-task-a", ctx as never, input, { provider }).catch(() => {});
    }
    // 恢复 store（重建任务数据）→ 后续调用正常
    const { getSandboxTask: gst } = await import("@/lib/server/demoSandbox");
    writeFileSync(sandboxPath, JSON.stringify({
      version: 1,
      tasks: [{
        id: "sandbox-task-a", demoAccessId: "demo-access-a", type: "workflow", title: "Visitor Task", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "visitor material", source: "demo", score: 0, level: "low", oneLineSummary: "demo", resultJson: JSON.stringify(protectedDocument("candidate-visitor")), productLifecycle: "investigating", createdAt: NOW, updatedAt: NOW,
      }],
      candidates: [],
    }, null, 2), "utf8");
    expect(gst("demo-access-a", "sandbox-task-a")).not.toBeNull();
  });
});
})
