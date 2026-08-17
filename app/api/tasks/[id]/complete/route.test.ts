import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticated: vi.fn(),
  completeResearch: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
}));

vi.mock("@/lib/server/productResearchRecordStore", () => ({
  ProductResearchStoreError: class ProductResearchStoreError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message: string,
      public readonly currentRevision?: number,
    ) {
      super(message);
    }
  },
  completeCurrentResearch: mocks.completeResearch,
}));

function request(method = "POST") {
  return new Request("http://localhost/api/tasks/task-1/complete", {
    method,
    headers: { "Content-Type": "application/json", "x-access-token": "test-token" },
  });
}

const context = { params: Promise.resolve({ id: "task-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "owner", token: "" } });
  mocks.completeResearch.mockResolvedValue({
    taskId: "task-1",
    lifecycle: "completed",
    researchRecord: true,
    completedAt: "2026-08-17T00:00:00.000Z",
    idempotent: false,
  });
});

describe("/api/tasks/[id]/complete", () => {
  it("completes an active research and returns the closure contract", async () => {
    const { POST } = await import("./route");
    const response = await POST(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toEqual({
      ok: true,
      data: {
        taskId: "task-1",
        lifecycle: "completed",
        researchRecord: true,
        completedAt: "2026-08-17T00:00:00.000Z",
        idempotent: false,
      },
    });
    expect(mocks.completeResearch).toHaveBeenCalledWith({ mode: "owner", token: "" }, "task-1", {});
  });

  it("is idempotent: repeated completion returns the same closure without duplicates", async () => {
    mocks.completeResearch.mockResolvedValueOnce({
      taskId: "task-1",
      lifecycle: "completed",
      researchRecord: true,
      completedAt: "2026-08-17T00:00:00.000Z",
      idempotent: true,
    });
    const { POST } = await import("./route");
    const response = await POST(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.idempotent).toBe(true);
  });

  it("authenticates before closing research", async () => {
    mocks.requireAuthenticated.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: "invalid_access",
      message: "login required",
    });
    const { POST } = await import("./route");
    const response = await POST(request() as never, context);

    expect(response.status).toBe(401);
    expect(mocks.completeResearch).not.toHaveBeenCalled();
  });

  it("rejects completion when no human decision was saved yet", async () => {
    const { ProductResearchStoreError } = await import("@/lib/server/productResearchRecordStore");
    mocks.completeResearch.mockRejectedValueOnce(
      new ProductResearchStoreError("research_decision_required", 409, "请先保存人工决定，再完成研究。"),
    );
    const { POST } = await import("./route");
    const response = await POST(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: { code: "research_decision_required", message: "请先保存人工决定，再完成研究。" },
    });
  });

  it("rejects completion while research still needs information", async () => {
    const { ProductResearchStoreError } = await import("@/lib/server/productResearchRecordStore");
    mocks.completeResearch.mockRejectedValueOnce(
      new ProductResearchStoreError("research_need_info", 409, "当前仍需补充资料，补充后再完成研究。"),
    );
    const { POST } = await import("./route");
    const response = await POST(request() as never, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("research_need_info");
  });

  it("rejects an empty task id", async () => {
    const { POST } = await import("./route");
    const response = await POST(request() as never, { params: Promise.resolve({ id: "" }) });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_task_id");
    expect(mocks.completeResearch).not.toHaveBeenCalled();
  });
});
