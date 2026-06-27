import { describe, expect, it, beforeEach, vi } from "vitest";
import { validateAiListingPackDraft } from "@/lib/aiListingDraft";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  requireOwnerOnly: vi.fn(),
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
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/aiClient", () => ({
  callAiJson: vi.fn(() => {
    throw new Error("callAiJson must not be called in Core-4-AI.2");
  }),
}));

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
