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
  createReviewCollectPreview: vi.fn(),
  findPendingReviewCollectPreview: vi.fn(),
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

vi.mock("@/lib/server/browserEvidenceCollect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/browserEvidenceCollect")>();
  return {
    ...actual,
    collectBrowserEvidencePreview: mocks.collectBrowserEvidencePreview,
  };
});

vi.mock("@/lib/server/acquisitionCapability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/acquisitionCapability")>();
  return {
    ...actual,
    resolveBrowserAcquisitionCapability: mocks.resolveBrowserAcquisitionCapability,
  };
});

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

vi.mock("@/lib/server/reviewCollector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/reviewCollector")>();
  return {
    ...actual,
    createReviewCollectPreview: mocks.createReviewCollectPreview,
    findPendingReviewCollectPreview: mocks.findPendingReviewCollectPreview,
  };
});

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
import {
  storeBrowserEvidencePreview,
  findPendingBrowserEvidencePreview,
  resetBrowserEvidencePreviewStoreForTests,
} from "./browserEvidenceCollect";
import type { AccessContext } from "./accessPassword";

// ── 测试辅助数据 ─────────────────────────────────────────────────────────

const ownerContext: AccessContext = { mode: "owner", token: "test-owner-token" };

function buildSampleBrowserCollectPreview(asin = "B0SAMPLE01") {
  return {
    extraction: {
      schemaVersion: "amazon-detail-page-extraction.v1" as const,
      expectedAsin: asin,
      urlAsin: asin,
      pageAsin: asin,
      pageStatus: "ok" as const,
      capturedAt: new Date().toISOString(),
      collectorVersion: "amazon-detail-page-extractor.v1",
      entityBound: true,
      bindingProof: {
        urlMatchesExpected: true,
        pageAnchorMatchesExpected: true,
        productContainerFound: true,
      },
      fields: {
        asin: { field: "asin" as const, value: asin, status: "correct" as const, reason: null },
        title: { field: "title" as const, value: "Test Bento Box", status: "correct" as const, reason: null },
        price: { field: "price" as const, value: 19.99, status: "correct" as const, reason: null },
        bsr: { field: "bsr" as const, value: 100, status: "correct" as const, reason: null },
        rating: { field: "rating" as const, value: 4.5, status: "correct" as const, reason: null },
        reviews: { field: "reviews" as const, value: 200, status: "correct" as const, reason: null },
      },
    },
    navigation: {
      requestedUrl: `https://www.amazon.com/dp/${asin}`,
      finalUrl: `https://www.amazon.com/dp/${asin}`,
      httpStatus: 200,
      navigationElapsedMs: 100,
      allowedFinalOrigin: true,
    },
    calibration: null,
  };
}

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
    resetBrowserEvidencePreviewStoreForTests();

    mocks.getRuntimeMode.mockReturnValue("local_owner");
    mocks.findFirst.mockResolvedValue({
      id: "task-001",
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      resultJson: buildTaskResultJson("B0SAMPLE01"),
    });

    mocks.readBrowserEvidence.mockResolvedValue(null);
    mocks.readBrowserEvidenceTaskAsin.mockResolvedValue("B0SAMPLE01");
    mocks.resolveBrowserAcquisitionCapability.mockReturnValue({ state: "available" });
    mocks.collectBrowserEvidencePreview.mockResolvedValue(buildSampleBrowserCollectPreview("B0SAMPLE01"));
    mocks.getKeywordEvidence.mockResolvedValue(null);
    mocks.getCompetitorEvidence.mockResolvedValue(null);
    mocks.getReviewEvidence.mockResolvedValue(null);
    mocks.findPendingReviewCollectPreview.mockReturnValue(null);
    mocks.createReviewCollectPreview.mockReset();
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

    it("脱敏文件路径（Windows 与 Unix filepath）", () => {
      const msg = "Failed to run C:\\Users\\a2578\\.local\\bin\\browser-use.exe and /home/user/app/script.py";
      const sanitized = sanitizeErrorMessage(new Error(msg));
      expect(sanitized).not.toContain("C:\\Users\\a2578\\.local\\bin\\browser-use.exe");
      expect(sanitized).not.toContain("/home/user/app/script.py");
      expect(sanitized).toContain("[filepath]");
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

      // 3. 注入待确认的 Amazon 详情 preview
      const amazonPreviewId = "bev_preview_existing_001";
      storeBrowserEvidencePreview({
        evidenceId: amazonPreviewId,
        preview: buildSampleBrowserCollectPreview("B0SAMPLE01"),
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result.sources.amazon.previewId).toBe(amazonPreviewId);
      expect(result.sources.keywordCompetitor.status).toBe("awaiting_confirmation");
      expect(result.sources.keywordCompetitor.previewId).toBe(previewId);
      expect(result.sources.sourcing1688.status).toBe("awaiting_confirmation");
      expect(result.sources.sourcing1688.previewId).toBe(sourcingPreview.previewId);

      // 铁律验证：已有 pending 不调用采集
      expect(mocks.runSellerSpriteCollection).not.toHaveBeenCalled();
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
      expect(mocks.collectBrowserEvidencePreview).not.toHaveBeenCalled();
    });

    it("Amazon 首次采集生成 Pending Preview，未确认前二次编排返回 awaiting_confirmation 且采集器调用增量为 0", async () => {
      // 第一次编排：未有 Pending Preview，触发采集
      const result1 = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result1.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result1.sources.amazon.hasEvidence).toBe(false);
      const firstPreviewId = result1.sources.amazon.previewId;
      expect(firstPreviewId).toBeTruthy();
      expect(mocks.collectBrowserEvidencePreview).toHaveBeenCalledTimes(1);

      // 第二次编排：已有有效的 Pending Preview，命中幂等保护，不再触发采集（delta = 0）
      const result2 = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result2.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result2.sources.amazon.hasEvidence).toBe(false);
      expect(result2.sources.amazon.previewId).toBe(firstPreviewId);
      expect(result2.sources.amazon.message).toBe("Amazon 详情已有待确认采集预览");
      expect(mocks.collectBrowserEvidencePreview).toHaveBeenCalledTimes(1); // delta = 0
    });

    it("inspect 探测阶段若存在 Amazon Pending Preview，直接返回 awaiting_confirmation 且不调用采集器", async () => {
      storeBrowserEvidencePreview({
        evidenceId: "bev_preview_inspect_test",
        preview: buildSampleBrowserCollectPreview("B0SAMPLE01"),
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "inspect",
      });

      expect(result.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result.sources.amazon.previewId).toBe("bev_preview_inspect_test");
      expect(result.sources.amazon.message).toBe("Amazon 详情已有待确认采集预览");
      expect(mocks.collectBrowserEvidencePreview).not.toHaveBeenCalled();
    });

    it("任务隔离：task-001 的 Amazon Pending Preview 不会被 task-002 误用", async () => {
      storeBrowserEvidencePreview({
        evidenceId: "bev_preview_task_001",
        preview: buildSampleBrowserCollectPreview("B0SAMPLE01"),
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      mocks.findFirst.mockResolvedValue({
        id: "task-002",
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
        resultJson: buildTaskResultJson("B0SAMPLE01"),
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-002",
        action: "orchestrate",
      });

      expect(result.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result.sources.amazon.previewId).not.toBe("bev_preview_task_001");
      expect(mocks.collectBrowserEvidencePreview).toHaveBeenCalledTimes(1);
    });

    it("ASIN 隔离：同一任务若 ASIN 发生变更，不复用旧 ASIN 的 Pending Preview", async () => {
      storeBrowserEvidencePreview({
        evidenceId: "bev_preview_old_asin",
        preview: buildSampleBrowserCollectPreview("B0OLDASIN01"),
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0OLDASIN01",
      });

      mocks.readBrowserEvidenceTaskAsin.mockResolvedValue("B0NEWASIN02");

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result.sources.amazon.previewId).not.toBe("bev_preview_old_asin");
      expect(mocks.collectBrowserEvidencePreview).toHaveBeenCalledTimes(1);
    });

    it("过期失效：已过期的 Amazon Pending Preview 自动失效并允许重新采集", async () => {
      storeBrowserEvidencePreview({
        evidenceId: "bev_preview_expired",
        preview: buildSampleBrowserCollectPreview("B0SAMPLE01"),
        capturedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
        expiresAt: Date.now() - 1000, // 已过期
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.amazon.status).toBe("awaiting_confirmation");
      expect(result.sources.amazon.previewId).not.toBe("bev_preview_expired");
      expect(mocks.collectBrowserEvidencePreview).toHaveBeenCalledTimes(1);
    });

    it("主体隔离：Owner 与 Visitor 互不可见彼此的 Amazon Pending Preview", () => {
      storeBrowserEvidencePreview({
        evidenceId: "bev_preview_owner",
        preview: buildSampleBrowserCollectPreview("B0SAMPLE01"),
        capturedAt: new Date().toISOString(),
        expiresAt: Date.now() + 15 * 60 * 1000,
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      const ownerPending = findPendingBrowserEvidencePreview({
        subjectKey: "owner:v1",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });
      const visitorPending = findPendingBrowserEvidencePreview({
        subjectKey: "visitor:demo-user-123",
        taskId: "task-001",
        asin: "B0SAMPLE01",
      });

      expect(ownerPending?.evidenceId).toBe("bev_preview_owner");
      expect(visitorPending).toBeNull();
    });
  });

  describe("Failure Isolation and explicit white-list error classification", () => {
    it("SellerSprite 采集引擎不可用（未启动或超时）时返回 typed error 与脱敏 message", async () => {
      // 模拟 SellerSprite 采集引擎不可用
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
      expect(result.sources.keywordCompetitor.message).toBe("SellerSprite 采集引擎不可用（未启动或超时）");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "seller_sprite_collector_unavailable",
        message: "SellerSprite 采集引擎不可用（未启动或超时）",
      });

      // 其他来源正常执行探测，未受牵连
      expect(result.sources.amazon).toBeDefined();
      expect(result.sources.voc).toBeDefined();
      expect(result.sources.sourcing1688).toBeDefined();
    });

    it("SellerSprite 采集失败（未获得有效页面观察）时返回 typed error", async () => {
      mocks.runSellerSpriteCollection.mockResolvedValue({
        ok: false,
        failureReason: "collect_failed",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.message).toBe("SellerSprite 关键词采集失败：未获得有效页面观察");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "seller_sprite_keyword_failed",
        message: "SellerSprite 关键词采集失败：未获得有效页面观察",
      });
    });

    it("login_required 返回 needs_user 与 typed error", async () => {
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
          results: [],
          missing: ["sellersprite_keyword_rows"],
          failureReason: "login_required",
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("needs_user");
      expect(result.sources.keywordCompetitor.message).toBe("SellerSprite 插件未登录，请在浏览器中登录后重试");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "seller_sprite_login_required",
        message: "SellerSprite 插件未登录，请在浏览器中登录后重试",
      });
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
    });

    it("captcha_required 返回 needs_user 与 typed error", async () => {
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
          results: [],
          missing: ["sellersprite_keyword_rows"],
          failureReason: "captcha_required",
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("needs_user");
      expect(result.sources.keywordCompetitor.message).toBe("SellerSprite 遇到图形验证码，请在浏览器中完成验证");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "seller_sprite_captcha_required",
        message: "SellerSprite 遇到图形验证码，请在浏览器中完成验证",
      });
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
    });

    it("panel_not_detected 返回 failed 与 typed error", async () => {
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
          results: [],
          missing: ["sellersprite_keyword_rows"],
          failureReason: "panel_not_detected",
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.message).toBe("未检测到 SellerSprite 插件面板，请确认插件已开启");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "seller_sprite_panel_not_detected",
        message: "未检测到 SellerSprite 插件面板，请确认插件已开启并刷新页面",
      });
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
    });

    it("no_reliable_search_keyword 返回 failed 与 typed error", async () => {
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
          results: [], // 空关键词列表，selectReliableSearchKeyword 返回 null
          missing: [],
          failureReason: null,
          collector: { tool: "browser-use", version: "1.0.0" },
        },
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.message).toBe("SellerSprite 关键词没有可用的非品牌查询词，已停止");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "no_reliable_search_keyword",
        message: "SellerSprite 关键词没有可用的非品牌查询词，已停止自动竞品采集",
      });
      expect(mocks.runAmazonCompetitorCollection).not.toHaveBeenCalled();
    });

    it("Amazon 竞品搜寻引擎不可用时返回 amazon_competitor_collector_unavailable", async () => {
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
        failureReason: "collector_unavailable",
      });

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      expect(result.sources.keywordCompetitor.message).toBe("Amazon 竞品采集引擎不可用（未启动或超时）");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "amazon_competitor_collector_unavailable",
        message: "Amazon 竞品采集引擎不可用（未启动或超时）",
      });
    });

    it("Amazon 竞品搜寻未获得有效观察时返回 amazon_competitor_collect_failed", async () => {
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
      expect(result.sources.keywordCompetitor.message).toBe("Amazon 搜索采集失败：未获得有效页面观察");
      expect(result.sources.keywordCompetitor.error).toEqual({
        code: "amazon_competitor_collect_failed",
        message: "Amazon 搜索采集失败：未获得有效页面观察",
      });
    });

    it("top-level message 存在且脱敏（异常中禁止输出 token/cookie/filepath/stack）", async () => {
      mocks.runSellerSpriteCollection.mockRejectedValue(
        new Error(
          "Fatal error at C:\\Users\\admin\\secret.ts with bearer secret_token_123 and cookie: session=abc\n at Layer.run (stack.ts:1:1)",
        ),
      );

      const result = await orchestrateResearchCollection({
        context: ownerContext,
        taskId: "task-001",
        action: "orchestrate",
      });

      expect(result.sources.keywordCompetitor.status).toBe("failed");
      const topMsg = result.sources.keywordCompetitor.message;
      const errMsg = result.sources.keywordCompetitor.error?.message;
      expect(topMsg).toBeTruthy();
      expect(errMsg).toBeTruthy();
      expect(topMsg).toBe(errMsg);
      expect(topMsg).not.toContain("secret_token_123");
      expect(topMsg).not.toContain("session=abc");
      expect(topMsg).not.toContain("C:\\Users\\admin\\secret.ts");
      expect(topMsg).not.toContain("at Layer.run");
      expect(topMsg).toContain("bearer ***");
      expect(topMsg).toContain("cookie=***");
      expect(topMsg).toContain("[filepath]");
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


// ── 第十一版：VOC 自动采集合同（Review Preview 幂等 / Human Gate / Provider=0）──
describe("VOC auto collection contract (v11)", { timeout: 30000 }, () => {
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
    mocks.resolveBrowserAcquisitionCapability.mockReturnValue({ state: "available" });
    mocks.getKeywordEvidence.mockResolvedValue(null);
    mocks.getCompetitorEvidence.mockResolvedValue(null);
    mocks.getReviewEvidence.mockResolvedValue(null);
    mocks.getSourcingEvidence.mockResolvedValue(null);
    mocks.findPendingReviewCollectPreview.mockReturnValue(null);
    // 重置并发测试遗留的 hanging collector 实现（否则 v11 orchestrate 永久挂起）
    mocks.runSellerSpriteCollection.mockResolvedValue(undefined);
    mocks.runAmazonCompetitorCollection.mockResolvedValue(undefined);
    mocks.collectBrowserEvidencePreview.mockResolvedValue(buildSampleBrowserCollectPreview("B0SAMPLE01"));
  });

  function sampleReviewPreview() {
    return {
      previewId: "rcp_test_001",
      items: [
        { asin: "B0SAMPLE01", role: "current_candidate", rating: 5, date: "2026-01-01", title: "Great product", sourceUrl: "https://www.amazon.com/gp/customer-reviews/x", bindingNote: null },
        { asin: "B0SAMPLE01", role: "current_candidate", rating: 2, date: "2026-01-02", title: "Broke quickly", sourceUrl: "https://www.amazon.com/gp/customer-reviews/y", bindingNote: null },
      ],
      pageResults: [{ asin: "B0SAMPLE01", status: "ok", note: null, extractedCount: 2 }],
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + 15 * 60 * 1000,
    };
  }

  it("V1 已有正式 Review Evidence → ready 且 collector 不被调用", async () => {
    mocks.getReviewEvidence.mockResolvedValue({
      dataset: { reviews: [{ evidenceId: "e1" }, { evidenceId: "e2" }] },
    });
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("ready");
    expect(result.sources.voc.hasEvidence).toBe(true);
    expect(result.sources.voc.itemCount).toBe(2);
    expect(mocks.createReviewCollectPreview).not.toHaveBeenCalled();
  });

  it("V2 已有 Pending Review Preview → awaiting_confirmation 且 collector 不被调用", async () => {
    mocks.findPendingReviewCollectPreview.mockReturnValue({
      previewId: "rcp_pending_1",
      items: [{ asin: "B0SAMPLE01", role: "current_candidate", rating: 5, date: null, title: "t", sourceUrl: "", bindingNote: null }],
      pageResults: [],
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + 15 * 60 * 1000,
      subjectKey: "owner:v1",
      taskId: "task-001",
    });
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("awaiting_confirmation");
    expect(result.sources.voc.previewId).toBe("rcp_pending_1");
    expect(result.sources.voc.itemCount).toBe(1);
    expect(mocks.createReviewCollectPreview).not.toHaveBeenCalled();
  });

  it("V3 inspect 模式：无 Evidence / 无 Pending → needs_user 且 collector 不被调用", async () => {
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "inspect" });
    expect(result.sources.voc.status).toBe("needs_user");
    expect(result.sources.voc.message).toContain("待采集买家评论");
    expect(mocks.createReviewCollectPreview).not.toHaveBeenCalled();
  });

  it("V4 orchestrate + 权威 ASIN + capability available → 恰好采集一次并生成 Preview", async () => {
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("awaiting_confirmation");
    expect(result.sources.voc.previewId).toBe("rcp_test_001");
    expect(result.sources.voc.itemCount).toBe(2);
    expect(mocks.createReviewCollectPreview).toHaveBeenCalledTimes(1);
    expect(mocks.createReviewCollectPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        context: ownerContext,
        taskId: "task-001",
        asins: [{ asin: "B0SAMPLE01", role: "current_candidate" }],
      }),
    );
  });

  it("V5 无权威 ASIN → needs_user 且 collector 不被调用", async () => {
    mocks.readBrowserEvidenceTaskAsin.mockResolvedValue(null);
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("needs_user");
    expect(result.sources.voc.message).toContain("缺少可验证的 Amazon 商品身份");
    expect(mocks.createReviewCollectPreview).not.toHaveBeenCalled();
  });

  it("V6 capability local_env_required → needs_user 与 typed message（owner 模式）", async () => {
    mocks.resolveBrowserAcquisitionCapability.mockReturnValue({ state: "local_env_required", reasonCategory: "local_environment_required" });
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("needs_user");
    expect(result.sources.voc.error?.code).toBe("local_environment_required");
    expect(mocks.createReviewCollectPreview).not.toHaveBeenCalled();
  });

  it("V7 ReviewCollectorError browser_not_available → needs_user（typed）", async () => {
    const { ReviewCollectorError } = await import("@/lib/server/reviewCollector");
    mocks.createReviewCollectPreview.mockRejectedValue(new ReviewCollectorError("browser_not_available", 503, "no browser"));
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("needs_user");
    expect(result.sources.voc.error?.code).toBe("browser_not_available");
    // Failure isolation：其他来源正常返回
    expect(result.sources.amazon).toBeDefined();
    expect(result.sources.sourcing1688).toBeDefined();
  });

  it("V8 未知内部错误 → failed + 脱敏 message，Failure Isolation 不拖死其他源", async () => {
    mocks.createReviewCollectPreview.mockRejectedValue(new Error("boom at C:\\secret\\path.ts with token=abc"));
    const result = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(result.sources.voc.status).toBe("failed");
    expect(result.sources.voc.error?.code).toBe("voc_collect_failed");
    expect(result.sources.voc.message).not.toContain("path.ts");
    expect(result.sources.voc.message).not.toContain("token=abc");
    // 其他源继续
    expect(result.sources.keywordCompetitor).toBeDefined();
  });

  it("V9 连续两次 orchestrate（同 task/subject）：第二次复用 Pending（collector 总调用 = 1）", async () => {
    let stored: { previewId: string } | null = null;
    mocks.createReviewCollectPreview.mockImplementation(async () => {
      const preview = sampleReviewPreview();
      stored = preview;
      return preview;
    });
    // findPending 先返回 null（第一次），collect 后返回注册的 pending（第二次）
    mocks.findPendingReviewCollectPreview.mockImplementationOnce(() => null);
    mocks.findPendingReviewCollectPreview.mockImplementation(() => stored);
    const r1 = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(r1.sources.voc.status).toBe("awaiting_confirmation");
    const r2 = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(r2.sources.voc.status).toBe("awaiting_confirmation");
    expect(r2.sources.voc.previewId).toBe((stored as unknown as { previewId: string }).previewId);
    expect(mocks.createReviewCollectPreview).toHaveBeenCalledTimes(1);
  });

  it("V10 任务隔离：task-002 不得复用 task-001 的 Pending", async () => {
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    const storedTaskId = "task-001";
    mocks.findPendingReviewCollectPreview.mockReset();
    mocks.findPendingReviewCollectPreview.mockImplementation((query: { taskId: string }) => {
      return query.taskId === storedTaskId
        ? { previewId: "rcp_t1", items: [{ asin: "B0SAMPLE01", role: "current_candidate", rating: 5, date: null, title: "t", sourceUrl: "", bindingNote: null }], pageResults: [], capturedAt: "", expiresAt: Date.now() + 60000, subjectKey: "owner:v1", taskId: storedTaskId }
        : null;
    });
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    const r2 = await orchestrateResearchCollection({ context: ownerContext, taskId: "task-002", action: "orchestrate" });
    expect(r2.sources.voc.status).toBe("awaiting_confirmation");
    // task-002 的 pending 查询返回 null → 走 collect
    // task-001 的 Pending 被复用（0 次 collect）；task-002 无 pending → 1 次 collect
    expect(mocks.createReviewCollectPreview).toHaveBeenCalledTimes(1);
    expect(mocks.createReviewCollectPreview).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: "task-002" }));
  });

  it("V11 主体隔离：visitor 不得复用 owner 的 Pending", async () => {
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    mocks.findPendingReviewCollectPreview.mockReset();
    mocks.findPendingReviewCollectPreview.mockImplementation((query: { subjectKey: string }) => {
      return query.subjectKey === "owner:v1"
        ? { previewId: "rcp_owner", items: [{ asin: "B0SAMPLE01", role: "current_candidate", rating: 5, date: null, title: "t", sourceUrl: "", bindingNote: null }], pageResults: [], capturedAt: "", expiresAt: Date.now() + 60000, subjectKey: "owner:v1", taskId: "task-001" }
        : null;
    });
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    const visitorContext = { mode: "demo", token: "tok", demoAccessId: "demo-1", isActive: true, isExpired: false, remainingAiCalls: 5 } as never;
    // Owner 的 findPending 查询使用 owner:v1
    expect(mocks.findPendingReviewCollectPreview).toHaveBeenCalledWith(
      expect.objectContaining({ subjectKey: "owner:v1" }),
    );
    // subjectKey 函数级隔离证明：同一 demoAccessId 的 visitor 与 owner 永远不同 key
    const { reviewCollectSubjectKey: getSubjectKey } = await import("@/lib/server/reviewCollector");
    const ownerKey = getSubjectKey({ mode: "owner", token: "t" } as never);
    const visitorKey = getSubjectKey({ mode: "demo", demoAccessId: "demo-1" } as never);
    expect(ownerKey).toBe("owner:v1");
    expect(visitorKey).toBe("visitor:demo-1");
    expect(ownerKey).not.toBe(visitorKey);
  });

  it("V12 过期 Pending 不得复用（findPending 返回 null → 重新采集）", async () => {
    mocks.createReviewCollectPreview.mockResolvedValue(sampleReviewPreview());
    mocks.findPendingReviewCollectPreview.mockReturnValue(null);
    await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    await orchestrateResearchCollection({ context: ownerContext, taskId: "task-001", action: "orchestrate" });
    expect(mocks.createReviewCollectPreview).toHaveBeenCalledTimes(2);
  });

  it("V13 Human Gate：orchestrator 无 collect-confirm / analyzeVoc / importReviews / takeReviewCollectPreview 调用", async () => {
    const fs = await import("node:fs");
    // 去除注释后检查实际代码调用（注释中的提及不算调用）
    const src = fs.readFileSync("lib/server/researchCollectionOrchestrator.ts", "utf8");
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(codeOnly).not.toContain("collectConfirmAction");
    expect(codeOnly).not.toContain("analyzeVoc");
    expect(codeOnly).not.toContain("importReviews");
    expect(codeOnly).not.toContain("collect-confirm");
    expect(codeOnly).not.toContain("takeReviewCollectPreview");
  });
});
