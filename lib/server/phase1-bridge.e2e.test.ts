// V3 Final PHASE 1 — Research Confirmed Facts → Creative Handoff Bridge（e2e，真实 SQLite CAS）
// 覆盖：研究侧已确认事实（factCandidates 权威）经唯一 Canonical Adapter 桥接进入 handoff
// confirmedFacts；market 信号 internal scope；Product 事实 internal+listing+image；
// 溯源 confirmationReference=fact-candidates:<candidateId>；同字段冲突 fail-closed。
const E2E_DB_DIR = join(tmpdir(), "phase1-bridge-e2e-db");
vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "phase1-bridge-e2e-db");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "bridge.db").replaceAll("\\", "/")}`;
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  PRODUCT_RESEARCH_HASH_SCHEMA,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  buildProductResearchHash,
} from "@/lib/productResearchRecord";
import type { TaskResultJsonDatabase } from "@/lib/server/taskResultJsonMutation";
import { createOrAppendCreativeHandoff, CreativeHandoffPersistenceError } from "@/lib/server/productCreativeHandoffPersistence";
import { FactAuthorityError } from "@/lib/productCreativeHandoffFactAuthority";
import { generateCreativeHandoffPreview } from "@/lib/server/productCreativeHandoffPreview";
import { buildConfirmableCandidates } from "@/lib/productCreativeHandoffConfirmation";
import { FACT_CANDIDATES_SCHEMA } from "@/lib/factCandidates";

let root = "";
let databasePath = "";
let client: PrismaClient | undefined;
const ownerContext = { mode: "owner", token: "synthetic-owner-token" } as const;
const REQ = "550e8400-e29b-41d4-a716-446655440010";
const NOW = "2026-08-05T00:00:00.000Z";
const CANDIDATE_ID = "candidate-bridge";

function protectedDocumentWithResearchFacts() {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId: CANDIDATE_ID,
    runId: "workflow-run-bridge",
    contextHash: "a".repeat(64),
    inputHash: "b".repeat(64),
    resultHash: "c".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true,
      riskReviewed: true,
      summaryReviewed: true,
      listingReviewed: true,
      reviewedCount: 4,
      totalReviewSteps: 4,
      allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: NOW,
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "Initial evidence reviewed.",
      nextAction: "Wait for an explicit handoff.",
    },
  });
  const researchConfirmed = [
    {
      candidateId: "amazon_product_info:material",
      field: "material",
      label: "材质",
      value: "Stainless Steel",
      sourceKind: "amazon_product_info",
      sourceRef: "browserEvidence.snapshots[0].productInfo.material",
      humanConfirmationRequired: true,
      confirmedAt: NOW,
      confirmedBy: "owner:v1",
    },
    {
      candidateId: "amazon_product_info:dimensions",
      field: "dimensions",
      label: "尺寸",
      value: "2.7\"W x 6.9\"H",
      sourceKind: "amazon_product_info",
      sourceRef: "browserEvidence.snapshots[0].productInfo.dimensions",
      humanConfirmationRequired: true,
      confirmedAt: NOW,
      confirmedBy: "owner:v1",
    },
    {
      candidateId: "seller_sprite_product_facts:price",
      field: "price",
      label: "参考价格 (USD)",
      value: 19.99,
      sourceKind: "seller_sprite_product_facts",
      sourceRef: "seller_sprite.productFacts.price",
      humanConfirmationRequired: true,
      confirmedAt: NOW,
      confirmedBy: "owner:v1",
    },
  ];
  return {
    type: "workflow",
    researchRecord,
    researchVerification: verification,
    researchCompletion: { schema: "research-completion.v1", status: "completed", completedAt: NOW, decisionId: "11111111-1111-4111-8111-111111111111", revision: 1, finalStatus: "creative_ready" },
    factCandidates: {
      schema: FACT_CANDIDATES_SCHEMA,
      version: 1,
      confirmed: researchConfirmed,
      updatedAt: NOW,
    },
    productLifecycle: { state: "investigating" },
    candidateAnalysisContext: {
      candidateId: CANDIDATE_ID,
      productName: "Bridge Product",
      sourceType: "seller_sprite_market_research",
      sourceLabel: "SellerSprite",
      marketplace: "US",
      asin: "B0ABCDEF12",
      productUrl: "https://example.com/bridge",
      title: "Bridge Product Title",
      brand: "BridgeBrand",
      category: "Kitchen",
      priceUsd: 19.99,
      rating: 4.5,
      reviewCount: 120,
      disclaimer: "third_party_estimate_point_in_time",
      reportType: "SellerSprite Search Results",
      query: "bridge",
      evidenceStatus: "ok",
      researchPriority: "high",
      promotionEligible: false,
      capturedAt: NOW,
      contextHash: "a".repeat(64),
    },
  };
}

function encodeConfirmSelectionIdForTest(
  context: { mode: string },
  taskId: string,
  researchRevision: number,
  stableFactId: string,
): string {
  const canonical = JSON.stringify({
    schema: "creative-handoff-selection-id:v1",
    subjectKind: context.mode,
    taskId,
    researchRevision,
    category: "confirm",
    contentFingerprint: stableFactId,
  });
  return `confirm:${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24)}`;
}

beforeEach(async () => {
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  root = E2E_DB_DIR;
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  databasePath = join(root, "bridge.db");
  const schemaPath = join(root, "schema.prisma");
  copyFileSync(join(process.cwd(), "prisma", "schema.prisma"), schemaPath);
  const url = `file:${databasePath.replaceAll("\\", "/")}`;
  execFileSync(process.execPath, [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "db", "push", "--skip-generate", "--schema", schemaPath,
  ], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasources: { db: { url } } });
  await client.viralAnalysisRecord.create({
    data: {
      id: "task-bridge",
      createdAt: new Date(NOW),
      updatedAt: new Date(NOW),
      type: "workflow",
      decisionStatus: "continue",
      title: "Bridge",
      platform: "local-test",
      materialText: "Bridge",
      source: "isolated-test",
      score: 0,
      level: "low",
      oneLineSummary: "Bridge",
      resultJson: JSON.stringify(protectedDocumentWithResearchFacts()),
    },
  });
});

afterEach(async () => {
  await client?.$disconnect();
  await (globalThis as { prisma?: { $disconnect(): Promise<void> } }).prisma?.$disconnect();
  rmSync(root, { recursive: true, force: true });
});

describe("PHASE 1 — Research Confirmed Facts → Listing Bridge（e2e）", () => {
  it("创建 Handoff 时自动并入研究侧已确认事实（material/dimensions → listing；price → internal）", async () => {
    const preview = await generateCreativeHandoffPreview("task-bridge", ownerContext);
    const sv = preview.gate.storageVersion!;
    const gateCandidate = preview.gate.candidate!;
    const confirmables = buildConfirmableCandidates(gateCandidate.stableSourceFacts);
    const selectionIds = confirmables.map((c) => encodeConfirmSelectionIdForTest(ownerContext, "task-bridge", 1, c.selectionKey));
    const result = await createOrAppendCreativeHandoff("task-bridge", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });

    const confirmed = result.handoff.versions[result.handoff.versions.length - 1].confirmedFacts;
    // 桥接：研究侧确认的 material/dimensions 进入 handoff（Product 事实 → internal+listing+image）
    const material = confirmed.find((f) => f.field === "material");
    expect(material).toBeDefined();
    expect(material!.value).toBe("Stainless Steel");
    expect(material!.usageScopes).toEqual(["internal", "listing", "image"]);
    expect(material!.sourceRef.sourceKind).toBe("user_confirmation");
    expect(material!.sourceRef.confirmationReference).toBe(`fact-candidates:${CANDIDATE_ID}`);
    const dimensions = confirmed.find((f) => f.field === "dimensions");
    expect(dimensions?.value).toBe("2.7\"W x 6.9\"H");
    // market 信号：price → price_usd 且仅 internal（不成为 Listing 声明）
    const price = confirmed.find((f) => f.field === "price_usd");
    expect(price).toBeDefined();
    expect(price!.value).toBe(19.99);
    expect(price!.usageScopes).toEqual(["internal"]);
    // 无重复（research 同 field 只出现一次）
    expect(confirmed.filter((f) => f.field === "material")).toHaveLength(1);
  });

  it("重复创建（新 revision）幂等：research 同值不新增重复事实", async () => {
    const preview = await generateCreativeHandoffPreview("task-bridge", ownerContext);
    const sv = preview.gate.storageVersion!;
    const confirmables = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts);
    const selectionIds = confirmables.map((c) => encodeConfirmSelectionIdForTest(ownerContext, "task-bridge", 1, c.selectionKey));
    const first = await createOrAppendCreativeHandoff("task-bridge", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    // 读取最新 resultJson → 计算新 storageVersion（第一次写入后版本已变化）
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-bridge" } });
    const latestSv = {
      resultJsonHash: createHash("sha256").update(row!.resultJson, "utf8").digest("hex"),
      updatedAt: row!.updatedAt,
    };
    const second = await createOrAppendCreativeHandoff("task-bridge", ownerContext, {
      requestId: `${REQ}-2`,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: first.handoff.currentRevision,
      expectedStorageVersion: latestSv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: [{ field: "operation", value: "Flip Top Cap" }],
      requestFingerprint: `sha256:${"b".repeat(64)}`,
    });
    const confirmed = second.handoff.versions[second.handoff.versions.length - 1].confirmedFacts;
    expect(confirmed.filter((f) => f.field === "material")).toHaveLength(1);
    expect(confirmed.filter((f) => f.field === "dimensions")).toHaveLength(1);
    expect(confirmed.find((f) => f.field === "operation")?.value).toBe("Flip Top Cap");
  });

  it("研究侧已确认字段与创作侧手动输入不同值 → 冲突 fail-closed（已有确认值不再要求/允许重复手填）", async () => {
    const preview = await generateCreativeHandoffPreview("task-bridge", ownerContext);
    const sv = preview.gate.storageVersion!;
    const confirmables = buildConfirmableCandidates(preview.gate.candidate!.stableSourceFacts);
    const selectionIds = confirmables.map((c) => encodeConfirmSelectionIdForTest(ownerContext, "task-bridge", 1, c.selectionKey));
    const first = await createOrAppendCreativeHandoff("task-bridge", ownerContext, {
      requestId: REQ,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: 0,
      expectedStorageVersion: sv,
      selectedFactCandidateIds: selectionIds,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    });
    const row = await client!.viralAnalysisRecord.findUnique({ where: { id: "task-bridge" } });
    const latestSv = {
      resultJsonHash: createHash("sha256").update(row!.resultJson, "utf8").digest("hex"),
      updatedAt: row!.updatedAt,
    };
    // 创作侧对已研究确认的 material 填不同值 → confirmed_fact_conflict
    await expect(createOrAppendCreativeHandoff("task-bridge", ownerContext, {
      requestId: `${REQ}-3`,
      expectedResearchRevision: 1,
      expectedCurrentHandoffRevision: first.handoff.currentRevision,
      expectedStorageVersion: latestSv,
      selectedFactCandidateIds: [],
      manualConfirmedFacts: [{ field: "material", value: "Plastic" }],
      requestFingerprint: `sha256:${"c".repeat(64)}`,
    })).rejects.toBeInstanceOf(FactAuthorityError);
  });
});
