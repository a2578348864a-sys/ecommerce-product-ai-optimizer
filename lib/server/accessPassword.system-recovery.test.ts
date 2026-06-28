/**
 * Phase System-Recovery.2 — Auth Protocol Unification Tests
 *
 * Tests getAccessContext() and checkAccessPassword() with token sessions
 * across all credential sources: x-access-token, x-access-password,
 * body.accessToken, body.accessPassword.
 *
 * Does NOT: read .env, call AI, touch DB, use real passwords.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  createOwnerSession,
  createDemoSession,
  deleteAccessSession,
} from "@/lib/server/accessSession";
import { generateSignedToken } from "@/lib/server/signedToken";
import {
  createDemoAccess,
  loadDemoAccessStore,
  saveDemoAccessStore,
  type DemoAccessStore,
} from "@/lib/server/demoAccess";
import { getAccessContext, checkAccessPassword } from "@/lib/server/accessPassword";

// ── Helpers ───────────────────────────────────────

function buildRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3005/api/test", { headers });
}

// ── Setup: create owner and demo sessions ─────────

let ownerToken = "";
let demoToken = "";
let demoAccessId = "";

beforeEach(() => {
  // Set a dummy password so checkAccessPassword doesn't return 500 "not configured"
  process.env.ACCESS_PASSWORD = "test-dummy-password-for-unit-tests";

  // Clean up old sessions
  if (ownerToken) deleteAccessSession(ownerToken);
  if (demoToken) deleteAccessSession(demoToken);

  // Create fresh owner session
  const ownerSession = createOwnerSession();
  ownerToken = ownerSession.token;

  // Create fresh demo access + session
  const { record } = createDemoAccess({
    label: "test-demo-for-auth-tests",
    hours: 24,
    maxAiCalls: 10,
  });
  demoAccessId = record.id;
  const demoSession = createDemoSession(demoAccessId);
  demoToken = demoSession.token;

  // Clean up store after test
  return () => {
    delete process.env.ACCESS_PASSWORD;
    if (ownerToken) deleteAccessSession(ownerToken);
    if (demoToken) deleteAccessSession(demoToken);
    // Reset demo access store
    const store = loadDemoAccessStore();
    store.accesses = store.accesses.filter((a) => a.id !== demoAccessId);
    saveDemoAccessStore(store);
  };
});

// ═══════════════════════════════════════════════════
// getAccessContext tests
// ═══════════════════════════════════════════════════

describe("getAccessContext — token from x-access-token header", () => {
  it("returns owner context for valid owner token", () => {
    const req = buildRequest({ "x-access-token": ownerToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
    expect(ctx!.token).toBe(ownerToken);
  });

  it("returns demo context for valid demo token", () => {
    const req = buildRequest({ "x-access-token": demoToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
    if (ctx!.mode === "demo") {
      expect(ctx!.demoAccessId).toBe(demoAccessId);
      expect(ctx!.remainingAiCalls).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns null for invalid token in x-access-token", () => {
    const req = buildRequest({ "x-access-token": "invalid_token_xxx" });
    const ctx = getAccessContext(req);
    expect(ctx).toBeNull();
  });

  it("returns null for empty x-access-token", () => {
    const req = buildRequest({ "x-access-token": "" });
    const ctx = getAccessContext(req);
    expect(ctx).toBeNull();
  });
});

describe("getAccessContext — signed token compatibility", () => {
  it("returns owner context for a signed owner token", () => {
    const signedOwnerToken = generateSignedToken("owner");
    const req = buildRequest({ "x-access-token": signedOwnerToken });

    const ctx = getAccessContext(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
    expect(ctx!.token).toBe(signedOwnerToken);
  });

  it("returns demo context with demoAccessId for a signed demo token", () => {
    const signedDemoToken = generateSignedToken("demo", demoAccessId);
    const req = buildRequest({ "x-access-token": signedDemoToken });

    const ctx = getAccessContext(req);

    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
    if (ctx!.mode === "demo") {
      expect(ctx!.demoAccessId).toBe(demoAccessId);
      expect(ctx!.isActive).toBe(true);
      expect(ctx!.remainingAiCalls).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("getAccessContext — token from x-access-password header", () => {
  it("recognizes owner token in x-access-password header", () => {
    const req = buildRequest({ "x-access-password": ownerToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
  });

  it("recognizes demo token in x-access-password header", () => {
    const req = buildRequest({ "x-access-password": demoToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
  });
});

describe("getAccessContext — token from body.accessToken", () => {
  it("recognizes owner token in body.accessToken", () => {
    const req = buildRequest({});
    const ctx = getAccessContext(req, { accessToken: ownerToken });
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
  });

  it("recognizes demo token in body.accessToken", () => {
    const req = buildRequest({});
    const ctx = getAccessContext(req, { accessToken: demoToken });
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
  });
});

describe("getAccessContext — token from body.accessPassword", () => {
  it("recognizes owner token sent as body.accessPassword (old component compat)", () => {
    const req = buildRequest({});
    const ctx = getAccessContext(req, { accessPassword: ownerToken });
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
  });

  it("recognizes demo token sent as body.accessPassword (old component compat)", () => {
    const req = buildRequest({});
    const ctx = getAccessContext(req, { accessPassword: demoToken });
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("demo");
  });

  it("returns null for invalid token in body.accessPassword", () => {
    const req = buildRequest({});
    const ctx = getAccessContext(req, { accessPassword: "wrong_token" });
    expect(ctx).toBeNull();
  });
});

describe("getAccessContext — priority order", () => {
  it("x-access-token takes priority over x-access-password", () => {
    // Send owner in x-access-token, demo in x-access-password
    const req = buildRequest({
      "x-access-token": ownerToken,
      "x-access-password": demoToken,
    });
    const ctx = getAccessContext(req);
    expect(ctx!.mode).toBe("owner"); // x-access-token wins
  });

  it("x-access-token with invalid token does NOT fall through to x-access-password", () => {
    const req = buildRequest({
      "x-access-token": "bad_token",
      "x-access-password": ownerToken,
    });
    const ctx = getAccessContext(req);
    // If x-access-token is present but invalid, don't fall through
    expect(ctx).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// checkAccessPassword tests (legacy backward compat)
// ═══════════════════════════════════════════════════

describe("checkAccessPassword — token session compat", () => {
  it("accepts owner token via x-access-token header", () => {
    const req = buildRequest({ "x-access-token": ownerToken });
    const err = checkAccessPassword(req);
    expect(err).toBeNull(); // null = pass
  });

  it("accepts demo token via x-access-token header", () => {
    const req = buildRequest({ "x-access-token": demoToken });
    const err = checkAccessPassword(req);
    expect(err).toBeNull();
  });

  it("accepts token via x-access-password header", () => {
    const req = buildRequest({ "x-access-password": ownerToken });
    const err = checkAccessPassword(req);
    expect(err).toBeNull();
  });

  it("accepts token via body.accessToken", () => {
    const req = buildRequest({});
    const err = checkAccessPassword(req, { accessToken: ownerToken });
    expect(err).toBeNull();
  });

  it("accepts token via body.accessPassword", () => {
    const req = buildRequest({});
    const err = checkAccessPassword(req, { accessPassword: ownerToken });
    expect(err).toBeNull();
  });

  it("rejects invalid token", () => {
    const req = buildRequest({ "x-access-token": "bad_token_xyz" });
    const err = checkAccessPassword(req);
    expect(err).not.toBeNull();
    expect(err!.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════
// DemoAccessContext fields
// ═══════════════════════════════════════════════════

describe("getAccessContext — demo context fields", () => {
  it("demo context contains isActive, isExpired, remainingAiCalls", () => {
    const req = buildRequest({ "x-access-token": demoToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    if (ctx!.mode === "demo") {
      expect(ctx!.isActive).toBe(true);
      expect(ctx!.isExpired).toBe(false);
      expect(ctx!.remainingAiCalls).toBe(10); // maxAiCalls = 10
    }
  });

  it("owner context does not have demo fields", () => {
    const req = buildRequest({ "x-access-token": ownerToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.mode).toBe("owner");
    // Owner context should not have demoAccessId
    expect((ctx as any).demoAccessId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════
// Auth-Hardening.1 — Guest fail-closed tests
// ═══════════════════════════════════════════════════

describe("getAccessContext — Guest fail-closed (Auth-Hardening.1)", () => {
  let failDemoAccessId = "";
  let failDemoToken = "";

  beforeEach(() => {
    process.env.ACCESS_PASSWORD = "test-dummy-password-for-unit-tests";

    // Create a demo access we can manipulate
    const { record } = createDemoAccess({
      label: "fail-closed-test-demo",
      hours: 24,
      maxAiCalls: 5,
    });
    failDemoAccessId = record.id;
    failDemoToken = generateSignedToken("demo", failDemoAccessId);

    return () => {
      delete process.env.ACCESS_PASSWORD;
      if (failDemoToken) deleteAccessSession(failDemoToken);
      const store = loadDemoAccessStore();
      store.accesses = store.accesses.filter((a) => a.id !== failDemoAccessId);
      saveDemoAccessStore(store);
    };
  });

  it("returns null when demo access record is not found (fail-closed on missing record)", () => {
    // Remove the record from the store
    const store = loadDemoAccessStore();
    store.accesses = store.accesses.filter((a) => a.id !== failDemoAccessId);
    saveDemoAccessStore(store);

    const req = buildRequest({ "x-access-token": failDemoToken });
    const ctx = getAccessContext(req);
    expect(ctx).toBeNull();
  });

  it("returns null when demo access is inactive/disabled (fail-closed on inactive)", () => {
    // Set the demo to inactive
    const store = loadDemoAccessStore();
    const access = store.accesses.find((a) => a.id === failDemoAccessId);
    if (access) access.isActive = false;
    saveDemoAccessStore(store);

    const req = buildRequest({ "x-access-token": failDemoToken });
    const ctx = getAccessContext(req);
    expect(ctx).toBeNull();
  });

  it("returns null when demo access is expired (fail-closed on expired)", () => {
    // Set the demo to expired (1 hour ago)
    const store = loadDemoAccessStore();
    const access = store.accesses.find((a) => a.id === failDemoAccessId);
    if (access) access.expiresAt = new Date(Date.now() - 3600000).toISOString();
    saveDemoAccessStore(store);

    const req = buildRequest({ "x-access-token": failDemoToken });
    const ctx = getAccessContext(req);
    expect(ctx).toBeNull();
  });

  it("returns context for active, non-expired demo (normal path unaffected)", () => {
    const req = buildRequest({ "x-access-token": failDemoToken });
    const ctx = getAccessContext(req);
    expect(ctx).not.toBeNull();
    if (ctx!.mode === "demo") {
      expect(ctx!.isActive).toBe(true);
      expect(ctx!.isExpired).toBe(false);
    }
  });
});
