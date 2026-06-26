/**
 * Phase System-Recovery.2 — buildAccessHeaders() Tests
 *
 * Tests the unified frontend auth header builder.
 * Does NOT: touch real storage, call AI, use real tokens.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";

// ── Mock sessionStorage ────────────────────────────

function mockSessionStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (_index: number) => null,
  };
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("window", { sessionStorage: storage });
  return { store, storage };
}

// We need to import after mocking
let buildAccessHeaders: () => Record<string, string>;
let saveAccessToken: (token: string, mode: string) => void;
let clearAccessSession: () => void;

beforeEach(async () => {
  vi.resetModules();
  const { store } = mockSessionStorage();
  store.clear();
  const mod = await import("@/lib/client/accessToken");
  buildAccessHeaders = mod.buildAccessHeaders;
  saveAccessToken = mod.saveAccessToken;
  clearAccessSession = mod.clearAccessSession;
});

describe("buildAccessHeaders", () => {
  it("returns both x-access-token and x-access-password when token exists", () => {
    saveAccessToken("tok_test123", "owner");
    const headers = buildAccessHeaders();
    expect(headers["x-access-token"]).toBe("tok_test123");
    expect(headers["x-access-password"]).toBe("tok_test123");
    expect(Object.keys(headers)).toHaveLength(2);
  });

  it("returns empty object when no token is stored", () => {
    clearAccessSession();
    const headers = buildAccessHeaders();
    expect(headers).toEqual({});
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it("does not include x-access-token if token is empty", () => {
    const headers = buildAccessHeaders();
    expect(headers["x-access-token"]).toBeUndefined();
    expect(headers["x-access-password"]).toBeUndefined();
  });

  it("returns demo token headers correctly", () => {
    saveAccessToken("tok_demo456", "demo", {
      id: "demo_test",
      label: "test",
      expiresAt: null,
      maxAiCalls: 10,
      usedAiCalls: 0,
      remainingAiCalls: 10,
    });
    const headers = buildAccessHeaders();
    expect(headers["x-access-token"]).toBe("tok_demo456");
    expect(headers["x-access-password"]).toBe("tok_demo456");
  });

  it("does not leak token in header names", () => {
    saveAccessToken("tok_secret", "owner");
    const headers = buildAccessHeaders();
    // Header keys should be exact, not contain token values
    expect(Object.keys(headers)).toEqual(["x-access-token", "x-access-password"]);
  });
});
