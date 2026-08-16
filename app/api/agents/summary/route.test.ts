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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    accessPassword: CORRECT_PASSWORD,
    productName: "宠物慢食碗",
    category: "宠物用品",
    sourcingFindings: JSON.stringify({
      complianceBarrier: "medium",
      beginnerFit: "medium",
      suggestedEntryLevel: "intermediate",
    }),
    riskFindings: JSON.stringify({
      overallLevel: "yellow",
      blacklistMatches: [],
    }),
    productFindings: "宠物进食接触，材质、清洁和售后需人工复核。",
    viralFindings: "慢食场景清楚，但不能承诺安全认证。",
    extraNotes: "pet slow feeder dog bowl food contact silicone",
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

describe("POST /api/agents/summary（F8 收口）", () => {
  it("孤儿真实 AI 接口已下线：任意请求返回 410，不调用 AI、不消耗配额", async () => {
    const response = await POST(createRequest(validBody()));
    const { status, body } = await readJson(response);
    expect(status).toBe(410);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("legacy_endpoint_disabled");
    expect(mockCallAiJson).not.toHaveBeenCalled();
  });
});
