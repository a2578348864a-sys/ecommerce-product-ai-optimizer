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

const localDraft = await import("@/hooks/useLocalDraft");

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage: mockLocalStorage });
  vi.stubGlobal("localStorage", mockLocalStorage);
});

describe("local draft storage", () => {
  it("writes and reads a versioned draft payload", () => {
    localDraft.writeLocalDraft("draft:test", { name: "phone stand" });

    const raw = store.get("draft:test");
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw || "{}");
    expect(parsed.version).toBe(1);
    expect(typeof parsed.updatedAt).toBe("number");
    expect(parsed.value).toEqual({ name: "phone stand" });

    expect(localDraft.readLocalDraft("draft:test", { name: "" })).toEqual({
      restored: true,
      updatedAt: parsed.updatedAt,
      value: { name: "phone stand" },
    });
  });

  it("clearLocalDraft removes only the requested key", () => {
    localDraft.writeLocalDraft("draft:test", { name: "phone stand" });
    localDraft.writeLocalDraft("draft:other", { name: "pet bowl" });

    localDraft.clearLocalDraft("draft:test");

    expect(store.has("draft:test")).toBe(false);
    expect(store.has("draft:other")).toBe(true);
  });

  it("clears expired drafts", () => {
    localDraft.writeLocalDraft("draft:test", { name: "old" }, { ttlMs: -1 });

    const result = localDraft.readLocalDraft("draft:test", { name: "" }, { ttlMs: -1 });

    expect(result.restored).toBe(false);
    expect(result.value).toEqual({ name: "" });
    expect(store.has("draft:test")).toBe(false);
  });

  it("clears version-mismatched drafts", () => {
    localDraft.writeLocalDraft("draft:test", { name: "old-version" }, { version: 1 });

    const result = localDraft.readLocalDraft("draft:test", { name: "" }, { version: 2 });

    expect(result.restored).toBe(false);
    expect(result.value).toEqual({ name: "" });
    expect(store.has("draft:test")).toBe(false);
  });

  it("clears damaged JSON without throwing", () => {
    store.set("draft:test", "{bad-json");

    expect(() => localDraft.readLocalDraft("draft:test", { name: "" })).not.toThrow();
    expect(localDraft.readLocalDraft("draft:test", { name: "" }).restored).toBe(false);
    expect(store.has("draft:test")).toBe(false);
  });

  it("SSR safety: helpers do not throw without window", () => {
    vi.stubGlobal("window", undefined);

    expect(() => localDraft.readLocalDraft("draft:test", { name: "" })).not.toThrow();
    expect(() => localDraft.writeLocalDraft("draft:test", { name: "x" })).not.toThrow();
    expect(() => localDraft.clearLocalDraft("draft:test")).not.toThrow();
  });

  it("useLocalDraft has a safe SSR initial render", () => {
    let observed: unknown;

    function Probe() {
      observed = localDraft.useLocalDraft({
        storageKey: "draft:test",
        initialValue: { name: "" },
      });
      return React.createElement("div");
    }

    renderToString(React.createElement(Probe));

    expect(typeof observed).toBe("object");
    expect((observed as { draftValue: { name: string } }).draftValue).toEqual({ name: "" });
    expect((observed as { restored: boolean }).restored).toBe(false);
  });
});
