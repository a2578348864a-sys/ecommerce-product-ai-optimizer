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

const sessionMap = new Map<string, AccessSession>();

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
  sessionMap.set(session.token, session);
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
  sessionMap.set(session.token, session);
  return session;
}

// ── Session lookup ──────────────────────────────

export function getAccessSession(token: string): AccessSession | null {
  const session = sessionMap.get(token);
  if (!session) return null;

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    sessionMap.delete(token);
    return null;
  }

  return session;
}

export function deleteAccessSession(token: string): void {
  sessionMap.delete(token);
}

// ── Cleanup ─────────────────────────────────────

export function cleanupExpiredSessions(): number {
  let cleaned = 0;
  const now = new Date();
  for (const [token, session] of sessionMap) {
    if (new Date(session.expiresAt) < now) {
      sessionMap.delete(token);
      cleaned++;
    }
  }
  return cleaned;
}
