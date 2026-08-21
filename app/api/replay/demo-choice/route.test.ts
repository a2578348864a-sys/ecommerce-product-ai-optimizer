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
  getDemoChoice: (_b: string, _d: string, id: string) => ({ bundleId: id, gateA: "continue_sourcing", gateB: "content_ready", at: "x" }),
  saveDemoChoice: (_b: string, _d: string, c: unknown) => c,
  resetDemoChoice: () => undefined,
}));

type NextReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, opts: NextReqInit = {}) => new NextRequest("http://localhost" + url, opts);

describe("/api/replay/demo-choice (gate 6 minimal API, form contract)", () => {
  beforeEach(() => {
    mocks.authOk = true;
    mocks.authCtx = { mode: "demo", demoAccessId: "guest-demo-1" };
  });
  it("unauthenticated 401; owner context 403 demo_only", async () => {
    mocks.authOk = false;
    expect((await GET(req("/api/replay/demo-choice?bundleId=b1"))).status).toBe(401);
    mocks.authOk = true;
    mocks.authCtx = { mode: "owner" };
    expect((await GET(req("/api/replay/demo-choice?bundleId=b1"))).status).toBe(403);
  });
  it("GET missing bundleId 400; ok returns choice", async () => {
    mocks.authCtx = { mode: "demo", demoAccessId: "guest-demo-1" };
    expect((await GET(req("/api/replay/demo-choice"))).status).toBe(400);
    const ok = await GET(req("/api/replay/demo-choice?bundleId=b1"));
    expect(ok.status).toBe(200);
    const j = await ok.json();
    expect(j.gateA).toBe("continue_sourcing");
  });
  it("POST invalid decision 400; valid form 200; DELETE 200", async () => {
    const bad = await POST(req("/api/replay/demo-choice?bundleId=b1", { method: "POST", body: JSON.stringify({ gateA: "fly_to_moon" }) }));
    expect(bad.status).toBe(400);
    const okb = await POST(req("/api/replay/demo-choice?bundleId=b1", { method: "POST", body: JSON.stringify({ gateA: "continue_sourcing", gateB: "content_ready", note: "accept" }) }));
    expect(okb.status).toBe(200);
    const j = await okb.json();
    expect(j.gateB).toBe("content_ready");
    expect((await DELETE(req("/api/replay/demo-choice?bundleId=b1", { method: "DELETE" }))).status).toBe(200);
  });
});
