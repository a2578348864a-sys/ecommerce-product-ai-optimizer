import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeSellerSpriteRowHash } from "@/lib/server/sellerSpriteImportContract";
import type { AccessContext } from "@/lib/server/accessPassword";
import { SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256 } from "@/lib/server/sellerSpritePluginContract";

const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: auth,
}));
// Owner 分支走 Prisma：本测试只驱动 Visitor 分支，db mock 保证导入期无真实数据库依赖。
vi.mock("@/lib/server/db", () => ({
  prisma: { $transaction: vi.fn() },
}));

// 真实 Candidate Authority（不 mock importSellerSpriteCandidates）。
import { importSellerSpriteCandidates } from "@/lib/server/sellerSpriteCandidateImport";
import { POST } from "./route";

const expectedOrigin = "http://localhost:3105";
const ROUTE_URL = `${expectedOrigin}/api/opportunities/sellersprite-plugin-import`;
const VISITOR: AccessContext = {
  mode: "demo",
  token: "",
  demoAccessId: "visitor-a",
  isActive: true,
  isExpired: false,
  remainingAiCalls: 50,
};

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asin: "B0TEST0001",
    title: "HydroJug Travel Tumbler 40oz",
    productUrl: "https://www.amazon.com/dp/B0TEST0001",
    brand: "HydroJug",
    category: "Home & Kitchen",
    priceUsd: 39.99,
    rating: 4.6,
    reviewCount: 1234,
    bsr: 120,
    estimatedMonthlySales: 5600,
    estimatedMonthlyRevenueUsd: 223944,
    variationCount: 4,
    reviewRate: 12.5,
    grossMargin: 35.2,
    listingDate: "2023-05-01",
    sellerCount: 2,
    fulfillment: "FBA",
    seller: "HydroJug Inc.",
    ...overrides,
  };
}

function buildRequest(body: Record<string, unknown>): NextRequest {
  const headers = new Headers({ "x-client-role": "visitor" });
  headers.set("host", new URL(expectedOrigin).host);
  headers.set("origin", expectedOrigin);
  headers.set("content-type", "application/json");
  return new NextRequest(ROUTE_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function previewTokenFor(rows: unknown[]): Promise<{ token: string; rowHash: string }> {
  const response = await POST(buildRequest({ stage: "preview", rows, capturedAt: "2026-08-20T08:30:00.000Z" }));
  expect(response.status).toBe(200);
  const body = await json(response);
  const preview = body.preview as Record<string, unknown>;
  const accepted = preview.acceptedRows as Array<Record<string, unknown>>;
  return { token: String(preview.previewToken), rowHash: String(accepted[0].rowHash) };
}

describe("POST /api/opportunities/sellersprite-plugin-import — real Candidate Authority (visitor sandbox)", () => {
  let tempRoot = "";

  beforeEach(() => {
    auth.mockReset();
    vi.stubEnv("ACCESS_PASSWORD", "authority-test-access-password");
    vi.stubEnv("APP_ACCESS_PASSWORD", "");
    auth.mockReturnValue({ ok: true, context: VISITOR });
    tempRoot = mkdtempSync(join(tmpdir(), "plugin-import-sandbox-"));
    process.env.DEMO_SANDBOX_STORE_PATH = join(tempRoot, "demo-sandbox.json");
    process.env.DEMO_ACCESS_STORE_PATH = join(tempRoot, "demo-access.json");
  });
  afterEach(() => {
    delete process.env.DEMO_SANDBOX_STORE_PATH;
    delete process.env.DEMO_ACCESS_STORE_PATH;
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  async function sandboxCandidate(
    asin: string,
  ): Promise<{ sourceMetaJson: string; source: string; link: string | null; status: string } | undefined> {
    const { loadDemoSandboxStore } = await import("@/lib/server/demoSandbox");
    const store = loadDemoSandboxStore();
    const candidate = store.candidates.find((c) => {
      if (c.demoAccessId !== "visitor-a") return false;
      try {
        return JSON.parse(c.sourceMetaJson).identity?.asin === asin;
      } catch {
        return false;
      }
    });
    if (!candidate) return undefined;
    return {
      sourceMetaJson: candidate.sourceMetaJson,
      source: candidate.source,
      link: candidate.link,
      status: candidate.status,
    };
  }

  it("creates a candidate with subtype sellersprite_plugin + plugin extras", async () => {
    const { token, rowHash } = await previewTokenFor([validRow()]);
    const confirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: token,
      selectedRowHashes: [rowHash],
      confirmed: true,
      capturedAt: "2026-08-20T08:30:00.000Z",
    }));
    expect(confirm.status).toBe(200);
    const body = await json(confirm);
    expect(body.ok).toBe(true);
    expect((body.created as unknown[]).length).toBe(1);

    const candidate = await sandboxCandidate("B0TEST0001");
    expect(candidate).toBeDefined();
    expect(candidate!.source).toBe("SellerSprite");
    expect(candidate!.link).toBe("https://www.amazon.com/dp/B0TEST0001");
    expect(candidate!.status).toBe("pending");
    const meta = JSON.parse(String(candidate!.sourceMetaJson));
    expect(meta.schema).toBe("sellersprite_candidate_source_v1");
    expect(meta.source.subtype).toBe("sellersprite_plugin");
    expect(meta.source.type).toBe("sellersprite_xlsx");
    expect(meta.source.sourceFileSha256).toBe(SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256);
    expect(meta.source.rowHash).toBe(rowHash);
    expect(meta.identity.asin).toBe("B0TEST0001");
    expect(meta.plugin.capturedAt).toBe("2026-08-20T08:30:00.000Z");
    expect(meta.plugin.variationCount).toBe(4);
    expect(meta.plugin.reviewRate).toBe(12.5);
    expect(meta.plugin.bsr).toBe(120);
    expect(meta.plugin.seller).toBe("HydroJug Inc.");
    expect(meta.estimates.disclaimer).toBe("third_party_estimate_point_in_time");
  });

  it("is idempotent on the marketplace:asin key: same snapshot → skipped", async () => {
    const first = await previewTokenFor([validRow()]);
    const firstConfirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: first.token,
      selectedRowHashes: [first.rowHash],
      confirmed: true,
    }));
    const firstBody = await json(firstConfirm);
    expect(firstBody.ok).toBe(true);

    const second = await previewTokenFor([validRow()]);
    const secondConfirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: second.token,
      selectedRowHashes: [second.rowHash],
      confirmed: true,
    }));
    expect(secondConfirm.status).toBe(200);
    const body = await json(secondConfirm);
    expect((body.created as unknown[]).length).toBe(0);
    expect((body.skipped as Array<{ reason: string }>)[0].reason).toBe("already_imported");
    expect((body.skipped as Array<{ candidateId: string }>)[0].candidateId)
      .toBe((firstBody.created as Array<{ candidateId: string }>)[0].candidateId);
  });

  it("conflicts when the same ASIN arrives with a different snapshot", async () => {
    const first = await previewTokenFor([validRow()]);
    const firstConfirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: first.token,
      selectedRowHashes: [first.rowHash],
      confirmed: true,
    }));
    expect((await json(firstConfirm)).ok).toBe(true);

    const changed = validRow({ title: "HydroJug Travel Tumbler 40oz (Renewed)" });
    const second = await previewTokenFor([changed]);
    const secondConfirm = await POST(buildRequest({
      stage: "confirm",
      rows: [changed],
      previewToken: second.token,
      selectedRowHashes: [second.rowHash],
      confirmed: true,
    }));
    expect(secondConfirm.status).toBe(200);
    const body = await json(secondConfirm);
    expect((body.created as unknown[]).length).toBe(0);
    expect((body.conflicts as Array<{ reason: string }>)[0].reason).toBe("candidate_exists_with_different_snapshot");
  });

  it("reuses the XLSX idempotency key: XLSX candidate then plugin row → conflict", async () => {
    // XLSX 链先落一条同 ASIN（无 pluginCapture，真实文件哈希）。
    const xlsxRow = {
      rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin: "B0TEST0001", title: "HydroJug Travel Tumbler 40oz", amazonUrl: "https://www.amazon.com/dp/B0TEST0001" }),
      rowNumber: 2,
      asin: "B0TEST0001",
      parentAsin: null,
      title: "HydroJug Travel Tumbler 40oz",
      amazonUrl: "https://www.amazon.com/dp/B0TEST0001",
      imageUrl: null,
      priceUsd: 39.99,
      rating: 4.6,
      reviewCount: 1234,
      brand: "HydroJug",
      category: "Home & Kitchen",
      searchRank: null,
      estimatedMonthlySales: null,
      estimatedMonthlyRevenueUsd: null,
    };
    const xlsxSummary = await importSellerSpriteCandidates({
      context: VISITOR,
      rows: [xlsxRow],
      sourceFileSha256: "f".repeat(64),
      importedAt: "2026-08-20T09:00:00.000Z",
    });
    expect(xlsxSummary.created).toHaveLength(1);

    // 插件链同 ASIN → 同一幂等键命中但快照不同 → conflict。
    const second = await previewTokenFor([validRow()]);
    const confirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: second.token,
      selectedRowHashes: [second.rowHash],
      confirmed: true,
    }));
    const body = await json(confirm);
    expect((body.created as unknown[]).length).toBe(0);
    expect((body.conflicts as Array<{ reason: string }>)[0].reason).toBe("candidate_exists_with_different_snapshot");
    expect((body.conflicts as Array<{ candidateId: string }>)[0].candidateId).toBe(xlsxSummary.created[0].candidateId);
  });

  it("isolates by visitor: another demoAccessId creates its own candidate", async () => {
    const { token, rowHash } = await previewTokenFor([validRow()]);
    auth.mockReturnValue({
      ok: true,
      context: { mode: "demo", token: "", demoAccessId: "visitor-b", isActive: true, isExpired: false, remainingAiCalls: 50 },
    });
    const confirm = await POST(buildRequest({
      stage: "confirm",
      rows: [validRow()],
      previewToken: token,
      selectedRowHashes: [rowHash],
      confirmed: true,
    }));
    // token 绑定 visitor-a 的 subject → visitor-b 确认必须 403。
    expect(confirm.status).toBe(403);
    expect(await json(confirm)).toMatchObject({ ok: false });
  });
});
