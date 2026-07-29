import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDemoAccessInfo,
  saveAccessToken,
  updateDemoAccessSnapshot,
} from "@/lib/client/accessToken";

const values = new Map<string, string>();
const dispatchEvent = vi.fn();

const storage = {
  get length() { return values.size; },
  key: (index: number) => [...values.keys()][index] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
};

beforeEach(() => {
  values.clear();
  dispatchEvent.mockClear();
  vi.stubGlobal("window", {
    sessionStorage: storage,
    dispatchEvent,
  });
  vi.stubGlobal("CustomEvent", class {
    constructor(public type: string, public init: unknown) {}
  });
});

describe("updateDemoAccessSnapshot", () => {
  it("persists the latest AI-job quota and notifies same-page consumers immediately", () => {
    saveAccessToken("test-token", "demo", {
      id: "visitor-a",
      label: "Visitor A",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 0,
      remainingAiCalls: 5,
    });

    updateDemoAccessSnapshot({
      id: "visitor-a",
      label: "Visitor A",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
      quotaMetric: "ai_jobs_v1",
      maxAiJobs: 5,
      usedAiJobs: 1,
      remainingAiJobs: 4,
    });

    expect(getDemoAccessInfo()).toMatchObject({
      usedAiCalls: 1,
      remainingAiCalls: 4,
      quotaMetric: "ai_jobs_v1",
    });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "qx:demo-access-updated",
    }));
  });

  it("does not roll quota backward when a stale error response arrives later", () => {
    saveAccessToken("test-token", "demo", {
      id: "visitor-a",
      label: "Visitor A",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
    });

    updateDemoAccessSnapshot({
      id: "visitor-a",
      label: "Visitor A",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 0,
      remainingAiCalls: 5,
    });

    expect(getDemoAccessInfo()).toMatchObject({
      usedAiCalls: 1,
      remainingAiCalls: 4,
    });
  });

  it("rejects a snapshot for a different Visitor identity", () => {
    saveAccessToken("test-token", "demo", {
      id: "visitor-a",
      label: "Visitor A",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 0,
      remainingAiCalls: 5,
    });

    updateDemoAccessSnapshot({
      id: "visitor-b",
      label: "Visitor B",
      expiresAt: null,
      maxAiCalls: 5,
      usedAiCalls: 1,
      remainingAiCalls: 4,
    });

    expect(getDemoAccessInfo()?.id).toBe("visitor-a");
    expect(getDemoAccessInfo()?.remainingAiCalls).toBe(5);
  });
});
