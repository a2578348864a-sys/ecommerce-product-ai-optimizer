import { describe, expect, it, beforeEach, vi } from "vitest";
import { buildMockAiListingDraft } from "@/lib/aiListingDraft";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  requireOwnerOnly: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  getSandboxTask: () => null,
  updateSandboxTask: () => null,
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(() => {
    throw new Error("callAiJson must not be called in Core-4-AI.4");
  }),
  callAiText: vi.fn(() => {
    throw new Error("callAiText must not be called in Core-4-AI.4");
  }),
}));

function draft(overrides: Record<string, unknown> = {}) {
  return {
    ...buildMockAiListingDraft({
      productName: "Desktop Phone Stand",
      category: "phone accessory",
      sellingPoints: ["Adjustable angle", "Compact desktop use"],
    }),
    ...overrides,
  };
}

async function callPOST(taskId: string, body: unknown = {}) {
  const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-save/route");
  const req = new Request(`http://localhost/api/tasks/${taskId}/listing-pack/ai-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
    body: JSON.stringify(body),
  });
  return POST(req as any, { params: Promise.resolve({ id: taskId }) });
}

describe("POST /api/tasks/[id]/listing-pack/ai-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.findUnique.mockResolvedValue({
      resultJson: JSON.stringify({
        existingField: "keep-me",
        listingPackSnapshot: { source: "rule_based" },
        riskReviewSnapshot: { ok: true },
      }),
    });
    mocks.update.mockResolvedValue({ id: "task-1" });
  });

  it("returns 401 unauthorized when owner auth fails", async () => {
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "bad auth",
    });

    const res = await callPOST("task-1", { listingPack: draft() });
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("unauthorized");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns task_not_found when task does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await callPOST("missing-task", { listingPack: draft() });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("task_not_found");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns invalid_ai_listing_pack for invalid listingPack", async () => {
    const res = await callPOST("task-1", { listingPack: { ...draft(), titles: "bad" } });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("invalid_ai_listing_pack");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("saves aiListingPackSnapshot while preserving resultJson fields and listingPackSnapshot", async () => {
    const res = await callPOST("task-1", { listingPack: draft() });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.saved).toBe(true);
    expect(data.data.aiListingPackSnapshot.snapshotType).toBe("ai_listing_pack");
    expect(data.data.aiListingPackSnapshot.savedBy).toBe("owner");
    expect(data.data.aiListingPackSnapshot.humanReviewRequired).toBe(true);
    expect(mocks.update).toHaveBeenCalledTimes(1);

    const updateArg = mocks.update.mock.calls[0][0];
    const merged = JSON.parse(updateArg.data.resultJson);
    expect(merged.existingField).toBe("keep-me");
    expect(merged.listingPackSnapshot).toEqual({ source: "rule_based" });
    expect(merged.riskReviewSnapshot).toEqual({ ok: true });
    expect(merged.aiListingPackSnapshot.snapshotType).toBe("ai_listing_pack");
  });

  it("blocks overwrite when aiListingPackSnapshot exists and overwrite is false", async () => {
    mocks.findUnique.mockResolvedValue({
      resultJson: JSON.stringify({ aiListingPackSnapshot: { version: 1 } }),
    });

    const res = await callPOST("task-1", { listingPack: draft(), overwrite: false });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_listing_pack_already_exists");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows explicit overwrite and increments version", async () => {
    mocks.findUnique.mockResolvedValue({
      resultJson: JSON.stringify({ aiListingPackSnapshot: { version: 2 } }),
    });

    const res = await callPOST("task-1", { listingPack: draft(), overwrite: true });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.version).toBe(3);
    const merged = JSON.parse(mocks.update.mock.calls[0][0].data.resultJson);
    expect(merged.aiListingPackSnapshot.version).toBe(3);
  });

  it("filters banned claims before saving", async () => {
    const res = await callPOST("task-1", {
      listingPack: draft({
        titles: ["FDA Approved Desktop Phone Stand"],
        bullets: ["100% Safe Medical Grade desktop accessory."],
      }),
    });
    const data = await res.json();
    const merged = JSON.parse(mocks.update.mock.calls[0][0].data.resultJson);
    const saved = merged.aiListingPackSnapshot;
    const visible = [
      ...saved.titles,
      ...saved.bullets,
      saved.description,
      ...saved.keywords,
      ...saved.sellingPoints,
    ].join(" ");

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(visible).not.toMatch(/FDA Approved|100% Safe|Medical Grade|稳赚|爆款必出|保证盈利/);
    expect(saved.blockedClaims).toEqual(expect.arrayContaining(["FDA Approved", "100% Safe", "Medical Grade"]));
  });

  it("returns ai_listing_save_failed when prisma update fails", async () => {
    mocks.update.mockRejectedValue(new Error("db failed"));

    const res = await callPOST("task-1", { listingPack: draft() });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_listing_save_failed");
  });

  it("returns invalid_json for malformed body", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-save/route");
    const req = new Request("http://localhost/api/tasks/task-1/listing-pack/ai-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad",
    });

    const res = await POST(req as any, { params: Promise.resolve({ id: "task-1" }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("invalid_json");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
