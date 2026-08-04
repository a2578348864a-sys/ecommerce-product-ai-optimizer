import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "fix3-gate-test");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { generateCreativeHandoffPreview, checkCreativeHandoffGate } from "@/lib/server/productCreativeHandoffPreview";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import { createInitialProductResearchRecord, createProductResearchVerification, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";

const NOW = "2026-08-05T00:00:00.000Z";
const DEMO = "demo-access-fix3";

function visitorContext() {
  return { mode: "demo" as const, token: "tok", demoAccessId: DEMO, isActive: true, isExpired: false, remainingAiCalls: 10 };
}

function researchDoc(candidateId: string) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "run-fix3",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true, reviewedCount: 4, totalReviewSteps: 4, allReviewed: true },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` },
    now: NOW,
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: null },
  });
  const context = {
    candidateId,
    productName: "Test Product",
    sourceType: "seller_sprite_market_research",
    sourceLabel: "SellerSprite",
    marketplace: "US",
    asin: "B0ABCDEF12",
    productUrl: "https://example.com/p",
    title: "Test Product Title",
    brand: "TestBrand",
    category: "Kitchen",
    priceUsd: 19.99,
    rating: 4.5,
    reviewCount: 120,
    disclaimer: "third_party_estimate_point_in_time",
    reportType: "SellerSprite Search Results",
    query: "kitchen",
    evidenceStatus: "ok",
    researchPriority: "high",
    promotionEligible: false,
    capturedAt: NOW,
    contextHash: "a".repeat(64),
  };
  const agentOutput = {
    version: "agent-output-v1",
    generatedAt: NOW,
    sourcingSnapshot: { supplierConclusion: "S", sourceSignals: [], priceSignals: [], availabilitySignals: [], assumptions: [], missingInfo: [], confidence: "medium" },
    riskSnapshot: { riskLevel: "low", riskFlags: [], complianceConcerns: [], ipConcerns: [], logisticsConcerns: [], safetyConcerns: [], riskReason: "ok", needsManualReview: false },
    summarySnapshot: { decision: "recommended", decisionReason: "G", targetUser: "cooks", sellingPoints: ["Lightweight"], concerns: [], confidence: "medium" },
    listingSnapshot: { titleDraft: "Lightweight Kitchen Gadget", bulletDrafts: ["Easy to clean"], keywordHints: [], imageIdeas: [], complianceNotes: [], missingInputs: [] },
    nextActionSnapshot: { primaryAction: "prepare_listing", actionLabel: "l", checklist: [], blockingIssues: [], suggestedOwnerStep: "x" },
    humanReviewSnapshot: { required: false, reasons: [], reviewFocus: [], defaultStatus: "not_required" },
    fallbackUsed: false,
    warnings: [],
  };
  return JSON.stringify({
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    candidateAnalysisContext: context,
    agentOutputSnapshot: agentOutput,
  });
}

describe("Fix.3 Gate 投影接线", () => {
  it("24. checkCreativeHandoffGate 调用真实投影（不再硬编码空数组）", async () => {
    const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
    const task = {
      id: "demo-task-fix3",
      demoAccessId: DEMO,
      type: "workflow",
      title: "T",
      decisionStatus: "continue",
      platform: "amazon",
      productUrl: null,
      materialText: "m",
      source: "demo",
      score: 1,
      level: "low",
      oneLineSummary: "o",
      resultJson: researchDoc("candidate-fix3"),
      productLifecycle: "investigating",
      createdAt: NOW,
      updatedAt: NOW,
    };
    writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");

    // Preview 应触发真实投影链：candidateAnalysisContext + agentOutputSnapshot → ProjectionEvidence
    const { preview, gate } = await generateCreativeHandoffPreview("demo-task-fix3", visitorContext());
    // 无人工确认事实 → reason=no_confirmed_facts（降级），但已走真实投影（不再 legacy_not_supported）
    expect(gate.handoffContractInvalid).toBe(false);
    expect(gate.reason).not.toBe("legacy_not_supported");
    expect(gate.reason).toBe("no_confirmed_facts");
    // Preview 仍返回来源层信息（stable/AI/issues）— 指令第十一节
    expect(preview).not.toBeNull();
    expect(preview?.stableSourceFacts?.length ?? 0).toBeGreaterThan(0);
    expect(preview?.aiReferences?.length ?? 0).toBeGreaterThan(0);
    expect(preview?.candidateFactOptions ?? []).toHaveLength(0); // 无 confirmed facts
  });

  it("25. projectProductCreativeHandoffCandidate 生产调用点存在", async () => {
    const previewModule = await import("@/lib/server/productCreativeHandoffPreview");
    const source = (await import("node:fs")).readFileSync(
      join(process.cwd(), "lib/server/productCreativeHandoffPreview.ts"), "utf8");
    expect(source).toContain("projectProductCreativeHandoffCandidate({");
    expect(previewModule).toBeDefined();
  });

  it("26. 无 candidateAnalysisContext → legacy_not_supported（fail-closed）", async () => {
    const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
    const doc = JSON.parse(researchDoc("candidate-fix3"));
    delete doc.candidateAnalysisContext;
    const task = {
      id: "demo-task-fix3b",
      demoAccessId: DEMO,
      type: "workflow",
      title: "T",
      decisionStatus: "continue",
      platform: "amazon",
      productUrl: null,
      materialText: "m",
      source: "demo",
      score: 1,
      level: "low",
      oneLineSummary: "o",
      resultJson: JSON.stringify(doc),
      productLifecycle: "investigating",
      createdAt: NOW,
      updatedAt: NOW,
    };
    writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");
    const { gate } = await generateCreativeHandoffPreview("demo-task-fix3b", visitorContext());
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("legacy_not_supported");
  });
});
