import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "owner" as "owner" | "demo", cleanupFails: false }));

vi.mock("@/lib/server/db", () => ({ prisma: { viralAnalysisRecord: { delete: vi.fn(async () => ({ id: "task-1" })) } } }));
vi.mock("@/lib/server/accessPassword", () => ({
  checkAccessPassword: () => null,
  getAccessContext: () => null,
}));
vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: () => ({ ok: true, context: state.mode === "demo" ? { mode: "demo", demoAccessId: "visitor-1" } : { mode: "owner" } }),
  requireOwnerOnly: () => state.mode === "owner" ? { ok: true, context: { mode: "owner" } } : { ok: false, status: 403, code: "forbidden", message: "forbidden" },
}));
vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: (id: string) => id.startsWith("sandbox_"),
  deleteSandboxTask: vi.fn(() => true),
  getSandboxTask: vi.fn(),
  updateSandboxTask: vi.fn(),
  sandboxTaskToDetail: vi.fn(),
}));
vi.mock("@/lib/server/aiImageDraftStorage", () => ({
  cleanupAiImageTask: vi.fn(async () => {
    if (state.cleanupFails) throw new Error("private path omitted");
  }),
}));

import { prisma } from "@/lib/server/db";
import { cleanupAiImageTask } from "@/lib/server/aiImageDraftStorage";
import { DELETE } from "@/app/api/tasks/[id]/route";

function remove(taskId: string) {
  return DELETE(new Request(`http://localhost/api/tasks/${taskId}`, { method: "DELETE" }) as any, { params: Promise.resolve({ id: taskId }) });
}

describe("task image cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.mode = "owner";
    state.cleanupFails = false;
  });

  it("cleans owner and visitor image directories after their task is deleted", async () => {
    expect((await remove("task-1")).status).toBe(200);
    expect(cleanupAiImageTask).toHaveBeenCalledWith({ accessMode: "owner", taskId: "task-1" });

    state.mode = "demo";
    expect((await remove("sandbox_task-1")).status).toBe(200);
    expect(cleanupAiImageTask).toHaveBeenCalledWith({ accessMode: "visitor", visitorAccessId: "visitor-1", taskId: "sandbox_task-1" });
  });

  it("keeps the primary deletion successful when image cleanup fails", async () => {
    state.cleanupFails = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await remove("task-1");
    expect(response.status).toBe(200);
    expect(prisma.viralAnalysisRecord.delete).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[ai-image-draft] task cleanup failed", { accessMode: "owner", taskId: "task-1" });
    log.mockRestore();
  });
});
