import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "v2214-closure");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { buildListingInputFromCreativeHandoff } from "@/lib/listingHandoff/listingGenerationInput";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { validateListingQuality } from "@/lib/listingHandoff/listingQualityValidator";
import { generateListingDraftFromHandoff } from "@/lib/listingHandoff/listingGenerationService";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import {
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
  PRODUCT_RESEARCH_HASH_SCHEMA,
} from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { setTaskLinkedAiListingClientForTests } from "@/lib/server/taskLinkedAiListing";

const NOW = "2026-08-11T14:00:00.000Z";
const DEMO = "demo-v2214";
const CANDIDATE = "candidate-v2214-brumate";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

/** BrüMate fixture（v2.2.14 Golden Case）：confirmedFacts 与生产任务一致 */
function buildBruteMateResultJson() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: CANDIDATE, runId: "run-brumate",
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
  return JSON.stringify({
    type: "workflow",
    productName: "BrüMate Rise 18oz Water Bottle with Covered Silicone Straw",
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
        productName: "BrüMate Rise 18oz Water Bottle with Covered Silicone Straw",
        marketplace: "US", asin: "B0GZYLV89B", reportType: "category_current", query: null,
        category: "Sports & Outdoors", researchPriority: "priority_1",
        evidenceStatus: "sufficient_for_comparison", provisionalDisposition: "provisional_score_only",
        evidenceHash: "e".repeat(64), itemHash: "f".repeat(64),
        sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
        productFacts: {
          productTitle: "BrüMate Rise 18oz Water Bottle with Covered Silicone Straw", brand: "BrüMate",
          price: 35.99, rating: 4.6, reviews: 1200, rootCategory: "Sports & Outdoors", subCategory: "Water Bottles",
        },
      },
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
    sourceMeta: {
      source: "opportunity", candidateId: CANDIDATE,
      candidateSnapshot: { version: 1, id: CANDIDATE, name: "BrüMate Rise 18oz Water Bottle with Covered Silicone Straw", status: "worth_analyzing", capturedAt: NOW },
      productBatchListingFacts: {
        version: "product-batch-listing-facts.v1", marketplace: "US", asin: "B0GZYLV89B", category: "Sports & Outdoors",
        productTitle: "BrüMate Rise 18oz Water Bottle with Covered Silicone Straw", brand: "BrüMate",
        productDetails: "Brand: BrüMate | Material: Silicone | Bottle Type: Water Bottle | Color: red | Capacity: 18 fluid ounces",
        productBulletPoints: "LEAKPROOF DESIGN WITH COVERED, SOFTSIP STRAW: Our leakproof, SoftSip silicone straw makes every sip feel like a luxury",
      },
    },
    researchMode: "market_research_only",
    promotionEligible: false,
    agentOutputSnapshot: null,
  });
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "v2214-closure", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

async function confirmBruteMateHandoff(taskId: string) {
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview = p1.preview!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const listingEligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const fields = [...new Set(listingEligible.map((c) => c.field))];
  const selectedIds = fields.map((f) => preview.confirmableFactCandidates!.find((pc) => pc.canonicalField === f)!.selectionId);
  const sv = preview.storageVersion!;
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655440700",
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
}

describe("v2.2.14 BrüMate Golden Case", () => {
  it("listingEligibleFacts=7, identity=3, specification=3, functional>=1, copyReady=true", async () => {
    const taskId = "sandbox_task_v2214_golden";
    seedTask(taskId, buildBruteMateResultJson());
    await confirmBruteMateHandoff(taskId);
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = p2.gate.currentHandoff!;
    const v = handoff.versions[handoff.versions.length - 1];
    const build = buildListingInputFromCreativeHandoff(handoff, v.sourceResearch.researchRevision);
    expect(build.ok).toBe(true);
    if (!build.ok) return;
    const readiness = buildListingReadiness({
      confirmedFacts: v.confirmedFacts,
      listingEligibleFacts: build.input.productFacts.length,
      hasBlockingIssue: false,
      keywordBrief: null,
    });
    expect(readiness.copyReady).toBe(true);
    expect(readiness.counts.identity).toBe(3);
    expect(readiness.counts.specification).toBe(3);
    expect(readiness.counts.functional).toBeGreaterThanOrEqual(1);
    expect(readiness.counts.listingEligible).toBe(7);
    // Plan 消费 functional + material + capacity + color
    const plan = buildListingPlan(build.input, null);
    expect(plan.planQuality).toBe("optimized");
    const boundFacts = plan.bulletPlans.flatMap((b) => b.featureFactIds);
    expect(boundFacts).toContain("functional_feature");
    expect(boundFacts).toContain("material");
    expect(boundFacts).toContain("capacity");
    // 优化草稿：3 条 bullet 且 quality ok（不再退化为属性拼接）
    const optimized = composeOptimizedListingDraft(build.input, plan, null);
    expect(optimized.bullets.length).toBeGreaterThanOrEqual(3);
    const q = validateListingQuality({
      titles: optimized.titles, bullets: optimized.bullets, description: optimized.description,
      backendSearchTerms: optimized.backendSearchTerms, planQuality: "optimized",
    });
    expect(q.ok).toBe(true);
    expect(q.blockingIssues).toEqual([]);
    // Description 不再重复 Title（应含功能句，非仅属性拼接）
    expect(optimized.description).not.toBe(`${optimized.titles[0]}。`);
  });
});

describe("v2.2.14 无 Keyword Brief AI 路径", () => {
  it("copyReady=true 无 brief → injected Mock AI 被调用 1 次，providerAttempted=true，backend terms 为空", async () => {
    const taskId = "sandbox_task_v2214_nokeyword";
    seedTask(taskId, buildBruteMateResultJson());
    await confirmBruteMateHandoff(taskId);
    let calls = 0;
    setTaskLinkedAiListingClientForTests(async (input) => {
      calls += 1;
      // 无 brief：prompt 必须含 KEYWORD_OPTIMIZATION = DISABLED
      expect(input.keywordBrief).toBeNull();
      return {
        title: "BrüMate Rise 18oz Silicone Water Bottle with Covered Straw",
        bullets: [
          "Leakproof SoftSip straw keeps every sip easy, comfortable for daily hydration.",
          "Silicone construction and 18oz capacity, practical size for on-the-go use.",
          "red color option, matches your style preference.",
        ],
        description: "BrüMate Rise 18oz water bottle pairs a covered SoftSip straw with silicone construction for everyday hydration. The leakproof design suits commuting and travel. Available in red.",
        backendSearchTerms: ["self-invented keyword"], // AI 不得自造关键词，服务端必须丢弃
        usedFactIds: ["functional_feature", "material", "capacity", "color_or_variant"],
        humanReviewRequired: true,
      };
    });
    try {
      const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
      const sv2 = p2.gate.storageVersion!;
      // 阶段B 诊断：真实 pipeline 的 deterministic draft claim 验证
      {
        const { buildDeterministicListingPackDraft } = await import("@/lib/listingHandoff/listingComposition");
        const { verifyListingClaims, listingClaimsHaveEvidence } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
        const { writeFileSync } = await import("node:fs");
        const { buildListingInputFromCreativeHandoff } = await import("@/lib/listingHandoff/listingGenerationInput");
        const pDbg = await generateCreativeHandoffPreview(taskId, visitorContext());
        const hDbg = pDbg.gate.currentHandoff!;
        const vDbg = hDbg.versions[hDbg.versions.length - 1];
        const bDbg = buildListingInputFromCreativeHandoff(hDbg, vDbg.sourceResearch.researchRevision);
        if (bDbg.ok) {
          const draftDbg = buildDeterministicListingPackDraft(bDbg.input, NOW);
          const evDbg = verifyListingClaims(draftDbg, bDbg.input);
          const { buildListingClaimEvidenceIndex } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
          const idxDbg = buildListingClaimEvidenceIndex(bDbg.input);
          const funcValDbg = bDbg.input.productFacts.find(f => f.field === "functional_feature")?.value ?? "";
          const segDbg = draftDbg.description.split(/[.;。\n]+/)[1]?.trim() ?? "";
          const compact = (x: string) => x.normalize("NFC").replace(/\s+/g, "").toLocaleLowerCase();
          const restDbg = compact(segDbg).replace(compact(idxDbg.find(e => e.canonicalField === "functional_feature")?.normalizedValue ?? ""), "");
          writeFileSync("C:/Users/a2578/AppData/Local/Temp/claims6.json", JSON.stringify({
            has: listingClaimsHaveEvidence(evDbg),
            unsupported: (evDbg as any).unsupportedClaims?.slice(0, 10),
            segLen: segDbg.length,
            idxLen: (idxDbg.find(e => e.canonicalField === "functional_feature")?.normalizedValue ?? "").length,
            restAfterReplace: restDbg.slice(0, 100),
            segFirst80: segDbg.slice(0, 80),
            idxFirst80: (idxDbg.find(e => e.canonicalField === "functional_feature")?.normalizedValue ?? "").slice(0, 80),
            desc: draftDbg.description,
          }, null, 1));
        }
      }
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655440701",
        expectedStorageVersion: sv2,
        expectedHandoffRevision: 1,
      });
      expect(calls).toBe(1);
      expect(result.listingSaved).toBe(true);
      expect(result.draft?.draftKind).toBe("ai_optimized_listing");
      expect(result.draft?.providerAttempted).toBe(true);
      expect(result.draft?.providerSucceeded).toBe(true);
      // AI 自造 backend terms 被服务端丢弃
      expect(result.draft?.backendSearchTerms).toBeUndefined();
      // keywordReady 保持 false（无 brief）
      expect(result.draft?.riskNotes?.join(" ")).toContain("未进行关键词优化");
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  });
});

describe("v2.2.14 Quality 对抗", () => {
  it("2 条高质量优化 bullet → advisory 而非 blocking（structured 保留）", () => {
    const q = validateListingQuality({
      titles: ["BrüMate Rise 18oz Silicone Water Bottle"],
      bullets: [
        "Leakproof SoftSip straw makes sipping easy, comfortable for daily hydration.",
        "Silicone construction with 18oz capacity, practical for commuting.",
      ],
      description: "BrüMate Rise 18oz bottle pairs a covered SoftSip straw with silicone construction for everyday hydration.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(q.ok).toBe(true);
    expect(q.blockingIssues).toEqual([]);
    expect(q.advisories.some((a) => a.target === "bullets" && a.code === "count")).toBe(true);
  });

  it("3-5 条正常 bullet → PASS 无 count 提示", () => {
    const q = validateListingQuality({
      titles: ["BrüMate Rise 18oz Silicone Water Bottle"],
      bullets: [
        "Leakproof SoftSip straw makes sipping easy.",
        "Silicone construction is comfortable to hold.",
        "18oz capacity suits daily commuting.",
      ],
      description: "BrüMate Rise 18oz bottle pairs a covered SoftSip straw with silicone construction for everyday hydration.",
      backendSearchTerms: [],
      planQuality: "optimized",
    });
    expect(q.ok).toBe(true);
    expect(q.advisories.some((a) => a.code === "count")).toBe(false);
  });

  it("0 条 bullet → 仍 blocking（安全策略保持）", () => {
    const q = validateListingQuality({
      titles: ["Test Bottle"], bullets: [], description: "A bottle.",
      backendSearchTerms: [], planQuality: "optimized",
    });
    expect(q.ok).toBe(false);
  });

  it("Title >75 → blocking 保持", () => {
    const q = validateListingQuality({
      titles: ["X".repeat(80)], bullets: ["A bullet with enough words here."], description: "A short description.",
      backendSearchTerms: [], planQuality: "optimized",
    });
    expect(q.ok).toBe(false);
    expect(q.blockingIssues.some((i) => i.code === "too_long")).toBe(true);
  });

  it("重复 bullet → blocking 保持", () => {
    const q = validateListingQuality({
      titles: ["Test Bottle"],
      bullets: ["Silicone construction with 18oz capacity.", "Silicone construction with 18oz capacity."],
      description: "A bottle made of silicone.",
      backendSearchTerms: [], planQuality: "optimized",
    });
    expect(q.ok).toBe(false);
    expect(q.blockingIssues.some((i) => i.code === "bullet_duplicate")).toBe(true);
  });
});
