import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  flagEnabled: true,
  authCtx: { mode: "owner" as const, token: "t" },
  authOk: true,
  runRow: { id: "r1", candidateId: "cand-1", ownerScope: "owner", sandboxId: null, mode: "local_live", graphVersion: "research-graph.v4.1", status: "waiting_human", currentNode: "gate_a", revision: 3, planRevision: 0, automaticPlanRevisionCount: 0, stateJson: "{}", eventsJson: "[]", createdAt: new Date(), updatedAt: new Date() },
  graphResult: { ok: true, state: { runId: "r1", status: "running" }, events: [] },
}));

vi.mock("@/lib/v4/featureFlag", () => ({
  requireV4GraphEnabled: () => (mocks.flagEnabled ? { ok: true } : { ok: false, code: "v4_graph_disabled" }),
  isV4GraphEnabled: () => mocks.flagEnabled,
  V4_GRAPH_FEATURE_FLAG: "QX_V4_GRAPH_ENABLED",
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => (mocks.authOk ? { ok: true, context: mocks.authCtx } : { ok: false, status: 401, code: "invalid_access", message: "未登录" }),
  requireOwnerOnly: () => (mocks.authOk ? { ok: true, context: mocks.authCtx } : { ok: false, status: 401, code: "invalid_access", message: "未登录" }),
}));

vi.mock("@/lib/v4/runStore", () => ({
  ResearchRunStore: class {
    async getRun(_id: string) { return mocks.runRow; }
  },
  parseState: (json: string) => (json && json !== "{}" ? JSON.parse(json) : { status: "waiting_human", revision: 3 }),
}));

const graphMocks = vi.hoisted(() => ({ resumeRun: vi.fn(), cancelRun: vi.fn(), startRun: vi.fn() }));
vi.mock("@/lib/v4/graph", () => ({
  resumeRun: graphMocks.resumeRun,
  cancelRun: graphMocks.cancelRun,
  startRun: graphMocks.startRun,
}));

vi.mock("@/lib/server/db", () => ({ prisma: {} }));

import { POST as resumePOST } from "./resume/route";
import { POST as cancelPOST } from "./cancel/route";

const req = (body: unknown) => new Request("http://localhost/api/v4/runs/r1/resume", { method: "POST", body: JSON.stringify(body) });

describe("/api/v4/runs/[runId]/resume", () => {
  beforeEach(() => {
    mocks.flagEnabled = true;
    mocks.authOk = true;
    mocks.authCtx = { mode: "owner", token: "t" };
    mocks.graphResult = { ok: true, state: { runId: "r1", status: "running" }, events: [] };
    graphMocks.resumeRun.mockReset();
    graphMocks.cancelRun.mockReset();
    graphMocks.resumeRun.mockResolvedValue(mocks.graphResult);
  });
  afterEach(() => { vi.clearAllMocks(); });

  it("flag off → 404", async () => {
    mocks.flagEnabled = false;
    const res = await resumePOST(req({ expectedRevision: 3, payload: { kind: "retry" } }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(404);
  });

  it("scope mismatch (demo tries owner run) → 404 run_not_found", async () => {
    mocks.authCtx = { mode: "demo", token: "t", demoAccessId: "visitor-1", isActive: true, isExpired: false, remainingAiCalls: 5 };
    const res = await resumePOST(req({ expectedRevision: 3, payload: { kind: "retry" } }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(404);
  });

  it("revision conflict → 409 with latestRevision", async () => {
    graphMocks.resumeRun.mockResolvedValue({ ok: false, code: "REVISION_CONFLICT", latestRevision: 7, safeMessage: "冲突" });
    const res = await resumePOST(req({ expectedRevision: 3, payload: { kind: "retry" } }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: { code: "REVISION_CONFLICT", latestRevision: 7 } });
  });

  it("invalid payload → 400", async () => {
    const res = await resumePOST(req({ expectedRevision: 3, payload: { kind: "nonsense" } }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(400);
  });

  it("successful resume → 200", async () => {
    const res = await resumePOST(req({ expectedRevision: 3, payload: { kind: "human_decision", decision: "continue" } }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(200);
    expect(graphMocks.resumeRun).toHaveBeenCalledWith("r1", 3, { kind: "human_decision", decision: "continue", note: undefined });
  });

  it("cancel terminal → 409 run_not_actionable", async () => {
    graphMocks.cancelRun.mockResolvedValue({ ok: false, code: "RUN_NOT_ACTIONABLE", safeMessage: "终态" });
    const res = await cancelPOST(req({ expectedRevision: 3 }), { params: Promise.resolve({ runId: "r1" }) });
    expect(res.status).toBe(409);
  });
});
