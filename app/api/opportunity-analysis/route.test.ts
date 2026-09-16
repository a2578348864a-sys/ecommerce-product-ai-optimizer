import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAiJson = vi.fn();

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

let POST: any;

function createRequest(body: unknown) {
  const json = JSON.stringify(body);
  return {
    headers: new Headers({ "content-type": "application/json", "content-length": String(json.length) }),
    text: async () => json,
  };
}

function candidate(index: number, overrides: Record<string, unknown> = {}) {
  return {
    title: `露营候选方向 ${index}`,
    reason: "值得研究，需要验证真实需求",
    painPoints: ["收纳体积偏大"],
    validationNeeded: ["同类供给强度未知"],
    ...overrides,
  };
}

function aiOk(candidates: unknown[]) {
  return { ok: true, data: { candidates }, providerCallStarted: true };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  const mod = await import("./route");
  POST = mod.POST;
});

describe("POST /api/opportunity-analysis", () => {
  it("成功返回固定候选结构", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3), candidate(4)]));

    const response = await POST(createRequest({ category: "户外露营用品", marketplace: "Amazon US" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.marketplace).toBe("Amazon US");
    expect(body.category).toBe("户外露营用品");
    expect(body.candidates).toHaveLength(4);
    expect(Object.keys(body.candidates[0]).sort()).toEqual([
      "painPoints",
      "reason",
      "title",
      "validationNeeded",
    ]);
  });

  it("目标市场缺省为 Amazon US", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2), candidate(3)]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(body.marketplace).toBe("Amazon US");
  });

  it("净化 AI 返回的违禁结论表达", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([
      candidate(1, {
        title: "露营爆款挂灯",
        reason: "这是爆款，一定赚钱，市场巨大",
        painPoints: ["高销量品类"],
        validationNeeded: ["是否真的一定赚钱"],
      }),
      candidate(2),
      candidate(3),
    ]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();
    const serialized = JSON.stringify(body.candidates);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("爆款");
    expect(serialized).not.toContain("一定赚钱");
    expect(serialized).not.toContain("高销量");
    expect(serialized).not.toContain("市场巨大");
  });

  it("AI 失败返回可恢复错误", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: { code: "timeout", message: "AI request timed out." },
      providerCallStarted: true,
    });

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ai_unavailable");
    expect(body.error.recoverable).toBe(true);
    expect(body.error.message).toBe("safe:timeout");
  });

  it("候选不足 3 个返回可恢复错误", async () => {
    mockCallAiJson.mockResolvedValueOnce(aiOk([candidate(1), candidate(2)]));

    const response = await POST(createRequest({ category: "户外露营用品" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("insufficient_candidates");
    expect(body.error.recoverable).toBe(true);
  });

  it("缺少商品方向返回 400", async () => {
    const response = await POST(createRequest({ category: "   " }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_category");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("不支持的市场返回 400", async () => {
    const response = await POST(createRequest({ category: "户外露营用品", marketplace: "eBay US" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_marketplace");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });

  it("非法 JSON 请求体返回 400", async () => {
    const response = await POST({
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => "{not-json",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
  });
});
