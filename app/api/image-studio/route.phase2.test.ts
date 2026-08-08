import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  imageEnabled: true,
  visitorImageEnabled: true,
  generateMockStudioImage: vi.fn(),
  generateRealStudioImage: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({ requireAuthenticated: mocks.requireAuthenticated }));
vi.mock("@/lib/server/realAiImageGate", () => ({
  isRealAiImageEnabled: () => mocks.imageEnabled,
  isRealAiVisitorImageEnabled: () => mocks.visitorImageEnabled,
}));
vi.mock("@/lib/server/studioImageGenerator", () => ({
  generateMockStudioImage: mocks.generateMockStudioImage,
  generateRealStudioImage: mocks.generateRealStudioImage,
}));

const VALID_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function brief(overrides: Record<string, unknown> = {}) {
  return {
    briefVersion: "studio-creative-brief.v1",
    factsConfirmed: true,
    humanReviewRequired: true,
    creationMode: "guided",
    productName: "Insulated bottle",
    description: "Matte blue bottle with handle.",
    imageType: "product_main",
    visualStyle: "minimal",
    aspectRatio: "square_1_1",
    count: 2,
    compositionRequirements: "Centered with soft shadow",
    prohibitedElements: "No added logo",
    mode: "real",
    confirmRealAi: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/image-studio/route");
  return POST(new NextRequest("http://localhost/api/image-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "test" },
    body: JSON.stringify(body),
  }));
}

describe("Phase 2 POST /api/image-studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imageEnabled = true;
    mocks.visitorImageEnabled = true;
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner", token: "owner" } });
    mocks.generateRealStudioImage.mockResolvedValue({
      ok: true,
      images: [
        { base64: `data:image/png;base64,${VALID_PNG}`, width: 1, height: 1 },
        { base64: `data:image/png;base64,${VALID_PNG}`, width: 1, height: 1 },
      ],
      meta: {
        mode: "real",
        creationMode: "guided",
        visualAuthority: "composition_concept",
        duplicate: false,
        input: {},
        qualityCheck: { humanReviewRequired: true },
      },
    });
  });

  it("rejects unconfirmed Manual facts before generation", async () => {
    const response = await post(brief({ factsConfirmed: false }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("studio_brief_confirmation_required");
    expect(mocks.generateRealStudioImage).not.toHaveBeenCalled();
  });

  it("restores independent Real generation through the existing guarded service with two candidates", async () => {
    const response = await post(brief());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.images).toHaveLength(2);
    expect(mocks.generateRealStudioImage).toHaveBeenCalledWith(expect.objectContaining({
      accessContext: expect.objectContaining({ mode: "owner" }),
      studio: expect.objectContaining({ visualAuthority: "composition_concept", count: 2 }),
      request: expect.objectContaining({ count: 2, confirmed: true }),
    }));
  });

  it("fully validates an uploaded reference and marks product-visual authority", async () => {
    const response = await post(brief({
      referenceImageDataUrl: `data:image/png;base64,${VALID_PNG}`,
      referenceImageApproved: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.generateRealStudioImage).toHaveBeenCalledWith(expect.objectContaining({
      studio: expect.objectContaining({
        visualAuthority: "product_visual_draft",
        referenceImageApproved: true,
      }),
    }));
  });

  it("rejects MIME spoofing before any generation service call", async () => {
    const response = await post(brief({
      referenceImageDataUrl: `data:image/jpeg;base64,${VALID_PNG}`,
      referenceImageApproved: true,
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_reference_image");
    expect(mocks.generateRealStudioImage).not.toHaveBeenCalled();
  });

  it("keeps global and Visitor image gates in front of the service", async () => {
    mocks.imageEnabled = false;
    const disabled = await post(brief());
    expect(disabled.status).toBe(403);
    expect((await disabled.json()).error.code).toBe("real_ai_disabled");

    mocks.imageEnabled = true;
    mocks.visitorImageEnabled = false;
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", token: "visitor", demoAccessId: "visitor-a" },
    });
    const visitorDisabled = await post(brief({ count: 1 }));
    expect(visitorDisabled.status).toBe(403);
    expect((await visitorDisabled.json()).error.code).toBe("visitor_image_generation_disabled");
    expect(mocks.generateRealStudioImage).not.toHaveBeenCalled();
  });

  it("does not accept forged Task, Candidate, revision, or selection authority", async () => {
    for (const forged of [
      { taskId: "task-forged" },
      { candidateId: "candidate-forged" },
      { researchRevision: 99 },
      { selectedImageId: "image-forged" },
    ]) {
      const response = await post(brief(forged));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("unsupported_request_field");
    }
    expect(mocks.generateRealStudioImage).not.toHaveBeenCalled();
  });
});
