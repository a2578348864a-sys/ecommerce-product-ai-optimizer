/**
 * Phase Auth-Stability.1 — Stateless Signed Access Token
 *
 * Replaces the in-memory sessionMap dependency for token verification.
 * Tokens are self-contained (mode + expiry) with HMAC-SHA256 signature,
 * so they survive dev server restarts and HMR.
 *
 * Token format: stok_v1.{base64url(payload)}.{base64url(signature)}
 *
 * Does NOT:
 * - Use database
 * - Add dependencies (Node built-in crypto only)
 * - Print or expose secrets
 * - Replace sessionStorage behavior
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// ── Types ───────────────────────────────────────

export type SignedTokenPayload = {
  v: 1;             // version
  mode: "owner" | "demo";
  demoAccessId?: string; // demo only
  iat: number;      // issued at (epoch ms)
  exp: number;      // expires at (epoch ms)
  jti: string;      // unique token id (16 random bytes, base64url)
};

export type VerifiedToken = {
  ok: true;
  mode: "owner" | "demo";
  token: string;        // original token string
  payload: SignedTokenPayload;
} | {
  ok: false;
  reason: "expired" | "invalid_signature" | "malformed" | "wrong_version";
};

// ── Constants ───────────────────────────────────

const TOKEN_VERSION = 1;
const TOKEN_PREFIX = "stok_v1.";
const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, aligned with client unlock session

// ── Signing key (derived from ACCESS_PASSWORD, never exposed) ──

function getSigningKey(): Buffer | null {
  // Derive a stable 32-byte key from the access password.
  // The password itself is never included in the token.
  const raw = (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
  if (!raw) return null;
  return createHmac("sha256", "qx-agent-signing-key-v1")
    .update(raw)
    .digest();
}

// ── Base64url helpers ───────────────────────────

function toBase64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function fromBase64url(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

// ── Token generation ────────────────────────────

export function generateSignedToken(mode: "owner" | "demo", demoAccessId?: string): string {
  const key = getSigningKey();
  if (!key) {
    throw new Error("SIGNING_KEY_MISSING");
  }

  const now = Date.now();
  const jti = toBase64url(randomBytes(16));

  const payload: SignedTokenPayload = {
    v: TOKEN_VERSION,
    mode,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_MS,
    jti,
  };

  if (mode === "demo" && demoAccessId) {
    payload.demoAccessId = demoAccessId;
  }

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = toBase64url(Buffer.from(payloadJson, "utf-8"));
  const signature = toBase64url(
    createHmac("sha256", key).update(payloadB64).digest()
  );

  return `${TOKEN_PREFIX}${payloadB64}.${signature}`;
}

// ── Token verification ──────────────────────────

export function verifySignedToken(token: string): VerifiedToken {
  const key = getSigningKey();
  if (!key) {
    return { ok: false, reason: "invalid_signature" };
  }

  // Must have the correct prefix
  if (!token.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const body = token.slice(TOKEN_PREFIX.length);
  const dotIndex = body.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === body.length - 1) {
    return { ok: false, reason: "malformed" };
  }

  const payloadB64 = body.slice(0, dotIndex);
  const signature = body.slice(dotIndex + 1);

  // Verify signature
  const expectedSig = toBase64url(
    createHmac("sha256", key).update(payloadB64).digest()
  );

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return { ok: false, reason: "invalid_signature" };
    }
  } catch {
    return { ok: false, reason: "invalid_signature" };
  }

  // Decode payload
  let payload: SignedTokenPayload;
  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf-8");
    payload = JSON.parse(json) as SignedTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // Version check
  if (payload.v !== TOKEN_VERSION) {
    return { ok: false, reason: "wrong_version" };
  }

  // Expiry check
  if (Date.now() > payload.exp) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, mode: payload.mode, token, payload };
}
