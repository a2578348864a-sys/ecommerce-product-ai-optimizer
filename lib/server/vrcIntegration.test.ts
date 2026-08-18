import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "vrc-integration");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { createProductResearchVerification, createInitialProductResearchRecord, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { checkCreativeHandoffGate, generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";

import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { buildImageInputFromCreativeHandoff } from "@/lib/imageHandoff/imageGenerationInput";
import { buildSellerSpriteProductImageSnapshot } from "@/lib/server/sellerSpriteProductImage";

// 真实 1x1 PNG（真实 magic bytes）
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TINY_PNG_SHA256 = "c414cd0e204de974f73753c7e28d7638e7b3691bb8b1a2bab6b25bb7fed7ce77";

const NOW = "2026-08-11T00:00:00.000Z";
const DEMO = "demo-vrc-integration";
const TASK_ID = "sandbox_task_vrc_integration1";
const CAND_ID = "sandbox_candidate_vrc_integration1";
const ASIN = "B0GZRLKJT8";
const URL = "https://m.media-amazon.com/images/I/210fH2Z2GlL._AC_US600_.jpg";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function makeSnapshot() {
  return buildSellerSpriteProductImageSnapshot({
    fetched: { bytes: TINY_PNG, mimeType: "image/png", sha256: TINY_PNG_SHA256 },
    asin: ASIN,
    capturedAt: NOW,
  });
}

function researchDoc() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: CAND_ID, runId: "wf-vrc",
    contextHash: "b".repeat(64), inputHash: "d".repeat(64), resultHash: "e".repeat(64),
    workflowStatus: "completed",
    reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId, runId: verification.runId, contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus, reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` }, now: NOW,
    decision: { decisionId: "22222222-2222-4222-8222-222222222222", status: "creative_ready", reason: "ok", nextAction: null },
  });
  // task 层快照（模拟 visual-reference-import 写入后的状态）
  const imageSnapshot = makeSnapshot();
  const context = {
    version: "candidate-analysis-context-v1",
    integrity: "verified_seller_sprite",
    facts: {
      productName: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
      marketplace: "Amazon US",
      asin: ASIN,
      productUrl: `https://www.amazon.com/dp/${ASIN}?psc=1`,
      title: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
      brand: "YETI",
      category: "Sports & Outdoors",
      priceUsd: 29.99,
      rating: 4.8,
      reviewCount: 1000,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "kids bottle",
      capturedAt: NOW,
      imageUrl: URL,
    },
    assessment: { researchMode: "market_research_only", promotionEligible: false },
  };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    // V3 Completion Authority：正式完成标记（creative_ready decision 需 research-completion.v1 才算完成）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: NOW, decisionId: "22222222-2222-4222-8222-222222222222", revision: 1, finalStatus: "creative_ready" },
    candidateAnalysisContext: context,
    agentOutputSnapshot: agentOutput,
    sourceMeta: {
      source: "opportunity",
      candidateId: CAND_ID,
      candidateSnapshot: {
        version: 1,
        id: CAND_ID,
        name: "YETI Rambler Jr.",
        status: "worth_analyzing",
        capturedAt: NOW,
        productImageSnapshot: imageSnapshot,
      },
    },
  });
}

function seedTask() {
  const storePath = join(tmpdir(), "vrc-integration", "sandbox.json");
  const candidateMeta = {
    schema: "sellersprite_candidate_source_v1",
    source: { provider: "SellerSprite", type: "sellersprite_xlsx", marketplace: "Amazon US", reportType: "SellerSprite Search Results", capturedAt: null, importedAt: NOW, sourceFileSha256: "a".repeat(64), rowHash: sha256(`row:${ASIN}`) },
    identity: { asin: ASIN, parentAsin: null, productUrl: `https://www.amazon.com/dp/${ASIN}` },
    snapshot: { title: "YETI", imageUrl: URL, priceUsd: 29.99, rating: 4.8, reviewCount: 1000, brand: "YETI", category: "Sports & Outdoors" },
    estimates: { searchRank: 1, estimatedMonthlySales: 100, estimatedMonthlyRevenueUsd: 3000, disclaimer: "third_party_estimate_point_in_time" },
  };
  writeFileSync(storePath, JSON.stringify({
    version: 1,
    tasks: [{ id: TASK_ID, demoAccessId: DEMO, type: "workflow", title: "YETI", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson: researchDoc(), productLifecycle: "i", createdAt: NOW, updatedAt: NOW }],
    candidates: [{ id: CAND_ID, demoAccessId: DEMO, name: "YETI", rawInput: "", link: `https://www.amazon.com/dp/${ASIN}`, score: 0, source: "SellerSprite", keyword: "", riskLevel: "", riskLabel: "", summaryLabel: "", status: "worth_analyzing", sourceMetaJson: JSON.stringify(candidateMeta), analysisJson: "{}", createdAt: NOW, convertedTaskId: TASK_ID, originProductBatchItemId: null, lastActionAt: null }],
  }), "utf8");
}

async function setupConfirmed() {
  seedTask();
  const p1 = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
  if (!p1.preview) {
    throw new Error(`preview null: allowed=${p1.gate.allowed} reason=${p1.gate.reason}`);
  }
  const gate = p1.gate;
  const confirmables = (gate.candidate?.stableSourceFacts ?? []).length;
  const preview = p1.preview!;
  const elig = (preview.confirmableFactCandidates ?? [])
    .filter((c) => (c.allowedUsageScopes ?? []).includes("listing") || (c.allowedUsageScopes ?? []).includes("image"));
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const c of elig) {
    if (seen.has(c.canonicalField)) continue;
    seen.add(c.canonicalField);
    ids.push(c.selectionId);
  }
  await createOrAppendCreativeHandoff(TASK_ID, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655441800",
    expectedResearchRevision: preview.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: preview.storageVersion!,
    selectedFactCandidateIds: ids,
    requestFingerprint: buildRequestFingerprint({
      action: "create", selectedFactIds: ids, expectedStorageVersion: preview.storageVersion!,
      expectedResearchRevision: preview.expectedResearchRevision!, expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0, confirmed: true,
    }),
  });
  return { gate, preview, confirmables };
}

describe("SellerSprite → 真实主图 → approvedVisualReferences → ImageInput 全链", () => {
  it("Completion Authority：creative_ready 但无 researchCompletion → gate 拒绝（research_not_completed）", async () => {
    seedTask();
    // 构造无完成标记的 fixture 任务（decision=creative_ready 仅 Human Decision，不等于完成）
    const storePath = join(tmpdir(), "vrc-integration", "sandbox.json");
    const store = JSON.parse(readFileSync(storePath, "utf8"));
    const target = (store.tasks ?? []).find((t: { id: string }) => t.id === TASK_ID);
    if (target) {
      const parsed = JSON.parse(target.resultJson);
      delete parsed.researchCompletion;
      target.resultJson = JSON.stringify(parsed);
    }
    writeFileSync(storePath, JSON.stringify(store), "utf8");
    const gate = await checkCreativeHandoffGate(TASK_ID, visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("research_not_completed");
    const p = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    expect(p.preview).toBeNull();
  });

  it("批准真实主图后 ImageGenerationInput 包含 approvedVisualReferences >= 1 且共享 facts 保留", async () => {    await setupConfirmed();
    // 批准视觉参考（纯视觉批准 append）
    const pRef = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    const vis = pRef.gate.visualReferenceCandidates ?? [];
    expect(vis.length).toBeGreaterThanOrEqual(1);
    // V3 Visual Reference Confirmation UI：批准前 preview DTO 必须如实反映未批准（approvable 恒 true ≠ 已批准）
    expect(pRef.preview!.visualReferenceCandidates?.[0]?.approvedForReference).toBe(false);
    await createOrAppendCreativeHandoff(TASK_ID, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441801",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
      expectedStorageVersion: pRef.preview!.storageVersion!,
      selectedFactCandidateIds: [],
      selectedVisualReferenceCandidateIds: vis.map((v) => v.selectionId),
      requestFingerprint: buildRequestFingerprint({
        action: "create", selectedFactIds: [], selectedVisualReferenceIds: vis.map((v) => v.selectionId),
        expectedStorageVersion: pRef.preview!.storageVersion!,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
        confirmed: true,
      }),
    });

    const p2 = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    // V3 Visual Reference Confirmation UI：批准后 preview DTO 必须转为已批准
    expect(p2.preview!.visualReferenceCandidates?.[0]?.approvedForReference).toBe(true);
    const inputResult = buildImageInputFromCreativeHandoff(p2.gate.currentHandoff!, 1);
    expect(inputResult.ok).toBe(true);
    const input = inputResult.ok ? inputResult.input : null;
    // 服务端 ImageGenerationInput：approvedVisualReferences >= 1
    expect(input!.approvedVisualReferences.length).toBeGreaterThanOrEqual(1);
    // selectionId 为批准引用合同格式（visual-ref: 前缀）
    expect(input!.approvedVisualReferences[0]!.selectionId).toMatch(/^visual-ref:/);
    // 共享 facts 保留
    const facts = input!.productFacts.map((f) => `${f.field}:${f.value}`);
    expect(facts.some((f) => f.includes("brand:YETI"))).toBe(true);
    // market signals 排除
    expect(facts.some((f) => f.includes("price"))).toBe(false);
    expect(facts.some((f) => f.includes("rating"))).toBe(false);
    // 模式切换为 product_visual_draft
    expect(input!.mode).toBe("product_visual_draft");
  });

  it("已导入 Task 重复 preview：alreadyImported=true 且不重复产生视觉候选（幂等）", async () => {
    await setupConfirmed();
    // 首次 preview：快照存在 → alreadyImported=true，候选 1 个
    const p1 = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    expect(p1.preview?.externalUrlCandidate).toEqual({ asin: ASIN, present: true, alreadyImported: true });
    const cands1 = (p1.gate.visualReferenceCandidates ?? []).map((c) => c.selectionId);
    expect(cands1.length).toBe(1);
    // 再次 preview（模拟重复打开页面）：状态不变、候选不变（同 contentHash → 同 selectionId）
    const p2 = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    expect(p2.preview?.externalUrlCandidate).toEqual({ asin: ASIN, present: true, alreadyImported: true });
    const cands2 = (p2.gate.visualReferenceCandidates ?? []).map((c) => c.selectionId);
    expect(cands2).toEqual(cands1);
    // storageVersion 不因只读 preview 变化
    expect(p2.preview?.storageVersion?.resultJsonHash).toBe(p1.preview?.storageVersion?.resultJsonHash);
  });

  it("历史 Task（既有 productImageSnapshot + approvedVisualReference）：直接可读，无需重新导入/批准", async () => {
    await setupConfirmed();
    // 模拟历史 Task：快照已存在且视觉参考已批准（v2.2.9 及之前生成的 Handoff）
    const pRef = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    const vis = pRef.gate.visualReferenceCandidates ?? [];
    await createOrAppendCreativeHandoff(TASK_ID, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441802",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
      expectedStorageVersion: pRef.preview!.storageVersion!,
      selectedFactCandidateIds: [],
      selectedVisualReferenceCandidateIds: vis.map((v) => v.selectionId),
      requestFingerprint: buildRequestFingerprint({
        action: "create", selectedFactIds: [], selectedVisualReferenceIds: vis.map((v) => v.selectionId),
        expectedStorageVersion: pRef.preview!.storageVersion!,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
        confirmed: true,
      }),
    });
    // 直接读取（不触发任何下载/重批）：ImageInput 仍含已批准参考
    const p2 = await generateCreativeHandoffPreview(TASK_ID, visitorContext());
    expect(p2.preview?.externalUrlCandidate?.alreadyImported).toBe(true);
    const inputResult = buildImageInputFromCreativeHandoff(p2.gate.currentHandoff!, 1);
    expect(inputResult.ok).toBe(true);
    const input = inputResult.ok ? inputResult.input : null;
    expect(input!.approvedVisualReferences.length).toBeGreaterThanOrEqual(1);
    expect(input!.mode).toBe("product_visual_draft");
  });
});

