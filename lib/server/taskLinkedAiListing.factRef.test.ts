import { vi, beforeAll, afterAll } from "vitest";
import { setTaskLinkedAiListingClientForTests, type TaskLinkedAiListingClient } from "@/lib/server/taskLinkedAiListing";
import { setEnglishRendererForTests } from "@/lib/listingHandoff/listingEnglishRendering";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "r1-2-fact-ref");
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

import { describe, expect, it } from "vitest";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { generateListingDraftFromHandoff } from "@/lib/listingHandoff/listingGenerationService";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

const NOW = "2026-08-10T00:00:00.000Z";
const DEMO = "demo-r1-2-fact-ref";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: "candidate-r1-2", runId: "run-r1-2",
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
  const context = { candidateId: "candidate-r1-2", productName: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)", sourceType: "seller_sprite_market_research", sourceLabel: "SellerSprite", marketplace: "US", asin: "B0FH1ZXTN1", productUrl: "https://e.com/p", title: "Owala FreeSip Stainless Steel Water Bottle 24 oz Blue (Blue Jay)", brand: "Owala", category: "Sports & Outdoors", priceUsd: 29.99, rating: 4.6, reviewCount: 2948, disclaimer: "third_party_estimate_point_in_time", reportType: "SellerSprite Search Results", query: "water bottle", evidenceStatus: "ok", researchPriority: "high", promotionEligible: false, capturedAt: NOW, contextHash: "a".repeat(64) };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification,
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" }, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function seedTask(taskId: string) {
  const storePath = join(tmpdir(), "r1-2-fact-ref", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson: researchDoc(), productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

const SIX_FACT_FIELDS = ["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant"];
const FUNCTIONAL_MANUAL = [
  { field: "functional_feature" as const, value: "straw lid with push-open mechanism" },
  { field: "construction" as const, value: "double-wall vacuum insulation" },
  { field: "care" as const, value: "dishwasher-safe removable parts" },
];

async function setupHandoff(taskId: string) {
  seedTask(taskId);
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview1 = p1.preview!;
  const sv = preview1.storageVersion!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const sixIds = eligible.filter((c) => SIX_FACT_FIELDS.includes(c.field)).map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655440800",
    expectedResearchRevision: preview1.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: sixIds,
    requestFingerprint: buildRequestFingerprint({
      action: "create",
      selectedFactIds: sixIds,
      expectedStorageVersion: sv,
      expectedResearchRevision: preview1.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    }),
  });
  const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const sv2 = p2.preview!.storageVersion!;
  const confirmables2 = buildConfirmableCandidates(p2.gate.candidate!.stableSourceFacts);
  const eligible2 = confirmables2.filter((c) => c.allowedUsageScopes.includes("listing"));
  const sixIds2 = eligible2.filter((c) => SIX_FACT_FIELDS.includes(c.field)).map((c) => p2.preview!.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655440801",
    expectedResearchRevision: preview1.expectedResearchRevision!,
    expectedCurrentHandoffRevision: 1,
    expectedStorageVersion: sv2,
    selectedFactCandidateIds: sixIds2,
    manualConfirmedFacts: FUNCTIONAL_MANUAL,
    requestFingerprint: buildRequestFingerprint({
      action: "create",
      selectedFactIds: sixIds2,
      manualConfirmedFacts: FUNCTIONAL_MANUAL,
      expectedStorageVersion: sv2,
      expectedResearchRevision: preview1.expectedResearchRevision,
      expectedCurrentHandoffRevision: 1,
      confirmed: true,
    }),
  });
}

async function saveBrief(taskId: string) {
  const brief = buildListingKeywordBrief({
    primaryKeyword: "insulated water bottle",
    supportingKeywords: ["stainless steel bottle", "24 oz bottle"],
    backendSearchTerms: ["vacuum flask"],
    source: "synthetic",
    capturedAt: NOW,
  });
  if (!brief.ok) throw new Error("brief build failed");
  await mutateTaskResultJson({
    context: visitorContext(),
    taskId,
    writer: "keyword-brief",
    async mutate(current) {
      return { result: { ...current, listingKeywordBrief: brief.brief as unknown as Record<string, unknown> }, value: { saved: true } };
    },
  });
}

/** ListingPlan.v2 对齐夹具：bulletPlans=[functional_feature, care, material]（逐条命中计划事实；8-30 词；无 cannotSay/未确认性能/认证/时长） */
const GENERIC_AI_OUTPUT = {
  title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
  bullets: [
    "The straw lid with push-open mechanism is a feature of this Water Bottle.",
    "The dishwasher-safe removable parts option is included for this Water Bottle.",
    "Stainless Steel is the material of this Water Bottle.",
  ],
  description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
  backendSearchTerms: ["vacuum flask"],
  humanReviewRequired: true,
};



beforeAll(() => {
  // R3.2：测试环境无真实 AI key；mock rendering 对中文事实返回英文占位（保留数字/单位）
  setEnglishRendererForTests(async (fact) => {
    const HAS_CJK = /[一-鿿]/;
    if (!HAS_CJK.test(fact.sourceValue)) return fact.sourceValue;
    const out = fact.sourceValue
      .replace(/宽口设计/g, "wide-mouth design")
      .replace(/便于清洁和加冰/g, "easy cleaning and adding ice")
      .replace(/双层隔热不锈钢结构/g, "double-wall insulated stainless steel construction")
      .replace(/按键打开上盖/g, "push-button lid opens")
      .replace(/内置吸管直立吸饮/g, "built-in straw upright sipping")
      .replace(/提环/g, "carry loop")
      .replace(/吸嘴/g, "spout")
      .replace(/内置吸管/g, "built-in straw")
      .replace(/按钮式上盖/g, "push-button lid")
      .replace(/可兼作锁扣/g, "doubles as a lock")
      .replace(/[。；、]/g, ". ")
      .replace(/；/g, "; ");
    return out.trim();
  });
});
afterAll(() => {
  setEnglishRendererForTests(null);
});
describe("R1.2 Fact Reference 预防性测试（模拟真实 LLM 行为，不调用 Provider）", () => {
  async function generateWithAi(taskId: string, client: TaskLinkedAiListingClient) {
    await setupHandoff(taskId);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(client);
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    return generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: `550e8400-e29b-41d4-a716-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
  }

  it("合法 factId 原样返回 → PASS（ai_optimized_listing；计划对齐强断言）", async () => {
    const result = await generateWithAi("sandbox-r1-2-fact-ok", async (input) => {
      // Plan-aware：bullets 动态等于 plan.bulletPlans.length，第 i 条锚定 plan[i].featureFactIds 真实值
      const plans = input.plan?.bulletPlans ?? [];
      const factById = new Map<string, string>();
      for (const f of input.facts ?? []) factById.set(String(f.factId ?? ""), String(f.value ?? "").trim());
      const bullets = plans.map((bp) => {
        const first = (bp.featureFactIds ?? [])[0] ?? "";
        const value = factById.get(String(first)) ?? "";
        const capValue = value.charAt(0).toUpperCase() + value.slice(1);
        return `${capValue} is the ${String(first).replace(/_/g, " ")} of this product.`;
      });
      const usedFactIds = [...new Set(plans.map((bp) => (bp.featureFactIds ?? [])[0] ?? "").filter(Boolean))];
      const titleValue = (input.facts ?? []).find((f) => f.field === "product_type")?.value ?? "Water Bottle";
      return {
        title: `${titleValue} - ${factById.get("material") ?? ""} - ${factById.get("capacity") ?? ""}`,
        bullets,
        description: `The material of this ${titleValue} is ${factById.get("material") ?? ""}. This ${titleValue} has a capacity of ${factById.get("capacity") ?? ""}.`,
        backendSearchTerms: (input.keywordBrief?.backendSearchTerms ?? []).slice(),
        usedFactIds,
        humanReviewRequired: true,
      };
    });
    const draft = result.draft!;
    expect(draft.draftKind).toBe("ai_optimized_listing");
    expect(draft.providerAttempted).toBe(true);
    expect(draft.providerSucceeded).toBe(true);
    expect(draft.fallbackApplied).toBe(false);
    // 正式五点数=当前 Plan 条数（Owala 场景 4 组：material/capacity/function/care），每条 8-30 词并锚定计划事实
    const anchors = ["straw lid with push-open mechanism", "dishwasher-safe removable parts", "Stainless Steel", "24 oz"];
    expect(draft.bullets.length).toBe(4);
    for (const b of draft.bullets) {
      const wc = b.trim().split(/\s+/).length;
      expect(wc).toBeGreaterThanOrEqual(8);
      expect(wc).toBeLessThanOrEqual(30);
      expect(anchors.some((a) => b.toLowerCase().includes(a.toLowerCase()))).toBe(true);
    }
    // 正式字段无未确认内容（不得含旧夹具的 "keeps cold for hours"/FreeSip straw 等未确认话术）
    const formal = [String(draft.titles[0] ?? ""), ...draft.bullets, String(draft.description ?? "")].join(" ").toLowerCase();
    for (const banned of ["keeps cold", "hours", "leakproof", "12 hours", "bpa", "fda", "guaranteed", "freesip"]) {
      expect(formal).not.toContain(banned);
    }
    // 事实引用/研究参考隔离：公开 DTO 不含内部 id / field / runId
    const dump = JSON.stringify(draft);
    expect(dump).not.toContain("usedFactIds");
    expect(dump).not.toContain("\"field\"");
    expect(dump).not.toContain("runId");
    expect(dump).not.toContain("inputEvidenceHash");
  });

  it("调换两条事实顺序（忽略计划顺序）→ 绑定门拦截 → 回退，且正式字段无未确认内容", async () => {
    const result = await generateWithAi("sandbox-r1-2-fact-reorder", async () => ({
      ...GENERIC_AI_OUTPUT,
      bullets: [
        "The dishwasher-safe removable parts option is included for this Water Bottle.",
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Stainless Steel is the material of this Water Bottle.",
      ],
      usedFactIds: ["functional_feature", "care", "material"],
    }));
    const draft = result.draft!;
    expect(draft.draftKind).not.toBe("ai_optimized_listing");
    expect(draft.fallbackApplied).toBe(true);
    const formal = [String(draft.titles[0] ?? ""), ...draft.bullets, String(draft.description ?? "")].join(" ").toLowerCase();
    for (const banned of ["keeps cold", "leakproof", "12 hours", "bpa", "fda", "guaranteed"]) {
      expect(formal).not.toContain(banned);
    }
  });

  it("轻微变形 factId → fail-closed", async () => {
    const result = await generateWithAi("sandbox-r1-2-fact-deform", async () => ({
      ...GENERIC_AI_OUTPUT,
      usedFactIds: ["functional_feature", "construction", "materialx"],
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("invented factId → fail-closed", async () => {
    const result = await generateWithAi("sandbox-r1-2-fact-invented", async () => ({
      ...GENERIC_AI_OUTPUT,
      usedFactIds: ["brand", "product_type", "made_up_fact_xyz"],
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });
});
