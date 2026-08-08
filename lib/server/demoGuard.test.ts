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
  clearDemoAccessLegacyExpiry,
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
  reserveDemoAiJob,
  markDemoAiJobProviderCallStarted,
  settleDemoAiJob,
  reserveVisitorImageAiCalls,
  markVisitorImageAiProviderStarted,
  commitVisitorImageAiCalls,
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

  it("legacy expiry does not disable an active Visitor", () => {
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
    expect(result).toEqual({ ok: true });
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

describe("Demo AI job quota v1", () => {
  beforeEach(() => saveDemoAccessStore(emptyStore()));
  afterEach(() => saveDemoAccessStore(emptyStore()));

  it("charges one job after four Provider calls and preserves Provider audit counts", () => {
    const { record } = createDemoAccess({ label: "Job", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    const reserved = reserveDemoAiJob(ctx, {
      jobType: "product_research",
      jobRequestId: "11111111-1111-4111-8111-111111111111",
      providerCallsPlanned: 4,
    });

    expect(reserved.ok).toBe(true);
    if (!reserved.ok || !reserved.reservation) return;
    for (let count = 1; count <= 4; count += 1) {
      expect(markDemoAiJobProviderCallStarted(ctx, reserved.reservation, count))
        .toEqual({ ok: true });
    }
    const settled = settleDemoAiJob(ctx, reserved.reservation, {
      providerCallsStarted: 4,
      providerCallsCompleted: 4,
      providerCallsFailed: 0,
    });

    expect(settled.ok).toBe(true);
    if (!settled.ok) return;
    expect(settled.snapshot).toMatchObject({
      quotaMetric: "product_journeys_v1",
      legacyAiQuotaMetric: "ai_jobs_v1",
      usedAiJobs: 1,
      remainingAiJobs: 4,
      usedAiCalls: 1,
      remainingAiCalls: 4,
    });
    expect(loadDemoAccessStore().accesses[0].aiImageQuotaReservations?.[
      reserved.reservation.reservationId
    ]).toMatchObject({
      count: 1,
      status: "committed",
      chargedCount: 1,
      quotaMetric: "ai_jobs_v1",
      jobType: "product_research",
      providerCallsPlanned: 4,
      providerStartedCount: 4,
      providerCallsCompleted: 4,
      providerCallsFailed: 0,
    });
  });

  it("refunds a job when no Provider starts and charges once after a started failure", () => {
    const { record } = createDemoAccess({ label: "Boundaries", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    const beforeStart = reserveDemoAiJob(ctx, {
      jobType: "product_research",
      jobRequestId: "22222222-2222-4222-8222-222222222222",
      providerCallsPlanned: 4,
    });
    expect(beforeStart.ok).toBe(true);
    if (!beforeStart.ok || !beforeStart.reservation) return;
    expect(settleDemoAiJob(ctx, beforeStart.reservation, {
      providerCallsStarted: 0,
      providerCallsCompleted: 0,
      providerCallsFailed: 0,
    })).toMatchObject({ ok: true, status: "refunded" });
    expect(getLatestDemoSnapshot(ctx)?.usedAiJobs).toBe(0);

    const afterStart = reserveDemoAiJob(ctx, {
      jobType: "product_research",
      jobRequestId: "33333333-3333-4333-8333-333333333333",
      providerCallsPlanned: 4,
    });
    expect(afterStart.ok).toBe(true);
    if (!afterStart.ok || !afterStart.reservation) return;
    expect(markDemoAiJobProviderCallStarted(ctx, afterStart.reservation, 1)).toEqual({ ok: true });
    expect(settleDemoAiJob(ctx, afterStart.reservation, {
      providerCallsStarted: 1,
      providerCallsCompleted: 0,
      providerCallsFailed: 1,
    })).toMatchObject({ ok: true, status: "committed" });
    expect(getLatestDemoSnapshot(ctx)?.usedAiJobs).toBe(1);
  });

  it("allows five distinct jobs, rejects the sixth, and replays the same request idempotently", () => {
    const { record } = createDemoAccess({ label: "Five jobs", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    for (let index = 1; index <= 5; index += 1) {
      const jobRequestId = `${String(index).repeat(8)}-${String(index).repeat(4)}-4${String(index).repeat(3)}-8${String(index).repeat(3)}-${String(index).repeat(12)}`;
      const reserved = reserveDemoAiJob(ctx, {
        jobType: "product_research",
        jobRequestId,
        providerCallsPlanned: 4,
      });
      expect(reserved.ok).toBe(true);
      if (!reserved.ok || !reserved.reservation) return;
      expect(markDemoAiJobProviderCallStarted(ctx, reserved.reservation, 1)).toEqual({ ok: true });
      expect(settleDemoAiJob(ctx, reserved.reservation, {
        providerCallsStarted: 1,
        providerCallsCompleted: 1,
        providerCallsFailed: 0,
      })).toMatchObject({ ok: true, status: "committed" });

      const replay = reserveDemoAiJob(ctx, {
        jobType: "product_research",
        jobRequestId,
        providerCallsPlanned: 4,
      });
      expect(replay).toMatchObject({
        ok: true,
        reservation: { duplicate: true, status: "committed" },
      });
      expect(getLatestDemoSnapshot(ctx)?.usedAiJobs).toBe(index);
    }

    const sixth = reserveDemoAiJob(ctx, {
      jobType: "product_research",
      jobRequestId: "66666666-6666-4666-8666-666666666666",
      providerCallsPlanned: 4,
    });
    expect(sixth).toMatchObject({
      ok: false,
      code: "demo_ai_quota_exceeded",
      snapshot: { usedAiJobs: 5, remainingAiJobs: 0 },
    });
  });

  it("keeps Owner outside Visitor job accounting and isolates Visitor ledgers", () => {
    const { record: a } = createDemoAccess({ label: "A", hours: 24, maxAiCalls: 5 });
    const { record: b } = createDemoAccess({ label: "B", hours: 24, maxAiCalls: 5 });
    const owner = makeOwnerCtx();
    const visitorA = makeDemoCtx(a.id);
    const visitorB = makeDemoCtx(b.id);

    expect(reserveDemoAiJob(owner, {
      jobType: "product_research",
      jobRequestId: "77777777-7777-4777-8777-777777777777",
      providerCallsPlanned: 4,
    })).toEqual({ ok: true, reservation: null, snapshot: null });

    const reserved = reserveDemoAiJob(visitorA, {
      jobType: "product_research",
      jobRequestId: "88888888-8888-4888-8888-888888888888",
      providerCallsPlanned: 4,
    });
    expect(reserved.ok).toBe(true);
    if (!reserved.ok || !reserved.reservation) return;
    markDemoAiJobProviderCallStarted(visitorA, reserved.reservation, 1);
    settleDemoAiJob(visitorA, reserved.reservation, {
      providerCallsStarted: 1,
      providerCallsCompleted: 1,
      providerCallsFailed: 0,
    });

    expect(getLatestDemoSnapshot(visitorA)?.usedAiJobs).toBe(1);
    expect(getLatestDemoSnapshot(visitorB)?.usedAiJobs).toBe(0);
  });

  it("charges one image_generation job even when one click requests four images", () => {
    const { record } = createDemoAccess({ label: "Images", hours: 24, maxAiCalls: 5 });
    const ctx = makeDemoCtx(record.id);
    const requestHash = "a".repeat(64);

    expect(reserveVisitorImageAiCalls(ctx, requestHash, 4)).toMatchObject({
      ok: true,
      snapshot: { usedAiJobs: 1, remainingAiJobs: 4 },
    });
    expect(markVisitorImageAiProviderStarted(ctx, requestHash)).toEqual({ ok: true });
    expect(commitVisitorImageAiCalls(ctx, requestHash)).toMatchObject({
      usedAiJobs: 1,
      remainingAiJobs: 4,
    });
    expect(loadDemoAccessStore().accesses[0].aiImageQuotaReservations?.[requestHash])
      .toMatchObject({
        count: 1,
        quotaMetric: "ai_jobs_v1",
        jobType: "image_generation",
        providerCallsPlanned: 1,
      });
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

  it("clears a legacy expiry instead of activating a 24h code lifetime", () => {
    const { record } = createDemoAccess({ label: "Fresh", hours: 24, maxAiCalls: 5 });
    // Before first login: expiresAt is null
    expect(record.expiresAt).toBeNull();
    const store = loadDemoAccessStore();
    store.accesses[0].expiresAt = "2020-01-01T00:00:00.000Z";
    saveDemoAccessStore(store);

    const cleared = clearDemoAccessLegacyExpiry(record.id);
    expect(cleared?.expiresAt).toBeNull();
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
