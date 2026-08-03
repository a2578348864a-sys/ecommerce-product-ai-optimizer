import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
  sandboxAtomic: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: { viralAnalysisRecord: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_"),
  mutateSandboxTaskAtomic: mocks.sandboxAtomic,
}));

function callPATCH(id: string) {
  return import("./route").then(({ PATCH }) => PATCH(new Request(`http://localhost/api/tasks/${id}/lifecycle`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "watching", reasonCode: "manual_watch" }),
  }) as never, { params: Promise.resolve({ id }) }));
}

describe("lifecycle namespace CAS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwnerOnly.mockReturnValue({ ok: true, context: { mode: "owner", token: "" } });
    mocks.requireAuthenticated.mockReturnValue({
      ok: true,
      context: { mode: "demo", demoAccessId: "visitor-a", token: "" },
    });
    mocks.findUnique.mockResolvedValue({
      id: "task-1",
      type: "workflow",
      updatedAt: new Date("2026-08-03T00:00:00.000Z"),
      resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
      decisionStatus: "continue",
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sandboxAtomic.mockImplementation(async (_accessId: string, _taskId: string, action: (task: any) => any) => {
      const current = {
        id: "sandbox_task-1",
        demoAccessId: "visitor-a",
        type: "workflow",
        updatedAt: "2026-08-03T00:00:00.000Z",
        resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
        decisionStatus: "continue",
        productLifecycle: "",
      };
      const output = await action(current);
      return { status: "updated", task: output.task, value: output.value };
    });
  });

  it("updates only productLifecycle and leaves compatibility decisionStatus untouched", async () => {
    const response = await callPATCH("task-1");
    const call = mocks.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
    const saved = JSON.parse(call.data.resultJson as string);
    expect(response.status).toBe(200);
    expect(saved.unknownNamespace).toEqual({ keep: true });
    expect(saved.productLifecycle.status).toBe("watching");
    expect(call.data).not.toHaveProperty("decisionStatus");
  });

  it("returns 409 instead of overwriting after a lost Owner CAS", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await callPATCH("task-1");
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("task_result_conflict");
  });

  it("runs Visitor mutation inside the subject lock and never touches Owner storage", async () => {
    const response = await callPATCH("sandbox_task-1");
    expect(response.status).toBe(200);
    expect(mocks.sandboxAtomic).toHaveBeenCalledWith("visitor-a", "sandbox_task-1", expect.any(Function));
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
