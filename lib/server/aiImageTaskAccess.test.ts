import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { ok: true, context: { mode: "owner", token: "owner-token" } } as any,
  sandboxTask: null as any,
  sandboxAtomic: vi.fn(),
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => state.auth,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_"),
  getSandboxTask: (accessId: string) => state.sandboxTask?.demoAccessId === accessId ? state.sandboxTask : null,
  mutateSandboxTaskAtomic: state.sandboxAtomic,
}));

import { prisma } from "@/lib/server/db";
import { mutateSandboxTaskAtomic } from "@/lib/server/demoSandbox";
import { loadAiImageTask } from "@/lib/server/aiImageTaskAccess";

const request = new Request("http://localhost/api/tasks/task-1/image-draft") as any;
const ownerRecord = {
  id: "task-1",
  type: "workflow",
  title: "Product",
  materialText: "Material",
  level: "low",
  oneLineSummary: "Summary",
  resultJson: JSON.stringify({ unknownNamespace: { keep: true } }),
  decisionStatus: "continue",
  updatedAt: new Date("2026-08-03T00:00:00.000Z"),
};

describe("AI image task access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth = { ok: true, context: { mode: "owner", token: "owner-token" } };
    state.sandboxTask = null;
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(ownerRecord as any);
    vi.mocked(prisma.viralAnalysisRecord.updateMany).mockResolvedValue({ count: 1 } as any);
    state.sandboxAtomic.mockImplementation(async (_accessId: string, _taskId: string, action: (task: any) => any) => {
      const output = await action(state.sandboxTask);
      state.sandboxTask = output.task;
      return { status: "updated", task: output.task, value: output.value };
    });
  });

  it("loads and persists an owner task only for owner access", async () => {
    const result = await loadAiImageTask({ request, taskId: "task-1" });
    expect(result).toMatchObject({ ok: true, data: { accessMode: "owner", taskId: "task-1" } });
    if (result.ok) await result.data.persistResult({ aiImageDraftSnapshot: { saved: true } });
    const call = vi.mocked(prisma.viralAnalysisRecord.updateMany).mock.calls[0][0] as any;
    expect(call.where).toEqual({
      id: "task-1",
      updatedAt: ownerRecord.updatedAt,
      resultJson: ownerRecord.resultJson,
    });
    expect(JSON.parse(call.data.resultJson)).toEqual({
      unknownNamespace: { keep: true },
      aiImageDraftSnapshot: { saved: true },
    });
  });

  it("hides owner tasks from visitor access", async () => {
    state.auth = { ok: true, context: { mode: "demo", token: "visitor-token", demoAccessId: "visitor-1", isActive: true, isExpired: false, remainingAiCalls: 5 } };
    const result = await loadAiImageTask({ request, taskId: "task-1" });
    expect(result).toMatchObject({ ok: false, status: 404, code: "task_not_found" });
    expect(prisma.viralAnalysisRecord.findUnique).not.toHaveBeenCalled();
  });

  it("returns a typed 409 conflict instead of overwriting a newer owner task", async () => {
    vi.mocked(prisma.viralAnalysisRecord.updateMany).mockResolvedValue({ count: 0 } as any);
    const result = await loadAiImageTask({ request, taskId: "task-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.data.persistResult({ aiImageDraftSnapshot: { saved: true } }))
      .rejects.toMatchObject({ code: "task_result_conflict", status: 409 });
  });

  it("loads only the visitor's own sandbox task and persists back to that sandbox", async () => {
    state.auth = { ok: true, context: { mode: "demo", token: "visitor-token", demoAccessId: "visitor-1", isActive: true, isExpired: false, remainingAiCalls: 5 } };
    state.sandboxTask = {
      ...ownerRecord,
      id: "sandbox_task-1",
      demoAccessId: "visitor-1",
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    const result = await loadAiImageTask({ request, taskId: "sandbox_task-1" });
    expect(result).toMatchObject({ ok: true, data: { accessMode: "visitor", visitorAccessId: "visitor-1" } });
    if (result.ok) await result.data.persistResult({ aiImageDraftSnapshot: { saved: true } });
    expect(mutateSandboxTaskAtomic).toHaveBeenCalledWith("visitor-1", "sandbox_task-1", expect.any(Function));
    expect(JSON.parse(state.sandboxTask.resultJson)).toEqual({
      unknownNamespace: { keep: true },
      aiImageDraftSnapshot: { saved: true },
    });

    state.auth.context.demoAccessId = "visitor-2";
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 404 });
  });

  it("hides visitor tasks from owner and propagates expired access rejection", async () => {
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 404 });
    state.auth = { ok: false, status: 403, code: "visitor_access_expired", message: "访问已过期。" };
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 403, code: "visitor_access_expired" });
  });
});
