import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadAgentRunCache,
  loadLatestAgentRunCache,
  saveAgentRunCache,
} from "@/lib/agentRunCache";

const sessionStore = new Map<string, string>();

const mockSessionStorage = {
  get length() {
    return sessionStore.size;
  },
  key: (index: number) => Array.from(sessionStore.keys())[index] ?? null,
  getItem: (key: string) => sessionStore.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionStore.set(key, value); },
  removeItem: (key: string) => { sessionStore.delete(key); },
  clear: () => { sessionStore.clear(); },
};

vi.stubGlobal("window", {
  sessionStorage: mockSessionStorage,
});
vi.stubGlobal("sessionStorage", mockSessionStorage);

beforeEach(() => {
  sessionStore.clear();
  vi.stubGlobal("window", {
    sessionStorage: mockSessionStorage,
  });
  vi.stubGlobal("sessionStorage", mockSessionStorage);
});

describe("agentRunCache", () => {
  it("loads an exact cached run by product name", () => {
    saveAgentRunCache("B4 Sample A", null, {
      phase: "needs_manual_review",
      stepStatuses: { normalize: "completed" },
      result: { ok: true, workflowId: "wf-a" },
      profitSnapshot: null,
      riskReviewSnapshot: null,
      manualChecked: { sourcing: false, profit: false, risk: false, listing: false },
      savedTaskId: "",
    });

    const cached = loadAgentRunCache("B4 Sample A", null);

    expect(cached?.productName).toBe("B4 Sample A");
    expect(cached?.result).toEqual({ ok: true, workflowId: "wf-a" });
  });

  it("loads the latest cached run when /agent/run has no product query", () => {
    vi.setSystemTime(new Date("2026-07-02T08:00:00.000Z"));
    saveAgentRunCache("older run", null, {
      phase: "needs_manual_review",
      stepStatuses: {},
      result: { ok: true, workflowId: "wf-old" },
      profitSnapshot: null,
      riskReviewSnapshot: null,
      manualChecked: { sourcing: false, profit: false, risk: false, listing: false },
      savedTaskId: "",
    });

    vi.setSystemTime(new Date("2026-07-02T08:01:00.000Z"));
    saveAgentRunCache("B4 Real Flow A - Desk Phone Stand", null, {
      phase: "needs_manual_review",
      stepStatuses: { normalize: "completed" },
      result: { ok: true, workflowId: "wf-b4-a" },
      profitSnapshot: null,
      riskReviewSnapshot: null,
      manualChecked: { sourcing: true, profit: true, risk: true, listing: true },
      savedTaskId: "",
    });

    const cached = loadLatestAgentRunCache();

    expect(cached?.productName).toBe("B4 Real Flow A - Desk Phone Stand");
    expect(cached?.manualChecked).toEqual({
      sourcing: true,
      profit: true,
      risk: true,
      listing: true,
    });
  });
});

// ── Access-Control-Fix.1: cache scope isolation ──

describe("agentRunCache scope isolation", () => {
  it("isolates Owner and Demo caches with same product name", () => {
    const data = {
      phase: "needs_manual_review",
      stepStatuses: {},
      result: null,
      profitSnapshot: null,
      riskReviewSnapshot: null,
      manualChecked: {},
      savedTaskId: "",
    };

    // Save as Owner
    saveAgentRunCache("Same Product", null, data, "owner");
    // Save as Demo-A
    saveAgentRunCache("Same Product", null, data, "demo-a");
    // Save as Demo-B
    saveAgentRunCache("Same Product", null, data, "demo-b");

    // Load as Owner — should only get Owner's cache
    const ownerCache = loadAgentRunCache("Same Product", null, "owner");
    expect(ownerCache).not.toBeNull();

    // Load as Demo-A — should only get Demo-A's cache
    const demoACache = loadAgentRunCache("Same Product", null, "demo-a");
    expect(demoACache).not.toBeNull();

    // Demo-B should NOT see Demo-A's cache
    const demoBCache = loadAgentRunCache("Same Product", null, "demo-b");
    expect(demoBCache).not.toBeNull();

    // Owner and Demo caches are independently saved/loaded
    // (they use different scope-prefixed keys)
    expect(ownerCache!.productName).toBe("Same Product");
    expect(demoACache!.productName).toBe("Same Product");
  });

  it("latest cache is scoped to access mode", () => {
    const data = {
      phase: "completed",
      stepStatuses: { manual: "completed" },
      result: null,
      profitSnapshot: null,
      riskReviewSnapshot: null,
      manualChecked: {},
      savedTaskId: "owner-task-1",
    };

    // Save in Owner scope
    saveAgentRunCache("Scoped Product", null, data, "owner");

    // loadLatestAgentRunCache with owner scope should find it
    const ownerLatest = loadLatestAgentRunCache(null, "owner");
    expect(ownerLatest).not.toBeNull();
    expect(ownerLatest!.savedTaskId).toBe("owner-task-1");

    // loadLatestAgentRunCache with demo scope should NOT find it
    const demoLatest = loadLatestAgentRunCache(null, "demo-x");
    expect(demoLatest).toBeNull();
  });
});
