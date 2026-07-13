import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  deleteCandidate: vi.fn(),
  deleteSandboxCandidate: vi.fn(),
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
  sandboxCandidateToListItem: vi.fn(),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: vi.fn(),
  updateCandidate: vi.fn(),
  deleteCandidate: mocks.deleteCandidate,
}));

async function callDelete(id: string) {
  const { DELETE } = await import("./route");
  const request = new Request(`http://localhost/api/opportunity-candidates/${id}`, {
    method: "DELETE",
    headers: { "x-access-token": "test-token" },
  });
  return DELETE(request as never, { params: Promise.resolve({ id }) });
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
