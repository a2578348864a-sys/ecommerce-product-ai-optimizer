import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "fix5-regression");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { generateCreativeHandoffPreview, checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO = "demo-fix5";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId = "candidate-fix5") {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA, candidateId, runId: "run-fix5",
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
  const context = { candidateId, productName: "P", sourceType: "seller_sprite_market_research", sourceLabel: "S", marketplace: "US", asin: "B0FIX51234", productUrl: "https://e.com/p", title: "PT", brand: "B", category: "Kitchen", priceUsd: 9.99, rating: 4.0, reviewCount: 50, disclaimer: "third_party_estimate_point_in_time", reportType: "SellerSprite Search Results", query: "q", evidenceStatus: "ok", researchPriority: "high", promotionEligible: false, capturedAt: NOW, contextHash: "a".repeat(64) };
  const agentOutput = { version: "agent-output-v1", generatedAt: NOW, sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" }, riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false }, summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "c", sellingPoints: ["L"], concerns: [], confidence: "medium" }, listingSnapshot: { titleDraft: "T", bulletDrafts: ["E"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] }, nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" }, humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" }, fallbackUsed: false, warnings: [] };
  return JSON.stringify({ type: "workflow", researchRecord, researchVerification: verification,
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" }, candidateAnalysisContext: context, agentOutputSnapshot: agentOutput });
}

function seedTask(taskId: string, resultJson: string) {
  const storePath = join(tmpdir(), "fix5-regression", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [{ id: taskId, demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue", platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low", oneLineSummary: "o", resultJson, productLifecycle: "i", createdAt: NOW, updatedAt: NOW }], candidates: [] }), "utf8");
}

describe("Fix.5 降级 Preview 回归", () => {
  it("1-9. 降级分支返回 confirmableFactCandidates 且 confirmedFacts 为空", async () => {
    seedTask("demo-task", researchDoc());
    const { preview, gate } = await generateCreativeHandoffPreview("demo-task", visitorContext());
    expect(gate.reason).toBe("no_confirmed_facts");
    expect(preview).not.toBeNull();
    // 2. stable 保留
    expect(preview!.stableSourceFacts!.length).toBeGreaterThan(0);
    // 3. AI 保留
    expect(preview!.aiReferences!.length).toBeGreaterThan(0);
    // 4. confirmable >= 2
    expect(preview!.confirmableFactCandidates!.length).toBeGreaterThanOrEqual(2);
    // 5. 每项含合法 selectionId
    for (const c of preview!.confirmableFactCandidates!) {
      expect(c.selectionId).toMatch(/^confirm:[a-f0-9]{24}$/);
      expect(c.humanConfirmationRequired).toBe(true);
    }
    // 6. confirmedFacts 为空
    expect(preview!.candidateFactOptions!.length).toBe(0);
    // 9. AI reference 无事实 selectionId
    for (const r of preview!.aiReferences!) {
      expect(r.selectionId).toMatch(/^ai:/);
      expect(r.selectionId).not.toMatch(/^confirm:/);
    }
  });

  it("10. unknown/conflict 不可选择（无 confirm selectionId）", async () => {
    seedTask("demo-task", researchDoc());
    const { preview } = await generateCreativeHandoffPreview("demo-task", visitorContext());
    for (const i of preview!.issues!) {
      expect(i.selectionId).toMatch(/^issue:/);
      expect(i.selectionId).not.toMatch(/^confirm:/);
    }
  });

  it("11-12. 无合法来源时 confirmable=[] 且不自动升级", async () => {
    // 构造无 brand/category 等可确认字段的 context（仅 asin/title — 非 confirmable 规则）
    const doc = JSON.parse(researchDoc());
    delete doc.candidateAnalysisContext.brand;
    delete doc.candidateAnalysisContext.category;
    delete doc.candidateAnalysisContext.priceUsd;
    delete doc.candidateAnalysisContext.rating;
    delete doc.candidateAnalysisContext.reviewCount;
    seedTask("demo-task", JSON.stringify(doc));
    const { preview } = await generateCreativeHandoffPreview("demo-task", visitorContext());
    expect(preview!.confirmableFactCandidates!.length).toBe(0);
    expect(preview!.candidateFactOptions!.length).toBe(0);
  });

  it("13. 分支一致性：降级分支 confirmable 与 eligible 分支相同构造", async () => {
    seedTask("demo-task", researchDoc());
    const { preview, gate } = await generateCreativeHandoffPreview("demo-task", visitorContext());
    // 降级分支候选来自 buildConfirmableCandidates(gate.candidate.stableSourceFacts) — 与 eligible 分支同一函数
    const confirmables = buildConfirmableCandidates(gate.candidate!.stableSourceFacts);
    expect(confirmables.length).toBe(preview!.confirmableFactCandidates!.length);
    // selectionId 排序/内容一致（同一 researchRevision + taskId + subjectKind）
    const expectedIds = confirmables.map((c) => {
      const canonical = JSON.stringify({
        schema: "creative-handoff-selection-id:v1",
        subjectKind: "visitor",
        taskId: "demo-task",
        researchRevision: 1,
        category: "confirm",
        contentFingerprint: c.selectionKey,
      });
      const { createHash } = require("node:crypto");
      return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
    });
    expect(preview!.confirmableFactCandidates!.map((c) => c.selectionId)).toEqual(expectedIds);
  });
});

// ── V3R 契约③ PROVENANCE_MERGE：workbenchConfirmedFacts 字段归一化（防重复展示） ──

describe("V3R workbenchConfirmedFacts consumer-field 归一化", () => {
  it("research field（price/reviews）归一化为 consumer field（price_usd/review_count）", async () => {
    const doc = JSON.parse(researchDoc());
    const confirmedFacts = [
      { candidateId: "seller_sprite_product_facts:price", field: "price", label: "参考价格 (USD)", value: 13.99, sourceKind: "seller_sprite_product_facts", sourceRef: "x", humanConfirmationRequired: true, confirmedAt: NOW, confirmedBy: "visitor:test" },
      { candidateId: "amazon_browser_evidence:reviews", field: "reviews", label: "评论数", value: 176393, sourceKind: "amazon_browser_evidence", sourceRef: "y", humanConfirmationRequired: true, confirmedAt: NOW, confirmedBy: "visitor:test" },
      { candidateId: "seller_sprite_product_facts:brand", field: "brand", label: "品牌", value: "Etekcity", sourceKind: "seller_sprite_product_facts", sourceRef: "z", humanConfirmationRequired: true, confirmedAt: NOW, confirmedBy: "visitor:test" },
    ];
    doc.factCandidates = { schema: "fact-candidates.v1", version: 1, confirmed: confirmedFacts, updatedAt: NOW };
    seedTask("demo-task", JSON.stringify(doc));
    // 与 ListingFactSupplementPanel 消费同一 gate.workbenchConfirmedFacts（checkCreativeHandoffGate 构建处）
    const gate = await checkCreativeHandoffGate("demo-task", visitorContext());
    const fields = (gate.workbenchConfirmedFacts ?? []).map((f) => f.field);
    expect(fields).toContain("price_usd"); // research price → consumer price_usd
    expect(fields).toContain("review_count"); // research reviews → consumer review_count
    expect(fields).toContain("brand"); // 同名直通
    expect(fields).not.toContain("price");
    expect(fields).not.toContain("reviews");
  });
});
