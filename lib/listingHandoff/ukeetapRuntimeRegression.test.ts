/**
 * ukeetap 运行时回归（离线复现 2026-08-30T15:45 付费生成回退空 Listing）。
 *
 * 只复现必需形态（白名单外仅本文件 + 最多 2 个生产文件的确定性修复）：
 * - 真实 ukeetap 已确认事实（5 个 Plan 组 + 身份；中文事实保持中文——生成链经英文渲染转英文）；
 * - Plan-aware 合成坏稿 Provider：5 条，第 5 条为快照 rejected 原文
 *   "After placing in the drawer, expand or collapse to the sides according to the drawer width for
 *   standard use with this product every day."（未绑定已确认事实值）；
 * - 全内存 Store（不写库、不联网、无真实 Provider）。
 */
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "ukeetap-offline");
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
import { setEnglishBatchRendererForTests } from "@/lib/listingHandoff/listingEnglishRendering";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";

const NOW = "2026-08-30T15:45:00.000Z";
const DEMO = "demo-ukeetap-offline";

const UKEETAP_RENDERINGS: Record<string, string> = {
  capacity: "stores about 40 to 50 pieces of cutlery",
  usage: "suitable for daily kitchen storage and carrying",
  care: "rinse with clean water and wipe dry",
  construction: "built with an expandable multi-compartment design in molded plastic",
  operation: "expands or collapses to the sides according to the drawer width",
  compatibility: "fits most medium-sized drawers",
  included_components: "1 Expandable Silverware Organizer",
  functional_feature: "100% waterproof and guaranteed never to leak",
};

/** 快照 rejected 原文（第 5 条坏句，未绑定已确认事实值） */
const BAD_BULLET_5 = "After placing in the drawer, expand or collapse to the sides according to the drawer width for standard use with this product every day.";

/**
 * 精确自然句合同（本轮）：确定性兜底必须逐字符产出这 5 条。
 * 每条由「字段 + 英文 rendering 短语形态」唯一确定，rendering 原文 verbatim 嵌入（事实锚点不丢）：
 * 1 construction（`built with …` 分词补语）→ The {type} is {value}.
 * 2 capacity（`stores …` 三单谓语）      → The {type} {value}.
 * 3 operation（`expands …` 三单谓语）    → The {type} {value}.
 * 4 usage（`suitable for …` 形容词补语） → The {type} is {value}.
 * 5 care（`rinse …` 祈使短语）           → For care, {value}.
 */
const EXPECTED_NATURAL_BULLETS = [
  "The Organizer is built with an expandable multi-compartment design in molded plastic.",
  "The Organizer stores about 40 to 50 pieces of cutlery.",
  "The Organizer expands or collapses to the sides according to the drawer width.",
  "The Organizer is suitable for daily kitchen storage and carrying.",
  "For care, rinse with clean water and wipe dry.",
] as const;

/** 旧万能帧产出的五类病句（必须被真实 Copy Quality 拒绝，不得再出现在正式输出） */
const LEGACY_BAD_BULLETS = [
  "The Organizer with built with an expandable multi-compartment design in molded plastic for everyday use.",
  "This stores about 40 to 50 pieces of cutlery for easy use with the Organizer.",
  "expands or collapses to the sides according to the drawer width for standard use with this product every day.",
  "suitable for daily kitchen storage and carrying for standard use with this product.",
  "The Organizer available with rinse with clean water and wipe dry for practical use.",
] as const;

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = process.env.DEMO_SANDBOX_STORE_PATH!;
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "ukeetap Extra Large Expandable Silverware Organizer", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

function researchDoc() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: "candidate-ukeetap", runId: "run-ukeetap",
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
  const context = {
    candidateId: "candidate-ukeetap",
    productName: "ukeetap Extra Large Expandable Silverware Organizer, Flatware Tray, Black",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0GZRLKJT8",
    productUrl: "https://www.amazon.com/dp/B0GZRLKJT8",
    title: "ukeetap Extra Large Expandable Silverware Organizer, Flatware Tray, Black",
    brand: "ukeetap",
    category: "Kitchen & Dining",
    priceUsd: 16.98,
    rating: 4.7,
    reviewCount: 7221,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "silverware organizer",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: NOW,
    contextHash: "a".repeat(64),
    sellerSpriteSourceRaw: {
      detailAttributes: "Brand: ukeetap | Material: Plastic | Type: Organizer | Color: Silver | Capacity: 可收纳约 40-50 件常用餐具",
      sku: "Color: Silver",
      sellingPoints: "可扩展设计，多隔层结构",
    },
  };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification,
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-25T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" }, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function confirmableFacts(): Array<{ field: string; value: string }> {
  const owner = { mode: "visitor", subjectFingerprint: "f".repeat(16) };
  const identification = [
    { factId: "f-brand", field: "brand", value: "ukeetap" },
    { factId: "f-type", field: "product_type", value: "Organizer" },
    { factId: "f-series", field: "series_or_model", value: "UTO001" },
    { factId: "f-material", field: "material", value: "Plastic" },
    { factId: "f-capacity", field: "capacity", value: "可收纳约 40–50 件常用餐具" },
    { factId: "f-usage", field: "usage", value: "适合日常厨房收纳与外出携带" },
    { factId: "f-care", field: "care", value: "可用清水冲洗并擦干" },
    { factId: "f-construction", field: "construction", value: "采用可扩展式设计，多隔层结构" },
    { factId: "f-operation", field: "operation", value: "放入抽屉后，根据抽屉宽度向两侧展开或收拢" },
    { factId: "f-compatibility", field: "compatibility", value: "适用于多数中等尺寸抽屉" },
    { factId: "f-included", field: "included_components", value: "1 Expandable Silverware Organizer" },
  ];
  return identification.map((f) => ({
    factId: f.factId, field: f.field, label: f.field, value: f.value,
    evidenceTier: "human_confirmed", usageScopes: ["listing", "internal"],
    sourceRef: { sourceKind: "user_confirmation", sourceField: f.field, confirmedBy: owner, confirmedAt: NOW, confirmationReference: `fact-candidates:${f.field}` },
    confirmedAt: NOW, confirmedBy: owner,
  }));
}

async function setupHandoff(taskId: string, options: {
  includeProhibitedFact?: boolean;
  includeRuntimeEnglishFacts?: boolean;
} = {}) {
  seedTask(taskId, researchDoc());
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview1 = p1.preview!;
  const sv = preview1.storageVersion!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const eligible = confirmables.filter((c) => c.allowedUsageScopes.includes("listing"));
  const fields = ["brand", "product_type", "series_or_model", "material"];
  const seenField = new Set<string>();
  const selected = eligible.filter((c) => {
    if (!fields.includes(c.field) || seenField.has(c.field)) return false;
    seenField.add(c.field);
    return true;
  });
  const selectedIds = selected.map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c!.field)!.selectionId);
  // 功能事实：用户「已核实」手动确认（语义同 integration FUNCTIONAL_MANUAL 路径）
  const manualConfirmedFacts = [
    { field: "capacity" as const, value: "可收纳约 40–50 件常用餐具" },
    { field: "usage" as const, value: "适合日常厨房收纳与外出携带" },
    { field: "care" as const, value: "可用清水冲洗并擦干" },
    { field: "construction" as const, value: "采用可扩展式设计，多隔层结构" },
    { field: "operation" as const, value: "放入抽屉后，根据抽屉宽度向两侧展开或收拢" },
    { field: "compatibility" as const, value: "适用于多数中等尺寸抽屉" },
    { field: "included_components" as const, value: "1 Expandable Silverware Organizer" },
    ...(options.includeRuntimeEnglishFacts
      ? [
          { field: "color_or_variant" as const, value: "Silver" },
          { field: "dimensions" as const, value: "16.5\"D x 21\"W x 1.77\"H" },
          { field: "weight" as const, value: "0.81 kg" },
          { field: "quantity_or_pack_size" as const, value: "1 Count" },
          { field: "functional_feature" as const, value: "Extra Large Capacity, Expandable, Sturdy" },
          { field: "other" as const, value: "Expandable design with multiple compartments for organizing forks, spoons, knives and kitchen utensils." },
        ]
      : []),
    ...(options.includeProhibitedFact
      ? [{ field: "functional_feature" as const, value: "100% 防水，保证永不漏水" }]
      : []),
  ];
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655441500",
    expectedResearchRevision: preview1.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: sv,
    selectedFactCandidateIds: selectedIds,
    manualConfirmedFacts,
    requestFingerprint: buildRequestFingerprint({
      action: "create",
      selectedFactIds: selectedIds,
      manualConfirmedFacts,
      expectedStorageVersion: sv,
      expectedResearchRevision: preview1.expectedResearchRevision,
      expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    }),
  });
  return { preview1 };
}

async function runGeneration(taskId: string, fakeClient: TaskLinkedAiListingClient) {
  setTaskLinkedAiListingClientForTests(fakeClient);
  const p = await generateCreativeHandoffPreview(taskId, visitorContext());
  return generateListingDraftFromHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655441501",
    expectedStorageVersion: p.gate.storageVersion!,
    expectedHandoffRevision: p.gate.currentHandoff!.currentRevision,
  });
}

beforeAll(() => {
  setEnglishBatchRendererForTests(async (facts) =>
    facts.map((f) => ({ factId: f.factId, english: UKEETAP_RENDERINGS[f.factId] ?? String(f.sourceValue) })),
  );
});
afterAll(() => {
  setEnglishBatchRendererForTests(null);
  setTaskLinkedAiListingClientForTests(null as never);
});

describe("ukeetap 离线回归（坏 Provider 稿 → 5 条 Plan 绑定确定性兜底）", () => {
  it("真实路由形态：中文确认事实完成英文化后，不得被旧组合草稿提前拦截", async () => {
    const taskId = "sandbox-ukeetap-rendered-route-preflight";
    await setupHandoff(taskId);
    const provider = vi.fn(async () => ({})) as TaskLinkedAiListingClient;
    const composition = await import("@/lib/listingHandoff/listingComposition");
    const legacyDraft = {
      source: "deterministic_composition_v1" as const,
      version: 1,
      generatedAt: NOW,
      model: "listing-composer-v1",
      composerVersion: "listing-composer-v1",
      generationPolicyVersion: "listing-generation-policy-v1",
      polishApplied: false,
      polishModel: null,
      humanReviewRequired: true as const,
      titles: ["The Organizer weighs 999 kg."],
      bullets: [
        "The Organizer weighs 999 kg.",
        "The Organizer weighs 999 kg.",
        "The Organizer weighs 999 kg.",
      ],
      description: "The Organizer weighs 999 kg.",
      keywords: [],
      sellingPoints: ["The Organizer weighs 999 kg."],
      riskNotes: ["Legacy composition candidate."],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: ["Review facts."],
    };
    const legacySpy = vi.spyOn(composition, "buildDeterministicListingPackDraft").mockReturnValue(legacyDraft);
    try {
      const result = await runGeneration(taskId, provider);
      expect(provider).toHaveBeenCalledOnce();
      expect(result.draft?.draftKind).toBe("structured_listing_draft");
      expect(result.draft?.bullets).toHaveLength(5);
      expect(result.draft?.listingUnqualified).toBe(false);
      expect(result.draft?.factSafe).toBe(true);
      expect(result.draft?.copyQuality).toBe(true);
      expect(result.draft?.bullets).toEqual([...EXPECTED_NATURAL_BULLETS]);
    } finally {
      legacySpy.mockRestore();
    }
  });

  it("真实英文化失败形态：排除无法英文化的中文事实后仍用安全英文事实继续生成", async () => {
    const taskId = "sandbox-ukeetap-rendering-provider-failed";
    await setupHandoff(taskId, { includeRuntimeEnglishFacts: true });
    setEnglishBatchRendererForTests(async () => []); // 复现真实 Provider 未返回可用英文化结果
    const providerInputs: Parameters<TaskLinkedAiListingClient>[0][] = [];
    const provider = vi.fn(async (input: Parameters<TaskLinkedAiListingClient>[0]) => {
      providerInputs.push(input);
      return {}; // 强制走确定性兜底，避免测试依赖 AI 文案。
    }) as TaskLinkedAiListingClient;

    try {
      const result = await runGeneration(taskId, provider);
      expect(provider).toHaveBeenCalledOnce();
      expect(providerInputs).toHaveLength(1);
      expect(providerInputs[0].facts.some((f) => /[一-鿿㐀-䶿]/.test(f.value))).toBe(false);
      // Provider 返回空对象时，仍应从已确认且可安全渲染的英文事实生成正式五点。
      expect(result.draft?.draftKind).toBe("structured_listing_draft");
      expect(result.draft?.bullets).toHaveLength(3);
      expect(result.draft?.listingUnqualified).toBe(false);
      expect(result.draft?.factSafe).toBe(true);
      expect(result.draft?.copyQuality).toBe(true);
      const formalCopy = result.draft?.bullets.join(" ").toLowerCase() ?? "";
      expect(formalCopy).not.toContain("food safe");
      expect(formalCopy).not.toContain("waterproof");
      expect(formalCopy).not.toContain("sturdy");
      expect(formalCopy).not.toContain("1 count");
      expect(result.draft?.factSafe).toBe(true);
    } finally {
      setEnglishBatchRendererForTests(async (facts) =>
        facts.map((f) => ({ factId: f.factId, english: UKEETAP_RENDERINGS[f.factId] ?? String(f.sourceValue) })),
      );
    }
  });

  it("正式主链先排除 prohibited：其余 5 组继续生成，禁事实不花翻译费用也不进入 Provider", async () => {
    const taskId = "sandbox-ukeetap-prohibited-local-exclusion";
    await setupHandoff(taskId, { includeProhibitedFact: true });

    const renderedFactIds: string[] = [];
    setEnglishBatchRendererForTests(async (facts) => {
      renderedFactIds.push(...facts.map((f) => f.factId));
      return facts.map((f) => ({ factId: f.factId, english: UKEETAP_RENDERINGS[f.factId] ?? String(f.sourceValue) }));
    });
    const providerInputs: Parameters<TaskLinkedAiListingClient>[0][] = [];
    const provider = vi.fn(async (input: Parameters<TaskLinkedAiListingClient>[0]) => {
      providerInputs.push(input);
      return {}; // 结构不合格，强制走同受门禁的确定性兜底；本测试只验证生成入口不会提前 422。
    }) as TaskLinkedAiListingClient;

    try {
      const result = await runGeneration(taskId, provider);
      expect(provider).toHaveBeenCalledOnce();
      expect(renderedFactIds).not.toContain("functional_feature");
      expect(providerInputs).toHaveLength(1);
      expect(providerInputs[0].facts.some((f) => f.factId === "functional_feature")).toBe(false);
      const draft = result.draft!;
      expect(draft.bullets).toHaveLength(5);
      expect(draft.listingUnqualified).toBe(false);
      expect(draft.factSafe).toBe(true);
      const formalCopy = [draft.titles.join(" "), draft.bullets.join(" "), draft.description ?? ""].join(" ").toLowerCase();
      expect(formalCopy).not.toContain("100%");
      expect(formalCopy).not.toContain("guaranteed");
      expect(formalCopy).not.toContain("never to leak");
    } finally {
      setEnglishBatchRendererForTests(async (facts) =>
        facts.map((f) => ({ factId: f.factId, english: UKEETAP_RENDERINGS[f.factId] ?? String(f.sourceValue) })),
      );
    }
  });

  it("归因：结构化回退 optimized bullets 逐条 Claim Evidence 判定", async () => {
    const taskId = "sandbox-ukeetap-offline-attrib";
    await setupHandoff(taskId);
    const { buildListingInputFromCreativeHandoff } = await import("@/lib/listingHandoff/listingGenerationInput");
    const { evaluateListingCapabilityFromPolicy } = await import("@/lib/listingHandoff/listingCapabilityEvaluation");
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const handoff = p.gate.currentHandoff!;
    const build = buildListingInputFromCreativeHandoff(handoff, 1);
    if (!build.ok) throw new Error("build failed: " + build.message);
    const { buildListingPlanFromCapability } = await import("@/lib/listingHandoff/listingPlan");
    const evalResult = evaluateListingCapabilityFromPolicy({
      input: build.input,
      confirmedFacts: handoff.versions[handoff.versions.length - 1].confirmedFacts.map((f) => ({
        field: String(f.field ?? ""), value: String(f.value ?? ""),
        evidenceTier: String((f as { evidenceTier?: string }).evidenceTier ?? ""),
        sourceRef: f.sourceRef as { sourceKind?: string } | undefined,
      })),
      extraProhibitedTerms: [],
      hasBlockingIssue: false,
    });
    const plan = buildListingPlanFromCapability(build.input, null, evalResult.capability);
    const { composeOptimizedListingDraft } = await import("@/lib/listingHandoff/listingComposition");
    // 注入渲染后的输入（生成链等价：manualConfirmed 中文值 → batch renderer 英文）
    const renderedInput = {
      ...build.input,
      productFacts: build.input.productFacts.map((f) => ({
        ...f,
        value: UKEETAP_RENDERINGS[f.field] ?? f.value,
      })),
    };
    const optimized = composeOptimizedListingDraft(renderedInput, plan, null);
    const { verifyListingClaims } = await import("@/lib/listingHandoff/listingClaimEvidenceResolver");
    const verification = verifyListingClaims({ ...optimized, sellingPoints: [], riskNotes: [], complianceWarnings: [], blockedClaims: [], reviewChecklist: [] } as never, renderedInput);
    // 5 组各产出 1 条；逐字符符合精确自然句合同
    expect(optimized.bullets.length).toBe(5);
    expect(optimized.bullets).toEqual([...EXPECTED_NATURAL_BULLETS]);
    // 逐 Plan 绑定：第 i 条必须锚定第 i 个 Plan 组的某个确认事实渲染值（verbatim）
    plan.bulletPlans.forEach((bp, i) => {
      const values = bp.featureFactIds
        .map((fid) => UKEETAP_RENDERINGS[fid] ?? "")
        .filter(Boolean)
        .map((v) => v.toLowerCase());
      expect(
        values.some((v) => optimized.bullets[i].toLowerCase().includes(v)),
        "bullet " + (i + 1) + " 未锚定其 Plan 组事实：" + optimized.bullets[i],
      ).toBe(true);
    });
    // 五条均通过真实 Copy Quality（结构维度：有谓语/合法祈使、无模板尾、句首大写）
    const { validateCopyQualityContract } = await import("@/lib/listingHandoff/listingRuntimeSkill");
    const copy = validateCopyQualityContract({
      title: optimized.titles[0] ?? "",
      bullets: optimized.bullets,
      description: "The Organizer is made of molded plastic with multiple compartments. It stores about 40 to 50 pieces of cutlery.",
      facts: renderedInput.productFacts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: f.value })),
      typeLabel: "Organizer",
    });
    expect(copy.ok, JSON.stringify(copy.issues)).toBe(true);
    // 旧五类病句必须被真实 Copy Quality 逐条拒绝（不得靠黑名单，靠结构维度）
    for (const bad of LEGACY_BAD_BULLETS) {
      const r = validateCopyQualityContract({
        title: optimized.titles[0] ?? "",
        bullets: [bad],
        description: "The Organizer is made of molded plastic with multiple compartments. It stores about 40 to 50 pieces of cutlery.",
        facts: renderedInput.productFacts.map((f) => ({ factId: f.field, field: f.field, label: f.label, value: f.value })),
        typeLabel: "Organizer",
      });
      expect(r.ok, "旧病句未被拒绝：" + bad).toBe(false);
      expect(
        r.issues.some((i) => ["sentence_fragment", "template_tail", "sentence_capitalization"].includes(i.code)),
        "旧病句未给出结构原因码：" + bad + " → " + JSON.stringify(r.issues),
      ).toBe(true);
    }
    // Claim Evidence 零 unsupported（坏句拒绝在 AI 层验证，此处为确定性兜底结果）
    expect(verification.unsupportedClaims.length, JSON.stringify(verification.unsupportedClaims)).toBe(0);
  });

  it("复现：坏稿（第5条未绑定事实）回退后，系统产出 5 条正式 bullets（listingUnqualified=false）", async () => {
    const taskId = "sandbox-ukeetap-offline-1";
    await setupHandoff(taskId);
    const result = await runGeneration(taskId, (async (input) => {
      const plans = Array.isArray(input.plan?.bulletPlans) ? input.plan.bulletPlans : [];
      const facts = (input.facts ?? []).filter((f) => typeof f?.value === "string" && f.value.trim().length > 0);
      const byId = new Map(facts.map((f) => [String(f.factId ?? ""), String(f.value ?? "").trim()]));
      const bullets = plans.slice(0, 4).map((bp) => {
        const first = (bp.featureFactIds ?? [])[0] ?? "";
        return String(byId.get(first) ?? "") + " is a key feature of this Organizer.";
      });
      bullets.push(BAD_BULLET_5);
      return {
        title: "ukeetap Organizer UTO001",
        bullets,
        description: "This Organizer expands to fit the drawer and stores about 40 to 50 pieces of cutlery.",
        backendSearchTerms: [],
        usedFactIds: [...new Set((plans.slice(0, 4).map((bp) => (bp.featureFactIds ?? [])[0] ?? "").filter(Boolean)))],
        humanReviewRequired: true,
      };
    }) as TaskLinkedAiListingClient);
    const draft = result.draft!;
    // 坏句仍被拒（不得放宽）：回退必须发生
    expect(draft.fallbackApplied).toBe(true);
    // 确定性兜底：5 条正式 bullets、不空，且逐字符符合精确自然句合同
    expect(draft.bullets.length).toBe(5);
    expect(draft.bullets).toEqual([...EXPECTED_NATURAL_BULLETS]);
    expect(draft.listingUnqualified).toBe(false);
    // 事实安全 + 质量：factSafe/copyQuality 通过；坏稿拒绝记录保留（issues 含 AI 拒绝）
    expect(draft.factSafe).toBe(true);
    expect(draft.copyQuality).toBe(true);
    expect((draft.qualityIssues ?? []).join(" ")).toContain("AI 最终草稿未通过 Claim Evidence");
    // 5 条互不重复 + 每条 8-30 词 + 锚定各组事实渲染值
    expect(new Set(draft.bullets).size).toBe(5);
    for (const b of draft.bullets) {
      const wc = b.trim().split(/\s+/).filter(Boolean).length;
      expect(wc).toBeGreaterThanOrEqual(8);
      expect(wc).toBeLessThanOrEqual(30);
      expect(/[.!?]$/.test(b.trim())).toBe(true);
    }
  });
});
