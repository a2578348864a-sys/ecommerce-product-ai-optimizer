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
});
