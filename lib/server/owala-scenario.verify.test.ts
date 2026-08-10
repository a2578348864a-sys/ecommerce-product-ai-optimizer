import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
