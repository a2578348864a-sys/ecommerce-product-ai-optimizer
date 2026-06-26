import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createDemoAccess,
  saveDemoAccessStore,
  loadDemoAccessStore,
  type DemoAccessStore,
} from "@/lib/server/demoAccess";
import {
  createOwnerSession,
  createDemoSession,
} from "@/lib/server/accessSession";
import {
  buildDemoAccessSnapshot,
  ensureDemoAiQuota,
  consumeDemoAiCalls,
  getLatestDemoSnapshot,
  type GuardResult,
} from "@/lib/server/demoGuard";
import type { AccessContext } from "@/lib/server/accessPassword";

function emptyStore(): DemoAccessStore {
  return { version: 1, accesses: [] };
}

function makeOwnerCtx(): AccessContext {
  const session = createOwnerSession();
  return { mode: "owner", token: session.token };
}

function makeDemoCtx(demoAccessId: string): AccessContext {
  const session = createDemoSession(demoAccessId);
  return {
    mode: "demo",
    token: session.token,
    demoAccessId,
    isActive: true,
    isExpired: false,
    remainingAiCalls: 5,
  };
}

// ── Snapshot ────────────────────────────────────

describe("buildDemoAccessSnapshot", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("builds correct snapshot from record", () => {
    const { record } = createDemoAccess({ label: "Test", hours: 24, maxAiCalls: 5 });
    const snap = buildDemoAccessSnapshot(record);
    expect(snap.id).toBe(record.id);
    expect(snap.remainingAiCalls).toBe(5);
    expect(snap.usedAiCalls).toBe(0);
    expect(snap.maxAiCalls).toBe(5);
    expect(snap.isActive).toBe(true);
  });
});

// ── ensureDemoAiQuota ───────────────────────────

describe("ensureDemoAiQuota", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("Owner always passes", () => {
    const ctx = makeOwnerCtx();
    expect(ensureDemoAiQuota(ctx, 100)).toEqual({ ok: true });
  });

  it("Demo with enough quota passes", () => {
    const { record } = createDemoAccess({ label: "A", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    expect(ensureDemoAiQuota(ctx, 3)).toEqual({ ok: true });
  });

  it("Demo with insufficient quota fails", () => {
    const { record } = createDemoAccess({ label: "B", hours: 24, maxAiCalls: 2 });
    const ctx = makeDemoCtx(record.id);
    const result = ensureDemoAiQuota(ctx, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("demo_ai_quota_exceeded");
    }
  });

  it("Demo with exactly 0 remaining fails", () => {
    const { record } = createDemoAccess({ label: "C", hours: 24, maxAiCalls: 0 });
    const ctx = makeDemoCtx(record.id);
    const result = ensureDemoAiQuota(ctx, 1);
    expect(result.ok).toBe(false);
  });

  it("expired demo fails", () => {
    const store = loadDemoAccessStore();
    store.accesses.push({
      id: "demo_expired",
      label: "Expired",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: "2020-01-01T00:00:00.000Z",
      maxAiCalls: 5,
      usedAiCalls: 0,
      isActive: true,
      createdAt: "2020-01-01T00:00:00.000Z",
      lastUsedAt: null,
      notes: "",
    });
    saveDemoAccessStore(store);
    const ctx = makeDemoCtx("demo_expired");
    const result = ensureDemoAiQuota(ctx, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("demo_access_expired");
  });

  it("inactive demo fails", () => {
    const store = loadDemoAccessStore();
    store.accesses.push({
      id: "demo_inactive",
      label: "Inactive",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 0,
      isActive: false,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    });
    saveDemoAccessStore(store);
    const ctx = makeDemoCtx("demo_inactive");
    const result = ensureDemoAiQuota(ctx, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("demo_access_inactive");
  });
});

// ── consumeDemoAiCalls ──────────────────────────

describe("consumeDemoAiCalls", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("Owner returns null (no consumption)", () => {
    const ctx = makeOwnerCtx();
    expect(consumeDemoAiCalls(ctx, 1)).toBeNull();
  });

  it("Demo consumes and returns updated snapshot", () => {
    const { record } = createDemoAccess({ label: "D", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    const snap = consumeDemoAiCalls(ctx, 1);
    expect(snap).not.toBeNull();
    expect(snap!.usedAiCalls).toBe(1);
    expect(snap!.remainingAiCalls).toBe(4);
  });

  it("consuming multiple works", () => {
    const { record } = createDemoAccess({ label: "E", hours: 24, maxAiCalls: 10 });
    const ctx = makeDemoCtx(record.id);
    const snap = consumeDemoAiCalls(ctx, 3);
    expect(snap!.usedAiCalls).toBe(3);
    expect(snap!.remainingAiCalls).toBe(7);
  });

  it("consuming beyond max is prevented by file I/O", () => {
    const { record } = createDemoAccess({ label: "F", hours: 24, maxAiCalls: 2 });
    const ctx = makeDemoCtx(record.id);
    consumeDemoAiCalls(ctx, 2); // use all
    const snap = consumeDemoAiCalls(ctx, 1); // try one more
    expect(snap!.usedAiCalls).toBe(3); // file allows it, guard should check first
    expect(snap!.remainingAiCalls).toBe(0);
  });
});

// ── getLatestDemoSnapshot ───────────────────────

describe("getLatestDemoSnapshot", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("Owner returns null", () => {
    expect(getLatestDemoSnapshot(makeOwnerCtx())).toBeNull();
  });

  it("Demo returns snapshot", () => {
    const { record } = createDemoAccess({ label: "G", hours: 24, maxAiCalls: 5 });
    const snap = getLatestDemoSnapshot(makeDemoCtx(record.id));
    expect(snap).not.toBeNull();
    expect(snap!.remainingAiCalls).toBe(5);
  });
});
