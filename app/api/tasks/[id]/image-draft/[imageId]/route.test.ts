import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ loaded: null as any }));
vi.mock("@/lib/server/aiImageTaskAccess", () => ({ loadAiImageTask: vi.fn(async () => state.loaded) }));
vi.mock("@/lib/server/aiImageDraftStorage", () => ({ readAiImage: vi.fn(async () => Buffer.from("image-bytes")) }));

import { readAiImage } from "@/lib/server/aiImageDraftStorage";
import { GET } from "@/app/api/tasks/[id]/image-draft/[imageId]/route";

const imageId = "123e4567-e89b-42d3-a456-426614174001";
const item = {
  id: imageId,
  imageType: "white_background_concept",
  model: "mock-image-v2",
  createdAt: "2026-07-10T00:00:00.000Z",
  storageKey: `owner/task-1/${imageId}.png`,
  mimeType: "image/png",
  width: 1,
  height: 1,
  fileSizeBytes: 11,
  sha256: "a".repeat(64),
  reviewStatus: "needs_human_review",
  accessMode: "owner",
  source: "real_ai_image_draft",
  safetyWarnings: [],
  promptHash: "b".repeat(64),
  requestKeyHash: "c".repeat(64),
  generationBasis: { productName: "Product", sellingPoints: [], riskWarnings: [], missingFacts: [], imageMaterialNeeds: [] },
};

function loaded(accessMode: "owner" | "visitor" = "owner") {
  return {
    ok: true,
    data: {
      taskId: "task-1",
      accessMode,
      accessContext: accessMode === "owner" ? { mode: "owner" } : { mode: "demo", demoAccessId: "visitor-1" },
      task: {
        title: "Product", materialText: "Material", level: "low", oneLineSummary: "Summary",
        resultJson: JSON.stringify({ aiImageDraftSnapshot: { version: 1, snapshotType: "ai_image_draft", provider: "openai", accessMode: "owner", humanReviewRequired: true, disclaimer: "review", updatedAt: "2026-07-10T00:00:00.000Z", items: [item] } }),
      },
      persistResult: async () => {},
    },
  };
}

function get(id = imageId) {
  return GET(new Request("http://localhost") as any, { params: Promise.resolve({ id: "task-1", imageId: id }) });
}

describe("private image GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.loaded = loaded();
  });

  it("returns only a task-owned image with private no-store headers and correct MIME", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(readAiImage).toHaveBeenCalledWith(item.storageKey);
  });

  it("does not use an arbitrary image id as a storage path", async () => {
    const response = await get("123e4567-e89b-42d3-a456-426614174999");
    expect(response.status).toBe(404);
    expect(readAiImage).not.toHaveBeenCalled();
  });

  it("prevents visitor access to an owner snapshot and propagates authentication failure", async () => {
    state.loaded = loaded("visitor");
    expect((await get()).status).toBe(404);
    expect(readAiImage).not.toHaveBeenCalled();
    state.loaded = { ok: false, status: 401, code: "unauthorized", message: "请先解锁。" };
    expect((await get()).status).toBe(401);
  });
});
