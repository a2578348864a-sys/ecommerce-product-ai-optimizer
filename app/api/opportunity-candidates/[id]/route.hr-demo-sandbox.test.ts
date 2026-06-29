import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  updateCandidate: vi.fn(),
  deleteCandidate: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: () => false,
  getSandboxCandidate: () => null,
  updateSandboxCandidate: () => null,
  deleteSandboxCandidate: () => false,
  sandboxCandidateToListItem: () => ({}),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: (value: unknown) => ["pending", "watching", "converted", "rejected"].includes(String(value)),
  updateCandidate: mocks.updateCandidate,
  deleteCandidate: mocks.deleteCandidate,
}));

async function callPATCH() {
  const { PATCH } = await import("./route");
  const req = new Request("http://localhost/api/opportunity-candidates/cand-official", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "demo-token" },
    body: JSON.stringify({ status: "watching" }),
  });
  return PATCH(req as any, { params: Promise.resolve({ id: "cand-official" }) });
}

async function callDELETE() {
  const { DELETE } = await import("./route");
  const req = new Request("http://localhost/api/opportunity-candidates/cand-official", {
    method: "DELETE",
    headers: { "x-access-token": "demo-token" },
  });
  return DELETE(req as any, { params: Promise.resolve({ id: "cand-official" }) });
}

describe("HR demo sandbox guard for official candidate writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "demo", demoAccessId: "demo-hr" } });
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "demo cannot write official data",
    });
  });

  it("blocks demo PATCH on an official candidate before service update", async () => {
    const res = await callPATCH();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });

  it("blocks demo DELETE on an official candidate before service delete", async () => {
    const res = await callDELETE();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.deleteCandidate).not.toHaveBeenCalled();
  });
});
