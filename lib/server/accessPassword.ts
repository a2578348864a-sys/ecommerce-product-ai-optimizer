import type { NextRequest } from "next/server";
import {
  getAccessSession,
  type SessionMode,
} from "@/lib/server/accessSession";
import {
  getDemoAccessById,
  isDemoAccessActive,
  getRemainingAiCalls,
} from "@/lib/server/demoAccess";

// ── Re-exports for backward compatibility ───────

export function getAccessPassword(): string {
  return (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
}

// ── Access context (new token-based path) ───────

export interface OwnerAccessContext {
  mode: "owner";
  token: string;
}

export interface DemoAccessContext {
  mode: "demo";
  token: string;
  demoAccessId: string;
  isActive: boolean;
  isExpired: boolean;
  remainingAiCalls: number;
}

export type AccessContext = OwnerAccessContext | DemoAccessContext;

/**
 * Phase System-Recovery.2: Unified access check.
 *
 * Priority:
 * 1) x-access-token header → token session
 * 2) x-access-password header → token session (compat with buildAccessHeaders)
 * 3) body.accessToken → token session (compat)
 * 4) body.accessPassword → token session (compat with old components)
 * 5) x-access-password header / body.accessPassword → raw Owner password (legacy)
 *
 * Returns the access context, or null if unauthorized.
 */
export function getAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessContext | null {
  // Helper: try a candidate string as a token session
  const trySession = (candidate: string): AccessContext | null => {
    if (!candidate) return null;
    const session = getAccessSession(candidate);
    if (!session) return null;
    if (session.mode === "owner") {
      return { mode: "owner", token: session.token };
    }
    if (session.mode === "demo" && session.demoAccessId) {
      const demoAccess = getDemoAccessById(session.demoAccessId);
      // Auth-Hardening.1: fail closed — no demo record → reject
      if (!demoAccess) return null;
      // Fail closed — demo is inactive/disabled
      if (!demoAccess.isActive) return null;
      // Fail closed — demo is expired
      if (demoAccess.expiresAt && new Date(demoAccess.expiresAt) < new Date()) return null;
      return {
        mode: "demo",
        token: session.token,
        demoAccessId: session.demoAccessId,
        isActive: demoAccess.isActive,
        isExpired: false,
        remainingAiCalls: getRemainingAiCalls(demoAccess),
      };
    }
    return null; // session exists but not owner/demo
  };

  // 1) x-access-token header → token session (primary path)
  const tokenHeader = (request.headers.get("x-access-token") || "").trim();
  const ctx = trySession(tokenHeader);
  if (ctx) return ctx;
  // If x-access-token was present but session invalid, don't fall through to legacy
  if (tokenHeader) return null;

  // 2) x-access-password header → token session (buildAccessHeaders sends both)
  const passwordHeader = (request.headers.get("x-access-password") || "").trim();
  const ctx2 = trySession(passwordHeader);
  if (ctx2) return ctx2;

  // 3) body.accessToken → token session
  if (body) {
    const bodyToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const ctx3 = trySession(bodyToken);
    if (ctx3) return ctx3;
  }

  // 4) body.accessPassword → token session (old components send token here)
  if (body) {
    const bodyPassword = typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
    const ctx4 = trySession(bodyPassword);
    if (ctx4) return ctx4;
  }

  // 5) Legacy raw password path (backward compatible — direct env var comparison)
  const configured = getAccessPassword();
  if (!configured) return null;

  // body.accessPassword matches configured password
  if (body) {
    const bodyPw = typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
    if (bodyPw === configured) return { mode: "owner", token: "" };
  }

  // x-access-password header matches configured password
  if (passwordHeader === configured) return { mode: "owner", token: "" };

  return null;
}

/**
 * Legacy checkAccessPassword — kept for backward compatibility.
 * Returns null if authorized, or error object if not.
 *
 * Phase System-Recovery.2: Now also checks body.accessPassword and body.accessToken
 * as token sessions, in addition to header-based checks.
 */
export function checkAccessPassword(
  request: NextRequest,
  body?: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } | null {
  const configured = getAccessPassword();

  if (!configured) {
    return {
      status: 500,
      body: { error: "服务端未配置访问密码，请在环境变量中添加 ACCESS_PASSWORD。" },
    };
  }

  // Helper: try a candidate string as a valid token session
  const isValidSession = (candidate: string): boolean => {
    if (!candidate) return false;
    const session = getAccessSession(candidate);
    if (!session) return false;
    if (session.mode === "owner") return true;
    if (session.mode === "demo" && session.demoAccessId) {
      const demoAccess = getDemoAccessById(session.demoAccessId);
      return !!(demoAccess && isDemoAccessActive(demoAccess));
    }
    return false;
  };

  // 1) Try x-access-token header as token session
  const tokenHeader = (request.headers.get("x-access-token") || "").trim();
  if (isValidSession(tokenHeader)) return null;

  // 2) Try x-access-password header as token session or raw password
  const headerPassword = (request.headers.get("x-access-password") || "").trim();
  if (isValidSession(headerPassword)) return null;
  if (headerPassword === configured) return null;

  // 3) Try body.accessToken as token session
  if (body) {
    const bodyToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    if (isValidSession(bodyToken)) return null;
  }

  // 4) Try body.accessPassword as token session or raw password
  if (body) {
    const bodyPassword = typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
    if (isValidSession(bodyPassword)) return null;
    if (bodyPassword === configured) return null;
  }

  return {
    status: 401,
    body: { error: "访问密码错误，请检查后重试。" },
  };
}
