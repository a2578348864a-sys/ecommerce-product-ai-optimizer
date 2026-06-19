import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCallAiJson = vi.fn();

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mockCallAiJson,
  getSafeAiClientErrorMessage: vi.fn((code: string) => `safe:${code}`),
}));

let POST: any;

function createRequest(body: unknown) {
  return {
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => JSON.stringify(body),
  };
}

async function readJson(response: Response) {
  const cloned = response.clone();
  return { status: cloned.status, body: await cloned.json() };
}

function requestBody(product: Record<string, unknown>) {
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
  const mod = await import("./route");
  POST = mod.POST;
});

describe("POST /api/products/ai-analysis", () => {
  it("宠物食品接触类不应直接 recommend", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        recommendation: "recommend",
        score: 88,
        reasons: ["需求稳定"],
        risks: ["风险低"],
        targetAudience: ["宠物主"],
        scenarios: ["宠物喂食"],
        platformFit: "适合",
        logisticsRisk: "低",
        afterSalesRisk: "低",
        infringementRisk: "低",
        sensitiveCategoryRisk: "低",
        newbieFriendly: true,
      },
    });

    const response = await POST(createRequest(requestBody({
      name: "宠物慢食碗",
      description: "pet slow feeder dog bowl，宠物进食接触，硅胶宠物碗。",
    })));
    const { body } = await readJson(response);

    expect(body.ok).toBe(true);
    expect(body.data.recommendation).toBe("caution");
    expect(body.data.newbieFriendly).toBe(false);
    expect(body.data.risks.join(" ")).toMatch(/食品接触|材质|清洁|售后/);
  });

  it("非入口宠物配件不要误伤为 reject", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        recommendation: "recommend",
        score: 80,
        reasons: ["结构简单"],
        risks: ["需复核外观专利"],
        targetAudience: ["宠物主"],
        scenarios: ["梳毛"],
        platformFit: "适合",
        logisticsRisk: "低",
        afterSalesRisk: "低",
        infringementRisk: "需复核",
        sensitiveCategoryRisk: "低",
        newbieFriendly: true,
      },
    });

    const response = await POST(createRequest(requestBody({
      name: "宠物去浮毛梳",
      description: "猫狗日常梳毛工具，不接触食物。",
    })));
    const { body } = await readJson(response);

    expect(body.data.recommendation).not.toBe("reject");
  });

  it("AI 选品分析输出会净化中文认证承诺，但保留复核提醒", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        recommendation: "caution",
        score: 66,
        reasons: ["FCC 认证齐全，FDA 认证，可作为卖点。"],
        risks: ["符合 CPC/ASTM/CPSIA 标准，100% 安全。"],
        targetAudience: ["儿童家庭"],
        scenarios: ["儿童刷牙"],
        platformFit: "已认证，适合直接上架。",
        logisticsRisk: "绝对安全。",
        afterSalesRisk: "无毒保证。",
        infringementRisk: "低",
        sensitiveCategoryRisk: "食品级保证。",
        newbieFriendly: false,
      },
    });

    const response = await POST(createRequest(requestBody({
      name: "儿童电动牙刷",
      description: "儿童用品，带电池，口腔接触。",
    })));
    const { body } = await readJson(response);
    const text = JSON.stringify(body);

    expect(body.ok).toBe(true);
    expect(text).not.toMatch(/FDA\s*认证|FCC\s*认证|CPC\/ASTM\/CPSIA\s*标准|已认证|100%\s*安全|绝对安全|无毒保证|食品级保证/);
    expect(text).toMatch(/人工复核|索取|合规文件|测试报告|未验证前/);
  });
});
