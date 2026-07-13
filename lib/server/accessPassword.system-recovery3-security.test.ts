/**
 * Phase System-Recovery.3-Security-Gate — Fallback Security Tests
 *
 * Tests that the getAccessContext() fallback for missing demo access records
 * does NOT weaken AI quota, owner-only, inactivity, or expiry checks.
 *
 * Does NOT: read .env, call real AI, touch DB.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createOwnerSession,
  createDemoSession,
  deleteAccessSession,
} from "@/lib/server/accessSession";
import {
  createDemoAccess,
  loadDemoAccessStore,
  saveDemoAccessStore,
  type DemoAccessRecord,
} from "@/lib/server/demoAccess";
import {
  getAccessContext,
  checkAccessPassword,
  type DemoAccessContext,
} from "@/lib/server/accessPassword";
import {
  requireAuthenticated,
  requireOwnerOnly,
  ensureDemoAiQuota,
} from "@/lib/server/demoGuard";

function buildRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3005/api/test", { headers });
}

describe("Security Gate — Fallback Demo Context", () => {
  let ownerToken = "";
  let demoToken = "";
  let demoAccessId = "";
  let demoRecord: DemoAccessRecord | null = null;

  beforeEach(() => {
    process.env.ACCESS_PASSWORD = "security-gate-test-pw";
    // Isolate demo access store from other test files
    process.env.DEMO_ACCESS_STORE_PATH = ".next/test-stores/demo-access.security-gate-test.json";

    const ownerSession = createOwnerSession();
    ownerToken = ownerSession.token;

    const { record } = createDemoAccess({
      label: "security-gate-test",
      hours: 24,
      maxAiCalls: 10,
    });
    demoAccessId = record.id;
    demoRecord = record;
    const demoSession = createDemoSession(demoAccessId);
    demoToken = demoSession.token;
  });

  afterEach(() => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.DEMO_ACCESS_STORE_PATH;
    if (ownerToken) deleteAccessSession(ownerToken);
    if (demoToken) deleteAccessSession(demoToken);
  });

  // Helper: create a demo context from the session token
  function getDemoCtx(): DemoAccessContext | null {
    const req = buildRequest({
      "x-access-token": demoToken,
      "x-access-password": demoToken,
    });
    const ctx = getAccessContext(req);
    if (ctx && ctx.mode === "demo") return ctx as DemoAccessContext;
    return null;
  }

  // ═══════════════════════════════════════════════════
  // 1. Normal case: record exists
  // ═══════════════════════════════════════════════════

  it("normal: demo context has correct fields from record", () => {
    const ctx = getDemoCtx();
    expect(ctx).not.toBeNull();
    expect(ctx!.isActive).toBe(true);
    expect(ctx!.isExpired).toBe(false);
    expect(ctx!.remainingAiCalls).toBe(10);
  });

  it("normal: ensureDemoAiQuota allows AI calls", () => {
    const ctx = getDemoCtx()!;
    const result = ensureDemoAiQuota(ctx, 1);
    expect(result.ok).toBe(true);
  });

  it("normal: requireOwnerOnly blocks demo", () => {
    const req = buildRequest({ "x-access-token": demoToken });
    const result = requireOwnerOnly(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("normal: owner passes requireOwnerOnly", () => {
    const req = buildRequest({ "x-access-token": ownerToken });
    const result = requireOwnerOnly(req);
    expect(result.ok).toBe(true);
  });

  // ═══════════════════════════════════════════════════
  // 2. Missing record: fail-closed (Auth-Hardening.1)
  // ═══════════════════════════════════════════════════

  describe("missing demo access record", () => {
    beforeEach(() => {
      // Delete the demo access record from the file store
      const store = loadDemoAccessStore();
      store.accesses = store.accesses.filter((a) => a.id !== demoAccessId);
      saveDemoAccessStore(store);
    });

    it("fail-closed: getAccessContext returns null when record missing", () => {
      const ctx = getDemoCtx();
      // Auth-Hardening.1: missing record → fail closed, returns null
      expect(ctx).toBeNull();
    });

    it("fail-closed: checkAccessPassword rejects when record missing", () => {
      const req = buildRequest({ "x-access-token": demoToken });
      const err = checkAccessPassword(req);
      // Auth-Hardening.1: demo record not found → token session no longer valid
      expect(err).not.toBeNull();
      expect(err!.status).toBe(401);
    });

    it("fail-closed: requireAuthenticated rejects when record missing", () => {
      const req = buildRequest({ "x-access-token": demoToken });
      const result = requireAuthenticated(req);
      // Auth-Hardening.1: getAccessContext returns null → requireAuthenticated rejects
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════
  // 3. Security: AI quota checks with missing record
  // ═══════════════════════════════════════════════════

  describe("AI quota security — missing record", () => {
    beforeEach(() => {
      const store = loadDemoAccessStore();
      store.accesses = store.accesses.filter((a) => a.id !== demoAccessId);
      saveDemoAccessStore(store);
    });

    it("fail-closed: getAccessContext returns null → no context to check AI quota", () => {
      const ctx = getDemoCtx();
      // Auth-Hardening.1: missing record → null context, blocked at auth layer
      expect(ctx).toBeNull();
    });

    it("owner AI quota check never blocked (always passes)", () => {
      const req = buildRequest({ "x-access-token": ownerToken });
      const ctx = getAccessContext(req)!;
      const result = ensureDemoAiQuota(ctx, 999);
      expect(result.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════
  // 4. Security: owner-only with missing record
  // ═══════════════════════════════════════════════════

  describe("owner-only security — missing record", () => {
    beforeEach(() => {
      const store = loadDemoAccessStore();
      store.accesses = store.accesses.filter((a) => a.id !== demoAccessId);
      saveDemoAccessStore(store);
    });

    it("requireOwnerOnly still blocks demo when record missing", () => {
      const req = buildRequest({ "x-access-token": demoToken });
      const result = requireOwnerOnly(req);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(401);
        expect(result.code).toBe("invalid_access");
      }
    });

    it("requireOwnerOnly still passes owner when record missing", () => {
      const req = buildRequest({ "x-access-token": ownerToken });
      const result = requireOwnerOnly(req);
      expect(result.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════
  // 5. Security: expired record — fail-closed (Auth-Hardening.1)
  // ═══════════════════════════════════════════════════

  describe("AI quota security — expired record", () => {
    beforeEach(() => {
      // Set expiresAt to past
      const store = loadDemoAccessStore();
      const idx = store.accesses.findIndex((a) => a.id === demoAccessId);
      if (idx !== -1) {
        store.accesses[idx].expiresAt = new Date("2020-01-01").toISOString();
      }
      saveDemoAccessStore(store);
    });

    it("fail-closed: getAccessContext returns null when expired", () => {
      const ctx = getDemoCtx();
      // Auth-Hardening.1: expired → fail closed at auth layer
      expect(ctx).toBeNull();
    });

    it("ensureDemoAiQuota is unreachable via expired demo (context is null)", () => {
      // Expired demos are blocked at getAccessContext — never reach ensureDemoAiQuota
      const ctx = getDemoCtx();
      expect(ctx).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════
  // 6. Security: inactive record — fail-closed (Auth-Hardening.1)
  // ═══════════════════════════════════════════════════

  describe("AI quota security — inactive record", () => {
    beforeEach(() => {
      const store = loadDemoAccessStore();
      const idx = store.accesses.findIndex((a) => a.id === demoAccessId);
      if (idx !== -1) {
        store.accesses[idx].isActive = false;
      }
      saveDemoAccessStore(store);
    });

    it("fail-closed: getAccessContext returns null when inactive", () => {
      const ctx = getDemoCtx();
      // Auth-Hardening.1: inactive → fail closed at auth layer
      expect(ctx).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════
  // 7. Security: exhausted AI quota
  // ═══════════════════════════════════════════════════

  describe("AI quota security — exhausted", () => {
    beforeEach(() => {
      const store = loadDemoAccessStore();
      const idx = store.accesses.findIndex((a) => a.id === demoAccessId);
      if (idx !== -1) {
        store.accesses[idx].usedAiCalls = store.accesses[idx].maxAiCalls;
      }
      saveDemoAccessStore(store);
    });

    it("ensureDemoAiQuota blocks AI when quota exhausted", () => {
      const ctx = getDemoCtx()!;
      const result = ensureDemoAiQuota(ctx, 1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("demo_ai_quota_exceeded");
      }
    });
  });

  // ═══════════════════════════════════════════════════
  // 8. Owner never affected by any demo state
  // ═══════════════════════════════════════════════════

  describe("owner isolation", () => {
    it("getAccessContext returns owner for valid owner token", () => {
      const req = buildRequest({ "x-access-token": ownerToken });
      const ctx = getAccessContext(req);
      expect(ctx).not.toBeNull();
      expect(ctx!.mode).toBe("owner");
    });

    it("requireAuthenticated passes owner", () => {
      const req = buildRequest({ "x-access-token": ownerToken });
      const result = requireAuthenticated(req);
      expect(result.ok).toBe(true);
    });

    it("requireOwnerOnly passes owner", () => {
      const req = buildRequest({ "x-access-token": ownerToken });
      const result = requireOwnerOnly(req);
      expect(result.ok).toBe(true);
    });
  });
});
