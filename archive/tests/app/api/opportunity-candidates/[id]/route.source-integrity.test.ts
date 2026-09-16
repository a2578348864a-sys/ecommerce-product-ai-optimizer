import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSourcePolicyError } from "@/lib/candidateSourceIntegrity";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  updateCandidate: vi.fn(),
  updateSandboxCandidate: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxCandidateId: (id: string) => id.startsWith("sandbox_candidate_"),
  getSandboxCandidate: vi.fn(),
  updateSandboxCandidate: mocks.updateSandboxCandidate,
  deleteSandboxCandidate: vi.fn(),
  sandboxCandidateToListItem: vi.fn((candidate) => ({ ...candidate, sourceIntegrity: "unverified" })),
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: (value: unknown) => ["pending", "worth_analyzing", "analyzed", "paused", "rejected"].includes(String(value)),
  updateCandidate: mocks.updateCandidate,
  deleteCandidate: vi.fn(),
}));

function request(id: string, body: unknown) {
  return new Request(`http://localhost/api/opportunity-candidates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function callPatch(id: string, body: unknown) {
  const { PATCH } = await import("./route");
  return PATCH(request(id, body) as never, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "demo", demoAccessId: "visitor-a" } });
  mocks.updateCandidate.mockResolvedValue({
    id: "candidate-owner",
    status: "worth_analyzing",
    sourceMetaJson: "{",
    analysisJson: "{}",
  });
  mocks.updateSandboxCandidate.mockReturnValue({
    id: "sandbox_candidate_a",
    status: "worth_analyzing",
    sourceMetaJson: "{}",
    analysisJson: "{}",
  });
});

describe("PATCH Candidate source integrity protocol", () => {
  it.each([
    ["set", "task-forged"],
    ["clear", null],
  ])("rejects Owner attempts to %s the Candidate Task link", async (_action, convertedTaskId) => {
    const response = await callPatch("candidate-owner", { convertedTaskId });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_task_link_locked" },
    });
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });

  it("rejects Visitor attempts to mutate the Candidate Task link", async () => {
    const response = await callPatch("sandbox_candidate_a", { convertedTaskId: "task-forged" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "candidate_task_link_locked" },
    });
    expect(mocks.updateSandboxCandidate).not.toHaveBeenCalled();
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });

  it("passes strict Owner acknowledgement and original requested fields to the Service", async () => {
    const response = await callPatch("candidate-owner", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: true,
      name: "ignored-but-protected",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidate).toMatchObject({
      sourceIntegrity: "unverified",
      sourceReview: { integrity: "unverified" },
    });
    expect(body.candidate).not.toHaveProperty("sourceMetaJson");
    expect(body.candidate).not.toHaveProperty("analysisJson");
    expect(mocks.updateCandidate).toHaveBeenCalledWith(
      "candidate-owner",
      { status: "worth_analyzing" },
      expect.objectContaining({
        sourceReviewAcknowledged: true,
        requestedFields: expect.arrayContaining(["status", "sourceReviewAcknowledged", "name"]),
      }),
    );
  });

  it("does not coerce a string acknowledgement to true", async () => {
    await callPatch("candidate-owner", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: "true",
    });

    expect(mocks.updateCandidate.mock.calls[0][2].sourceReviewAcknowledged).toBeUndefined();
  });

  it.each([
    ["source_review_required", "internal source meta"],
    ["verified_source_fields_locked", "private signed fields"],
  ])("maps Owner policy error %s to a generic 409", async (code, internalMessage) => {
    mocks.updateCandidate.mockRejectedValue(new CandidateSourcePolicyError(code as never, internalMessage));

    const response = await callPatch("candidate-owner", { status: "worth_analyzing" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(body)).not.toContain(internalMessage);
  });

  it("applies the same protocol to the current Visitor Sandbox", async () => {
    const response = await callPatch("sandbox_candidate_a", {
      status: "worth_analyzing",
      sourceReviewAcknowledged: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSandboxCandidate).toHaveBeenCalledWith(
      "visitor-a",
      "sandbox_candidate_a",
      { status: "worth_analyzing" },
      expect.objectContaining({ sourceReviewAcknowledged: true }),
    );
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });

  it("maps Visitor policy failure to 409 without falling through to Owner write", async () => {
    mocks.updateSandboxCandidate.mockImplementation(() => {
      throw new CandidateSourcePolicyError("source_review_required", "sandbox private state");
    });

    const response = await callPatch("sandbox_candidate_a", { status: "worth_analyzing" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("source_review_required");
    expect(JSON.stringify(body)).not.toContain("sandbox private state");
    expect(mocks.updateCandidate).not.toHaveBeenCalled();
  });
});
