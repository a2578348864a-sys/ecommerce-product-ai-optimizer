import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

type MockAuthCtx = { mode: "owner" | "demo"; token: string; demoAccessId?: string; isActive?: boolean; isExpired?: boolean; remainingAiCalls?: number };

const mocks = vi.hoisted(() => ({
  flagEnabled: true,
  authCtx: { mode: "owner", token: "t" } as MockAuthCtx,
  authOk: true,
  candidate: { id: "cand-1", name: "测试候选" },
  startResult: { ok: true, state: { runId: "r1", status: "waiting_human" }, events: [] },
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

vi.mock("@/lib/server/candidateAuthority", () => ({
  getAuthoritativeCandidate: async () => mocks.candidate,
}));

vi.mock("@/lib/v4/runStore", () => ({
  ResearchRunStore: class {
    async createRun(_input: unknown) { return { id: "r1" }; }
    async getRun(_id: string) { return null; }
  },
  listRuns: async () => [],
}));

vi.mock("@/lib/v4/graph", () => ({
  startRun: async () => mocks.startResult,
}));

vi.mock("@/lib/server/db", () => ({ prisma: {} }));

import { GET, POST } from "./route";

describe("/api/v4/runs", () => {
  beforeEach(() => { mocks.flagEnabled = true; mocks.authOk = true; mocks.authCtx = { mode: "owner", token: "t" }; mocks.startResult = { ok: true, state: { runId: "r1", status: "waiting_human" }, events: [] }; });
  afterEach(() => { vi.clearAllMocks(); });

  it("flag off → 404 v4_graph_disabled", async () => {
    mocks.flagEnabled = false;
    const res = await POST(new NextRequest("http://localhost/api/v4/runs", { method: "POST", body: JSON.stringify({ candidateId: "cand-1" }) }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: { code: "v4_graph_disabled" } });
  });

  it("unauthenticated → 401", async () => {
    mocks.authOk = false;
    const res = await POST(new NextRequest("http://localhost/api/v4/runs", { method: "POST", body: JSON.stringify({ candidateId: "cand-1" }) }));
    expect(res.status).toBe(401);
  });

  it("missing candidateId → 400", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v4/runs", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("owner creates run → 201 with run state", async () => {
    const res = await POST(new NextRequest("http://localhost/api/v4/runs", { method: "POST", body: JSON.stringify({ candidateId: "cand-1" }) }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.run).toMatchObject({ runId: "r1" });
  });

  it("GET lists runs for owner scope", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v4/runs"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, runs: [] });
  });
});
