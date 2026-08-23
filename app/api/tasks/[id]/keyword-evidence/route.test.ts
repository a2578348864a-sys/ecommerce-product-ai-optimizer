import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireOwnerOnly: vi.fn(),
  findFirst: vi.fn(),
  runCollector: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
  requireAuthenticated: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/db", () => {
  const deep = () => new Proxy({}, { get: (t: Record<string, unknown>, k: string) => t[k] ?? (t[k] = vi.fn(() => null)) });
  const prisma = new Proxy({ viralAnalysisRecord: { findFirst: mocks.findFirst } } as Record<string, unknown>, {
    get: (t: Record<string, unknown>, k: string) => t[k] ?? (t[k] = deep()),
  });
  return { prisma };
});

vi.mock("@/tools/collectors/browser-use/sellerSpriteCollector", async (importOriginal) => ({
  ...(await importOriginal() as object),
  runSellerSpriteCollection: mocks.runCollector,
}));

vi.mock("@/lib/server/runtimeMode", () => ({ getRuntimeMode: () => "local_owner" }));

import { POST } from "./route";
import { storeBrowserUsePreview, type BrowserUseResearchPreviewV1 } from "@/lib/server/browserUseResearch";

function ownerRequest(body: unknown) {
  return {
    url: "http://localhost:3000/api/tasks/task-k/keyword-evidence",
    headers: new Headers({ origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }),
    json: async () => body,
    clone: function () { return this; },
    formData: async () => { throw new Error("no form"); },
  } as never;
}

function keywordPreview(overrides: Partial<BrowserUseResearchPreviewV1> = {}): BrowserUseResearchPreviewV1 {
  return {
    schema: "browser-use-research-preview.v1", version: 1, kind: "keyword",
    seedAsin: "B0SAMPLE12", marketplace: "Amazon US", seedProductUrl: null,
    sourceUrl: "https://www.amazon.com/dp/B0SAMPLE12", capturedAt: "2026-08-14T02:00:00.000Z",
    results: [{ keyword: "insulated tumbler", keywordTranslation: null, searchVolume: 45000, relevance: null, competition: 0.5, capturedAt: "2026-08-14T02:00:01.000Z" }],
    missing: [], failureReason: null,
    collector: { tool: "browser-use", version: "0.1.9" },
    ...overrides,
  } as BrowserUseResearchPreviewV1;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner", token: "t" } });
  mocks.findFirst.mockResolvedValue({ id: "task-k", resultJson: JSON.stringify({ candidateAnalysisContext: { version: "candidate-analysis-context-v1", integrity: "verified_product_batch", facts: { productName: "T", marketplace: "US", asin: "B0SAMPLE12", reportType: "search_results" }, assessment: {} } }), updatedAt: new Date("2026-08-14T02:00:00.000Z") });
  mocks.runCollector.mockImplementation(async () => ({ ok: true, preview: keywordPreview(), observation: null }));
});

describe("轮 9 关键词自动采集路由（browser_use）", () => {
  it("collect_browser_use → 200 + keyword Preview + previewId；保存权限拒绝（demo）→ 403", async () => {
    const collect = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-k" }) });
    const body = await collect.json();
    expect(collect.status).toBe(200);
    expect(body.data.kind).toBe("keyword");
    expect(body.data.preview.results[0].keyword).toBe("insulated tumbler");
    expect(body.data.previewId).toMatch(/^bup_preview_/);
    mocks.requireOwnerOnly.mockReturnValueOnce({ ok: false, status: 403, code: "browser_use_local_owner_only", message: "x" });
    const denied = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-k" }) });
    expect(denied.status).toBe(403);
  });

  it("身份缺失 409；交换 seed 409；伪造外站 URL 400；预览缺失 400；运行失败 502", async () => {
    for (const [label, overrideJson, expectCode] of [
      ["identity_unavailable", JSON.stringify({ candidateAnalysisContext: { integrity: "unverified" } }), "browser_use_identity_unavailable"],
    ] as const) {
      mocks.findFirst.mockResolvedValue({ id: "task-k", resultJson: overrideJson, updatedAt: new Date() });
      const res = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-k" }) });
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe(expectCode);
    }
    // 保存路径
    mocks.findFirst.mockResolvedValue({ id: "task-k", resultJson: JSON.stringify({ candidateAnalysisContext: { version: "candidate-analysis-context-v1", integrity: "verified_product_batch", facts: { productName: "T", marketplace: "US", asin: "B0SAMPLE12", reportType: "search_results" }, assessment: {} } }), updatedAt: new Date() });
    const evilId = storeBrowserUsePreview(keywordPreview({ sourceUrl: "https://evil.example/x" }));
    const forged = await POST(ownerRequest({ action: "save_browser_use", previewId: evilId, expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "x" } }), { params: Promise.resolve({ id: "task-k" }) });
    expect(forged.status).toBe(400);
    expect((await forged.json()).error.code).toBe("forged_external_source_url");
    const missing = await POST(ownerRequest({ action: "save_browser_use", previewId: "bup_preview_missing", expectedStorageVersion: { resultJsonHash: "a".repeat(64), updatedAt: "x" } }), { params: Promise.resolve({ id: "task-k" }) });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("preview_not_found");
    mocks.runCollector.mockResolvedValueOnce({ ok: false, failureReason: "collect_failed", detail: "x" });
    const failed = await POST(ownerRequest({ action: "collect_browser_use" }), { params: Promise.resolve({ id: "task-k" }) });
    expect(failed.status).toBe(502);
  });
});