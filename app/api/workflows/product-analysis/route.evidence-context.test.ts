import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runSourcingStep: vi.fn(),
  runRiskStep: vi.fn(),
  runSummaryStep: vi.fn(),
  runListingStep: vi.fn(),
  getSandboxCandidate: vi.fn(),
  getSandboxTask: vi.fn(),
  findUniqueViral: vi.fn(),
}));

vi.mock("@/lib/server/accessPassword", () => ({
  validateAccessPassword: () => true,
  resolveAccessContext: () => ({
    mode: "owner",
    demoAccessId: "",
  }),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({
    ok: true,
    context: { mode: "owner", demoAccessId: "" },
  }),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: (id: string) => id.startsWith("sandbox_candidate_"),
  getSandboxCandidate: mocks.getSandboxCandidate,
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_task_"),
  getSandboxTask: mocks.getSandboxTask,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: mocks.findUniqueViral,
    },
    opportunityCandidate: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/workflows/productAnalysis", () => ({
  PRODUCT_ANALYSIS_AI_TIMEOUT_MS: 45_000,
  runSourcingStep: mocks.runSourcingStep,
  runRiskStep: mocks.runRiskStep,
  runSummaryStep: mocks.runSummaryStep,
  runListingStep: mocks.runListingStep,
}));

import { POST } from "./route";

function createRequest(body: Record<string, unknown>) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis"),
    headers: new Headers(),
    json: async () => ({
      jobRequestId: "11111111-1111-4111-8111-111111111111",
      ...body,
    }),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/workflows/product-analysis with EvidenceContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runSourcingStep.mockResolvedValue({
      status: "completed",
      warnings: [],
      providerCallStarted: true,
      data: {
        feasibility: "high",
        summary: "货源可行性高",
        searchKeywords: ["保温水壶"],
        moqEstimate: "50个",
        beginnerFriendly: true,
        beginnerFit: "high",
        complianceBarrier: "low",
        logisticsDifficulty: "low",
        afterSalesRisk: "low",
        suggestedEntryLevel: "beginner",
        nextSteps: ["联系供应商"],
      },
    });
    mocks.runRiskStep.mockResolvedValue({
      status: "completed",
      warnings: [],
      providerCallStarted: true,
      data: {
        overallLevel: "green",
        summary: "风险可控",
        blacklistMatches: [],
        beginnerFriendly: true,
        complianceWarnings: [],
      },
    });
    mocks.runSummaryStep.mockResolvedValue({
      status: "completed",
      warnings: [],
      providerCallStarted: true,
      data: {
        verdict: "推荐推进",
        confidence: "high",
        summary: "综合指标良好",
        reasons: ["需求稳定"],
        risks: [],
        nextSteps: [],
        beginnerTip: "注意首单数量",
        downgraded: false,
        downgradeReasons: [],
        parseFailed: false,
      },
    });
    mocks.runListingStep.mockResolvedValue({
      status: "completed",
      warnings: [],
      providerCallStarted: true,
      data: {
        title: "Stainless Steel Water Bottle",
        keywords: ["water bottle"],
        complianceNotes: [],
      },
    });
  });

  it("当提供完整 Evidence 的 resultJson 时，真实注入 EvidenceContext 并成功返回", async () => {
    const fullEvidenceResultJson = {
      browserEvidence: {
        schema: "browser-evidence.v1",
        targetAsin: "B0TEST1234",
        snapshots: [
          {
            capturedAt: "2026-09-18T00:00:00.000Z",
            currency: "USD",
            entityBinding: {
              bound: true,
              urlAsin: "B0TEST1234",
              pageAsin: "B0TEST1234",
            },
            fields: {
              price: { value: 24.99, status: "correct" },
              rating: { value: 4.8, status: "correct" },
              reviewCount: { value: 3400, status: "correct" },
              bsr: { value: 85, status: "correct" },
              title: { value: "Insulated Food Flask", status: "correct" },
            },
          },
        ],
      },
      vocAnalysis: {
        schema: "voc-analysis.v1",
        themes: {
          painPointThemes: [
            {
              themeId: "p1",
              label: "盖子难以单手旋开",
              summary: "儿童使用者反馈盖子摩擦力过大",
              reviewCount: 28,
              strength: "recurring",
              evidenceRefs: ["rev-01"],
            },
          ],
        },
      },
      sourcingEvidence: {
        schema: "sourcing-evidence.v1",
        humanConfirmed: [
          {
            offerId: "777888999",
            title: "儿童双层不锈钢保温罐源头工厂",
            displayedPrice: "¥16.50",
            displayedMoq: "100个",
          },
        ],
      },
      riskReviewSnapshot: {
        items: [
          {
            key: "cpc_cert",
            label: "儿童产品合规认证(CPC)",
            precheckLevel: "high",
            precheckReason: "需提供 CPC 证书及第三方实验室检测报告",
          },
        ],
      },
    };

    const req = createRequest({
      productName: "儿童不锈钢保温罐",
      source: "manual",
      resultJson: fullEvidenceResultJson,
      options: { runSourcing: true, runRisk: true, runSummary: true, runListing: false },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.evidenceContext).toBeDefined();
    expect(data.evidenceContext.availableSources).toEqual({
      amazon: true,
      voc: true,
      sourcing: true,
      risk: true,
    });

    // 验证 Step 传入的 prompt 包含证据内容
    expect(mocks.runSourcingStep).toHaveBeenCalled();
    const sourcingCallArgs = mocks.runSourcingStep.mock.calls[0];
    const promptDescription = sourcingCallArgs[1];
    expect(promptDescription).toContain("<UNTRUSTED_EVIDENCE_CONTEXT>");
    expect(promptDescription).toContain("Amazon 详情页观察售价: USD $24.99");
    expect(promptDescription).toContain("盖子难以单手旋开");
    expect(promptDescription).toContain("1688 货源 [ID:777888999]: 报价 ¥16.50，起订量 100个");
    expect(promptDescription).toContain("[HIGH 风险] 儿童产品合规认证(CPC)");
  });

  it("当无 Evidence 时，正常运行且报告全部证据缺口（保持 100% 向后兼容）", async () => {
    const req = createRequest({
      productName: "普通陶瓷马克杯",
      source: "manual",
      options: { runSourcing: true, runRisk: false, runSummary: false, runListing: false },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.evidenceContext.availableSources).toEqual({
      amazon: false,
      voc: false,
      sourcing: false,
      risk: false,
    });
    expect(data.evidenceContext.gaps.length).toBe(4);

    // Prompt 中明确告知缺口，防止 AI 幻觉
    const sourcingCallArgs = mocks.runSourcingStep.mock.calls[0];
    const promptDescription = sourcingCallArgs[1];
    expect(promptDescription).toContain("【已确认证据缺口（严禁脑补，分析时必须声明不确定性）】");
    expect(promptDescription).toContain("缺少 Amazon 详情页真实采集证据");
    expect(promptDescription).toContain("缺少买家真实评论（VOC）样本");
  });

  it("当通过 taskId 关联且实体绑定失败时，严格 Fail-closed 拦截 Amazon 证据", async () => {
    mocks.findUniqueViral.mockResolvedValue({
      id: "task-test-01",
      type: "viral",
      updatedAt: new Date(),
      decisionStatus: "pending",
      resultJson: JSON.stringify({
        browserEvidence: {
          schema: "browser-evidence.v1",
          targetAsin: "B0REAL0001",
          snapshots: [
            {
              capturedAt: "2026-09-18T00:00:00.000Z",
              entityBinding: { bound: false, pageAsin: null },
              fields: { price: { value: 99.0, status: "correct" } },
            },
          ],
        },
      }),
    });

    const req = createRequest({
      productName: "测试商品",
      source: "manual",
      taskId: "task-test-01",
      options: { runSourcing: true, runRisk: false, runSummary: false, runListing: false },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.evidenceContext.availableSources.amazon).toBe(false);
    expect(data.evidenceContext.marketSignals).toEqual([]);
    expect(data.evidenceContext.gaps.some((g: string) => g.includes("Amazon"))).toBe(true);
  });
});
