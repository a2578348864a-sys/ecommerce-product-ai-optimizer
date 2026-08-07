import React from "react";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let subjectMode: "owner" | "demo" | null = "owner";
let demoId = "visitor-a";

const mockSessionStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value); },
  removeItem: (key: string) => { store.delete(key); },
  clear: () => { store.clear(); },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  get length() { return store.size; },
};

vi.mock("@/lib/client/accessToken", () => ({
  getAccessMode: () => subjectMode,
  getDemoAccessInfo: () => (subjectMode === "demo" ? { id: demoId } : null),
}));

const draft = await import("@/lib/client/useSessionDraft");

const STORE_PREFIX = "qingxuan-workbench:draft:v1";

function keys(): string[] {
  return Array.from(store.keys());
}

/** 用 renderToString 触发一次 hook 挂载（同步执行 useState 懒初始化读取 sessionStorage） */
function mount<T>(renderFn: () => T): T {
  let hookValue: T | null = null;
  function Probe() {
    hookValue = renderFn();
    return React.createElement("div");
  }
  renderToString(React.createElement(Probe));
  if (hookValue === null) throw new Error("hook not captured");
  return hookValue;
}

beforeEach(() => {
  store.clear();
  subjectMode = "owner";
  demoId = "visitor-a";
  vi.useRealTimers();
  vi.stubGlobal("window", { sessionStorage: mockSessionStorage });
  vi.stubGlobal("sessionStorage", mockSessionStorage);
});

describe("useSessionDraft storage helpers", () => {
  it("sessionSubjectKey: owner uses stable identifier, visitor uses demoAccessId", () => {
    expect(draft.sessionSubjectKey()).toBe("owner");
    subjectMode = "demo";
    expect(draft.sessionSubjectKey()).toBe("visitor-a");
    demoId = "visitor-b";
    expect(draft.sessionSubjectKey()).toBe("visitor-b");
  });

  it("clearSessionDraftsForSubject removes only that subject's drafts", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));
    store.set(`${STORE_PREFIX}:owner:research-decision:c1:rev1`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));
    store.set(`${STORE_PREFIX}:demo:creative-handoff:t1:1:0`, JSON.stringify({ schema: STORE_PREFIX, subject: "demo" }));

    draft.clearSessionDraftsForSubject("owner");

    expect(store.size).toBe(1);
    expect(keys()[0]).toContain("demo");
  });

  it("clearSessionDraftsForEntity removes drafts for the given entity and page kind", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t2:1:0`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));
    store.set(`${STORE_PREFIX}:owner:research-decision:t1:rev1`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));

    draft.clearSessionDraftsForEntity("creative-handoff", "t1");

    expect(store.has(`${STORE_PREFIX}:owner:creative-handoff:t2:1:0`)).toBe(true);
    expect(store.has(`${STORE_PREFIX}:owner:research-decision:t1:rev1`)).toBe(true);
    expect(store.has(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`)).toBe(false);
  });

  it("clearAllSessionDrafts removes every draft across all subjects (relogin boundary)", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`, JSON.stringify({ schema: STORE_PREFIX, subject: "owner" }));
    store.set(`${STORE_PREFIX}:demo-a:research-decision:c1:rev1`, JSON.stringify({ schema: STORE_PREFIX, subject: "demo-a" }));
    store.set(`${STORE_PREFIX}:demo-b:candidate-pool:pool:v1`, JSON.stringify({ schema: STORE_PREFIX, subject: "demo-b" }));

    draft.clearAllSessionDrafts();

    expect(store.size).toBe(0);
  });
});

describe("useSessionDraft hook", () => {
  it("restores a matching-revision draft only after revision is confirmed", () => {
    store.set(`${STORE_PREFIX}:owner:research-decision:c1:rev1`, JSON.stringify({
      schema: STORE_PREFIX,
      subject: "owner",
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      data: { productName: "phone stand", step: 2 },
    }));

    // Mount with revision null (not yet known) → draft not exposed
    const h1 = mount(() => draft.useSessionDraft<{ productName: string; step: number }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: null,
      initial: { productName: "", step: 1 },
    }));
    expect(h1.draft).toBeNull();
    expect(h1.restored).toBe(false);

    // Mount with confirmed revision → restored
    const h2 = mount(() => draft.useSessionDraft<{ productName: string; step: number }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { productName: "", step: 1 },
    }));
    expect(h2.restored).toBe(true);
    expect(h2.draft).toEqual({ productName: "phone stand", step: 2 });
  });

  it("clears old-revision draft and flags invalidated instead of restoring", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`, JSON.stringify({
      schema: STORE_PREFIX,
      subject: "owner",
      pageKind: "creative-handoff",
      entityId: "t1",
      revision: "1:0",
      data: { guideStep: 3, selectedIds: ["f1"] },
    }));

    const h = mount(() => draft.useSessionDraft<{ guideStep: number; selectedIds: string[] }>({
      pageKind: "creative-handoff",
      entityId: "t1",
      revision: "1:2",
      initial: { guideStep: 1, selectedIds: [] },
    }));
    expect(h.restored).toBe(false);
    expect(h.draft).toBeNull();
    expect(h.invalidated).toBe(true);
    // Old draft cleared from storage
    expect(store.size).toBe(0);
  });

  it("does not restore across different subjects (owner vs visitor)", () => {
    store.set(`${STORE_PREFIX}:owner:research-decision:c1:rev1`, JSON.stringify({
      schema: STORE_PREFIX, subject: "owner", pageKind: "research-decision", entityId: "c1", revision: "rev1",
      data: { productName: "owner-item" },
    }));

    subjectMode = "demo";
    const h = mount(() => draft.useSessionDraft<{ productName: string }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { productName: "" },
    }));
    expect(h.restored).toBe(false);
    expect(h.draft).toBeNull();
  });

  it("does not restore across different entities (A task vs B task)", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:tA:1:0`, JSON.stringify({
      schema: STORE_PREFIX, subject: "owner", pageKind: "creative-handoff", entityId: "tA", revision: "1:0",
      data: { guideStep: 4, selectedIds: ["fA"] },
    }));

    const h = mount(() => draft.useSessionDraft<{ guideStep: number; selectedIds: string[] }>({
      pageKind: "creative-handoff",
      entityId: "tB",
      revision: "1:0",
      initial: { guideStep: 1, selectedIds: [] },
    }));
    expect(h.restored).toBe(false);
    expect(h.draft).toBeNull();
  });

  it("clears damaged JSON silently", () => {
    store.set(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`, "{bad-json");
    const h = mount(() => draft.useSessionDraft<{ guideStep: number }>({
      pageKind: "creative-handoff",
      entityId: "t1",
      revision: "1:0",
      initial: { guideStep: 1 },
    }));
    expect(h.restored).toBe(false);
    expect(store.size).toBe(0);
  });

  it("SSR safety: helpers do not throw without window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => draft.clearSessionDraftsForSubject("owner")).not.toThrow();
    expect(() => draft.clearSessionDraftsForEntity("creative-handoff", "t1")).not.toThrow();
    expect(() => draft.sessionSubjectKey()).not.toThrow();
  });

  it("save does not write default values before any user edit (no fake saved state)", () => {
    vi.useFakeTimers();
    const h = mount(() => draft.useSessionDraft<{ name: string }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { name: "" },
    }));
    act(() => { h.save({ name: "" }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(store.size).toBe(0);
    expect(h.saved).toBe(false);
    vi.useRealTimers();
  });

  it("save writes after a real change (debounced)", () => {
    vi.useFakeTimers();
    const h = mount(() => draft.useSessionDraft<{ name: string }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { name: "" },
    }));
    act(() => { h.save({ name: "phone stand" }); });
    act(() => { vi.advanceTimersByTime(500); });

    const raw = store.get(`${STORE_PREFIX}:owner:research-decision:c1:rev1`);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}");
    expect(parsed.schema).toBe(STORE_PREFIX);
    expect(parsed.subject).toBe("owner");
    expect(parsed.pageKind).toBe("research-decision");
    expect(parsed.entityId).toBe("c1");
    expect(parsed.data).toEqual({ name: "phone stand" });
    vi.useRealTimers();
  });

  it("clear removes the stored draft and suppresses re-write echo", () => {
    vi.useFakeTimers();
    const h = mount(() => draft.useSessionDraft<{ name: string }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { name: "" },
    }));
    act(() => { h.save({ name: "phone stand" }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(store.size).toBe(1);

    act(() => { h.clear(); });
    expect(store.size).toBe(0);
    expect(h.restored).toBe(false);

    // Component effect echo re-saves the same value → suppressed within window
    act(() => { h.save({ name: "phone stand" }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(store.size).toBe(0);
    vi.useRealTimers();
  });

  it("flush writes immediately (used before commit)", () => {
    const h = mount(() => draft.useSessionDraft<{ name: string }>({
      pageKind: "creative-handoff",
      entityId: "t1",
      revision: "1:0",
      initial: { name: "" },
    }));
    act(() => { h.flush({ name: "ready" }); });
    expect(store.has(`${STORE_PREFIX}:owner:creative-handoff:t1:1:0`)).toBe(true);
  });

  it("after clear, a later distinct edit writes again", () => {
    vi.useFakeTimers();
    const h = mount(() => draft.useSessionDraft<{ name: string }>({
      pageKind: "research-decision",
      entityId: "c1",
      revision: "rev1",
      initial: { name: "" },
    }));
    act(() => { h.save({ name: "phone stand" }); });
    act(() => { vi.advanceTimersByTime(500); });
    act(() => { h.clear(); });
    expect(store.size).toBe(0);

    // After the echo window, a genuinely new edit writes again
    act(() => { vi.advanceTimersByTime(1600); });
    act(() => { h.save({ name: "pet bowl" }); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(store.size).toBe(1);
    const parsed = JSON.parse(store.get(`${STORE_PREFIX}:owner:research-decision:c1:rev1`) || "{}");
    expect(parsed.data).toEqual({ name: "pet bowl" });
    vi.useRealTimers();
  });
});
