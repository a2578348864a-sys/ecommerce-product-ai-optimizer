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
 * Phase Demo-Login.1-C: Unified access check.
 *
 * Priority:
 * 1) x-access-token header → token session (new path)
 * 2) x-access-password header / body.accessPassword → Owner (legacy path)
 *
 * Returns the access context, or null if unauthorized.
 */
export function getAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessContext | null {
  // 1) Token-based path (new)
  const token = (request.headers.get("x-access-token") || "").trim();
  if (token) {
    const session = getAccessSession(token);
    if (session) {
      if (session.mode === "owner") {
        return { mode: "owner", token: session.token };
      }
      if (session.mode === "demo" && session.demoAccessId) {
        const demoAccess = getDemoAccessById(session.demoAccessId);
        if (demoAccess) {
          return {
            mode: "demo",
            token: session.token,
            demoAccessId: demoAccess.id,
            isActive: demoAccess.isActive,
            isExpired: new Date(demoAccess.expiresAt) < new Date(),
            remainingAiCalls: getRemainingAiCalls(demoAccess),
          };
        }
      }
    }
    return null; // invalid/expired token
  }

  // 2) Legacy password path (backward compatible)
  const configured = getAccessPassword();
  if (!configured) return null;

  const bodyPassword = body && typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
  if (bodyPassword === configured) return { mode: "owner", token: "" };

  const headerPassword = (request.headers.get("x-access-password") || "").trim();
  if (headerPassword === configured) return { mode: "owner", token: "" };

  return null;
}

/**
 * Legacy checkAccessPassword — kept for backward compatibility.
 * Returns null if Owner password is valid, or error object if not.
 * Does NOT use token sessions — only checks raw password against env var.
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

  // 1) 尝试从 body.accessPassword 读取（POST 场景）
  if (body) {
    const bodyPassword = typeof body.accessPassword === "string" ? body.accessPassword.trim() : "";
    if (bodyPassword === configured) return null; // 通过
  }

  // 2) 尝试从 x-access-password header 读取（GET / DELETE 场景）
  const headerPassword = (request.headers.get("x-access-password") || "").trim();
  if (headerPassword === configured) return null; // 通过

  // 3) Also accept x-access-token with valid Owner or Demo session
  const token = (request.headers.get("x-access-token") || "").trim();
  if (token) {
    const session = getAccessSession(token);
    if (session && (session.mode === "owner" || session.mode === "demo")) return null; // 通过
  }

  return {
    status: 401,
    body: { error: "访问密码错误，请检查后重试。" },
  };
}
