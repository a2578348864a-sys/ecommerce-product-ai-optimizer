import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  requireAuthenticated: vi.fn(),
  requireOwnerOnly: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      delete: mocks.delete,
    },
  },
}));

vi.mock("@/lib/server/demoGuard", () => ({
  requireAuthenticated: mocks.requireAuthenticated,
  requireOwnerOnly: mocks.requireOwnerOnly,
}));

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: () => false,
  getSandboxTask: () => null,
  sandboxTaskToDetail: () => ({}),
  updateSandboxTask: () => null,
  deleteSandboxTask: () => false,
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
  const req = new Request("http://localhost/api/tasks/task-official", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-access-token": "demo-token" },
    body: JSON.stringify({ decisionStatus: "continue" }),
  });
  return PATCH(req as any, { params: Promise.resolve({ id: "task-official" }) });
}

async function callDELETE() {
  const { DELETE } = await import("./route");
  const req = new Request("http://localhost/api/tasks/task-official", {
    method: "DELETE",
    headers: { "x-access-token": "demo-token" },
  });
  return DELETE(req as any, { params: Promise.resolve({ id: "task-official" }) });
}

describe("HR demo sandbox guard for official task writes", () => {
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

  it("blocks demo PATCH on an official task before Prisma update", async () => {
    const res = await callPATCH();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("blocks demo DELETE on an official task before Prisma delete", async () => {
    const res = await callDELETE();
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe("demo_action_forbidden");
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});
