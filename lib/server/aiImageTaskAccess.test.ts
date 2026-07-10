import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { ok: true, context: { mode: "owner", token: "owner-token" } } as any,
  sandboxTask: null as any,
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => state.auth,
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_"),
  getSandboxTask: (accessId: string) => state.sandboxTask?.demoAccessId === accessId ? state.sandboxTask : null,
  updateSandboxTask: vi.fn(() => state.sandboxTask),
}));

import { prisma } from "@/lib/server/db";
import { updateSandboxTask } from "@/lib/server/demoSandbox";
import { loadAiImageTask } from "@/lib/server/aiImageTaskAccess";

const request = new Request("http://localhost/api/tasks/task-1/image-draft") as any;
const ownerRecord = { title: "Product", materialText: "Material", level: "low", oneLineSummary: "Summary", resultJson: "{}" };

describe("AI image task access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.auth = { ok: true, context: { mode: "owner", token: "owner-token" } };
    state.sandboxTask = null;
    vi.mocked(prisma.viralAnalysisRecord.findUnique).mockResolvedValue(ownerRecord as any);
  });

  it("loads and persists an owner task only for owner access", async () => {
    const result = await loadAiImageTask({ request, taskId: "task-1" });
    expect(result).toMatchObject({ ok: true, data: { accessMode: "owner", taskId: "task-1" } });
    if (result.ok) await result.data.persistResult({ saved: true });
    expect(prisma.viralAnalysisRecord.update).toHaveBeenCalledWith({ where: { id: "task-1" }, data: { resultJson: JSON.stringify({ saved: true }) } });
  });

  it("hides owner tasks from visitor access", async () => {
    state.auth = { ok: true, context: { mode: "demo", token: "visitor-token", demoAccessId: "visitor-1", isActive: true, isExpired: false, remainingAiCalls: 5 } };
    const result = await loadAiImageTask({ request, taskId: "task-1" });
    expect(result).toMatchObject({ ok: false, status: 404, code: "task_not_found" });
    expect(prisma.viralAnalysisRecord.findUnique).not.toHaveBeenCalled();
  });

  it("loads only the visitor's own sandbox task and persists back to that sandbox", async () => {
    state.auth = { ok: true, context: { mode: "demo", token: "visitor-token", demoAccessId: "visitor-1", isActive: true, isExpired: false, remainingAiCalls: 5 } };
    state.sandboxTask = { id: "sandbox_task-1", demoAccessId: "visitor-1", ...ownerRecord };
    const result = await loadAiImageTask({ request, taskId: "sandbox_task-1" });
    expect(result).toMatchObject({ ok: true, data: { accessMode: "visitor", visitorAccessId: "visitor-1" } });
    if (result.ok) await result.data.persistResult({ saved: true });
    expect(updateSandboxTask).toHaveBeenCalledWith("visitor-1", "sandbox_task-1", { resultJson: JSON.stringify({ saved: true }) });

    state.auth.context.demoAccessId = "visitor-2";
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 404 });
  });

  it("hides visitor tasks from owner and propagates expired access rejection", async () => {
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 404 });
    state.auth = { ok: false, status: 403, code: "visitor_access_expired", message: "访问已过期。" };
    expect(await loadAiImageTask({ request, taskId: "sandbox_task-1" })).toMatchObject({ ok: false, status: 403, code: "visitor_access_expired" });
  });
});
