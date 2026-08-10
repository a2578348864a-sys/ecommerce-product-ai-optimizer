import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v2213-revoked-ux");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/tasks/[id]/creative-handoff/route";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff, revokeCreativeHandoffAction } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import {
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
  PRODUCT_RESEARCH_HASH_SCHEMA,
} from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import { createDemoSession } from "@/lib/server/accessSession";
import { createDemoAccess } from "@/lib/server/demoAccess";

const NOW = "2026-08-11T13:00:00.000Z";
const DEMO = "demo-revoked-ux";
const CANDIDATE = "candidate-revoked-ux-0001";

function seedDemoAccess() {
  const storePath = join(tmpdir(), "v2213-revoked-ux", "demo-access.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, accesses: [{
    id: DEMO, label: "revoked-ux-test", passwordHash: "sha256:x", salt: "y",
    expiresAt: null, maxAiCalls: 10, usedAiCalls: 0,
    productJourneyReservations: {},
    productJourneyMigration: { version: "sandbox-product-journeys-v1", migratedAt: NOW, sourceTaskCount: 0, sourceCandidateCount: 0 },
    isActive: true, createdAt: NOW, lastUsedAt: null, notes: "test",
  }] }), "utf8");
}

function demoToken() {
  // 真实 in-memory 会话（accessSession 是 globalThis 单例）
  return createDemoSession(DEMO).token;
}

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function seedResearchTask(taskId: string, withListingFacts = true) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: CANDIDATE, runId: "run-revoked-ux",
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
  const productFacts = {
    productTitle: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
    brand: "YETI", price: 28, rating: 4.8, reviews: 36275,
    rootCategory: "Sports & Outdoors", subCategory: "Water Bottles",
  };
  const listingFacts = {
    version: "product-batch-listing-facts.v1", marketplace: "US", asin: "B0GZRLKJT8", category: "Sports & Outdoors",
    productTitle: productFacts.productTitle, brand: "YETI", price: 28, rating: 4.8, reviews: 36275,
    productDetails: "Brand: YETI | Material: Stainless Steel | Bottle Type: Insulated Bottle | Color: Mist/Pink/Grasshopper | Capacity: 12 ounces",
    productBulletPoints: "Dishwasher Safe\n18/8 stainless steel - BPA-free",
  };
  const resultJson = JSON.stringify({
    type: "workflow",
    productName: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
    status: "completed",
    researchRecord,
    researchVerification: verification,
    candidateAnalysisContext: {
      version: "candidate-analysis-context-v1",
      integrity: "verified_product_batch",
      facts: {
        capturedAt: NOW, originKind: "seller_sprite_product_batch",
        productBatchId: "6ecf22d2-f507-4aa1-9978-22ff51d52e57",
        productBatchItemId: CANDIDATE,
        productName: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
        marketplace: "US", asin: "B0GZRLKJT8", reportType: "category_current", query: null,
        category: "Sports & Outdoors", researchPriority: "priority_1",
        evidenceStatus: "sufficient_for_comparison", provisionalDisposition: "provisional_score_only",
        evidenceHash: "e".repeat(64), itemHash: "f".repeat(64),
        sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
        productFacts,
      },
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
    sourceMeta: {
      source: "opportunity", candidateId: CANDIDATE,
      candidateSnapshot: { version: 1, id: CANDIDATE, name: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap", status: "worth_analyzing", capturedAt: NOW },
      ...(withListingFacts ? { productBatchListingFacts: listingFacts } : {}),
    },
    researchMode: "market_research_only",
    promotionEligible: false,
    agentOutputSnapshot: null,
  });
  const storePath = join(tmpdir(), "v2213-revoked-ux", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

function makePostRequest(taskId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${taskId}/creative-handoff`, {
    method: "POST",
    headers: new Headers({ "Content-Type": "application/json", "x-access-token": demoToken(), "x-access-password": demoToken() }),
    body: JSON.stringify(body),
  });
}

/** 创建首个 handoff（active）并返回 preview storageVersion */
async function createActiveHandoff(taskId: string) {
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview = p1.preview!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const selectedFields = [...new Set(listingEligible.map((c) => c.field))];
  const selectedIds = selectedFields.map((f) => preview.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
  const sv = preview.storageVersion!;
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655449900",
    expectedResearchRevision: preview.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: selectedIds,
    requestFingerprint: buildRequestFingerprint({
      action: "create", selectedFactIds: selectedIds,
      expectedStorageVersion: sv,
      expectedResearchRevision: preview.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    }),
  });
  return { sv, selectedIds };
}

describe("v2.2.13 已撤回创作资料 UX", () => {
  it("1. active handoff：正常创建新 revision", async () => {
    seedDemoAccess();
    const taskId = "sandbox_task_v2213_active";
    seedResearchTask(taskId);
    const { sv } = await createActiveHandoff(taskId);
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview2 = p2.preview!;
    const sv2 = preview2.storageVersion!;
    const confirmables = buildConfirmableCandidates(p2.gate.candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const fields = [...new Set(listingEligible.map((c) => c.field))];
    const ids = fields.map((f) => preview2.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
    const res = await POST(makePostRequest(taskId, {
      action: "create",
      requestId: "550e8400-e29b-41d4-a716-446655449901",
      expectedResearchRevision: preview2.expectedResearchRevision!,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: ids,
      confirmed: true,
    }), { params: Promise.resolve({ id: taskId }) });
    const j = await res.json();
    // active handoff append：成功追加 revision 2（route 对 append 返回 200，isNewRevision 仅首次创建为 true）
    expect(res.status).toBe(200);
    expect(j.currentRevision).toBe(2);
    // 历史数据保留且 handoff 仍 active
    const task = getSandboxTask(DEMO, taskId)!;
    const handoff = JSON.parse((task as unknown as { resultJson: string }).resultJson).creativeHandoff;
    expect(handoff.versions.length).toBe(2);
    expect(handoff.controlState).toBe("active");
    void sv;
  });

  it("2. revoked handoff：API 返回业务错误 + 中文提示 + 不新增 revision", async () => {
    seedDemoAccess();
    const taskId = "sandbox_task_v2213_revoked";
    seedResearchTask(taskId);
    const { sv } = await createActiveHandoff(taskId);
    // 撤回（用最新 storageVersion）
    const afterCreate = await generateCreativeHandoffPreview(taskId, visitorContext());
    const revokeSv = afterCreate.gate.storageVersion!;
    await revokeCreativeHandoffAction(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655449902",
      expectedStorageVersion: revokeSv,
      revokeReasonCode: "explicit_user_revoke",
    });
    const before = getSandboxTask(DEMO, taskId)!;
    const beforeHandoff = JSON.parse((before as unknown as { resultJson: string }).resultJson).creativeHandoff;
    expect(beforeHandoff.controlState).toBe("revoked");
    expect(beforeHandoff.versions.length).toBe(1);

    // 用户对已撤回的创作资料继续提交 create → 应返回业务错误 + 中文
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview2 = p2.preview!;
    const sv2 = preview2.storageVersion!;
    const confirmables = buildConfirmableCandidates(p2.gate.candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const fields = [...new Set(listingEligible.map((c) => c.field))];
    const ids = fields.map((f) => preview2.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
    const res = await POST(makePostRequest(taskId, {
      action: "create",
      requestId: "550e8400-e29b-41d4-a716-446655449903",
      expectedResearchRevision: preview2.expectedResearchRevision!,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: ids,
      confirmed: true,
    }), { params: Promise.resolve({ id: taskId }) });
    const j = await res.json();
    // 状态码保持业务错误（不是 500 伪装成功）
    expect(res.status).toBe(409);
    expect(j.error.code).toBe("handoff_revoked");
    // 用户可读中文（不暴露内部英文 "a revoked handoff cannot receive..."）
    expect(j.error.message).toContain("该创作资料已撤回，无法继续编辑");
    expect(j.error.message).toContain("创建新的创作资料");
    expect(j.error.message).not.toContain("revoked handoff cannot receive");
    // 不新增 revision，历史数据保留
    const after = getSandboxTask(DEMO, taskId)!;
    const afterHandoff = JSON.parse((after as unknown as { resultJson: string }).resultJson).creativeHandoff;
    expect(afterHandoff.controlState).toBe("revoked");
    expect(afterHandoff.versions.length).toBe(1);
  });

  it("3. revoked 历史数据仍可查看（detail 保留版本）", async () => {
    seedDemoAccess();
    const taskId = "sandbox_task_v2213_history";
    seedResearchTask(taskId);
    const { sv } = await createActiveHandoff(taskId);
    const afterCreate = await generateCreativeHandoffPreview(taskId, visitorContext());
    const revokeSv = afterCreate.gate.storageVersion!;
    await revokeCreativeHandoffAction(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655449904",
      expectedStorageVersion: revokeSv,
      revokeReasonCode: "explicit_user_revoke",
    });
    // detail 仍返回已撤回状态与历史版本
    const detail = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = detail.gate.currentHandoff!;
    expect(handoff.controlState).toBe("revoked");
    expect(handoff.versions.length).toBe(1);
    expect(handoff.versions[0].confirmedFacts.length).toBeGreaterThan(0);
    expect(handoff.currentRevision).toBe(1);
  });
});
