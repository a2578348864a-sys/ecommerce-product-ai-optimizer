import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  deleteCandidate: vi.fn(),
  deleteSandboxCandidate: vi.fn(),
  removeCandidateFromResearchPool: vi.fn(),
  removeSandboxCandidateFromResearchPool: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: (id: string) => id.startsWith("sandbox_candidate_"),
  getSandboxCandidate: vi.fn(),
  updateSandboxCandidate: vi.fn(),
  deleteSandboxCandidate: mocks.deleteSandboxCandidate,
  removeSandboxCandidateFromResearchPool: mocks.removeSandboxCandidateFromResearchPool,
  sandboxCandidateToListItem: vi.fn(),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: vi.fn(),
  updateCandidate: vi.fn(),
  deleteCandidate: mocks.deleteCandidate,
  removeCandidateFromResearchPool: mocks.removeCandidateFromResearchPool,
}));

async function callDelete(id: string) {
  const { DELETE } = await import("./route");
  const request = new Request(`http://localhost/api/opportunity-candidates/${id}`, {
    method: "DELETE",
    headers: { "x-access-token": "test-token" },
  });
  return DELETE(request as never, { params: Promise.resolve({ id }) });
}

async function callRemove(id: string) {
  const { PATCH } = await import("./route");
  const request = new Request(`http://localhost/api/opportunity-candidates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "test-token" },
    body: JSON.stringify({ action: "remove_from_research_pool" }),
  });
  return PATCH(request as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.requireAuthenticated.mockReturnValue({
    ok: true,
    context: { mode: "demo", demoAccessId: "visitor-a" },
  });
});

describe("DELETE /api/opportunity-candidates/[id] lifecycle protocol", () => {
  it("returns 409 for an Owner Candidate that already has a Task", async () => {
    mocks.deleteCandidate.mockResolvedValue("linked_task");

    const response = await callDelete("candidate-linked");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "candidate_has_linked_task" },
    });
  });

  it("keeps Owner delete success and not-found responses distinct", async () => {
    mocks.deleteCandidate.mockResolvedValueOnce("deleted").mockResolvedValueOnce("not_found");

    const deleted = await callDelete("candidate-unlinked");
    const missing = await callDelete("candidate-missing");

    expect(deleted.status).toBe(200);
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 409 for a Visitor Candidate that already has a Task", async () => {
    mocks.deleteSandboxCandidate.mockReturnValue("linked_task");

    const response = await callDelete("sandbox_candidate_linked");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "candidate_has_linked_task" },
    });
    expect(mocks.deleteSandboxCandidate).toHaveBeenCalledWith("visitor-a", "sandbox_candidate_linked");
  });

  it("does not reveal whether a different Visitor owns the Candidate", async () => {
    mocks.deleteSandboxCandidate.mockReturnValue("not_found");

    const response = await callDelete("sandbox_candidate_visitor_b");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(mocks.deleteSandboxCandidate).toHaveBeenCalledWith("visitor-a", "sandbox_candidate_visitor_b");
  });
});

describe("PATCH /api/opportunity-candidates/[id] remove-from-pool protocol", () => {
  it("moves a linked Owner Candidate out of the pool without deleting its Task link", async () => {
    mocks.removeCandidateFromResearchPool.mockResolvedValue("removed");

    const response = await callRemove("candidate-linked");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { id: "candidate-linked" },
    });
    expect(mocks.removeCandidateFromResearchPool).toHaveBeenCalledWith("candidate-linked");
    expect(mocks.deleteCandidate).not.toHaveBeenCalled();
  });

  it("moves only the current Visitor's linked Candidate", async () => {
    mocks.removeSandboxCandidateFromResearchPool.mockResolvedValue("removed");

    const response = await callRemove("sandbox_candidate_linked");

    expect(response.status).toBe(200);
    expect(mocks.removeSandboxCandidateFromResearchPool)
      .toHaveBeenCalledWith("visitor-a", "sandbox_candidate_linked");
    expect(mocks.deleteSandboxCandidate).not.toHaveBeenCalled();
  });

  it("does not let Visitor B remove a Candidate owned by Visitor A", async () => {
    // Visitor B 上下文：候选 sandbox_candidate_a 属于 visitor-a
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-b" },
    });
    mocks.removeSandboxCandidateFromResearchPool.mockResolvedValue("not_found");

    const response = await callRemove("sandbox_candidate_a");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    // 隔离保证：B 只能以自身身份调用；A 的候选状态不变，且不泄露归属
    expect(mocks.removeSandboxCandidateFromResearchPool)
      .toHaveBeenCalledWith("visitor-b", "sandbox_candidate_a");
    expect(mocks.removeCandidateFromResearchPool).not.toHaveBeenCalled();
    expect(mocks.deleteSandboxCandidate).not.toHaveBeenCalled();
  });
});
