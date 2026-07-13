import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { unlinkSync } from "fs";

const TEST_STORE = `${tmpdir()}/demo-access-test-${randomBytes(4).toString("hex")}.json`;

beforeAll(() => {
  process.env.DEMO_ACCESS_STORE_PATH = TEST_STORE;
});

afterAll(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  try { unlinkSync(TEST_STORE); } catch { /* ok */ }
});
import {
  generateSalt,
  hashPassword,
  verifyDemoPassword,
  createDemoAccess,
  getDemoAccessById,
  findDemoAccessByPassword,
  isDemoAccessExpired,
  isDemoAccessActive,
  getRemainingAiCalls,
  isDemoAiQuotaExhausted,
  incrementDemoAiCalls,
  markDemoAiCallProviderStarted,
  reserveDemoAiImageCalls,
  recoverExpiredDemoAiReservations,
  loadDemoAccessStore,
  saveDemoAccessStore,
  generateDemoPassword,
  generateDemoId,
  type DemoAccessStore,
} from "@/lib/server/demoAccess";

// ── Helpers ─────────────────────────────────────

function emptyStore(): DemoAccessStore {
  return { version: 1, accesses: [] };
}

// ── Crypto ──────────────────────────────────────

describe("crypto", () => {
  it("generates unique salts", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    expect(s1).not.toBe(s2);
    expect(s1).toHaveLength(32); // 16 bytes hex
  });

  it("hashPassword is deterministic", () => {
    const h1 = hashPassword("test123", "salt1");
    const h2 = hashPassword("test123", "salt1");
    expect(h1).toBe(h2);
  });

  it("hashPassword differs with different salts", () => {
    const h1 = hashPassword("test123", "saltA");
    const h2 = hashPassword("test123", "saltB");
    expect(h1).not.toBe(h2);
  });

  it("hashPassword differs with different passwords", () => {
    const h1 = hashPassword("passA", "salt");
    const h2 = hashPassword("passB", "salt");
    expect(h1).not.toBe(h2);
  });

  it("verifyDemoPassword works correctly", () => {
    const salt = generateSalt();
    const hash = hashPassword("demo-pass-123", salt);
    expect(verifyDemoPassword("demo-pass-123", hash, salt)).toBe(true);
    expect(verifyDemoPassword("wrong-pass", hash, salt)).toBe(false);
  });
});

// ── Password generation ─────────────────────────

describe("password generation", () => {
  it("generateDemoPassword returns non-empty string", () => {
    const pwd = generateDemoPassword();
    expect(pwd.length).toBeGreaterThanOrEqual(10);
  });

  it("generateDemoPassword returns unique values", () => {
    const p1 = generateDemoPassword();
    const p2 = generateDemoPassword();
    expect(p1).not.toBe(p2);
  });

  it("generateDemoId has demo_ prefix", () => {
    const id = generateDemoId();
    expect(id).toMatch(/^demo_[a-f0-9]+$/);
  });
});

// ── Store I/O ───────────────────────────────────

describe("store I/O", () => {
  beforeEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  afterEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  it("creates and reads DemoAccess", () => {
    const { record, plainPassword } = createDemoAccess({
      label: "Test Demo",
      hours: 24,
      maxAiCalls: 5,
    });
    expect(record.id).toMatch(/^demo_/);
    expect(record.label).toBe("Test Demo");
    expect(record.maxAiCalls).toBe(5);
    expect(record.usedAiCalls).toBe(0);
    expect(record.isActive).toBe(true);
    // expiresAt is null by default — starts from first login
    expect(record.expiresAt === null || typeof record.expiresAt === "string").toBe(true);
    expect(record.passwordHash).toMatch(/^sha256:/);
    expect(plainPassword).toBeTruthy();
  });

  it("getDemoAccessById returns correct record", () => {
    const { record } = createDemoAccess({ label: "A", hours: 24, maxAiCalls: 5 });
    const found = getDemoAccessById(record.id);
    expect(found).not.toBeNull();
    expect(found!.label).toBe("A");
  });

  it("getDemoAccessById returns null for unknown id", () => {
    expect(getDemoAccessById("nonexistent")).toBeNull();
  });

  it("findDemoAccessByPassword finds by password", () => {
    const { plainPassword } = createDemoAccess({ label: "B", hours: 24, maxAiCalls: 5 });
    const found = findDemoAccessByPassword(plainPassword);
    expect(found).not.toBeNull();
    expect(found!.label).toBe("B");
  });

  it("findDemoAccessByPassword returns null for wrong password", () => {
    createDemoAccess({ label: "C", hours: 24, maxAiCalls: 5 });
    expect(findDemoAccessByPassword("wrong_password")).toBeNull();
  });
});

// ── Status checks ───────────────────────────────

describe("status checks", () => {
  beforeEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  afterEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  it("isDemoAccessExpired detects past expiry", () => {
    const pastAccess = {
      id: "demo_test",
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
    };
    expect(isDemoAccessExpired(pastAccess)).toBe(true);
  });

  it("isDemoAccessExpired returns false for future expiry", () => {
    const futureAccess = {
      id: "demo_test",
      label: "Active",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    };
    expect(isDemoAccessExpired(futureAccess)).toBe(false);
  });

  it("isDemoAccessActive requires both isActive and not expired", () => {
    const active = {
      id: "demo_test",
      label: "Active",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 0,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    };
    expect(isDemoAccessActive(active)).toBe(true);

    const inactive = { ...active, isActive: false };
    expect(isDemoAccessActive(inactive)).toBe(false);
  });

  it("getRemainingAiCalls calculates correctly", () => {
    const access = {
      id: "demo_test",
      label: "Test",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 2,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    };
    expect(getRemainingAiCalls(access)).toBe(3);
  });

  it("getRemainingAiCalls floors at 0", () => {
    const access = {
      id: "demo_test",
      label: "Test",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 10,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    };
    expect(getRemainingAiCalls(access)).toBe(0);
  });

  it("isDemoAiQuotaExhausted returns true when used >= max", () => {
    const exhausted = {
      id: "demo_test",
      label: "Test",
      passwordHash: "sha256:xxx",
      salt: "salt",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      maxAiCalls: 5,
      usedAiCalls: 5,
      isActive: true,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      notes: "",
    };
    expect(isDemoAiQuotaExhausted(exhausted)).toBe(true);
  });
});

// ── incrementDemoAiCalls ────────────────────────

describe("incrementDemoAiCalls", () => {
  beforeEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  afterEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  it("increments usedAiCalls and persists", () => {
    const { record } = createDemoAccess({ label: "D", hours: 24, maxAiCalls: 5 });
    const updated = incrementDemoAiCalls(record.id, 1);
    expect(updated).not.toBeNull();
    expect(updated!.usedAiCalls).toBe(1);

    const readBack = getDemoAccessById(record.id);
    expect(readBack!.usedAiCalls).toBe(1);
  });

  it("returns null for unknown id", () => {
    expect(incrementDemoAiCalls("nonexistent", 1)).toBeNull();
  });

  it("respects count parameter", () => {
    const { record } = createDemoAccess({ label: "E", hours: 24, maxAiCalls: 10 });
    incrementDemoAiCalls(record.id, 3);
    const readBack = getDemoAccessById(record.id);
    expect(readBack!.usedAiCalls).toBe(3);
  });
});

describe("AI quota reservation leases", () => {
  beforeEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  afterEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  it("refunds an interrupted reservation exactly once after its lease expires", () => {
    const { record } = createDemoAccess({ label: "Lease", hours: 24, maxAiCalls: 1 });
    expect(reserveDemoAiImageCalls(record.id, "lease-request", 1, { kind: "text", leaseMs: 1_000, nowMs: 10_000 }).ok).toBe(true);
    expect(getDemoAccessById(record.id)?.usedAiCalls).toBe(1);
    expect(recoverExpiredDemoAiReservations(record.id, 10_999)?.usedAiCalls).toBe(1);
    expect(recoverExpiredDemoAiReservations(record.id, 11_000)?.usedAiCalls).toBe(0);
    expect(recoverExpiredDemoAiReservations(record.id, 12_000)?.usedAiCalls).toBe(0);
  });

  it("keeps already-started text calls charged when a process crashes before settlement", () => {
    const { record } = createDemoAccess({ label: "Started lease", hours: 24, maxAiCalls: 2 });
    expect(reserveDemoAiImageCalls(record.id, "started-request", 2, {
      kind: "text",
      leaseMs: 1_000,
      nowMs: 10_000,
    }).ok).toBe(true);

    expect(markDemoAiCallProviderStarted(record.id, "started-request", 1, 10_100)).toMatchObject({
      ok: true,
      duplicate: false,
    });
    expect(markDemoAiCallProviderStarted(record.id, "started-request", 1, 10_200)).toMatchObject({
      ok: true,
      duplicate: true,
    });

    const recovered = recoverExpiredDemoAiReservations(record.id, 11_000);
    expect(recovered?.usedAiCalls).toBe(1);
    expect(recovered?.aiImageQuotaReservations?.["started-request"]).toMatchObject({
      status: "committed",
      chargedCount: 1,
      providerStartedCount: 1,
    });
    expect(recoverExpiredDemoAiReservations(record.id, 12_000)?.usedAiCalls).toBe(1);
  });
});

// ── Multiple demo passwords ─────────────────────

describe("multiple demo passwords", () => {
  beforeEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  afterEach(() => {
    saveDemoAccessStore(emptyStore());
  });

  it("multiple demo passwords are independent", () => {
    const { record: r1, plainPassword: p1 } = createDemoAccess({ label: "A", hours: 24, maxAiCalls: 5 });
    const { record: r2, plainPassword: p2 } = createDemoAccess({ label: "B", hours: 24, maxAiCalls: 5 });

    expect(r1.id).not.toBe(r2.id);
    expect(p1).not.toBe(p2);

    incrementDemoAiCalls(r1.id, 3);
    expect(getRemainingAiCalls(getDemoAccessById(r1.id)!)).toBe(2);
    expect(getRemainingAiCalls(getDemoAccessById(r2.id)!)).toBe(5);
  });

  it("password hash does not contain plain password", () => {
    const { record, plainPassword } = createDemoAccess({ label: "F", hours: 24, maxAiCalls: 5 });
    expect(record.passwordHash).not.toContain(plainPassword);
    // Should be sha256: hex format
    expect(record.passwordHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
