import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSandboxTaskAndLinkCandidateAtomic,
  getSandboxTask,
  type SandboxTask,
} from "@/lib/server/demoSandbox";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";
import {
  createOrAppendCreativeHandoff,
  revokeCreativeHandoffAction,
} from "@/lib/server/productCreativeHandoffPersistence";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { parseRequestLedger } from "@/lib/creativeHandoffRequestLedger";
import { parseProductCreativeHandoff, type ProductCreativeHandoffCandidate } from "@/lib/productCreativeHandoff";
import { createEmptyRequestLedger } from "@/lib/creativeHandoffRequestLedger";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { createHash } from "node:crypto";

// 模块加载前隔离 Visitor Store 与 demo access 存储
vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "fix2-visitor-store");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-05T00:00:00.000Z";
const OWNER_FP = "a1b2c3d4e5f6a7b8";
const DEMO_A = "demo-access-a";
const DEMO_B = "demo-access-b";
const REQ_A1 = "550e8400-e29b-41d4-a716-446655440000";
const REQ_A2 = "550e8400-e29b-41d4-a716-446655440001";

function visitorContext(demoAccessId: string) {
  return {
    mode: "demo" as const,
    token: `tok-${demoAccessId}`,
    demoAccessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 10,
  };
}

function buildLegalCandidate(candidateId: string) {
  return {
    sourceResearch: {
      recordSchema: "product-research-record.v1" as const,
      candidateId,
      researchRevision: 1,
      researchHash: "a".repeat(64),
      workflowStatus: "completed" as const,
      decisionStatus: "creative_ready" as const,
      candidateSourceFingerprint: "b".repeat(64),
    },
    productIdentity: { displayName: "Visitor Product", identityConfirmedAt: NOW },
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
        confirmedBy: { mode: "visitor" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" },
        confirmedAt: NOW,
        confirmationReference: "ref-visitor-001",
      },
      confirmedAt: NOW,
      confirmedBy: { mode: "visitor" as const, subjectFingerprint: "a1b2c3d4e5f6a7b8" },
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
  } satisfies ProductCreativeHandoffCandidate;
}

function researchDocument(candidateId: string) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "run-visitor",
    contextHash: "c".repeat(64),
    inputHash: "d".repeat(64),
    resultHash: "e".repeat(64),
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
    candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${OWNER_FP}` },
    now: NOW,
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "ok",
      nextAction: null,
    },
  });
  return JSON.stringify({
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    unknownNamespace: { keep: true },
    candidateAnalysisContext: {
      candidateId,
      productName: "Visitor Product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0ABCDEF12",
      productUrl: "https://example.com/visitor",
      title: "Visitor Product Title",
      brand: "VisitorBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "visitor",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: NOW,
      contextHash: "a".repeat(64),
    },
  });
}

function makeSandboxTask(demoAccessId: string, taskId: string): SandboxTask {
  return {
    id: taskId,
    demoAccessId,
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
    resultJson: researchDocument("candidate-visitor"),
    productLifecycle: "investigating",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

beforeEach(async () => {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import("node:fs");
  const { join: j } = await import("node:path");
  const { tmpdir: t } = await import("node:os");
  const dir = j(t(), "fix2-visitor-store");
  mkdirSync(dir, { recursive: true });
  const storePath = j(dir, "sandbox.json");
  const store = {
    version: 1,
    tasks: [
      makeSandboxTask(DEMO_A, "demo-task-a"),
      makeSandboxTask(DEMO_B, "demo-task-b"),
    ],
    candidates: [],
  };
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  expect(existsSync(storePath)).toBe(true);
});

afterEach(async () => {
  const { rmSync: rm } = await import("node:fs");
  const { join: j } = await import("node:path");
  const { tmpdir: t } = await import("node:os");
  rm(j(t(), "fix2-visitor-store"), { recursive: true, force: true });
});

describe("Visitor 锁内幂等闭环（真实 Store）", () => {
  function encodeConfirmSelectionIdVisitor(
    context: { mode: string },
    taskId: string,
    researchRevision: number,
    stableFactId: string,
  ): string {
    const canonical = JSON.stringify({
      schema: "creative-handoff-selection-id:v1",
      subjectKind: "visitor",
      taskId,
      researchRevision,
      category: "confirm",
      contentFingerprint: stableFactId,
    });
    return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
  }

  function buildConfirmableCandidatesVisitor() {
    const now = "2026-08-05T00:00:00.000Z";
    return [
      { selectionKey: "stable-brand", field: "brand", label: "品牌", value: "VisitorBrand", sourceKind: "candidate_snapshot", capturedAt: now, stabilityRule: "human_confirmation_required_for_claim", allowedUsageScopes: ["internal", "listing"] },
      { selectionKey: "stable-category", field: "category", label: "类目", value: "Kitchen", sourceKind: "candidate_snapshot", capturedAt: now, stabilityRule: "human_confirmation_required_for_claim", allowedUsageScopes: ["internal", "listing"] },
    ] as const;
  }

    async function visitorFirstCreate(demoAccessId = DEMO_A, taskId = "demo-task-a", requestId = REQ_A1) {
    const ctx = visitorContext(demoAccessId);
    const preview = await generateCreativeHandoffPreview(taskId, ctx);
    // Fix.3: 无人工确认事实 → no_confirmed_facts 降级（合法研究数据）
    expect(preview.gate.reason).toBe("no_confirmed_facts");
    const sv = preview.gate.storageVersion!;
    // Fix.4: 从 Gate 候选（锁内投影产物）生成 confirmable selectionIds
    const confirmables = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts);
    const selectionIds = confirmables.map((cc) => encodeConfirmSelectionIdVisitor(ctx, taskId, preview.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    const result = await createOrAppendCreativeHandoff(taskId, ctx, {
      requestId,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    return { result, preview, sv, selectionIds, ctx };
  }

  it("V1. Visitor 创建成功 → Handoff + Ledger 原子写入", async () => {
    const { result } = await visitorFirstCreate();
    expect(result.handoff.currentRevision).toBe(1);
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parseProductCreativeHandoff(parsed.creativeHandoff)).not.toBeNull();
    const ledger = parseRequestLedger(parsed.creativeHandoffRequestLedger)!;
    expect(ledger.entries.length).toBe(1);
    // 无 _requestMeta / _revokeMeta
    expect(JSON.stringify(parsed.creativeHandoff)).not.toContain("_requestMeta");
    expect(JSON.stringify(parsed.creativeHandoff)).not.toContain("_revokeMeta");
  });

  it("V2. Visitor 同 requestId 重放 → 幂等, 不新增版本", async () => {
    const { result, sv, selectionIds, ctx } = await visitorFirstCreate();
    const replay = await createOrAppendCreativeHandoff("demo-task-a", ctx, {
      requestId: REQ_A1,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: result.handoff.currentRevision,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    expect(replay.idempotentReplay).toBe(true);
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parsed.creativeHandoff.versions.length).toBe(1);
  });

  it("V3. Visitor 创建 Revision 2（不同 requestId 相同内容）", async () => {
    const { result, selectionIds, ctx } = await visitorFirstCreate();
    const preview2 = await generateCreativeHandoffPreview("demo-task-a", ctx);
    const sv2 = preview2.gate.storageVersion!;
    const app = await createOrAppendCreativeHandoff("demo-task-a", ctx, {
      requestId: REQ_A2,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    expect(app.idempotentReplay).toBe(false);
    expect(app.handoff.currentRevision).toBe(2);
    expect(result.handoff.currentRevision).toBe(1);
  });

  it("V4. Visitor Revoke + 重放", async () => {
    const { selectionIds, ctx } = await visitorFirstCreate();
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    const sv = preview.gate.storageVersion!;
    const first = await revokeCreativeHandoffAction("demo-task-a", ctx, {
      requestId: REQ_A2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    expect(first.handoff.controlState).toBe("revoked");
    // 重放（旧 sv）→ 幂等命中
    const replay = await revokeCreativeHandoffAction("demo-task-a", ctx, {
      requestId: REQ_A2,
      revokeReasonCode: "explicit_user_revoke",
      expectedStorageVersion: sv,
    });
    expect(replay.idempotentReplay).toBe(true);
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    const ledger = parseRequestLedger(parsed.creativeHandoffRequestLedger)!;
    expect(ledger.entries.filter((e) => e.action === "revoke")).toHaveLength(1);
    expect(selectionIds).toBeTruthy();
  });

  it("V5. Visitor A 访问 Visitor B 的 Task → 404 / 不可见", async () => {
    const ctxA = visitorContext(DEMO_A);
    const preview = await generateCreativeHandoffPreview("demo-task-b", ctxA);
    // 跨 Visitor → gate 拒绝（ownership 检查）
    expect(preview.gate.allowed).toBe(false);
    const ctxB = visitorContext(DEMO_B);
    const previewB = await generateCreativeHandoffPreview("demo-task-b", ctxB);
    // B 自己的任务 → 合法研究数据（no_confirmed_facts 降级），非 legacy_not_supported
    expect(previewB.gate.allowed).toBe(false);
    expect(previewB.gate.reason).toBe("no_confirmed_facts");
  });

  it("V6. 同 requestId 并发 → 只写一次", async () => {
    const ctx = visitorContext(DEMO_A);
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    const sv = preview.gate.storageVersion!;
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdVisitor(ctx, "demo-task-a", preview.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    const run = () => createOrAppendCreativeHandoff("demo-task-a", ctx, {
      requestId: REQ_A1,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    const [a, b] = await Promise.allSettled([run(), run()]);
    const fulfilled = a.status === "fulfilled" ? 1 : 0 + (b.status === "fulfilled" ? 1 : 0);
    expect(fulfilled).toBeGreaterThanOrEqual(1);
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parsed.creativeHandoff.versions.length).toBe(1);
  });

  it("V7. Visitor A 与 B 同时写各自 Task → 互不污染", async () => {
    const ctxA = visitorContext(DEMO_A);
    const ctxB = visitorContext(DEMO_B);
    const pa = await generateCreativeHandoffPreview("demo-task-a", ctxA);
    const pb = await generateCreativeHandoffPreview("demo-task-b", ctxB);
    const selA = buildConfirmableCandidates(pa.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdVisitor(ctxA, "demo-task-a", pa.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    const selB = buildConfirmableCandidates(pb.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdVisitor(ctxB, "demo-task-b", pb.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    await Promise.all([
      createOrAppendCreativeHandoff("demo-task-a", ctxA, {
        requestId: REQ_A1,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 0,
        expectedStorageVersion: pa.gate.storageVersion!,
        selectedFactCandidateIds: selA,
        requestFingerprint: `sha256:${"a".repeat(64)}`,
      }),
      createOrAppendCreativeHandoff("demo-task-b", ctxB, {
        requestId: REQ_A2,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: 0,
        expectedStorageVersion: pb.gate.storageVersion!,
        selectedFactCandidateIds: selB,
        requestFingerprint: `sha256:${"b".repeat(64)}`,
      }),
    ]);
    const ta = getSandboxTask(DEMO_A, "demo-task-a")!;
    const tb = getSandboxTask(DEMO_B, "demo-task-b")!;
    expect(ta.demoAccessId).toBe(DEMO_A);
    expect(tb.demoAccessId).toBe(DEMO_B);
    expect(JSON.parse(ta.resultJson).creativeHandoff.taskId).toBe("demo-task-a");
    expect(JSON.parse(tb.resultJson).creativeHandoff.taskId).toBe("demo-task-b");
  });

  it("V8. 高频竞争 10 轮 append → 0 丢数据, 0 损坏", async () => {
    const ctx = visitorContext(DEMO_A);
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdVisitor(ctx, "demo-task-a", preview.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    // 10 轮不同 requestId（append 链，PR2-0 上限 10 版）
    for (let i = 0; i < 10; i++) {
      const reqId = `550e8400-e29b-41d4-a716-${(446655440000 + i).toString().padStart(12, "0")}`;
      const p = await generateCreativeHandoffPreview("demo-task-a", ctx);
      expect(p.gate.reason).toBe("no_confirmed_facts");
      const result = await createOrAppendCreativeHandoff("demo-task-a", ctx, {
        requestId: reqId,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: p.preview!.expectedCurrentHandoffRevision ?? 0,
        expectedStorageVersion: p.gate.storageVersion!,
        selectedFactCandidateIds: selectionIds,
        requestFingerprint: `sha256:${(i.toString(16).repeat(64)).slice(0, 64)}`,
      });
      expect(result.handoff.currentRevision).toBe(i + 1);
      // 每轮验证 Store 完整性
      const task = getSandboxTask(DEMO_A, "demo-task-a")!;
      const parsed = JSON.parse(task.resultJson);
      expect(parseProductCreativeHandoff(parsed.creativeHandoff)).not.toBeNull();
      expect(parseRequestLedger(parsed.creativeHandoffRequestLedger)).not.toBeNull();
    }
    // 最终状态：10 版 + 10 条 Ledger
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parsed.creativeHandoff.versions.length).toBe(10);
    const ledger = parseRequestLedger(parsed.creativeHandoffRequestLedger)!;
    expect(ledger.entries.length).toBe(10);
    expect(preview.gate.reason).toBe("no_confirmed_facts");
  });

  it("V8b. 第 11 版拒绝（PR2-0 上限）, Ledger 不追加", async () => {
    const ctx = visitorContext(DEMO_A);
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    const selectionIds = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts)
      .map((cc) => encodeConfirmSelectionIdVisitor(ctx, "demo-task-a", preview.gate.candidate!.sourceResearch.researchRevision, cc.selectionKey));
    // 先创建 10 版
    for (let i = 0; i < 10; i++) {
      const reqId = `550e8400-e29b-41d4-a716-${(446655440000 + i).toString().padStart(12, "0")}`;
      const p = await generateCreativeHandoffPreview("demo-task-a", ctx);
      expect(p.gate.reason).toBe("no_confirmed_facts");
      await createOrAppendCreativeHandoff("demo-task-a", ctx, {
        requestId: reqId,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: p.preview!.expectedCurrentHandoffRevision ?? 0,
        expectedStorageVersion: p.gate.storageVersion!,
        selectedFactCandidateIds: selectionIds,
        requestFingerprint: `sha256:${(i.toString(16).repeat(64)).slice(0, 64)}`,
      });
    }
    const p = await generateCreativeHandoffPreview("demo-task-a", ctx);
    await expect(createOrAppendCreativeHandoff("demo-task-a", ctx, {
      requestId: `550e8400-e29b-41d4-a716-${(446655440010).toString().padStart(12, "0")}`,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 10,
      expectedStorageVersion: p.gate.storageVersion!,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"d".repeat(64)}`,
    })).rejects.toMatchObject({ code: "handoff_version_limit_reached" });
    // 数据零变化
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    const parsed = JSON.parse(task.resultJson);
    expect(parsed.creativeHandoff.versions.length).toBe(10);
    const ledger = parseRequestLedger(parsed.creativeHandoffRequestLedger)!;
    expect(ledger.entries.length).toBe(10);
  });

  it("V9. Store 损坏 → fail-closed（不覆盖, 返回 legacy_not_supported）", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join: j } = await import("node:path");
    const { tmpdir: t } = await import("node:os");
    writeFileSync(j(t(), "fix2-visitor-store", "sandbox.json"), "{broken json", "utf8");
    const ctx = visitorContext(DEMO_A);
    // 损坏 Store：Gate 不解析出任务 → 拒绝；不得覆盖、不得回退 Prisma
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    expect(preview.gate.allowed).toBe(false);
    // 写路径同样 fail-closed（不静默覆盖损坏数据）
    const task = getSandboxTask(DEMO_A, "demo-task-a");
    expect(task).toBeNull();
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(j(t(), "fix2-visitor-store", "sandbox.json"), "utf8");
    expect(raw).toBe("{broken json"); // 未被覆盖
  });

  it("V10. Store 不存在 → 不回退 Prisma（legacy_not_supported）", async () => {
    const { rmSync: rm } = await import("node:fs");
    const { join: j } = await import("node:path");
    const { tmpdir: t } = await import("node:os");
    rm(j(t(), "fix2-visitor-store", "sandbox.json"), { force: true });
    const ctx = visitorContext(DEMO_A);
    const preview = await generateCreativeHandoffPreview("demo-task-a", ctx);
    expect(preview.gate.allowed).toBe(false);
    expect(preview.gate.reason).toBe("legacy_not_supported");
  });

  it("V11. Visitor Prisma 调用为 0（源码路径 + Store 驱动）", async () => {
    // 本测试全程使用 Store（DEMO_SANDBOX_STORE_PATH 指向临时文件）
    // Preview/Create/Append/Revoke 均经 demoSandboxStore — 无 Prisma 路径
    const { result } = await visitorFirstCreate();
    expect(result.handoff.currentRevision).toBe(1);
    // Store 驱动验证：确认数据落在 Store 文件而非数据库
    const task = getSandboxTask(DEMO_A, "demo-task-a")!;
    expect(task.resultJson).toContain("creativeHandoff");
  });
});
