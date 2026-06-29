import { describe, expect, it, beforeEach, vi } from "vitest";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";
import { setRealAiListingEnabledForTests } from "@/lib/server/realAiListingGate";
import { setRealAiListingClientForTests } from "@/lib/server/aiListingGenerator";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  callAiJson: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
      delete: mocks.delete,
    },
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
  ensureDemoAiQuota: vi.fn(() => ({ ok: true })),
  consumeDemoAiCalls: vi.fn(() => null),
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  getSandboxTask: () => null,
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: mocks.callAiJson,
}));

mocks.callAiJson.mockImplementation(() => {
    throw new Error("callAiJson must not be called in Core-4-AI.2");
});

const TASK_RECORD = {
  title: "Desktop Phone Stand",
  materialText: "Desktop Phone Stand source text",
  level: "yellow",
  oneLineSummary: "Good candidate after manual review.",
  resultJson: JSON.stringify({
    productName: "Desktop Phone Stand",
    finalReport: {
      finalVerdict: "Can test small batch after manual review.",
      riskLevel: "yellow",
      sellingPoints: ["Adjustable angle", "FDA Approved premium material"],
    },
    sourceMeta: { category: "phone accessory" },
    listingPackSnapshot: {
      pack: {
        sellingPoints: ["Compact desktop use"],
      },
    },
  }),
};

async function callPOST(taskId: string, body: unknown = {}) {
  const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-generate/route");
  const req = new Request(`http://localhost/api/tasks/${taskId}/listing-pack/ai-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
    body: JSON.stringify(body),
  });
  return POST(req as any, { params: Promise.resolve({ id: taskId }) });
}

describe("POST /api/tasks/[id]/listing-pack/ai-generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRealAiListingEnabledForTests(false);
    setRealAiListingClientForTests(null);
    mocks.callAiJson.mockImplementation(() => {
      throw new Error("callAiJson must not be called in Core-4-AI.8");
    });
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner" } });
    mocks.findUnique.mockResolvedValue(TASK_RECORD);
  });

  it("returns 401 unauthorized when owner auth fails", async () => {
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "bad auth",
    });

    const res = await callPOST("task-1");
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("unauthorized");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("blocks demo from generating a listing draft from an official task", async () => {
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "demo cannot read official task context",
    });

    const res = await callPOST("task-1");
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.callAiJson).not.toHaveBeenCalled();
  });

  it("returns task_not_found when task does not exist", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await callPOST("missing-task");
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("task_not_found");
  });

  it("returns missing_task_context when task has no usable product context", async () => {
    mocks.findUnique.mockResolvedValue({
      title: "",
      materialText: "",
      level: "",
      oneLineSummary: "",
      resultJson: "{}",
    });

    const res = await callPOST("task-without-context");
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("missing_task_context");
  });

  it("returns a valid mock listing pack without saving to database", async () => {
    const res = await callPOST("task-1");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.meta).toEqual({
      mode: "mock",
      saved: false,
      nextStep: "review_before_save",
    });
    expect(validateAiListingPackDraft(data.data.listingPack).ok).toBe(true);
    expect(data.data.listingPack.source).toBe("mock_ai_draft");
    expect(data.data.listingPack.model).toBe("mock");
    expect(data.data.listingPack.humanReviewRequired).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.callAiJson).not.toHaveBeenCalled();
  });

  it("keeps mode=mock on the mock branch and does not call real AI", async () => {
    const res = await callPOST("task-1", { mode: "mock" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.data.meta.mode).toBe("mock");
    expect(data.data.listingPack.source).toBe("mock_ai_draft");
    expect(mocks.callAiJson).not.toHaveBeenCalled();
  });

  it("rejects mode=real without confirmRealAi and does not call real AI", async () => {
    const res = await callPOST("task-1", { mode: "real" });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("real_ai_confirmation_required");
    expect(mocks.callAiJson).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects mode=real with confirmRealAi=false and does not call real AI", async () => {
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: false });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("real_ai_confirmation_required");
    expect(mocks.callAiJson).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("rejects confirmed real mode when real AI listing is disabled and does not call real AI", async () => {
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: true });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("real_ai_disabled");
    expect(mocks.callAiJson).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("uses the injected fake client for confirmed real mode and returns a validated real_ai_draft", async () => {
    const route = await import("@/app/api/tasks/[id]/listing-pack/ai-generate/route");
    const fakeClient = vi.fn().mockResolvedValue({
      model: "fake-listing-model",
      titles: ["Desktop Phone Stand for Workspace Use"],
      bullets: ["Adjustable stand for desk organization.", "FDA Approved claim should be filtered."],
      description: "A practical desktop phone stand for hands-free viewing.",
      keywords: ["desktop phone stand", "workspace accessory"],
      sellingPoints: ["Adjustable viewing angle"],
      riskNotes: ["Confirm material and dimensions before publishing."],
      complianceWarnings: [],
      blockedClaims: [],
      reviewChecklist: ["Check supplier documents before publishing."],
    });
    setRealAiListingEnabledForTests(true);
    setRealAiListingClientForTests(fakeClient);
    try {
      const req = new Request("http://localhost/api/tasks/task-1/listing-pack/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-access-token": "tok_test" },
        body: JSON.stringify({ mode: "real", confirmRealAi: true }),
      });
      const res = await route.POST(req as any, { params: Promise.resolve({ id: "task-1" }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.ok).toBe(true);
      expect(data.data.meta).toEqual({
        mode: "real",
        saved: false,
        nextStep: "review_before_save",
      });
      expect(data.data.listingPack.source).toBe("real_ai_draft");
      expect(data.data.listingPack.model).toBe("fake-listing-model");
      expect(validateAiListingPackDraft(data.data.listingPack).ok).toBe(true);
      expect(fakeClient).toHaveBeenCalledTimes(1);
      expect(fakeClient.mock.calls[0][0].context.productName).toBe("Desktop Phone Stand");
      const visibleText = [
        ...data.data.listingPack.titles,
        ...data.data.listingPack.bullets,
        data.data.listingPack.description,
        ...data.data.listingPack.sellingPoints,
      ].join(" ");
      expect(visibleText).not.toMatch(/FDA Approved/);
      expect(data.data.listingPack.blockedClaims).toContain("FDA Approved");
      expect(mocks.callAiJson).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.delete).not.toHaveBeenCalled();
    } finally {
      setRealAiListingEnabledForTests(false);
      setRealAiListingClientForTests(null);
    }
  });

  it("maps fake client timeout to ai_timeout without returning a savable draft", async () => {
    setRealAiListingEnabledForTests(true);
    setRealAiListingClientForTests(vi.fn().mockRejectedValue({ code: "timeout" }));
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: true });
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_timeout");
    expect(data.data).toBeUndefined();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps fake client non-json response to ai_json_parse_failed", async () => {
    setRealAiListingEnabledForTests(true);
    setRealAiListingClientForTests(vi.fn().mockResolvedValue("not json"));
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: true });
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_json_parse_failed");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps incomplete fake client output to ai_schema_invalid", async () => {
    setRealAiListingEnabledForTests(true);
    setRealAiListingClientForTests(vi.fn().mockResolvedValue({ model: "fake-listing-model", titles: [] }));
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: true });
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_schema_invalid");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps fake client provider errors to ai_provider_error", async () => {
    setRealAiListingEnabledForTests(true);
    setRealAiListingClientForTests(vi.fn().mockRejectedValue(new Error("provider unavailable")));
    const res = await callPOST("task-1", { mode: "real", confirmRealAi: true });
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("ai_provider_error");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("filters banned claims from returned visible content and records blockedClaims", async () => {
    const res = await callPOST("task-1");
    const data = await res.json();
    const pack = data.data.listingPack;
    const visibleText = [
      ...pack.titles,
      ...pack.bullets,
      pack.description,
      ...pack.keywords,
      ...pack.sellingPoints,
    ].join(" ");

    expect(visibleText).not.toMatch(/FDA Approved|100% Safe|Medical Grade|稳赚|爆款必出|保证盈利/);
    expect(pack.blockedClaims).toContain("FDA Approved");
    expect(pack.complianceWarnings.join(" ")).toMatch(/Human review is required/);
  });

  it("returns invalid_json for malformed request body", async () => {
    const { POST } = await import("@/app/api/tasks/[id]/listing-pack/ai-generate/route");
    const req = new Request("http://localhost/api/tasks/task-1/listing-pack/ai-generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    const res = await POST(req as any, { params: Promise.resolve({ id: "task-1" }) });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("invalid_json");
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
