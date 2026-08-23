/**
 * V3 Research Staleness UX Closure — 契约测试
 *
 * 覆盖（任务书 §12）：
 * 1. NEW_EVIDENCE_AFTER_COMPLETION_STALES
 * 2. DUPLICATE_EVIDENCE_DOES_NOT_STALE
 * 3. STALE_DISABLES_CREATIVE_CTA（UI 源级断言）
 * 4. STALE_CTA_HAS_REASON（UI 源级断言）
 * 5. RECONFIRM_CREATES_NEW_VERSION（completion revision N→N+1）
 * 6. OLD_RESEARCH_VERSION_PRESERVED（reconfirmedFrom 保留）
 * 7. RECONFIRM_REFRESHES_HANDOFF（evidenceHash 更新 → stale=false）
 * 8. LISTING_READY_AFTER_RECONFIRM / IMAGE_READY_AFTER_RECONFIRM（gate 放行）
 * 9. DIRECT_ROUTE_STILL_GUARDED（stale 时 gate 拦截）
 * 10. HISTORY_REMAINS_VISIBLE（历史 artifact 摘要不依赖 stale）
 * 11. MARKET_OBSERVATION_VOLATILITY_CASE（BSR 波动不 stale；身份变化 stale）
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "staleness-ux-closure");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import {
  computeResearchEvidenceHash,
  getResearchCompletion,
  getResearchStaleState,
  describeEvidenceChangesSinceCompletion,
  RESEARCH_COMPLETION_SCHEMA,
} from "@/lib/productResearchRecord";
import { completeCurrentResearch } from "@/lib/server/productResearchRecordStore";
import { checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { deriveCreativeMaterialStatus, deriveHistoricalArtifactSummary } from "@/lib/taskResearchHistoryPresentation";

const NOW = "2026-08-20T00:00:00.000Z";
const DEMO = "demo-staleness";
const CANDIDATE = "candidate-staleness";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 在 completion 上写 evidenceHash（返回新对象） */
function withHash(result: Record<string, unknown>, hash: string): Record<string, unknown> {
  const completion = isRecord(result.researchCompletion) ? { ...result.researchCompletion } : {};
  return { ...result, researchCompletion: { ...completion, evidenceHash: hash } };
}

function browserSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "amazon-detail-page-extraction.v1",
    expectedAsin: "B0F2BF31PW",
    urlAsin: "B0F2BF31PW",
    pageAsin: "B0F2BF31PW",
    entityBound: true,
    bindingProof: { urlMatchesExpected: true, pageAnchorMatchesExpected: true, productContainerFound: true },
    pageStatus: "ok",
    fields: {
      asin: { value: "B0F2BF31PW", status: "correct", reason: null, nature: "snapshot" },
      title: { value: "THERMOS FUNTAINER Water Bottle", status: "correct", reason: null, nature: "snapshot" },
      price: { value: 19.99, status: "correct", reason: null, nature: "snapshot" },
      bsr: { value: 5, status: "correct", reason: null, nature: "snapshot" },
      rating: { value: 4.7, status: "correct", reason: null, nature: "snapshot" },
      reviewCount: { value: 48110, status: "correct", reason: null, nature: "snapshot" },
    },
    capturedAt: "2026-08-20T00:10:00.000Z",
    collectorVersion: "amazon-detail-page-extractor.v1",
    ...overrides,
  };
}

function buildResultJson(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: CANDIDATE, runId: "run-staleness",
    contextHash: "a".repeat(64), inputHash: "b".repeat(64), resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId, runId: verification.runId, contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus, reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` }, now: NOW,
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: null },
  });
  return {
    type: "workflow",
    productName: "THERMOS FUNTAINER Water Bottle",
    status: "completed",
    researchRecord,
    researchVerification: verification,
    researchCompletion: {
      schema: RESEARCH_COMPLETION_SCHEMA,
      status: "completed",
      completedAt: NOW,
      decisionId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      finalStatus: "creative_ready",
    },
    browserEvidence: {
      schema: "browser-evidence.v1",
      version: 1,
      candidateId: CANDIDATE,
      targetAsin: "B0F2BF31PW",
      snapshots: [browserSnapshot()],
      updatedAt: NOW,
    },
    factCandidates: {
      schema: "fact-candidates.v1",
      version: 1,
      confirmed: [],
      updatedAt: NOW,
    },
    ...extra,
  };
}

function seedTask(taskId: string, resultJson: Record<string, unknown>) {
  const storePath = join(tmpdir(), "staleness-ux-closure", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson: JSON.stringify(resultJson), productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

function readTask(taskId: string): Record<string, unknown> {
  const storePath = join(tmpdir(), "staleness-ux-closure", "sandbox.json");
  const store = JSON.parse(readFileSync(storePath, "utf8"));
  const task = store.tasks.find((t: { id: string }) => t.id === taskId);
  return JSON.parse(task.resultJson);
}

/** 追加快照到 browserEvidence（返回新对象） */
function appendSnapshot(result: Record<string, unknown>, snapshot: Record<string, unknown>): Record<string, unknown> {
  const browser = isRecord(result.browserEvidence) ? { ...result.browserEvidence } : {};
  const snapshots = Array.isArray(browser.snapshots) ? [...browser.snapshots] : [];
  snapshots.push(snapshot);
  return { ...result, browserEvidence: { ...browser, snapshots } };
}

describe("Staleness UX Closure — 证据指纹与触发规则", () => {
  it("NEW_EVIDENCE_AFTER_COMPLETION_STALES：身份/规格证据变化 → stale", () => {
    const base = buildResultJson();
    const hash1 = computeResearchEvidenceHash(base)!;
    const completed = withHash(base, hash1);
    expect(getResearchStaleState(completed).stale).toBe(false);
    // 新证据：productInfo 规格行变化（MEANINGFUL）
    const changed = appendSnapshot(completed, browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      evidenceId: "7408a748-d982-4a62-be7d-2f6d81d527a9",
      productInfo: { schemaVersion: "amazon-product-info-extraction.v1", canonicalFacts: { material: "Stainless Steel" } },
    }));
    expect(getResearchStaleState(changed).stale).toBe(true);
  });

  it("DUPLICATE_EVIDENCE_DOES_NOT_STALE：相同语义快照重复采集（仅元数据不同）→ 不 stale", () => {
    const base = buildResultJson();
    const hash1 = computeResearchEvidenceHash(base)!;
    const completed = withHash(base, hash1);
    // 完全相同字段值，仅 capturedAt/collectorVersion 不同 → 归一化去重 → hash 不变
    const duplicated = appendSnapshot(completed, browserSnapshot({
      capturedAt: "2026-08-20T05:00:00.000Z",
      collectorVersion: "amazon-detail-page-extractor.v2",
    }));
    expect(computeResearchEvidenceHash(duplicated)).toBe(hash1);
    expect(getResearchStaleState(duplicated).stale).toBe(false);
  });

  it("MARKET_OBSERVATION_VOLATILITY_CASE：仅 BSR/价格/评分波动 → 不 stale；身份变化 → stale", () => {
    const base = buildResultJson();
    const hash1 = computeResearchEvidenceHash(base)!;
    const completed = withHash(base, hash1);
    // 新增采集：仅 BSR 5→4、价格 19.99→18.50（市场波动）→ 不 stale
    const volatile = appendSnapshot(completed, browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      evidenceId: "7408a748-d982-4a62-be7d-2f6d81d527a9",
      fields: {
        asin: { value: "B0F2BF31PW", status: "correct", reason: null, nature: "snapshot" },
        title: { value: "THERMOS FUNTAINER Water Bottle", status: "correct", reason: null, nature: "snapshot" },
        price: { value: 18.5, status: "correct", reason: null, nature: "snapshot" },
        bsr: { value: 4, status: "correct", reason: null, nature: "snapshot" },
        rating: { value: 4.6, status: "correct", reason: null, nature: "snapshot" },
        reviewCount: { value: 48116, status: "correct", reason: null, nature: "snapshot" },
      },
    }));
    expect(computeResearchEvidenceHash(volatile)).toBe(hash1);
    expect(getResearchStaleState(volatile).stale).toBe(false);
    // 身份变化（title 不同）→ meaningful → stale
    const identityChanged = appendSnapshot(completed, browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      fields: {
        asin: { value: "B0F2BF31PW", status: "correct", reason: null, nature: "snapshot" },
        title: { value: "THERMOS FUNTAINER 24oz Water Bottle", status: "correct", reason: null, nature: "snapshot" },
        price: { value: 19.99, status: "correct", reason: null, nature: "snapshot" },
        bsr: { value: 5, status: "correct", reason: null, nature: "snapshot" },
        rating: { value: 4.7, status: "correct", reason: null, nature: "snapshot" },
        reviewCount: { value: 48110, status: "correct", reason: null, nature: "snapshot" },
      },
    }));
    expect(computeResearchEvidenceHash(identityChanged)).not.toBe(hash1);
    expect(getResearchStaleState(identityChanged).stale).toBe(true);
  });

  it("无 completion → completed=false / stale=false", () => {
    const result = buildResultJson();
    delete result.researchCompletion;
    const state = getResearchStaleState(result);
    expect(state.completed).toBe(false);
    expect(state.stale).toBe(false);
  });

  it("NEW_EVIDENCE_SINCE_LAST_COMPLETION 明细：完成后的新快照被列出", () => {
    const base = buildResultJson();
    // 原始快照在 completion 之前（完成时已存在）→ 不列出；只列出完成后的新快照
    const before = withHash(base, computeResearchEvidenceHash(base)!);
    before.browserEvidence = {
      ...(isRecord(before.browserEvidence) ? before.browserEvidence : {}),
      snapshots: [browserSnapshot({ capturedAt: "2026-08-19T20:00:00.000Z" })],
    };
    const changed = appendSnapshot(before, browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      evidenceId: "7408a748-d982-4a62-be7d-2f6d81d527a9",
    }));
    const items = describeEvidenceChangesSinceCompletion(changed);
    expect(items.length).toBe(1);
    expect(items[0].evidenceType).toBe("Amazon 页面证据");
    expect(items[0].capturedAt).toBe("2026-08-20T04:17:24.000Z");
    expect(items[0].source).toBe("browserEvidence");
  });
});

describe("Staleness UX Closure — Reconfirmation 版本化", () => {
  it("RECONFIRM_CREATES_NEW_VERSION + OLD_RESEARCH_VERSION_PRESERVED：revision N→N+1 + reconfirmedFrom 保留", async () => {
    const taskId = "sandbox_task_staleness_reconfirm";
    const base = buildResultJson();
    const hash1 = computeResearchEvidenceHash(base)!;
    seedTask(taskId, withHash(base, hash1));
    // 证据变化 → stale
    const changed = appendSnapshot(readTask(taskId), browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      fields: {
        asin: { value: "B0F2BF31PW", status: "correct", reason: null, nature: "snapshot" },
        title: { value: "THERMOS FUNTAINER 24oz Water Bottle", status: "correct", reason: null, nature: "snapshot" },
        price: { value: 19.99, status: "correct", reason: null, nature: "snapshot" },
        bsr: { value: 5, status: "correct", reason: null, nature: "snapshot" },
        rating: { value: 4.7, status: "correct", reason: null, nature: "snapshot" },
        reviewCount: { value: 48110, status: "correct", reason: null, nature: "snapshot" },
      },
    }));
    seedTask(taskId, changed);
    expect(getResearchStaleState(readTask(taskId)).stale).toBe(true);

    // 重新确认 → Version N+1
    const result = await completeCurrentResearch(visitorContext(), taskId, {});
    expect(result.reconfirmed).toBe(true);
    const completion = getResearchCompletion(readTask(taskId))!;
    expect(completion.revision).toBe(2); // N→N+1
    expect(completion.reconfirmedFrom).toEqual({
      revision: 1,
      completedAt: NOW,
      evidenceHash: hash1,
    });
    // stale 收敛
    expect(getResearchStaleState(readTask(taskId)).stale).toBe(false);
  });

  it("RECONFIRM_REFRESHES_HANDOFF：reconfirm 后 stale 收敛 → creative 可用恢复（gate 不再因 stale 拒绝）", async () => {
    const taskId = "sandbox_task_staleness_handoff";
    const base = buildResultJson();
    const hash1 = computeResearchEvidenceHash(base)!;
    seedTask(taskId, withHash(base, hash1));
    const changed = appendSnapshot(readTask(taskId), browserSnapshot({
      capturedAt: "2026-08-20T04:17:24.000Z",
      fields: {
        asin: { value: "B0F2BF31PW", status: "correct", reason: null, nature: "snapshot" },
        title: { value: "THERMOS FUNTAINER 24oz Water Bottle", status: "correct", reason: null, nature: "snapshot" },
        price: { value: 19.99, status: "correct", reason: null, nature: "snapshot" },
        bsr: { value: 5, status: "correct", reason: null, nature: "snapshot" },
        rating: { value: 4.7, status: "correct", reason: null, nature: "snapshot" },
        reviewCount: { value: 48110, status: "correct", reason: null, nature: "snapshot" },
      },
    }));
    seedTask(taskId, changed);
    // DIRECT_ROUTE_STILL_GUARDED：stale 时 creative-handoff gate 拒绝（服务端 fail-closed）
    const gateStale = await checkCreativeHandoffGate(taskId, visitorContext());
    expect(gateStale.reason).toBe("research_stale_requires_reconfirmation");
    // reconfirm → Version N+1 + evidenceHash 刷新
    await completeCurrentResearch(visitorContext(), taskId, {});
    // LISTING_READY_AFTER_RECONFIRM + IMAGE_READY_AFTER_RECONFIRM：stale 收敛 → gate 不再因 stale 拒绝
    const gateAfter = await checkCreativeHandoffGate(taskId, visitorContext());
    expect(gateAfter.reason).not.toBe("research_stale_requires_reconfirmation");
    expect(getResearchStaleState(readTask(taskId)).stale).toBe(false);
  });
});

describe("Staleness UX Closure — 展示层", () => {
  it("STALE_DISABLES_CREATIVE_CTA + STALE_CTA_HAS_REASON：UI 源级断言", () => {
    const detailSource = readFileSync(resolve(process.cwd(), "components/TaskRecordDetail.tsx"), "utf8");
    const gateSource = readFileSync(resolve(process.cwd(), "components/studio/TaskStudioPreparation.tsx"), "utf8");
    // stale 时 CTA 禁用 + 原因
    expect(detailSource).toContain("researchStale");
    expect(detailSource).toContain("!studioLegacyUnsupported && !researchStale");
    expect(detailSource).toContain("研究资料已变化，请先重新确认研究。");
    expect(detailSource).toContain("确认研究结论仍然有效");
    expect(detailSource).toContain("new-evidence-since-completion");
    // Studio gate 无死路：stale 原因 + 返回重新确认
    expect(gateSource).toContain("research_stale_requires_reconfirmation");
    expect(gateSource).toContain("返回研究记录重新确认");
    expect(gateSource).toContain("研究资料需要重新确认");
  });

  it("HISTORY_REMAINS_VISIBLE：历史 artifact 摘要不依赖 stale", () => {
    const base = buildResultJson();
    base.aiListingPackSnapshot = { savedAt: NOW, pack: { titles: ["x"] } };
    base.aiImageDraftSnapshot = { items: [{ imageId: "img-1" }] };
    const summary = deriveHistoricalArtifactSummary(base);
    expect(summary.hasListing).toBe(true);
    expect(summary.hasImages).toBe(true);
    // stale 状态不影响历史摘要
    const staleState = getResearchStaleState(withHash(base, "0".repeat(64)));
    expect(staleState.stale).toBe(true);
    expect(deriveHistoricalArtifactSummary(base).hasListing).toBe(true);
  });

  it("creativeMaterialStatus：有 active handoff → available（stale 由 UI researchStale 覆盖禁用）", () => {
    const base = buildResultJson();
    base.creativeHandoff = { schema: "product-creative-handoff.v1", controlState: "active" };
    expect(deriveCreativeMaterialStatus(base).key).toBe("available");
  });
});
