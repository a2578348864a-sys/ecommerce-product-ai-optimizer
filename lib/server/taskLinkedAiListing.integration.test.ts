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

import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { generateListingDraftFromHandoff } from "@/lib/listingHandoff/listingGenerationService";
import { setTaskLinkedAiListingClientForTests, type TaskLinkedAiListingClient } from "@/lib/server/taskLinkedAiListing";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildListingKeywordBrief } from "@/lib/listingHandoff/listingKeywordBrief";
import { mutateTaskResultJson } from "@/lib/server/taskResultJsonMutation";

const NOW = "2026-08-09T19:43:44.103Z";
const DEMO = "demo-quality2";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId = "candidate-quality2") {
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
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
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

async function setupHandoff(taskId: string, withFunctional: boolean) {
  seedTask(taskId, researchDoc());
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

function validAiClient(): TaskLinkedAiListingClient {
  return async () => ({
    title: "Owala FreeSip Water Bottle 24 oz Stainless Steel, Blue",
    bullets: [
      "straw lid with push-open mechanism",
      "double-wall vacuum insulation",
      "dishwasher-safe removable parts",
      "Owala FreeSip Water Bottle, 24 oz Stainless Steel, Blue",
    ],
    description: "Owala FreeSip Water Bottle. straw lid with push-open mechanism、double-wall vacuum insulation、dishwasher-safe removable parts。24 oz Stainless Steel, Blue。",
    backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
    usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
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
    expect(result.draft?.usedFactIds).toEqual(["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"]);
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
    expect(result.draft?.draftKind).toBe("safe_fact_draft");
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
    expect(result.draft?.draftKind).toBe("safe_fact_draft");
    expect(result.draft?.fallbackApplied).toBe(true);
  });

  it("R3：R1.9 真实输出 Schema/Quality 通过但 Claim 失败时，保存 structured fallback", async () => {
    const taskId = "sandbox-q2-r19-claim-gate";
    await setupHandoff(taskId, true);
    setTaskLinkedAiListingClientForTests(async () => ({
      title: "Owala FreeSip Water Bottle 24 oz Stainless Steel, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction fits most cup holders.",
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
    expect(result.draft?.providerSucceeded).toBe(false);
    expect(result.draft?.fallbackApplied).toBe(true);
    expect(result.draft?.fallbackReason).toBe("AI 文案包含未经确认的信息，已保留安全草稿。");
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
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle",
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
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
      bullets: ["Push-open straw lid makes drinking easy for daily use.", "Double-wall insulation keeps drinks at temperature for commutes.", "Dishwasher-safe parts make cleaning simple and convenient."],
      description: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
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
    expect(result.draft?.fallbackReason).toContain("unknown fields");
  });

  it("R1.2 回归：AI 不返回 usedKeywordIds → Schema PASS + 服务器派生 provenance", async () => {
    const result = await generateWithAi("sandbox-q2-r1-2-regress", async () => ({
      title: "Owala FreeSip Insulated Water Bottle 24 oz Stainless Steel, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.fallbackApplied).toBe(false);
  });

  it("R1.4 回归：AI 返回 55 字符 Title → PASS（无 fallback，advisory 不阻断）", async () => {
    const result = await generateWithAi("sandbox-q2-r1-4-regress", async () => ({
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
      humanReviewRequired: true,
    }));
    expect(result.draft?.draftKind).toBe("ai_optimized_listing");
    expect(result.draft?.providerSucceeded).toBe(true);
    expect(result.draft?.fallbackApplied).toBe(false);
    expect(result.draft?.fallbackReason).toBeNull();
  });

  it("R1.6 回归：无 leakproof fact → 'leakproof tumbler' 被安全过滤，其余保留，仍 ai_optimized_listing", async () => {
    const result = await generateWithAi("sandbox-q2-r1-6-regress", async () => ({
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "leakproof tumbler", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
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
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "carry water bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
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
      title: "Owala FreeSip 24 oz Stainless Steel Water Bottle, Blue",
      bullets: [
        "Push-open straw lid makes one-handed drinking easy, ideal for everyday carry.",
        "Double-wall vacuum insulation keeps drinks at temperature for commutes and outings.",
        "Dishwasher-safe removable parts make cleaning simple and convenient.",
        "24 oz stainless steel construction suits home, office and travel use.",
      ],
      description: "The Owala FreeSip insulated water bottle combines a push-open straw lid with double-wall vacuum insulation for everyday hydration. The 24 oz stainless steel body and dishwasher-safe parts make it a practical choice for home, office and travel.",
      backendSearchTerms: ["vacuum flask", "sports hydration bottle"],
      usedFactIds: ["functional_feature", "construction", "care", "material", "capacity", "brand", "product_type"],
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
