import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { generateImageDraftFromHandoff } from "@/lib/imageHandoff/imageGenerationService";
import { createMockImageProvider } from "@/lib/imageHandoff/mockImageProvider";
import { parseImageHandoffBinding } from "@/lib/imageHandoff/imageBinding";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { createOrAppendCreativeHandoff } from "@/lib/server/productCreativeHandoffPersistence";
import { getSandboxTask } from "@/lib/server/demoSandbox";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "pr23-image-batch-metadata");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "pr23.db").replaceAll("\\", "/")}`;
});

const NOW = "2026-08-05T00:00:00.000Z";
const ownerContext = { mode: "owner", token: "synthetic-owner-token" } as const;

function protectedDocument(candidateId: string) {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "workflow-run-batch",
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
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: NOW,
    decision: { decisionId: "11111111-1111-4111-8111-111111111111", status: "creative_ready", reason: "ok", nextAction: "handoff" },
  });
  return {
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    unknownNamespace: { keep: true },
    productLifecycle: { state: "investigating" },
    agentOutputSnapshot: {
      version: "agent-output-v1",
      workflowStatus: "completed",
      productNameSnapshot: { displayName: "Synthetic Batch Product" },
      sourcingSnapshot: { sourceLabel: "SellerSprite", capturedAt: NOW, rawSnapshotCount: 1 },
      riskSnapshot: { needsManualReview: false, riskLevel: "low", riskFlags: [] },
      summarySnapshot: {
        sellingPoints: ["Adjustable angle"], concerns: [], confidence: "medium",
        keywordHints: ["synthetic"], imageIdeas: ["户外场景构图", "简洁白底背景"], complianceNotes: [], missingInputs: [],
      },
      listingSnapshot: { titleDraft: "Synthetic Product", bulletDrafts: ["Confirmed."], descriptionDraft: "Draft.", searchTerms: [], keywords: [] },
      nextActionSnapshot: { recommendedAction: "handoff" },
      humanReviewSnapshot: { needsManualReview: false, reviewNotes: [] },
      fallbackUsed: false,
      warnings: [],
    },
    candidateAnalysisContext: {
      candidateId,
      productName: "Synthetic Batch Product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0ABCDEF12",
      productUrl: "https://example.com/synthetic",
      title: "Synthetic Product Title",
      brand: "SyntheticBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "synthetic",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: NOW,
      contextHash: "a".repeat(64),
    },
    candidateToTask: { version: 1, candidateId, confirmation: "research_started", confirmedAt: NOW },
  };
}

function encodeConfirmSelectionId(context: { mode: string }, taskId: string, researchRevision: number, stableFactId: string) {
  const canonical = JSON.stringify({ schema: "creative-handoff-selection-id:v1", subjectKind: context.mode === "demo" ? "visitor" : context.mode, taskId, researchRevision, category: "confirm", contentFingerprint: stableFactId });
  return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

async function createHandoff(taskId: string, ctx: never, requestId: string) {
  const preview = await generateCreativeHandoffPreview(taskId, ctx);
  const gate = preview.gate;
  const confirmables = buildConfirmableCandidates(gate.candidate!.stableSourceFacts);
  const selectionIds = confirmables.map((c) => encodeConfirmSelectionId(ctx as { mode: string }, taskId, 1, c.selectionKey));
  const result = await createOrAppendCreativeHandoff(taskId, ctx, {
    requestId,
    expectedResearchRevision: 1,
    expectedCurrentHandoffRevision: 0,
    expectedStorageVersion: preview.gate.storageVersion!,
    selectedFactCandidateIds: selectionIds,
    requestFingerprint: `sha256:${"a".repeat(64)}`,
  });
  return { result, sv: preview.gate.storageVersion! };
}

async function imageInputFor(taskId: string, ctx: never, requestId: string, count: number) {
  const preview = await generateCreativeHandoffPreview(taskId, ctx);
  const handoff = preview.gate.currentHandoff!;
  return {
    requestId,
    expectedStorageVersion: preview.gate.storageVersion!,
    expectedHandoffRevision: handoff.currentRevision,
    mode: "composition_concept" as const,
    count: count as 1 | 2,
    confirmed: true as const,
  } as never;
}

let root = "";
let client: PrismaClient | undefined;

beforeEach(async () => {
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  root = join(tmpdir(), "pr23-image-batch-metadata");
  mkdirSync(root, { recursive: true });
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  const url = process.env.DATABASE_URL!;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate", "--schema", schemaPath], {
    cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
  });
  client = new PrismaClient({ datasources: { db: { url } } });
  await client.viralAnalysisRecord.create({
    data: {
      id: "task-batch", createdAt: new Date(NOW), updatedAt: new Date(NOW),
      type: "workflow", decisionStatus: "creative_ready", title: "Synthetic", platform: "local-test",
      productUrl: null, materialText: "Synthetic", source: "isolated-batch", score: 0, level: "low",
      oneLineSummary: "Synthetic", resultJson: JSON.stringify(protectedDocument("candidate-batch")),
    },
  });
  await client.opportunityCandidate.create({
    data: {
      id: "candidate-batch", name: "Synthetic", rawInput: "Synthetic", source: "SellerSprite",
      status: "pending", sourceMetaJson: "{}", analysisJson: "{}",
      convertedTaskId: "task-batch", lastActionAt: new Date(NOW),
    },
  });
});

afterEach(async () => {
  await client?.$disconnect();
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

async function savedItems() {
  const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-batch" } });
  const parsed = JSON.parse(row!.resultJson);
  return (parsed.aiImageDraftSnapshot as { items: Array<Record<string, unknown>> }).items;
}

describe("Draft Metadata Batch Consistency（mock provider，零真实调用）", () => {
  it("count=1 → 1 张 draft，handoffMode 等 metadata 齐全", async () => {
    await createHandoff("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441000");
    const provider = createMockImageProvider();
    const input = await imageInputFor("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441001", 1);
    await generateImageDraftFromHandoff("task-batch", ownerContext as never, input, { provider });
    expect(provider.callCount).toBe(1);
    const items = await savedItems();
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first.handoffMode).toBe("composition_concept");
    expect(first.sourceHandoffRevision).toBe(1);
    expect(first.humanReviewRequired).toBe(true);
    expect(String(first.storageKey)).toContain("owner/mock");
  });

  it("count=2 → 2 张 draft，两张 handoffMode/sourceHandoffRevision 全有且一致", async () => {
    await createHandoff("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441010");
    const provider = createMockImageProvider();
    const input = await imageInputFor("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441011", 2);
    await generateImageDraftFromHandoff("task-batch", ownerContext as never, input, { provider });
    expect(provider.callCount).toBe(2);
    const items = await savedItems();
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.handoffMode).toBe("composition_concept");
      expect(item.sourceHandoffRevision).toBe(1);
      expect(item.humanReviewRequired).toBe(true);
      expect(String(item.storageKey)).toContain("owner/mock");
    }
  });

  it("count=4 产品能力上限为 2：service 层归一为 1（route 层拒绝 count=4；多图能力=1/2 张，非回归）", async () => {
    await createHandoff("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441020");
    const provider = createMockImageProvider();
    const input = await imageInputFor("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441021", 4);
    // service 的 requestedCount = input.count === 2 ? 2 : 1 → count=4 归一为 1（1 次 provider 调用、1 张 draft）
    await generateImageDraftFromHandoff("task-batch", ownerContext as never, input, { provider });
    expect(provider.callCount).toBe(1);
    const items = await savedItems();
    expect(items).toHaveLength(1);
    const first = items[0];
    expect(first.handoffMode).toBe("composition_concept");
    expect(first.sourceHandoffRevision).toBe(1);
    expect(first.humanReviewRequired).toBe(true);
    expect(String(first.storageKey)).toContain("owner/mock");
  });

  it("count=2 保存后 GET 投影 → 2 个候选（imageDraftSafeSummaries 全部返回）", async () => {
    await createHandoff("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441030");
    const provider = createMockImageProvider();
    const input = await imageInputFor("task-batch", ownerContext as never, "550e8400-e29b-41d4-a716-446655441031", 2);
    await generateImageDraftFromHandoff("task-batch", ownerContext as never, input, { provider });
    const { imageDraftSafeSummaries } = await import("@/lib/imageHandoff/imageGenerationService");
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-batch" } });
    const parsed = JSON.parse(row!.resultJson);
    const candidates = imageDraftSafeSummaries(parsed.aiImageDraftSnapshot, 1);
    expect(candidates).toHaveLength(2);
    for (const c of candidates) {
      expect(c.mode).toBe("composition_concept");
      expect(c.sourceHandoffRevision).toBe(1);
      expect(c.humanReviewRequired).toBe(true);
    }
  });
});

