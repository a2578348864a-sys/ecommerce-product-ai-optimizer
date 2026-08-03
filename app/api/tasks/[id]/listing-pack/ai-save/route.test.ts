import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMockAiListingDraft } from "@/lib/aiListingDraft";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { viralAnalysisRecord: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  mutateSandboxTaskAtomic: vi.fn(),
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(() => { throw new Error("real AI must not be called"); }),
  callAiText: vi.fn(() => { throw new Error("real AI must not be called"); }),
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

function snapshot(resultJson: string) {
  return {
    id: "task-1",
    type: "workflow",
    updatedAt: new Date("2026-08-03T03:00:00.000Z"),
    resultJson,
    decisionStatus: "continue",
  };
}

async function callPOST(taskId: string, body: unknown = {}) {
  const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-save/route");
  return POST(new Request(`http://localhost/api/tasks/${taskId}/listing-pack/ai-save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
    body: JSON.stringify(body),
  }) as never, { params: Promise.resolve({ id: taskId }) });
}

describe("POST /api/tasks/[id]/listing-pack/ai-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.findUnique.mockResolvedValue(snapshot(JSON.stringify({
      existingField: "keep-me",
      listingPackSnapshot: { source: "rule_based" },
      riskReviewSnapshot: { ok: true },
    })));
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("rejects unauthenticated and cross-role writes before storage", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({ ok: false, status: 401, code: "invalid_access", message: "bad auth" });
    expect((await callPOST("task-1", { listingPack: draft() })).status).toBe(401);
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "demo", demoAccessId: "visitor" } });
    mocks.requireOwnerOnly.mockReturnValue({ ok: false, status: 403, code: "demo_action_forbidden", message: "blocked" });
    expect((await callPOST("task-1", { listingPack: draft() })).status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("returns task_not_found when the task does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);
    const res = await callPOST("missing-task", { listingPack: draft() });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("task_not_found");
  });

  it("returns invalid_ai_listing_pack without writing", async () => {
    const res = await callPOST("task-1", { listingPack: { ...draft(), titles: "bad" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_ai_listing_pack");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("saves only aiListingPackSnapshot and preserves unknown namespaces", async () => {
    const res = await callPOST("task-1", { listingPack: draft() });
    const data = await res.json();
    const call = mocks.updateMany.mock.calls[0][0] as { data: { resultJson: string } };
    const merged = JSON.parse(call.data.resultJson);
    expect(res.status).toBe(200);
    expect(data.data.aiListingPackSnapshot).toMatchObject({
      snapshotType: "ai_listing_pack",
      savedBy: "owner",
      humanReviewRequired: true,
    });
    expect(merged.existingField).toBe("keep-me");
    expect(merged.listingPackSnapshot).toEqual({ source: "rule_based" });
    expect(merged.riskReviewSnapshot).toEqual({ ok: true });
  });

  it("blocks overwrite unless explicitly requested and increments version", async () => {
    mocks.findUnique.mockResolvedValue(snapshot(JSON.stringify({ aiListingPackSnapshot: { version: 2 } })));
    const blocked = await callPOST("task-1", { listingPack: draft(), overwrite: false });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("ai_listing_pack_already_exists");
    expect(mocks.updateMany).not.toHaveBeenCalled();

    const allowed = await callPOST("task-1", { listingPack: draft(), overwrite: true });
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).data.version).toBe(3);
  });

  it("filters banned claims before CAS persistence", async () => {
    const res = await callPOST("task-1", {
      listingPack: draft({
        titles: ["FDA Approved Desktop Phone Stand"],
        bullets: ["100% Safe Medical Grade desktop accessory."],
      }),
    });
    const call = mocks.updateMany.mock.calls[0][0] as { data: { resultJson: string } };
    const saved = JSON.parse(call.data.resultJson).aiListingPackSnapshot;
    const visible = [...saved.titles, ...saved.bullets, saved.description].join(" ");
    expect(res.status).toBe(200);
    expect(visible).not.toMatch(/FDA Approved|100% Safe|Medical Grade/);
    expect(saved.blockedClaims).toEqual(expect.arrayContaining(["FDA Approved", "100% Safe", "Medical Grade"]));
  });

  it("returns 409 when storage CAS loses a race", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const res = await callPOST("task-1", { listingPack: draft() });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("task_result_conflict");
  });

  it("returns ai_listing_save_failed for unexpected storage failure", async () => {
    mocks.updateMany.mockRejectedValue(new Error("db failed"));
    const res = await callPOST("task-1", { listingPack: draft() });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("ai_listing_save_failed");
  });

  it("returns invalid_json for malformed body", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-save/route");
    const res = await POST(new Request("http://localhost/api/tasks/task-1/listing-pack/ai-save", {
      method: "POST",
      body: "{bad",
    }) as never, { params: Promise.resolve({ id: "task-1" }) });
    expect(res.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
