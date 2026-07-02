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
