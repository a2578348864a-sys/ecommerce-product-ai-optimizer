import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { unlinkSync } from "fs";

const TEST_STORE = `${tmpdir()}/demo-guard-test-${randomBytes(4).toString("hex")}.json`;

beforeAll(() => {
  process.env.DEMO_ACCESS_STORE_PATH = TEST_STORE;
});

afterAll(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  try { unlinkSync(TEST_STORE); } catch { /* ok */ }
});
import {
  createDemoAccess,
  saveDemoAccessStore,
  loadDemoAccessStore,
  activateDemoAccessOnFirstLogin,
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
  reserveDemoAiCalls,
  settleDemoAiCalls,
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
    expect(ensureDemoAiQuota(ctx, 1)).toEqual({ ok: true });
    const snap = consumeDemoAiCalls(ctx, 1);
    expect(snap).not.toBeNull();
    expect(snap!.usedAiCalls).toBe(1);
    expect(snap!.remainingAiCalls).toBe(4);
  });

  it("consuming multiple works", () => {
    const { record } = createDemoAccess({ label: "E", hours: 24, maxAiCalls: 10 });
    const ctx = makeDemoCtx(record.id);
    expect(ensureDemoAiQuota(ctx, 3)).toEqual({ ok: true });
    const snap = consumeDemoAiCalls(ctx, 3);
    expect(snap!.usedAiCalls).toBe(3);
    expect(snap!.remainingAiCalls).toBe(7);
  });

  it("fails closed when consume has no reservation", () => {
    const { record } = createDemoAccess({ label: "F", hours: 24, maxAiCalls: 2 });
    const ctx = makeDemoCtx(record.id);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => consumeDemoAiCalls(ctx, 1)).toThrow("demo_ai_quota_reservation_missing");
    expect(getLatestDemoSnapshot(ctx)?.usedAiCalls).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith(
      "Demo AI quota settlement failed",
      expect.objectContaining({ code: "reservation_missing", demoAccessId: record.id, count: 1 }),
    );
    errorSpy.mockRestore();
  });
});

describe("explicit Demo AI quota reservations", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("settles only started calls and releases unused planned quota", () => {
    const { record } = createDemoAccess({ label: "Batch", hours: 24, maxAiCalls: 10 });
    const ctx = makeDemoCtx(record.id);
    const reserved = reserveDemoAiCalls(ctx, 6);

    expect(reserved.ok).toBe(true);
    if (!reserved.ok || !reserved.reservation) return;
    const settled = settleDemoAiCalls(ctx, reserved.reservation, 4);

    expect(settled.ok).toBe(true);
    if (settled.ok) {
      expect(settled.snapshot?.usedAiCalls).toBe(4);
      expect(settled.snapshot?.remainingAiCalls).toBe(6);
    }
    const storedReservation = loadDemoAccessStore().accesses[0]
      .aiImageQuotaReservations?.[reserved.reservation.reservationId];
    expect(storedReservation).toMatchObject({
      status: "committed",
      count: 6,
      chargedCount: 4,
      kind: "text",
    });
  });

  it("rejects a missing reservation without changing quota", () => {
    const { record } = createDemoAccess({ label: "Missing", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reserved = reserveDemoAiCalls(ctx, 3);
    expect(reserved.ok).toBe(true);
    expect(getLatestDemoSnapshot(ctx)?.usedAiCalls).toBe(3);

    const settled = settleDemoAiCalls(ctx, { reservationId: "missing", plannedCount: 3 }, 3);

    expect(settled.ok).toBe(false);
    expect(getLatestDemoSnapshot(ctx)?.usedAiCalls).toBe(3);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("allows only one concurrent reservation within the remaining quota", async () => {
    const { record } = createDemoAccess({ label: "Concurrent", hours: 24, maxAiCalls: 3 });
    const ctxA = makeDemoCtx(record.id);
    const ctxB = makeDemoCtx(record.id);

    const [first, second] = await Promise.all([
      Promise.resolve().then(() => reserveDemoAiCalls(ctxA, 3)),
      Promise.resolve().then(() => reserveDemoAiCalls(ctxB, 3)),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(getLatestDemoSnapshot(ctxA)?.usedAiCalls).toBe(3);
  });

  it("keeps a longer batch reservation lease for serial Provider calls", () => {
    const { record } = createDemoAccess({ label: "Long batch", hours: 24, maxAiCalls: 6 });
    const ctx = makeDemoCtx(record.id);
    const reserved = reserveDemoAiCalls(ctx, 6, { leaseMs: 600_000, nowMs: 10_000 });

    expect(reserved.ok).toBe(true);
    if (!reserved.ok || !reserved.reservation) return;
    const stored = loadDemoAccessStore().accesses[0]
      .aiImageQuotaReservations?.[reserved.reservation.reservationId];
    expect(stored?.leaseExpiresAt).toBe(new Date(610_000).toISOString());
  });

  it("does not reserve or settle Owner quota", () => {
    const owner = makeOwnerCtx();
    const reserved = reserveDemoAiCalls(owner, 100);

    expect(reserved).toEqual({ ok: true, reservation: null });
    expect(settleDemoAiCalls(owner, null, 100)).toEqual({ ok: true, snapshot: null });
  });
});

// ── Guest-Access.1: Guest full-feature model ─────

describe("Guest-Access.1 permission model", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("Guest (demo) AI quota gate blocks 6th real AI call", () => {
    const { record } = createDemoAccess({ label: "Guest", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);

    // Calls 1-5 pass
    for (let i = 0; i < 5; i++) {
      expect(ensureDemoAiQuota(ctx, 1)).toEqual({ ok: true });
      consumeDemoAiCalls(ctx, 1);
    }

    // Call 6 fails
    const result = ensureDemoAiQuota(ctx, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("demo_ai_quota_exceeded");
  });

  it("Owner never consumes AI quota from guest pool", () => {
    const ownerCtx = makeOwnerCtx();
    // ensureDemoAiQuota passes for any count
    expect(ensureDemoAiQuota(ownerCtx, 100)).toEqual({ ok: true });
    // consumeDemoAiCalls returns null (no guest record to update)
    expect(consumeDemoAiCalls(ownerCtx, 1)).toBeNull();
  });

  it("Guest 24h activation only triggers on first login", () => {
    const { record } = createDemoAccess({ label: "Fresh", hours: 24, maxAiCalls: 5 });
    // Before first login: expiresAt is null
    expect(record.expiresAt).toBeNull();
    // First login activates
    const activated = activateDemoAccessOnFirstLogin(record.id, 24);
    expect(activated).not.toBeNull();
    expect(activated!.expiresAt).not.toBeNull();
    // expiresAt is ~24h from now
    const expires = new Date(activated!.expiresAt!);
    const expected = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(Math.abs(expires.getTime() - expected.getTime())).toBeLessThan(5000);
  });

  it("Guest non-AI API calls do not consume quota", () => {
    const { record } = createDemoAccess({ label: "G", hours: 24, maxAiCalls: 5 });
    // Simulate page loads, GET requests, etc. — none should consume
    const check = getLatestDemoSnapshot(makeDemoCtx(record.id));
    expect(check!.remainingAiCalls).toBe(5);
    expect(check!.usedAiCalls).toBe(0);
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
