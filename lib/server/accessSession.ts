/**
 * Phase Demo-Login.1-B — Access Session Manager
 *
 * Lightweight token→session mapping. Uses in-memory Map.
 * PM2 restart clears all tokens → user must re-login (acceptable for demo).
 *
 * Does NOT:
 * - Persist tokens to disk (by design — single-session scope)
 * - Use database
 * - Read .env
 */

import "server-only";
import { randomBytes } from "crypto";
import { verifySignedToken } from "@/lib/server/signedToken";

// ── Types ───────────────────────────────────────

export type SessionMode = "owner" | "demo";

export interface AccessSession {
  token: string;
  mode: SessionMode;
  demoAccessId?: string;
  createdAt: string;
  expiresAt: string;
}

// ── In-memory store ─────────────────────────────
//
// IMPORTANT: In Next.js dev mode, different API routes may load separate
// module instances, so module-level variables are NOT shared across routes.
// We MUST use globalThis to ensure a process-level singleton.
// Without this, tokens created in /api/auth/login are invisible to
// /api/workflows/product-analysis/save-task and other API routes.

const globalKey = Symbol.for("__accessSessionMap");

function getSessionMap(): Map<string, AccessSession> {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[globalKey]) {
    g[globalKey] = new Map<string, AccessSession>();
  }
  return g[globalKey] as Map<string, AccessSession>;
}

const OWNER_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEMO_SESSION_TTL_MS = 2 * 60 * 60 * 1000;  // 2 hours (or until demo expires)

// ── Token generation ────────────────────────────

function generateToken(): string {
  return `tok_${randomBytes(24).toString("base64url")}`;
}

// ── Session creation ────────────────────────────

export function createOwnerSession(): AccessSession {
  const now = new Date();
  const session: AccessSession = {
    token: generateToken(),
    mode: "owner",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OWNER_SESSION_TTL_MS).toISOString(),
  };
  getSessionMap().set(session.token, session);
  return session;
}

export function createDemoSession(demoAccessId: string): AccessSession {
  const now = new Date();
  const session: AccessSession = {
    token: generateToken(),
    mode: "demo",
    demoAccessId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEMO_SESSION_TTL_MS).toISOString(),
  };
  getSessionMap().set(session.token, session);
  return session;
}

// ── Session lookup ──────────────────────────────

/**
 * Look up an access session from a token string.
 *
 * Phase Auth-Stability.1:
 * 1) Try signed token verification first (survives server restarts).
 * 2) Fall back to in-memory sessionMap (backward compat with old tokens).
 */
export function getAccessSession(token: string): AccessSession | null {
  if (!token) return null;

  // 1) Try signed token (stateless, survives restart)
  if (token.startsWith("stok_v1.")) {
    const result = verifySignedToken(token);
    if (result.ok) {
      return {
        token,
        mode: result.mode,
        demoAccessId: result.payload.demoAccessId,
        createdAt: new Date(result.payload.iat).toISOString(),
        expiresAt: new Date(result.payload.exp).toISOString(),
      };
    }
    // Signed token invalid → don't fall through to sessionMap
    return null;
  }

  // 2) Legacy: in-memory sessionMap lookup
  const session = getSessionMap().get(token);
  if (!session) return null;

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    getSessionMap().delete(token);
    return null;
  }

  return session;
}

export function deleteAccessSession(token: string): void {
  getSessionMap().delete(token);
}

// ── Cleanup ─────────────────────────────────────

export function cleanupExpiredSessions(): number {
  let cleaned = 0;
  const now = new Date();
  for (const [token, session] of getSessionMap()) {
    if (new Date(session.expiresAt) < now) {
      getSessionMap().delete(token);
      cleaned++;
    }
  }
  return cleaned;
}
