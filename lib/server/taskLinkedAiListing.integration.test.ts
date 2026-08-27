import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "quality2-ai");
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

import { beforeAll, afterAll } from "vitest";
import { setEnglishRendererForTests } from "@/lib/listingHandoff/listingEnglishRendering";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { generateListingDraftFromHandoff, deriveKeywordAdoptionTrace, aiBulletsBindToPlan } from "@/lib/listingHandoff/listingGenerationService";
import { buildListingPlan, type ListingPlanStatus } from "@/lib/listingHandoff/listingPlan";
import { setTaskLinkedAiListingClientForTests, type TaskLinkedAiListingClient } from "@/lib/server/taskLinkedAiListing";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

beforeAll(() => {
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
const NOW = "2026-08-09T19:43:44.103Z";
const DEMO = "demo-quality2";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId = "candidate-quality2", extraNamespaces?: Record<string, unknown>) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-q2",
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
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification,
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" }, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput, ...(extraNamespaces ?? {}) });
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "quality2-ai", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

const SIX_FACT_FIELDS = ["brand", "product_type", "series_or_model", "material", "capacity", "color_or_variant"];
const FUNCTIONAL_MANUAL = [
  { field: "functional_feature" as const, value: "straw lid with push-open mechanism" },
  { field: "construction" as const, value: "double-wall vacuum insulation" },
  { field: "care" as const, value: "dishwasher-safe removable parts" },
];

async function setupHandoff(taskId: string, withFunctional: boolean, researchExtra?: Record<string, unknown>) {
  seedTask(taskId, researchDoc("candidate-quality2", researchExtra));
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview1 = p1.preview!;
  const sv = preview1.storageVersion!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const six = eligible.filter((c) => SIX_FACT_FIELDS.includes(c.field));
  const sixIds = six.map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
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
  if (withFunctional) {
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
}

async function saveBrief(taskId: string) {
  const brief = buildListingKeywordBrief({
    primaryKeyword: "insulated water bottle",
    supportingKeywords: ["stainless steel bottle", "24 oz bottle"],
    backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
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

/** ListingPlan.v2：与 fixture 计划一一对齐的 Provider 输出（3 bullet = plan 3 bulletPlans） */
function validAiClient(): TaskLinkedAiListingClient {
  return async () => ({
    title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
    bullets: [
      "The straw lid with push-open mechanism is a feature of this Water Bottle.",
      "The dishwasher-safe removable parts option is included for this Water Bottle.",
      "Stainless Steel is the material of this Water Bottle.",
    ],
    description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
    backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
    usedFactIds: ["functional_feature", "care", "material"],
    humanReviewRequired: true,
  });
}

describe("Quality.2 Task-linked AI integration", () => {
  it("CASE A：仅 6 基础 facts → Provider 调用 0 次 → safe_fact_draft", async () => {
    const taskId = "sandbox-q2-case-a";
    await setupHandoff(taskId, false);
    let providerCalls = 0;
    setTaskLinkedAiListingClientForTests(async () => { providerCalls += 1; return {}; });

    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440802",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: 1,
    });
    expect(providerCalls).toBe(0);
    expect(result.draft?.draftKind).toBe("safe_fact_draft");
    expect(result.draft?.providerAttempted).toBe(false);
  });

  it("CASE B：9 facts + brief + Mock AI 成功 → Provider 1 次 → ai_optimized_listing", async () => {
    const taskId = "sandbox-q2-case-b";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    let providerCalls = 0;
    const valid = validAiClient();
    const countingClient: TaskLinkedAiListingClient = async (input) => { providerCalls += 1; return valid(input); };
    setTaskLinkedAiListingClientForTests(countingClient);

    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const rev = p.gate.currentHandoff!.currentRevision;
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440803",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: rev,
    });
    expect(providerCalls).toBe(1);
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.providerAttempted).toBe(true);
    expect(result.draft?.providerSucceeded).toBe(true);
    // R4：公开摘要不含内部 usedFactIds；改为断言安全 usedFactTrace（label/value）对应事实存在
    expect((result.draft as unknown as Record<string, unknown>).usedFactIds).toBeUndefined();
    const traceFields = (result.draft?.usedFactTrace ?? []).map((f) => f.label);
    expect(traceFields.length).toBeGreaterThanOrEqual(3);
    expect(result.draft?.bullets.length).toBeGreaterThanOrEqual(3);
    expect((result.draft?.description ?? "").length).toBeGreaterThan(30);
    // F5 幂等：同 requestId 不再调 Provider
    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result2 = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440803",
      expectedStorageVersion: p2.gate.storageVersion!,
      expectedHandoffRevision: p2.gate.currentHandoff!.currentRevision,
    });
    expect(result2.idempotentReplay).toBe(true);
    expect(providerCalls).toBe(1);
  });

  it("对抗：非法 factId → 不成为 ai_optimized_listing", async () => {
    const taskId = "sandbox-q2-adv-1";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala Insulated Water Bottle",
      bullets: ["Push-open straw lid for one-handed drinking.", "Double-wall vacuum insulation keeps drinks cold.", "Dishwasher-safe removable parts."],
      description: "The Owala bottle with push-open lid and vacuum insulation for daily use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["nonexistent-fact-id"],
      humanReviewRequired: true,
    }));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440804",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("对抗：malformed JSON → fallback safe_fact_draft", async () => {
    const taskId = "sandbox-q2-adv-2";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => {
      throw { code: "ai_json_parse_failed", message: "not json" };
    });
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440805",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    // R3：fallback 优先 structured（facts 充分时 structured 通过），safe_fact_draft 为最后兜底
    expect(result.draft?.draftKind).toBe("structured_listing_draft");
    expect(result.draft?.providerAttempted).toBe(true);
    expect(result.draft?.providerSucceeded).toBe(false);
    expect(result.draft?.fallbackReason).toBeTruthy();
  });

  it("对抗：timeout → fallback，不阻断用户获得安全草稿", async () => {
    const taskId = "sandbox-q2-adv-3";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => {
      throw { code: "ai_timeout", message: "timed out" };
    });
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440806",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    expect(result.draft?.draftKind).toBe("structured_listing_draft");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("R3：R1.9 真实输出 Schema/Quality 通过但 Claim 失败时，保存 structured fallback", async () => {
    const taskId = "sandbox-q2-r19-claim-gate";
    await setupHandoff(taskId, true);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala Water Bottle",
      bullets: [
        "Straw lid with push-open mechanism.",
        "Double-wall vacuum insulation.",
        "Dishwasher-safe removable parts.",
        "Stainless Steel 24 oz.",
      ],
      description: "The Owala FreeSip bottle offers a spill-resistant drinking experience and is easy to carry and store.",
      backendSearchTerms: [],
      usedFactIds: ["brand", "product_type", "capacity", "material", "functional_feature", "construction", "care"],
      humanReviewRequired: true,
    }));

    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440899",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });

    expect(result.draft?.draftKind).toBe("structured_listing_draft");
    expect(result.draft?.providerAttempted).toBe(true);
    // ListingPlan.v2 状态诚实：Provider 调用成功（providerSucceeded 反映调用结果），
    // 但草稿被 Claim/计划绑定拒绝 → 结构化回退（draftKind 不冒充 ai_optimized）
    expect(result.draft?.providerSucceeded).toBe(true);
    expect(result.draft?.fallbackApplied).toBe(true);
    expect(result.draft?.fallbackReason).toContain("已保留安全草稿");
    expect(result.draft?.titles.join(" ")).not.toContain("fits most cup holders");
    expect(result.draft?.bullets.join(" ")).not.toContain("spill-resistant");
  });
});

describe("Quality.2 adversarial AI outputs", () => {
  async function generateWithAi(taskId: string, client: TaskLinkedAiListingClient) {
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(client);
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    return generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: `550e8400-e29b-41d4-a716-${String(Math.floor(Math.random() * 900000) + 100000)}`,
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
  }

  it("对抗4：best seller / guaranteed → 被 Claim Evidence 阻断", async () => {
    const result = await generateWithAi("sandbox-q2-adv-best", async () => ({
      title: "Best Seller Guaranteed Owala Water Bottle",
      bullets: ["Best seller guaranteed quality.", "100% guaranteed.", "Leakproof construction keeps you hydrated all day."],
      description: "The best guaranteed Owala bottle for everyone.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("对抗5：keyword stuffing title → Quality Validator 阻断", async () => {
    const result = await generateWithAi("sandbox-q2-adv-stuff", async () => ({
      title: "water bottle water bottle water bottle water bottle",
      bullets: ["Push-open straw lid makes drinking easy for daily use.", "Double-wall insulation keeps drinks at temperature for commutes.", "Dishwasher-safe parts make cleaning simple and convenient."],
      description: "The Owala bottle with push-open lid and vacuum insulation for daily hydration use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
  });

  it("对抗6：Bullet 只是属性碎片 → Quality Validator 阻断", async () => {
    const result = await generateWithAi("sandbox-q2-adv-frag", async () => ({
      title: "Owala Water Bottle",
      bullets: ["Owala FreeSip Water Bottle", "Stainless Steel 24 oz", "Blue"],
      description: "The Owala FreeSip bottle for daily use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type", "material", "capacity", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("对抗7：Description 复制 Title → Quality Validator 阻断", async () => {
    const result = await generateWithAi("sandbox-q2-adv-desc", async () => ({
      title: "Owala Water Bottle",
      bullets: ["Push-open straw lid makes drinking easy for daily use.", "Double-wall insulation keeps drinks at temperature for commutes.", "Dishwasher-safe parts make cleaning simple and convenient."],
      description: "Owala Water Bottle",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
  });

  it("对抗3：未确认 leakproof claim → 不成为 ai_optimized_listing", async () => {
    const result = await generateWithAi("sandbox-q2-adv-leak", async () => ({
      title: "Owala FreeSip Leakproof Water Bottle",
      bullets: ["Leakproof design for worry-free carry.", "Double-wall insulation keeps drinks cold.", "Dishwasher-safe removable parts."],
      description: "The leakproof Owala bottle for everyday carry.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
  });

  it("R1.2 对抗8：AI 额外返回 invented usedKeywordIds → Schema 严格拒绝", async () => {
    const result = await generateWithAi("sandbox-q2-adv-kwids", async () => ({
      title: "Owala Insulated Water Bottle",
      bullets: ["Push-open straw lid for one-handed drinking.", "Double-wall vacuum insulation keeps drinks cold.", "Dishwasher-safe removable parts."],
      description: "The Owala bottle with push-open lid and vacuum insulation for daily use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["brand", "product_type"],
      usedKeywordIds: ["kw:primary", "kw:999"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
    // R3：schema 拒绝原因保留在 qualityIssues，对外 fallbackReason 为统一文案
    expect(result.draft?.fallbackReason).toContain("结构校验");
  });

  it("R1.2 回归：AI 不返回 usedKeywordIds → Schema PASS + 服务器派生 provenance", async () => {
    const result = await generateWithAi("sandbox-q2-r1-2-regress", async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(false);
  });

  it("R1.4 回归：AI 返回 55 字符 Title → PASS（无 fallback，advisory 不阻断）", async () => {
    const result = await generateWithAi("sandbox-q2-r1-4-regress", async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.providerSucceeded).toBe(true);
    expect(result.draft?.fallbackApplied).toBe(false);
    expect(result.draft?.fallbackReason).toBeNull();
  });

  it("R1.6 回归：无 leakproof fact → 'leakproof tumbler' 被安全过滤，其余保留，仍 ai_optimized_listing", async () => {
    const result = await generateWithAi("sandbox-q2-r1-6-regress", async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(false);
    expect(result.draft?.backendSearchTerms).toEqual(["vacuum flask", "carry water bottle"]);
    expect(result.draft?.backendTermWarnings?.length).toBe(1);
    expect(result.draft?.backendTermWarnings?.[0]).toContain("leakproof tumbler");
    // provenance 基于安全过滤后 terms：不得包含 kw:backend 对应 leakproof 的 id
    // （usedKeywordIds 存于 snapshot，draftSafeSummary 不暴露 → 从 sandbox store 读取）
    const store = JSON.parse(readFileSync(join(tmpdir(), "quality2-ai", "sandbox.json"), "utf8"));
    const task = store.tasks.find((t: { id: string }) => t.id === "sandbox-q2-r1-6-regress");
    const saved = task ? JSON.parse(task.resultJson) : null;
    const savedUsedKeywordIds: string[] = saved?.aiListingPackSnapshot?.usedKeywordIds ?? [];
    expect(savedUsedKeywordIds).not.toContain("kw:backend:1");
    // 安全保留的 terms 应有对应 id（leakproof 被过滤后其 id 消失，vacuum flask/carry 保留）
    expect(savedUsedKeywordIds).toContain("kw:backend:0");
    expect(savedUsedKeywordIds).toContain("kw:backend:2");
  });

  it("R1.6：provenance 基于安全过滤后 backend terms（无漏网 id）", async () => {
    const result = await generateWithAi("sandbox-q2-r1-6-prov", async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    const store = JSON.parse(readFileSync(join(tmpdir(), "quality2-ai", "sandbox.json"), "utf8"));
    const task = store.tasks.find((t: { id: string }) => t.id === "sandbox-q2-r1-6-prov");
    const saved = task ? JSON.parse(task.resultJson) : null;
    const ids: string[] = saved?.aiListingPackSnapshot?.usedKeywordIds ?? [];
    // vacuum flask 与 carry water bottle 均通过安全过滤 → 对应 backend ids 应存在
    expect(ids).toContain("kw:backend:0");
    expect(ids).toContain("kw:backend:2");
  });

  it("R1.6-Final：AI 返回 Brief 外 backend term → 被硬阻断（Brief Authority）", async () => {
    const result = await generateWithAi("sandbox-q2-r1-6f-brief", async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "sports hydration bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.backendSearchTerms).toEqual(["vacuum flask"]);
    expect(result.draft?.backendTermWarnings?.some((w) => w.includes("sports hydration bottle"))).toBe(true);
    // provenance 不含被阻断 term 的 id（brief 无该词 → 无 id 可派）
    const store = JSON.parse(readFileSync(join(tmpdir(), "quality2-ai", "sandbox.json"), "utf8"));
    const task = store.tasks.find((t: { id: string }) => t.id === "sandbox-q2-r1-6f-brief");
    const saved = task ? JSON.parse(task.resultJson) : null;
    const ids: string[] = saved?.aiListingPackSnapshot?.usedKeywordIds ?? [];
    expect(ids.every((id) => id !== "kw:backend:1")).toBe(true);
  });
});
describe("R6 运行时 Listing Skill 接入（行为）", () => {
  it("Prompt 组装使用可执行运行时 Skill：包含版本标记与质量合同", async () => {
    const { buildTaskLinkedAiPrompt } = await import("@/lib/server/taskLinkedAiListing");
    const { LISTING_RUNTIME_SKILL_VERSION } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const prompt = buildTaskLinkedAiPrompt({
      facts: [{ factId: "material", field: "material", label: "材质", value: "Stainless Steel" }],
      plan: { primaryKeyword: "water bottle", supportingKeywords: [], titlePlan: [], bulletPlans: [], descriptionPlan: "", backendSearchTerms: [] } as never,
      keywordBrief: { primaryKeyword: "water bottle", supportingKeywords: [], backendSearchTerms: [], source: "synthetic", capturedAt: NOW } as never,
      listingBrief: null,
      prohibitedClaims: ["BPA-free"],
    });
    expect(prompt).toContain(LISTING_RUNTIME_SKILL_VERSION);
    expect(prompt).toContain("QUALITY_CONTRACT");
    expect(prompt).toContain("8-30");
    expect(prompt).toContain("buyer value");
    expect(prompt).toContain("Do not fabricate");
  });

  it("注入 Provider 的 THERMOS 型数据生成 5 条 8-30 词、逐条锚定已确认事实的五点", async () => {
    const taskId = "sandbox-runtime-thermos";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle with stainless steel and 24 oz for easy cleaning. The Owala bottle with the double-wall vacuum insulation for everyday use. The Owala bottle with the FreeSip straw for everyday use.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type", "color_or_variant"],
      humanReviewRequired: true,
    }));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440900",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    const draft = result.draft!;
    expect(draft.draftKind).toBe("ai_optimized_listing");
    expect(draft.bullets.length).toBe(3);
    const anchors = ["straw lid with push-open mechanism", "dishwasher-safe removable parts", "stainless steel"];
    for (const b of draft.bullets) {
      const wc = b.trim().split(/\s+/).length;
      expect(wc).toBeGreaterThanOrEqual(8);
      expect(wc).toBeLessThanOrEqual(30);
      expect(anchors.some((a) => b.toLowerCase().includes(a))).toBe(true);
    }
    const title = draft.titles[0] ?? "";
    const brandCount = (title.toLowerCase().split(/\W+/).filter((w) => w === "owala")).length;
    expect(brandCount).toBe(1);
    const kw = (draft.keywords ?? []);
    const kwNorm = kw.map((k) => k.trim().toLowerCase());
    expect(new Set(kwNorm).size).toBe(kwNorm.length);
    const sentences = (draft.description ?? "").split(/[.!?]+/).filter((s) => s.trim().length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(4);
    expect(draft.listingUnqualified).toBe(false);
  });

  it("注入提供碎片五点（Latch./Office, home.）→ 合同拦截，兜底不输出碎片，拒绝原因可见", async () => {
    const taskId = "sandbox-runtime-fragments";
    await setupHandoff(taskId, true);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala Water Bottle",
      bullets: ["Latch.", "Office, home.", "Dishwasher Safe.", "Vacuum Insulated.", "Food jar with unfolding spoon."],
      description: "Owala Water Bottle.",
      backendSearchTerms: [],
      usedFactIds: ["functional_feature", "construction", "care"],
      humanReviewRequired: true,
    }));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440901",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    const draft = result.draft!;
    expect(draft.draftKind).not.toBe("ai_optimized_listing");
    const titleTxt = draft.titles[0] ?? "";
    const allText = [titleTxt, ...draft.bullets, (draft.description ?? "")].join(" ");
    expect(allText).not.toContain("Latch.");
    expect(allText).not.toContain("Office, home.");
    for (const b of draft.bullets) {
      const wc = b.trim().split(/\s+/).length;
      expect(wc).toBeGreaterThanOrEqual(8);
    }
    expect(draft.fallbackApplied).toBe(true);
    expect((draft.qualityIssues ?? []).join(" ")).toMatch(/[\u4e00-\u9fff]/);
  });
});

describe("ListingPlan.v2 绑定（AI 成功路径行为）", () => {
  it("P1：计划对齐且事实安全的 Provider 输出 → ai_optimized_listing + sellingPointPlan 随快照保存", async () => {
    const taskId = "sandbox-q2-v2-bind-ok";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    let captured: Parameters<TaskLinkedAiListingClient>[0] | null = null;
    setTaskLinkedAiListingClientForTests(async (input) => {
      captured = input;
      return validAiClient()({} as never);
    });
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440900",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.providerSucceeded).toBe(true);
    expect(result.draft?.fallbackApplied).toBe(false);
    // sellingPointPlan 随 AI 快照保存并经 safe DTO 读回
    const plan = result.draft?.sellingPointPlan ?? [];
    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(plan.length).toBeLessThanOrEqual(5);
    for (const bp of plan) {
      expect(["core_outcome", "pain_relief", "use_scenario", "ease_of_use", "proof_or_fit"]).toContain(bp.role);
      expect(bp.factLabels.length).toBeGreaterThanOrEqual(1);
    }
    // 不泄露内部 id/hash/runId
    const dump = JSON.stringify(result.draft ?? {});
    expect(dump.indexOf("runId")).toBe(-1);
    expect(dump.indexOf("Hash")).toBe(-1);
  });

  it("P2：调换两条 bullet 事实顺序（忽略计划顺序）→ 不得 ai_optimized", async () => {
    const taskId = "sandbox-q2-v2-bind-reorder";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "Easy cleaning with the dishwasher-safe removable parts option for this Water Bottle.",
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["care", "functional_feature", "material"],
      humanReviewRequired: true,
    }));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440901",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("P3：cannotSay 中的 12 hours / leakproof 注入 → 计划绑定拦截", async () => {
    const taskId = "sandbox-q2-v2-bind-cannot";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "Double-wall vacuum insulation keeps drinks cold for 12 hours in the bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
      backendSearchTerms: [],
      usedFactIds: ["functional_feature", "construction", "material"],
      humanReviewRequired: true,
    }));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440902",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
    // 正式 bullets 不得含 12 hours
    const all = [...(result.draft?.bullets ?? []), ...((result.draft?.titles ?? []) as string[]), String(result.draft?.description ?? "")].join(" ");
    expect(all.toLowerCase()).not.toContain("12 hours");
  });

  it("P4（v2.3 新合同）：无有效关键词方案（plan=needs_keywords）Provider 成功 → 合格 AI 稿照常正式采用，四类关键词字段仍全空", async () => {
    const taskId = "sandbox-q2-v2-bind-nokw";
    await setupHandoff(taskId, true);
    // 不 saveBrief → 无有效关键词方案
    setTaskLinkedAiListingClientForTests(async () => {
      const base = (await validAiClient()({} as never)) as {
        title: string;
        bullets: string[];
        description: string;
        backendSearchTerms: string[];
        usedFactIds: string[];
        humanReviewRequired: true;
      };
      return { ...base, backendSearchTerms: ["owala cup", "vacuum flask"] }; // AI 自造后台词必须被丢弃
    });
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655440903",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    // ListingPlan.v2.3：needs_keywords 只表示“不能做关键词优化”，不等于“不能采用事实安全且文案合格的 AI 稿”
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.providerAttempted).toBe(true);
    expect(result.draft?.providerSucceeded).toBe(true);
    expect(result.draft?.fallbackApplied).toBe(false);
    expect(result.draft?.listingUnqualified).toBe(false);
    // 四类关键词字段全空：不得从研究候选词、商品标题或兜底词补入，AI 自造词也必须丢弃
    expect(result.draft?.keywords ?? []).toEqual([]);
    expect((result.draft?.backendSearchTerms ?? []) as string[]).toEqual([]);
    expect(result.draft?.usedKeywordTrace ?? []).toEqual([]);
    expect(result.draft?.searchOnlyKeywordTrace ?? []).toEqual([]);
    expect(result.draft?.keywordPlanSource).toBe("none");
  });
});



describe("ListingPlan.v2 关键词采用三态（usedKeywordTrace / searchOnlyKeywordTrace）", () => {
  const planLike = (primaryKeyword: string | null, supportingKeywords: string[] = []) => ({
    schema: "listing-plan.v2",
    status: "ready",
    primaryKeyword,
    supportingKeywords,
    titlePlan: [],
    bulletPlans: [],
    descriptionPlan: "",
    backendSearchTerms: [],
    missingFacts: [],
    prohibitedClaims: [],
    planQuality: "optimized",
  }) as never;

  it("红：bento box 只在 keywords 字段 → 不进 usedKeywordTrace，进入 searchOnlyKeywordTrace", () => {
    const plan = planLike("thermos", ["bento box for kids"]);
    const r = deriveKeywordAdoptionTrace(plan, [
      "THERMOS FUNTAINER Kids 10oz Stainless Steel Pink",
      "Dishwasher Safe is the cleaning option for this FUNTAINER Kids product.",
      "This FUNTAINER Kids product with the THERMOS brand for everyday use.",
    ], ["bento box for kids", "thermos", "lunch box kids", "kids lunch box"]);
    expect(r.usedKeywordTrace).toEqual(["thermos"]);
    expect(r.searchOnlyKeywordTrace).toEqual(["bento box for kids"]);
  });

  it("红：thermos 同时出现在标题和 keywords → 只进 usedKeywordTrace，不进 searchOnlyKeywordTrace", () => {
    const plan = planLike("thermos", ["bento box for kids"]);
    const r = deriveKeywordAdoptionTrace(plan, [
      "THERMOS FUNTAINER Kids 10oz Stainless Steel Pink",
      "Dishwasher Safe is the cleaning option for this FUNTAINER Kids product.",
      "",
    ], ["thermos", "bento box for kids"]);
    expect(r.usedKeywordTrace).toEqual(["thermos"]);
    expect(r.searchOnlyKeywordTrace).toEqual(["bento box for kids"]);
  });

  it("红：无有效方案（无 primaryKeyword）→ 两者均空", () => {
    const plan = planLike(null);
    const r = deriveKeywordAdoptionTrace(plan, ["whatever title", "a bullet", ""], ["some keyword"]);
    expect(r.usedKeywordTrace).toEqual([]);
    expect(r.searchOnlyKeywordTrace).toEqual([]);
  });

  it("红：重复与大小写变体稳定去重（保序、首现词面）", () => {
    const plan = planLike("Kids Water Bottle", ["kids water bottle", "KIDS WATER BOTTLE", "bento box for kids"]);
    const r = deriveKeywordAdoptionTrace(plan, ["kids water bottle is here.", "a bullet", ""], ["kids water bottle", "KIDS WATER BOTTLE", "bento box for kids"]);
    expect(r.usedKeywordTrace).toEqual(["Kids Water Bottle"]);
    expect(r.searchOnlyKeywordTrace).toEqual(["bento box for kids"]);
  });

  it("红：既不在正文也不在搜索字段的 scheme 词 → 两个 trace 均不出现", () => {
    const plan = planLike("water bottle", ["unused keyword phrase"]);
    const r = deriveKeywordAdoptionTrace(plan, ["Owala 24 oz Stainless Steel Water Bottle, Blue", "a bullet", ""], ["water bottle"]);
    expect(r.usedKeywordTrace).toEqual(["water bottle"]);
    expect(r.searchOnlyKeywordTrace).toEqual([]);
  });

  it("e2e：生成的快照两 trace 与正文/搜索字段一致且互斥、无内部 id", async () => {
    const taskId = "sandbox-q2-kw-trace-e2e";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => validAiClient()({} as never));
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441950",
      expectedStorageVersion: p.gate.storageVersion!,
      expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
    });
    const draft = result.draft!;
    const body = [String(draft.titles[0] ?? ""), ...draft.bullets, String(draft.description ?? "")].join(" ").toLowerCase();
    const searchField = [...(draft.keywords ?? []), ...((draft.backendSearchTerms ?? []) as string[])].map((k) => k.trim().toLowerCase());
    const used = draft.usedKeywordTrace ?? [];
    const searchOnly = draft.searchOnlyKeywordTrace ?? [];
    expect(Array.isArray(draft.searchOnlyKeywordTrace)).toBe(true);
    for (const u of used) {
      expect(body).toContain(u.toLowerCase());
    }
    for (const s of searchOnly) {
      expect(body).not.toContain(s.toLowerCase());
      expect(searchField).toContain(s.toLowerCase());
    }
    const usedLower = new Set(used.map((u) => u.toLowerCase()));
    for (const s of searchOnly) {
      expect(usedLower.has(s.toLowerCase())).toBe(false);
    }
    // trace 字段自身仅含关键词字符串：无 keywordId/factId/field/hash/runId（sellingPointPlan 的既有 keywordIds 展示属性不属本轮范围）
    for (const kw of [...used, ...searchOnly]) {
      expect(kw.indexOf("kw:")).toBe(-1);
      expect(kw.indexOf("runId")).toBe(-1);
      expect(kw.indexOf("factId")).toBe(-1);
      expect(kw.indexOf("field")).toBe(-1);
      expect(kw.indexOf("Hash")).toBe(-1);
    }
    // 无有效方案时（P4 路径）→ 两 trace 均空
    const draftNoKw = (await (async () => {
      const taskId2 = "sandbox-q2-kw-trace-noplan";
      await setupHandoff(taskId2, true);
      setTaskLinkedAiListingClientForTests(async () => validAiClient()({} as never));
      const p2 = await generateCreativeHandoffPreview(taskId2, visitorContext());
      return generateListingDraftFromHandoff(taskId2, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655441951",
        expectedStorageVersion: p2.gate.storageVersion!,
        expectedHandoffRevision: p2.gate.currentHandoff!.currentRevision,
      });
    })()).draft!;
    expect(draftNoKw.usedKeywordTrace ?? []).toEqual([]);
    expect(draftNoKw.searchOnlyKeywordTrace ?? []).toEqual([]);
  }, 60_000);
});


describe("LISTING_FINAL_CLOSURE：待确认句隔离 + 竞品品牌过滤 + 五点硬事实去重", () => {
  it("红：review 句不得停留在正式字段（bullet 含未确认词 → 该句移除，humanReviewClaims 单独承载）", async () => {
    const taskId = "sandbox-lfc-review-iso";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    // AI 返回其中一条含 未确认 的 review 级表达（keeps cold 12 hours 属 cannotSay，但用 "comfortable grip" 类无事实词制造 review tier）
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "The dishwasher-safe removable parts option is included for this Water Bottle.",
        "The straw lid with push-open mechanism keeps this Water Bottle easy to use every day.",
      ],
      description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["functional_feature", "care", "material"],
      humanReviewRequired: true,
    }));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441970", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    const d = result.draft!;
    const formal = [String(d.titles[0] ?? ""), ...d.bullets, String(d.description ?? "")].join(" ").toLowerCase();
    // 正式字段不得含 review 句；review 句只能在 humanReviewClaims 区
    expect(formal).not.toContain("easy to use");
    // review 句（bullet3）被移除后进待确认表达区（当前 draftKind 可为回退但句不得回正式字段）
    expect((d.humanReviewClaims ?? []).join(" ").toLowerCase()).toContain("easy to use");
  }, 60_000);

  it("红：人工保存 Keyword Brief 不能绕过竞品品牌过滤（stainley/owala 关键词不进正式字段）", async () => {
    const taskId = "sandbox-lfc-brand-iso";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    // 注入含竞品品牌的手工 Brief（绕过途径 = 直接把 brand 词写进 brief）
    const brief = buildListingKeywordBrief({ primaryKeyword: "owala bottle", supportingKeywords: ["water bottle"], backendSearchTerms: ["owala cup"], source: "synthetic", capturedAt: NOW });
    if (!brief.ok) throw new Error("brief build failed");
    await mutateTaskResultJson({ context: visitorContext(), taskId, writer: "keyword-brief", async mutate(current) { return { result: { ...current, listingKeywordBrief: brief.brief as unknown as Record<string, unknown> }, value: { saved: true } }; } });
    setTaskLinkedAiListingClientForTests(async () => validAiClient()({} as never));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441971", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    const d = result.draft!;
    const allKw = [...(d.keywords ?? []), ...((d.backendSearchTerms ?? []) as string[])].join(" ").toLowerCase();
    expect(allKw).not.toContain("owala");
    expect(allKw).not.toContain("owala cup");
    expect(d.backendSearchTerms ?? []).not.toContain("owala cup");
    // 无合格关键词 → 诚实空态（keywords 可为空但不含竞品品牌）
  }, 60_000);

  it("红：同一硬事实值不得成为两条五点的核心表达（bullet 1/2 重复 use same fact）", async () => {
    const taskId = "sandbox-lfc-dupfact-iso";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        // bullet1: 锚 functional_feature；但顺带提 material 值 → 硬事实 material 与 bullet3 共享
        "The straw lid with push-open mechanism is a feature of this Stainless Steel bottle.",
        // bullet2: 锚 care
        "Dishwasher-safe removable parts are included with this bottle.",
        // bullet3: 锚 material — 与 bullet1 共享 "Stainless Steel" 硬事实值
        "Stainless Steel is the material of this bottle.",
      ],
      description: "The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["functional_feature", "care", "material"],
      humanReviewRequired: true,
    }));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441972", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    // 同一 material 硬事实进入两条 → 绑定拒绝 → 安全回退（不得 ai_optimized）
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(true);
    expect((result.draft?.qualityIssues ?? []).join(" ")).toContain("核心事实重复");
  }, 60_000);
});


  it("红：结构化回退（Provider 失败）的 keywords/backend 也不含竞品品牌", async () => {
    const taskId = "sandbox-lfc-structured-brand";
    await setupHandoff(taskId, true);
    const brief = buildListingKeywordBrief({ primaryKeyword: "owala bottle", supportingKeywords: ["water bottle"], backendSearchTerms: ["owala cup"], source: "synthetic", capturedAt: NOW });
    if (!brief.ok) throw new Error("brief build failed");
    await mutateTaskResultJson({ context: visitorContext(), taskId, writer: "keyword-brief", async mutate(current) { return { result: { ...current, listingKeywordBrief: brief.brief as unknown as Record<string, unknown> }, value: { saved: true } }; } });
    // Provider 失败 → 结构化回退
    setTaskLinkedAiListingClientForTests(async () => { throw { code: "ai_provider_error", message: "off" }; });
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441973", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    const d = result.draft!;
    expect(d.draftKind).toBe("structured_listing_draft");
    const allKw = [...(d.keywords ?? []), ...((d.backendSearchTerms ?? []) as string[])].join(" ").toLowerCase();
    expect(allKw).not.toContain("owala");
  }, 60_000);


// ── LISTING_COPY_QUALITY：HydroJug 坏稿必须被拦截（事实安全 + 文案质量双门禁） ──
describe("LISTING_COPY_QUALITY：坏稿拦截（事实安全 + 文案质量）", () => {
  it("红：Leak Proof 历史值不得进入正式字段（review/prohibited → 无合格草稿或无泄漏）", async () => {
    const taskId = "sandbox-cq-leakproof";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    // 注入高风险值 Leak Proof 的 AI 输出
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "HydroJug 40oz Tumbler",
      bullets: [
        "The Tumbler with leak proof for everyday use.",
        "The Tumbler with dishwasher safe for easy cleaning.",
        "The Tumbler with stainless steel for practical use.",
      ],
      description: "The HydroJug Tumbler with leak proof and double wall insulation.",
      backendSearchTerms: ["water bottle"],
      usedFactIds: ["functional_feature", "care", "material"],
      humanReviewRequired: true,
    }));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441999", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    const d = result.draft!;
    const formal = [String(d.titles[0] ?? ""), ...d.bullets, String(d.description ?? "")].join(" ").toLowerCase();
    expect(formal).not.toMatch(/leak\s*[- ]?proof/);
  }, 60_000);

  it("红：pairs with / option fits / Available construction 模板句 → copy quality 拦截（不得 ai_optimized）", async () => {
    const taskId = "sandbox-cq-template";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Water Bottle",
      bullets: [
        "The straw lid option fits the everyday use of this Water Bottle.",
        "The Water Bottle pairs with the straw lid for easy use.",
        "Available construction with the straw lid of this Water Bottle.",
      ],
      description: "The Water Bottle with straw lid and double wall insulation for use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["functional_feature", "construction", "care"],
      humanReviewRequired: true,
    }));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441998", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
  }, 60_000);

  it("红：AI 稿含 cannotSay 同义变体（Leak Proof → leakproof）→ 拒绝", async () => {
    const taskId = "sandbox-cq-cannotsay";
    await setupHandoff(taskId, true);
    await saveBrief(taskId);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Water Bottle",
      bullets: [
        "The straw lid with push-open mechanism for everyday use.",
        "The water bottle leak proof option for easy cleaning.",
        "Stainless Steel for practical use with this Water Bottle.",
      ],
      description: "The Water Bottle with straw lid and double wall insulation for use.",
      backendSearchTerms: ["vacuum flask"],
      usedFactIds: ["functional_feature", "care", "material"],
      humanReviewRequired: true,
    }));
    const pr = await generateCreativeHandoffPreview(taskId, visitorContext());
    const result = await generateListingDraftFromHandoff(taskId, visitorContext(), { requestId: "550e8400-e29b-41d4-a716-446655441997", expectedStorageVersion: pr.gate.storageVersion!, expectedHandoffRevision: pr.gate.currentHandoff!.currentRevision });
    expect(result.draft?.draftKind).not.toBe("ai_optimized_listing");
  }, 60_000);
});

// ── 无关键词主链合同（ListingPlan.v2.3）：无有效 KeywordBrief → 可采用合格 AI 文案，绝不伪造关键词 ──
// 合同四要素：
// (1) 事实安全且文案合格的 AI 稿照常正式采用（needs_keywords 只表示"不能做关键词优化"）；
// (2) 四类关键词字段（keywords / backendSearchTerms / usedKeywordTrace / searchOnlyKeywordTrace）必须全空；
// (3) needs_facts / needs_review 仍硬阻断，不得借伪造关键词改成 ready；
// (4) 计划状态诚实保留 needs_keywords，不得伪装 ready。
describe("无关键词主链合同：无有效 KeywordBrief → 可采用合格 AI 文案，绝不伪造关键词", () => {
  const JUNK_CANDIDATES = ["owala straw bottle", "best seller water bottle", "guaranteed leakproof flask"];
  // 事实偏薄：3 身份 + 2 规格、无功能事实 → readiness.copyReady=false（事实不足），但安全模板句仍可合格
  const THIN_FACT_FIELDS = ["brand", "product_type", "series_or_model", "material", "capacity"];

  /** 仅确认偏薄事实（无功能事实）→ copyReady=false → Provider 不得被调用（needs_facts 语义保护） */
  async function setupHandoffThinFacts(taskId: string) {
    seedTask(taskId, researchDoc());
    const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const preview1 = p1.preview!;
    const sv = preview1.storageVersion!;
    const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
    const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
    const thinIds = eligible
      .filter((c) => THIN_FACT_FIELDS.includes(c.field))
      .map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field)!.selectionId);
    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655447110",
      expectedResearchRevision: preview1.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: thinIds,
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: thinIds,
        expectedStorageVersion: sv,
        expectedResearchRevision: preview1.expectedResearchRevision,
        expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
        confirmed: true,
      }),
    });
  }

  it("NK1：Provider 成功 + 事实足够 + AI 五点与计划逐条绑定 + 无 keywordBrief → ai_optimized_listing 正式采用；计划仍 needs_keywords；四类关键词字段全空", async () => {
    const taskId = "sandbox-nk-ai-success";
    await setupHandoff(taskId, true); // 不 saveBrief → 无有效关键词方案
    let providerCalls = 0;
    let capturedPlanStatus: string | null | undefined = null;
    let capturedKeywordBrief: unknown = "sentinel-not-called";
    const valid = validAiClient();
    setTaskLinkedAiListingClientForTests(async (input) => {
      providerCalls += 1;
      capturedPlanStatus = input.plan.status ?? null;
      capturedKeywordBrief = input.keywordBrief;
      return valid(input);
    });
    try {
      const p = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655447101",
        expectedStorageVersion: p.gate.storageVersion!,
        expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
      });
      const d = result.draft!;
      // 计划状态诚实：采用合格 AI 稿的同时计划仍是 needs_keywords（不能做关键词优化），且生成时无有效 Brief
      expect(capturedPlanStatus).toBe("needs_keywords");
      expect(capturedKeywordBrief).toBeNull();
      expect(d.providerAttempted).toBe(true);
      expect(d.providerSucceeded).toBe(true);
      expect(providerCalls).toBe(1);
      expect(d.draftKind).toBe("ai_optimized_listing");
      expect(d.listingUnqualified).toBe(false);
      expect(d.fallbackApplied).toBe(false);
      // 正式标题、3–5 条五点与描述保留
      expect(d.titles[0]).toBe("Owala 24 oz Stainless Steel Water Bottle, Blue");
      expect(d.bullets).toEqual([
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        "The dishwasher-safe removable parts option is included for this Water Bottle.",
        "Stainless Steel is the material of this Water Bottle.",
      ]);
      expect(d.bullets.length).toBeGreaterThanOrEqual(3);
      expect(d.bullets.length).toBeLessThanOrEqual(5);
      expect(d.description).toBe("The Owala bottle has stainless steel and 24 oz. The straw lid with push-open mechanism is a feature of this Water Bottle.");
      // 四类关键词字段/trace 全空：不得从研究候选词、商品标题或兜底词偷偷补入
      expect(d.keywords ?? []).toEqual([]);
      expect((d.backendSearchTerms ?? []) as string[]).toEqual([]);
      expect(d.usedKeywordTrace ?? []).toEqual([]);
      expect(d.searchOnlyKeywordTrace ?? []).toEqual([]);
      expect(d.keywordPlanSource).toBe("none");
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  }, 60_000);

  it("NK2：Provider 超时 + 事实足够 + 无 keywordBrief（研究关键词候选全部不合规）→ 合格 structured fallback；研究候选词不投射为正式关键词；四空", async () => {
    const taskId = "sandbox-nk-provider-timeout";
    await setupHandoff(taskId, true, {
      keywordEvidence: {
        reportType: "SellerSprite Keyword Research",
        capturedAt: NOW,
        rows: [
          { keyword: JUNK_CANDIDATES[0], rowNumber: 1 }, // 品牌词（own brand）→ 必拒
          { keyword: JUNK_CANDIDATES[1], rowNumber: 2 }, // 绝对承诺 → 必拒
          { keyword: JUNK_CANDIDATES[2], rowNumber: 3 }, // 绝对承诺+禁止声明词面 → 必拒
        ],
      },
    });
    setTaskLinkedAiListingClientForTests(async () => {
      throw { code: "ai_timeout", message: "timed out" };
    });
    try {
      const p = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655447102",
        expectedStorageVersion: p.gate.storageVersion!,
        expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
      });
      const d = result.draft!;
      expect(d.draftKind).toBe("structured_listing_draft");
      expect(d.fallbackApplied).toBe(true);
      expect(d.providerAttempted).toBe(true);
      expect(d.providerSucceeded).toBe(false);
      expect(d.listingUnqualified).toBe(false);
      expect(d.bullets.length).toBeGreaterThanOrEqual(3);
      expect(d.bullets.length).toBeLessThanOrEqual(5);
      // 每条五点逐条锚定已确认事实值
      const anchors = ["straw lid with push-open mechanism", "dishwasher-safe removable parts", "stainless steel"];
      for (const b of d.bullets) {
        expect(anchors.some((a) => b.toLowerCase().includes(a))).toBe(true);
      }
      // 四类关键词字段/trace 全空；研究关键词候选不得投射为正式关键词或正文内容
      expect(d.keywords ?? []).toEqual([]);
      expect((d.backendSearchTerms ?? []) as string[]).toEqual([]);
      expect(d.usedKeywordTrace ?? []).toEqual([]);
      expect(d.searchOnlyKeywordTrace ?? []).toEqual([]);
      expect(d.keywordPlanSource).toBe("none");
      const kwFieldText = [...(d.keywords ?? []), ...((d.backendSearchTerms ?? []) as string[])].join(" ").toLowerCase();
      const formalText = [String(d.titles[0] ?? ""), ...d.bullets, String(d.description ?? "")].join(" ").toLowerCase();
      for (const cand of JUNK_CANDIDATES) {
        expect(kwFieldText).not.toContain(cand.toLowerCase());
        expect(formalText).not.toContain(cand.toLowerCase());
      }
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  }, 60_000);

  it("NK3：Provider 返回未绑定计划且含 cannotSay（12 hours）的文案 + 无 keywordBrief → AI 稿拒绝，只进现有安全回退；被拒内容不入正式字段；四空", async () => {
    const taskId = "sandbox-nk-cannotsay";
    await setupHandoff(taskId, true); // 不 saveBrief
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "The straw lid with push-open mechanism is a feature of this Water Bottle.",
        // 未命中其计划事实（bulletPlans[1] 绑 care），并含 cannotSay 词面 "12 hours"
        "Double-wall vacuum insulation keeps drinks cold for 12 hours in the bottle.",
        "Available with the Stainless Steel option for this Water Bottle.",
      ],
      description: "The Owala bottle has stainless steel and 24 oz. Keeps drinks cold for 12 hours everywhere you go.",
      backendSearchTerms: [],
      usedFactIds: ["functional_feature", "construction", "material"],
      humanReviewRequired: true,
    }));
    try {
      const p = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655447103",
        expectedStorageVersion: p.gate.storageVersion!,
        expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
      });
      const d = result.draft!;
      // AI 稿不得被采用：只能进入现有安全回退或诚实 unqualified
      expect(["structured_listing_draft", "safe_fact_draft"]).toContain(d.draftKind as string);
      expect(d.draftKind).not.toBe("ai_optimized_listing");
      expect(d.fallbackApplied).toBe(true);
      expect(d.providerAttempted).toBe(true);
      // 被拒内容不得进入正式字段
      const formal = [String(d.titles[0] ?? ""), ...d.bullets, String(d.description ?? "")].join(" ");
      expect(formal.toLowerCase()).not.toContain("12 hours");
      expect(formal.toLowerCase()).not.toContain("keeps drinks cold");
      // 四类关键词字段/trace 仍为空
      expect(d.keywords ?? []).toEqual([]);
      expect((d.backendSearchTerms ?? []) as string[]).toEqual([]);
      expect(d.usedKeywordTrace ?? []).toEqual([]);
      expect(d.searchOnlyKeywordTrace ?? []).toEqual([]);
      expect(d.keywordPlanSource).toBe("none");
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  }, 60_000);

  it("NK4：needs_facts 回归保护——即使 mock AI 文案本身格式正确，也不得成为 ai_optimized_listing；伪造关键词 brief 不得把状态改成 ready 或触发 Provider", async () => {
    const taskId = "sandbox-nk-needs-facts";
    await setupHandoffThinFacts(taskId); // 无功能事实 → 事实不足（copyReady=false）
    // 直接写入持久层的伪造关键词方案：与商品零相关的垃圾词（必须被相关度门 fail-closed 拒绝）
    const junk = buildListingKeywordBrief({
      primaryKeyword: "qwerty zzz gadget xyz",
      supportingKeywords: ["spam nonsense token"],
      backendSearchTerms: ["fake seo filler"],
      source: "synthetic",
      capturedAt: NOW,
    });
    if (!junk.ok) throw new Error("brief build failed");
    await mutateTaskResultJson({
      context: visitorContext(),
      taskId,
      writer: "keyword-brief",
      async mutate(current) {
        return { result: { ...current, listingKeywordBrief: junk.brief as unknown as Record<string, unknown> }, value: { saved: true } };
      },
    });
    let providerCalls = 0;
    setTaskLinkedAiListingClientForTests(async () => {
      providerCalls += 1;
      return validAiClient()({} as never);
    });
    try {
      const p = await generateCreativeHandoffPreview(taskId, visitorContext());
      const result = await generateListingDraftFromHandoff(taskId, visitorContext(), {
        requestId: "550e8400-e29b-41d4-a716-446655447104",
        expectedStorageVersion: p.gate.storageVersion!,
        expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
      });
      const d = result.draft!;
      // 事实不足 ⇒ Provider 根本不被调用 ⇒ 即便 mock 文案格式正确也绝不成为 ai_optimized_listing
      expect(providerCalls).toBe(0);
      expect(d.providerAttempted).toBe(false);
      expect(d.draftKind).not.toBe("ai_optimized_listing");
      expect(d.draftKind).toBe("safe_fact_draft");
      // 伪造关键词未被采纳：四类关键词字段/trace 全空，垃圾词不得出现在任何对外字段
      expect(d.keywords ?? []).toEqual([]);
      expect((d.backendSearchTerms ?? []) as string[]).toEqual([]);
      expect(d.usedKeywordTrace ?? []).toEqual([]);
      expect(d.searchOnlyKeywordTrace ?? []).toEqual([]);
      const dump = JSON.stringify(d).toLowerCase();
      for (const t of ["qwerty zzz gadget xyz", "spam nonsense token", "fake seo filler"]) {
        expect(dump).not.toContain(t);
      }
    } finally {
      setTaskLinkedAiListingClientForTests(null);
    }
  }, 60_000);

  it("NK5：状态门禁报警器——机器取证 needs_review 生产不可达（claimMode 恒 verified）；直测证明 needs_facts/needs_review 必须被门禁拒绝而 needs_keywords 不因状态被拒", async () => {
    // ── (a) 生产纯函数取证：多组真实形态事实输入下，buildListingPlan 永不产出 needs_review，claimMode 恒 verified ──
    const FACT_SETS: Array<Array<{ field: string; label: string; value: string }>> = [
      [ // 全谱系（身份+规格+功能，与主链 fixture 同形）
        { field: "brand", label: "品牌", value: "Owala" },
        { field: "product_type", label: "商品类型", value: "Water Bottle" },
        { field: "series_or_model", label: "系列", value: "FreeSip" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "capacity", label: "容量", value: "24 oz" },
        { field: "color_or_variant", label: "颜色", value: "Blue" },
        { field: "functional_feature", label: "功能", value: "straw lid with push-open mechanism" },
        { field: "construction", label: "结构", value: "double-wall vacuum insulation" },
        { field: "care", label: "清洁", value: "dishwasher-safe removable parts" },
      ],
      [ // 薄规格（无功能事实 → 可产出 needs_facts / needs_keywords）
        { field: "brand", label: "品牌", value: "Owala" },
        { field: "product_type", label: "商品类型", value: "Water Bottle" },
        { field: "series_or_model", label: "系列", value: "FreeSip" },
        { field: "material", label: "材质", value: "Stainless Steel" },
        { field: "capacity", label: "容量", value: "24 oz" },
      ],
      [ // 功能主导
        { field: "brand", label: "品牌", value: "Owala" },
        { field: "product_type", label: "商品类型", value: "Water Bottle" },
        { field: "functional_feature", label: "功能", value: "straw lid with push-open mechanism" },
        { field: "care", label: "清洁", value: "dishwasher-safe removable parts" },
      ],
    ];
    const planInputOf = (facts: Array<{ field: string; label: string; value: string }>) => ({
      schema: "listing-generation-input.v1" as const,
      source: { handoffRevision: 1, researchRevision: 1 },
      productFacts: facts,
      stableSourceFacts: facts,
      creativeReferences: [],
      creativePreferences: {},
      prohibitedClaims: [],
      unknowns: [],
      humanReviewRequired: true as const,
      researchMode: "market_research_only" as const,
      promotionEligible: false as const,
    });
    const observedStatuses = new Set<string>();
    for (const facts of FACT_SETS) {
      const plan = buildListingPlan(planInputOf(facts), null);
      observedStatuses.add(plan.status ?? "");
      expect(plan.status).not.toBe("needs_review"); // 构造层证据：现状生产输入不可达 needs_review
      for (const bp of plan.bulletPlans) {
        expect(bp.claimMode).toBe("verified");       // claimMode 写入恒 verified（grep 已证无 review 写点）
      }
    }
    expect(observedStatuses.has("needs_facts")).toBe(true);   // 防御分支的触发电机确实存在于纯函数内
    expect(observedStatuses.has("needs_keywords")).toBe(true);
    // 有有效 Brief 时同输入可达 ready（证明四状态中唯一不可达的是 needs_review）
    const readyPlan = buildListingPlan(planInputOf(FACT_SETS[0]!), { primaryKeyword: "water bottle", supportingKeywords: ["stainless steel bottle"], backendSearchTerms: [], source: "synthetic", capturedAt: NOW } as never);
    expect(readyPlan.status).toBe("ready");
    expect(observedStatuses.has("needs_review")).toBe(false);

    // ── (b) 门禁直测报警器：needs_facts / needs_review 无论文案多合格都必须被拒绝（语义本体红/绿） ──
    const guardFacts = FACT_SETS[0]!;
    const mkGuardPlan = (status: ListingPlanStatus) => ({
      schema: "listing-plan.v2",
      status,
      primaryKeyword: null,
      supportingKeywords: [],
      titlePlan: [],
      descriptionPlan: "",
      backendSearchTerms: [],
      missingFacts: [],
      prohibitedClaims: [],
      planQuality: "optimized",
      bulletPlans: [
        { role: "proof_or_fit", shopperAngle: "关键材质与容量选择依据", featureFactIds: ["material"], keywordIds: [] as string[], claimMode: "verified", cannotSay: [] as string[] },
        { role: "core_outcome", shopperAngle: "日常核心功能需求", featureFactIds: ["capacity"], keywordIds: [] as string[], claimMode: "verified", cannotSay: [] as string[] },
        { role: "ease_of_use", shopperAngle: "打理与清洁便利需求", featureFactIds: ["care"], keywordIds: [] as string[], claimMode: "verified", cannotSay: [] as string[] },
      ],
    }) as unknown as Parameters<typeof aiBulletsBindToPlan>[0];
    const guardBullets = [
      "Stainless Steel is the confirmed material for this water bottle.",
      "The confirmed capacity value is exactly 24 oz for this product.",
      "Dishwasher-safe removable parts are included with the care option.",
    ];
    for (const blockedStatus of ["needs_facts", "needs_review"] as ListingPlanStatus[]) {
      const verdict = aiBulletsBindToPlan(mkGuardPlan(blockedStatus), guardBullets, guardFacts);
      expect(verdict.ok).toBe(false);
      expect(verdict.issues.join(" ")).toContain(blockedStatus);
      expect(verdict.issues.join(" ")).toContain("不可采用文案");
    }
    // ── (c) 正向合同面：同一合格文案在 needs_keywords 下不得因状态被拒（其余绑定校验全过 → ok=true） ──
    const kwVerdict = aiBulletsBindToPlan(mkGuardPlan("needs_keywords"), guardBullets, guardFacts);
    expect(kwVerdict.ok).toBe(true);
    expect(kwVerdict.issues.join(" ")).not.toContain("不可采用文案");
  });
});
