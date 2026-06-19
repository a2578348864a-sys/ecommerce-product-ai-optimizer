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

describe("POST /api/agents/risk", () => {
  it("儿童电动牙刷 AI provider 失败时不返回 500，返回保守 red/yellow 风险", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: { code: "provider_error", message: "AI provider returned an error.", detail: "secret-like detail should not leak" },
    });

    const response = await POST(createRequest(body({
      productName: "儿童电动牙刷",
      category: "母婴用品",
      claims: "儿童使用、电动震动、USB充电、防水、软毛、适合3-8岁",
      description: "儿童电动牙刷，面向3-8岁儿童，带电池/USB充电和震动刷头。",
    })));
    const { status, body: json } = await readJson(response);

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(["red", "yellow"]).toContain(json.data.overallLevel);
    expect(json.data.overallLevel).not.toBe("green");
    expect(json.data.beginnerFriendly).toBe(false);
    expect(json.data.errorFallback).toBe(true);
    expect(JSON.stringify(json)).not.toContain("secret-like detail");
  });

  it("普通商品 AI provider 失败时不返回 green 或 recommend", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: false,
      error: { code: "timeout", message: "timeout" },
    });

    const response = await POST(createRequest(body()));
    const { status, body: json } = await readJson(response);

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.data.overallLevel).toBe("yellow");
    expect(json.data.beginnerFriendly).toBe(false);
    expect(json.data.errorFallback).toBe(true);
  });

  it("宠物食品接触类商品至少 yellow，不能 green", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        overallLevel: "green",
        summary: "宠物慢食碗风险低。",
        risks: [
          { category: "品类风险", level: "green", title: "低风险", description: "普通宠物用品。", suggestion: "可做。" },
          { category: "售后风险", level: "green", title: "低风险", description: "售后少。", suggestion: "可做。" },
          { category: "平台规则风险", level: "green", title: "低风险", description: "规则简单。", suggestion: "可做。" },
        ],
        blacklistMatches: [],
        beginnerFriendly: true,
      },
    });

    const response = await POST(createRequest(body({
      productName: "宠物慢食碗",
      category: "宠物用品",
      claims: "慢食、防滑、可清洗",
      description: "pet slow feeder dog bowl，宠物进食接触，硅胶宠物碗，猫狗长期舔咬。",
    })));
    const { body: json } = await readJson(response);

    expect(json.data.overallLevel).toBe("yellow");
    expect(json.data.beginnerFriendly).toBe(false);
    expect(json.data.risks.some((item: any) => item.category.includes("材质") || item.description.includes("食品接触"))).toBe(true);
  });

  it("非入口宠物配件不被误伤为 red", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        overallLevel: "green",
        summary: "宠物梳子风险较低。",
        risks: [
          { category: "品类风险", level: "green", title: "普通配件", description: "非入口接触。", suggestion: "人工复核外观专利。" },
          { category: "售后风险", level: "green", title: "售后简单", description: "结构简单。", suggestion: "检查质量。" },
          { category: "平台规则风险", level: "green", title: "规则常规", description: "普通宠物用品。", suggestion: "复核平台规则。" },
        ],
        blacklistMatches: [],
        beginnerFriendly: true,
      },
    });

    const response = await POST(createRequest(body({
      productName: "宠物去浮毛梳",
      category: "宠物用品",
      description: "不锈钢针梳，适合猫狗日常梳毛，不接触食物。",
    })));
    const { body: json } = await readJson(response);

    expect(json.data.overallLevel).not.toBe("red");
  });

  it("risk 输出会净化中文认证承诺，但保留复核提醒", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        overallLevel: "yellow",
        summary: "产品已通过 FCC 认证，符合 CE 标准，100% 安全。",
        risks: [
          { category: "平台规则风险", level: "yellow", title: "认证齐全", description: "FDA 认证，已认证。", suggestion: "直接写入 listing。" },
          { category: "儿童安全", level: "yellow", title: "CPC 认证", description: "通过 CPC/ASTM/CPSIA 认证。", suggestion: "儿童安全认证齐全。" },
          { category: "材质", level: "yellow", title: "食品级保证", description: "无毒保证。", suggestion: "绝对安全。" },
        ],
        blacklistMatches: [],
        beginnerFriendly: false,
      },
    });

    const response = await POST(createRequest(body({
      productName: "儿童电动牙刷",
      category: "母婴用品",
      claims: "儿童用品，带电池。",
      description: "儿童电动牙刷。",
    })));
    const { body: json } = await readJson(response);
    const text = JSON.stringify(json);

    expect(json.ok).toBe(true);
    expect(text).not.toMatch(/FCC\s*认证|CE\s*标准|FDA\s*认证|CPC\s*认证|CPC\/ASTM\/CPSIA\s*认证|已认证|认证齐全|100%\s*安全|绝对安全|无毒保证|食品级保证|儿童安全认证/);
    expect(text).toMatch(/人工复核|索取|合规文件|测试报告|未验证前/);
  });
});
