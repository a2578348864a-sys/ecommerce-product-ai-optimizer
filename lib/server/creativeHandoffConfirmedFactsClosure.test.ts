/**
 * 研究 → 人工确认 → Studio → Listing 创建：最终闭环契约测试。
 *
 * 语义（门禁统一后）：
 *   allowed         = 能否「创建/追加」创作交接（创建资格）
 *   studioReachable = Studio 页是否有内容可看（入口可见性）= 预览非空
 *
 * 冻结的关键事实：
 *   1. confirmedFacts 的唯一生产点是「人工确认」，服务端永不自动生成、永不伪造。
 *   2. 人工确认的产物落在 resultJson.creativeHandoff.versions[N].confirmedFacts
 *      （evidenceTier=human_confirmed / sourceRef.sourceKind=user_confirmation）。
 *   3. gate 重新计算时读取该已落库事实并入投影的 human_confirmed 层，
 *      从而满足 parseCandidate 的 confirmedFacts ≥ 1 要求 —— 要求本身未被放宽。
 *   4. 撤回（revoked）是终态，其历史事实不授予创建资格。
 */
import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "confirmed-facts-closure");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import {
  generateCreativeHandoffPreview,
  checkCreativeHandoffGate,
} from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import {
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
  PRODUCT_RESEARCH_HASH_SCHEMA,
} from "@/lib/productResearchRecord";

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO = "demo-access-closure";
const STORE_DIR = join(tmpdir(), "confirmed-facts-closure");
const STORE_PATH = join(STORE_DIR, "sandbox.json");

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId: string, decisionStatus: "creative_ready" | "needs_information" = "creative_ready") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "run-closure",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true,
      reviewedCount: 4, totalReviewSteps: 4, allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` },
    now: NOW,
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: decisionStatus,
      reason: "ok",
      // needs_information 为「待补信息」终态前状态，nextAction 必填
      nextAction: decisionStatus === "needs_information" ? "补充缺失信息后重新确认" : null,
    },
  });
  const context = {
    candidateId,
    productName: "Test Product",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0ABCDEF12",
    productUrl: "https://example.com/p",
    title: "Test Product Title",
    brand: "TestBrand",
    category: "Kitchen",
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 120,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "kitchen",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: NOW,
    contextHash: "a".repeat(64),
  };
  const agentOutput = {
    version: "agent-output-v1",
    generatedAt: NOW,
    sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" },
    riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false },
    summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "cooks", sellingPoints: ["Lightweight"], concerns: [], confidence: "medium" },
    listingSnapshot: { titleDraft: "Lightweight Kitchen Gadget", bulletDrafts: ["Easy to clean"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] },
    nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" },
    humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" },
    fallbackUsed: false,
    warnings: [],
  };
  return JSON.stringify({
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    researchCompletion: {
      schema: "research-completion.v1",
      status: "completed",
      completedAt: NOW,
      decisionId: "11111111-1111-4111-8111-111111111111",
      revision: 1,
      finalStatus: decisionStatus,
    },
    candidateAnalysisContext: context,
    agentOutputSnapshot: agentOutput,
  });
}

function writeTask(id: string, resultJson: string) {
  writeFileSync(STORE_PATH, JSON.stringify({
    version: 1,
    tasks: [{
      id, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue",
      platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low",
      oneLineSummary: "o", resultJson, productLifecycle: "investigating", createdAt: NOW, updatedAt: NOW,
    }],
    candidates: [],
  }), "utf8");
}

/** 走真实人工确认路径：从 preview 取可确认候选 → create → 落库 creativeHandoff.versions */
async function confirmFactsViaStudio(taskId: string, requestId: string) {
  const p = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview = p.preview!;
  const sv = preview.storageVersion!;
  const confirmables = buildConfirmableCandidates(p.gate.candidate!.stableSourceFacts);
  const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const fields = [...new Set(listingEligible.map((c) => c.field))];
  const ids = fields.map((f) => preview.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
  expect(ids.length).toBeGreaterThan(0);
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId,
    expectedResearchRevision: preview.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: ids,
    requestFingerprint: buildRequestFingerprint({
      action: "create", selectedFactIds: ids, expectedStorageVersion: sv,
      expectedResearchRevision: preview.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    }),
  });
  return ids;
}

/** Studio 入口可见性（与 app/api/tasks/[id]/route.ts#projectStudioGate 同一判据） */
function studioReachableOf(preview: unknown): boolean {
  return preview !== null;
}

describe("研究 → 人工确认 → Studio → 创建：最终闭环", () => {
  it("场景A：creative_ready + completed + 未人工确认 → allowed=false / no_confirmed_facts，但可进入 Studio", async () => {
    const taskId = "sandbox_task_closure_a";
    writeTask(taskId, researchDoc("candidate-closure-a"));
    const { preview, gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("no_confirmed_facts");
    // 入口仍可进入（用户正是要在这里完成人工确认）
    expect(studioReachableOf(preview)).toBe(true);
  });

  it("场景B：人工确认事实后 → confirmedFacts 落库 + 重算 gate → allowed=true / eligible", async () => {
    const taskId = "sandbox_task_closure_b";
    writeTask(taskId, researchDoc("candidate-closure-b"));
    // 确认前
    const before = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(before.gate.allowed).toBe(false);

    await confirmFactsViaStudio(taskId, "11111111-1111-4111-8111-000000000001");

    // 落库校验：confirmedFacts 真实写入，且全部为 human_confirmed + user_confirmation
    const stored = JSON.parse(JSON.parse(readFileSync(STORE_PATH, "utf8")).tasks[0].resultJson);
    const versions = stored.creativeHandoff?.versions ?? [];
    expect(versions.length).toBe(1);
    const facts = versions[versions.length - 1].confirmedFacts;
    expect(facts.length).toBeGreaterThanOrEqual(1);
    for (const fact of facts) {
      expect(fact.evidenceTier).toBe("human_confirmed");
      expect(fact.sourceRef.sourceKind).toBe("user_confirmation");
    }

    // 重算 gate → 闭环打通
    const after = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(after.gate.allowed).toBe(true);
    expect(after.gate.reason).toBe("eligible");
    expect((after.gate.candidate?.confirmedFacts ?? []).length).toBeGreaterThanOrEqual(1);
    expect(studioReachableOf(after.preview)).toBe(true);
  });

  it("场景B-2：P1-3 跨层排他 — 已确认 field 不得同时出现在 stable 层", async () => {
    const taskId = "sandbox_task_closure_b2";
    writeTask(taskId, researchDoc("candidate-closure-b2"));
    await confirmFactsViaStudio(taskId, "11111111-1111-4111-8111-000000000002");
    const gate = await checkCreativeHandoffGate(taskId, visitorContext());
    const confirmedFields = new Set((gate.candidate?.confirmedFacts ?? []).map((f) => f.field));
    const stableFields = (gate.candidate?.stableSourceFacts ?? []).map((f) => f.field);
    expect(confirmedFields.size).toBeGreaterThan(0);
    expect(stableFields.some((f) => confirmedFields.has(f))).toBe(false);
  });

  it("场景C：needs_information → 无法进入 Studio", async () => {
    const taskId = "sandbox_task_closure_c";
    writeTask(taskId, researchDoc("candidate-closure-c", "needs_information"));
    const { preview, gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("decision_not_creative_ready");
    expect(studioReachableOf(preview)).toBe(false);
  });

  it("场景D：legacy（无正式研究合同）→ 保持关闭", async () => {
    const taskId = "sandbox_task_closure_d";
    writeTask(taskId, JSON.stringify({ type: "workflow", productName: "Legacy" }));
    const { preview, gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("legacy_not_supported");
    expect(studioReachableOf(preview)).toBe(false);
  });

  it("撤回是终态：revoked handoff 的历史事实不授予创建资格", async () => {
    const taskId = "sandbox_task_closure_revoked";
    writeTask(taskId, researchDoc("candidate-closure-r"));
    await confirmFactsViaStudio(taskId, "11111111-1111-4111-8111-000000000003");
    // 确认后本应 eligible；置为 revoked 后不得再授予资格
    const store = JSON.parse(readFileSync(STORE_PATH, "utf8"));
    const task = store.tasks[0];
    const result = JSON.parse(task.resultJson);
    result.creativeHandoff.controlState = "revoked";
    task.resultJson = JSON.stringify(result);
    writeFileSync(STORE_PATH, JSON.stringify(store), "utf8");
    const gate = await checkCreativeHandoffGate(taskId, visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("no_confirmed_facts");
  });
});
