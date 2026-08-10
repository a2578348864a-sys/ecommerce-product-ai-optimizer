import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "yeti-image");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { buildRequestFingerprint } from "@/lib/creativeHandoffRequestLedger";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { buildImageInputFromCreativeHandoff } from "@/lib/imageHandoff/imageGenerationInput";
import { buildImagePromptFromInput, assertImagePromptIsSafe } from "@/lib/imageHandoff/imagePrompt";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";

const NOW = "2026-08-10T00:00:00.000Z";
const DEMO = "demo-yeti-image";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

// 真实 XLSX YETI（与 Golden Case 同 fixture）+ 内嵌主图（1x1 png dataUrl）
const FAKE_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function researchDoc() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId: "candidate-yeti-img", runId: "run-yeti-img",
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
    candidateId: "candidate-yeti-img",
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
    productImage: {
      dataUrl: FAKE_PNG,
      mimeType: "image/png",
      contentHash: "f".repeat(64),
      provenance: "candidate_fallback",
    },
    sellerSpriteSourceRaw: {
      detailAttributes: "Brand: YETI | Material: Stainless Steel | Bottle Type: Insulated Bottle | Color: Mist/Pink/Grasshopper | Capacity: 12 ounces",
      sku: "Color: Mist/Pink/Grasshopper",
      sellingPoints: "Dishwasher Safe - bottle and lid are dishwasher safe\n18/8 stainless steel - built to take all dents and drops\nNo sweat design - keeps hands dry",
    },
  };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function seedTask(taskId: string) {
  const storePath = join(tmpdir(), "yeti-image", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "YETI Rambler Jr.", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson: researchDoc(), productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

async function setupConfirmed(taskId: string) {
  seedTask(taskId);
  const p1 = await generateCreativeHandoffPreview(taskId, visitorContext());
  const preview1 = p1.preview!;
  const confirmables = buildConfirmableCandidates(p1.gate.candidate!.stableSourceFacts);
  const elig = confirmables.filter((c) => c.allowedUsageScopes.includes("listing") || c.allowedUsageScopes.includes("image"));
  const pick = (f: string, v?: string) => elig.find((c) => c.field === f && (v === undefined || String(c.value) === v));
  const sel = [pick("brand", "YETI"), pick("product_type", "Bottle"), pick("material"), pick("color_or_variant")].filter((c): c is NonNullable<typeof c> => c !== undefined);
  const ids = sel.map((c) => preview1.confirmableFactCandidates!.find((pc) => pc.canonicalField === c.field && String(pc.displayValue) === String(c.value))!.selectionId);
  const manual = [{ field: "care" as const, value: "dishwasher-safe bottle and lid" }];
  await createOrAppendCreativeHandoff(taskId, visitorContext(), {
    requestId: "550e8400-e29b-41d4-a716-446655441700",
    expectedResearchRevision: preview1.expectedResearchRevision!,
    expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
    expectedStorageVersion: preview1.storageVersion!,
    selectedFactCandidateIds: ids,
    manualConfirmedFacts: manual,
    requestFingerprint: buildRequestFingerprint({
      action: "create",
      selectedFactIds: ids,
      manualConfirmedFacts: manual,
      expectedStorageVersion: preview1.storageVersion!,
      expectedResearchRevision: preview1.expectedResearchRevision!,
      expectedCurrentHandoffRevision: preview1.expectedCurrentHandoffRevision ?? 0,
      confirmed: true,
    }),
  });
  return p1;
}

describe("SellerSprite → Image Shared Facts Wiring", () => {
  it("确认后 confirmedFacts usageScopes 含 image（共享事实）", async () => {
    const taskId = "sandbox-yeti-image-1";
    await setupConfirmed(taskId);
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const confirmed = p.gate.currentHandoff!.versions[p.gate.currentHandoff!.versions.length - 1].confirmedFacts;
    const imageScoped = confirmed.filter((f) => f.usageScopes.includes("image"));
    console.log("IMG_SCOPED:", JSON.stringify(imageScoped.map((f) => `${f.field}:${String(f.value).slice(0, 25)}:${f.usageScopes.join(",")}`)));
    expect(imageScoped.length).toBeGreaterThanOrEqual(4);
    expect(imageScoped.some((f) => f.field === "material" && f.value === "Stainless Steel")).toBe(true);
    expect(imageScoped.some((f) => f.field === "care")).toBe(true);
  });

  it("Image Generation Input 白底主图：含共享 facts + approved visual reference；不含 market signals", async () => {
    const taskId = "sandbox-yeti-image-2";
    await setupConfirmed(taskId);
    // 确认 append 后 revision/storageVersion 已变化 → 从最新 preview 取候选再批准
    const pRef = await generateCreativeHandoffPreview(taskId, visitorContext());
    const candidates = pRef.gate.visualReferenceCandidates ?? [];
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    await createOrAppendCreativeHandoff(taskId, visitorContext(), {
      requestId: "550e8400-e29b-41d4-a716-446655441701",
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
      expectedStorageVersion: pRef.preview!.storageVersion!,
      selectedFactCandidateIds: [],
      selectedVisualReferenceCandidateIds: [candidates[0].selectionId],
      requestFingerprint: buildRequestFingerprint({
        action: "create",
        selectedFactIds: [],
        selectedVisualReferenceIds: [candidates[0].selectionId],
        expectedStorageVersion: pRef.preview!.storageVersion!,
        expectedResearchRevision: 1,
        expectedCurrentHandoffRevision: pRef.gate.currentHandoff!.currentRevision,
        confirmed: true,
      }),
    });

    const p2 = await generateCreativeHandoffPreview(taskId, visitorContext());
    const gate = await (async () => {
      // image-generation-input 从 handoff 构建（与 imageHandoff 路由同源）
      const { readFileSync } = await import("node:fs");
      const store = JSON.parse(readFileSync(join(tmpdir(), "yeti-image", "sandbox.json"), "utf8"));
      const task = store.tasks.find((t: { id: string }) => t.id === taskId);
      const result = JSON.parse(task.resultJson);
      return { result, preview: p2 };
    })();
    const inputResult = buildImageInputFromCreativeHandoff(
      p2.gate.currentHandoff!,
      1,
    );
    expect(inputResult.ok).toBe(true);
    const input = inputResult.ok ? inputResult.input : null;
    const facts = input!.productFacts.map((f) => `${f.field}:${f.value}`);
    expect(facts.some((f) => f.includes("brand:YETI"))).toBe(true);
    expect(facts.some((f) => f.includes("material:Stainless Steel"))).toBe(true);
    expect(facts.some((f) => f.includes("product_type:Bottle"))).toBe(true);
    // market signals 排除
    expect(facts.some((f) => f.includes("price"))).toBe(false);
    expect(facts.some((f) => f.includes("rating"))).toBe(false);
    expect(facts.some((f) => f.includes("review"))).toBe(false);
    // approved visual reference
    expect(input!.approvedVisualReferences.length).toBeGreaterThanOrEqual(1);

    // prompt 安全 + 无 market signal 泄漏
    const prompt = buildImagePromptFromInput(input!);
    expect(assertImagePromptIsSafe(prompt)).toBe(true);
    expect(prompt).not.toContain("29.99");
    expect(prompt).not.toContain("4.8");
  });

  it("卖点信息图：functional fact 进入 prompt；无 leakproof 时不得出现 leakproof", async () => {
    const taskId = "sandbox-yeti-image-3";
    await setupConfirmed(taskId);
    const p = await generateCreativeHandoffPreview(taskId, visitorContext());
    const { readFileSync } = await import("node:fs");
    const store = JSON.parse(readFileSync(join(tmpdir(), "yeti-image", "sandbox.json"), "utf8"));
    const task = store.tasks.find((t: { id: string }) => t.id === taskId);
    const inputResult = buildImageInputFromCreativeHandoff(
      p.gate.currentHandoff!,
      1,
    );
    expect(inputResult.ok).toBe(true);
    const input = inputResult.ok ? inputResult.input : null;
    const facts = input!.productFacts.map((f) => `${f.field}:${f.value}`);
    expect(facts.some((f) => f.includes("care:dishwasher-safe bottle and lid"))).toBe(true);
    const prompt = buildImagePromptFromInput(input!);
    expect(prompt).not.toMatch(/leakproof|leak-proof/i);
    expect(assertImagePromptIsSafe(prompt)).toBe(true);
  });
});
