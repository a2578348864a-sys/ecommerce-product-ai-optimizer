/**
 * V3.1 Phase 1 — Unified Access Resolver（契约 03-5 / §16，冻结）
 *
 * 统一入口 resolveAccessContext(request, body)，所有 protected route 经 demoGuard 使用，
 * 不允许各自重复实现 Cookie 解析。
 *
 * Token 来源矩阵（FROZEN，§16 / 契约 03-5）：
 *   NONE                    → unauthenticated
 *   COOKIE valid only       → ACCEPT
 *   LEGACY HEADER valid only→ ACCEPT
 *   COOKIE + HEADER 同一身份 → ACCEPT
 *   COOKIE + HEADER 不同身份 → FAIL CLOSED（token_context_conflict）
 *   invalid COOKIE + valid HEADER → FAIL CLOSED
 *   valid COOKIE + invalid HEADER → FAIL CLOSED
 *   both invalid            → FAIL CLOSED
 * 禁止 cookie wins / header wins / silent fallback。
 *
 * 运行模式（契约 01）：
 *   - 缺省（未显式设置 QX_RUNTIME_MODE）= v3.0.1 现状语义（密码门原样，安全默认）；
 *   - 显式 local_owner = 无认证回环信任（§6：NO AUTH / FULL OWNER）；
 *   - public_showcase = 无密码公开访客；遗留 raw-password 认证关闭（契约 07/10）。
 *
 * CSRF 基础（契约 09-4 / §28）：变更方法（POST/PATCH/PUT/DELETE）+ Origin 存在但不匹配 → 403 origin_mismatch。
 */

import type { NextRequest } from "next/server";
import {
  getAccessSession,
} from "@/lib/server/accessSession";
import {
  getDemoAccessById,
  getRemainingAiCalls,
} from "@/lib/server/demoAccess";
import { getRuntimeMode, isPublicShowcase, isLocalOwnerNoAuthTrust } from "@/lib/server/runtimeMode";
import { readGuestCookieToken } from "@/lib/server/guestCookie";

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
  /** 显式判别字段（契约 02 / §9）；遗留记录缺省为 "password"。 */
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
  if (session.mode === "demo" && session.demoAccessId) {
    const demoAccess = getDemoAccessById(session.demoAccessId);
    // Auth-Hardening.1: fail closed — no demo record → reject
    if (!demoAccess) return { present: true, valid: false, ctx: null };
    // Fail closed — demo is inactive/disabled
    if (!demoAccess.isActive) return { present: true, valid: false, ctx: null };
    return {
      present: true,
      valid: true,
      ctx: {
        mode: "demo",
        token: session.token,
        demoAccessId: session.demoAccessId,
        isActive: demoAccess.isActive,
        isExpired: false,
        remainingAiCalls: getRemainingAiCalls(demoAccess),
        credentialKind: demoAccess.credentialKind === "anonymous" ? "anonymous" : "password",
      },
    };
  }
  return { present: true, valid: false, ctx: null }; // session exists but not owner/demo
}

function sameIdentity(a: AccessContext, b: AccessContext): boolean {
  if (a.mode !== b.mode) return false;
  if (a.mode === "owner") return true;
  return (a as DemoAccessContext).demoAccessId === (b as DemoAccessContext).demoAccessId;
}

/**
 * Origin 同源判定（契约 09-4 / §28）。
 * 精确比较优先；回环主机归一化兜底（本定制 Next 会把 127.0.0.1 规范化为 localhost，
 * 本地/回环部署下浏览器 Origin 可能是 127.0.0.1 而 nextUrl.origin 是 localhost）。
 * 跨站伪造 Origin 不可能通过（浏览器自动设置 Origin，JS 无法伪造）。
 */
export function isSameOriginRequest(origin: string, request: NextRequest): boolean {
  const self = (request as { nextUrl?: { origin?: string } }).nextUrl?.origin;
  if (!self) return false;
  if (origin === self) return true;
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

function originMismatch(request: NextRequest): boolean {
  const method = (request.method || "GET").toUpperCase();
  if (method !== "POST" && method !== "PATCH" && method !== "PUT" && method !== "DELETE") return false;
  const origin = request.headers?.get("origin") || "";
  if (!origin) return false;
  const self = (request as { nextUrl?: { origin?: string } }).nextUrl?.origin;
  if (!self) return false;
  return !isSameOriginRequest(origin, request);
}

/** 是否携带任何访问凭据（header / guest cookie / body token）。 */
export function hasAnyAccessCredential(request: NextRequest, body?: Record<string, unknown>): boolean {
  if ((request.headers?.get("x-access-token") || "").trim()) return true;
  if ((request.headers?.get("x-access-password") || "").trim()) return true;
  if (readGuestCookieToken(request)) return true;
  if (body) {
    if (typeof body.accessToken === "string" && body.accessToken.trim()) return true;
    if (typeof body.accessPassword === "string" && body.accessPassword.trim()) return true;
  }
  return false;
}

// ── Unified access resolver（§16）───────────────

export function resolveAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessResolution {
  // 0) CSRF 基础：变更方法 + Origin 存在但不匹配 → 拒绝（契约 09-4）
  if (originMismatch(request)) return { ok: false, reason: "origin" };

  // 1) Legacy header 通道（保持既有语义）：
  //    - x-access-token：存在即定案（有效 → 身份；无效 → fail-closed，不回退）
  //    - x-access-password：遗留双用途（token 或 raw password）；能解析为 token 才算 header 身份，
  //      否则不 fail-closed，交由下方 raw password 比较（向后兼容既有 raw 头认证）
  const tokenHeader = (request.headers?.get("x-access-token") || "").trim();
  const passwordHeader = (request.headers?.get("x-access-password") || "").trim();
  let headerIdentity: TokenIdentity = { present: false, valid: false, ctx: null };
  if (tokenHeader) {
    headerIdentity = trySessionIdentity(tokenHeader);
  } else if (passwordHeader) {
    const pwIdentity = trySessionIdentity(passwordHeader);
    if (pwIdentity.valid) headerIdentity = pwIdentity;
  }

  // 2) Guest cookie 通道（token 传输层）
  const cookieIdentity = trySessionIdentity(readGuestCookieToken(request));

  // 3) COOKIE + HEADER 冲突矩阵（契约 03-5 / §8）
  if (cookieIdentity.present && headerIdentity.present) {
    if (cookieIdentity.valid && headerIdentity.valid) {
      return sameIdentity(cookieIdentity.ctx!, headerIdentity.ctx!)
        ? { ok: true, context: headerIdentity.ctx! }
        : { ok: false, reason: "conflict" };
    }
    return { ok: false, reason: "conflict" };
  }
  if (cookieIdentity.present) {
    return cookieIdentity.valid
      ? { ok: true, context: cookieIdentity.ctx! }
      : { ok: false, reason: "unauthenticated" };
  }
  if (headerIdentity.present) {
    return headerIdentity.valid
      ? { ok: true, context: headerIdentity.ctx! }
      : { ok: false, reason: "unauthenticated" };
  }

  // 4) body 来源（遗留兼容；仅当 header/cookie 都缺失时处理）。
  //    既有语义：body token 无效不 fail-closed，继续回退 raw password 比较（保持向后兼容）。
  const bodyToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
  const bodyTokenIdentity = trySessionIdentity(bodyToken);
  if (bodyTokenIdentity.valid) return { ok: true, context: bodyTokenIdentity.ctx! };

  const bodyPassword = typeof body?.accessPassword === "string" ? body.accessPassword.trim() : "";
  const bodyPwIdentity = trySessionIdentity(bodyPassword);
  if (bodyPwIdentity.valid) return { ok: true, context: bodyPwIdentity.ctx! };

  // 5) Legacy raw owner password（仅非 public_showcase；契约 07/10：showcase 无密码认证）。
  //    body.accessPassword 与 x-access-password 头均可承载 raw password（既有向后兼容，含无 body 请求）。
  if (!isPublicShowcase()) {
    const configured = getAccessPassword();
    if (configured) {
      if (bodyPassword === configured) return { ok: true, context: { mode: "owner", token: "" } };
      if (passwordHeader === configured) return { ok: true, context: { mode: "owner", token: "" } };
    }
  }

  // 6) LOCAL_OWNER 显式配置 → 无认证回环信任（§6：NO AUTH / NO PASSWORD / NO QUOTA / FULL OWNER）
  if (isLocalOwnerNoAuthTrust() && !hasAnyAccessCredential(request, body)) {
    return { ok: true, context: { mode: "owner", token: "" } };
  }

  return { ok: false, reason: "unauthenticated" };
}

/**
 * Backward-compatible wrapper（既有调用方与测试：冲突/来源/未认证统一返回 null）。
 */
export function getAccessContext(
  request: NextRequest,
  body?: Record<string, unknown>,
): AccessContext | null {
  const resolved = resolveAccessContext(request, body);
  return resolved.ok ? resolved.context : null;
}

/**
 * Legacy checkAccessPassword — kept for backward compatibility（tasks / opportunity-candidates 等路由）。
 * Returns null if authorized, or error object if not.
 */
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
  if (!configured) {
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