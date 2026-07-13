import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSourceSaveError } from "@/lib/server/candidateSourceSave";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  saveLegacyCandidates: vi.fn(),
  saveLegacySandboxCandidates: vi.fn(),
  importLocalCandidates: vi.fn(),
  importSandboxCandidates: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  saveLegacySandboxCandidates: mocks.saveLegacySandboxCandidates,
  importSandboxCandidates: mocks.importSandboxCandidates,
}));

vi.mock("@/lib/server/opportunityCandidateService", () => ({
  isValidCandidateStatus: vi.fn(),
  saveLegacyCandidates: mocks.saveLegacyCandidates,
  importLocalCandidates: mocks.importLocalCandidates,
}));

function request(items: unknown[]) {
  return new Request("http://localhost/api/opportunity-candidates/import-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.saveLegacyCandidates.mockImplementation(async (items) => ({ items, created: 1, updated: 1 }));
  mocks.saveLegacySandboxCandidates.mockImplementation((_: string, items) => ({ items, created: items.length }));
});

describe("POST /api/opportunity-candidates/import-local legacy protocol", () => {
  it("forces Owner local drafts through legacy preflight with pending status", async () => {
    const { POST } = await import("./route");
    const response = await POST(request([{
      name: "Local Product",
      score: 88,
      candidateStatus: "analyzed",
      convertedTaskId: "client-task",
      sourceEvidence: { version: "candidate-source-v2" },
      ruleAssessment: { version: "candidate-rule-v1" },
      sourceProof: { payload: "forged" },
      sourceMetaJson: JSON.stringify({ integrity: "signed_source_v2", secret: "forged" }),
      analysisJson: JSON.stringify({ trusted: true }),
    }]) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, imported: 2, skipped: 0 });
    const saved = mocks.saveLegacyCandidates.mock.calls[0][0][0];
    expect(saved).toMatchObject({ name: "Local Product", status: "pending", convertedTaskId: null });
    expect(saved.sourceMetaJson).toContain("legacy_unverified");
    expect(saved.sourceMetaJson).not.toContain("secret");
    expect(saved.analysisJson).not.toContain("trusted");
    expect(mocks.importLocalCandidates).not.toHaveBeenCalled();
    expect(mocks.importSandboxCandidates).not.toHaveBeenCalled();
  });

  it("writes Visitor imports only through the current Sandbox legacy service", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    const { POST } = await import("./route");
    const response = await POST(request([{ name: "Visitor Product", candidateStatus: "worth_analyzing" }]) as never);

    expect(response.status).toBe(200);
    expect(mocks.saveLegacySandboxCandidates).toHaveBeenCalledWith(
      "visitor-a",
      [expect.objectContaining({ name: "Visitor Product", status: "pending" })],
    );
    expect(mocks.saveLegacyCandidates).not.toHaveBeenCalled();
    expect(mocks.importSandboxCandidates).not.toHaveBeenCalled();
  });

  it("maps a signed identity conflict to 409 with zero alternate writes", async () => {
    mocks.saveLegacyCandidates.mockRejectedValue(new CandidateSourceSaveError(
      "candidate_source_conflict",
      "private signed identity",
    ));
    const { POST } = await import("./route");
    const response = await POST(request([{ name: "Signed Product" }, { name: "Other Product" }]) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_source_conflict" } });
    expect(JSON.stringify(body)).not.toContain("private signed identity");
    expect(mocks.importLocalCandidates).not.toHaveBeenCalled();
    expect(mocks.importSandboxCandidates).not.toHaveBeenCalled();
  });

  it("fails the whole invalid batch instead of partially importing valid rows", async () => {
    const { POST } = await import("./route");
    const response = await POST(request([{ name: "Valid Product" }, "not-an-object"]) as never);

    expect(response.status).toBe(400);
    expect(mocks.saveLegacyCandidates).not.toHaveBeenCalled();
    expect(mocks.saveLegacySandboxCandidates).not.toHaveBeenCalled();
  });
});
