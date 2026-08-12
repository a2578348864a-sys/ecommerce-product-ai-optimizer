import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "yeti-golden");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://api.deepseek.com";
  process.env.DEEPSEEK_MODEL = "deepseek-chat";
});

import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { generateListingDraftFromHandoff } from "@/lib/listingHandoff/listingGenerationService";
import { setTaskLinkedAiListingClientForTests, type TaskLinkedAiListingClient } from "@/lib/server/taskLinkedAiListing";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";
import { projectSellerSpriteFactCandidates } from "@/lib/server/sellerSpriteFactProjection";

const NOW = "2026-08-10T00:00:00.000Z";
const DEMO = "demo-yeti-golden";

// 真实 XLSX 20260807 YETI B0GZRLKJT8 数据
const YETI_DETAIL = "Brand: YETI | Material: Stainless Steel | Bottle Type: Insulated Bottle | Color: Mist/Pink/Grasshopper | Capacity: 12 ounces";
const YETI_SKU = "Color: Mist/Pink/Grasshopper";
const YETI_SELLING = "YETI kids need a bottle that can keep up. Introducing Rambler Jr. - a small-and-mighty kids bottle over-engineered for your little wild ones\nDishwasher Safe - As a well-deserved convenience, we ensure the bottle and lid are dishwasher safe.\n18/8 stainless steel - built to take all dents and drops, and BPA-free.\nNo sweat design - keeps hands dry.";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: "candidate-yeti-golden", runId: "run-yeti-golden",
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
  // 真实 YETI 商品 context（含 SellerSprite 原始列）
  const context = {
    candidateId: "candidate-yeti-golden",
    productName: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0GZRLKJT8",
    productUrl: "https://www.amazon.com/dp/B0GZRLKJT8?psc=1",
    title: "YETI Rambler Jr. 12 oz Kids Bottle, with Straw Cap",
    brand: "YETI",
    category: "Sports & Outdoors",
    priceUsd: 29.99,
    rating: 4.8,
    reviewCount: 1000,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "kids bottle",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: NOW,
    contextHash: "a".repeat(64),
    // SellerSprite Source Fact Projection 原始列（真实 XLSX 值）
    sellerSpriteSourceRaw: {
      detailAttributes: YETI_DETAIL,
      sku: YETI_SKU,
      sellingPoints: YETI_SELLING,
    },
  };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function seedTask(taskId: string) {
  const storePath = join(tmpdir(), "yeti-golden", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "YETI Rambler Jr. 12 oz Kids Bottle", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson: researchDoc(), productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

async function setupHandoff(taskId: string) {
  seedTask(taskId);
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview1 = p1.preview!;
  const sv = preview1.storageVersion!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  // 身份：title-derived 的 brand/product_type（Bottle）为既有候选
  const brand = eligible.find((c) => c.field === "brand" && String(c.value) === "YETI");
  const productType = eligible.find((c) => c.field === "product_type" && String(c.value) === "Bottle");
  // 真实 XLSX 投影：material + color 是 projection 独有的唯一 field 候选
  const material = eligible.find((c) => c.field === "material");
  const color = eligible.find((c) => c.field === "color_or_variant");
  const selected = [brand, productType, material, color].filter((c) => c !== undefined);
  const selectedIds = selected
    .map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c!.field && String(pc.displayValue) === String(c.value))!.selectionId);
  // 功能事实：用手写确认值（用户「我已核实」语义；短值避免投影句子的标点/长度边界）
  const functionalManual = [{ field: "care" as const, value: "dishwasher-safe bottle and lid" }];
  const fingerprint = buildRequestFingerprint({
    action: "create",
    selectedFactIds: selectedIds,
    manualConfirmedFacts: functionalManual,
    expectedStorageVersion: sv,
    expectedResearchRevision: preview1.expectedResearchRevision,
    expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
    confirmed: true,
  });
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655441500",
    expectedResearchRevision: preview1.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: selectedIds,
    manualConfirmedFacts: functionalManual,
    requestFingerprint: fingerprint,
  });
  return { material, color };
}

describe("SellerSprite Source Fact Projection（真实 YETI B0GZRLKJT8）", () => {
  it("投影：真实 XLSX 详细参数/SKU/卖点 → material/color/product_type/capacity + 功能候选", () => {
    const { structured, content } = projectSellerSpriteFactCandidates({
      detailAttributesRaw: YETI_DETAIL,
      skuRaw: YETI_SKU,
      sellingPointsRaw: YETI_SELLING,
    });
    const byField = Object.fromEntries(structured.map((c) => [c.field, c.value]));
    expect(byField.material).toBe("Stainless Steel");
    expect(byField.color_or_variant).toBe("Mist/Pink/Grasshopper");
    expect(byField.product_type).toBe("Insulated Bottle");
    expect(byField.capacity).toBe("12 ounces");
    expect(content.length).toBeGreaterThanOrEqual(3);
  });

  it("Golden：投影候选出现在 preview 确认候选（material/color 可选），确认后 Readiness specification ≥2", async () => {
    const taskId = "sandbox-yeti-golden-1";
    const { material, color } = await setupHandoff(taskId);
    expect(material).toBeDefined();
    expect(color).toBeDefined();

    // preview 二次：确认后 readiness 应显示 specification ≥2
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff2 = p2.gate.currentHandoff;
    const lastVersion = handoff2!.versions[handoff2!.versions.length - 1];
    const confirmedFields = lastVersion.confirmedFacts.map((f) => f.field);
    expect(confirmedFields).toContain("material");
    expect(confirmedFields).toContain("color_or_variant");
    // 注：projection 的 product_type/capacity 与 title-derived 同 field 候选 value 不一致时
    // 确认层 fail-closed（value_mismatch）→ 不强制本测试选择；material/color 为投影独有字段。
  });
});

describe("YETI Golden Case 全链（候选 → 确认 → Readiness → Brief → Mock AI）", () => {
  async function fullChain() {
    const taskId = "sandbox-yeti-golden-2";
    await setupHandoff(taskId);

    // synthetic Keyword Brief
    const brief = buildListingKeywordBrief({
      primaryKeyword: "kids insulated water bottle",
      supportingKeywords: ["12 oz kids bottle", "yeti kids bottle"],
      backendSearchTerms: ["insulated kids bottle", "straw cap bottle", "kids water bottle"],
      source: "synthetic",
      capturedAt: NOW,
    });
    if (!brief.ok) throw new Error("brief failed");
    await mutateTaskResultJson({
      context: visitorContext(),
      taskId,
      writer: "keyword-brief",
      async mutate(current) {
        return { result: { ...current, listingKeywordBrief: brief.brief as unknown as Record<string, unknown> }, value: { saved: true } };
      },
    });

    // Mock AI（55-char title + 合法 facts，R3 Claim Evidence 只允许已确认事实词）
    setTaskLinkedAiListingClientForTests((async () => ({
      title: "YETI Kids Bottle, Stainless Steel, 12 ounces",
      bullets: [
        "YETI kids bottle, dishwasher-safe bottle and lid.",
        "Stainless Steel kids bottle, dishwasher-safe bottle and lid.",
        "12 ounces capacity, Stainless Steel material.",
        "Stainless Steel material, dishwasher-safe bottle and lid.",
      ],
      description: "The YETI kids bottle combines Stainless Steel material with dishwasher-safe bottle and lid. The 12 ounces capacity makes it a practical choice.",
      backendSearchTerms: ["kids water bottle"],
      usedFactIds: ["brand", "product_type", "material", "color_or_variant", "care"],
      humanReviewRequired: true,
    })) as TaskLinkedAiListingClient);

    const preview = await generateCreativeHandoffPreview(taskId, visitorContext());
    const readiness = await (async () => {
      // 与生产 buildListingInputFromCreativeHandoff 同源：confirmedFacts（listing 用途）计算角色
      const confirmed = preview.gate.currentHandoff!.versions[preview.gate.currentHandoff!.versions.length - 1].confirmedFacts;
      const listingFacts = confirmed.filter((f) => f.usageScopes.includes("listing"));
      const identity = listingFacts.filter((f) => ["brand", "product_type", "series_or_model"].includes(f.field)).length;
      const specification = listingFacts.filter((f) => ["material", "capacity", "color_or_variant", "quantity_or_pack_size"].includes(f.field)).length;
      const functional = listingFacts.filter((f) => !["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant", "quantity_or_pack_size"].includes(f.field)).length;
      const { buildListingReadiness } = await import("@/lib/listingHandoff/listingReadiness");
      const { parseListingKeywordBrief } = await import("@/lib/listingHandoff/listingKeywordBrief");
      const taskRow = (JSON.parse(require("node:fs").readFileSync(join(tmpdir(), "yeti-golden", "sandbox.json"), "utf8")).tasks as Array<{ id: string; resultJson: string }>).find((t) => t.id === taskId);
      return buildListingReadiness({
        confirmedFacts: confirmed,
        listingEligibleFacts: identity + specification + functional,
        hasBlockingIssue: false,
        keywordBrief: parseListingKeywordBrief((taskRow ? JSON.parse(taskRow.resultJson).listingKeywordBrief : null) as never),
      });
    })();
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441502",
      expectedStorageVersion: preview.gate.storageVersion!,
      expectedHandoffRevision: preview.gate.currentHandoff!.currentRevision,
    });
    console.log("YETI_DRAFT:", JSON.stringify({ kind: result.draft?.draftKind, providerSucceeded: result.draft?.providerSucceeded, fallback: result.draft?.fallbackApplied, reason: result.draft?.fallbackReason, issues: result.draft?.qualityIssues, backend: result.draft?.backendSearchTerms }));
    return { result, readiness };
  }

  it("claimSafe/copyReady/keywordReady → Mock Provider 被调用，R3 后结构化草稿降级", async () => {
    const { result, readiness } = await fullChain();
    expect(readiness.claimSafe).toBe(true);
    expect(readiness.copyReady).toBe(true);
    expect(readiness.keywordReady).toBe(true);
    // R3：AI 输出含未确认词（如 "kids insulated"）时，Claim Evidence 拒绝 → structured 降级
    expect(result.draft?.draftKind).toBe("structured_listing_draft");
    expect(result.draft?.providerAttempted).toBe(true);
    expect(result.draft?.providerSucceeded).toBe(false);
    expect(result.draft?.fallbackApplied).toBe(true);
  }, 30_000);
});
