/**
 * Core Product Authentication Guard — Local Owner
 *
 * Provides authentication and permission checks for the core product.
 * In local_owner mode with noAuthOwner, allows full owner capability.
 */

import "server-only";
import type { NextRequest } from "next/server";
import {
  resolveAccessContext,
  type AccessContext,
} from "@/lib/server/accessPassword";
import { isLocalOwnerNoAuthTrust } from "@/lib/server/runtimeMode";

export type GuardResult =
  | { ok: true; context: AccessContext }
  | { ok: false; status: number; code: string; message: string };

function guardError(status: number, code: string, message: string): GuardResult {
  return { ok: false, status, code, message };
}

export function requireAuthenticated(
  request: NextRequest,
  body?: Record<string, unknown>,
): GuardResult {
  if (isLocalOwnerNoAuthTrust()) {
    return { ok: true, context: { mode: "owner", token: "local_owner" } };
  }
  const resolved = resolveAccessContext(request, body);
  if (!resolved.ok) {
    if (resolved.reason === "conflict") {
      return guardError(401, "token_context_conflict", "访问凭据冲突，请重新登录后再操作。");
    }
    if (resolved.reason === "origin") {
      return guardError(403, "origin_denied", "请求来源校验失败。");
    }
    return guardError(401, "invalid_access", "请先登录后再操作。");
  }
  return { ok: true, context: resolved.context };
}

export function requireOwnerOnly(
  request: NextRequest,
  body?: Record<string, unknown>,
): GuardResult {
  return requireAuthenticated(request, body);
}
