/**
 * Unified Access Resolver — Core Owner System
 *
 * All protected routes verify Owner authentication.
 */

import type { NextRequest } from "next/server";
import { getAccessSession } from "@/lib/server/accessSession";
import { isLocalOwnerNoAuthTrust } from "@/lib/server/runtimeMode";

// ── Re-exports for backward compatibility ───────

export function getAccessPassword(): string {
  return (process.env.ACCESS_PASSWORD || process.env.APP_ACCESS_PASSWORD || "").trim();
}

// ── Access context ──────────────────────────────

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
  credentialKind?: "password" | "anonymous";
}

export type AccessContext = OwnerAccessContext | DemoAccessContext;

export type AccessDenialReason = "unauthenticated" | "conflict" | "origin";

export type AccessResolution =
  | { ok: true; context: AccessContext }
  | { ok: false; reason: AccessDenialReason };

// ── Internal helpers ────────────────────────────

interface TokenIdentity {
  present: boolean;
  valid: boolean;
  ctx: AccessContext | null;
}

function trySessionIdentity(candidate: string): TokenIdentity {
  if (!candidate) return { present: false, valid: false, ctx: null };
  const session = getAccessSession(candidate);
  if (!session) return { present: true, valid: false, ctx: null };
  if (session.mode === "owner") {
    return { present: true, valid: true, ctx: { mode: "owner", token: session.token } };
  }
  return { present: true, valid: false, ctx: null };
}

/**
 * Origin 同源判定
 */
export function isSameOriginRequest(origin: string, request: NextRequest): boolean {
  const self = (request as { nextUrl?: { origin?: string } }).nextUrl?.origin;
  if (!self) return false;
  if (origin === self) return true;
  const publicOrigin = (process.env.QX_PUBLIC_ORIGIN || "").trim().replace(/\/+$/, "");
  if (publicOrigin && origin === publicOrigin) return true;
  try {
    const a = new URL(origin);
    const b = new URL(self);
    const norm = (host: string) => {
      const h = host.toLowerCase();
      return h === "127.0.0.1" || h === "[::1]" || h === "::1" ? "localhost" : h;
    };
    const portA = a.port || (a.protocol === "https:" ? "443" : "80");
    const portB = b.port || (b.protocol === "https:" ? "443" : "80");
    return a.protocol === b.protocol && norm(a.hostname) === norm(b.hostname) && portA === portB;
  } catch {
    return false;
  }
}

/** 是否携带任何访问凭据（header / body token）。 */
export function hasAnyAccessCredential(request: NextRequest, body?: Record<string, unknown>): boolean {
  if ((request.headers?.get("x-access-token") || "").trim()) return true;
  if ((request.headers?.get("x-access-password") || "").trim()) return true;
  if (body) {
    if (typeof body.accessToken === "string" && body.accessToken.trim()) return true;
    if (typeof body.accessPassword === "string" && body.accessPassword.trim()) return true;
  }
  return false;
}

// ── Unified access resolver ─────────────────────

export function resolveAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessResolution {
  // CSRF / Origin 校验
  const mutating = (() => {
    const method = (request.method || "GET").toUpperCase();
    return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
  })();
  if (mutating) {
    const origin = request.headers?.get("origin") || "";
    if (origin && !isSameOriginRequest(origin, request)) return { ok: false, reason: "origin" };
  }

  // 1) Header 通道
  const tokenHeader = (request.headers?.get("x-access-token") || "").trim();
  const passwordHeader = (request.headers?.get("x-access-password") || "").trim();
  if (tokenHeader) {
    const id = trySessionIdentity(tokenHeader);
    if (id.valid) return { ok: true, context: id.ctx! };
    return { ok: false, reason: "unauthenticated" };
  }
  if (passwordHeader) {
    const pwIdentity = trySessionIdentity(passwordHeader);
    if (pwIdentity.valid) return { ok: true, context: pwIdentity.ctx! };
  }

  // 2) Body 来源
  const bodyToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  if (bodyToken) {
    const bodyTokenIdentity = trySessionIdentity(bodyToken);
    if (bodyTokenIdentity.valid) return { ok: true, context: bodyTokenIdentity.ctx! };
  }

  // 3) Raw owner password 比较
  const configured = getAccessPassword();
  const bodyPassword = typeof body?.accessPassword === "string" ? body.accessPassword.trim() : "";
  if (configured) {
    if (bodyPassword === configured || passwordHeader === configured) {
      return { ok: true, context: { mode: "owner", token: "" } };
    }
  }

  // 4) LOCAL_OWNER 显式配置或无凭据回环信任
  if (isLocalOwnerNoAuthTrust() && !hasAnyAccessCredential(request, body)) {
    return { ok: true, context: { mode: "owner", token: "local_owner" } };
  }

  return { ok: false, reason: "unauthenticated" };
}

export function getAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessContext | null {
  const resolved = resolveAccessContext(request, body);
  return resolved.ok ? resolved.context : null;
}

export function checkAccessPassword(
  request: NextRequest,
  body?: Record<string, unknown>,
): { status: number; body: Record<string, unknown> } | null {
  const resolved = resolveAccessContext(request, body);
  if (resolved.ok) return null;
  if (resolved.reason === "origin") {
    return { status: 403, body: { error: "请求来源校验失败。" } };
  }
  if (resolved.reason === "conflict") {
    return { status: 401, body: { error: "访问凭据冲突，请重新登录。" } };
  }
  const configured = getAccessPassword();
  if (!configured && !isLocalOwnerNoAuthTrust()) {
    return {
      status: 500,
      body: { error: "服务端未配置访问密码，请在环境变量中添加 ACCESS_PASSWORD。" },
    };
  }
  return {
    status: 401,
    body: { error: "访问密码错误，请检查后重试。" },
  };
}