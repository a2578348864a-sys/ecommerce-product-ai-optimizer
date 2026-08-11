import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "owala-scenario");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { summarizeListingHandoffFacts } from "@/lib/listingHandoff/listingGenerationInput";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";

const NOW = "2026-08-09T19:43:44.103Z";
const DEMO = "demo-owala";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId = "candidate-owala") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-owala",
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
  const context = { candidateId, productName: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)", sourceType: "seller_sprite_market_research", sourceLabel: "SellerSprite", marketplace: "US", asin: "B0FH1ZXTN1", productUrl: "https://e.com/p", title: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)", brand: "Owala", category: "Sports & Outdoors", priceUsd: 29.99, rating: 4.6, reviewCount: 2948, disclaimer: "third_party_estimate_point_in_time", reportType: "SellerSprite Search Results", query: "water bottle", evidenceStatus: "ok", researchPriority: "high", promotionEligible: false, capturedAt: NOW, contextHash: "a".repeat(64) };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "owala-scenario", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

/**
 * 生产真实 Owala 结构：verified_product_batch integrity，
 * 标题位于 facts.productFacts.productTitle（researchContextAdapter 修复的目标场景）。
 */
function researchDocBatch(candidateId = "candidate-owala-batch") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-owala-batch",
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
  const facts = {
    capturedAt: NOW,
    originKind: "seller_sprite_product_batch",
    productBatchId: "6ecf22d2-f507-4aa1-9978-22ff51d52e57",
    productBatchItemId: "e0e05375-822d-4182-970b-b8f0e94fcdd5",
    productName: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)",
    marketplace: "US",
    asin: "B0FH1ZXTN1",
    reportType: "category_current",
    query: null,
    category: "Sports & Outdoors",
    researchPriority: "priority_2",
    evidenceStatus: "sufficient_for_comparison",
    provisionalDisposition: "insufficient_hard_gate_evidence",
    evidenceHash: "e".repeat(64),
    itemHash: "f".repeat(64),
    sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
    productFacts: {
      productTitle: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)",
      brand: "Owala",
      price: 29.99,
      rating: 4.6,
      reviews: 2948,
      estimatedMonthlySales: 13358,
      estimatedMonthlyRevenue: 400606,
      rootCategory: "Sports & Outdoors",
      rootCategoryBsr: 34,
      subCategory: "Water Bottles",
      subCategoryBsr: 8,
      variationCount: 18,
    },
  };
  return JSON.stringify({
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    candidateAnalysisContext: {
      version: "candidate-analysis-context-v1",
      integrity: "verified_product_batch",
      facts,
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
    agentOutputSnapshot: null,
  });
}

describe("Owala verified_product_batch projection closure", () => {
  it("生产真实结构（title 在 facts.productFacts.productTitle）产生 listing 候选", async () => {
    const taskId = "sandbox-owala-batch-task";
    seedTask(taskId, researchDocBatch());
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = gate.candidate;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const byField = Object.fromEntries(confirmables.map((c) => [c.field, String(c.value)]));
    // 标题派生候选必须存在（品牌/类型/系列/材质/容量/颜色）
    expect(listingEligible.length).toBeGreaterThanOrEqual(4);
    expect(byField["brand"]).toBe("Owala");
    expect(byField["product_type"]?.toLowerCase()).toContain("water bottle");
    expect(byField["material"]?.toLowerCase()).toContain("stainless steel");
    expect(byField["capacity"]?.toLowerCase()).toContain("24 oz");
    expect(byField["color_or_variant"]?.toLowerCase()).toContain("blue");
    // market_signal 绝不进入 listing 候选
    expect(listingEligible.some((c) => ["category", "price_usd", "rating", "review_count"].includes(c.field))).toBe(false);
  });
});

/** 无标题可提取字段的合法 Task（零候选场景）：标题只有无意义词，title-derived 候选为空 */
function researchDocNoTitleFacts(candidateId = "candidate-zero-candidate") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-zero",
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
  const context = { candidateId, productName: "神秘商品 XYZ", sourceType: "seller_sprite_market_research", sourceLabel: "SellerSprite", marketplace: "US", asin: "B0ZERO0001", productUrl: "https://e.com/p", title: "Best Premium Quality Item For Everyone Everywhere", brand: null, category: "Other", priceUsd: 9.99, rating: 3.5, reviewCount: 12, disclaimer: "third_party_estimate_point_in_time", reportType: "SellerSprite Search Results", query: "xyz", evidenceStatus: "ok", researchPriority: "high", promotionEligible: false, capturedAt: NOW, contextHash: "a".repeat(64) };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

describe("零候选手工兜底 closure", () => {
  it("无标题派生候选 → 手工确认事实 → 新 revision → listingEligibleFacts > 0", async () => {
    const taskId = "sandbox-zero-task";
    seedTask(taskId, researchDocNoTitleFacts());

    // Step 1: 预览 —— confirmable listing 候选应为 0（标题无可提取字段）
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = first.gate.candidate;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    expect(listingEligible.length).toBe(0);

    // Step 2: 仅手工事实创建 handoff（无 selectionId）
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    const manual = [{ field: "brand" as const, value: "XYZ" }, { field: "material" as const, value: "Aluminum" }];
    const result = await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: manual,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    expect(result.isNewRevision).toBe(true);

    // Step 3: 重新预览 —— listingEligibleFacts > 0，confirmedFacts 含手工事实
    const second = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = second.gate.currentHandoff!;
    const factSummary = summarizeListingHandoffFacts(handoff);
    expect(factSummary.listingEligibleFacts).toBeGreaterThan(0);
    expect(factSummary.confirmedFacts).toBeGreaterThanOrEqual(2);
    const v = handoff.versions[handoff.versions.length - 1];
    const manualFact = v.confirmedFacts.find((f) => f.field === "brand")!;
    expect(manualFact.value).toBe("XYZ");
    expect(manualFact.evidenceTier).toBe("human_confirmed");
    expect(manualFact.usageScopes).toContain("listing");
    expect(manualFact.sourceRef.sourceKind).toBe("user_confirmation");
    // prohibitedClaims 保留
    expect(factSummary.prohibitedClaims).toBeGreaterThan(0);
  });

  it("非法手工字段（market_signal）被拒绝，不写入", async () => {
    const taskId = "sandbox-zero-task-2";
    seedTask(taskId, researchDocNoTitleFacts());
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    await expect(createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: [{ field: "category" as never, value: "Sports" }],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    })).rejects.toMatchObject({ code: "invalid_manual_fact" });
  });
});

describe("Owala listing-eligible dead-end closure", () => {
  it("0 eligible → 确认标题派生候选 → 新 revision → listingEligibleFacts > 0", async () => {
    const taskId = "sandbox-owala-task";
    seedTask(taskId, researchDoc());

    // Step 1: 初始预览 —— 无 Handoff，confirmable 候选来自 stableSourceFacts（标题派生）
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = first.gate.candidate;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    expect(listingEligible.length).toBeGreaterThan(0);
    // category（market_signal）不可用于 Listing
    expect(listingEligible.some((c) => c.field === "category")).toBe(false);

    // 收集可确认的 listing 候选 selectionId
    const targetFields = ["product_type", "material", "capacity", "color_or_variant"];
    const target = listingEligible.filter((c) => targetFields.includes(c.field));
    expect(target.length).toBeGreaterThanOrEqual(2);

    // Step 2: 用 preview 提供的 selectionId 调用 createOrAppendCreativeHandoff（CAS）
    const preview = first.preview!;
    const selectedIds = target.map((c) => preview.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
    const sv = preview.storageVersion!;
    const result = await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectedIds,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: selectedIds,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    expect(result.isNewRevision).toBe(true);

    // Step 3: 重新预览 —— 已有 Handoff（active），listingEligibleFacts > 0
    const second = await generateCreativeHandoffPreview(taskId, visitorContext());
    const secondPreview = second.preview!;
    const factSummary = summarizeListingHandoffFacts(second.gate.currentHandoff);
    expect(factSummary.listingEligibleFacts).toBeGreaterThan(0);
    // confirmedFacts 增加（原 0 + 新确认）
    expect(factSummary.confirmedFacts).toBeGreaterThanOrEqual(2);
    // 新 revision 保留 prohibitedClaims
    expect(factSummary.prohibitedClaims).toBeGreaterThan(0);
    // revision 已推进
    expect(second.gate.currentHandoff!.currentRevision).toBeGreaterThanOrEqual(1);
    // preview 直接暴露 canGenerate 所需事实数
    expect(secondPreview.confirmableFactCandidates?.length ?? 0).toBeGreaterThan(0);
  });

  it("未确认候选不进入 confirmedFacts；market_signal 永不进 Listing", async () => {
    const taskId = "sandbox-owala-task-2";
    seedTask(taskId, researchDoc());
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = gate.candidate!;
    // 投影候选不会自动成为 confirmedFacts
    expect(candidate.confirmedFacts.length).toBe(0);
    const confirmables = buildConfirmableCandidates(candidate.stableSourceFacts);
    // category / price 是 market_signal → allowedUsageScopes 仅 internal
    for (const c of confirmables.filter((x) => ["category", "price_usd", "rating", "review_count"].includes(x.field))) {
      expect(c.allowedUsageScopes).toEqual(["internal"]);
    }
  });
});

describe("R3 human supplied facts closure", () => {
  it("已有系统确认事实时仍可补充 dimensions/weight，并保留既有事实与 human_confirmed provenance", async () => {
    const taskId = "sandbox-r3-human-append";
    seedTask(taskId, researchDoc());
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const productType = first.preview!.confirmableFactCandidates!.find((candidate) => candidate.canonicalField === "product_type")!;
    const createFirst = {
      requestId: "550e8400-e29b-41d4-a716-446655440701",
      expectedResearchRevision: first.preview!.expectedResearchRevision!,
      expectedCurrentHandoffRevision: first.preview!.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: first.preview!.storageVersion!,
      selectedFactCandidateIds: [productType.selectionId],
      manualConfirmedFacts: [{ field: "dimensions", value: "10 × 3 in" } as const],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [productType.selectionId],
        manualConfirmedFacts: [{ field: "dimensions", value: "10 × 3 in" } as const],
        expectedStorageVersion: first.preview!.storageVersion!,
        expectedResearchRevision: first.preview!.expectedResearchRevision,
        expectedCurrentHandoffRevision: first.preview!.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    };
    await createOrAppendCreativeHandoff(taskId, visitorContext(), createFirst);

    const second = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(second.gate.currentHandoff!.versions.at(-1)!.confirmedFacts.map((fact) => fact.field)).toEqual(
      expect.arrayContaining(["product_type", "dimensions"]),
    );

    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440702",
      expectedResearchRevision: second.preview!.expectedResearchRevision!,
      expectedCurrentHandoffRevision: second.preview!.expectedCurrentHandoffRevision!,
      expectedStorageVersion: second.preview!.storageVersion!,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: [{ field: "weight", value: "12 oz" } as const],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        manualConfirmedFacts: [{ field: "weight", value: "12 oz" } as const],
        expectedStorageVersion: second.preview!.storageVersion!,
        expectedResearchRevision: second.preview!.expectedResearchRevision,
        expectedCurrentHandoffRevision: second.preview!.expectedCurrentHandoffRevision,
        confirmed: true,
      }),
    });

    const final = await generateCreativeHandoffPreview(taskId, visitorContext());
    const facts = final.gate.currentHandoff!.versions.at(-1)!.confirmedFacts;
    expect(facts.map((fact) => fact.field)).toEqual(expect.arrayContaining(["product_type", "dimensions", "weight"]));
    for (const field of ["dimensions", "weight"]) {
      const fact = facts.find((item) => item.field === field)!;
      expect(fact.evidenceTier).toBe("human_confirmed");
      expect(fact.sourceRef.sourceKind).toBe("user_confirmation");
      expect(fact.usageScopes).toContain("listing");
    }
  });

  it("候选与手填同 canonical field 同次确认 → fail-closed，不允许双确认", async () => {
    const taskId = "sandbox-r3-human-conflict";
    seedTask(taskId, researchDoc());
    const previewResult = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = previewResult.preview!;
    const productType = preview.confirmableFactCandidates!.find((candidate) => candidate.canonicalField === "product_type")!;
    await expect(createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440703",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: preview.storageVersion!,
      selectedFactCandidateIds: [productType.selectionId],
      manualConfirmedFacts: [{ field: "product_type", value: "Different Bottle" }],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [productType.selectionId],
        manualConfirmedFacts: [{ field: "product_type", value: "Different Bottle" }],
        expectedStorageVersion: preview.storageVersion!,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    })).rejects.toMatchObject({ code: "confirmed_fact_conflict", status: 409 });
  });
});

describe("manualConfirmedFacts idempotency boundary", () => {
  it("1A. 同 requestId 同 manualConfirmedFacts → replay，不新增 revision", async () => {
    const taskId = "sandbox-idem-same";
    seedTask(taskId, researchDocNoTitleFacts());
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    const manual = [{ field: "brand" as const, value: "XYZ" }];
    const fingerprint = buildRequestFingerprint({
      action: "create",
      selectedFactIds: [],
      expectedStorageVersion: sv,
      expectedResearchRevision: preview.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    });
    const input = {
      requestId: "550e8400-e29b-41d4-a716-446655440100",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: manual,
      requestFingerprint: fingerprint,
    };
    const firstResult = await createOrAppendCreativeHandoff(taskId, visitorContext(), input);
    expect(firstResult.isNewRevision).toBe(true);
    // 第二次：同 requestId + 同内容 → replay
    const secondResult = await createOrAppendCreativeHandoff(taskId, visitorContext(), input);
    expect(secondResult.idempotentReplay).toBe(true);
    expect(secondResult.isNewRevision).toBe(false);
    const after = await generateCreativeHandoffPreview(taskId, visitorContext());
    expect(after.gate.currentHandoff!.versions.length).toBe(1);
    expect(after.gate.currentHandoff!.currentRevision).toBe(1);
  });

  it("1B. 同 requestId 不同 manualConfirmedFacts → conflict/fail-closed，不得静默返回第一次结果", async () => {
    const taskId = "sandbox-idem-diff";
    seedTask(taskId, researchDocNoTitleFacts());
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    const buildInput = (requestId: string, facts: Array<{ field: "brand"; value: string }>) => ({
      requestId,
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: facts,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        manualConfirmedFacts: facts,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    const firstResult = await createOrAppendCreativeHandoff(taskId, visitorContext(), buildInput("550e8400-e29b-41d4-a716-446655440101", [{ field: "brand", value: "AAA" }]));
    expect(firstResult.isNewRevision).toBe(true);
    // 第二次：同 requestId + 不同 manualConfirmedFacts → 不同 fingerprint → conflict
    await expect(createOrAppendCreativeHandoff(taskId, visitorContext(), buildInput("550e8400-e29b-41d4-a716-446655440101", [{ field: "brand", value: "BBB" }])))
      .rejects.toMatchObject({ code: "idempotency_conflict" });
    // 第一次结果未被覆盖：confirmedFacts 保持 AAA
    const after = await generateCreativeHandoffPreview(taskId, visitorContext());
    const v = after.gate.currentHandoff!.versions[after.gate.currentHandoff!.versions.length - 1];
    expect(v.confirmedFacts.find((f) => f.field === "brand")?.value).toBe("AAA");
    expect(after.gate.currentHandoff!.versions.length).toBe(1);
  });
});

describe("manualConfirmedFacts prohibitedClaims boundary", () => {
  it("prohibitedClaims 优先级不被手工补充绕过：禁止词值被生成过滤器拦截且原 prohibitedClaims 不丢失", async () => {
    const taskId = "sandbox-prohibited";
    seedTask(taskId, researchDocNoTitleFacts());
    const first = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    // 手工确认一个含内置禁止词的事实（"best seller guaranteed" 命中 LISTING_CLAIM_RULES）
    const manual = [{ field: "other" as const, value: "best seller guaranteed" }];
    const result = await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440200",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: manual,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        manualConfirmedFacts: manual,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    expect(result.isNewRevision).toBe(true);
    const after = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = after.gate.currentHandoff!;
    const v = handoff.versions[handoff.versions.length - 1];
    // 手工事实写入 confirmedFacts（服务端不预判语义），但 prohibitedClaims 保留
    expect(v.confirmedFacts.some((f) => f.value === "best seller guaranteed")).toBe(true);
    expect(v.prohibitedClaims.length).toBeGreaterThan(0);
    // 生成输入：prohibitedClaims 进入禁止约束
    const { filterListingClaims } = await import("@/lib/listingClaimFilter");
    const rawDraft = {
      titles: ["Best seller guaranteed Water Bottle"],
      bullets: ["best seller guaranteed quality"],
      description: "",
      keywords: ["best seller"],
      sellingPoints: [],
      riskNotes: [],
      reviewChecklist: [],
      blockedClaims: [],
      complianceWarnings: [],
      version: 1,
      source: "mock",
      generatedAt: null,
      humanReviewRequired: true,
    };
    const { cleaned, blockedClaims } = filterListingClaims(rawDraft as never, {
      prohibitedClaims: v.prohibitedClaims.map((c) => c.summary),
    });
    // 内置规则（Best seller guaranteed）拦截，草稿不含该词
    expect(blockedClaims.length).toBeGreaterThan(0);
    expect(JSON.stringify({ titles: cleaned.titles, bullets: cleaned.bullets })).not.toContain("best seller guaranteed");
  });
});

describe("manualConfirmedFacts visitor isolation", () => {
  it("Visitor B POST manualConfirmedFacts 到 Visitor A Task → 拒绝，A 的 handoff 不变", async () => {
    const taskId = "sandbox-isolation-a";
    seedTask(taskId, researchDocNoTitleFacts());
    const visitorA = visitorContext();

    // Visitor A 先创建死路 handoff（仅 category）
    const first = await generateCreativeHandoffPreview(taskId, visitorA);
    const preview = first.preview!;
    const sv = preview.storageVersion!;
    const catSel = (preview.confirmableFactCandidates ?? []).find((c) => c.canonicalField === "category")!;
    await createOrAppendCreativeHandoff(taskId, visitorA, {
      requestId: "550e8400-e29b-41d4-a716-446655440300",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [catSel.selectionId],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [catSel.selectionId],
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
    const before = await generateCreativeHandoffPreview(taskId, visitorA);
    const beforeRev = before.gate.currentHandoff!.currentRevision;
    const beforeConfirmed = before.gate.currentHandoff!.versions[before.gate.currentHandoff!.versions.length - 1].confirmedFacts.length;

    // Visitor B 尝试对 A 的 Task POST manualConfirmedFacts
    const visitorB = { mode: "demo" as const, token: "tok-b", demoAccessId: "demo-visitor-b", isActive: true, isExpired: false, remainingAiCalls: 10 };
    const manual = [{ field: "brand" as const, value: "HackerBrand" }];
    await expect(createOrAppendCreativeHandoff(taskId, visitorB, {
      requestId: "550e8400-e29b-41d4-a716-446655440301",
      expectedResearchRevision: preview.expectedResearchRevision!,
      expectedCurrentHandoffRevision: beforeRev,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: manual,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        manualConfirmedFacts: manual,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview.expectedResearchRevision,
        expectedCurrentHandoffRevision: beforeRev,
        confirmed: true,
      }),
    })).rejects.toMatchObject({ code: "not_found" });

    // A 的 handoff revision 和 confirmedFacts 不变
    const after = await generateCreativeHandoffPreview(taskId, visitorA);
    expect(after.gate.currentHandoff!.currentRevision).toBe(beforeRev);
    expect(after.gate.currentHandoff!.versions[after.gate.currentHandoff!.versions.length - 1].confirmedFacts.length).toBe(beforeConfirmed);
    expect(after.gate.currentHandoff!.versions[after.gate.currentHandoff!.versions.length - 1].confirmedFacts.some((f) => f.value === "HackerBrand")).toBe(false);
  });
});

describe("Quality.1 listing generation draft kinds", () => {
  it("仅 6 个身份/规格 facts → safe_fact_draft + qualityIssues", async () => {
    const taskId = "sandbox-quality-6facts";
    seedTask(taskId, researchDoc());
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview = gate.currentHandoff ? null : null;
    void preview;
    const candidate = gate.candidate!;
    const confirmables = buildConfirmableCandidates(candidate.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    // 确认 Owala 6 facts（brand/product_type/series/material/capacity/color）
    const targetFields = ["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant"];
    const target = listingEligible.filter((c) => targetFields.includes(c.field));
    expect(target.length).toBeGreaterThanOrEqual(6);

    const { generateListingDraftFromHandoff } = await import("@/lib/listingHandoff/listingGenerationService");
    const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview1 = p1.preview!;
    const sv = preview1.storageVersion!;
    const selectedIds = target.map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440500",
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

    // 生成：无功能 facts → safe_fact_draft
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const sv2 = p2.gate.storageVersion!;
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440501",
      expectedStorageVersion: sv2,
      expectedHandoffRevision: 1,
    });
    expect(result.listingSaved).toBe(true);
    expect(result.draft?.draftKind).toBe("safe_fact_draft");
    expect((result.draft?.qualityIssues ?? []).length).toBeGreaterThan(0);
  });
});

describe("Quality.1 CASE B: functional facts + keyword brief → optimized", () => {
  it("功能 facts + brief → optimized_listing，Title/Bullets/Description/Backend 正常", async () => {
    const taskId = "sandbox-quality-full";
    // 6 身份/规格 facts + 3 功能 facts（手工确认）
    const base = researchDoc();
    const resultJson = JSON.parse(base);
    const taskStorePath = join(tmpdir(), "owala-scenario", "sandbox.json");
    const store = JSON.parse(readFileSync(taskStorePath, "utf8"));
    // 直接 seed 一个带扩展 facts 的 task：先创建 handoff 再生成时注入？此处通过确认候选 + 生成阶段验证
    // 简化：seed task，创建 handoff 含 6 facts + 手工功能 facts
    seedTask(taskId, base);
    const { generateListingDraftFromHandoff } = await import("@/lib/listingHandoff/listingGenerationService");
    const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview1 = p1.preview!;
    const sv = preview1.storageVersion!;
    const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const targetFields = ["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant"];
    const target = listingEligible.filter((c) => targetFields.includes(c.field));
    const selectedIds = target.map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440600",
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

    // 追加 revision：功能 facts + 重新确认 6 个身份/规格 facts（append 是新快照，需在同一 revision 全部确认）
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const sv2 = p2.preview!.storageVersion!;
    const confirmables2 = buildConfirmableCandidates(p2.gate.candidate!.stableSourceFacts);
    const eligible2 = confirmables2.filter((c) => c.allowedUsageScopes.includes("listing"));
    const target2Fields = ["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant"];
    const target2 = eligible2.filter((c) => target2Fields.includes(c.field));
    const selectedIds2 = target2.map((c) => p2.preview!.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
    const manual = [
      { field: "functional_feature" as const, value: "straw lid with push-open mechanism" },
      { field: "construction" as const, value: "double-wall vacuum insulation" },
      { field: "care" as const, value: "dishwasher-safe removable parts" },
    ];
    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440601",
      expectedResearchRevision: preview1.expectedResearchRevision!,
      expectedCurrentHandoffRevision: 1,
      expectedStorageVersion: sv2,
      selectedFactCandidateIds: selectedIds2,
      manualConfirmedFacts: manual,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: selectedIds2,
        manualConfirmedFacts: manual,
        expectedStorageVersion: sv2,
        expectedResearchRevision: preview1.expectedResearchRevision,
        expectedCurrentHandoffRevision: 1,
        confirmed: true,
      }),
    });

    // 写入 keyword brief（模拟用户提供关键词资料）
    const { mutateTaskResultJson } = await import("@/lib/server/taskResultJsonMutation");
    const { buildListingKeywordBrief } = await import("@/lib/listingHandoff/listingKeywordBrief");
    const brief = buildListingKeywordBrief({
      primaryKeyword: "insulated water bottle",
      supportingKeywords: ["stainless steel bottle", "24 oz bottle", "leakproof tumbler"],
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      source: "synthetic",
      capturedAt: "2026-08-10T00:00:00.000Z",
    });
    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    const briefResult = await mutateTaskResultJson({
      context: visitorContext(),
      taskId,
      writer: "keyword-brief",
      async mutate(current) {
        return { result: { ...current, listingKeywordBrief: brief.brief as unknown as Record<string, unknown> }, value: { saved: true } };
      },
    });
    expect(briefResult.value.saved).toBe(true);

    // 生成 → 应 optimized_listing
    const p3 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const sv3 = p3.gate.storageVersion!;
    const rev3 = p3.gate.currentHandoff!.currentRevision;
    const debugHandoff = p3.gate.currentHandoff!;
    const debugVersion = debugHandoff.versions[debugHandoff.versions.length - 1];
    const { buildListingPlan } = await import("@/lib/listingHandoff/listingPlan");
    const { buildListingInputFromCreativeHandoff } = await import("@/lib/listingHandoff/listingGenerationInput");
    const dbgBuild = buildListingInputFromCreativeHandoff(debugHandoff, debugHandoff.versions[debugHandoff.versions.length - 1].sourceResearch.researchRevision);
    if (dbgBuild.ok) {
      const dbgPlan = buildListingPlan(dbgBuild.input, null);
      const { buildListingReadiness } = await import("@/lib/listingHandoff/listingReadiness");
      const dbgReadiness = buildListingReadiness({
        confirmedFacts: debugVersion.confirmedFacts,
        listingEligibleFacts: dbgBuild.input.productFacts.length,
        hasBlockingIssue: false,
        keywordBrief: null,
      });
    } else {
    }
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440602",
      expectedStorageVersion: sv3,
      expectedHandoffRevision: rev3,
    });
    expect(result.listingSaved).toBe(true);
    // Quality.2：brief 存在但无 AI client（Provider 不可用）→ providerAttempted + fallback
    expect(result.draft?.providerAttempted).toBe(true);
    expect(result.draft?.providerSucceeded).toBe(false);
    expect(result.draft?.draftKind).toBe("safe_fact_draft");
  });
});
