import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.hoisted(() => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const { mkdirSync, rmSync } = require("node:fs");
  const dir = join(tmpdir(), "visual-ref-import");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env.DEMO_SANDBOX_STORE_PATH = join(dir, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(dir, "demo-access.json");
  process.env.DATABASE_URL = `file:${join(dir, "unused.db").replaceAll("\\", "/")}`;
});

import { createProductResearchVerification, createInitialProductResearchRecord, buildProductResearchHash, PRODUCT_RESEARCH_HASH_SCHEMA } from "@/lib/productResearchRecord";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const GOOD_URL = "https://m.media-amazon.com/images/I/210fH2Z2GlL._AC_US600_.jpg";
const EVIL_URL = "https://evil.example.com/img.png";

const DEMO = "visitor-a";
const TASK = "sandbox_task_visualimp1";
const CAND = "sandbox_candidate_visualimp1";
const ASIN = "B0GZRLKJT8";

function makeResultJson(candidateId: string): string {
  const verification = createProductResearchVerification({
    schema: PRODUCT_RESEARCH_HASH_SCHEMA,
    candidateId,
    runId: "wf-test",
    contextHash: "b".repeat(64),
    inputHash: "d".repeat(64),
    resultHash: "e".repeat(64),
    workflowStatus: "completed",
    reviewState: {
      sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true,
      reviewedCount: 4, totalReviewSteps: 4, allReviewed: true,
    },
  });
  const researchRecord = createInitialProductResearchRecord({
    candidateId: verification.candidateId,
    runId: verification.runId,
    contextHash: verification.contextHash,
    researchHash: buildProductResearchHash({ ...verification, schema: PRODUCT_RESEARCH_HASH_SCHEMA }),
    workflowStatus: verification.workflowStatus,
    reviewState: verification.reviewState,
    actor: { mode: "visitor", actorRef: `visitor:${"f".repeat(16)}` },
    now: "2026-08-10T00:00:00.000Z",
    decision: {
      decisionId: "00000000-0000-4000-8000-000000000001",
      status: "creative_ready",
      reason: "synthetic acceptance fixture",
      nextAction: null,
    },
  });
  return JSON.stringify({
    researchRecord,
    researchVerification: verification,
  });
}

function makeCandidate(imageUrl: string | null): string {
  return JSON.stringify({
    schema: "sellersprite_candidate_source_v1",
    source: {
      provider: "SellerSprite", type: "sellersprite_xlsx", marketplace: "Amazon US",
      reportType: "SellerSprite Search Results", capturedAt: null,
      importedAt: "2026-08-10T00:00:00.000Z",
      sourceFileSha256: "c".repeat(64),
      rowHash: sha256(`row:${ASIN}`).slice(0, 32),
    },
    identity: { asin: ASIN, parentAsin: null, productUrl: `https://www.amazon.com/dp/${ASIN}` },
    snapshot: { title: "Test Product", imageUrl, priceUsd: 29.99, rating: 4.8, reviewCount: 10, brand: "YETI", category: "Sports & Outdoors" },
    estimates: { searchRank: 1, estimatedMonthlySales: 100, estimatedMonthlyRevenueUsd: 3000, disclaimer: "third_party_estimate_point_in_time" },
  });
}

function seedStore(imageUrl: string | null, overrides: { candidateMeta?: string } = {}) {
  const storePath = join(tmpdir(), "visual-ref-import", "sandbox.json");
  writeFileSync(storePath, JSON.stringify({
    version: 1,
    tasks: [{
      id: TASK, demoAccessId: DEMO, type: "workflow", title: "YETI", decisionStatus: "continue",
      platform: "amazon", productUrl: null, materialText: "", source: "demo", score: 1, level: "low",
      oneLineSummary: "", resultJson: makeResultJson(CAND), productLifecycle: "{}",
      createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z",
    }],
    candidates: [{
      id: CAND, demoAccessId: DEMO, name: "YETI", rawInput: "", link: "https://www.amazon.com/dp/B0GZRLKJT8",
      score: 0, source: "SellerSprite", keyword: "", riskLevel: "", riskLabel: "", summaryLabel: "",
      status: "pending", sourceMetaJson: overrides.candidateMeta ?? makeCandidate(imageUrl),
      analysisJson: "{}", createdAt: "2026-08-10T00:00:00.000Z", convertedTaskId: TASK,
      originProductBatchItemId: null, lastActionAt: null,
    }],
  }), "utf8");
}

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: { findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 0 })) },
    opportunityCandidate: { findUnique: vi.fn(async () => null), $queryRaw: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn((request: Request) => {
    const token = request.headers.get("x-access-token");
    if (!token) return { ok: false, status: 401, code: "invalid_access", message: "请先登录后再操作。" };
    if (token === "owner-token-1") return { ok: true, context: { mode: "owner" } };
    if (token === "visitor-token-1") return { ok: true, context: { mode: "demo", demoAccessId: "visitor-a" } };
    return { ok: false, status: 401, code: "invalid_access", message: "请先登录后再操作。" };
  }),
  requireOwnerOnly: vi.fn(),
}));

import { POST } from "@/app/api/tasks/[id]/visual-reference-import/route";

async function callPOST(taskId: string, body: Record<string, unknown>, token: string) {
  const request = new Request(`http://localhost/api/tasks/${encodeURIComponent(taskId)}/visual-reference-import`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-token": token },
    body: JSON.stringify(body),
  });
  return POST(request as never, { params: Promise.resolve({ id: taskId }) });
}

function storageVersion() {
  return { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-10T00:00:00.000Z" };
}

/** 从 sandbox store 读取任务真实 storageVersion（updatedAt + resultJson sha256） */
function realStorageVersion() {
  const storePath = join(tmpdir(), "visual-ref-import", "sandbox.json");
  const store = JSON.parse(require("node:fs").readFileSync(storePath, "utf8"));
  const task = store.tasks[0];
  const hash = createHash("sha256").update(task.resultJson, "utf8").digest("hex");
  return { resultJsonHash: hash, updatedAt: task.updatedAt };
}

describe("visual-reference-import security contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未登录 → 401", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "");
    expect(res.status).toBe(401);
  });

  it("错误 storageVersion → 400", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: { bad: true }, asin: ASIN }, "visitor-token-1");
    expect(res.status).toBe(400);
  });

  it("ASIN 与任务候选不匹配 → 422（URL 绑定：拒绝浏览器提交的任意 URL）", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: "B0AAAAAAAA" }, "visitor-token-1");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("visual_reference_unavailable");
  });

  it("候选无 imageUrl → 422（不下载）", async () => {
    seedStore(null);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "visitor-token-1");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("visual_reference_unavailable");
  });

  it("非 SellerSprite 候选源（无 meta）→ 422", async () => {
    seedStore(GOOD_URL, { candidateMeta: JSON.stringify({ schema: "other" }) });
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "visitor-token-1");
    expect(res.status).toBe(422);
  });

  it("候选未绑定本任务 → 404", async () => {
    seedStore(GOOD_URL);
    const storePath = join(tmpdir(), "visual-ref-import", "sandbox.json");
    const store = JSON.parse(require("node:fs").readFileSync(storePath, "utf8"));
    store.candidates[0].convertedTaskId = "other-task";
    writeFileSync(storePath, JSON.stringify(store), "utf8");
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "visitor-token-1");
    expect(res.status).toBe(404);
  });

  it("Owner 访问 sandbox 任务 → 404", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "owner-token-1");
    expect(res.status).toBe(404);
  });

  it("未知顶层字段（含 imageUrl 提交）→ 400", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN, imageUrl: EVIL_URL }, "visitor-token-1");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("unknown_field");
  });

  it("非法 ASIN 格式 → 400", async () => {
    seedStore(GOOD_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: "not-an-asin" }, "visitor-token-1");
    expect(res.status).toBe(400);
  });

  it("候选 URL 为白名单外域名 → 422（安全链拒绝；不泄漏 URL）", async () => {
    seedStore(EVIL_URL);
    const res = await callPOST(TASK, { expectedStorageVersion: realStorageVersion(), asin: ASIN }, "visitor-token-1");
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("visual_reference_unavailable");
    expect(body.error.message).not.toContain("evil");
  });
});
