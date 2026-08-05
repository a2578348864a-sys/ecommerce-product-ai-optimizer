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
}));
vi.mock("@/lib/server/demoSandboxTaskMutation.internal", () => ({
  mutateSandboxTaskResultJsonInternal: vi.fn(),
}));

// PR2-2 Final-Fix (BLOCKER-1): 默认 gate 返回有效 binding（模拟已通过新流程保存过的任务）
const gateState = vi.hoisted(() => ({
  hasBinding: true,
  binding: {
    schema: "listing-handoff-binding.v1",
    sourceHandoffId: "handoff-1",
    sourceHandoffRevision: 1,
    sourceHandoffFingerprintHash: "a".repeat(64),
    sourceResearchRevision: 1,
    generationInputFingerprint: "b".repeat(64),
    generatedAt: "2026-08-05T00:00:00.000Z",
    model: "mock-listing-provider-v1",
    generationSource: "creative_handoff",
    humanReviewRequired: true,
    requestIdHash: "c".repeat(64),
  },
}));

vi.mock("@/lib/server/productCreativeHandoffPreview", () => ({
  checkCreativeHandoffGate: vi.fn(async () => ({
    allowed: true,
    reason: "eligible",
    currentHandoff: {
      schema: "product-creative-handoff.v1",
      handoffId: "handoff-1",
      controlState: "active",
      currentRevision: 1,
      versions: [{ revision: 1 }],
    },
    listingHandoffBindingRaw: gateState.hasBinding ? gateState.binding : undefined,
  })),
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

  // ── PR2-2 Final-Fix (BLOCKER-1): 旧路径封堵测试 ──

  it("rejects ai-save when no Handoff binding exists — legacy draft cannot be saved via old path", async () => {
    gateState.hasBinding = false;
    try {
      const res = await callPOST("task-1", { listingPack: draft() });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("handoff_required");
      expect(mocks.updateMany).not.toHaveBeenCalled();
    } finally {
      gateState.hasBinding = true;
    }
  });

  it("rejects ai-save when binding is malformed — fail-closed", async () => {
    gateState.hasBinding = true;
    gateState.binding = { schema: "listing-handoff-binding.v1", broken: true } as never;
    try {
      const res = await callPOST("task-1", { listingPack: draft() });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("handoff_required");
      expect(mocks.updateMany).not.toHaveBeenCalled();
    } finally {
      gateState.binding = {
        schema: "listing-handoff-binding.v1",
        sourceHandoffId: "handoff-1",
        sourceHandoffRevision: 1,
        sourceHandoffFingerprintHash: "a".repeat(64),
        sourceResearchRevision: 1,
        generationInputFingerprint: "b".repeat(64),
        generatedAt: "2026-08-05T00:00:00.000Z",
        model: "mock-listing-provider-v1",
        generationSource: "creative_handoff",
        humanReviewRequired: true,
        requestIdHash: "c".repeat(64),
      };
    }
  });

  it("old ai-save cannot overwrite a handoff-bound draft with unbound content", async () => {
    // 即使 overwrite=true，旧路径保存的内容来自无 Handoff 请求体；
    // 服务端以 binding 存在为保存前提（内容绑定关系由新流程保证）。
    mocks.findUnique.mockResolvedValue(snapshot(JSON.stringify({ listingHandoffBinding: gateState.binding })));
    const res = await callPOST("task-1", { listingPack: draft(), overwrite: true });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.aiListingPackSnapshot.snapshotType).toBe("ai_listing_pack");
    const call = mocks.updateMany.mock.calls[0][0] as { data: { resultJson: string } };
    const merged = JSON.parse(call.data.resultJson);
    expect(merged.listingHandoffBinding).toBeDefined();
  });
});
