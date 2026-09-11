import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/products/keywords` 全局 AI 开关回归。
 *
 * 2026-09 最终审计：该路由与 listing-copy / ai-analysis 一样直接调用 Provider，
 * 却没有任何服务端 AI 开关检查，因此 `OPENAI_LISTING_ENABLED=false` 时仍会真调。
 * 本测试锁定：关闭时不发请求、不消耗额度；开启时原行为不变；请求契约不变。
 */

const CORRECT_PASSWORD = "ci-test-password";

const mockCallAiJson = vi.fn();

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

let POST: any;

function createRequest(body: unknown) {
  const json = JSON.stringify({ accessPassword: CORRECT_PASSWORD, ...(body as Record<string, unknown> || {}) });
  return {
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => json,
  };
}

async function readJson(response: Response) {
  const cloned = response.clone();
  return { status: cloned.status, body: await cloned.json() };
}

function requestBody(product: Record<string, unknown> = {}) {
  return {
    product: {
      name: "桌面手机支架",
      description: "普通支架",
      targetPlatform: "amazon",
      ...product,
    },
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  // The global AI switch is a separate gate from auth: this route calls the
  // Provider directly, so these cases run with it explicitly enabled.
  vi.stubEnv("OPENAI_LISTING_ENABLED", "true");
  const mod = await import("./route");
  POST = mod.POST;
});

describe("POST /api/products/keywords", () => {
  it("全局 AI 开关关闭时：403 real_ai_disabled，不调用 Provider、不消耗额度", async () => {
    vi.stubEnv("OPENAI_LISTING_ENABLED", "false");

    const response = await POST(createRequest(requestBody()));
    const { status, body } = await readJson(response);

    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("real_ai_disabled");
    expect(body.error.message).toContain("没有消耗额度");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("开关关闭不改变请求契约：非法请求体仍返回 400 而不是 403", async () => {
    vi.stubEnv("OPENAI_LISTING_ENABLED", "false");

    const response = await POST(createRequest({ product: { description: "缺少商品名称" } }));
    const { status, body } = await readJson(response);

    expect(status).toBe(400);
    expect(mockCallAiJson).not.toHaveBeenCalled();
    expect(body.ok).toBe(false);
  });

  it("开关开启时原功能保持：Provider 被调用并返回成功", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        coreKeywords: ["desk phone stand"],
        longTailKeywords: ["adjustable desk phone stand"],
        searchTerms: ["phone holder"],
        titleKeywords: ["desk stand"],
        sellingPointKeywords: ["adjustable angle"],
        riskWords: [],
        negativeKeywords: [],
        platformNotes: "关键词结果需人工复核。",
      },
    });

    const response = await POST(createRequest(requestBody()));
    const { status, body } = await readJson(response);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockCallAiJson).toHaveBeenCalledTimes(1);
  });
});
