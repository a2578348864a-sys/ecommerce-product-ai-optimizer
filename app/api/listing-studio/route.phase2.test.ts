import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  listingEnabled: true,
  visitorListingEnabled: true,
  generateRealStudioListing: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/realAiListingGate", () => ({
  isRealAiListingEnabled: () => mocks.listingEnabled,
  isRealAiVisitorListingEnabled: () => mocks.visitorListingEnabled,
}));

vi.mock("@/lib/server/studioListingService", () => ({
  generateRealStudioListing: mocks.generateRealStudioListing,
}));

const LISTING_PACK = {
  source: "real_ai_draft",
  version: 1,
  generatedAt: "2026-08-08T00:00:00.000Z",
  model: "mock-provider",
  humanReviewRequired: true,
  titles: ["Safe title"],
  bullets: ["Confirmed fact only"],
  description: "Draft for human review.",
  keywords: ["safe"],
  sellingPoints: ["Confirmed fact only"],
  riskNotes: ["Human review required."],
  complianceWarnings: ["Human review required."],
  blockedClaims: ["Military grade"],
  reviewChecklist: ["Review before publishing."],
};

function brief(overrides: Record<string, unknown> = {}) {
  return {
    briefVersion: "studio-creative-brief.v1",
    productName: "Foldable laptop stand",
    targetMarket: "US",
    confirmedFacts: ["Aluminium frame"],
    unverifiedFacts: ["Supports 20 kg"],
    prohibitedClaims: ["Military grade"],
    targetAudience: "Remote workers",
    tone: "professional",
    additionalRequirements: "Keep it concise.",
    factsConfirmed: true,
    humanReviewRequired: true,
    mode: "real",
    confirmRealAi: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/listing-studio/route");
  return POST(new NextRequest("http://localhost/api/listing-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "test" },
    body: JSON.stringify(body),
  }));
}

describe("Phase 2 POST /api/listing-studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner", token: "owner" } });
    mocks.generateRealStudioListing.mockResolvedValue({
      ok: true,
      data: LISTING_PACK,
      duplicate: false,
    });
  });

  it("rejects unconfirmed Manual facts before any provider service call", async () => {
    const response = await post(brief({ factsConfirmed: false }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("studio_brief_confirmation_required");
    expect(mocks.generateRealStudioListing).not.toHaveBeenCalled();
  });

  it("restores independent Real generation through the existing guarded/idempotent service", async () => {
    const idempotencyKey = randomUUID();
    const response = await post(brief({ idempotencyKey }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.meta).toMatchObject({ mode: "real", duplicate: false, saved: false });
    expect(json.data.listingPack.humanReviewRequired).toBe(true);
    expect(mocks.generateRealStudioListing).toHaveBeenCalledTimes(1);
    expect(mocks.generateRealStudioListing).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey,
      accessContext: expect.objectContaining({ mode: "owner" }),
      context: expect.objectContaining({
        studioPreferences: expect.objectContaining({
          confirmedFacts: ["Aluminium frame"],
          unverifiedFacts: ["Supports 20 kg"],
          prohibitedClaims: ["Military grade"],
          additionalRequirements: "Keep it concise.",
        }),
      }),
    }));
  });

  it("keeps Provider and Visitor gates in front of the existing service", async () => {
    mocks.listingEnabled = false;
    const disabled = await post(brief());
    expect(disabled.status).toBe(403);
    expect((await disabled.json()).error.code).toBe("real_ai_disabled");

    mocks.listingEnabled = true;
    mocks.visitorListingEnabled = false;
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", token: "visitor", demoAccessId: "visitor-a" },
    });
    const visitorDisabled = await post(brief());
    expect(visitorDisabled.status).toBe(403);
    expect((await visitorDisabled.json()).error.code).toBe("visitor_listing_generation_disabled");
    expect(mocks.generateRealStudioListing).not.toHaveBeenCalled();
  });

  it("does not accept forged Task or Candidate authority fields in Manual mode", async () => {
    for (const forged of [
      { taskId: "task-forged" },
      { candidateId: "candidate-forged" },
      { researchRevision: 99 },
    ]) {
      const response = await post(brief(forged));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("unsupported_request_field");
    }
    expect(mocks.generateRealStudioListing).not.toHaveBeenCalled();
  });
});
