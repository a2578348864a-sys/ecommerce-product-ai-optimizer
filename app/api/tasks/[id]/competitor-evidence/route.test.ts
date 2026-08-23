import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerOnly: vi.fn(),
  findUnique: vi.fn(),
  runCollector: vi.fn(),
  runAmazon: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
  requireAuthenticated: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/db", () => {
  const deep = () => new Proxy({}, { get: (t: Record<string, unknown>, k: string) => t[k] ?? (t[k] = vi.fn(() => null)) });
  const prisma = new Proxy({ viralAnalysisRecord: { findUnique: mocks.findUnique, findFirst: mocks.findUnique } } as Record<string, unknown>, {
    get: (t: Record<string, unknown>, k: string) => t[k] ?? (t[k] = deep()),
  });
  return { prisma };
});

vi.mock("@/tools/collectors/browser-use/amazonCompetitorCollector", async (importOriginal) => ({
  ...(await importOriginal() as object),
  runAmazonCompetitorCollection: mocks.runAmazon,
}));

vi.mock("@/tools/collectors/browser-use/sellerSpriteCollector", async (importOriginal) => ({
  ...(await importOriginal() as object),
  runSellerSpriteCollection: mocks.runCollector,
}));

vi.mock("@/lib/server/runtimeMode", () => ({ getRuntimeMode: () => "local_owner" }));

import { POST } from "./route";
import { takeBrowserUsePreview, storeBrowserUsePreview, type BrowserUseResearchPreviewV1 } from "@/lib/server/browserUseResearch";

function batchResultJson(asin = "B0SAMPLE12") {
  return JSON.stringify({
    type: "workflow",
    productName: "T",
    candidateAnalysisContext: {
      version: "candidate-analysis-context-v1", integrity: "verified_product_batch",
      facts: { productName: "T", marketplace: "US", asin, reportType: "search_results" },
      assessment: { researchMode: "market_research_only", promotionEligible: false },
    },
  });
}

function ownerRequest(body: unknown) {
  return {
    url: "http://localhost:3000/api/tasks/task-a/competitor-evidence",
    headers: new Headers({ origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }),
    json: async () => body,
    clone: function () { return this; },
  } as never;
}


function keywordPreview() {
  return {
    schema: "browser-use-research-preview.v1", version: 1, kind: "keyword",
    seedAsin: "B0SAMPLE12", marketplace: "Amazon US", seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
    results: [{ keyword: "lunch box", keywordTranslation: "\u5348\u9910\u76d2", searchVolume: 100, abaWeeklyRank: 1, purchaseVolume: 10, relevance: null, competition: 1, capturedAt: "2026-08-14T02:00:00.000Z" }],
    missing: [], failureReason: null,
    collector: { tool: "browser-use", version: "0.1.9" },
  };
}

function amazonObservation() {
  return {
    schema: "amazon-search-observation.v1", url: "https://www.amazon.com/s?k=lunch%20box", title: "Amazon Search", bodyText: "ok",
    parsedCards: 1,
    cards: [{ asin: "B0COMP0002", title: "Competitor 40oz", sourceUrl: "https://www.amazon.com/dp/B0COMP0002", imageUrl: null, price: 19.99, rating: 4.4, reviews: 88, capturedAt: "2026-08-14T02:00:01.000Z", sponsored: false }],
    structureChanged: false, failureReason: null, observedAt: "2026-08-14T02:00:00.000Z",
  };
}

function preview(overrides: Partial<BrowserUseResearchPreviewV1> = {}): BrowserUseResearchPreviewV1 {
  return {
    schema: "browser-use-research-preview.v1", version: 1, kind: "competitor",
    seedAsin: "B0SAMPLE12", marketplace: "Amazon US", seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
    results: [{ asin: "B0COMP0002", title: "Competitor 40oz", imageUrl: null, price: 19.99, rating: 4.4, reviews: 88, bsr: 5000, sourceUrl: "https://www.amazon.com/dp/B0COMP0002", capturedAt: "2026-08-14T02:00:01.000Z" }],
    missing: [], failureReason: null,
    collector: { tool: "browser-use", version: "0.1.9" },
    ...overrides,
  } as BrowserUseResearchPreviewV1;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner", token: "t" } });
  mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson(), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
  mocks.runCollector.mockImplementation(async () => ({ ok: true, preview: keywordPreview(), observation: null }));
  mocks.runAmazon.mockImplementation(async () => ({ ok: true, observation: amazonObservation() }));
});

describe("轮 9 竞品自动采集路由（browser_use）", () => {
  it("collect_browser_use 仅接受服务端身份：200 + Preview + previewId；交换 seed → save 409", async () => {
    const collect = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    const collectBody = await collect.json();
    expect(collect.status).toBe(200);
    expect(collectBody.data.preview.seedAsin).toBe("B0SAMPLE12");
    expect(collectBody.data.previewId).toMatch(/^bup_preview_/);
    // 交换 seed：任务身份变为其它 ASIN → 409（不覆盖）
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson("B0OTHER123"), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
    const save = await POST(ownerRequest({ action: "save_browser_use", previewId: collectBody.data.previewId, expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" } }), { params: Promise.resolve({ id: "task-a" }) });
    expect(save.status).toBe(409);
    expect((await save.json()).error.code).toBe("seed_asin_mismatch");
  });

  it("伪造外站来源 URL（服务端缓存注入外站）→ 400 forged_external_source_url", async () => {
    const evilId = storeBrowserUsePreview(preview({ sourceUrl: "https://evil.example/dp/B0SAMPLE12" }));
    const save = await POST(ownerRequest({ action: "save_browser_use", previewId: evilId, expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-14T02:00:00.000Z" } }), { params: Promise.resolve({ id: "task-a" }) });
    expect(save.status).toBe(400);
    expect((await save.json()).error.code).toBe("forged_external_source_url");
  });

  it("Visitor/Sandbox → 403 拒绝；身份缺失 → 409；采集运行失败 → 502；预览缺失 → 400", async () => {
    mocks.requireOwnerOnly.mockReturnValueOnce({ ok: false, status: 403, code: "browser_use_local_owner_only", message: "x" });
    const denied = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    expect(denied.status).toBe(403);
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner", token: "t" } });
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: JSON.stringify({ candidateAnalysisContext: { integrity: "unverified" } }), updatedAt: new Date() });
    const noIdentity = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    expect(noIdentity.status).toBe(409);
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson(), updatedAt: new Date() });
    mocks.runCollector.mockResolvedValueOnce({ ok: false, failureReason: "collector_unavailable", detail: "x" });
    const failed = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    expect(failed.status).toBe(502);
    const missing = await POST(ownerRequest({ action: "save_browser_use", previewId: "bup_preview_missing", expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "x" } }), { params: Promise.resolve({ id: "task-a" }) });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("preview_not_found");
  });

  it("轮 10 服务端串联：seed→SellerSprite关键词→选词→Amazon 采集；客户端伪造 query/seed 被忽略；seed 不进入结果为竞品", async () => {
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson(), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
    // 客户端试图伪造身份
    const collect = await POST(ownerRequest({ action: "collect_browser_use", asin: "B0FAKE0001", query: "from-client", keyword: "forged" }), { params: Promise.resolve({ id: "task-a" }) });
    const body = await collect.json();
    expect(collect.status).toBe(200);
    // 服务端调用参数只来自任务身份（B0SAMPLE12）与 SellerSprite 关键词
    expect(mocks.runCollector).toHaveBeenCalledWith(expect.objectContaining({ kind: "keyword", seedAsin: "B0SAMPLE12" }));
    expect(mocks.runAmazon).toHaveBeenCalledWith(expect.objectContaining({ seedAsin: "B0SAMPLE12", keyword: "lunch box" }));
    expect(body.data.preview.kind).toBe("competitor");
    expect(body.data.preview.results.some((c: { asin: string }) => c.asin === "B0SAMPLE12")).toBe(false);
    expect(body.data.preview.results.some((c: { asin: string }) => c.asin === "B0COMP0002")).toBe(true);
    expect(body.data.preview.missing).toEqual([]);
  });

  it("Amazon 验证码观察 → Preview 带 captcha_required；save 被拒且写入器调用 0 次", async () => {
    mocks.runAmazon.mockResolvedValueOnce({ ok: true, observation: { ...amazonObservation(), bodyText: "Enter the characters you see below", cards: [], failureReason: "captcha_required" } });
    const collect = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    const body = await collect.json();
    expect(collect.status).toBe(200);
    expect(body.data.preview.failureReason).toBe("captcha_required");
    expect(body.data.preview.results).toEqual([]);
    const save = await POST(ownerRequest({ action: "save_browser_use", previewId: body.data.previewId, expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "x" } }), { params: Promise.resolve({ id: "task-a" }) });
    expect(save.status).toBe(400);
    expect((await save.json()).error.code).toBe("preview_not_collectable");
  });

  it("SellerSprite 关键词失败 → 502 seller_sprite_keyword_failed（不使用标题/旧快照顶替）", async () => {
    mocks.runCollector.mockResolvedValueOnce({ ok: false, failureReason: "captcha_required", detail: "x" });
    const res = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("seller_sprite_keyword_failed");
  });
  it("轮 10 合并红线：collect 成功时复用关键词预览（keywordPreviewId 可被 keyword save 消费；竞品失败则零 preview）", async () => {
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson(), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
    const collect = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    const body = await collect.json();
    expect(collect.status).toBe(200);
    expect(body.data.kind).toBe("competitor");
    expect(typeof body.data.keywordPreviewId).toBe("string");
    expect(typeof body.data.keywordCount).toBe("number");
    const kwPreview = takeBrowserUsePreview(body.data.keywordPreviewId);
    expect(kwPreview?.kind).toBe("keyword");
    expect(kwPreview?.results?.length ?? 0).toBeGreaterThan(0);
    expect(kwPreview?.seedAsin).toBe("B0SAMPLE12");
    // kw 段成功但竞品段失败 → 整体失败且不落任何关键词预览
    mocks.findUnique.mockResolvedValue({ id: "task-a", resultJson: batchResultJson(), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
    mocks.runAmazon.mockResolvedValueOnce({ ok: false, failureReason: "collector_unavailable", detail: "x" });
    const failed = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-a" }) });
    const failedBody = await failed.json();
    expect(failed.status).toBe(502);
    expect(failedBody.data?.keywordPreviewId).toBeUndefined();
  });
});
