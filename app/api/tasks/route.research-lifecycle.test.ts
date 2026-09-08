import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  buildProductResearchHash,
  createInitialProductResearchRecord,
  createProductResearchVerification,
  type ProductResearchHashInput,
  type ProductResearchReviewState,
} from "@/lib/productResearchRecord";
import { getResearchLifecycleState } from "@/lib/server/researchLifecycleReader";

/**
 * Bridge V1：/api/tasks 列表 DTO 统一生命周期投影。
 *
 * - 每个返回的 task DTO 必须携带 researchLifecycle；
 * - 其值必须与 getResearchLifecycleState({ result, decisionStatus, type }) 完全一致
 *  （与 /research-lifecycle 及详情页同一 Reader，禁止 API 自带第二套 phase 算法）；
 * - SQL scope 语义不被修改（本文件只断言投影，不改 where）。
 */

const CORRECT_PASSWORD = "ci-test-password";

const mockPrisma = vi.hoisted(() => ({
  viralAnalysisRecord: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
  },
  opportunityCandidate: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  v4ResearchRun: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/lib/server/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/tasks/normalizeTaskRecord", () => ({
  normalizeTaskRecord: vi.fn((record: Record<string, unknown>) => ({
    id: record.id ?? "test-001",
    createdAt: (record.createdAt instanceof Date ? record.createdAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    updatedAt: (record.updatedAt instanceof Date ? record.updatedAt.toISOString() : "2025-01-01T00:00:00.000Z"),
    type: record.type ?? "viral",
    decisionStatus: record.decisionStatus ?? "pending",
    title: record.title ?? "测试",
    platform: record.platform ?? "manual",
    productUrl: record.productUrl ?? null,
    materialText: record.materialText ?? "",
    source: record.source ?? "ai",
    score: record.score ?? 0,
    level: record.level ?? "",
    oneLineSummary: record.oneLineSummary ?? "",
    result: typeof record.resultJson === "string" ? JSON.parse(record.resultJson) : {},
    agentType: record.type ?? "viral",
    status: "completed",
  })),
}));

let GET: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("ACCESS_PASSWORD", CORRECT_PASSWORD);
  vi.stubEnv("NODE_ENV", "test");
  vi.clearAllMocks();
  const mod = await import("./route");
  GET = mod.GET;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function createGetRequest(url = "http://localhost:3000/api/tasks"): NextRequest {
  return {
    url,
    method: "GET",
    headers: new Headers({ "x-access-password": CORRECT_PASSWORD }),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function row(id: string, result: unknown, decisionStatus = "pending", type = "workflow") {
  return {
    id,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    type,
    decisionStatus,
    title: `商品 ${id}`,
    platform: "manual",
    productUrl: null,
    materialText: "素材",
    source: "ai",
    score: 80,
    level: "高潜力",
    oneLineSummary: "摘要",
    resultJson: JSON.stringify(result),
  };
}

const reviewState: ProductResearchReviewState = {
  sourcingReviewed: false,
  riskReviewed: false,
  summaryReviewed: false,
  listingReviewed: false,
  reviewedCount: 0,
  totalReviewSteps: 0,
  allReviewed: true,
};

const hashInput: ProductResearchHashInput = {
  schema: "product-research-hash.v1",
  candidateId: "candidate-1",
  runId: "run-1",
  contextHash: "b".repeat(64),
  inputHash: "c".repeat(64),
  resultHash: "d".repeat(64),
  workflowStatus: "completed",
  reviewState,
};

function modernResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateToTask: { candidateId: "candidate-1" },
    candidateAnalysisContext: { candidate: { id: "candidate-1" } },
    ...overrides,
  };
}

function validResearchState(decisionStatus: "creative_ready" | "needs_information" | "abandoned" = "creative_ready") {
  const researchHash = buildProductResearchHash(hashInput);
  const verification = createProductResearchVerification(hashInput);
  const base = createInitialProductResearchRecord({
    candidateId: hashInput.candidateId,
    runId: hashInput.runId,
    contextHash: hashInput.contextHash,
    researchHash,
    workflowStatus: hashInput.workflowStatus,
    reviewState,
    decision: {
      decisionId: "11111111-1111-4111-8111-111111111111",
      status: "creative_ready",
      reason: "ready",
      nextAction: null,
    },
    actor: { mode: "owner", actorRef: "owner:v1" },
    now: "2026-09-08T00:00:00.000Z",
  });
  const record = decisionStatus === "creative_ready"
    ? base
    : {
      ...base,
      latestDecision: { ...base.latestDecision, status: decisionStatus },
      decisionEvents: [{ ...base.decisionEvents[0], status: decisionStatus }],
    };
  return { record, verification };
}

function completedResult() {
  const { record, verification } = validResearchState("creative_ready");
  return modernResult({
    researchRecord: record,
    researchVerification: verification,
    researchCompletion: {
      schema: "research-completion.v1",
      status: "completed",
      completedAt: "2026-09-08T00:00:00.000Z",
      decisionId: record.latestDecision.decisionId,
      revision: record.revision,
      finalStatus: "creative_ready",
    },
  });
}

async function getRecords(result: unknown, decisionStatus = "pending", type = "workflow") {
  const rows = [row("task-bridge-1", result, decisionStatus, type)];
  mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce(rows);
  mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(1);
  const response = await GET(createGetRequest());
  expect(response.status).toBe(200);
  const json = await response.json();
  expect(json.ok).toBe(true);
  return json.records[0] as Record<string, any>;
}

describe("/api/tasks researchLifecycle projection (Bridge V1)", () => {
  it("case 1: modern created → 尚未开始研究语义（phase=created）", async () => {
    const item = await getRecords(modernResult());
    expect(item.researchLifecycle).toBeDefined();
    expect(item.researchLifecycle.phase).toBe("created");
    expect(item.researchLifecycle.contractMode).toBe("modern");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result: modernResult(), decisionStatus: "pending", type: "workflow" }),
    );
  });

  it("case 2: pending fact preview → awaiting_confirmation", async () => {
    // 待确认事实由持久化证据派生（candidateAnalysisContext.facts.productFacts → extractFactCandidates）。
    const result = modernResult({
      candidateAnalysisContext: {
        candidate: { id: "candidate-1" },
        facts: { productFacts: { brand: "Acme" } },
      },
    });
    const item = await getRecords(result);
    expect(item.researchLifecycle.phase).toBe("awaiting_confirmation");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "pending", type: "workflow" }),
    );
  });

  it("case 3: needs_information → awaiting_decision", async () => {
    const { record, verification } = validResearchState("needs_information");
    const result = modernResult({ researchRecord: record, researchVerification: verification });
    const item = await getRecords(result, "need_info");
    expect(item.researchLifecycle.phase).toBe("awaiting_decision");
    expect(item.researchLifecycle.decisionStatus).toBe("needs_information");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "need_info", type: "workflow" }),
    );
  });

  it("case 4: creative_ready 未完成 → ready_to_complete（不得显示 completed）", async () => {
    const { record, verification } = validResearchState("creative_ready");
    const result = modernResult({ researchRecord: record, researchVerification: verification });
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.phase).toBe("ready_to_complete");
    expect(item.researchLifecycle.phase).not.toBe("completed");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("case 5/6: completed 保持 completed（creativeReadiness 由同一 Reader 派生）", async () => {
    const result = completedResult();
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.phase).toBe("completed");
    expect(item.researchLifecycle.completionStatus).toBe("completed");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("case 7: completed + stale 仍为 completed（不得退回研究中）", async () => {
    const { record, verification } = validResearchState("creative_ready");
    const result = modernResult({
      researchRecord: record,
      researchVerification: verification,
      researchCompletion: {
        schema: "research-completion.v1",
        status: "completed",
        completedAt: "2026-09-08T00:00:00.000Z",
        decisionId: record.latestDecision.decisionId,
        revision: record.revision,
        finalStatus: "creative_ready",
        evidenceHash: "0".repeat(64),
      },
      browserEvidence: { snapshots: [{ fields: { title: { value: "Changed" } } }] },
    });
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.phase).toBe("completed");
    expect(item.researchLifecycle.stale).toBe(true);
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("case 8: abandoned → 研究已放弃", async () => {
    const { record, verification } = validResearchState("abandoned");
    const result = modernResult({ researchRecord: record, researchVerification: verification });
    const item = await getRecords(result, "rejected");
    expect(item.researchLifecycle.phase).toBe("abandoned");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "rejected", type: "workflow" }),
    );
  });

  it("case 9: legacy 保持兼容（contractMode=legacy，永不伪装 completed）", async () => {
    const result = { finalReport: { title: "legacy" } };
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.contractMode).toBe("legacy");
    expect(item.researchLifecycle.phase).not.toBe("completed");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("case 10: invalid contract → blocked（不得静默显示 created）", async () => {
    const { record } = validResearchState("creative_ready");
    const result = modernResult({
      researchRecord: record,
      researchVerification: { schema: "research-verification.v1", broken: true },
    });
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.phase).toBe("blocked");
    expect(item.researchLifecycle.contractMode).toBe("invalid");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("case 11: DB decisionStatus 与 latestDecision 冲突时以 Reader（modern latestDecision）为准", async () => {
    const { record, verification } = validResearchState("creative_ready");
    const result = modernResult({ researchRecord: record, researchVerification: verification });
    const item = await getRecords(result, "pending");
    expect(item.researchLifecycle.decisionStatus).toBe("creative_ready");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "pending", type: "workflow" }),
    );
  });

  it("case 12: productLifecycle=ready_to_test 不能导致 completed", async () => {
    const result = modernResult({ productLifecycle: { status: "ready_to_test" } });
    const item = await getRecords(result, "continue");
    expect(item.researchLifecycle.phase).not.toBe("completed");
    expect(item.researchLifecycle.completionStatus).toBe("not_completed");
    expect(item.researchLifecycle).toEqual(
      getResearchLifecycleState({ result, decisionStatus: "continue", type: "workflow" }),
    );
  });

  it("同一请求内多任务一次返回（无 N+1：projection 为同步行内计算）", async () => {
    const rows = [
      row("task-bridge-a", modernResult()),
      row("task-bridge-b", completedResult(), "continue"),
    ];
    mockPrisma.viralAnalysisRecord.findMany.mockResolvedValueOnce(rows);
    mockPrisma.viralAnalysisRecord.count.mockResolvedValueOnce(2);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET(createGetRequest());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.records).toHaveLength(2);
    expect(json.records[0].researchLifecycle.phase).toBe("created");
    expect(json.records[1].researchLifecycle.phase).toBe("completed");
    // 服务端行内投影不得对外发起任何 fetch（无 N+1 lifecycle 请求）。
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
