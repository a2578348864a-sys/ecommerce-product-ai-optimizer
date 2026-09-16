import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionStore = new Map<string, string>();
const localStore = new Map<string, string>();

const mockSessionStorage = {
  getItem: (key: string) => sessionStore.get(key) ?? null,
  setItem: (key: string, value: string) => { sessionStore.set(key, value); },
  removeItem: (key: string) => { sessionStore.delete(key); },
  clear: () => { sessionStore.clear(); },
};

const mockLocalStorage = {
  getItem: (key: string) => localStore.get(key) ?? null,
  setItem: (key: string, value: string) => { localStore.set(key, value); },
  removeItem: (key: string) => { localStore.delete(key); },
  clear: () => { localStore.clear(); },
};

vi.stubGlobal("window", {
  sessionStorage: mockSessionStorage,
  localStorage: mockLocalStorage,
});
vi.stubGlobal("sessionStorage", mockSessionStorage);
vi.stubGlobal("localStorage", mockLocalStorage);

const accessPassword = await import("@/lib/client/accessPassword");

beforeEach(() => {
  sessionStore.clear();
  localStore.clear();
  vi.stubGlobal("window", {
    sessionStorage: mockSessionStorage,
    localStorage: mockLocalStorage,
  });
  vi.stubGlobal("sessionStorage", mockSessionStorage);
  vi.stubGlobal("localStorage", mockLocalStorage);
});

describe("accessPassword client tools (sessionStorage)", () => {
  it("uses the unified v1 storage key for backward compat reference", () => {
    expect(accessPassword.ACCESS_PASSWORD_STORAGE_KEY).toBe("qx:access-password:v1");
  });

  // ── Write / Read ──

  it("saveAccessPassword writes to sessionStorage, NOT localStorage", () => {
    accessPassword.saveAccessPassword("test-password-123");

    // Session storage should have the password
    expect(sessionStore.has("qx:access-password:session:v2")).toBe(true);
    expect(sessionStore.get("qx:access-password:session:v2")).toBe("test-password-123");

    // LocalStorage should NOT have it
    expect(localStore.has("qx:access-password:session:v2")).toBe(false);
  });

  it("getValidAccessPassword returns saved password", () => {
    accessPassword.saveAccessPassword("valid-pwd");
    expect(accessPassword.getValidAccessPassword()).toBe("valid-pwd");
    expect(accessPassword.isAccessPasswordExpired()).toBe(false);
  });

  it("getAccessPasswordExpiresAt returns a future timestamp after save", () => {
    accessPassword.saveAccessPassword("valid-pwd");
    const expiresAt = accessPassword.getAccessPasswordExpiresAt();
    expect(typeof expiresAt).toBe("number");
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  // ── Expiry ──

  it("getValidAccessPassword returns empty when nothing saved", () => {
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  it("getValidAccessPassword rejects an expired password and cleans sessionStorage", () => {
    accessPassword.saveAccessPassword("expired-pwd", -1);
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
    expect(sessionStore.has("qx:access-password:session:v2")).toBe(false);
  });

  // ── Clear ──

  it("clearAccessPassword clears sessionStorage and old localStorage keys", () => {
    accessPassword.saveAccessPassword("clear-me");
    expect(accessPassword.getValidAccessPassword()).toBe("clear-me");

    accessPassword.clearAccessPassword();
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
    expect(accessPassword.getAccessPasswordExpiresAt()).toBeNull();
    expect(sessionStore.has("qx:access-password:session:v2")).toBe(false);
    expect(sessionStore.has("qx:access-expires:session:v2")).toBe(false);
  });

  it("clearAccessPassword also cleans up legacy localStorage keys", () => {
    // Put old keys in localStorage
    localStore.set("qx:access-password:v1", "old");
    localStore.set("qingxuan-pwd", "old-legacy");
    localStore.set("qingxuan-pwd-expires", "9999999999999");

    accessPassword.clearAccessPassword();

    expect(localStore.has("qx:access-password:v1")).toBe(false);
    expect(localStore.has("qingxuan-pwd")).toBe(false);
    expect(localStore.has("qingxuan-pwd-expires")).toBe(false);
  });

  // ── Empty password ──

  it("empty/whitespace password is not stored as valid", () => {
    accessPassword.saveAccessPassword("   ");
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.canRequestWithAccessPassword(true, "   ")).toBe(false);
  });

  // ── Refresh simulation ──

  it("survives refresh within same tab (sessionStorage persists)", () => {
    accessPassword.saveAccessPassword("refresh-survivor");

    // Simulate refresh: the password is still in sessionStorage
    // A new call to getValidAccessPassword reads it back
    expect(accessPassword.getValidAccessPassword()).toBe("refresh-survivor");
    expect(accessPassword.getStoredAccessPassword()).toBe("refresh-survivor");
  });

  // ── Tab close simulation ──

  it("does NOT survive tab close (clear sessionStorage = locked)", () => {
    accessPassword.saveAccessPassword("tab-closed");

    // Simulate tab close: clear sessionStorage
    sessionStore.clear();

    // After "reopening", password should be gone
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  // ── No localStorage dependency ──

  it("does NOT read old localStorage keys as unlock authority", () => {
    // Put old-style password in localStorage
    localStore.set("qx:access-password:v1", JSON.stringify({
      version: 1,
      value: "old-local-pwd",
      updatedAt: Date.now(),
      expiresAt: Date.now() + 999999,
    }));

    // Should NOT read it — only sessionStorage matters
    expect(accessPassword.getValidAccessPassword()).toBe("");
  });

  // ── Aliases ──

  it("getStoredAccessPassword / setStoredAccessPassword are aliases", () => {
    accessPassword.setStoredAccessPassword("alias-test");
    expect(accessPassword.getStoredAccessPassword()).toBe("alias-test");
    accessPassword.clearStoredAccessPassword();
    expect(accessPassword.getStoredAccessPassword()).toBe("");
  });

  // ── Hook compatibility ──

  it("useAccessPassword keeps old array destructuring compatible on initial render", () => {
    let observed: unknown;

    function Probe() {
      observed = accessPassword.useAccessPassword();
      return React.createElement("div");
    }

    renderToString(React.createElement(Probe));

    expect(Array.isArray(observed)).toBe(true);
    expect((observed as unknown[])[0]).toBe("");
    expect(typeof (observed as unknown[])[1]).toBe("function");
    expect((observed as unknown[])[2]).toBe(false);
    expect(typeof (observed as unknown[])[3]).toBe("function");
  });

  it("canRequestWithAccessPassword blocks until hydrated and allows non-empty passwords", () => {
    expect(accessPassword.canRequestWithAccessPassword(false, "saved-password")).toBe(false);
    expect(accessPassword.canRequestWithAccessPassword(true, "   ")).toBe(false);
    expect(accessPassword.canRequestWithAccessPassword(true, "saved-password")).toBe(true);
  });

  // ── SSR safety ──

  it("SSR safety: does not throw when window is unavailable", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("sessionStorage", undefined);
    vi.stubGlobal("localStorage", undefined);

    expect(() => accessPassword.getValidAccessPassword()).not.toThrow();
    expect(() => accessPassword.saveAccessPassword("pwd")).not.toThrow();
    expect(() => accessPassword.clearAccessPassword()).not.toThrow();
    expect(accessPassword.getValidAccessPassword()).toBe("");

    // Restore
    vi.stubGlobal("window", {
      sessionStorage: mockSessionStorage,
      localStorage: mockLocalStorage,
    });
    vi.stubGlobal("sessionStorage", mockSessionStorage);
    vi.stubGlobal("localStorage", mockLocalStorage);
  });
});
