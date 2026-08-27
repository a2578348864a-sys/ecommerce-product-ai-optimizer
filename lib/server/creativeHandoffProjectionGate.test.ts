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
    // V3 Completion Authority：正式完成标记（creative_ready 仅 Human Decision；完成需 research-completion.v1）
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: "2026-08-05T00:00:00.000Z", decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" },
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

  it("27. listingCreationBriefRaw 窄投影：原样返回，不泄漏 resultJson", async () => {
    const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
    const doc = JSON.parse(researchDoc("candidate-fix3"));
    const brief = {
      schema: "listing-creation-brief.v1",
      coreSellingPoint: "Comfortable everyday sipping",
      targetAudience: "Daily commuters",
      useScenario: "Office and travel",
      differentiation: "Simple daily hydration",
      contentEmphasis: "Natural and practical tone",
    };
    doc.listingCreationBrief = brief;
    const keywordBrief = { primaryKeyword: "water bottle", supportingKeywords: ["tumbler"], backendSearchTerms: [] };
    doc.listingKeywordBrief = keywordBrief;
    const draft = { titles: ["T1"], bullets: ["B1"] };
    doc.aiListingPackSnapshot = draft;
    doc.unrelatedNamespace = { keep: true };
    const inputJson = JSON.stringify(doc);
    const task = {
      id: "demo-task-fix3c", demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue",
      platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low",
      oneLineSummary: "o", resultJson: JSON.stringify(doc), productLifecycle: "investigating",
      createdAt: NOW, updatedAt: NOW,
    };
    writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");
    const { gate } = await generateCreativeHandoffPreview("demo-task-fix3c", visitorContext());
    expect(gate.listingCreationBriefRaw).toEqual(brief);
    const projectedBrief = gate.listingCreationBriefRaw as { schema?: string; coreSellingPoint?: string } | undefined;
    expect(projectedBrief?.schema).toBe("listing-creation-brief.v1");
    expect(projectedBrief?.coreSellingPoint).toBe("Comfortable everyday sipping");
    expect(gate.keywordBriefRaw).toEqual(keywordBrief);
    expect(gate.listingDraftRaw).toEqual(draft);
    expect(gate.storageVersion).toBeDefined();
    expect((gate as unknown as Record<string, unknown>).resultJson).toBeUndefined();
    expect((gate as unknown as Record<string, unknown>).unrelatedNamespace).toBeUndefined();
    expect(JSON.stringify(doc)).toBe(inputJson);
  });

  it("28. listingCreationBriefRaw 缺失时安全返回 undefined，不影响其他投影", async () => {
    const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
    const doc = JSON.parse(researchDoc("candidate-fix3"));
    const keywordBrief = { primaryKeyword: "water bottle", supportingKeywords: [], backendSearchTerms: [] };
    doc.listingKeywordBrief = keywordBrief;
    const task = {
      id: "demo-task-fix3d", demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue",
      platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low",
      oneLineSummary: "o", resultJson: JSON.stringify(doc), productLifecycle: "investigating",
      createdAt: NOW, updatedAt: NOW,
    };
    writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");
    const { gate } = await generateCreativeHandoffPreview("demo-task-fix3d", visitorContext());
    expect(gate.listingCreationBriefRaw).toBeUndefined();
    expect(gate.keywordBriefRaw).toEqual(keywordBrief);
    expect(gate.storageVersion).toBeDefined();
    expect((gate as unknown as Record<string, unknown>).resultJson).toBeUndefined();
  });


// 真实可达路径（PR2-0：投影输入链无 human_confirmed 生产点 → gate 恒走 no_confirmed_facts 降级；
// eligible 分支不可达由 lib/server/productCreativeHandoffPreview.ts L508 candidateSourceFingerprint 与
// parseCandidate isHash(64) 历史不一致 + mapResearchConfirmed 桥在降级分支所致——本轮已对齐 L508 并补 eligible 防御投影）。
// 注意：mock 证据层使 eligible 可达的实验（PR2-0 human_confirmed evidence 注入）已证实投影函数 parseCandidate
// 仍有校验拒收（fingerprint 抛 invalid_projected_candidate），属另一个独立问题，记录于 PROGRESS，不静默放宽。

it("29. Gate listingCreationBriefRaw 窄投影（真实可达路径）：合法持久化 schema 原样返回、逐字段相等、不泄漏 resultJson", async () => {
  const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
  const doc = JSON.parse(researchDoc("candidate-eligible3"));
  const brief = {
    schema: "listing-creation-brief.v1",
    coreSellingPoint: "Comfortable everyday sipping",
    targetAudience: "Daily commuters",
    useScenario: "Office and travel",
    differentiation: "Simple daily hydration",
    contentEmphasis: "Natural and practical tone",
  };
  doc.listingCreationBrief = brief;
  const keywordBrief = { primaryKeyword: "water bottle", supportingKeywords: ["tumbler"], backendSearchTerms: [] };
  doc.listingKeywordBrief = keywordBrief;
  const draft = { titles: ["T1"], bullets: ["B1"] };
  doc.aiListingPackSnapshot = draft;
  doc.unrelatedNamespace = { keep: true };
  const inputJson = JSON.stringify(doc);
  const task = {
    id: "demo-task-fix3e", demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue",
    platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low",
    oneLineSummary: "o", resultJson: JSON.stringify(doc), productLifecycle: "investigating",
    createdAt: NOW, updatedAt: NOW,
  };
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");
  const { gate } = await generateCreativeHandoffPreview("demo-task-fix3e", visitorContext());
  expect(gate.listingCreationBriefRaw).toEqual(brief);
  const projected = gate.listingCreationBriefRaw as { schema?: string; coreSellingPoint?: string; targetAudience?: string; useScenario?: string; differentiation?: string; contentEmphasis?: string } | undefined;
  expect(projected?.schema).toBe("listing-creation-brief.v1");
  expect(projected?.coreSellingPoint).toBe("Comfortable everyday sipping");
  expect(projected?.targetAudience).toBe("Daily commuters");
  expect(projected?.useScenario).toBe("Office and travel");
  expect(projected?.differentiation).toBe("Simple daily hydration");
  expect(projected?.contentEmphasis).toBe("Natural and practical tone");
  expect(gate.keywordBriefRaw).toEqual(keywordBrief);
  expect(gate.listingDraftRaw).toEqual(draft);
  expect(gate.storageVersion).toBeDefined();
  expect((gate as unknown as Record<string, unknown>).resultJson).toBeUndefined();
  expect((gate as unknown as Record<string, unknown>).unrelatedNamespace).toBeUndefined();
  expect((gate as unknown as Record<string, unknown>).writer).toBeUndefined();
  expect(JSON.stringify(doc)).toBe(inputJson);
});

it("30. Gate brief 缺失：raw undefined、不抛、其他投影不受影响", async () => {
  const storePath = join(tmpdir(), "fix3-gate-test", "sandbox.json");
  const doc = JSON.parse(researchDoc("candidate-fix3"));
  const keywordBrief = { primaryKeyword: "water bottle", supportingKeywords: [], backendSearchTerms: [] };
  doc.listingKeywordBrief = keywordBrief;
  const task = {
    id: "demo-task-fix3f", demoAccessId: DEMO, type: "workflow", title: "T", decisionStatus: "continue",
    platform: "amazon", productUrl: null, materialText: "m", source: "demo", score: 1, level: "low",
    oneLineSummary: "o", resultJson: JSON.stringify(doc), productLifecycle: "investigating",
    createdAt: NOW, updatedAt: NOW,
  };
  writeFileSync(storePath, JSON.stringify({ version: 1, tasks: [task], candidates: [] }), "utf8");
  const { gate } = await generateCreativeHandoffPreview("demo-task-fix3f", visitorContext());
  expect(gate.listingCreationBriefRaw).toBeUndefined();
  expect(gate.keywordBriefRaw).toEqual(keywordBrief);
  expect(gate.storageVersion).toBeDefined();
  expect((gate as unknown as Record<string, unknown>).resultJson).toBeUndefined();
});

it("31. 两条 Gate 返回分支均应透传 listingCreationBriefRaw（降级+eligible 契约）", async () => {
  const source = (await import("node:fs")).readFileSync(join(process.cwd(), "lib/server/productCreativeHandoffPreview.ts"), "utf8");
  const occurrences = source.match(/listingCreationBriefRaw: resultJson\.listingCreationBrief/g) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(2);
});