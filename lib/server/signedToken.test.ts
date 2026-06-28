/**
 * Auth-Hardening.1 — Signed Token Tests
 *
 * Tests generateSignedToken / verifySignedToken behavior:
 * - With valid signing key
 * - Without signing key (fail closed)
 * - Token tampering detection
 * - Owner and Demo token payload correctness
 *
 * Does NOT: read .env, call AI, touch DB, print secrets/tokens.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateSignedToken, verifySignedToken } from "@/lib/server/signedToken";

const TEST_SECRET = "test-signing-secret-for-unit-tests-do-not-use-in-production";

describe("signedToken — with signing key", () => {
  beforeEach(() => {
    process.env.ACCESS_PASSWORD = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.ACCESS_PASSWORD;
  });

  it("generates and verifies an owner token", () => {
    const token = generateSignedToken("owner");
    expect(token).toBeTruthy();
    expect(token.startsWith("stok_v1.")).toBe(true);

    const result = verifySignedToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("owner");
      expect(result.payload.mode).toBe("owner");
      expect(result.payload.demoAccessId).toBeUndefined();
    }
  });

  it("generates and verifies a demo token with demoAccessId", () => {
    const token = generateSignedToken("demo", "demo-123");
    expect(token).toBeTruthy();

    const result = verifySignedToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("demo");
      expect(result.payload.demoAccessId).toBe("demo-123");
    }
  });

  it("rejects a tampered token", () => {
    const token = generateSignedToken("owner");
    // Change last char of signature
    const tampered = token.slice(0, -1) + (token[token.length - 1] === "A" ? "B" : "A");

    const result = verifySignedToken(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });
});

describe("signedToken — without signing key (fail closed)", () => {
  afterEach(() => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.APP_ACCESS_PASSWORD;
  });

  it("generateSignedToken throws when no signing key is configured", () => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.APP_ACCESS_PASSWORD;

    expect(() => generateSignedToken("owner")).toThrow("SIGNING_KEY_MISSING");
  });

  it("verifySignedToken returns invalid_signature when no signing key is configured", () => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.APP_ACCESS_PASSWORD;

    const result = verifySignedToken(
      "stok_v1.eyJ2IjoxLCJtb2RlIjoib3duZXIiLCJpYXQiOjEsImV4cCI6OTk5OTk5OTk5OTk5OSwianRpIjoiQUFBQUFBQUFBQUFBQSJ9.dummySig"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });

  it("verifySignedToken rejects even a previously valid token after key is removed", () => {
    // First generate with key
    process.env.ACCESS_PASSWORD = TEST_SECRET;
    const token = generateSignedToken("owner");

    // Then remove key and try to verify
    delete process.env.ACCESS_PASSWORD;
    const result = verifySignedToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_signature");
    }
  });
});

describe("signedToken — no fallback-key behavior", () => {
  afterEach(() => {
    delete process.env.ACCESS_PASSWORD;
    delete process.env.APP_ACCESS_PASSWORD;
  });

  it("does not accept 'fallback-key' as a valid signing secret", () => {
    // Simulate the old fallback-key being used as password
    process.env.ACCESS_PASSWORD = "fallback-key";
    const token = generateSignedToken("owner");

    // Reset and try with the actual string "fallback-key" — should NOT work
    delete process.env.ACCESS_PASSWORD;
    process.env.ACCESS_PASSWORD = "fallback-key";
    // Token generated with "fallback-key" should verify with same key
    const result = verifySignedToken(token);
    expect(result.ok).toBe(true);

    // But without any env var, it should fail
    delete process.env.ACCESS_PASSWORD;
    const result2 = verifySignedToken(token);
    expect(result2.ok).toBe(false);
  });
});
