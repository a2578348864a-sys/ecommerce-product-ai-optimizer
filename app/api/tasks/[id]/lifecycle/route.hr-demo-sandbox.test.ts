import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  requireAuthenticated: vi.fn(),
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
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  updateSandboxTaskLifecycle: () => null,
  getSandboxTask: () => null,
}));

vi.mock("@prisma/client", () => ({
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, { code }: { code: string }) {
        super(message);
        this.code = code;
      }
    },
  },
}));

async function callPATCH() {
  const { PATCH } = await import("./route");
  const req = new Request("http://localhost/api/tasks/task-official/lifecycle", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "demo-token" },
    body: JSON.stringify({ status: "watching", reasonCode: "manual_watch" }),
  });
  return PATCH(req as any, { params: Promise.resolve({ id: "task-official" }) });
}

describe("HR demo sandbox guard for official task lifecycle writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuthenticated.mockReturnValue({ ok: true, context: { mode: "demo", demoAccessId: "demo-hr" } });
    mocks.requireOwnerOnly.mockReturnValue({
      ok: false,
      status: 403,
      code: "demo_action_forbidden",
      message: "demo cannot write official data",
    });
  });

  it("blocks demo lifecycle PATCH on an official task before Prisma update", async () => {
    const res = await callPATCH();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
