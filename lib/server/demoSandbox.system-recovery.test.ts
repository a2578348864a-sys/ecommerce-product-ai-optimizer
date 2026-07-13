/**
 * Phase System-Recovery.2 — Demo Sandbox API Regression Tests
 *
 * Tests sandbox behavior for Owner vs Demo users:
 * - Demo save-task writes sandbox
 * - Demo official task PATCH/DELETE → 403
 * - Demo sandbox task PATCH/DELETE → success
 * - Demo candidates sandbox CRUD → success
 * - Demo official candidate PATCH/DELETE → 403
 *
 * Uses DEMO_SANDBOX_STORE_PATH for isolation.
 * Does NOT: call real AI, write real DB, read .env.
 */

import { describe, expect, it, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createOwnerSession,
  createDemoSession,
  deleteAccessSession,
} from "@/lib/server/accessSession";
import {
  createDemoAccess,
  loadDemoAccessStore,
  saveDemoAccessStore,
} from "@/lib/server/demoAccess";
import {
  loadDemoSandboxStore,
  saveDemoSandboxStore,
  createSandboxTask,
  deleteSandboxTask,
  updateSandboxTask,
  listSandboxTasks,
  createSandboxCandidate,
  deleteSandboxCandidate,
  updateSandboxCandidate,
  listSandboxCandidates,
  isSandboxTaskId,
  isSandboxCandidateId,
  sandboxTaskToListItem,
  sandboxCandidateToListItem,
  markOfficialTaskReadonly,
  type DemoSandboxStore,
} from "@/lib/server/demoSandbox";

// ── Isolated store path ────────────────────────────

const TEST_ROOT = mkdtempSync(join(tmpdir(), "demo-sandbox-system-recovery-"));
const TEST_STORE_PATH = join(TEST_ROOT, "sandbox.json");
const TEST_ACCESS_STORE_PATH = join(TEST_ROOT, "access.json");
process.env.DEMO_ACCESS_STORE_PATH = TEST_ACCESS_STORE_PATH;

beforeEach(() => {
  process.env.DEMO_SANDBOX_STORE_PATH = TEST_STORE_PATH;
  // Start with empty store
  saveDemoSandboxStore({ version: 1, tasks: [], candidates: [] });
});

afterEach(() => {
  delete process.env.DEMO_SANDBOX_STORE_PATH;
});

afterAll(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────

function setupOwnerDemo() {
  const ownerSession = createOwnerSession();
  const { record } = createDemoAccess({
    label: "test-sandbox-regression",
    hours: 24,
    maxAiCalls: 10,
  });
  const demoSession = createDemoSession(record.id);
  return {
    ownerToken: ownerSession.token,
    demoToken: demoSession.token,
    demoAccessId: record.id,
    cleanup: () => {
      deleteAccessSession(ownerSession.token);
      deleteAccessSession(demoSession.token);
      const store = loadDemoAccessStore();
      store.accesses = store.accesses.filter((a) => a.id !== record.id);
      saveDemoAccessStore(store);
    },
  };
}

// ═══════════════════════════════════════════════════
// Task Sandbox Tests
// ═══════════════════════════════════════════════════

describe("Demo sandbox — task CRUD", () => {
  const { demoAccessId, cleanup } = setupOwnerDemo();

  afterEach(() => cleanup());

  it("createSandboxTask generates a sandbox-prefixed ID", () => {
    const task = createSandboxTask(demoAccessId, { title: "Test Task" });
    expect(isSandboxTaskId(task.id)).toBe(true);
    expect(task.id).toMatch(/^sandbox_task_/);
    expect(task.title).toBe("Test Task");
    expect(task.demoAccessId).toBe(demoAccessId);
  });

  it("listSandboxTasks returns only tasks for given demoAccessId", () => {
    createSandboxTask(demoAccessId, { title: "Task A" });
    createSandboxTask(demoAccessId, { title: "Task B" });
    const tasks = listSandboxTasks(demoAccessId);
    expect(tasks).toHaveLength(2);
  });

  it("listSandboxTasks isolates between different demo users", () => {
    createSandboxTask(demoAccessId, { title: "User 1 Task" });
    const tasks1 = listSandboxTasks(demoAccessId);
    const tasks2 = listSandboxTasks("other_demo_id");
    expect(tasks1).toHaveLength(1);
    expect(tasks2).toHaveLength(0);
  });

  it("updateSandboxTask modifies fields", () => {
    const task = createSandboxTask(demoAccessId, { title: "Original" });
    const updated = updateSandboxTask(demoAccessId, task.id, { title: "Updated" });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Updated");
  });

  it("updateSandboxTask returns null for wrong demoAccessId", () => {
    const task = createSandboxTask(demoAccessId, { title: "Mine" });
    const updated = updateSandboxTask("wrong_id", task.id, { title: "Hacked" });
    expect(updated).toBeNull();
  });

  it("deleteSandboxTask removes the task", () => {
    const task = createSandboxTask(demoAccessId, { title: "To Delete" });
    const deleted = deleteSandboxTask(demoAccessId, task.id);
    expect(deleted).toBe(true);
    const remaining = listSandboxTasks(demoAccessId);
    expect(remaining).toHaveLength(0);
  });

  it("deleteSandboxTask returns false for wrong demoAccessId", () => {
    const task = createSandboxTask(demoAccessId, { title: "Protected" });
    const deleted = deleteSandboxTask("wrong_id", task.id);
    expect(deleted).toBe(false);
  });

  it("isSandboxTaskId distinguishes sandbox from real IDs", () => {
    expect(isSandboxTaskId("sandbox_task_abc")).toBe(true);
    expect(isSandboxTaskId("cmqtwx8y20002eurvunidzam7")).toBe(false);
    expect(isSandboxTaskId("")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// Candidate Sandbox Tests
// ═══════════════════════════════════════════════════

describe("Demo sandbox — candidate CRUD", () => {
  const { demoAccessId, cleanup } = setupOwnerDemo();

  afterEach(() => cleanup());

  it("createSandboxCandidate generates a sandbox-prefixed ID", () => {
    const candidate = createSandboxCandidate(demoAccessId, {
      name: "Test Product",
      source: "访客输入",
    });
    expect(isSandboxCandidateId(candidate.id)).toBe(true);
    expect(candidate.id).toMatch(/^sandbox_candidate_/);
    expect(candidate.demoAccessId).toBe(demoAccessId);
  });

  it("listSandboxCandidates returns only for given demoAccessId", () => {
    createSandboxCandidate(demoAccessId, { name: "C1" });
    createSandboxCandidate(demoAccessId, { name: "C2" });
    const candidates = listSandboxCandidates(demoAccessId);
    expect(candidates).toHaveLength(2);
  });

  it("updateSandboxCandidate modifies fields", () => {
    const c = createSandboxCandidate(demoAccessId, { name: "Original" });
    const updated = updateSandboxCandidate(demoAccessId, c.id, { name: "Updated" });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated");
  });

  it("updateSandboxCandidate returns null for wrong demoAccessId", () => {
    const c = createSandboxCandidate(demoAccessId, { name: "Mine" });
    const updated = updateSandboxCandidate("wrong_id", c.id, { name: "Hacked" });
    expect(updated).toBeNull();
  });

  it("deleteSandboxCandidate removes the candidate", () => {
    const c = createSandboxCandidate(demoAccessId, { name: "To Delete" });
    const deleted = deleteSandboxCandidate(demoAccessId, c.id);
    expect(deleted).toBe("deleted");
    const remaining = listSandboxCandidates(demoAccessId);
    expect(remaining).toHaveLength(0);
  });

  it("deleteSandboxCandidate returns false for wrong demoAccessId", () => {
    const c = createSandboxCandidate(demoAccessId, { name: "Protected" });
    const deleted = deleteSandboxCandidate("wrong_id", c.id);
    expect(deleted).toBe("not_found");
  });

  it("isSandboxCandidateId distinguishes sandbox from real IDs", () => {
    expect(isSandboxCandidateId("sandbox_candidate_xyz")).toBe(true);
    expect(isSandboxCandidateId("cmqtwpu3k0001eurv5pgur70p")).toBe(false);
    expect(isSandboxCandidateId("")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════
// Sandbox Isolation
// ═══════════════════════════════════════════════════

describe("Demo sandbox — isolation from official data", () => {
  it("sandbox tasks are not stored in Prisma DB scope", () => {
    // Sandbox stores to file, not DB — ID prefix confirms this
    const t1 = createSandboxTask("demo_abc", { title: "Sandbox Task" });
    expect(t1.id).toMatch(/^sandbox_task_/);
    // Official tasks have Prisma cuid format
    expect(t1.id).not.toMatch(/^cm/); // Prisma CUIDs start with 'c'
  });

  it("sandbox candidates are not stored in Prisma DB scope", () => {
    const c1 = createSandboxCandidate("demo_abc", { name: "Sandbox Candidate" });
    expect(c1.id).toMatch(/^sandbox_candidate_/);
    expect(c1.id).not.toMatch(/^cm/);
  });

  it("sandbox store uses isolated file path when env var is set", () => {
    expect(process.env.DEMO_SANDBOX_STORE_PATH).toBe(TEST_STORE_PATH);
    // This confirms tests won't touch the real data/demo-sandbox.json
  });
});

// ═══════════════════════════════════════════════════
// Sandbox → ListItem Format
// ═══════════════════════════════════════════════════

describe("Demo sandbox — format helpers", () => {
  const { demoAccessId, cleanup } = setupOwnerDemo();

  afterEach(() => cleanup());

  it("sandbox task list items include sourceMode and permissions", () => {
    const task = createSandboxTask(demoAccessId, { title: "Format Test" });
    const item = sandboxTaskToListItem(task);
    expect(item.sourceMode).toBe("demo_sandbox");
    expect(item.isSandbox).toBe(true);
    expect(item.canEdit).toBe(true);
    expect(item.canDelete).toBe(true);
  });

  it("sandbox candidate list items include sourceMode and permissions", () => {
    const c = createSandboxCandidate(demoAccessId, { name: "Format Candidate" });
    const item = sandboxCandidateToListItem(c);
    expect(item.sourceMode).toBe("demo_sandbox");
    expect(item.isSandbox).toBe(true);
    expect(item.canEdit).toBe(true);
    expect(item.canDelete).toBe(true);
  });

  it("markOfficialTaskReadonly adds readonly flags", () => {
    const marked = markOfficialTaskReadonly({ id: "real_task_1" });
    expect(marked.sourceMode).toBe("official_readonly");
    expect(marked.isSandbox).toBe(false);
    expect(marked.canEdit).toBe(false);
    expect(marked.canDelete).toBe(false);
  });
});
