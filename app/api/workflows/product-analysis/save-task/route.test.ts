import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSignedToken } from "@/lib/server/signedToken";

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

function createRequest(body: unknown, headers?: Record<string, string>) {
  return {
    method: "POST",
    url: "http://localhost:3000/api/workflows/product-analysis/save-task",
    nextUrl: new URL("http://localhost:3000/api/workflows/product-analysis/save-task"),
    headers: new Headers(headers),
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
  it("accepts the current signed auth token from headers without body accessPassword", async () => {
    const token = generateSignedToken("owner");
    const response = await POST(createRequest({
      workflowResult: workflowResult(),
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true },
    }, { "x-access-token": token }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.viralAnalysisRecord.create).toHaveBeenCalledTimes(1);
  });

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
        version: "risk_auto_mvp_v1",
        source: "rule_based_risk_precheck_mvp",
        mode: "ai_rule_precheck_with_manual_review",
        overallPrecheckLevel: "high",
        summary: "系统自动圈出外观结构风险，需人工最终确认。",
        recommendedActions: ["对比同类爆款外观结构", "向供应商索要检测报告"],
        items: [
          { key: "brand_ip", status: "cleared", precheckLevel: "not_triggered", note: "未使用品牌词" },
          { key: "trademark", status: "needs_check", precheckLevel: "medium" },
          { key: "patent_design", status: "high_risk", precheckLevel: "high", precheckReason: "外观结构需查证" },
        ],
        note: "外观相似度需要继续查证",
      },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const result = savedResultJson();

    expect(result.profitSnapshot.estimatedProfit).toBe(6.25);
    expect(result.riskReviewSnapshot.version).toBe("risk_auto_mvp_v1");
    expect(result.riskReviewSnapshot.source).toBe("rule_based_risk_precheck_mvp");
    expect(result.riskReviewSnapshot.mode).toBe("ai_rule_precheck_with_manual_review");
    expect(result.riskReviewSnapshot.overallPrecheckLevel).toBe("high");
    expect(result.riskReviewSnapshot.overallStatus).toBe("high_risk");
    expect(result.riskReviewSnapshot.items.find((item: any) => item.key === "brand_ip").note).toBe("未使用品牌词");
    expect(JSON.stringify(result.riskReviewSnapshot)).not.toContain("安全可卖");
    expect(JSON.stringify(result.riskReviewSnapshot)).not.toContain("已通过合规");
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

  it("keeps candidate pool source metadata for agent run saves", async () => {
    const response = await POST(createRequest({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: workflowResult(),
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true },
      source: "agent_run",
      sourceMeta: {
        source: "opportunity",
        from: "opportunity",
        entry: "candidate_to_agent_m1",
        opportunityTitle: "桌面手机支架",
        opportunitySource: "机会雷达候选品",
        opportunityScore: 86.4,
        keyword: "phone stand",
        sourceUrl: "https://example.com/item",
        candidateId: "test-candidate",
        sourceTitle: "test-title",
        originalName: "原始候选：phone stand",
        analyzedName: "桌面手机支架",
        evidenceSnapshot: {
          version: 1,
          sourceType: "web",
          sourceName: "source importer",
          sourceUrl: "https://example.com/item?token=secret-token",
          evidenceItems: ["product_page", "price_seen"],
          extractionSignals: ["url_path_product"],
          qualityScore: 86,
          confidence: "high",
          riskFlags: [],
          decision: "recommended",
          decisionReason: "Specific product page with usable source evidence.",
          nextAction: "Continue to agent run after manual confirmation.",
          generatedAt: "2026-06-30T10:00:00.000Z",
          cookie: "session=abc",
        },
        importedAt: "2026-06-26T10:00:00.000Z",
      },
      agentRunSnapshot: { source: "agent_run", steps: [] },
      listingPrepSnapshot: { keywordPool: { coreWords: [] } },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const createArg = mockPrisma.viralAnalysisRecord.create.mock.calls.at(-1)?.[0];
    expect(createArg?.data?.source).toBe("agent_run");
    const result = savedResultJson();
    expect(result.sourceMeta).toMatchObject({
      source: "opportunity",
      from: "opportunity",
      entry: "candidate_to_agent_m1",
      opportunityTitle: "桌面手机支架",
      opportunitySource: "机会雷达候选品",
      opportunityScore: 86,
      keyword: "phone stand",
      sourceUrl: "https://example.com/item",
      candidateId: "test-candidate",
      sourceTitle: "test-title",
      evidenceSnapshot: {
        qualityScore: 86,
        decision: "recommended",
        confidence: "high",
      },
      originalName: "原始候选：phone stand",
      analyzedName: "桌面手机支架",
    });
    expect(JSON.stringify(result.sourceMeta)).not.toContain("secret-token");
    expect(JSON.stringify(result.sourceMeta)).not.toContain("session=abc");
    expect(result.agentRunSnapshot.source).toBe("agent_run");
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toEqual([]);
  });

  it("saves normalized agentOutputSnapshot while preserving B1 evidence", async () => {
    const response = await POST(createRequest({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: {
        ...workflowResult(),
        sourcing: { conclusion: "可从阿里国际站找同类供应商", sourceSignals: ["多供应商"] },
        risk: { overallLevel: "yellow", riskFlags: ["ip_check"], summary: "中风险" },
        summary: { decision: "recommended", sellingPoints: ["可折叠"], concerns: ["同质化"] },
        listing: { title: "Adjustable Phone Stand", bullets: ["Foldable"], keywords: ["phone stand"] },
      },
      reviewState: { sourcingReviewed: true, riskReviewed: true, summaryReviewed: true, listingReviewed: true },
      sourceMeta: {
        source: "opportunity",
        opportunityTitle: "桌面手机支架",
        evidenceSnapshot: {
          version: 1,
          sourceType: "web",
          sourceName: "source importer",
          sourceUrl: "https://example.com/item?token=secret-token",
          evidenceItems: ["product_page"],
          extractionSignals: ["url_path_product"],
          qualityScore: 86,
          confidence: "high",
          riskFlags: ["ip_check"],
          decision: "recommended",
          decisionReason: "Specific product page.",
          nextAction: "Continue to agent run after manual confirmation.",
          generatedAt: "2026-06-30T10:00:00.000Z",
        },
      },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const result = savedResultJson();

    expect(result.agentOutputSnapshot.version).toBe("agent-output-v1");
    expect(result.agentOutputSnapshot.sourcingSnapshot.supplierConclusion).toContain("阿里国际站");
    expect(result.agentOutputSnapshot.riskSnapshot.riskLevel).toBe("medium");
    expect(result.agentOutputSnapshot.summarySnapshot.decision).toBe("recommended");
    expect(result.agentOutputSnapshot.listingSnapshot.titleDraft).toBe("Adjustable Phone Stand");
    expect(result.agentOutputSnapshot.candidateEvidence.qualityScore).toBe(86);
    expect(JSON.stringify(result.agentOutputSnapshot)).not.toContain("secret-token");
    expect(result.sourceMeta.evidenceSnapshot.qualityScore).toBe(86);
  });
});
