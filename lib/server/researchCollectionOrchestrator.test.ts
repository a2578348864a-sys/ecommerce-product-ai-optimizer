import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  readBrowserEvidence: vi.fn(),
  readBrowserEvidenceTaskAsin: vi.fn(),
  collectBrowserEvidencePreview: vi.fn(),
  resolveBrowserAcquisitionCapability: vi.fn(),
  getKeywordEvidence: vi.fn(),
  getCompetitorEvidence: vi.fn(),
  runSellerSpriteCollection: vi.fn(),
  runAmazonCompetitorCollection: vi.fn(),
  getReviewEvidence: vi.fn(),
  getSourcingEvidence: vi.fn(),
  getRuntimeMode: vi.fn(),
}));

vi.mock("@/lib/server/db", () => {
  const prisma = {
    viralAnalysisRecord: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findFirst,
    },
  };
  return { prisma };
});

vi.mock("@/lib/server/browserEvidence", () => ({
  readBrowserEvidence: mocks.readBrowserEvidence,
  readBrowserEvidenceTaskAsin: mocks.readBrowserEvidenceTaskAsin,
}));

vi.mock("@/lib/server/browserEvidenceCollect", () => ({
  collectBrowserEvidencePreview: mocks.collectBrowserEvidencePreview,
  storeBrowserEvidencePreview: vi.fn(),
}));

vi.mock("@/lib/server/acquisitionCapability", () => ({
  resolveBrowserAcquisitionCapability: mocks.resolveBrowserAcquisitionCapability,
}));

vi.mock("@/lib/server/keywordEvidence", () => ({
  getKeywordEvidence: mocks.getKeywordEvidence,
}));

vi.mock("@/lib/server/competitorEvidence", () => ({
  getCompetitorEvidence: mocks.getCompetitorEvidence,
}));

vi.mock("@/tools/collectors/browser-use/sellerSpriteCollector", () => ({
  runSellerSpriteCollection: mocks.runSellerSpriteCollection,
}));

vi.mock("@/tools/collectors/browser-use/amazonCompetitorCollector", () => ({
  runAmazonCompetitorCollection: mocks.runAmazonCompetitorCollection,
  amazonCompetitorObservationToPreview: vi.fn(() => ({
    schema: "browser-use-research-preview.v1",
    version: 1,
    kind: "competitor",
    seedAsin: "B0SAMPLE01",
    marketplace: "US",
    seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE01",
    capturedAt: new Date().toISOString(),
    results: [
      {
        asin: "B0COMP0001",
        title: "Test Competitor",
        imageUrl: null,
        price: 25.99,
        rating: 4.5,
        reviews: 120,
        bsr: 1000,
        sourceUrl: "https://www.amazon.com/dp/B0COMP0001",
        capturedAt: new Date().toISOString(),
      },
    ],
    missing: [],
    failureReason: null,
    collector: { tool: "browser-use", version: "1.0.0" },
  })),
}));

vi.mock("@/lib/server/reviewEvidence", () => ({
  getReviewEvidence: mocks.getReviewEvidence,
}));

vi.mock("@/lib/server/runtimeMode", () => ({
  getRuntimeMode: mocks.getRuntimeMode,
}));

// Sourcing Evidence: 部分 mock，保留内存 previewStore
vi.mock("@/lib/server/sourcingEvidence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/sourcingEvidence")>();
  return {
    ...actual,
    getSourcingEvidence: mocks.getSourcingEvidence,
  };
});

import {
  orchestrateResearchCollection,
  sanitizeErrorMessage,
  _clearOrchestratorRunningStateForTests,
} from "./researchCollectionOrchestrator";
import {
  storeBrowserUsePreview,
  _clearBrowserUsePreviewCacheForTests,
} from "./browserUseResearch";
import {
  createSourcingPreview,
  resetSourcingPreviewStoreForTests,
} from "./sourcingEvidence";
import type { AccessContext } from "./accessPassword";

// ── 测试辅助数据 ─────────────────────────────────────────────────────────

const ownerContext: AccessContext = { mode: "owner", token: "test-owner-token" };

function buildTaskResultJson(asin = "B0SAMPLE01") {
  return JSON.stringify({
    type: "workflow",
    productName: "Test Bento Box",
    candidateAnalysisContext: {
      version: "candidate-analysis-context-v1",
      integrity: "verified_product_batch",
      facts: {
        productName: "Test Bento Box",
        marketplace: "US",
        asin,
        reportType: "search_results",
      },
      assessment: {
        researchMode: "market_research_only",
        promotionEligible: false,
      },
    },
  });
}

describe("researchCollectionOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _clearOrchestratorRunningStateForTests();
    _clearBrowserUsePreviewCacheForTests();
    resetSourcingPreviewStoreForTests();

    mocks.getRuntimeMode.mockReturnValue("local_owner");
    mocks.findFirst.mockResolvedValue({
      id: "task-001",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      resultJson: buildTaskResultJson("B0SAMPLE01"),
    });

    mocks.readBrowserEvidence.mockResolvedValue(null);
    mocks.readBrowserEvidenceTaskAsin.mockResolvedValue("B0SAMPLE01");
    mocks.resolveBrowserAcquisitionCapability.mockReturnValue({ state: "ready" });
    mocks.getKeywordEvidence.mockResolvedValue(null);
    mocks.getCompetitorEvidence.mockResolvedValue(null);
    mocks.getReviewEvidence.mockResolvedValue(null);
    mocks.getSourcingEvidence.mockResolvedValue(null);
  });

  describe("sanitizeErrorMessage", () => {
    it("脱敏敏感词（token, password, secret, cookie）", () => {
      const msg = "Error: request failed with bearer secret_token_xyz and cookie: session=abc12345";
      const sanitized = sanitizeErrorMessage(new Error(msg));
      expect(sanitized).not.toContain("secret_token_xyz");
      expect(sanitized).not.toContain("session=abc12345");
      expect(sanitized).toContain("bearer ***");
      expect(sanitized).toContain("cookie=***");
    });

    it("只保留首行有界错误描述，防止 raw stack trace 泄漏", () => {
      const longStack = "First line error\n at Function.execute (file.ts:10:5)\n at Layer.run (layer.ts:20:10)";
      const sanitized = sanitizeErrorMessage(new Error(longStack));
      expect(sanitized).toBe("First line error");
      expect(sanitized).not.toContain("at Function.execute");
    });
  });

  describe("inspect action", () => {
    it("只做只读状态探测，绝不调用任何外部采集", async () => {
      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "inspect",
      });

      expect(result.action).toBe("inspect");
      expect(result.overallStatus).toBe("needs_user");
      expect(result.sources.amazon.status).toBe("needs_user");
      expect(result.sources.keywordCompetitor.status).toBe("needs_user");
      expect(result.sources.voc.status).toBe("needs_user");
      expect(result.sources.sourcing1688.status).toBe("needs_user");

      // 验证未触发任何采集方法
      expect(mocks.runSellerSpriteCollection).not.toHaveBeenCalled();
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
      expect(mocks.collectBrowserEvidencePreview).not.toHaveBeenCalled();
    });
  });

  describe("idempotency with existing evidence", () => {
    it("已有正式 Evidence 时返回 ready，不调用采集", async () => {
      mocks.readBrowserEvidence.mockResolvedValue({
        schema: "browser-evidence.v1",
        version: 1,
        targetAsin: "B0SAMPLE01",
        dataset: { title: "Amazon Bento Box" },
      });
      mocks.getKeywordEvidence.mockResolvedValue({
        schema: "keyword-evidence.v1",
        rows: [{ keyword: "bento box" }],
        items: [{ keyword: "bento box" }],
      });
      mocks.getCompetitorEvidence.mockResolvedValue({
        schema: "competitor-evidence.v1",
        asins: [{ asin: "B0COMP01" }],
        competitors: [{ asin: "B0COMP01" }],
      });
      mocks.getReviewEvidence.mockResolvedValue({
        schema: "review-evidence.v1",
        version: 1,
        dataset: { reviews: [{ reviewText: "Great quality" }] },
      });
      mocks.getSourcingEvidence.mockResolvedValue({
        schema: "sourcing-evidence.v1",
        humanConfirmed: [{ offerId: "12345678" }],
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.overallStatus).toBe("ready");
      expect(result.sources.amazon.status).toBe("ready");
      expect(result.sources.keywordCompetitor.status).toBe("ready");
      expect(result.sources.voc.status).toBe("ready");
      expect(result.sources.sourcing1688.status).toBe("ready");

      // 铁律验证：已就绪源不重复调用采集
      expect(mocks.runSellerSpriteCollection).not.toHaveBeenCalled();
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
      expect(mocks.collectBrowserEvidencePreview).not.toHaveBeenCalled();
    });
  });

  describe("idempotency with pending previews", () => {
    it("已有待确认 Pending 预览时返回 awaiting_confirmation，不调用采集", async () => {
      // 1. 注入待确认的关键词/竞品 preview
      const previewId = storeBrowserUsePreview({
        schema: "browser-use-research-preview.v1",
        version: 1,
        kind: "competitor",
        seedAsin: "B0SAMPLE01",
        marketplace: "Amazon US",
        seedProductUrl: null,
        sourceUrl: "https://www.amazon.com/dp/B0SAMPLE01",
        capturedAt: new Date().toISOString(),
        results: [],
        missing: [],
        failureReason: null,
        collector: { tool: "browser-use", version: "1.0.0" },
      });

      // 2. 注入待确认的 1688 货源 preview
      const sourcingPreview = createSourcingPreview({
        context: ownerContext,
        taskId: "task-001",
        method: "keyword",
        query: "便当盒",
        runTrace: {
          source: "1688",
          method: "keyword",
          query: "便当盒",
          timestamp: new Date().toISOString(),
          driverVersion: "1.0.0",
          resolverVersion: null,
          success: true,
          failClosedReason: null,
        },
        candidates: [],
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("awaiting_confirmation");
      expect(result.sources.keywordCompetitor.previewId).toBe(previewId);
      expect(result.sources.sourcing1688.status).toBe("awaiting_confirmation");
      expect(result.sources.sourcing1688.previewId).toBe(sourcingPreview.previewId);

      // 铁律验证：已有 pending 不调用采集
      expect(mocks.runSellerSpriteCollection).not.toHaveBeenCalled();
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
    });
  });

  describe("Failure Isolation", () => {
    it("Keyword+Competitor 采集失败绝不导致整次请求 throw，返回 sources.keywordCompetitor.status = failed", async () => {
      // 模拟 SellerSprite 采集失败
      mocks.runSellerSpriteCollection.mockResolvedValue({
        ok: false,
        failureReason: "collector_unavailable",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      // 整体不抛出异常，返回结果结构完整
      expect(result).toBeDefined();
      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.error?.code).toBe("seller_sprite_keyword_failed");

      // 其他来源正常执行探测，未受牵连
      expect(result.sources.amazon).toBeDefined();
      expect(result.sources.voc).toBeDefined();
      expect(result.sources.sourcing1688).toBeDefined();
    });

    it("Amazon 竞品搜寻异常时进行隔离，不影响其他源", async () => {
      // SellerSprite 成功，但 Amazon 竞品搜寻失败
      mocks.runSellerSpriteCollection.mockResolvedValue({
        ok: true,
        preview: {
          schema: "browser-use-research-preview.v1",
          version: 1,
          kind: "keyword",
          seedAsin: "B0SAMPLE01",
          marketplace: "Amazon US",
          seedProductUrl: null,
          sourceUrl: "https://www.amazon.com/dp/B0SAMPLE01",
          capturedAt: new Date().toISOString(),
          results: [
            {
              keyword: "bento lunch box",
              keywordTranslation: "午餐盒",
              searchVolume: 5000,
              abaWeeklyRank: 10,
              purchaseVolume: 500,
              relevance: null,
              competition: 0.8,
              capturedAt: new Date().toISOString(),
            },
          ],
          missing: [],
          failureReason: null,
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      mocks.runAmazonCompetitorCollection.mockResolvedValue({
        ok: false,
        failureReason: "collect_failed",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.error?.code).toBe("amazon_competitor_collect_failed");
    });
  });

  describe("strict red lines verification", () => {
    it("严禁 autoConfirm / autoSaveEvidence / confirmed=true", async () => {
      mocks.runSellerSpriteCollection.mockResolvedValue({
        ok: true,
        preview: {
          schema: "browser-use-research-preview.v1",
          version: 1,
          kind: "keyword",
          seedAsin: "B0SAMPLE01",
          marketplace: "Amazon US",
          seedProductUrl: null,
          sourceUrl: "https://www.amazon.com/dp/B0SAMPLE01",
          capturedAt: new Date().toISOString(),
          results: [
            {
              keyword: "bento box",
              keywordTranslation: "便当盒",
              searchVolume: 1000,
              abaWeeklyRank: 50,
              purchaseVolume: 100,
              relevance: null,
              competition: 0.5,
              capturedAt: new Date().toISOString(),
            },
          ],
          missing: [],
          failureReason: null,
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      mocks.runAmazonCompetitorCollection.mockResolvedValue({
        ok: true,
        observation: {
          schema: "amazon-search-observation.v1",
          url: "https://www.amazon.com/s?k=bento%20box",
          title: "Amazon Search",
          bodyText: "ok",
          parsedCards: 1,
          cards: [],
          structureChanged: false,
          failureReason: null,
          observedAt: new Date().toISOString(),
        },
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      // 必须停留在 awaiting_confirmation 状态，等待人工确认
      expect(result.sources.keywordCompetitor.status).toBe("awaiting_confirmation");
      expect(result.sources.keywordCompetitor.previewId).toBeTruthy();
      expect(result.sources.keywordCompetitor.hasEvidence).toBe(false);
    });

    it("并发保护：同一任务正在运行 orchestrate 时，并发请求返回 running", async () => {
      let finishFirstCall!: (value: unknown) => void;
      const startedPromise = new Promise<void>((resolveStarted) => {
        mocks.runSellerSpriteCollection.mockImplementation(
          () =>
            new Promise((resolve) => {
              finishFirstCall = resolve;
              resolveStarted();
            }),
        );
      });

      // 发起第一个 orchestrate 请求（异步执行并在 runSellerSpriteCollection 处挂起）
      const firstPromise = orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-concurrency",
        action: "orchestrate",
      });

      // 等待第一个请求确已进入执行中
      await startedPromise;

      // 在第一个请求挂起期间，发起第二个并发请求
      const secondResult = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-concurrency",
        action: "orchestrate",
      });

      expect(secondResult.overallStatus).toBe("running");
      expect(secondResult.sources.amazon.status).toBe("running");
      expect(secondResult.sources.keywordCompetitor.status).toBe("running");

      // 结束第一个请求并等待其完成
      finishFirstCall({
        ok: false,
        failureReason: "test_concurrency_end",
      });
      await firstPromise;
    });
  });
});

