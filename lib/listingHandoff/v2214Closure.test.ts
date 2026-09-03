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
import type { AiListingPackDraft } from "@/lib/aiListingDraft";
import { buildListingReadiness } from "@/lib/listingHandoff/listingReadiness";
import { buildListingPlan } from "@/lib/listingHandoff/listingPlan";
import { composeOptimizedListingDraft } from "@/lib/listingHandoff/listingComposition";
import { validateListingQuality } from "@/lib/listingHandoff/listingQualityValidator";
import { validateRuntimeQualityContract } from "@/lib/listingHandoff/listingRuntimeSkill";
import { listingClaimsHaveEvidence, verifyListingClaims } from "@/lib/listingHandoff/listingClaimEvidenceResolver";
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
import { setTaskLinkedAiListingClientForTests, type TaskLinkedAiListingClient } from "@/lib/server/taskLinkedAiListing";

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
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" },
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
        productBulletPoints: "Our SoftSip covered straw system provides comfortable sipping every day for busy routines",
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


/** P1-2：BrüMate 夹具已确认事实（与 buildBruteMateResultJson → confirmation 的 listing facts 一致） */
const BRUMATE_CONFIRMED_FACTS: Array<{ field: string; value: string }> = [
  { field: "brand", value: "BrüMate" },
  { field: "product_type", value: "Water Bottle" },
  { field: "series_or_model", value: "Rise" },
  { field: "material", value: "Silicone" },
  { field: "capacity", value: "18oz" },
  { field: "color_or_variant", value: "red" },
  { field: "functional_feature", value: "Our SoftSip covered straw system provides comfortable sipping every day for busy routines" },
];

/**
 * P1-2：以服务端同款 Runtime 合同验证 AI 成功输出（真实合同，非本地复制判定）。
 * 断言：合同 ok（输出 issues）、每条 bullet 至少锚定一个已确认事实值、标题品牌单次、
 *       五点 3-5 条 × 8-30 词、无未确认绝对/认证/时长/Leakproof。
 */
function assertAiSuccessMeetsRuntimeContract(draft: {
  titles: string[];
  bullets: string[];
  description: string;
  keywords: string[];
}): void {
  const contract = validateRuntimeQualityContract({
    title: draft.titles[0] ?? "",
    bullets: draft.bullets,
    description: draft.description,
    keywords: draft.keywords,
    facts: BRUMATE_CONFIRMED_FACTS.map((f) => ({ factId: f.field, field: f.field, label: f.field, value: f.value })),
    usedFactIds: BRUMATE_CONFIRMED_FACTS.map((f) => f.field),
  });
  expect(contract.ok, JSON.stringify(contract.issues)).toBe(true);
  // 每条 bullet 至少命中一个已确认事实值（值内嵌/完整复述均命中；字段值大小写不敏感匹配）
  const factValues = BRUMATE_CONFIRMED_FACTS.map((f) => f.value.toLocaleLowerCase()).filter((v) => v.length >= 3);
  for (const b of draft.bullets) {
    const lower = b.toLocaleLowerCase();
    expect(
      factValues.some((v) => lower.includes(v)),
      "bullet 未锚定已确认事实值: " + b,
    ).toBe(true);
    const wc = b.trim().split(/\s+/).filter(Boolean).length;
    expect(wc).toBeGreaterThanOrEqual(8);
    expect(wc).toBeLessThanOrEqual(30);
    expect(b).not.toMatch(/Leakproof/i);
    expect(b).not.toMatch(/hours|hrs|keeps.*cold|keeps.*warm|BPA[- ]?free|FDA|CE[\s]?cert|guaranteed|100%/i);
  }
  expect(draft.bullets.length).toBeGreaterThanOrEqual(3);
  expect(draft.bullets.length).toBeLessThanOrEqual(5);
  // 标题品牌单次
  const brand = "BrüMate";
  const brandCount = draft.titles.join(" ").split(brand).length - 1;
  expect(brandCount, "标题品牌词应只出现一次").toBeLessThanOrEqual(1);
}

/** 本地 Plan-aware 自然句夹具（禁跨文件 import）：
 * - bullet 数精确 = input.plan.bulletPlans.length；
 * - 第 i 条锚定 plan[i].featureFactIds[0] 的事实值，用自然受控谓语句（8-30 词、无模板尾）；
 * - usedFactIds 只记录正文实际采用的事实；description 两句与 bullets 不同形。
 */
function v2214ValidAiClient(): TaskLinkedAiListingClient {
  return async (input) => {
    const plans = Array.isArray(input.plan?.bulletPlans) ? input.plan.bulletPlans : [];
    const facts = (input.facts ?? []).filter((f) => typeof f?.value === "string" && f.value.trim().length > 0);
    const byId = new Map<string, string>();
    for (const f of facts) byId.set(String(f.factId ?? ""), String(f.value ?? "").trim());
    const FRAME: Record<string, (v: string) => string> = {
      material: (v) => "The bottle body is constructed with " + v.toLowerCase() + " for flexible handling.",
      capacity: (v) => "This compact bottle holds " + v + " of water when filled completely.",
      color_or_variant: (v) => "The exterior comes in a distinctive " + v.toLowerCase() + " shade for personal style.",
      care: (v) => "For maintenance, rinse the components thoroughly and allow them to dry.",
      functional_feature: (v) => v.replace(/\.*$/, "") + " for convenience.",
      operation: (v) => "The bottle mechanism functions smoothly during everyday hydration.",
      usage: (v) => "The bottle is suitable for hydration during travel or work.",
      included_components: (v) => "This package includes the original drinking straw accessory.",
      construction: (v) => "The bottle frame is built with durable components for daily use.",
    };
    const bullets: string[] = [];
    const usedFactIds: string[] = [];
    plans.forEach((bp) => {
      for (const id of (bp.featureFactIds ?? [])) {
        const v = byId.get(String(id));
        if (!v) continue;
        const frame = FRAME[String(id)] ?? ((val: string) => "The bottle features " + val + " for everyday convenience.");
        bullets.push(frame(v));
        if (!usedFactIds.includes(String(id))) usedFactIds.push(String(id));
        break;
      }
    });
    const description = "This water bottle is constructed with silicone and provides an 18oz capacity. It offers a red finish designed for convenient daily hydration.";
    return {
      title: "BrüMate Silicone Water Bottle, 18oz, red",
      bullets,
      description,
      backendSearchTerms: [],
      usedFactIds,
      humanReviewRequired: true,
    };
  };
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
    // 轮 15：功能事实句 ≥3 词保留，规格碎片不进 bullet；功能不足时不为冒充成品而补碎片
    expect(optimized.bullets.length).toBeGreaterThanOrEqual(1);
    // R6：质量判定统一收敛到运行时 Skill 合同（不再维护第二套冲突阈值）
    const contract = validateRuntimeQualityContract({
      title: optimized.titles[0] ?? "",
      bullets: optimized.bullets,
      description: optimized.description,
      keywords: optimized.keywords,
      facts: build.input.productFacts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: String(f.value ?? "").trim() })),
      usedFactIds: build.input.productFacts.map((f) => f.field),
    });

    expect(contract.ok, JSON.stringify(contract.issues)).toBe(true);
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
    let capturedInput: Parameters<TaskLinkedAiListingClient>[0] | null = null;
    const planAware = v2214ValidAiClient();
    setTaskLinkedAiListingClientForTests(async (input) => {
      calls += 1;
      // 无 brief：prompt 必须含 KEYWORD_OPTIMIZATION = DISABLED
      expect(input.keywordBrief).toBeNull();
      expect(input.listingBrief).toBeNull();
      const out = await planAware(input);
      capturedInput = input as never;
      return { ...(out as Record<string, unknown>), backendSearchTerms: ["self-invented keyword"] } as never;
    });
    try {
      const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
      const sv2 = p2.gate.storageVersion!;
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
      // AI 稿被采纳 → 无需回退（fallbackApplied=false；旧断言 toBe(true) 是病句 fallback 语义残留）
      expect(result.draft?.fallbackApplied).toBe(false);
      // AI 自造 backend terms 被服务端丢弃
      expect(result.draft?.keywords).toEqual([]);
      expect(result.draft?.backendSearchTerms).toEqual([]);
      // keywordReady 保持 false（无 brief）
      expect(result.draft?.riskNotes?.join(" ")).toContain("未进行关键词优化");
      // P1-2：AI 成功输出必须通过真实 Runtime 合同 + 事实锚点 + 品牌单次 + 5 点 3-5 条 × 8-30 词 + 无未确认承诺
      expect(result.draft?.providerSucceeded).toBe(true);
      assertAiSuccessMeetsRuntimeContract({
        titles: result.draft?.titles ?? [],
        bullets: result.draft?.bullets ?? [],
        description: result.draft?.description ?? "",
        keywords: result.draft?.keywords ?? [],
      });
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  });
});

describe("v2.2.16 BrüMate Listing Brief Golden Case", () => {
  it("passes marketing guidance separately, keeps keyword optional, and saves an AI-quality draft", async () => {
    const taskId = "sandbox_task_v2216_listing_brief";
    seedTask(taskId, buildBruteMateResultJson());
    await confirmBruteMateHandoff(taskId);
    const listingBrief = {
      schema: "listing-creation-brief.v1" as const,
      coreSellingPoint: "强调带盖 SoftSip 吸管的日常饮用体验",
      targetAudience: "通勤与日常随身携带的人群",
      useScenario: "通勤、旅行和办公室补水",
      differentiation: "突出舒适饮用和日常节奏",
      contentEmphasis: "功能与使用价值结合表达",
    };
    const capturedInputs: Parameters<TaskLinkedAiListingClient>[0][] = [];
    const planAwareB = v2214ValidAiClient();
    setTaskLinkedAiListingClientForTests(async (input) => {
      capturedInputs.push(input);
      const out = await planAwareB(input);
      return { ...(out as Record<string, unknown>), backendSearchTerms: [] } as never;
    });
    try {
      const preview = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655440716",
        expectedStorageVersion: preview.gate.storageVersion!,
        expectedHandoffRevision: 1,
        listingBrief,
      });

      expect(capturedInputs).toHaveLength(1);
      const captured = capturedInputs[0]!;
      expect(captured.listingBrief).toEqual(listingBrief);
      expect(captured.keywordBrief).toBeNull();
      expect(captured.facts.map((fact) => fact.value)).not.toContain(listingBrief.coreSellingPoint);
      expect(result.listingSaved).toBe(true);
      // 迁移语义说明：旧 Mock 病句被拒走 fallback；现自然句通过 → ai_optimized（listingBrief 被发送但不入 facts）
      expect(result.draft?.draftKind).toBe("ai_optimized_listing");
      expect(result.draft?.fallbackApplied).toBe(false);
      expect(result.draft?.titles[0]).not.toBe("Brand: BrüMate");
      expect(result.draft?.description).not.toBe(result.draft?.titles[0]);
      // P1-2：AI 成功输出必须通过真实 Runtime 合同 + 事实锚点 + 品牌单次 + 5 点 3-5 条 × 8-30 词 + 无未确认承诺
      expect(result.draft?.providerSucceeded).toBe(true);
      assertAiSuccessMeetsRuntimeContract({
        titles: result.draft?.titles ?? [],
        bullets: result.draft?.bullets ?? [],
        description: result.draft?.description ?? "",
        keywords: result.draft?.keywords ?? [],
      });
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  });

  it("R1.8 timeout fallback keeps marketing guidance isolated, passes Claim and Quality, and clears all SEO terms without a keyword brief", async () => {
    const taskId = "sandbox_task_v2216_r18_timeout";
    seedTask(taskId, buildBruteMateResultJson());
    await confirmBruteMateHandoff(taskId);
    const listingBrief = {
      schema: "listing-creation-brief.v1" as const,
      coreSellingPoint: "轻便易携带，适合日常携带",
      targetAudience: "旅行用户、通勤用户、户外用户",
      useScenario: "旅行、办公室、日常饮水",
      differentiation: "柔软材质设计，更方便携带和收纳",
      contentEmphasis: "便携性、使用体验、日常场景",
    };
    let captured: Parameters<TaskLinkedAiListingClient>[0] | null = null;
    setTaskLinkedAiListingClientForTests(async (input) => {
      captured = input;
      throw { code: "ai_timeout", message: "timed out" };
    });
    try {
      const preview = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655440718",
        expectedStorageVersion: preview.gate.storageVersion!,
        expectedHandoffRevision: preview.gate.currentHandoff!.currentRevision,
        listingBrief,
      });

      const capturedInput = captured as Parameters<TaskLinkedAiListingClient>[0] | null;
      expect(capturedInput?.listingBrief).toEqual(listingBrief);
      expect(capturedInput?.facts.map((fact) => fact.value)).not.toContain(listingBrief.coreSellingPoint);
      expect(result.listingSaved).toBe(true);
      expect(result.draft?.providerAttempted).toBe(true);
      expect(result.draft?.providerSucceeded).toBe(false);
      expect(result.draft?.fallbackApplied).toBe(true);
      expect(result.draft?.draftKind).toBe("safe_fact_draft");
      expect(result.draft?.keywords).toEqual([]);
      expect(result.draft?.backendSearchTerms).toEqual([]);
      // R6：确认事实不足以组成至少 3 条合格句 → listingUnqualified=true，bullets 安全清空
      expect(result.draft?.bullets).toEqual([]);
      expect(result.draft?.listingUnqualified).toBe(true);

      const handoff = preview.gate.currentHandoff!;
      const version = handoff.versions[handoff.versions.length - 1]!;
      const input = buildListingInputFromCreativeHandoff(handoff, version.sourceResearch.researchRevision);
      expect(input.ok).toBe(true);
      if (!input.ok || !result.draft) return;
      const savedDraft: AiListingPackDraft = {
        source: "deterministic_composition_v1",
        version: 1,
        generatedAt: NOW,
        model: "deterministic-composition",
        humanReviewRequired: true,
        titles: result.draft.titles,
        bullets: result.draft.bullets,
        description: result.draft.description ?? "",
        keywords: result.draft.keywords,
        sellingPoints: result.draft.sellingPoints,
        riskNotes: result.draft.riskNotes,
        complianceWarnings: [],
        blockedClaims: [],
        reviewChecklist: [],
      };
      const evidence = verifyListingClaims(savedDraft, input.input);
      expect(listingClaimsHaveEvidence(evidence), JSON.stringify(evidence.unsupportedClaims)).toBe(true);
      // R6：质量判定统一收敛到运行时 Skill 合同（结构化兜底不再按旧碎片规则评估）
      const quality = validateRuntimeQualityContract({
        title: result.draft.titles[0] ?? "",
        bullets: result.draft.bullets,
        description: result.draft.description ?? "",
        keywords: result.draft.keywords ?? [],
        facts: input.input.productFacts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: String(f.value ?? "").trim() })),
        usedFactIds: input.input.productFacts.map((f) => f.field),
      });
      // R6：确认事实不足以组成至少 3 条合格句时 listingUnqualified=true，Quality 合同预期未通过
      expect(quality.ok).toBe(false);
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

describe("第3轮反向验证②：irrelevant 竞品不得进入 Listing 生成依据", () => {
  it("competitorEvidence 含 irrelevant 竞品 → 生成输入 creativeContext 不含该 ASIN（数据保留但被过滤）", async () => {
    const taskId = "sandbox_task_r3_irrelevant";
    const base = JSON.parse(buildBruteMateResultJson());
    // 切换商品身份为 THERMOS FUNTAINER（Food Jar）："LunchBots Thermal Food Jar" 命中核心词 → direct
    const THERMOS_NAME = "THERMOS FUNTAINER Kids Food Jar with Spoon 10oz Pink";
    base.productName = THERMOS_NAME;
    base.candidateAnalysisContext.facts.productName = THERMOS_NAME;
    base.competitorEvidence = {
      schema: "competitor-evidence.v1", version: 1, candidateId: null,
      asins: [
        { asin: "B0IRR01", sourceKind: "browser_use", addedBy: { mode: "owner", actorRef: "owner:v1" }, addedAt: NOW, note: "Glass Storage Containers", collectedBy: { tool: "browser-use", version: "0.1.0" }, sourceUrl: "https://www.amazon.com/dp/B0IRR01", capturedAt: NOW },
        { asin: "B0DIR01", sourceKind: "browser_use", addedBy: { mode: "owner", actorRef: "owner:v1" }, addedAt: NOW, note: "LunchBots Thermal Food Jar for Kids", collectedBy: { tool: "browser-use", version: "0.1.0" }, sourceUrl: "https://www.amazon.com/dp/B0DIR01", capturedAt: NOW },
      ],
      updatedAt: NOW,
    };
    seedTask(taskId, JSON.stringify(base));
    await confirmBruteMateHandoff(taskId);
    let capturedInput: Parameters<TaskLinkedAiListingClient>[0] | null = null;
    const planAwareC = v2214ValidAiClient();
    setTaskLinkedAiListingClientForTests(async (input: Parameters<TaskLinkedAiListingClient>[0]) => {
      capturedInput = input as Parameters<TaskLinkedAiListingClient>[0];
      const out = await planAwareC(input);
      return { ...(out as Record<string, unknown>), backendSearchTerms: [] } as never;
    });
    try {
      const preview = await generateCreativeHandoffPreview(taskId, visitorContext());
      const sv = preview.gate.storageVersion!;
      await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655440722",
        expectedStorageVersion: sv,
        expectedHandoffRevision: 1,
      });
      const ccText = JSON.stringify((capturedInput as { creativeContext?: unknown } | null)?.creativeContext ?? {});
      // 直接竞品保留（定位参考），irrelevant 竞品必须被过滤（不得进入 Listing 依据）
      expect(ccText).toContain("B0DIR01");
      expect(ccText).not.toContain("B0IRR01");
      expect(ccText).not.toContain("Glass Storage Containers");
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  });
});
