import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import * as demoGuard from "@/lib/server/demoGuard";
import * as demoSandbox from "@/lib/server/demoSandbox";
import { prisma } from "@/lib/server/db";

describe("Reference Listing Draft API Route (/api/tasks/[id]/reference-listing-draft)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("场景 F：无权访问时 fail-closed 拒绝访问，不泄露来源和文案", async () => {
    vi.spyOn(demoGuard, "requireOwnerOnly").mockReturnValue({
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "请先登录。",
    });

    const req = new NextRequest("http://localhost:3005/api/tasks/task-123/reference-listing-draft");
    const res = await GET(req, { params: Promise.resolve({ id: "task-123" }) });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("unauthorized");
  });

  it("任务记录不存在时返回 404", async () => {
    vi.spyOn(demoGuard, "requireOwnerOnly").mockReturnValue({
      ok: true,
      context: { mode: "owner", token: "mock-token" },
    });
    vi.spyOn(prisma.viralAnalysisRecord, "findFirst").mockResolvedValue(null);

    const req = new NextRequest("http://localhost:3005/api/tasks/non-existent/reference-listing-draft");
    const res = await GET(req, { params: Promise.resolve({ id: "non-existent" }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("not_found");
  });

  it("场景 A：合法任务无需人工确认，GET 返回 ready 准备度与资料清单，POST 成功生成初稿", async () => {
    vi.spyOn(demoGuard, "requireOwnerOnly").mockReturnValue({
      ok: true,
      context: { mode: "owner", token: "mock-token" },
    });

    const mockTask = {
      id: "cmtn5chb20002fiwcie9exo4f",
      title: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
      productUrl: "https://www.amazon.com/dp/B0EXAMPLE1",
      resultJson: JSON.stringify({
        productName: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
        asin: "B0EXAMPLE1",
        sourceMeta: {
          productBatchSnapshot: {
            asin: "B0EXAMPLE1",
            marketplace: "US",
            productFacts: {
              brand: "pickpiff",
              productTitle: "pickpiff Matt Black Self-Adhesive Hook, 4-Pack",
            },
          },
        },
        browserEvidence: {
          snapshots: [
            {
              asin: "B0EXAMPLE1",
              productInfo: {
                canonicalFacts: {
                  color_or_variant: "Matte Black",
                  quantity_or_pack_size: "4-Pack",
                  dimensions: "1.77 x 1.77 inches",
                },
              },
            },
          ],
        },
      }),
    };

    vi.spyOn(prisma.viralAnalysisRecord, "findFirst").mockResolvedValue(mockTask as any);
    const updateSpy = vi.spyOn(prisma.viralAnalysisRecord, "update");

    // 1. GET 请求：读取准备度
    const getReq = new NextRequest(`http://localhost:3005/api/tasks/${mockTask.id}/reference-listing-draft`);
    const getRes = await GET(getReq, { params: Promise.resolve({ id: mockTask.id }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.ok).toBe(true);
    expect(getJson.data.status).toBe("ready");
    expect(getJson.data.adoptedCount).toBeGreaterThanOrEqual(3);

    // 2. POST 请求：生成初稿
    const postReq = new NextRequest(
      `http://localhost:3005/api/tasks/${mockTask.id}/reference-listing-draft`,
      { method: "POST" },
    );
    const postRes = await POST(postReq, { params: Promise.resolve({ id: mockTask.id }) });
    expect(postRes.status).toBe(200);
    const postJson = await postRes.json();
    expect(postJson.ok).toBe(true);
    expect(postJson.data.status).toBe("ready");
    expect(postJson.data.title).toContain("pickpiff");
    expect(postJson.data.title).toContain("Matte Black");
    expect(postJson.data.bullets.length).toBeGreaterThanOrEqual(3);
    expect(postJson.data.generatedBy).toBe("local_rules");
    expect(postJson.data.badgeLabel).toBe("研究对象参考初稿 · 基于采集资料，待人工复核");

    // 3. 验证数据库零变更：完全没有调用 update 写入数据库
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
