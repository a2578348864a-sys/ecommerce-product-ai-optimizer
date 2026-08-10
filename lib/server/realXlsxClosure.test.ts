import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "real-xlsx-closure");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DEMO_PRODUCT_BATCH_STORE_ROOT = join(dir, "batches");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { createDemoAccess } from "@/lib/server/demoAccess";
import { createDemoProductBatchStore } from "@/lib/server/demoProductBatchStore";
import { importSellerSpriteProductBatch } from "@/lib/server/productBatchImportService";
import { buildProductBatchListingFacts } from "@/lib/server/productBatchListingFacts";
import { buildProductBatchCandidateSource } from "@/lib/server/productBatchCandidateSource";
import { adaptResearchContextForHandoff } from "@/lib/server/researchContextAdapter";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { generateListingDraftFromHandoff } from "@/lib/listingHandoff/listingGenerationService";
import { buildImageInputFromCreativeHandoff } from "@/lib/imageHandoff/imageGenerationInput";

const REAL_XLSX = "C:/Users/a2578/Downloads/NEW(Sports-&-Outdoors(Current))-10-US-20260807.xlsx";
const YETI_ASIN = "B0GZRLKJT8";
const NOW = "2026-08-11T12:00:00.000Z";
const DEMO = "demo_real_xlsx";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "real-xlsx-closure", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

describe("真实 SellerSprite XLSX ProductBatch 主链事实补全闭环验收", () => {
  it("1. 真实文件导入 → YETI batch/item 落库（含 extraRaw）", async () => {
    const demoAccessId = createDemoAccess({ label: "real-xlsx-closure" }).record.id;
    const store = createDemoProductBatchStore(demoAccessId);
    const bytes = new Uint8Array(readFileSync(REAL_XLSX));
    const result = await importSellerSpriteProductBatch({
      store,
      bytes,
      sourceFileName: "NEW(Sports-&-Outdoors(Current))-10-US-20260807.xlsx",
      reportType: "category_current",
      query: null,
      category: "Sports & Outdoors",
      priceMin: null,
      priceMax: null,
      now: new Date(NOW),
    });
    expect(result.batch.batchStatus).toBe("ready");
    const items = await store.getBatchItems(result.batch.id);
    const yeti = items.find((i) => i.asin === YETI_ASIN)!;
    expect(yeti).toBeTruthy();
    // normalizedSnapshotJson 含 YETI extraRaw（详细参数/卖点）
    const snapshot = JSON.parse(result.batch.normalizedSnapshotJson!);
    const yetiRecord = snapshot.records.find((r: { asin: { normalized: string } }) => r.asin.normalized === YETI_ASIN);
    expect(yetiRecord.extraRaw["详细参数"]).toContain("Brand: YETI");
    expect(yetiRecord.extraRaw["产品卖点"]).toContain("Dishwasher Safe");
    // productBatchListingFacts 从 extraRaw 捞取
    const source = buildProductBatchCandidateSource({ batch: result.batch, item: yeti, serverIdentityScope: "visitor:sandbox" });
    const listingFacts = buildProductBatchListingFacts({ batch: result.batch, source });
    expect(listingFacts).not.toBeNull();
    expect(listingFacts!.productDetails).toContain("Material: Stainless Steel");
    expect(listingFacts!.productDetails).toContain("Capacity: 12 ounces");
    expect(listingFacts!.productBulletPoints).toContain("Dishwasher Safe");
    return { batch: result.batch, item: yeti, source, listingFacts };
  });

  it("2. 完整真实闭环：XLSX → 候选 → 确认 → copyReady → listing/image 输入", async () => {
    const demoAccessId = createDemoAccess({ label: "real-xlsx-closure" }).record.id;
    const store = createDemoProductBatchStore(demoAccessId);
    const bytes = new Uint8Array(readFileSync(REAL_XLSX));
    const imported = await importSellerSpriteProductBatch({
      store,
      bytes,
      sourceFileName: "NEW(Sports-&-Outdoors(Current))-10-US-20260807.xlsx",
      reportType: "category_current",
      query: null,
      category: "Sports & Outdoors",
      priceMin: null,
      priceMax: null,
      now: new Date(NOW),
    });
    const items = await store.getBatchItems(imported.batch.id);
    const yeti = items.find((i) => i.asin === YETI_ASIN)!;
    const source = buildProductBatchCandidateSource({ batch: imported.batch, item: yeti, serverIdentityScope: "visitor:sandbox" });
    const listingFacts = buildProductBatchListingFacts({ batch: imported.batch, source })!;

    // 构造与 save-task 完全同构的 resultJson（sourceMeta.productBatchListingFacts 写入）
    const verification = {
      schema: "product-research-hash.v1" as const, candidateId: source.productBatchItemId, runId: "run-yeti-real",
      contextHash: "a".repeat(64), inputHash: "b".repeat(64), resultHash: "c".repeat(64),
      workflowStatus: "completed" as const,
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
    };
    const { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } = await import("@/lib/productResearchRecord");
    const ver = createProductResearchVerification(verification);
    const researchRecord = createInitialProductResearchRecord({
      candidateId: source.productBatchItemId, runId: "run-yeti-real", contextHash: "a".repeat(64),
      researchHash: buildProductResearchHash({ ...ver, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
      workflowStatus: "completed" as const, reviewState: ver.reviewState,
      actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` }, now: NOW,
      decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: null },
    });
    const productFacts = source.productFacts;
    const resultJson = JSON.stringify({
      type: "workflow",
      productName: source.productName,
      status: "completed",
      researchRecord,
      researchVerification: ver,
      candidateAnalysisContext: {
        version: "candidate-analysis-context-v1",
        integrity: "verified_product_batch",
        facts: {
          capturedAt: NOW,
          originKind: "seller_sprite_product_batch",
          productBatchId: source.productBatchId,
          productBatchItemId: source.productBatchItemId,
          productName: source.productName,
          marketplace: source.marketplace,
          asin: source.asin,
          reportType: "category_current",
          query: null,
          category: source.category,
          researchPriority: source.researchPriority,
          evidenceStatus: source.evidenceStatus,
          provisionalDisposition: source.provisionalDisposition,
          evidenceHash: source.evidenceHash,
          itemHash: source.itemHash,
          sellerSpriteDisclaimerVersion: source.sellerSpriteDisclaimerVersion,
          productFacts,
        },
        assessment: { researchMode: "market_research_only", promotionEligible: false },
      },
      sourceMeta: {
        source: "opportunity",
        candidateId: source.productBatchItemId,
        candidateSnapshot: { version: 1, id: source.productBatchItemId, name: source.productName, status: "worth_analyzing", capturedAt: NOW },
        productBatchListingFacts: listingFacts,
      },
      agentOutputSnapshot: null,
    });
    const taskId = "sandbox-yeti-real-closure";
    seedTask(taskId, resultJson);

    // Step A: adapter → context（修复验证核心）
    const parsed = JSON.parse(resultJson);
    const adapted = adaptResearchContextForHandoff(parsed);
    expect(adapted.ok).toBe(true);
    if (!adapted.ok) return;
    expect(adapted.context.sellerSpriteSourceRaw).toBeDefined();
    expect(adapted.context.sellerSpriteSourceRaw!.detailAttributes).toContain("Material: Stainless Steel");
    expect(adapted.context.sellerSpriteSourceRaw!.sellingPoints).toContain("Dishwasher Safe");

    // Step B: creative handoff preview → 候选
    const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = p1.gate.candidate!;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const byField = Object.fromEntries(confirmables.map((c) => [c.field, String(c.value)]));
    // 验证候选包含 品牌/商品类型/材质/容量/颜色/功能
    expect(byField["brand"]).toBe("YETI");
    expect(byField["product_type"]?.toLowerCase()).toContain("bottle");
    expect(byField["material"]?.toLowerCase()).toContain("stainless steel");
    expect(byField["capacity"]?.toLowerCase()).toContain("12 ounces");
    expect(byField["color_or_variant"]?.toLowerCase()).toContain("mist");
    const functionalFields = ["functional_feature", "construction", "care", "usage"];
    const functional = confirmables.filter((c) => functionalFields.includes(c.field));
    expect(functional.length).toBeGreaterThanOrEqual(1);
    // market_signal 绝不进 listing 候选
    expect(listingEligible.some((c) => ["category", "price_usd", "rating", "review_count"].includes(c.field))).toBe(false);

    // Step C: 确认候选 → confirmedFacts
    const preview1 = p1.preview!;
    const selectedFields = [...new Set(listingEligible.map((c) => c.field))];
    const selectedIds = selectedFields.map((f) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
    const sv = preview1.storageVersion!;
    const createResult = await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441000",
      expectedResearchRevision: preview1.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectedIds,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: selectedIds,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview1.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    expect(createResult.isNewRevision).toBe(true);

    // Step D: confirmedFacts + copyReady
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = p2.gate.currentHandoff!;
    const v = handoff.versions[handoff.versions.length - 1];
    const confirmedByField = Object.fromEntries(v.confirmedFacts.map((f) => [f.field, String(f.value)]));
    expect(confirmedByField["brand"]).toBe("YETI");
    expect(confirmedByField["material"]?.toLowerCase()).toContain("stainless steel");
    // capacity：真实 YETI 有标题派生（"12 oz"）与结构化（"12 ounces"）两种来源，均真实有效
    expect(confirmedByField["capacity"]?.toLowerCase()).toMatch(/12/);
    expect(confirmedByField["color_or_variant"]?.toLowerCase()).toContain("mist");
    const listingInput = buildListingInputFromCreativeHandoff(handoff, v.sourceResearch.researchRevision);
    expect(listingInput.ok).toBe(true);
    if (!listingInput.ok) return;
    const readiness = buildListingReadiness({
      confirmedFacts: v.confirmedFacts,
      listingEligibleFacts: listingInput.input.productFacts.length,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.copyReady).toBe(true);
    expect(readiness.counts.identity).toBeGreaterThanOrEqual(1);
    expect(readiness.counts.specification).toBeGreaterThanOrEqual(2);
    expect(readiness.counts.functional).toBeGreaterThanOrEqual(1);
    // 不再出现缺规格/功能提示
    expect(readiness.missingForQuality.some((m) => m.includes("规格"))).toBe(false);
    expect(readiness.missingForQuality.some((m) => m.includes("功能/使用"))).toBe(false);

    // Step E: Listing 生成进入优化路径（plan optimized，非 safe_fact_draft）
    const plan = buildListingPlan(listingInput.input, null);
    expect(plan.planQuality).toBe("optimized");
    const listingGen = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441001",
      expectedStorageVersion: p2.gate.storageVersion!,
      expectedHandoffRevision: handoff.currentRevision,
    });
    expect(listingGen.listingSaved).toBe(true);
    // 进入优化路径：draftKind 非 safe_fact_draft（无 keyword brief 时 → structured_listing_draft，即优化路径而非基础事实草稿）
    expect(listingGen.draft?.draftKind).toBe("structured_listing_draft");
    expect(listingGen.draft?.draftKind).not.toBe("safe_fact_draft");

    // Step F: Image 输入 — 共享 confirmedFacts，无 market_signal
    const imageInput = buildImageInputFromCreativeHandoff(handoff, v.sourceResearch.researchRevision);
    expect(imageInput.ok).toBe(true);
    if (!imageInput.ok) return;
    const imageFactFields = imageInput.input.productFacts.map((f) => f.field);
    expect(imageFactFields).toContain("material");
    expect(imageFactFields).toContain("capacity");
    // 无 market_signal 泄漏
    expect(imageFactFields.some((f) => ["price_usd", "rating", "review_count", "category"].includes(f))).toBe(false);
  });
});

describe("真实 XLSX 修复前后对照", () => {
  it("无 productBatchListingFacts（修复前）：仅标题派生候选 → 缺规格/功能 → 无法 copyReady", async () => {
    const demoAccessId = createDemoAccess({ label: "real-xlsx-closure-control" }).record.id;
    const store = createDemoProductBatchStore(demoAccessId);
    const bytes = new Uint8Array(readFileSync(REAL_XLSX));
    const imported = await importSellerSpriteProductBatch({
      store,
      bytes,
      sourceFileName: "NEW(Sports-&-Outdoors(Current))-10-US-20260807.xlsx",
      reportType: "category_current",
      query: null,
      category: "Sports & Outdoors",
      priceMin: null,
      priceMax: null,
      now: new Date(NOW),
    });
    const items = await store.getBatchItems(imported.batch.id);
    const yeti = items.find((i) => i.asin === YETI_ASIN)!;
    const source = buildProductBatchCandidateSource({ batch: imported.batch, item: yeti, serverIdentityScope: "visitor:sandbox" });
    // 修复前：sourceMeta 无 productBatchListingFacts（旧任务）
    const verification = {
      schema: "product-research-hash.v1" as const, candidateId: source.productBatchItemId, runId: "run-yeti-control",
      contextHash: "a".repeat(64), inputHash: "b".repeat(64), resultHash: "c".repeat(64),
      workflowStatus: "completed" as const,
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
    };
    const { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } = await import("@/lib/productResearchRecord");
    const ver = createProductResearchVerification(verification);
    const researchRecord = createInitialProductResearchRecord({
      candidateId: source.productBatchItemId, runId: "run-yeti-control", contextHash: "a".repeat(64),
      researchHash: buildProductResearchHash({ ...ver, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
      workflowStatus: "completed" as const, reviewState: ver.reviewState,
      actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` }, now: NOW,
      decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: null },
    });
    const productFacts = source.productFacts;
    const resultJson = JSON.stringify({
      type: "workflow",
      productName: source.productName,
      status: "completed",
      researchRecord,
      researchVerification: ver,
      candidateAnalysisContext: {
        version: "candidate-analysis-context-v1",
        integrity: "verified_product_batch",
        facts: {
          capturedAt: NOW,
          originKind: "seller_sprite_product_batch",
          productBatchId: source.productBatchId,
          productBatchItemId: source.productBatchItemId,
          productName: source.productName,
          marketplace: source.marketplace,
          asin: source.asin,
          reportType: "category_current",
          query: null,
          category: source.category,
          researchPriority: source.researchPriority,
          evidenceStatus: source.evidenceStatus,
          provisionalDisposition: source.provisionalDisposition,
          evidenceHash: source.evidenceHash,
          itemHash: source.itemHash,
          sellerSpriteDisclaimerVersion: source.sellerSpriteDisclaimerVersion,
          productFacts,
        },
        assessment: { researchMode: "market_research_only", promotionEligible: false },
      },
      // 无 productBatchListingFacts —— 修复前行为
      sourceMeta: {
        source: "opportunity",
        candidateId: source.productBatchItemId,
        candidateSnapshot: { version: 1, id: source.productBatchItemId, name: source.productName, status: "worth_analyzing", capturedAt: NOW },
      },
      agentOutputSnapshot: null,
    });
    const taskId = "sandbox-yeti-control";
    seedTask(taskId, resultJson);
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = gate.candidate!;
    const confirmables = buildConfirmableCandidates(candidate.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const fields = new Set(listingEligible.map((c) => c.field));
    // 修复前：sourceMeta 无 productBatchListingFacts → adapter 不注入卖点 →
    // functional 候选（卖点提取）必须缺失，即使标题派生可能提供 material/capacity
    const functionalFields = ["functional_feature", "construction", "care", "usage"];
    const hasFunctional = functionalFields.some((f) => fields.has(f));
    expect(hasFunctional).toBe(false);
  });
});
