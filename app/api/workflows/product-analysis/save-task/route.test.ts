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
      listingPrepSnapshot: { titleStructure: { recommendedTitle: "Test Title" }, keywordPool: { coreWords: ["test"] } },
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
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toEqual(["test"]);
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

  it("saves decisionEvidence and humanDecision for V2 decision review", async () => {
    const response = await POST(createRequest({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: {
        ...workflowResult(),
        productName: "Heated Gloves",
        risk: { summary: "Battery certification needs manual review.", overallLevel: "yellow" },
        summary: { decisionReason: "Winter outdoor use may have demand." },
        listing: { title: "Rechargeable Heated Gloves", keywords: ["heated gloves"] },
      },
      reviewState: { sourcingReviewed: true, riskReviewed: false, summaryReviewed: true, listingReviewed: false },
      decisionStatus: "need_info",
      humanDecision: {
        status: "need_info",
        reason: "Need supplier certification and logistics quote.",
        nextAction: "Ask supplier for certificate and shipping cost.",
        decidedAt: "2026-07-04T09:00:00.000Z",
        confirmedItems: ["source reviewed"],
        unconfirmedItems: ["risk reviewed"],
      },
      sourceMeta: {
        source: "opportunity",
        sourceTitle: "Candidate page",
        sourceUrl: "https://example.com/item?token=secret-token",
        importedAt: "2026-07-04T08:00:00.000Z",
      },
      profitSnapshot: {
        purchaseCost: 20,
        salePrice: 49,
        platformFeeRate: 0.15,
        platformFeeAmount: 7.35,
        estimatedProfit: 21.65,
        estimatedMarginRate: 0.44,
      },
      riskReviewSnapshot: {
        version: "risk_auto_mvp_v1",
        source: "rule_based_risk_precheck_mvp",
        mode: "ai_rule_precheck_with_manual_review",
        overallPrecheckLevel: "medium",
        summary: "Battery certification should be checked.",
        items: [{ key: "trademark", status: "needs_check", precheckLevel: "medium", precheckReason: "Missing trademark check" }],
      },
    }));

    const { status, body } = await readJson(response);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const createArg = mockPrisma.viralAnalysisRecord.create.mock.calls.at(-1)?.[0];
    expect(createArg?.data?.decisionStatus).toBe("need_info");
    const result = savedResultJson();
    expect(result.decisionEvidence.version).toBe("decision-evidence-v1");
    expect(result.humanDecision.status).toBe("need_info");
    expect(result.humanDecision.reason).toContain("supplier certification");
    expect(result.decisionEvidence.items.some((item: any) => item.kind === "ai_inference")).toBe(true);
    expect(result.decisionEvidence.items.some((item: any) => item.kind === "calculation")).toBe(true);
    expect(result.decisionEvidence.items.some((item: any) => item.kind === "rule")).toBe(true);
    expect(result.decisionEvidence.missingData.some((item: any) => item.field === "profitSnapshot.logisticsCost")).toBe(true);
    expect(JSON.stringify(result.decisionEvidence)).not.toContain("secret-token");
  });
});

// ── Listing-Persistence-Fix.1: fallback snapshot generation ──

async function postSaveTask(payload: Record<string, unknown>) {
  const request = new Request("http://localhost/api/workflows/product-analysis/save-task", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-password": CORRECT_PASSWORD },
    body: JSON.stringify(payload),
  });
  const { POST: handler } = await import("@/app/api/workflows/product-analysis/save-task/route");
  return handler(request);
}

function listingBaseWorkflowResult(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    workflowId: "wf-listing-test",
    productName: "Test Product",
    status: "completed",
    finalReport: { finalVerdict: "OK", riskLevel: "green", beginnerFit: "适合新手", nextSteps: [] },
    steps: [],
    costGuard: { aiStepsRequested: 4, aiStepsCompleted: 4, fallbackSteps: 0 },
    ...overrides,
  };
}

describe("Listing-Persistence-Fix.1 — fallback snapshot", () => {
  it("auto-generates listingPrepSnapshot when missing but listing data exists", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Test Listing Title", keywords: ["kw1", "kw2"], complianceNotes: ["note"] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);

    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Test Listing Title");
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toEqual(["kw1", "kw2"]);
  });

  it("does NOT override explicitly passed listingPrepSnapshot", async () => {
    const explicitSnapshot = {
      keywordPool: { coreWords: ["explicit-kw"] },
      titleStructure: { recommendedTitle: "Explicit Title" },
      bulletDrafts: [],
      searchTerms: { draft: "" },
      imageMaterialNeeds: [],
      complianceExpressionReminders: [],
      manualSupplementChecklist: [],
    };

    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Workflow Title", keywords: ["wk"] },
      }),
      listingPrepSnapshot: explicitSnapshot,
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);

    const result = savedResultJson();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Explicit Title");
  });

  it("saves safely when no listing data exists at all", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult(),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);

    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeUndefined();
  });

  it("does NOT generate snapshot when listing object is empty", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "", keywords: [] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);

    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeUndefined();
  });

  it("works with only keywords (no title)", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "", keywords: ["only-kw"] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    // Has keywords, so should generate snapshot (title falls back to productName)
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toContain("only-kw");
  });

  // ── Predeploy guard: nullish + invalid input handling ──

  it("falls back when listingPrepSnapshot is explicitly null", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "From Null Fallback", keywords: ["nk"] },
      }),
      listingPrepSnapshot: null,
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("From Null Fallback");
  });

  it("falls back when listingPrepSnapshot is completely omitted", async () => {
    // Do not include listingPrepSnapshot key at all
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Omitted Key", keywords: ["ok"] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
  });

  it("does not crash when listing.title is a number", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: 12345, keywords: ["valid-kw"] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("does not crash when listing.keywords is a string instead of array", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Test", keywords: "not-an-array" },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("does not crash when listing.keywords is an object", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Test", keywords: { a: 1 } },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  // ── Validation Guard: junk snapshot objects must not block fallback ──

  it("empty object {} listingPrepSnapshot triggers fallback to workflow listing", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Fallback Title", keywords: ["fb"] },
      }),
      listingPrepSnapshot: {},
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    // {} is NOT structurally valid → fallback triggers
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Fallback Title");
  });

  it("random-field snapshot triggers fallback to workflow listing", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Random Fallback", keywords: ["rf"] },
      }),
      listingPrepSnapshot: { randomField: "x" },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    // { randomField: "x" } is NOT structurally valid → fallback triggers
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Random Fallback");
  });

  it("junk snapshot with no workflow listing saves nothing", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult(),
      listingPrepSnapshot: { randomField: "x" },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeUndefined();
  });

  it("structurally valid explicit snapshot is preserved (not overridden)", async () => {
    const validSnapshot = {
      titleStructure: { recommendedTitle: "Explicit", formula: "", breakdown: [] },
      keywordPool: { coreWords: [], longTailWords: [] },
      bulletDrafts: [],
      searchTerms: { draft: "" },
      imageMaterialNeeds: [],
      complianceExpressionReminders: [],
      manualSupplementChecklist: [],
    };
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Should NOT Appear", keywords: ["no"] },
      }),
      listingPrepSnapshot: validSnapshot,
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    // Valid explicit snapshot preserved — NOT overridden by workflow listing
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Explicit");
  });

  // ── Meaningful Content Guard: empty nested objects must not block fallback ──

  it("{ titleStructure: {} } triggers fallback to workflow listing", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Fallback TS", keywords: ["fts"] },
      }),
      listingPrepSnapshot: { titleStructure: {} },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Fallback TS");
  });

  it("{ keywordPool: {} } triggers fallback to workflow listing", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Fallback KP", keywords: ["fkp"] },
      }),
      listingPrepSnapshot: { keywordPool: {} },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toContain("fkp");
  });

  it("blank-only recommendedTitle with empty keywords triggers fallback", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Real Title", keywords: ["rt"] },
      }),
      listingPrepSnapshot: {
        titleStructure: { recommendedTitle: "   " },
        keywordPool: { coreWords: [], longTailWords: [] },
      },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeTruthy();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Real Title");
  });

  it("meaningless snapshot + no workflow listing → nothing saved", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult(),
      listingPrepSnapshot: { titleStructure: { recommendedTitle: "" }, keywordPool: { coreWords: [""], longTailWords: [] } },
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot).toBeUndefined();
  });

  it("only non-empty recommendedTitle → valid snapshot, preserved", async () => {
    const snapshot = {
      titleStructure: { recommendedTitle: "Only Title", formula: "", breakdown: [] },
      keywordPool: { coreWords: [], longTailWords: [] },
      bulletDrafts: [],
      searchTerms: { draft: "" },
      imageMaterialNeeds: [],
      complianceExpressionReminders: [],
      manualSupplementChecklist: [],
    };
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "Should Not Win", keywords: ["no"] },
      }),
      listingPrepSnapshot: snapshot,
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot.titleStructure.recommendedTitle).toBe("Only Title");
  });

  it("only valid keywords → valid snapshot, preserved", async () => {
    const snapshot = {
      titleStructure: { recommendedTitle: "", formula: "", breakdown: [] },
      keywordPool: { coreWords: ["valid-kw"], longTailWords: [] },
      bulletDrafts: [],
      searchTerms: { draft: "" },
      imageMaterialNeeds: [],
      complianceExpressionReminders: [],
      manualSupplementChecklist: [],
    };
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { keywords: ["should-not-appear"] },
      }),
      listingPrepSnapshot: snapshot,
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    expect(result.listingPrepSnapshot.keywordPool.coreWords).toContain("valid-kw");
  });

  it("complianceNotes-only with empty title and keywords does NOT generate snapshot", async () => {
    const res = await postSaveTask({
      accessPassword: CORRECT_PASSWORD,
      workflowResult: listingBaseWorkflowResult({
        listing: { title: "", keywords: [], complianceNotes: ["some note"] },
      }),
      reviewState: {},
      decisionStatus: "continue",
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    const result = savedResultJson();
    // Only title and keywords are checked for content; complianceNotes alone is not enough
    expect(result.listingPrepSnapshot).toBeUndefined();
  });
});
