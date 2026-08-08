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

const INITIAL = {
  id: "visitor-a",
  label: "Visitor A",
  expiresAt: null,
  isActive: true,
  quotaMetric: "product_journeys_v1" as const,
  maxProducts: 5,
  usedProducts: 0,
  reservedProducts: 0,
  remainingProducts: 5,
  migrationStatus: "migrated" as const,
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
  it("persists the latest product-journey quota and notifies same-page consumers immediately", () => {
    saveAccessToken("test-token", "demo", INITIAL);

    updateDemoAccessSnapshot({
      ...INITIAL,
      usedProducts: 1,
      remainingProducts: 4,
    });

    expect(getDemoAccessInfo()).toMatchObject({
      usedProducts: 1,
      remainingProducts: 4,
      quotaMetric: "product_journeys_v1",
    });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "qx:demo-access-updated",
    }));
  });

  it("does not roll committed usage backward when a stale response arrives later", () => {
    saveAccessToken("test-token", "demo", {
      ...INITIAL,
      usedProducts: 1,
      remainingProducts: 4,
    });

    updateDemoAccessSnapshot(INITIAL);

    expect(getDemoAccessInfo()).toMatchObject({
      usedProducts: 1,
      remainingProducts: 4,
    });
  });

  it("allows a released in-flight reservation to restore remaining capacity", () => {
    saveAccessToken("test-token", "demo", {
      ...INITIAL,
      reservedProducts: 1,
      remainingProducts: 4,
    });

    updateDemoAccessSnapshot(INITIAL);

    expect(getDemoAccessInfo()).toMatchObject({
      usedProducts: 0,
      reservedProducts: 0,
      remainingProducts: 5,
    });
  });

  it("rejects a snapshot for a different Visitor identity", () => {
    saveAccessToken("test-token", "demo", INITIAL);

    updateDemoAccessSnapshot({
      ...INITIAL,
      id: "visitor-b",
      label: "Visitor B",
      usedProducts: 1,
      remainingProducts: 4,
    });

    expect(getDemoAccessInfo()?.id).toBe("visitor-a");
    expect(getDemoAccessInfo()?.remainingProducts).toBe(5);
  });
});
