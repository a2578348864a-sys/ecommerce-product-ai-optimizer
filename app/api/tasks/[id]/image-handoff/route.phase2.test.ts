import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  checkCreativeHandoffGate: vi.fn(),
  generateImageDraftFromHandoff: vi.fn(),
  imageDraftSafeSummaries: vi.fn(),
  mutateTaskResultJson: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));
vi.mock("@/lib/server/demoSandbox", () => ({ isSandboxTaskId: () => false }));
vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: mocks.checkCreativeHandoffGate,
}));
vi.mock("@/lib/imageHandoff/imageGenerationService", () => ({
  generateImageDraftFromHandoff: mocks.generateImageDraftFromHandoff,
  imageDraftSafeSummaries: mocks.imageDraftSafeSummaries,
  ImageHandoffError: class ImageHandoffError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/server/taskResultJsonMutation", () => ({
  mutateTaskResultJson: mocks.mutateTaskResultJson,
  TaskResultJsonMutationError: class TaskResultJsonMutationError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message);
    }
  },
}));

const VERSION = { resultJsonHash: "a".repeat(64), updatedAt: "2026-08-08T00:00:00.000Z" };
const CANDIDATES = [
  { id: "image-a", mode: "composition_concept", compositionSummary: "A", approvedReferenceFingerprint: null, generatedAt: "2026-08-08T00:00:00.000Z", sourceHandoffRevision: 2, humanReviewRequired: true },
  { id: "image-b", mode: "composition_concept", compositionSummary: "B", approvedReferenceFingerprint: null, generatedAt: "2026-08-08T00:00:00.000Z", sourceHandoffRevision: 2, humanReviewRequired: true },
];

function gate(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: "eligible",
    currentHandoff: {
      schema: "product-creative-handoff.v1",
      handoffId: "handoff-1",
      controlState: "active",
      currentRevision: 2,
      versions: [{ revision: 2, visualReferences: [], creativePreferences: {}, confirmedFacts: [], aiCreativeReferences: [] }],
    },
    candidate: { sourceResearch: { researchRevision: 2 } },
    imageDraftRaw: { items: CANDIDATES },
    imageStudioSelectionRaw: { selectedImageId: "image-b", sourceHandoffRevision: 2 },
    storageVersion: VERSION,
    ...overrides,
  };
}

async function call(method: "GET" | "POST" | "PATCH", body?: unknown) {
  const route = await import("@/app/api/tasks/[id]/image-handoff/route");
  const request = new Request("http://localhost/api/tasks/task-1/image-handoff", {
    method,
    headers: { "Content-Type": "application/json", "x-access-token": "owner" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never;
  return route[method](request, { params: Promise.resolve({ id: "task-1" }) });
}

describe("Phase 2 Task Image Studio route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.checkCreativeHandoffGate.mockResolvedValue(gate());
    mocks.imageDraftSafeSummaries.mockReturnValue(CANDIDATES);
    mocks.mutateTaskResultJson.mockResolvedValue({ resultJson: "{}" });
  });

  it("returns only current-revision candidates and the explicit saved selection", async () => {
    const response = await call("GET");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.candidates).toHaveLength(2);
    expect(json.data.selectedImageId).toBe("image-b");
    expect(mocks.imageDraftSafeSummaries).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it("passes a two-candidate request to the server-authoritative Task service", async () => {
    mocks.generateImageDraftFromHandoff.mockResolvedValue({
      imageStatus: "active",
      currentHandoffRevision: 2,
      sourceHandoffRevision: 2,
      idempotentReplay: false,
      draft: CANDIDATES[1],
      candidates: CANDIDATES,
    });
    const response = await call("POST", {
      requestId: "request-1",
      expectedStorageVersion: VERSION,
      expectedHandoffRevision: 2,
      mode: "composition_concept",
      count: 2,
      confirmed: true,
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.candidates).toHaveLength(2);
    expect(mocks.generateImageDraftFromHandoff).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ mode: "owner" }),
      expect.objectContaining({ count: 2 }),
    );
  });

  it("saves only selectedImageId plus the current revision through the ai-image writer", async () => {
    const response = await call("PATCH", {
      selectedImageId: "image-b",
      expectedStorageVersion: VERSION,
      expectedHandoffRevision: 2,
      confirmed: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.mutateTaskResultJson).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      writer: "ai-image",
      expectedStorageVersion: VERSION,
    }));
    expect(mocks.generateImageDraftFromHandoff).not.toHaveBeenCalled();
  });

  it("accepts an active confirmed handoff when the research projection still reports no_confirmed_facts", async () => {
    mocks.checkCreativeHandoffGate.mockResolvedValue(gate({
      allowed: false,
      reason: "no_confirmed_facts",
    }));

    const response = await call("PATCH", {
      selectedImageId: "image-b",
      expectedStorageVersion: VERSION,
      expectedHandoffRevision: 2,
      confirmed: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.mutateTaskResultJson).toHaveBeenCalledTimes(1);
  });

  it("rejects stale or foreign candidate IDs before any write", async () => {
    const response = await call("PATCH", {
      selectedImageId: "image-old-revision",
      expectedStorageVersion: VERSION,
      expectedHandoffRevision: 2,
      confirmed: true,
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("image_selection_stale");
    expect(mocks.mutateTaskResultJson).not.toHaveBeenCalled();
  });
});
