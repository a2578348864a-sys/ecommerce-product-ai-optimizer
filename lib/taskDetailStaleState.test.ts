/**
 * Access-Control-Fix.1-StaleState-Guard — Race condition simulation
 *
 * Verifies that a slow 404 response does NOT overwrite a fast success response,
 * and that the final state is consistent, not a stale mix.
 */
import { describe, expect, it, vi } from "vitest";

// ── Simulated request id guard (extracted from TaskRecordDetail logic) ──

function createRequestGuard() {
  let reqId = 0;

  return {
    nextId(): number {
      reqId += 1;
      return reqId;
    },
    isCurrent(id: number): boolean {
      return id === reqId;
    },
  };
}

// Simulate the state machine used in loadRecord
type LoadState = {
  record: unknown | null;
  error: string;
  loading: boolean;
};

function createLoadState(): LoadState {
  return { record: null, error: "", loading: true };
}

async function simulateRequest(
  guard: ReturnType<typeof createRequestGuard>,
  state: LoadState,
  opts: {
    status: number;
    ok: boolean;
    data?: unknown;
    delayMs: number;
  },
) {
  const id = guard.nextId();
  state.loading = true;
  state.error = "";
  state.record = null;

  await new Promise((r) => setTimeout(r, opts.delayMs));

  // Stale response check
  if (!guard.isCurrent(id)) return;

  if (!opts.ok) {
    state.record = null;
    state.error = "任务详情读取失败。";
    return;
  }
  state.record = opts.data;
  state.error = "";
}

// ── Tests ─────────────────────────────────────────

describe("TaskRecordDetail stale state guard", () => {
  it("slow 404 does not overwrite fast success", async () => {
    const guard = createRequestGuard();
    const state = createLoadState();

    // Start slow 404 (will finish after fast success)
    const slow404 = simulateRequest(guard, state, {
      status: 404,
      ok: false,
      delayMs: 50,
    });

    // Start fast success shortly after
    await new Promise((r) => setTimeout(r, 5));
    await simulateRequest(guard, state, {
      status: 200,
      ok: true,
      data: { id: "task-1", title: "Fast Success" },
      delayMs: 10,
    });

    // Wait for slow 404 to complete
    await slow404;

    // Final state must be the fast success, NOT the slow 404
    expect(state.record).toEqual({ id: "task-1", title: "Fast Success" });
    expect(state.error).toBe("");
  });

  it("slow success does not overwrite fast 404", async () => {
    const guard = createRequestGuard();
    const state = createLoadState();

    // Start slow success
    const slow200 = simulateRequest(guard, state, {
      status: 200,
      ok: true,
      data: { id: "leaked-task", title: "SHOULD NOT APPEAR" },
      delayMs: 50,
    });

    // Start fast 404
    await new Promise((r) => setTimeout(r, 5));
    await simulateRequest(guard, state, {
      status: 404,
      ok: false,
      delayMs: 10,
    });

    await slow200;

    // Final state must be 404 (empty), NOT the slow leaked task
    expect(state.record).toBeNull();
    expect(state.error).toBe("任务详情读取失败。");
  });

  it("sequential requests (no race) both update correctly", async () => {
    const guard = createRequestGuard();
    const state = createLoadState();

    // First request succeeds
    await simulateRequest(guard, state, {
      status: 200,
      ok: true,
      data: { id: "task-a", title: "Task A" },
      delayMs: 5,
    });
    expect(state.record).toEqual({ id: "task-a", title: "Task A" });

    // Second request succeeds
    await simulateRequest(guard, state, {
      status: 200,
      ok: true,
      data: { id: "task-b", title: "Task B" },
      delayMs: 5,
    });
    expect(state.record).toEqual({ id: "task-b", title: "Task B" });
  });

  it("Demo 404 + fast Owner success on different task — final should be Owner", async () => {
    const guard = createRequestGuard();
    const state = createLoadState();

    // Simulate Demo navigating to Owner URL → gets 404 (slow)
    const demo404 = simulateRequest(guard, state, {
      status: 404,
      ok: false,
      delayMs: 40,
    });

    // Owner navigates to their own task → gets 200 (fast)
    await new Promise((r) => setTimeout(r, 5));
    await simulateRequest(guard, state, {
      status: 200,
      ok: true,
      data: { id: "owner-task", title: "Owner Task" },
      delayMs: 10,
    });

    await demo404;

    // Final state = Owner task, Demo 404 does not overwrite
    expect(state.record).toEqual({ id: "owner-task", title: "Owner Task" });
    expect(state.error).toBe("");
  });

  it("error response always clears record to null", async () => {
    const guard = createRequestGuard();
    const state = createLoadState();

    // Set initial record
    state.record = { id: "previous", title: "Previous Task" };

    await simulateRequest(guard, state, {
      status: 404,
      ok: false,
      delayMs: 5,
    });

    // After 404, record must be null (cleared)
    expect(state.record).toBeNull();
    expect(state.error).toBeTruthy();
  });
});
