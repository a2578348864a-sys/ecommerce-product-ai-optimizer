/**
 * 契约测试：商品研究主链路 AI Research Summary Provider 归零与门禁保障
 *
 * 核心目标：
 * 1. 验证在整个商品研究主链路（详情打开、证据读取、采集编排、人工决策、任务完成）中，
 *    AI Research Summary（ai-evidence-summary）的 Provider 调用彻底归零（callAiJson calls = 0）；
 * 2. 验证 GET 接口保留完全向后兼容的只读能力（有历史数据正常返回 4 模块与历史分类，无数据返回安全空态），零 Provider 调用；
 * 3. 验证无隐式写入与触发：没有任何后台代码、编排器或 webhook 会隐式调用 POST /ai-evidence-summary 或 generateAiEvidenceSummary。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { createTrustedSandboxTask } from "@/lib/server/demoSandbox";
import { mutateDemoSandboxStore } from "@/lib/server/demoSandboxStore.internal";
import {
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
} from "@/lib/productResearchRecord";

// ── Mocks ──
vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(),
  bindProviderCallStartBoundary: vi.fn((_token, fn) => fn()),
}));

vi.mock("@/lib/server/accessPassword", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/accessPassword")>();
  return {
    ...actual,
    checkAccessPassword: vi.fn(() => null),
    getAccessContext: vi.fn(() => ({
      mode: "demo",
      token: "tok-demo-a",
      demoAccessId: "demo-access-a",
      isActive: true,
      isExpired: false,
      remainingAiCalls: 10,
    })),
  };
});

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn(() => ({
    ok: true,
    context: { mode: "demo", token: "tok-demo-a", demoAccessId: "demo-access-a", isActive: true, isExpired: false, remainingAiCalls: 10 },
  })),
  requireOwnerOnly: vi.fn(() => ({ ok: true, context: { mode: "owner", token: "tok-owner" } })),
  ensureDemoAiQuota: vi.fn(() => ({ ok: true })),
  consumeDemoAiCalls: vi.fn(() => null),
  guardDemoProviderAction: vi.fn(() => ({ ok: true })),
  finalizeDemoProviderAction: vi.fn(() => null),
  markVisitorStandaloneStudioProviderStarted: vi.fn(() => null),
  buildDemoAccessSnapshot: vi.fn(() => ({})),
}));

vi.mock("@/tools/collectors/browser-use/sellerSpriteCollector", () => ({
  runSellerSpriteCollection: vi.fn().mockResolvedValue({ status: "failed", message: "unit test mock" }),
}));

vi.mock("@/tools/collectors/browser-use/amazonCompetitorCollector", () => ({
  runAmazonCompetitorCollection: vi.fn().mockResolvedValue({ status: "failed", message: "unit test mock" }),
  amazonCompetitorObservationToPreview: vi.fn(),
}));

vi.mock("@/lib/server/browserEvidenceCollect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/browserEvidenceCollect")>();
  return {
    ...actual,
    collectBrowserEvidencePreview: vi.fn().mockResolvedValue({ ok: false }),
  };
});

import { callAiJson } from "@/lib/server/aiClient";
import { GET as routeGetTask } from "@/app/api/tasks/[id]/route";
import { GET as routeGetAiEvidenceSummary } from "@/app/api/tasks/[id]/ai-evidence-summary/route";
import { GET as routeGetListingHandoff } from "@/app/api/tasks/[id]/listing-handoff/route";
import { GET as routeGetBrowserEvidence } from "@/app/api/tasks/[id]/browser-evidence/route";
import { GET as routeGetKeywordEvidence } from "@/app/api/tasks/[id]/keyword-evidence/route";
import { GET as routeGetCompetitorEvidence } from "@/app/api/tasks/[id]/competitor-evidence/route";
import { GET as routeGetSourcingEvidence } from "@/app/api/tasks/[id]/sourcing/route";
import { GET as routeGetReviewEvidence } from "@/app/api/tasks/[id]/review-evidence/route";
import {
  GET as routeGetOrchestrator,
  POST as routePostOrchestrator,
} from "@/app/api/tasks/[id]/research-orchestrator/route";
import {
  GET as routeGetDecision,
  PATCH as routePatchDecision,
} from "@/app/api/tasks/[id]/research-decision/route";

const NOW = "2026-08-15T00:00:00.000Z";
const DEMO_A = "demo-access-a";

const HASH_INPUT = {
  schema: "product-research-hash.v1" as const,
  candidateId: "candidate-1",
  runId: "run-1",
  contextHash: "c".repeat(64),
  inputHash: "d".repeat(64),
  resultHash: "e".repeat(64),
  workflowStatus: "completed" as const,
  reviewState: {
    sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true,
    reviewedCount: 4, totalReviewSteps: 4, allReviewed: true,
  },
};
const RESEARCH_HASH = buildProductResearchHash(HASH_INPUT);
const RESEARCH_RECORD = createInitialProductResearchRecord({
  candidateId: "candidate-1",
  runId: "run-1",
  contextHash: "c".repeat(64),
  researchHash: RESEARCH_HASH,
  workflowStatus: "completed",
  reviewState: HASH_INPUT.reviewState,
  decision: {
    decisionId: "550e8400-e29b-41d4-a716-446655440000",
    status: "needs_information",
    reason: "缺货源",
    nextAction: "补供应商",
  },
  actor: { mode: "owner", actorRef: "owner:v1" },
  now: NOW,
});
const RESEARCH_VERIFICATION = createProductResearchVerification(HASH_INPUT);

const COMPLETE_RESEARCH_RESULT = {
  sourceMeta: {
    productBatchSnapshot: {
      asin: "B0TEST0001",
      marketplace: "amazon.com",
      reportType: "keyword_mining",
      capturedAt: NOW,
      productFacts: {
        productTitle: "Insulated Water Bottle",
        brand: "AquaBrand",
        price: 29.99,
        rating: 4.5,
        reviews: 800,
        estimatedMonthlySales: 350,
      },
    },
  },
  browserEvidence: {
    schema: "browser-evidence.v1",
    version: 1,
    candidateId: "cand-1",
    targetAsin: "B0TEST0001",
    snapshots: [],
    updatedAt: NOW,
  },
  keywordEvidence: {
    schema: "keyword-evidence.v1",
    version: 1,
    reportType: "reverse_asin",
    rows: [],
    updatedAt: NOW,
  },
  competitorEvidence: {
    schema: "competitor-evidence.v1",
    version: 1,
    asins: [],
    updatedAt: NOW,
  },
  reviewEvidence: {
    schema: "review-evidence.v1",
    version: 1,
    dataset: { stats: { totalReviews: 0 }, reviews: [] },
    updatedAt: NOW,
  },
  sourcingEvidence: {
    schema: "sourcing-evidence.v1",
    version: 1,
    query: "保温杯",
    candidates: [],
    humanConfirmed: [],
    updatedAt: NOW,
  },
  researchRecord: RESEARCH_RECORD,
  researchVerification: RESEARCH_VERIFICATION,
  aiEvidenceSummary: {
    schema: "ai-evidence-summary.v1",
    version: 1,
    runId: "historic-run-999",
    inputEvidenceHash: "b".repeat(64),
    model: "legacy-deepseek-chat",
    summary: {
      facts: [{ id: "f1", type: "fact", text: "历史事实数据", evidenceRefs: ["ev:browser:1"] }],
      estimates: [],
      signals: [],
      risks: [{ id: "r1", type: "risk", text: "历史风险提示", evidenceRefs: ["ev:browser:1"] }],
      conflicts: [],
      missing: [],
      nextSteps: [],
    },
    gateResult: "pass",
    updatedAt: NOW,
  },
};

let root: string;
let originalSandboxEnv: string | undefined;
let originalAccessEnv: string | undefined;
let taskId: string;

beforeEach(async () => {
  vi.mocked(callAiJson).mockReset();
  root = mkdtempSync(join(tmpdir(), "research-gate-contract-"));
  originalSandboxEnv = process.env.DEMO_SANDBOX_STORE_PATH;
  originalAccessEnv = process.env.DEMO_ACCESS_STORE_PATH;
  process.env.DEMO_SANDBOX_STORE_PATH = join(root, "sandbox.json");
  process.env.DEMO_ACCESS_STORE_PATH = join(root, "access.json");

  const task = await createTrustedSandboxTask(DEMO_A, {
    type: "workflow",
    title: "Contract Task",
    platform: "amazon",
    productUrl: null,
    materialText: "",
    source: "demo",
    score: 80,
    level: "high",
    oneLineSummary: "Contract test task",
    resultJson: JSON.stringify(COMPLETE_RESEARCH_RESULT),
    productLifecycle: "new_candidate",
    decisionStatus: "pending",
    createdAt: NOW,
    updatedAt: NOW,
  } as Parameters<typeof createTrustedSandboxTask>[1]);
  taskId = task.id;
  mutateDemoSandboxStore((store) => {
    store.candidates.push({
      id: "candidate-1",
      demoAccessId: DEMO_A,
      name: "Insulated Water Bottle",
      rawInput: "Insulated Water Bottle",
      link: null,
      score: 80,
      source: "demo",
      keyword: "保温杯",
      riskLevel: "low",
      riskLabel: "低风险",
      summaryLabel: "可做",
      status: "converted",
      sourceMetaJson: "{}",
      analysisJson: "{}",
      createdAt: NOW,
      convertedTaskId: taskId,
    });
    return { value: true, changed: true };
  });
});

afterEach(() => {
  if (originalSandboxEnv === undefined) delete process.env.DEMO_SANDBOX_STORE_PATH;
  else process.env.DEMO_SANDBOX_STORE_PATH = originalSandboxEnv;
  if (originalAccessEnv === undefined) delete process.env.DEMO_ACCESS_STORE_PATH;
  else process.env.DEMO_ACCESS_STORE_PATH = originalAccessEnv;
  rmSync(root, { recursive: true, force: true });
});

describe("契约验证：商品研究主链路 Provider 调用归零门禁", () => {
  it("契约 1：任务详情与全套证据读取操作中，Provider 调用彻底为 0（callAiJson calls = 0）", async () => {
    const headers = { "x-access-token": "tok-demo-a" };
    const params = Promise.resolve({ id: taskId });

    // 1. 打开任务详情页 API
    const resTask = await routeGetTask(
      new NextRequest(`http://localhost/api/tasks/${taskId}`, { headers }),
      { params },
    );
    expect(resTask.status).toBe(200);

    // 2. 读取 AI 研究摘要 API
    const resAiSummary = await routeGetAiEvidenceSummary(
      new NextRequest(`http://localhost/api/tasks/${taskId}/ai-evidence-summary`, { headers }),
      { params },
    );
    expect(resAiSummary.status).toBe(200);

    // 3. 读取 Listing 交接上下文 API
    const resHandoff = await routeGetListingHandoff(
      new NextRequest(`http://localhost/api/tasks/${taskId}/listing-handoff`, { headers }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(resHandoff.status).toBe(200);

    // 4. 读取 5 大证据 API
    const resBrowser = await routeGetBrowserEvidence(
      new NextRequest(`http://localhost/api/tasks/${taskId}/browser-evidence`, { headers }),
      { params },
    );
    expect(resBrowser.status).toBe(200);

    const resKeyword = await routeGetKeywordEvidence(
      new NextRequest(`http://localhost/api/tasks/${taskId}/keyword-evidence`, { headers }),
      { params },
    );
    expect(resKeyword.status).toBe(200);

    const resCompetitor = await routeGetCompetitorEvidence(
      new NextRequest(`http://localhost/api/tasks/${taskId}/competitor-evidence`, { headers }),
      { params },
    );
    expect(resCompetitor.status).toBe(200);

    const resSourcing = await routeGetSourcingEvidence(
      new NextRequest(`http://localhost/api/tasks/${taskId}/sourcing`, { headers }),
      { params },
    );
    expect(resSourcing.status).toBe(200);

    const resReview = await routeGetReviewEvidence(
      new NextRequest(`http://localhost/api/tasks/${taskId}/review-evidence`, { headers }),
      { params },
    );
    expect(resReview.status).toBe(200);

    // 严格门禁断言：所有读操作全程不触发任何 AI Provider
    expect(vi.mocked(callAiJson)).toHaveBeenCalledTimes(0);
  });

  it("契约 2：研究采集编排器（Research Orchestrator）探测与触发采集时，Provider 调用彻底为 0", async () => {
    const headers = { "x-access-token": "tok-demo-a", "content-type": "application/json" };
    const params = Promise.resolve({ id: taskId });

    // 1. GET 便捷 inspect
    const resInspectGet = await routeGetOrchestrator(
      new NextRequest(`http://localhost/api/tasks/${taskId}/research-orchestrator`, { headers }),
      { params },
    );
    expect(resInspectGet.status).toBe(200);

    // 2. POST inspect
    const resInspectPost = await routePostOrchestrator(
      new NextRequest(`http://localhost/api/tasks/${taskId}/research-orchestrator`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "inspect" }),
      }),
      { params },
    );
    expect(resInspectPost.status).toBe(200);

    // 3. POST orchestrate
    const resOrchestrate = await routePostOrchestrator(
      new NextRequest(`http://localhost/api/tasks/${taskId}/research-orchestrator`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "orchestrate" }),
      }),
      { params },
    );
    expect(resOrchestrate.status).toBe(200);

    // 严格门禁断言：编排器动作绝对不触发 callAiJson，Provider 调用为 0
    expect(vi.mocked(callAiJson)).toHaveBeenCalledTimes(0);
  });

  it("契约 3：人工研究决定（Research Decision）读取与写入时，Provider 调用彻底为 0", async () => {
    const headers = { "x-access-token": "tok-demo-a", "content-type": "application/json" };
    const params = Promise.resolve({ id: taskId });

    // 1. GET 读取研究决定状态
    const resGetDec = await routeGetDecision(
      new NextRequest(`http://localhost/api/tasks/${taskId}/research-decision`, { headers }),
      { params },
    );
    expect(resGetDec.status).toBe(200);

    // 2. PATCH 提交人工研究决定
    const resPostDec = await routePatchDecision(
      new NextRequest(`http://localhost/api/tasks/${taskId}/research-decision`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          expectedRevision: 1,
          decisionId: "660e8400-e29b-41d4-a716-446655440000",
          status: "needs_information",
          reason: "确认需补充供应商资质",
          nextAction: "采集货源证书",
        }),
      }),
      { params },
    );
    expect(resPostDec.status).toBe(200);

    // 严格门禁断言：决定流程完全是业务状态机，零 Provider 调用
    expect(vi.mocked(callAiJson)).toHaveBeenCalledTimes(0);
  });

  it("契约 4：任务无历史摘要时，详情打开与读取绝不隐式自动触发 AI 总结生成", async () => {
    // 建立一个没有任何 aiEvidenceSummary 的崭新任务
    const { aiEvidenceSummary: _removed, ...noSummaryResult } = COMPLETE_RESEARCH_RESULT;
    const blankTask = await createTrustedSandboxTask(DEMO_A, {
      type: "workflow",
      title: "Blank Summary Task",
      platform: "amazon",
      productUrl: null,
      materialText: "",
      source: "demo",
      score: 60,
      level: "medium",
      oneLineSummary: "No summary task",
      resultJson: JSON.stringify(noSummaryResult),
      productLifecycle: "new_candidate",
      decisionStatus: "pending",
      createdAt: NOW,
      updatedAt: NOW,
    } as Parameters<typeof createTrustedSandboxTask>[1]);

    const headers = { "x-access-token": "tok-demo-a" };
    const params = Promise.resolve({ id: blankTask.id });

    // 读取摘要接口
    const res = await routeGetAiEvidenceSummary(
      new NextRequest(`http://localhost/api/tasks/${blankTask.id}/ai-evidence-summary`, { headers }),
      { params },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // 安全返回空态，无臆造
    expect(body.data.hasSummary).toBe(false);
    expect(body.data.businessModules.length).toBe(4);

    // 门禁保障：绝无后台静默自动调用大模型
    expect(vi.mocked(callAiJson)).toHaveBeenCalledTimes(0);
  });

  it("契约 5：历史数据兼容性保障——历史已生成的 AI 摘要可安全解析与展示，零 Provider 调用", async () => {
    const headers = { "x-access-token": "tok-demo-a" };
    const res = await routeGetAiEvidenceSummary(
      new NextRequest(`http://localhost/api/tasks/${taskId}/ai-evidence-summary`, { headers }),
      { params: Promise.resolve({ id: taskId }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.hasSummary).toBe(true);
    expect(Array.isArray(body.data.businessModules)).toBe(true);
    expect(Array.isArray(body.data.legacyCategories)).toBe(true);
    // 门禁：读历史数据零 Provider 调用
    expect(vi.mocked(callAiJson)).toHaveBeenCalledTimes(0);
  });
});
