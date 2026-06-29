import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authMode: "demo" as "owner" | "demo",
  createRecord: vi.fn(),
  runPipeline: vi.fn(),
  ensureDemoAiQuota: vi.fn(),
  consumeDemoAiCalls: vi.fn(),
  createSandboxTask: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      create: mocks.createRecord,
    },
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => (
    mocks.authMode === "demo"
      ? { ok: true, context: { mode: "demo", demoAccessId: "demo-hr" } }
      : { ok: true, context: { mode: "owner", token: "owner-token" } }
  ),
  ensureDemoAiQuota: mocks.ensureDemoAiQuota,
  consumeDemoAiCalls: mocks.consumeDemoAiCalls,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  createSandboxTask: mocks.createSandboxTask,
  sandboxTaskToListItem: (task: Record<string, unknown>) => ({ ...task, isSandbox: true, sourceMode: "demo_sandbox" }),
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  getOpportunityDisplayRiskLevel: () => "low",
  runOpportunitiesPipeline: mocks.runPipeline,
}));

function pipelineResult() {
  return {
    totalCount: 1,
    completedCount: 1,
    failedCount: 0,
    candidates: [
      {
        index: 1,
        name: "Phone Stand",
        rawInput: "Phone Stand",
        link: "",
        status: "completed",
        errorMessage: "",
        score: 82,
        level: "high",
        levelLabel: "High",
        reasons: ["clear demand"],
        risks: ["competition"],
        nextAction: "review",
        displayRiskLevel: "low",
        sourcing: { feasibility: "ok", summary: "easy", searchKeywords: [], moqEstimate: "", beginnerFriendly: true, beginnerFit: "good" },
        risk: { overallLevel: "low", summary: "manageable", blacklistMatches: [] },
        summary: {
          verdict: "continue",
          confidence: 0.8,
          summary: "good candidate",
          reasons: ["clear demand"],
          risks: ["competition"],
          nextSteps: ["source"],
          beginnerTip: "check margin",
          downgraded: false,
          downgradeReasons: [],
        },
      },
    ],
  };
}

async function callPOST(rawText = "Phone Stand") {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/opportunities", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "token" },
    body: JSON.stringify({ rawText }),
  });
  return POST(req as any);
}

describe("POST /api/opportunities HR demo sandbox writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authMode = "demo";
    mocks.ensureDemoAiQuota.mockReturnValue({ ok: true });
    mocks.consumeDemoAiCalls.mockReturnValue({
      id: "demo-hr",
      label: "HR Demo",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
      isActive: true,
    });
    mocks.runPipeline.mockResolvedValue(pipelineResult());
    mocks.createSandboxTask.mockReturnValue({
      id: "sandbox_task_001",
      title: "Opportunity Radar - 1 candidates",
      sourceMode: "demo_sandbox",
      isSandbox: true,
    });
    mocks.createRecord.mockResolvedValue({ id: "official-task" });
  });

  it("writes demo opportunity radar results to sandbox, not Prisma", async () => {
    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.sourceMode).toBe("demo_sandbox");
    expect(data.data.isSandbox).toBe(true);
    expect(data.demoAccess.remainingAiCalls).toBe(4);
    expect(mocks.ensureDemoAiQuota).toHaveBeenCalledWith(expect.objectContaining({ mode: "demo" }), 1);
    expect(mocks.runPipeline).toHaveBeenCalledWith("Phone Stand");
    expect(mocks.consumeDemoAiCalls).toHaveBeenCalledWith(expect.objectContaining({ mode: "demo" }), 1);
    expect(mocks.createSandboxTask).toHaveBeenCalled();
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("rejects demo opportunity radar when quota is exhausted before pipeline runs", async () => {
    mocks.ensureDemoAiQuota.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_ai_quota_exceeded",
      message: "quota exhausted",
    });

    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_ai_quota_exceeded");
    expect(mocks.runPipeline).not.toHaveBeenCalled();
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("keeps owner opportunity radar writes in Prisma", async () => {
    mocks.authMode = "owner";

    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.createRecord).toHaveBeenCalled();
    expect(mocks.createSandboxTask).not.toHaveBeenCalled();
  });
});
