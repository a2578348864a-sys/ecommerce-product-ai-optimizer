import { beforeEach, describe, expect, it, vi } from "vitest";

const CORRECT_PASSWORD = "ci-test-password";

const mockPrisma = {
  viralAnalysisRecord: {
    create: vi.fn().mockResolvedValue({
      id: "task-risk-review-001",
      title: "桌面手机支架 一键分析",
    }),
  },
};

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

let POST: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  mockPrisma.viralAnalysisRecord.create.mockResolvedValue({
    id: "task-risk-review-001",
    title: "桌面手机支架 一键分析",
  });
  const mod = await import("./route");
  POST = mod.POST;
});

function createRequest(body: unknown) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis/save-task",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis/save-task"),
    headers: new Headers(),
    json: async () => body,
  };
}

function workflowResult() {
  return {
    ok: true,
    workflowId: "wf-risk-review-001",
    productName: "桌面手机支架",
    status: "completed",
    steps: [],
    costGuard: {},
    finalReport: {
      finalVerdict: "建议小单测试",
      riskLevel: "yellow",
      beginnerFit: "适合新手",
      canTestSmallBatch: true,
      mustCheckBeforeListing: ["复核侵权风险"],
      nextSteps: ["索要供应商文件"],
      manualReviewChecklist: ["人工复核"],
    },
  };
}

async function readJson(response: Response) {
  const cloned = response.clone();
  return { status: cloned.status, body: await cloned.json() };
}

function savedResultJson() {
  const createArg = mockPrisma.viralAnalysisRecord.create.mock.calls.at(-1)?.[0];
  const raw = createArg?.data?.resultJson;
  expect(typeof raw).toBe("string");
  return JSON.parse(raw);
}

describe("POST /api/workflows/product-analysis/save-task", () => {
  it("saves riskReviewSnapshot and profitSnapshot together", async () => {
    const response = await POST(createRequest({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: workflowResult(),
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true },
      profitSnapshot: {
        purchaseCost: 15,
        salePrice: 25,
        platformFeeRate: 0.15,
        platformFeeAmount: 3.75,
        estimatedProfit: 6.25,
        estimatedMarginRate: 0.25,
        decision: "testable",
        note: "粗略估算，非真实市场价，需人工复核",
      },
      riskReviewSnapshot: {
        items: [
          { key: "brand_ip", status: "cleared", note: "未使用品牌词" },
          { key: "trademark", status: "needs_check" },
          { key: "patent_design", status: "high_risk" },
        ],
        note: "外观相似度需要继续查证",
      },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const result = savedResultJson();

    expect(result.profitSnapshot.estimatedProfit).toBe(6.25);
    expect(result.riskReviewSnapshot.version).toBe("risk_review_mvp_v1");
    expect(result.riskReviewSnapshot.source).toBe("manual_risk_review_mvp");
    expect(result.riskReviewSnapshot.overallStatus).toBe("high_risk");
    expect(result.riskReviewSnapshot.items.find((item: any) => item.key === "brand_ip").note).toBe("未使用品牌词");
    expect(JSON.stringify(result.riskReviewSnapshot)).not.toContain("安全可卖");
  });

  it("keeps old payload compatible when riskReviewSnapshot is missing", async () => {
    const response = await POST(createRequest({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: workflowResult(),
      reviewState: { sourcingReviewed: false, riskReviewed: false, summaryReviewed: false, listingReviewed: false },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.riskReviewSnapshot).toBeUndefined();
    expect(result.profitSnapshot).toBeUndefined();
    expect(result.finalReport.finalVerdict).toBe("建议小单测试");
  });
});
