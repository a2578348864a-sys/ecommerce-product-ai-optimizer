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

describe("POST /api/agents/summary", () => {
  it("AI 返回 fenced JSON 时能解析并返回 200", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        verdict: "可做但需控制成本",
        confidence: "中",
        summary: "宠物慢食碗可以观察，但需要先复核材质。",
        reasons: ["需求明确", "售价区间可测"],
        risks: ["食品接触材料需复核", "清洁和售后需关注"],
        nextSteps: ["索取材质文件", "小批量测评"],
        beginnerTip: "别先写认证承诺。",
      },
    });

    const response = await POST(createRequest(validBody()));
    const { status, body } = await readJson(response);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.verdict).toBe("可做但需控制成本");
  });

  it("AI JSON parse 失败时不返回 500，而是保守 fallback 并标记 parseFailed", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "json_parse_error",
        message: "Failed to parse JSON from AI text.",
        detail: "not-json with long raw model output",
      },
    });

    const response = await POST(createRequest(validBody()));
    const { status, body } = await readJson(response);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.parseFailed).toBe(true);
    expect(body.data.confidence).toBe("低");
    expect(["暂不建议做", "新手不建议做", "有经验再做", "可做但需控制成本"]).toContain(body.data.verdict);
    expect(JSON.stringify(body)).not.toContain("not-json with long raw model output");
  });

  it("parse fallback 仍经过 hard guard，高风险儿童带电品不能给乐观结论", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "json_parse_error",
        message: "Failed to parse JSON from AI text.",
      },
    });

    const response = await POST(createRequest(validBody({
      productName: "儿童电动牙刷",
      category: "母婴用品",
      extraNotes: "儿童 电动 USB充电 电池 口腔接触",
      sourcingFindings: JSON.stringify({
        complianceBarrier: "high",
        beginnerFit: "low",
        suggestedEntryLevel: "experienced",
      }),
      riskFindings: JSON.stringify({
        overallLevel: "red",
        blacklistMatches: ["儿童用品", "带电产品"],
      }),
    })));
    const { status, body } = await readJson(response);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.parseFailed).toBe(true);
    expect(["新手不建议做", "暂不建议做"]).toContain(body.data.verdict);
    expect(body.data.downgradeReasons.length).toBeGreaterThan(0);
  });

  it("summary 输出会清理无依据认证承诺", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        verdict: "新手可小单测试",
        confidence: "高",
        summary: "This is FDA approved and 100% safe.",
        reasons: ["CE certified", "CPSIA compliant"],
        risks: ["RoHS certified"],
        nextSteps: ["Write CPC certified in listing"],
        beginnerTip: "non-toxic guaranteed",
      },
    });

    const response = await POST(createRequest(validBody()));
    const { body } = await readJson(response);
    const text = JSON.stringify(body);

    expect(text).not.toMatch(/FDA approved|CE certified|CPSIA compliant|RoHS certified|CPC certified|100% safe|non-toxic guaranteed/i);
    expect(text).toMatch(/人工复核|索取|合规文件|认证/);
  });
});
