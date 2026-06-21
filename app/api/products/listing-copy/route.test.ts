import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  const mod = await import("./route");
  POST = mod.POST;
});

describe("POST /api/products/listing-copy", () => {
  it("listing copy 不输出无依据认证承诺，但保留人工复核提醒", async () => {
    mockCallAiJson.mockResolvedValueOnce({
      ok: true,
      data: {
        title: "FDA approved CE certified kids toothbrush FDA 认证",
        bulletPoints: ["CPC certified and 100% safe", "RoHS certified battery", "儿童安全认证，FCC认证齐全"],
        description: "This product is CPSIA compliant and non-toxic guaranteed. 通过 CPC 认证，符合 ASTM 标准。",
        shortDescription: "Food grade guaranteed. 食品级保证。",
        keywords: ["kids toothbrush"],
        longTailKeywords: ["safe kids toothbrush"],
        faq: [{ question: "Is it certified?", answer: "Yes, ASTM certified. 已认证。" }],
        packingList: ["CE marked toothbrush", "CPSIA认证文件"],
        afterSales: "Risk-free service.",
        notes: ["Manual review reminder"],
      },
    });

    const response = await POST(createRequest({
      product: {
        name: "儿童电动牙刷",
        description: "儿童用品，带电池，口腔接触。",
        targetPlatform: "amazon",
      },
    }));
    const { body } = await readJson(response);
    const text = JSON.stringify(body);

    expect(body.ok).toBe(true);
    expect(text).not.toMatch(/FDA approved|CE certified|CPC certified|RoHS certified|CPSIA compliant|ASTM certified|100% safe|non-toxic guaranteed|Food grade guaranteed|Risk-free/i);
    expect(text).not.toMatch(/FDA\s*认证|FCC\s*认证|CPC\s*认证|ASTM\s*标准|CPSIA\s*认证|已认证|食品级保证|儿童安全认证/);
    expect(text).toMatch(/supplier verification|Manual review|人工复核|索取|未验证前/i);
  });
});
