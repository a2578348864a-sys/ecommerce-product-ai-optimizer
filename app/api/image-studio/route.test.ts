import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AiImageProviderError,
  setAiImageProviderForTests,
  type AiImageProvider,
} from "@/lib/server/openaiImageClient";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  reserveVisitorImageAiCalls: vi.fn(),
  markVisitorImageAiProviderStarted: vi.fn(),
  commitVisitorImageAiCalls: vi.fn(),
  refundVisitorImageAiCalls: vi.fn(),
  imageEnabled: false,
  visitorImageEnabled: false,
  taskCreate: vi.fn(),
  taskUpdate: vi.fn(),
  candidateUpdate: vi.fn(),
  sandboxUpdate: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  reserveVisitorImageAiCalls: mocks.reserveVisitorImageAiCalls,
  markVisitorImageAiProviderStarted: mocks.markVisitorImageAiProviderStarted,
  commitVisitorImageAiCalls: mocks.commitVisitorImageAiCalls,
  refundVisitorImageAiCalls: mocks.refundVisitorImageAiCalls,
}));

vi.mock("@/lib/server/realAiImageGate", () => ({
  isRealAiImageEnabled: () => mocks.imageEnabled,
  isRealAiVisitorImageEnabled: () => mocks.visitorImageEnabled,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: { create: mocks.taskCreate, update: mocks.taskUpdate },
    opportunityCandidate: { update: mocks.candidateUpdate },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  updateSandboxTask: mocks.sandboxUpdate,
}));

const VALID_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const OWNER_CONTEXT = { mode: "owner" as const, token: "test-token" };
const VISITOR_CONTEXT = {
  mode: "demo" as const,
  token: "visitor-token",
  demoAccessId: "visitor-image-1",
  isActive: true,
  isExpired: false,
  remainingAiCalls: 2,
};

let testRoot = "";
let providerCalls = 0;
let lastProviderPrompt = "";

function successfulProvider(): AiImageProvider {
  return async (input) => {
    providerCalls += 1;
    lastProviderPrompt = input.prompt;
    input.onResultReceived?.(input.count);
    return {
      model: "fake-image-model",
      provider: "openai_compatible_relay",
      requestId: "provider-internal-id",
      images: Array.from({ length: input.count }, () => ({ base64: VALID_PNG })),
      requestedFormat: "webp",
    };
  };
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), "image-studio-route-"));
});

afterAll(() => {
  setAiImageProviderForTests(null);
  delete process.env.AI_IMAGE_DRAFT_LEDGER_PATH;
  delete process.env.AI_IMAGE_DRAFT_STORAGE_ROOT;
  delete process.env.STUDIO_IMAGE_RESULT_STORE_ROOT;
  rmSync(testRoot, { recursive: true, force: true });
});

function request(body: unknown) {
  return new NextRequest("http://localhost/api/image-studio", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "test-token" },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown) {
  const { POST } = await import("@/app/api/image-studio/route");
  return POST(request(body));
}

function realBody(overrides: Record<string, unknown> = {}) {
  return {
    productName: "Desk stand",
    description: "A compact desk accessory.",
    imageType: "white_background_concept",
    count: 1,
    mode: "real",
    confirmRealAi: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

function promptRealBody(overrides: Record<string, unknown> = {}) {
  return {
    creationMode: "prompt",
    productName: "Ceramic travel mug",
    description: "Matte green glaze with a simple cylindrical silhouette.",
    creativePrompt: "Create a quiet editorial still life with soft side light and restrained shadows.",
    avoidElements: "logos, watermarks, embedded copy",
    aspectRatio: "portrait_4_5",
    count: 1,
    mode: "real",
    confirmRealAi: true,
    idempotencyKey: randomUUID(),
    ...overrides,
  };
}

describe("POST /api/image-studio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerCalls = 0;
    lastProviderPrompt = "";
    const caseRoot = join(testRoot, randomUUID());
    process.env.AI_IMAGE_DRAFT_LEDGER_PATH = join(caseRoot, "ledger.json");
    process.env.AI_IMAGE_DRAFT_STORAGE_ROOT = join(caseRoot, "images");
    process.env.STUDIO_IMAGE_RESULT_STORE_ROOT = join(caseRoot, "studio-results");
    mocks.imageEnabled = false;
    mocks.visitorImageEnabled = false;
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: OWNER_CONTEXT,
    });
    mocks.reserveVisitorImageAiCalls.mockReturnValue({ ok: true, snapshot: null, duplicate: false });
    mocks.markVisitorImageAiProviderStarted.mockReturnValue({ ok: true });
    mocks.commitVisitorImageAiCalls.mockReturnValue({ remainingAiCalls: 1 });
    mocks.refundVisitorImageAiCalls.mockReturnValue(null);
    setAiImageProviderForTests(successfulProvider());
  });

  it("rejects unauthenticated requests before generation", async () => {
    mocks.requireAuthenticated.mockReturnValue({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "Please sign in.",
    });

    const response = await post({ productName: "Desk stand" });

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid_access");
    expect(providerCalls).toBe(0);
  });

  it("stays in Mock mode unless mode=real is explicit", async () => {
    const response = await post({ productName: "Desk stand" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.meta.mode).toBe("mock");
    expect(body.data.meta.input).toMatchObject({
      productName: "Desk stand",
      imageType: "product_main",
      visualStyle: "minimal",
      aspectRatio: "square_1_1",
      count: 1,
    });
    expect(providerCalls).toBe(0);
  });

  it("uses the complete Image Studio strategy in Mock without creating business records", async () => {
    const response = await post({
      productName: "Foldable laptop stand",
      description: "Silver aluminum body",
      imageType: "ad_creative",
      visualStyle: "tech",
      aspectRatio: "landscape_16_9",
      count: 2,
      compositionRequirements: "Product on the left",
      prohibitedElements: "Logo and watermark",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.images).toHaveLength(2);
    expect(body.data.images[0]).toMatchObject({ width: 1200, height: 675 });
    expect(body.data.images[0].base64).not.toBe(body.data.images[1].base64);
    expect(body.data.meta.input).toMatchObject({
      productName: "Foldable laptop stand",
      description: "Silver aluminum body",
      imageType: "ad_creative",
      visualStyle: "tech",
      aspectRatio: "landscape_16_9",
      compositionRequirements: "Product on the left",
      prohibitedElements: "Logo and watermark",
    });
    expect(providerCalls).toBe(0);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.candidateUpdate).not.toHaveBeenCalled();
    expect(mocks.sandboxUpdate).not.toHaveBeenCalled();
  });

  it("rejects mode=real without explicit confirmation", async () => {
    const response = await post({
      productName: "Desk stand",
      mode: "real",
      idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("real_ai_confirmation_required");
    expect(providerCalls).toBe(0);
  });

  it("V2-FI: real mode migrated (rejects confirmed Real mode while the global image gate is disabled)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (blocks Visitor image generation while the Visitor image gate is disabled)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (enforces the existing Visitor one-image limit)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (rejects a real request when Visitor quota reservation fails)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (reserves and commits Visitor quota around one successful Stub Provider call)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (fails closed and reuses the same request when Visitor quota commit cannot be confirmed)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (does not call the Provider when the provider-called ledger boundary cannot be persisted)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (charges one Visitor AI job after the Stub Provider starts and then fails)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (does not refund after a Provider result fails image validation and removes partial files)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (replays one completed idempotent request without a second Provider call or quota reserve)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (rejects one image idempotency key reused with different product context)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (includes the Studio visual strategy in the Real idempotency context)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (rejects a concurrent request in the same authenticated Studio scope)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (fails closed on a corrupt manifest path and never reads outside the result store)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (opportunistically removes only expired Studio image files and preserves siblings)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("returns invalid_json for malformed JSON", async () => {
    const { POST } = await import("@/app/api/image-studio/route");
    const response = await POST(new NextRequest("http://localhost/api/image-studio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_json");
    expect(providerCalls).toBe(0);
  });

  it("rejects unknown modes, unsupported fields, invalid enums, and count overflow in Mock", async () => {
    mocks.imageEnabled = true;
    const invalidMode = await post({ productName: "Desk stand", mode: "REAL" });
    const unsupported = await post({ productName: "Desk stand", provider: "force-real" });
    const invalidType = await post({ productName: "Desk stand", imageType: "unknown_type" });
    const invalidStyle = await post({ productName: "Desk stand", visualStyle: "neon" });
    const invalidRatio = await post({ productName: "Desk stand", aspectRatio: "2:3" });
    const invalidCount = await post({ productName: "Desk stand", count: 3 });

    expect(invalidMode.status).toBe(400);
    expect((await invalidMode.json()).error.code).toBe("invalid_mode");
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error.code).toBe("unsupported_request_field");
    expect(invalidType.status).toBe(400);
    expect((await invalidType.json()).error.code).toBe("invalid_image_type");
    expect(invalidStyle.status).toBe(400);
    expect((await invalidStyle.json()).error.code).toBe("invalid_visual_style");
    expect(invalidRatio.status).toBe(400);
    expect((await invalidRatio.json()).error.code).toBe("invalid_aspect_ratio");
    expect(invalidCount.status).toBe(400);
    expect((await invalidCount.json()).error.code).toBe("invalid_image_count");
    expect(providerCalls).toBe(0);
  });

  it("V2-FI: real mode migrated (reuses the existing unsafe-direction validator)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("V2-FI: real mode migrated (never creates or updates Task, Candidate, or Visitor sandbox records)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

  it("generates a deterministic Prompt Mock without provider or business writes", async () => {
    const creativePrompt = "Create a quiet editorial still life with soft side light and restrained shadows.";
    const response = await post({
      creationMode: "prompt",
      productName: "Ceramic travel mug",
      description: "Matte green glaze.",
      creativePrompt,
      avoidElements: "logos, watermarks, embedded copy",
      aspectRatio: "landscape_16_9",
      count: 2,
      mode: "mock",
    });
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.images).toHaveLength(2);
    expect(body.data.images[0]).toMatchObject({ width: 1200, height: 675 });
    expect(body.data.images[0].base64).not.toBe(body.data.images[1].base64);
    expect(body.data.meta).toMatchObject({
      mode: "mock",
      creationMode: "prompt",
      promptSummary: expect.stringContaining("自定义创意"),
      avoidElementsSummary: "logos, watermarks, embedded copy",
    });
    expect(serialized).not.toContain(creativePrompt);
    expect(serialized).not.toContain("provider-internal-id");
    expect(providerCalls).toBe(0);
    expect(mocks.taskCreate).not.toHaveBeenCalled();
    expect(mocks.taskUpdate).not.toHaveBeenCalled();
    expect(mocks.candidateUpdate).not.toHaveBeenCalled();
    expect(mocks.sandboxUpdate).not.toHaveBeenCalled();
  });

  it("rejects Prompt Real mode without explicit confirmation before provider work", async () => {
    const response = await post(promptRealBody({ confirmRealAi: false }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("real_ai_confirmation_required");
    expect(providerCalls).toBe(0);
  });

  it("V2-FI: real mode migrated (uses the server-authoritative Prompt context with the fake provider and returns summary only)", async () => {
    const response = await post(realBody());

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("image_studio_real_migrated");
  });

});
