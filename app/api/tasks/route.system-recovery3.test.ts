/**
 * Phase System-Recovery.3 — Demo Sandbox Tasks in List Test
 *
 * Verifies that after Demo save-task writes to sandbox,
 * GET /api/tasks includes the sandbox task in the list.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createOwnerSession, createDemoSession, deleteAccessSession } from "@/lib/server/accessSession";
import { createDemoAccess, loadDemoAccessStore, saveDemoAccessStore } from "@/lib/server/demoAccess";
import { createSandboxTask, isSandboxTaskId, getSandboxTask, listSandboxTasks, sandboxTaskToListItem, loadDemoSandboxStore, saveDemoSandboxStore } from "@/lib/server/demoSandbox";
import { getAccessContext, checkAccessPassword } from "@/lib/server/accessPassword";

function buildGetRequest(token: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-access-token"] = token;
    headers["x-access-password"] = token;
  }
  return new NextRequest("http://localhost:3005/api/tasks?limit=20", { headers });
}

describe("System-Recovery.3 — Demo sandbox tasks in GET /api/tasks", () => {
  let ownerToken = "";
  let demoToken = "";
  let demoAccessId = "";

  beforeEach(() => {
    process.env.ACCESS_PASSWORD = "test-dummy-for-tasks-list";
    process.env.DEMO_ACCESS_STORE_PATH = ".next/test-stores/demo-access.test-system-recovery3.json";
    process.env.DEMO_SANDBOX_STORE_PATH = ".next/test-stores/demo-sandbox.test-system-recovery3.json";

    // Start with empty sandbox
    saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] });

    const ownerSession = createOwnerSession();
    ownerToken = ownerSession.token;

    const { record } = createDemoAccess({ label: "test-tasks-list", hours: 24, maxAiCalls: 10 });
    demoAccessId = record.id;
    const demoSession = createDemoSession(demoAccessId);
    demoToken = demoSession.token;
  });

  afterEach(() => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.DEMO_ACCESS_STORE_PATH;
    delete process.env.DEMO_SANDBOX_STORE_PATH;
    if (ownerToken) deleteAccessSession(ownerToken);
    if (demoToken) deleteAccessSession(demoToken);
  });

  // ── Core: getAccessContext recognizes demo token ──
  it("getAccessContext returns demo mode for demo token in x-access-token header", () => {
    const req = buildGetRequest(demoToken);
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
    if (ctx!.mode === "demo") {
      expect(ctx!.demoAccessId).toBe(demoAccessId);
    }
  });

  it("getAccessContext returns owner mode for owner token", () => {
    const req = buildGetRequest(ownerToken);
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
  });

  // ── Sandbox task creation and listing ──
  it("sandbox task created via createSandboxTask is visible in listSandboxTasks", () => {
    const task = createSandboxTask(demoAccessId, { title: "Sandbox List Test" });
    const tasks = listSandboxTasks(demoAccessId);
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some(t => t.id === task.id)).toBe(true);
  });

  it("listSandboxTasks isolates between different demo users", () => {
    createSandboxTask(demoAccessId, { title: "User A Task" });
    const tasksA = listSandboxTasks(demoAccessId);
    const tasksB = listSandboxTasks("other_demo_id");
    expect(tasksA.length).toBeGreaterThanOrEqual(1);
    expect(tasksB.length).toBe(0);
  });

  // ── checkAccessPassword accepts demo token ──
  it("checkAccessPassword passes for demo token in x-access-token header", () => {
    const req = buildGetRequest(demoToken);
    const err = checkAccessPassword(req);
    expect(err).toBeNull();
  });

  // ── End-to-end: demo token → getAccessContext → listSandboxTasks ──
  it("full flow: demo token yields demo context which yields sandbox tasks", () => {
    // Step 1: Create sandbox task
    const task = createSandboxTask(demoAccessId, { title: "E2E List Test Task" });
    expect(task.id).toMatch(/^sandbox_task_/);

    // Step 2: Simulate GET /api/tasks request with demo token headers
    const req = buildGetRequest(demoToken);

    // Step 3: Auth check
    const authError = checkAccessPassword(req);
    expect(authError).toBeNull();

    // Step 4: Get access context
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");

    // Step 5: List sandbox tasks
    if (ctx!.mode === "demo") {
      const sandboxTasks = listSandboxTasks(ctx.demoAccessId);
      expect(sandboxTasks.length).toBeGreaterThanOrEqual(1);
      expect(sandboxTasks.some(t => t.id === task.id)).toBe(true);

      // Verify sandbox task has correct format
      const item = sandboxTaskToListItem(task);
      expect(item.isSandbox).toBe(true);
      expect(item.sourceMode).toBe("demo_sandbox");
      expect(item.canEdit).toBe(true);
      expect(item.canDelete).toBe(true);
    }
  });
});

// ── Access-Control-Fix.1: Demo isolation guards ──
// Note: createSandboxTask already imported at top of file

describe("Access-Control-Fix.1 — Demo task isolation guards", () => {
  let demoSandboxStoreBefore: unknown;
  let demoAccessStoreBefore: unknown;

  beforeEach(() => {
    demoSandboxStoreBefore = loadDemoSandboxStore();
    demoAccessStoreBefore = loadDemoAccessStore();
  });

  afterEach(() => {
    saveDemoSandboxStore(demoSandboxStoreBefore);
    saveDemoAccessStore(demoAccessStoreBefore);
  });

  it("non-sandbox task IDs are correctly identified", () => {
    expect(isSandboxTaskId("cmr3jj0dw0000mdhz2eu63mbt")).toBe(false);
    expect(isSandboxTaskId("test-uuid-123")).toBe(false);
    expect(isSandboxTaskId("")).toBe(false);
  });

  it("sandbox task ID starts with sandbox_ prefix and is scoped to demoAccessId", () => {
    const task = createSandboxTask("demo-user-001", { title: "Test" });
    expect(isSandboxTaskId(task.id)).toBe(true);
    expect(task.id).toMatch(/^sandbox_task_/);
    expect(task.demoAccessId).toBe("demo-user-001");

    // Different demo user cannot access
    const other = getSandboxTask("other-demo-user", task.id);
    expect(other).toBeNull();

    // Same demo user can access
    const same = getSandboxTask("demo-user-001", task.id);
    expect(same).not.toBeNull();
  });

  it("guard logic: demo mode + non-sandbox ID → reject", () => {
    // The guard in the route handler:
    //   const accessCtx = getAccessContext(request);
    //   if (accessCtx?.mode === "demo") return notFoundResponse();
    //
    // This simulates the guard: if a demo context exists AND the ID
    // is not a sandbox task, the handler returns 404 before Prisma query.
    const nonSandboxId = "cmr3jj0dw0000mdhz2eu63mbt";
    const isSandbox = isSandboxTaskId(nonSandboxId);
    expect(isSandbox).toBe(false);

    // Guard logic: demo mode + non-sandbox → true (reject)
    const shouldReject = (mode: string) => mode === "demo" && !isSandboxTaskId(nonSandboxId);
    expect(shouldReject("demo")).toBe(true);
    expect(shouldReject("owner")).toBe(false);
  });

  it("guard logic: demo mode + sandbox ID → allow", () => {
    const task = createSandboxTask("scope-test-demo", { title: "Demo Task" });
    const isSandbox = isSandboxTaskId(task.id);
    expect(isSandbox).toBe(true);

    // Guard logic: sandbox ID is handled before the demo guard for non-sandbox IDs
    const shouldAllow = (mode: string, id: string) => {
      if (isSandboxTaskId(id)) {
        // sandbox path: only demo users can access their own tasks
        return mode === "demo";
      }
      // non-sandbox path: the new guard blocks demo
      return mode !== "demo";
    };
    expect(shouldAllow("demo", task.id)).toBe(true);
    expect(shouldAllow("owner", task.id)).toBe(false);
  });
});
