import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  generateListingDraftFromHandoff: vi.fn(),
  generateImageDraftFromHandoff: vi.fn(),
  reserveDemoProductJourney: vi.fn(),
  commitDemoProductJourney: vi.fn(),
  releaseDemoProductJourney: vi.fn(),
  guardDemoProviderAction: vi.fn(() => ({ ok: true, token: { reservation: null } })),
  finalizeDemoProviderAction: vi.fn(),
  markVisitorStandaloneStudioProviderStarted: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
  guardDemoProviderAction: mocks.guardDemoProviderAction,
  finalizeDemoProviderAction: mocks.finalizeDemoProviderAction,
  markVisitorStandaloneStudioProviderStarted: mocks.markVisitorStandaloneStudioProviderStarted,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox-task-"),
}));

vi.mock("@/lib/server/demoProductJourneyQuota", () => ({
  reserveDemoProductJourney: mocks.reserveDemoProductJourney,
  commitDemoProductJourney: mocks.commitDemoProductJourney,
  releaseDemoProductJourney: mocks.releaseDemoProductJourney,
}));

vi.mock("@/lib/listingHandoff/listingGenerationService", () => ({
  generateListingDraftFromHandoff: mocks.generateListingDraftFromHandoff,
  ListingHandoffError: class ListingHandoffError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message);
    }
  },
  draftSafeSummary: () => null,
}));

vi.mock("@/lib/imageHandoff/imageGenerationService", () => ({
  generateImageDraftFromHandoff: mocks.generateImageDraftFromHandoff,
  ImageHandoffError: class ImageHandoffError extends Error {
    constructor(public code: string, public status: number, message: string) {
      super(message);
    }
  },
  imageDraftSafeSummary: () => null,
}));

vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: vi.fn(),
}));

const taskId = "sandbox-task-existing-product";
const requestId = "550e8400-e29b-41d4-a716-446655440000";
const expectedStorageVersion = {
  resultJsonHash: "a".repeat(64),
  updatedAt: "2026-08-08T00:00:00.000Z",
};

function visitorRequest(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "visitor-token" },
    body: JSON.stringify(body),
  });
}

describe("existing Visitor product downstream quota contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: {
        mode: "demo",
        demoAccessId: "visitor-exhausted",
        remainingProducts: 0,
      },
    });
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "owner-only",
    });
  });

  it("allows Listing for an existing product without reserving another product slot", async () => {
    mocks.generateListingDraftFromHandoff.mockResolvedValue({
      listingStatus: "generated",
      currentHandoffRevision: 2,
      sourceHandoffRevision: 2,
      idempotentReplay: false,
      safeFallbackApplied: false,
      draft: { title: "Safe listing" },
    });
    const { POST } = await import("@/app/api/tasks/[id]/listing-handoff/route");
    const response = await POST(visitorRequest(`/api/tasks/${taskId}/listing-handoff`, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision: 2,
      confirmed: true,
    }) as never, { params: Promise.resolve({ id: taskId }) });

    expect(response.status).toBe(200);
    expect(mocks.generateListingDraftFromHandoff).toHaveBeenCalledOnce();
    expect(mocks.reserveDemoProductJourney).not.toHaveBeenCalled();
    expect(mocks.commitDemoProductJourney).not.toHaveBeenCalled();
    expect(mocks.releaseDemoProductJourney).not.toHaveBeenCalled();
  });

  it("forwards a valid listing brief separately and rejects unsupported claims before generation", async () => {
    mocks.generateListingDraftFromHandoff.mockResolvedValue({
      listingStatus: "generated",
      currentHandoffRevision: 2,
      sourceHandoffRevision: 2,
      idempotentReplay: false,
      safeFallbackApplied: false,
      draft: { title: "Safe listing" },
    });
    const { POST } = await import("@/app/api/tasks/[id]/listing-handoff/route");
    const accepted = await POST(visitorRequest(`/api/tasks/${taskId}/listing-handoff`, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision: 2,
      confirmed: true,
      listingBrief: {
        coreSellingPoint: "Covered straw for everyday carrying",
        targetAudience: "commuters",
      },
    }) as never, { params: Promise.resolve({ id: taskId }) });

    expect(accepted.status).toBe(200);
    expect(mocks.generateListingDraftFromHandoff).toHaveBeenCalledWith(taskId, expect.anything(), expect.objectContaining({
      listingBrief: {
        schema: "listing-creation-brief.v1",
        coreSellingPoint: "Covered straw for everyday carrying",
        targetAudience: "commuters",
      },
    }));

    vi.clearAllMocks();
    const rejected = await POST(visitorRequest(`/api/tasks/${taskId}/listing-handoff`, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision: 2,
      confirmed: true,
      listingBrief: { coreSellingPoint: "The best guaranteed bottle" },
    }) as never, { params: Promise.resolve({ id: taskId }) });

    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "listing_brief_unsupported_claim" } });
    expect(mocks.generateListingDraftFromHandoff).not.toHaveBeenCalled();
  });

  it("allows Image for an existing product without reserving another product slot", async () => {
    mocks.generateImageDraftFromHandoff.mockResolvedValue({
      imageStatus: "generated",
      currentHandoffRevision: 2,
      sourceHandoffRevision: 2,
      idempotentReplay: false,
      draft: { imageId: "image-1" },
    });
    const { POST } = await import("@/app/api/tasks/[id]/image-handoff/route");
    const response = await POST(visitorRequest(`/api/tasks/${taskId}/image-handoff`, {
      requestId,
      expectedStorageVersion,
      expectedHandoffRevision: 2,
      mode: "composition_concept",
      confirmed: true,
    }) as never, { params: Promise.resolve({ id: taskId }) });

    expect(response.status).toBe(200);
    expect(mocks.generateImageDraftFromHandoff).toHaveBeenCalledOnce();
    expect(mocks.reserveDemoProductJourney).not.toHaveBeenCalled();
    expect(mocks.commitDemoProductJourney).not.toHaveBeenCalled();
    expect(mocks.releaseDemoProductJourney).not.toHaveBeenCalled();
  });
});