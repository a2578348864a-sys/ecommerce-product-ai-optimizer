import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";

const mocks = vi.hoisted(() => ({
  authOk: true as boolean,
  authCtx: { mode: "demo", demoAccessId: "guest-demo-1" } as Record<string, unknown>,
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () =>
    mocks.authOk
      ? { ok: true as const, context: mocks.authCtx }
      : { ok: false as const, status: 401, code: "invalid_access", message: "not-logged-in" },
}));

vi.mock("@/lib/server/replayDemoChoices", () => ({
  getDemoChoices: (_b: string, _d: string, id: string) => [{ bundleId: id, gateId: "gate_a", decision: "continue_sourcing", at: "x" }],
  saveDemoChoice: (_b: string, _d: string, c: unknown) => [c],
  resetDemoChoices: () => [],
}));

type NextReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, opts: NextReqInit = {}) => new NextRequest("http://localhost" + url, opts);

describe("/api/replay/demo-choice (gate 6 minimal API)", () => {
  beforeEach(() => {
    mocks.authOk = true;
    mocks.authCtx = { mode: "demo", demoAccessId: "guest-demo-1" };
  });
  it("unauthenticated 401; owner context 403 demo_only", async () => {
    mocks.authOk = false;
    const r1 = await GET(req("/api/replay/demo-choice?bundleId=b1"));
    expect(r1.status).toBe(401);
    mocks.authOk = true;
    mocks.authCtx = { mode: "owner" };
    const r2 = await GET(req("/api/replay/demo-choice?bundleId=b1"));
    expect(r2.status).toBe(403);
  });
  it("GET missing bundleId 400; with bundleId 200 choices", async () => {
    mocks.authCtx = { mode: "demo", demoAccessId: "guest-demo-1" };
    const bad = await GET(req("/api/replay/demo-choice"));
    expect(bad.status).toBe(400);
    const ok = await GET(req("/api/replay/demo-choice?bundleId=b1"));
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.choices[0].decision).toBe("continue_sourcing");
  });
  it("POST invalid decision 400; valid 200; DELETE 200", async () => {
    const bad = await POST(req("/api/replay/demo-choice", { method: "POST", body: JSON.stringify({ bundleId: "b1", gateId: "gate_a", decision: "fly_to_moon" }) }));
    expect(bad.status).toBe(400);
    const okb = await POST(req("/api/replay/demo-choice", { method: "POST", body: JSON.stringify({ bundleId: "b1", gateId: "gate_a", decision: "content_ready", note: "accept" }) }));
    expect(okb.status).toBe(200);
    const rm = await DELETE(req("/api/replay/demo-choice?bundleId=b1", { method: "DELETE" }));
    expect(rm.status).toBe(200);
  });
});
