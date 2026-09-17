// 模块加载前设置 DATABASE_URL（db.ts 单例在 import 时创建 PrismaClient）
// 固定路径：与 beforeEach 的 db push 一致，供全局 prisma 单例使用
const E2E_DB_DIR = join(tmpdir(), "fix2-e2e-db");
vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "fix2-e2e-db");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "fix2.db").replaceAll("\\", "/")}`;
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  CreativeHandoffPersistenceError,
} from "@/lib/server/productCreativeHandoffPersistence";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { parseRequestLedger } from "@/lib/creativeHandoffRequestLedger";
import { parseProductCreativeHandoff, type ProductCreativeHandoffCandidate } from "@/lib/productCreativeHandoff";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";

let root = "";
let databasePath = "";
let client: PrismaClient | undefined;
const ownerContext = { mode: "owner", token: "synthetic-owner-token" } as const;

function database(c: PrismaClient) {
  return c as unknown as TaskResultJsonDatabase;
}

function protectedDocument() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: "candidate-e2e",
    runId: "workflow-run-e2e",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-08-05T00:00:00.000Z",
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "Initial evidence reviewed.",
      nextAction: "Wait for an explicit handoff.",
    },
  });
  return {
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" },
    unknownNamespace: { keep: true },
    productLifecycle: { state: "investigating" },
    candidateAnalysisContext: {
      candidateId: verification.candidateId,
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
      capturedAt: "2026-08-05T00:00:00.000Z",
      contextHash: "a".repeat(64),
    },
  };
}

const REQ = "550e8400-e29b-41d4-a716-446655440000";
const REQ2 = "550e8400-e29b-41d4-a716-446655440001";
const NOW = "2026-08-05T00:00:00.000Z";
const OWNER_FP = "a1b2c3d4e5f6a7b8";

/**
 * 合法 confirmedFact（通过 PR2-0 parseCandidate 要求：≥1 条 confirmedFact、UUID factId、
 * user_confirmation sourceRef、confirmedAt 绑定）。
 * gate 的占位 candidate confirmedFacts 为空 — 事实投影属 PR2-2 范围（遗留 P1），
 * 服务层幂等测试在此注入合法候选以验证幂等闭环本身。
 */
function buildLegalCandidate(base: ReturnType<typeof protectedDocument>): ProductCreativeHandoffCandidate {
  const record = base.researchRecord;
  return {
    sourceResearch: {
      recordSchema: "product-research-record.v1" as const,
      candidateId: record.candidateId,
      researchRevision: 1,
      researchHash: record.researchHash,
      workflowStatus: "completed" as const,
      decisionStatus: "creative_ready" as const,
      candidateSourceFingerprint: "b".repeat(64),
    },
    productIdentity: { displayName: "Synthetic Product", identityConfirmedAt: NOW },
    confirmedFacts: [{
      factId: "00000000-0000-4000-8000-000000000001",
      field: "material",
      label: "Material",
      value: "steel",
      evidenceTier: "human_confirmed" as const,
      usageScopes: ["listing"] as const,
      sourceRef: {
        sourceKind: "user_confirmation" as const,
        sourceField: "material",
        confirmedBy: { mode: "owner" as const, subjectFingerprint: OWNER_FP },
        confirmedAt: NOW,
        confirmationReference: "ref-e2e-001",
      },
      confirmedAt: NOW,
      confirmedBy: { mode: "owner" as const, subjectFingerprint: OWNER_FP },
    }],
    stableSourceFacts: [],
    aiCreativeReferences: [],
    issues: [],
    prohibitedClaims: [{
      claimId: "00000000-0000-4000-8000-000000000002",
      category: "absolute_claim" as const,
      summary: "No absolute claims.",
      appliesTo: ["both"] as const,
      source: "system_rule" as const,
    }],
    creativePreferences: { evidenceTier: "creative_preference" as const },
    visualReferences: [],
    humanReviewRequired: true as const,
  };
}

function encodeConfirmSelectionIdForTest(
  context: { mode: string },
  taskId: string,
  researchRevision: number,
  stableFactId: string,
): string {
  const canonical = JSON.stringify({
    schema: "creative-handoff-selection-id:v1",
    subjectKind: context.mode,
    taskId,
    researchRevision,
    category: "confirm",
    contentFingerprint: stableFactId,
  });
  return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

function buildConfirmableCandidatesForTest() {
  // 从 Gate 证据层（candidateAnalysisContext 投影）生成 confirmable 候选
  // 直接构造与 Adapter 输出一致的 stable facts（brand/category/price 等）
  const now = "2026-08-05T00:00:00.000Z";
  return [
    { selectionKey: "stable-brand", field: "brand", label: "品牌", value: "SyntheticBrand", sourceKind: "candidate_snapshot", capturedAt: now, stabilityRule: "human_confirmation_required_for_claim", allowedUsageScopes: ["internal", "listing"] },
    { selectionKey: "stable-category", field: "category", label: "类目", value: "Kitchen", sourceKind: "candidate_snapshot", capturedAt: now, stabilityRule: "human_confirmation_required_for_claim", allowedUsageScopes: ["internal", "listing"] },
  ] as const;
}

async function loadTask(c: PrismaClient, id: string) {
  const row = await c.viralAnalysisRecord.findUnique({ where: { id } });
  return { row, resultJson: JSON.parse(row!.resultJson) };
}

function hashResultJson(resultJson: string) {
  return createHash("sha256").update(resultJson, "utf8").digest("hex");
}

beforeEach(async () => {
  // 释放全局 prisma 单例持有的 SQLite 文件锁（Windows EPERM 防护）
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  root = E2E_DB_DIR;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  databasePath = join(root, "fix2.db");
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db", "push", "--skip-generate", "--schema", schemaPath,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  // Preview 使用全局 prisma 单例（env 已在模块加载时指向同一路径）
  client = new PrismaClient({ datasources: { db: { url } } });
  const document = protectedDocument();
  await client.viralAnalysisRecord.create({
    data: {
      id: "task-e2e",
      createdAt: new Date("2026-08-05T00:00:00.000Z"),
      updatedAt: new Date("2026-08-05T00:00:00.000Z"),
      type: "workflow",
      decisionStatus: "continue",
      title: "Synthetic",
      platform: "local-test",
      materialText: "Synthetic",
      source: "isolated-test",
      score: 0,
      level: "low",
      oneLineSummary: "Synthetic",
      resultJson: JSON.stringify(document),
    },
  });
});

afterEach(async () => {
  await client?.$disconnect();
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

describe("Owner 端到端幂等闭环（真实 SQLite CAS）", () => {
  async function firstCreate() {
    // Fix.4: 浏览器提交 confirmable selectionIds；服务端锁内重新投影并确认转换。
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    expect(preview.gate.allowed).toBe(false);
    expect(preview.gate.reason).toBe("no_confirmed_facts");
    // storageVersion 从 Gate 获取（合法研究数据的哈希）
    const sv = preview.gate.storageVersion!;
    const fp = `sha256:${"a".repeat(64)}`;
    // 从 Gate 候选（锁内投影产物）生成 confirmable selectionIds
    // 用与 Persistence 相同的编码逻辑（encodeConfirmSelectionId 语义）
    const gateCandidate = preview.gate.candidate!;
    const confirmables = buildConfirmableCandidates(gateCandidate.stableSourceFacts);
    expect(confirmables.length).toBeGreaterThanOrEqual(2); // brand/category/price 等
    const selectionIds = confirmables.map((c) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, c.selectionKey));
    const result = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    return { result, preview, sv, fp, selectionIds };
  }

  it("19. requestId != handoffId — 服务端生成", async () => {
    const { result } = await firstCreate();
    expect(result.handoff.handoffId).not.toBe(REQ);
    expect(result.handoff.handoffId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("20. 同 requestId 同语义重放 → 原 Revision, 不新增版本", async () => {
    const { result, sv, fp, selectionIds } = await firstCreate();
    const { resultJson } = await loadTask(client!, "task-e2e");
    const before = resultJson.creativeHandoff.versions.length;

    const replay = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: result.handoff.currentRevision,
      expectedStorageVersion: sv, // 第一次后的旧 storageVersion — 重放必须先命中 Ledger
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.isNewRevision).toBe(false);
    expect(replay.handoff.currentRevision).toBe(result.handoff.currentRevision);
    const after = await loadTask(client!, "task-e2e");
    expect(after.resultJson.creativeHandoff.versions.length).toBe(before);
    expect(after.resultJson.creativeHandoff.currentRevision).toBe(result.handoff.currentRevision);
  });

  it("21/22. 重放不增加 versions 也不增加 Ledger", async () => {
    const { result, sv, fp, selectionIds } = await firstCreate();
    const before = await loadTask(client!, "task-e2e");
    const beforeLedger = parseRequestLedger(before.resultJson.creativeHandoffRequestLedger)!;
    await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: result.handoff.currentRevision,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    const after = await loadTask(client!, "task-e2e");
    const afterLedger = parseRequestLedger(after.resultJson.creativeHandoffRequestLedger)!;
    expect(after.resultJson.creativeHandoff.versions.length).toBe(before.resultJson.creativeHandoff.versions.length);
    expect(afterLedger.entries.length).toBe(beforeLedger.entries.length);
  });

  it("23. 重放 createdAt 不变", async () => {
    const { result, sv, fp, selectionIds } = await firstCreate();
    const originalCreatedAt = result.handoff.createdAt;
    const replay = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: result.handoff.currentRevision,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    expect(replay.handoff.createdAt).toBe(originalCreatedAt);
  });

  it("24. 同 requestId 不同选择 → 409 idempotency_conflict, 数据零变化", async () => {
    const { sv, fp, selectionIds } = await firstCreate();
    const before = await loadTask(client!, "task-e2e");
    const diffFp = `sha256:${"b".repeat(64)}`;
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: diffFp,
    })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
    const after = await loadTask(client!, "task-e2e");
    expect(after.resultJson.creativeHandoff.versions.length).toBe(before.resultJson.creativeHandoff.versions.length);
    expect(after.resultJson.creativeHandoffRequestLedger).toEqual(before.resultJson.creativeHandoffRequestLedger);
  });

  it("26. 同 requestId 不同 expected 版本 → 409 idempotency_conflict", async () => {
    const { sv, selectionIds } = await firstCreate();
    // 同 requestId、但 expected 版本不同 → fingerprint 不同 → 409
    const diffFp = buildRequestFingerprintFor({
      selectedFactIds: [],
      expectedResearchRevision: 99,
      expectedCurrentHandoffRevision: 1,
      sv,
    });
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 99,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: diffFp,
    })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
  });

  it("27. 不同 requestId 相同内容 → 正常 append, 不算重放", async () => {
    const { result, fp, selectionIds } = await firstCreate();
    // 重新获取最新 storageVersion（模拟客户端刷新 Preview）
    const preview2 = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv2 = preview2.gate.storageVersion!;
    const app = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp, // 相同内容指纹
    });
    expect(app.idempotentReplay).toBe(false);
    expect(app.isNewRevision).toBe(false); // append 语义：Handoff 已存在 → 不是全新创建
    expect(app.handoff.currentRevision).toBe(2);
    expect(result.handoff.currentRevision).toBe(1);
  });

  it("29. Revision 2 存在后重放 Revision 1 请求 → 幂等命中, 不新增 Revision 3", async () => {
    const { sv, fp, selectionIds } = await firstCreate();
    // 创建 Revision 2
    const preview2 = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv2real = preview2.gate.storageVersion!;
    await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2real,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    const before = await loadTask(client!, "task-e2e");
    expect(before.resultJson.creativeHandoff.versions.length).toBe(2);
    // 重放 Revision 1 的请求（旧 storageVersion）→ 幂等命中, 不新增
    const replay = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 2,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.isNewRevision).toBe(false);
    const after = await loadTask(client!, "task-e2e");
    expect(after.resultJson.creativeHandoff.versions.length).toBe(2); // 不新增 Revision 3
    expect(after.resultJson.creativeHandoff.currentRevision).toBe(2); // 不覆盖当前状态
    expect(sv).toBeTruthy();
  });

  it("30. 并发同 requestId → 只写一次", async () => {
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const { resultJsonHash, updatedAt } = preview.gate.storageVersion!;
    const sv = { resultJsonHash, updatedAt };
    const fp = `sha256:${"a".repeat(64)}`;
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    const run = () => createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    const [a, b] = await Promise.allSettled([run(), run()]);
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    // 只有一个创建成功（isNewRevision=true），另一个要么重放要么 409
    const creations = fulfilled.filter((r) => (r as PromiseFulfilledResult<{ isNewRevision: boolean }>).value.isNewRevision);
    expect(creations.length).toBe(1);
    const task = await loadTask(client!, "task-e2e");
    expect(task.resultJson.creativeHandoff.versions.length).toBe(1);
  });

  it("31. Revoke 成功 → controlState=revoked, Ledger 新增 revoked 条目", async () => {
    const { fp, selectionIds } = await firstCreate();
    // 重新获取最新 storageVersion（模拟客户端刷新）
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    await revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    const task = await loadTask(client!, "task-e2e");
    expect(task.resultJson.creativeHandoff.controlState).toBe("revoked");
    const ledger = parseRequestLedger(task.resultJson.creativeHandoffRequestLedger)!;
    const revokeEntry = ledger.entries.find((e) => e.action === "revoke");
    expect(revokeEntry?.outcomeKind).toBe("revoked");
    expect(selectionIds).toBeTruthy();
    expect(fp).toBeTruthy();
  });

  it("32. Revoke 重放 → 不改 revokedAt, 不新增 Ledger", async () => {
    await firstCreate();
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const first = await revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    const taskAfter = await loadTask(client!, "task-e2e");
    const beforeLedger = parseRequestLedger(taskAfter.resultJson.creativeHandoffRequestLedger)!;
    const replay = await revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv, // 旧 storageVersion
    });
    expect(replay.idempotentReplay).toBe(true);
    const taskAfter2 = await loadTask(client!, "task-e2e");
    expect(taskAfter2.resultJson.creativeHandoff.revokedAt).toBe(first.handoff.revokedAt);
    const afterLedger = parseRequestLedger(taskAfter2.resultJson.creativeHandoffRequestLedger)!;
    expect(afterLedger.entries.length).toBe(beforeLedger.entries.length);
  });

  it("34. Revoke 同 requestId 不同原因 → 409 idempotency_conflict", async () => {
    await firstCreate();
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    await revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    await expect(revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "decision_changed",
      expectedStorageVersion: sv,
    })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
  });

  it("35. 不同 requestId 在已撤回状态 → already_revoked, 不伪造重放", async () => {
    await firstCreate();
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    await revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    // 不同 requestId：刷新最新 storageVersion 后仍应 already_revoked
    const preview2 = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv2 = preview2.gate.storageVersion!;
    await expect(revokeCreativeHandoffAction("task-e2e", ownerContext, {
      requestId: REQ,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv2,
    })).rejects.toMatchObject({ code: "already_revoked", status: 409 });
  });

  it("R1. 保存后的 Handoff 通过 Runtime Parser + Ajv（无 _requestMeta/_revokeMeta）", async () => {
    await firstCreate();
    const task = await loadTask(client!, "task-e2e");
    const stored = task.resultJson.creativeHandoff;
    expect(parseProductCreativeHandoff(stored)).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain("_requestMeta");
    expect(JSON.stringify(stored)).not.toContain("_revokeMeta");
    // Ajv 验证
    const fs = await import("node:fs");
    const AjvMod = await import("ajv/dist/2020.js");
    const Ajv = AjvMod.default ?? AjvMod;
    const ajv = new Ajv({ strict: false });
    const schema = JSON.parse(fs.readFileSync("lib/product-creative-handoff.schema.json", "utf8"));
    const validate = ajv.compile(schema);
    expect(validate(stored)).toBe(true);
  });

  it("R2. 非法 Handoff fail-closed → handoff_contract_invalid", async () => {
    // 直接向 resultJson 写入非法 handoff
    const task = await loadTask(client!, "task-e2e");
    task.resultJson.creativeHandoff = { broken: true };
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: new Date().toISOString() },
      selectedFactCandidateIds: [],
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    })).rejects.toMatchObject({ code: "handoff_contract_invalid", status: 500 });
  });

  it("R3. 非法 Ledger fail-closed → idempotency_ledger_invalid", async () => {
    const task = await loadTask(client!, "task-e2e");
    task.resultJson.creativeHandoffRequestLedger = { broken: true };
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    // 非法 Ledger → ledgerInvalid=true（fail-closed 标记）
    expect(preview.gate.ledgerInvalid).toBe(true);
    const sv = preview.gate.storageVersion!;
    const selectionIds = buildConfirmableCandidatesForTest().map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    })).rejects.toMatchObject({ code: "idempotency_ledger_invalid", status: 500 });
  });

  it("R4. 存储失败时 Handoff 与 Ledger 无部分写入", async () => {
    // Ledger 容量满 → append 抛错 → CAS 内整个 mutate 失败 → 无部分写入
    await firstCreate();
    // 手动塞满 ledger
    const task = await loadTask(client!, "task-e2e");
    let ledger = parseRequestLedger(task.resultJson.creativeHandoffRequestLedger)!;
    for (let i = 0; i < 31; i++) {
      ledger = {
        schema: "creative-handoff-request-ledger.v1",
        version: 1,
        entries: [...ledger.entries, {
          requestKeyHash: `sha256:${(100 + i).toString(16).padStart(64, "0")}`,
          requestFingerprint: `sha256:${"f".repeat(64)}`,
          action: "create",
          outcomeKind: "appended",
          outcomeRevision: 1,
          recordedAt: new Date().toISOString(),
        }],
      };
    }
    task.resultJson.creativeHandoffRequestLedger = ledger;
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({ code: "idempotency_ledger_capacity_exceeded" });
    const after = await loadTask(client!, "task-e2e");
    // handoff 未被追加（还是 1 版）
    expect(after.resultJson.creativeHandoff.versions.length).toBe(1);
  });

  it("SV1. 旧 storageVersion → 409 task_result_conflict", async () => {
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    // 先创建一次
    await firstCreate();
    // 用旧的 sv 再创建（不同 requestId）→ 应 409
    const selectionIds = buildConfirmableCandidatesForTest().map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({ code: "task_result_conflict", status: 409 });
  });

  it("SV2. 无关 Namespace 变化后旧 storageVersion → 409", async () => {
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    // 其他 writer 改 resultJson
    const task = await loadTask(client!, "task-e2e");
    task.resultJson.unknownNamespace = { changed: true };
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });
    const selectionIds = buildConfirmableCandidatesForTest().map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    })).rejects.toMatchObject({ code: "task_result_conflict", status: 409 });
  });

  it("SV3. 冲突后 Handoff 与 Ledger 均零变化", async () => {
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    await firstCreate();
    const task = await loadTask(client!, "task-e2e");
    task.resultJson.unknownNamespace = { changed: true };
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });
    const selectionIds = buildConfirmableCandidatesForTest().map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    })).rejects.toMatchObject({ code: "task_result_conflict" });
    const after = await loadTask(client!, "task-e2e");
    expect(after.resultJson.creativeHandoff.versions.length).toBe(1);
    const ledger = parseRequestLedger(after.resultJson.creativeHandoffRequestLedger)!;
    expect(ledger.entries.length).toBe(1); // 只有第一次 create
  });
});

describe("Preview/Detail storageVersion 返回", () => {
  it("SV4. Preview 返回 storageVersion + expected 版本", async () => {
    const { preview, gate } = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    expect(preview!.storageVersion).toBeDefined();
    expect(preview!.storageVersion!.resultJsonHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview!.expectedResearchRevision).toBe(1);
    expect(preview!.expectedCurrentHandoffRevision).toBe(0);
    expect(gate.storageVersion!.updatedAt).toBeDefined();
  });

  it("SV5. 创建后 Preview expectedCurrentHandoffRevision=1", async () => {
    // firstCreate 定义在 Owner describe 内 — 直接复制最小创建流程
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    const preview2 = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    // 创建后 Gate.currentHandoff 反映 Revision 1
    expect(preview2.gate.currentHandoff?.currentRevision).toBe(1);
  });
});

describe("Request 哈希域分离端到端", () => {
  it("F7. requestFingerprint 含 storageVersion → 重放必须用相同 sv 语义", async () => {
    // 创建时 fingerprint 绑定 sv；重放时如果改 sv（不同 updatedAt）→ 409 conflict
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const fp = buildRequestFingerprintFor({
      selectedFactIds: [],
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      sv,
    });
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdForTest(ownerContext, "task-e2e", 1, cc.selectionKey));
    await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp,
    });
    // 重放但 fingerprint 不同（同 key）→ 409
    const fp2 = buildRequestFingerprintFor({
      selectedFactIds: [],
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      sv: { resultJsonHash: "c".repeat(64), updatedAt: "2026-08-05T01:00:00.000Z" },
    });
    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: fp2,
    })).rejects.toMatchObject({ code: "idempotency_conflict", status: 409 });
  });
});

import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";

function buildRequestFingerprintFor(input: {
  selectedFactIds: string[];
  expectedResearchRevision: number;
  expectedCurrentHandoffRevision: number;
  sv: { resultJsonHash: string; updatedAt: string };
}) {
  return buildRequestFingerprint({
    action: "create",
    selectedFactIds: input.selectedFactIds,
    expectedStorageVersion: input.sv,
    expectedResearchRevision: input.expectedResearchRevision,
    expectedCurrentHandoffRevision: input.expectedCurrentHandoffRevision,
    confirmed: true,
  });
}

describe("Research Human Confirmed Facts 自动作为事实基础 (selectedFactCandidateIds=[])", () => {
  it("无候选勾选但研究已有 confirmed 事实 → 成功创建 Handoff 且 confirmedFacts 包含研究事实", async () => {
    // 注入研究已确认事实到 task
    const task = await loadTask(client!, "task-e2e");
    task.resultJson.factCandidates = {
      schema: "fact-candidates.v1",
      version: 1,
      confirmed: [
        {
          candidateId: "product_title:brand",
          field: "brand",
          label: "品牌",
          value: "ResearchBrand",
          sourceKind: "product_title",
          sourceRef: "task.resultJson.productInfo.title",
          humanConfirmationRequired: true,
          confirmedAt: "2026-08-05T00:00:00.000Z",
          confirmedBy: "owner:v1",
        },
        {
          candidateId: "product_title:material",
          field: "material",
          label: "材质",
          value: "304不锈钢",
          sourceKind: "product_title",
          sourceRef: "task.resultJson.productInfo.title",
          humanConfirmationRequired: true,
          confirmedAt: "2026-08-05T00:00:00.000Z",
          confirmedBy: "owner:v1",
        },
      ],
      updatedAt: "2026-08-05T00:00:00.000Z",
    };
    await client!.viralAnalysisRecord.update({
      where: { id: "task-e2e" },
      data: { resultJson: JSON.stringify(task.resultJson) },
    });

    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const fp = buildRequestFingerprintFor({
      selectedFactIds: [],
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      sv,
    });

    const result = await createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: "550e8400-e29b-41d4-a716-446655440099",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [], // 空选择！
      requestFingerprint: fp,
    });

    expect(result.isNewRevision).toBe(true);
    expect(result.handoff.currentRevision).toBe(1);
    expect(result.handoff.versions[0].confirmedFacts.length).toBeGreaterThanOrEqual(2);
    const fields = result.handoff.versions[0].confirmedFacts.map((f) => f.field);
    expect(fields).toContain("brand");
    expect(fields).toContain("material");
  });

  it("无候选勾选且无研究 confirmed 事实 → 抛出 no_facts_selected (400)", async () => {
    const preview = await generateCreativeHandoffPreview("task-e2e", ownerContext);
    const sv = preview.gate.storageVersion!;
    const fp = buildRequestFingerprintFor({
      selectedFactIds: [],
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      sv,
    });

    await expect(createOrAppendCreativeHandoff("task-e2e", ownerContext, {
      requestId: "550e8400-e29b-41d4-a716-446655440098",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [], // 空选择且无研究事实
      requestFingerprint: fp,
    })).rejects.toMatchObject({ code: "no_facts_selected", status: 400 });
  });
});

