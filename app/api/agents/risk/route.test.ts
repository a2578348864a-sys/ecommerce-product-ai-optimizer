import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CORRECT_PASSWORD = "ci-test-password";

const mockCallAiJson = vi.fn();

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

let POST: any;

function createRequest(body: unknown) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  };
}

async function readJson(response: Response) {
  const cloned = response.clone();
  return { status: cloned.status, body: await cloned.json() };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    accessPassword: CORRECT_PASSWORD,
    productName: "桌面手机支架",
    category: "3C配件",
    claims: "桌面支撑",
    targetPlatform: "amazon",
    description: "普通铝合金桌面手机支架，无电池、无液体、无儿童使用场景。",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  const mod = await import("./route");
  POST = mod.POST;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/agents/risk（F8 收口）", () => {
  it("孤儿真实 AI 接口已下线：任意请求返回 410，不调用 AI、不消耗配额", async () => {
    const response = await POST(createRequest(body()));
    const { status, body: json } = await readJson(response);
    expect(status).toBe(410);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("legacy_endpoint_disabled");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });
});
