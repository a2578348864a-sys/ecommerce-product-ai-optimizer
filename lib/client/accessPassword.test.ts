import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
};

vi.stubGlobal("window", { localStorage: mockLocalStorage });
vi.stubGlobal("localStorage", mockLocalStorage);

const accessPassword = await import("@/lib/client/accessPassword");

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage: mockLocalStorage });
  vi.stubGlobal("localStorage", mockLocalStorage);
});

describe("accessPassword client tools", () => {
  it("uses the unified v1 storage key", () => {
    expect(accessPassword.ACCESS_PASSWORD_STORAGE_KEY).toBe("qx:access-password:v1");
  });

  it("saveAccessPassword stores the v1 payload shape", () => {
    accessPassword.saveAccessPassword("test-password-123");

    const raw = store.get("qx:access-password:v1");
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw || "{}");
    expect(parsed.version).toBe(1);
    expect(parsed.value).toBe("test-password-123");
    expect(typeof parsed.updatedAt).toBe("number");
    expect(typeof parsed.expiresAt).toBe("number");
    expect(parsed.expiresAt).toBeGreaterThan(parsed.updatedAt);
  });

  it("getValidAccessPassword returns a saved password before TTL expires", () => {
    accessPassword.saveAccessPassword("valid-pwd");
    expect(accessPassword.getValidAccessPassword()).toBe("valid-pwd");
    expect(accessPassword.isAccessPasswordExpired()).toBe(false);
  });

  it("getValidAccessPassword clears and rejects an expired password", () => {
    accessPassword.saveAccessPassword("expired-pwd", -1);

    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(store.has("qx:access-password:v1")).toBe(false);
    expect(accessPassword.isAccessPasswordExpired()).toBe(true);
  });

  it("migrates valid legacy qingxuan-pwd keys to the unified key", () => {
    store.set("qingxuan-pwd", "legacy-pwd");
    store.set("qingxuan-pwd-expires", String(Date.now() + 60_000));

    expect(accessPassword.getValidAccessPassword()).toBe("legacy-pwd");
    expect(store.has("qx:access-password:v1")).toBe(true);
    expect(store.has("qingxuan-pwd")).toBe(false);
    expect(store.has("qingxuan-pwd-expires")).toBe(false);
  });

  it("clears expired legacy keys", () => {
    store.set("qingxuan-pwd", "legacy-pwd");
    store.set("qingxuan-pwd-expires", String(Date.now() - 60_000));

    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(store.has("qx:access-password:v1")).toBe(false);
    expect(store.has("qingxuan-pwd")).toBe(false);
    expect(store.has("qingxuan-pwd-expires")).toBe(false);
  });

  it("clears damaged JSON without throwing", () => {
    store.set("qx:access-password:v1", "{not-json");

    expect(() => accessPassword.getValidAccessPassword()).not.toThrow();
    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(store.has("qx:access-password:v1")).toBe(false);
  });

  it("empty password is not stored as valid", () => {
    accessPassword.saveAccessPassword("   ");

    expect(accessPassword.getValidAccessPassword()).toBe("");
    expect(accessPassword.canRequestWithAccessPassword(true, "   ")).toBe(false);
  });

  it("SSR safety: storage helpers do not throw when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(() => accessPassword.getValidAccessPassword()).not.toThrow();
    expect(() => accessPassword.saveAccessPassword("pwd")).not.toThrow();
    expect(() => accessPassword.clearAccessPassword()).not.toThrow();
    expect(accessPassword.getValidAccessPassword()).toBe("");
  });

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
});
