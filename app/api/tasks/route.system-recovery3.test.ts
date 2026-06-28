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
import { createSandboxTask, listSandboxTasks, sandboxTaskToListItem, loadDemoSandboxStore, saveDemoSandboxStore } from "@/lib/server/demoSandbox";
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
    process.env.DEMO_SANDBOX_STORE_PATH = "data/demo-sandbox.test-system-recovery3.json";

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
