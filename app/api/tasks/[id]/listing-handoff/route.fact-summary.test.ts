import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkCreativeHandoffGate: vi.fn(),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
}));
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: () => ({ ok: true, context: { mode: "owner", token: "owner" } }),
}));
vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: mocks.checkCreativeHandoffGate,
}));
vi.mock("@/lib/listingHandoff/listingGenerationService", () => ({
  generateListingDraftFromHandoff: vi.fn(),
  draftSafeSummary: () => null,
  ListingHandoffError: class ListingHandoffError extends Error {},
}));
vi.mock("@/lib/server/taskResultJsonMutation", () => ({
  TaskResultJsonMutationError: class TaskResultJsonMutationError extends Error {},
}));
vi.mock("@/lib/productCreativeHandoffStatus", () => ({
  evaluateHandoffStatus: () => ({ status: "active" }),
}));

const now = "2026-08-10T00:00:00.000Z";
function gate(usageScopes: string[]) {
  return {
    allowed: true,
    reason: "eligible",
    currentHandoff: {
      controlState: "active",
      currentRevision: 1,
      versions: [{
        revision: 1,
        confirmedFacts: [{
          field: usageScopes.includes("listing") ? "brand" : "visual_note",
          label: "测试事实",
          value: "TestBrand",
          usageScopes,
        }],
        prohibitedClaims: [{ summary: "不得夸大" }],
      }],
    },
    candidate: {
      sourceResearch: {
        candidateId: "candidate-1",
        researchRevision: 1,
        researchHash: "a".repeat(64),
        candidateSourceFingerprint: "b".repeat(64),
      },
    },
    storageVersion: { resultJsonHash: "c".repeat(64), updatedAt: now },
  };
}

async function get() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/tasks/task-1/listing-handoff") as never, {
    params: Promise.resolve({ id: "task-1" }),
  });
}

describe("GET task listing fact summary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables generation when confirmed facts are not Listing-eligible", async () => {
    mocks.checkCreativeHandoffGate.mockResolvedValue(gate(["image"]));

    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.canGenerate).toBe(false);
    expect(body.data.factSummary).toEqual({
      confirmedFacts: 1,
      listingEligibleFacts: 0,
      prohibitedClaims: 1,
    });
  });

  it("keeps generation enabled when at least one Listing fact is eligible", async () => {
    mocks.checkCreativeHandoffGate.mockResolvedValue(gate(["listing"]));

    const response = await get();
    const body = await response.json();

    expect(body.data.canGenerate).toBe(true);
    expect(body.data.factSummary.listingEligibleFacts).toBe(1);
  });
});
