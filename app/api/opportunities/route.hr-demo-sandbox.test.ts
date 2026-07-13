import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authMode: "demo" as "owner" | "demo",
  runPipeline: vi.fn(),
  reserveDemoAiCalls: vi.fn(),
  markDemoAiProviderCallStarted: vi.fn(),
  settleDemoAiCalls: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => (
    mocks.authMode === "demo"
      ? { ok: true, context: { mode: "demo", demoAccessId: "demo-hr" } }
      : { ok: true, context: { mode: "owner", token: "owner-token" } }
  ),
  reserveDemoAiCalls: mocks.reserveDemoAiCalls,
  markDemoAiProviderCallStarted: mocks.markDemoAiProviderCallStarted,
  settleDemoAiCalls: mocks.settleDemoAiCalls,
}));

vi.mock("@/lib/agents/orchestrator", () => ({
  getOpportunityDisplayRiskLevel: () => "low",
  OPPORTUNITY_AI_CALLS_PER_CANDIDATE: 3,
  OPPORTUNITY_AI_CALL_TIMEOUT_MS: 45_000,
  runOpportunitiesPipeline: mocks.runPipeline,
}));

function pipelineResult(providerCallStartedCount = 3) {
  return {
    totalCount: 1,
    completedCount: 1,
    failedCount: 0,
    providerCallStartedCount,
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
    mocks.reserveDemoAiCalls.mockReturnValue({
      ok: true,
      reservation: { reservationId: "reservation-1", plannedCount: 3 },
    });
    mocks.markDemoAiProviderCallStarted.mockReturnValue({ ok: true });
    mocks.settleDemoAiCalls.mockReturnValue({
      ok: true,
      snapshot: {
        id: "demo-hr",
        label: "HR Demo",
        expiresAt: null,
        maxAiCalls: 5,
        usedAiCalls: 3,
        remainingAiCalls: 2,
        isActive: true,
      },
    });
    mocks.runPipeline.mockImplementation(async (_rawText: string, hooks: { onProviderCallStarted?: () => void | Promise<void> }) => {
      await hooks.onProviderCallStarted?.();
      await hooks.onProviderCallStarted?.();
      await hooks.onProviderCallStarted?.();
      return pipelineResult();
    });
  });

  it("returns demo scan results without creating a Task", async () => {
    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.sourceMode).toBe("demo_sandbox");
    expect(data.data.isSandbox).toBe(true);
    expect(data.data.savedTask).toBeUndefined();
    expect(data.demoAccess.remainingAiCalls).toBe(2);
    expect(mocks.reserveDemoAiCalls).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      3,
      { leaseMs: 195_000 },
    );
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      "Phone Stand",
      expect.objectContaining({ onProviderCallStarted: expect.any(Function) }),
    );
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "reservation-1", plannedCount: 3 },
      3,
    );
    expect(mocks.markDemoAiProviderCallStarted).toHaveBeenCalledTimes(3);
  });

  it("rejects demo opportunity radar when quota is exhausted before pipeline runs", async () => {
    mocks.reserveDemoAiCalls.mockReturnValue({
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
  });

  it("reserves and settles N x 3 calls for multiple candidates", async () => {
    mocks.reserveDemoAiCalls.mockReturnValueOnce({
      ok: true,
      reservation: { reservationId: "reservation-2", plannedCount: 6 },
    });
    mocks.runPipeline.mockImplementationOnce(async (_rawText: string, hooks: { onProviderCallStarted?: () => void | Promise<void> }) => {
      for (let count = 0; count < 6; count += 1) await hooks.onProviderCallStarted?.();
      return pipelineResult(6);
    });

    const res = await callPOST("Phone Stand\nDesk Lamp");

    expect(res.status).toBe(200);
    expect(mocks.reserveDemoAiCalls).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      6,
      { leaseMs: 330_000 },
    );
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "reservation-2", plannedCount: 6 },
      6,
    );
  });

  it("fails closed and does not save when quota settlement is missing", async () => {
    mocks.settleDemoAiCalls.mockReturnValueOnce({
      ok: false,
      status: 500,
      code: "demo_ai_quota_reservation_missing",
      message: "quota reservation missing",
    });

    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error.code).toBe("demo_ai_quota_reservation_missing");
  });

  it("settles already-started calls when the pipeline throws midway", async () => {
    mocks.runPipeline.mockImplementationOnce(async (_rawText: string, hooks: { onProviderCallStarted?: () => void }) => {
      hooks.onProviderCallStarted?.();
      hooks.onProviderCallStarted?.();
      throw new Error("pipeline interrupted");
    });

    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error.code).toBe("pipeline_error");
    expect(mocks.settleDemoAiCalls).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "demo" }),
      { reservationId: "reservation-1", plannedCount: 3 },
      2,
    );
  });

  it("returns Owner scan results without creating a Task", async () => {
    mocks.authMode = "owner";

    const res = await callPOST();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.reserveDemoAiCalls).not.toHaveBeenCalled();
    expect(mocks.settleDemoAiCalls).not.toHaveBeenCalled();
    expect(data.data.savedTask).toBeUndefined();
  });
});
