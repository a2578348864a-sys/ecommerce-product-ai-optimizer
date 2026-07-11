import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loaded: null as any,
  generated: null as any,
  enabled: false,
  visitorEnabled: false,
}));

vi.mock("@/lib/server/aiImageTaskAccess", () => ({
  loadAiImageTask: vi.fn(async () => mocks.loaded),
}));
vi.mock("@/lib/server/aiImageDraftService", () => ({
  generateAiImageDraft: vi.fn(async () => mocks.generated),
}));
vi.mock("@/lib/server/realAiImageGate", () => ({
  isRealAiImageEnabled: () => mocks.enabled,
  isRealAiVisitorImageEnabled: () => mocks.visitorEnabled,
}));
vi.mock("@/lib/server/demoGuard", () => ({
  getLatestDemoSnapshot: () => ({ maxAiCalls: 5, usedAiCalls: 2, remainingAiCalls: 3 }),
}));

import { generateAiImageDraft } from "@/lib/server/aiImageDraftService";
import { GET, POST } from "@/app/api/tasks/[id]/image-draft/route";

const ownerTask = {
  taskId: "task-1",
  accessMode: "owner",
  accessContext: { mode: "owner", token: "owner-token" },
  task: { title: "Product", materialText: "Material", level: "low", oneLineSummary: "Summary", resultJson: "{}" },
  persistResult: async () => {},
};

function post(body: unknown) {
  const request = new Request("http://localhost/api/tasks/task-1/image-draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request as any, { params: Promise.resolve({ id: "task-1" }) });
}

describe("task image draft API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = false;
    mocks.visitorEnabled = false;
    mocks.loaded = { ok: true, data: ownerTask };
    mocks.generated = { ok: true, data: { snapshot: null, items: [], duplicate: false, visitorAccess: null } };
  });

  it("returns controlled metadata without enabling the provider by default", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/task-1/image-draft") as any, { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, data: { enabled: false, accessMode: "owner", maxCount: 2, snapshot: null } });
  });

  it.each([
    ["model", "client-model"],
    ["maxRetries", 2],
    ["retry", true],
  ])("rejects unsupported client field %s before service execution", async (field, value) => {
    const response = await post({ imageType: "white_background_concept", count: 1, confirmed: true, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", [field]: value });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "unsupported_request_field" } });
    expect(generateAiImageDraft).not.toHaveBeenCalled();
  });

  it("enforces visitor count and exposes only visitor mode plus the shared counter", async () => {
    mocks.visitorEnabled = true;
    mocks.loaded = { ok: true, data: { ...ownerTask, accessMode: "visitor", visitorAccessId: "visitor-1", accessContext: { mode: "demo", demoAccessId: "visitor-1" } } };
    const blocked = await post({ imageType: "white_background_concept", count: 2, confirmed: true, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ ok: false, error: { code: "visitor_image_count_limited" } });

    const metadata = await GET(new Request("http://localhost/api/tasks/task-1/image-draft") as any, { params: Promise.resolve({ id: "task-1" }) });
    expect(await metadata.json()).toMatchObject({ ok: true, data: { accessMode: "visitor", maxCount: 1, visitorAccess: { remainingAiCalls: 3 } } });
  });

  it("passes a valid confirmed request to the service and maps provider errors", async () => {
    const body = { imageType: "lifestyle_scene", count: 2, additionalDirection: "side view", confirmed: true, idempotencyKey: "123e4567-e89b-42d3-a456-426614174000" };
    expect((await post(body)).status).toBe(200);
    expect(generateAiImageDraft).toHaveBeenCalledOnce();
    mocks.generated = { ok: false, error: { code: "image_provider_rate_limited", message: "繁忙", retryable: true } };
    expect((await post({ ...body, idempotencyKey: "123e4567-e89b-42d3-a456-426614174001" })).status).toBe(429);
    mocks.generated = { ok: false, error: { code: "image_request_conflict", message: "冲突", retryable: false } };
    expect((await post({ ...body, idempotencyKey: "123e4567-e89b-42d3-a456-426614174002" })).status).toBe(409);
  });

  it("returns authentication and expiry errors from the server-side task loader", async () => {
    mocks.loaded = { ok: false, status: 401, code: "unauthorized", message: "请先解锁。" };
    expect((await post({})).status).toBe(401);
    mocks.loaded = { ok: false, status: 403, code: "visitor_access_expired", message: "访问已过期。" };
    const response = await GET(new Request("http://localhost") as any, { params: Promise.resolve({ id: "task-1" }) });
    expect(response.status).toBe(403);
  });
});
