/**
 * Access-Control-Fix.1-Followup — Real Route Handler Tests
 *
 * Verifies that the GET handler blocks Demo users from reading Owner task details,
 * and that Prisma is never called for rejected requests.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mock prisma BEFORE importing the route module ──

const mockPrismaFindFirst = vi.fn();
const mockPrismaFindUnique = vi.fn();
const mockPrismaDelete = vi.fn();
const mockPrismaUpdate = vi.fn();

vi.mock("@/lib/server/db", () => ({
  prisma: {
    viralAnalysisRecord: {
      findFirst: (...args: unknown[]) => mockPrismaFindFirst(...args),
      findUnique: (...args: unknown[]) => mockPrismaFindUnique(...args),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      delete: (...args: unknown[]) => mockPrismaDelete(...args),
      update: (...args: unknown[]) => mockPrismaUpdate(...args),
    },
  },
}));

// ── Mock getAccessContext ──

let mockAccessContext: { mode: string; demoAccessId?: string } | null = null;

vi.mock("@/lib/server/accessPassword", async () => {
  const actual = await vi.importActual("@/lib/server/accessPassword");
  return {
    ...actual,
    getAccessContext: vi.fn(() => {
      if (!mockAccessContext) return null;
      return {
        mode: mockAccessContext.mode,
        ...(mockAccessContext.mode === "demo"
          ? { demoAccessId: mockAccessContext.demoAccessId || "demo-001" }
          : {}),
      };
    }),
    checkAccessPassword: vi.fn(() => null), // always pass auth
  };
});

// ── Mock demoSandbox ──

vi.mock("@/lib/server/demoSandbox", () => ({
  isSandboxTaskId: vi.fn((id: string) => id.startsWith("sandbox_task_")),
  getSandboxTask: vi.fn((demoAccessId: string, id: string) => {
    if (!id.startsWith("sandbox_task_")) return null;
    // Extract the owner from the task ID: sandbox_task_{ownerDemoId}_{random}
    const owner = id.replace("sandbox_task_", "").replace(/_.*$/, "");
    if (demoAccessId !== owner) return null;
    return { id, demoAccessId: owner, title: "Sandbox Task", type: "workflow", result: {} };
  }),
  sandboxTaskToDetail: vi.fn((task: unknown) => task),
  createSandboxTask: vi.fn(),
  listSandboxTasks: vi.fn(() => []),
}));

// ── Now import the route handler ──

import { GET, DELETE } from "@/app/api/tasks/[id]/route";
import { NextRequest } from "next/server";

function buildRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-access-token"] = token;
  }
  return new NextRequest("http://localhost:3005/api/tasks/test-id", { headers });
}

function buildRouteContext(id: string) {
  return { params: Promise.resolve({ id }) } as unknown as Parameters<typeof GET>[1];
}

// ── Tests ─────────────────────────────────────────

describe("Access-Control-Fix.1-Followup — GET /api/tasks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessContext = null;
    mockPrismaFindFirst.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── P0: Demo + non-sandbox ID → 404, Prisma NOT called ──

  it("Demo accessing non-sandbox Owner task ID returns 404 and does NOT call Prisma", async () => {
    // Set Demo context
    mockAccessContext = { mode: "demo", demoAccessId: "demo-001" };

    // Owner task ID (not sandbox)
    const ownerTaskId = "cmr3jj0dw0000mdhz2eu63mbt";
    const req = buildRequest("demo-token");
    const ctx = buildRouteContext(ownerTaskId);

    const response = await GET(req, ctx);
    const data = await response.json();

    // Must return 404
    expect(response.status).toBe(404);
    expect(data.ok).toBe(false);
    expect(data.error?.code).toBe("not_found");

    // Prisma must NOT have been called
    expect(mockPrismaFindFirst).not.toHaveBeenCalled();
    expect(mockPrismaFindUnique).not.toHaveBeenCalled();
  });

  // ── Demo + sandbox ID → 200 ──

  it("Demo accessing their own sandbox task returns 200", async () => {
    mockAccessContext = { mode: "demo", demoAccessId: "demo-001" };

    // Sandbox task owned by demo-001 (same as caller)
    const sandboxId = "sandbox_task_demo-001_abc123";
    const req = buildRequest("demo-token");
    const ctx = buildRouteContext(sandboxId);

    const response = await GET(req, ctx);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);

    // Prisma must NOT have been called (sandbox path uses in-memory store)
    expect(mockPrismaFindFirst).not.toHaveBeenCalled();
  });

  // ── Demo + different demo's sandbox ID → 404 ──

  it("Demo cannot access another demo user's sandbox task", async () => {
    mockAccessContext = { mode: "demo", demoAccessId: "demo-001" };

    // Sandbox task owned by a DIFFERENT demo user (demo-002, not demo-001)
    const otherSandboxId = "sandbox_task_demo-002_xyz789";
    const req = buildRequest("demo-token");
    const ctx = buildRouteContext(otherSandboxId);

    const response = await GET(req, ctx);
    expect(response.status).toBe(404);
  });

  // ── Owner + non-sandbox ID → 200, Prisma called ──

  it("Owner accessing non-sandbox task calls Prisma and returns 200", async () => {
    mockAccessContext = { mode: "owner" };

    // Mock Prisma to return a task
    mockPrismaFindFirst.mockResolvedValueOnce({
      id: "cmr3jj0dw0000mdhz2eu63mbt",
      createdAt: new Date("2026-07-02"),
      updatedAt: new Date("2026-07-02"),
      type: "workflow",
      decisionStatus: "continue",
      title: "Owner Task",
      platform: "manual",
      productUrl: null,
      materialText: "test",
      source: "ai",
      score: 85,
      level: "green",
      oneLineSummary: "OK",
      resultJson: JSON.stringify({ productName: "Test", finalReport: { finalVerdict: "OK" } }),
    });

    const ownerTaskId = "cmr3jj0dw0000mdhz2eu63mbt";
    const req = buildRequest("owner-token");
    const ctx = buildRouteContext(ownerTaskId);

    const response = await GET(req, ctx);
    expect(response.status).toBe(200);

    // Prisma WAS called for Owner
    expect(mockPrismaFindFirst).toHaveBeenCalledTimes(1);
  });

  // ── Anonymous (no context) → blocked by checkAccessPassword ──

  it("Anonymous request (no auth) is rejected before reaching demo guard", async () => {
    // Mock checkAccessPassword to fail
    vi.mocked(
      (await import("@/lib/server/accessPassword")).checkAccessPassword
    ).mockReturnValueOnce({
      status: 401,
      body: { error: "请先登录后再操作。" },
    } as never);

    const req = buildRequest();
    const ctx = buildRouteContext("any-task-id");

    const response = await GET(req, ctx);
    expect(response.status).toBe(401);

    // Prisma must NOT have been called
    expect(mockPrismaFindFirst).not.toHaveBeenCalled();
  });

  // ── Demo + unknown non-sandbox ID → 404 (not 500) ──

  it("Demo accessing non-existent non-sandbox ID returns 404 not 500", async () => {
    mockAccessContext = { mode: "demo", demoAccessId: "demo-001" };

    const nonexistentId = "nonexistent-uuid-12345";
    const req = buildRequest("demo-token");
    const ctx = buildRouteContext(nonexistentId);

    const response = await GET(req, ctx);
    expect(response.status).toBe(404);

    // Prisma must NOT have been called
    expect(mockPrismaFindFirst).not.toHaveBeenCalled();
  });
});
