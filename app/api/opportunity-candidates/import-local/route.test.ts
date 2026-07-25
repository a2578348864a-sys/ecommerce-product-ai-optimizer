import { beforeEach, describe, expect, it, vi } from "vitest";
import { CandidateSourceSaveError } from "@/lib/server/candidateSourceSave";
import { LegacyCandidateWriteError } from "@/lib/server/legacyCandidateWriteTypes";

const mockStoreWrite = vi.fn();

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  createScopedOpportunityStore: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/opportunityStore", () => ({
  createScopedOpportunityStore: mocks.createScopedOpportunityStore,
}));

function request(items: unknown[]) {
  return new Request("http://localhost/api/opportunity-candidates/import-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

function ownerStore() {
  return {
    candidates: {
      importLocalCandidates: mockStoreWrite,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
  mocks.createScopedOpportunityStore.mockReturnValue(ownerStore());
  mockStoreWrite.mockResolvedValue({ created: 2, updated: 0, unchanged: 0, items: [] });
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
    // Scheme C: import-local delegates to Scoped Store, not direct save
    expect(mockStoreWrite).toHaveBeenCalledTimes(1);
    const saved = mockStoreWrite.mock.calls[0][0][0];
    expect(saved).toMatchObject({ name: "Local Product", status: "pending", convertedTaskId: null });
    expect(saved.sourceMetaJson).toContain("legacy_unverified");
    expect(saved.sourceMetaJson).not.toContain("secret");
    expect(saved.analysisJson).not.toContain("trusted");
  });

  it("writes Visitor imports through the Scoped Store write service", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a" },
    });
    const { POST } = await import("./route");
    const response = await POST(request([{ name: "Visitor Product", candidateStatus: "worth_analyzing" }]) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, imported: 2, skipped: 0, isSandbox: true });
    expect(mockStoreWrite).toHaveBeenCalledTimes(1);
    const saved = mockStoreWrite.mock.calls[0][0][0];
    expect(saved).toMatchObject({ name: "Visitor Product", status: "pending" });
  });

  it("maps a signed identity conflict to 409 with zero alternate writes", async () => {
    mockStoreWrite.mockRejectedValue(new LegacyCandidateWriteError(
      "candidate_legacy_overwrite_blocked",
      "signed identity collision",
    ));
    const { POST } = await import("./route");
    const response = await POST(request([{ name: "Signed Product" }, { name: "Other Product" }]) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: "candidate_legacy_overwrite_blocked" } });
    expect(JSON.stringify(body)).not.toContain("signed identity collision");
  });
});
