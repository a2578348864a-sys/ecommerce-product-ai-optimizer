import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  isSandboxTaskId: vi.fn(),
  getSandboxTask: vi.fn(),
  findFirst: vi.fn(),
  candidateFindUnique: vi.fn(),
  getResearchLifecycleState: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: mocks.isSandboxTaskId,
  getSandboxTask: mocks.getSandboxTask,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: { findFirst: mocks.findFirst },
    opportunityCandidate: { findUnique: mocks.candidateFindUnique },
  },
}));

vi.mock("@/lib/server/researchLifecycleReader", () => ({
  getResearchLifecycleState: mocks.getResearchLifecycleState,
}));

function request() {
  return new Request("http://localhost/api/tasks/task-1/research-lifecycle", {
    headers: { "x-access-token": "test-token" },
  });
}

function context(id = "task-1") {
  return { params: Promise.resolve({ id }) };
}

const snapshot = {
  phase: "created",
  collectionStatus: "not_started",
  confirmationStatus: "none",
  decisionStatus: "none",
  completionStatus: "not_completed",
  creativeReadiness: "not_ready",
  stale: false,
  blockers: [],
  nextAction: "开始补齐研究资料。",
  contractMode: "modern",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({
    ok: true,
    context: { mode: "owner", demoAccessId: "owner-context" },
  });
  mocks.isSandboxTaskId.mockReturnValue(false);
  mocks.findFirst.mockResolvedValue({
    type: "workflow",
    decisionStatus: "pending",
    resultJson: JSON.stringify({
      candidateToTask: { candidateId: "candidate-1" },
      candidateAnalysisContext: { facts: { asin: "B00063QBL8" } },
      researchRecord: { candidateId: "candidate-1" },
    }),
  });
  mocks.candidateFindUnique.mockResolvedValue({
    id: "candidate-1",
    convertedTaskId: "task-1",
    sourceMetaJson: JSON.stringify({ asin: "B00063QBL8" }),
  });
  mocks.getResearchLifecycleState.mockReturnValue(snapshot);
});

describe("GET /api/tasks/[id]/research-lifecycle", () => {
  it("authenticates before reading the task", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "请先登录后再操作。",
    });
    const { GET } = await import("./route");
    const response = await GET(request() as never, context());

    expect(response.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.getResearchLifecycleState).not.toHaveBeenCalled();
  });

  it("reads the owner task server-side and returns only the unified snapshot", async () => {
    const { GET } = await import("./route");
    const response = await GET(request() as never, context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "task-1" },
      select: { type: true, decisionStatus: true, resultJson: true },
    });
    expect(mocks.candidateFindUnique).toHaveBeenCalledWith({
      where: { id: "candidate-1" },
      select: { id: true, convertedTaskId: true, sourceMetaJson: true },
    });
    expect(mocks.getResearchLifecycleState).toHaveBeenCalledWith({
      result: {
        candidateToTask: { candidateId: "candidate-1" },
        candidateAnalysisContext: { facts: { asin: "B00063QBL8" } },
        researchRecord: { candidateId: "candidate-1" },
      },
      decisionStatus: "pending",
      type: "workflow",
      candidateBindingValid: true,
    });
    expect(body).toEqual({ ok: true, data: snapshot });
    expect(body.data).not.toHaveProperty("result");
    expect(body.data).not.toHaveProperty("facts");
    expect(body.data).not.toHaveProperty("evidence");
    expect(body.data).not.toHaveProperty("listing");
  });

  it("supports demo sandbox tasks without reading Prisma", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: true,
      context: { mode: "demo", demoAccessId: "demo-1" },
    });
    mocks.isSandboxTaskId.mockReturnValueOnce(true);
    mocks.getSandboxTask.mockReturnValueOnce({
      id: "sandbox_task_1",
      type: "workflow",
      decisionStatus: "pending",
      resultJson: JSON.stringify({ candidateToTask: { candidateId: "demo-candidate" } }),
    });
    const { GET } = await import("./route");
    const response = await GET(request() as never, context("sandbox_task_1"));

    expect(response.status).toBe(200);
    expect(mocks.getSandboxTask).toHaveBeenCalledWith("demo-1", "sandbox_task_1");
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("does not expose owner task existence to demo credentials", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: true,
      context: { mode: "demo", demoAccessId: "demo-1" },
    });
    const { GET } = await import("./route");
    const response = await GET(request() as never, context("owner-task"));

    expect(response.status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("does not expose sandbox task existence to owner credentials", async () => {
    mocks.isSandboxTaskId.mockReturnValueOnce(true);
    const { GET } = await import("./route");
    const response = await GET(request() as never, context("sandbox_task_1"));

    expect(response.status).toBe(404);
    expect(mocks.getSandboxTask).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("returns a generic server error without leaking raw exceptions", async () => {
    mocks.findFirst.mockRejectedValueOnce(new Error("DATABASE_URL=secret / internal stack"));
    const { GET } = await import("./route");
    const response = await GET(request() as never, context());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: { code: "server_error", message: "研究生命周期读取失败，请稍后重试。" },
    });
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
