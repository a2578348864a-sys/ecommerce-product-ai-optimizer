import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "owala-facts-closure");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { buildListingInputFromCreativeHandoff, summarizeListingHandoffFacts } from "@/lib/listingHandoff/listingGenerationInput";

const NOW = "2026-08-11T10:00:00.000Z";
const DEMO = "demo-owala-facts";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

/**
 * 真实 ProductBatch 主链结构：
 * - candidateAnalysisContext: verified_product_batch（facts.productFacts 无卖点/详细参数）
 * - sourceMeta.productBatchListingFacts: save-task 从 normalizedSnapshotJson.extraRaw 捞取的
 *   productDetails（"Brand: Owala | Material: Stainless Steel | ..."）+ productBulletPoints（卖点）
 * 这验证 researchContextAdapter verified_product_batch 分支把 listingFacts 接入 sellerSpriteSourceRaw。
 */
function researchDocBatchWithListingFacts(candidateId = "candidate-owala-batch-facts") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-owala-batch-facts",
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
  // 真实 XLSX 详细参数/卖点（与 sellerSpriteFactProjection.test.ts 的 Owala fixture 同构，来自真实文件）
  const listingFacts = {
    version: "product-batch-listing-facts.v1",
    marketplace: "US",
    asin: "B0FH1ZXTN1",
    parentAsin: null,
    category: "Sports & Outdoors",
    productTitle: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)",
    brand: "Owala",
    price: 29.99,
    rating: 4.6,
    reviews: 2948,
    rootCategory: "Sports & Outdoors",
    subCategory: "Water Bottles",
    productDetails: "Brand: Owala | Material: Stainless Steel | Bottle Type: Water Bottle | Color: Blue Jay | Capacity: 24 fluid ounces",
    productBulletPoints: "24-ounce insulated stainless-steel water bottle with a FreeSip spout and push-button lid with lock\nPatented FreeSip spout designed for either sipping upright through the built-in straw\nDouble-wall insulation keeps drinks cold for up to 24 hours",
    acKeywords: "insulated water bottle; leakproof tumbler",
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
    sourceMeta: {
      source: "opportunity",
      candidateId,
      candidateSnapshot: {
        version: 1,
        id: candidateId,
        name: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)",
        status: "worth_analyzing",
        capturedAt: NOW,
      },
      productBatchListingFacts: listingFacts,
    },
    agentOutputSnapshot: null,
  });
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "owala-facts-closure", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

describe("ProductBatch 主链商品事实补全 closure（真实 Owala 数据链）", () => {
  it("1. productBatch + productBatchListingFacts → preview 出现 material/capacity/color/functional 候选", async () => {
    const taskId = "sandbox-owala-facts-task";
    seedTask(taskId, researchDocBatchWithListingFacts());
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = gate.candidate;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const byField = Object.fromEntries(confirmables.map((c) => [c.field, String(c.value)]));
    // 结构化字段：material/capacity/color 来自 productDetails 详细参数
    expect(byField["material"]?.toLowerCase()).toContain("stainless steel");
    expect(byField["capacity"]?.toLowerCase()).toContain("24 fluid ounces");
    expect(byField["color_or_variant"]?.toLowerCase()).toContain("blue jay");
    expect(byField["brand"]).toBe("Owala");
    // functional 候选来自 productBulletPoints 卖点（functional/construction/care 角色）
    const functionalFields = ["functional_feature", "construction", "care", "usage"];
    const functional = confirmables.filter((c) => functionalFields.includes(c.field));
    expect(functional.length).toBeGreaterThanOrEqual(1);
    // market_signal 绝不进入 listing 候选
    expect(listingEligible.some((c) => ["category", "price_usd", "rating", "review_count"].includes(c.field))).toBe(false);
  });

  it("2. 确认候选 → copyReady=true，Listing 不再因缺规格/功能降级", async () => {
    const taskId = "sandbox-owala-facts-task-2";
    seedTask(taskId, researchDocBatchWithListingFacts());
    const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview1 = p1.preview!;
    const sv = preview1.storageVersion!;
    const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
    const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    // 确认所有可确认的 listing 事实（标题派生 + 结构化 + 卖点功能候选）。
    // 卖点提取的 role 可能是 functional_feature/construction/care 等，不预设字段名，
    // 全部选入（同 field 去重，避免标题与结构化重复）。
    const selectedFields = [...new Set(listingEligible.map((c) => c.field))];
    expect(selectedFields.length).toBeGreaterThanOrEqual(4);
    const selectedIds = selectedFields.map((f) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
    const result = await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440900",
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
    expect(result.isNewRevision).toBe(true);

    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = p2.gate.currentHandoff!;
    const v = handoff.versions[handoff.versions.length - 1];
    const factSummary = summarizeListingHandoffFacts(handoff);
    // 规格 + 功能事实已确认（spec ≥2 + functional ≥1）
    const listingInput = buildListingInputFromCreativeHandoff(handoff, v.sourceResearch.researchRevision);
    expect(listingInput.ok).toBe(true);
    if (!listingInput.ok) return;
    const readiness = buildListingReadiness({
      confirmedFacts: v.confirmedFacts,
      listingEligibleFacts: listingInput.input.productFacts.length,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(factSummary.listingEligibleFacts).toBeGreaterThan(0);
    expect(readiness.copyReady).toBe(true);
    // copyReady 后唯一遗留缺失是关键词资料（未提供 brief），
    // 不再因缺规格/功能事实而降级——这正是本修复的目标。
    expect(readiness.counts.identity).toBeGreaterThanOrEqual(1);
    expect(readiness.counts.specification).toBeGreaterThanOrEqual(2);
    expect(readiness.counts.functional).toBeGreaterThanOrEqual(1);
    expect(readiness.missingForQuality.some((m) => m.includes("规格"))).toBe(false);
    expect(readiness.missingForQuality.some((m) => m.includes("功能/使用"))).toBe(false);
  });

  it("3. 无 productBatchListingFacts 的旧任务不受影响（向后兼容）", async () => {
    const taskId = "sandbox-owala-facts-legacy";
    const base = researchDocBatchWithListingFacts();
    const parsed = JSON.parse(base);
    delete parsed.sourceMeta;
    seedTask(taskId, JSON.stringify(parsed));
    const { gate } = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidate = gate.candidate;
    expect(candidate).toBeTruthy();
    const confirmables = buildConfirmableCandidates(candidate!.stableSourceFacts);
    // 无 productBatchListingFacts：material/capacity/color 只能来自标题派生
    // （Owala 标题含 "Stainless Steel"/"24 oz"/"Blue"，故可能仍有候选），
    // 但 functional（卖点）候选必须不存在——因为卖点只在 productBulletPoints 中。
    const functionalFields = ["functional_feature", "construction", "care", "usage"];
    const functional = confirmables.filter((c) => functionalFields.includes(c.field));
    expect(functional.length).toBe(0);
  });
});
