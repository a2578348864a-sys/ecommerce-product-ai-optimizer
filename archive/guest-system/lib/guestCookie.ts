/**
 * V3.1 Phase 1 — Guest Cookie（契约 09，冻结）
 *
 * Cookie = token 传输层，只存 existing signed token（stok_v1...）。
 * 不得存 quota / sandbox state / permissions / owner mode / remaining count。
 *
 * 规格（FROZEN）：__Host-lqx_guest；HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200; 无 Domain。
 * TTL 对齐（契约 03-2 / 06）：GUEST_COOKIE_MAX_AGE(12h) <= PUBLIC_GUEST_AUTH_TTL(12h) <= stok_v1 exp(12h)。
 * Secure 永远开启：正式 production 配置必须 HTTPS（契约 09-5 / 11）；本地测试用 isolated harness，不得降级契约。
 */
import "server-only";
import type { NextRequest } from "next/server";

export const GUEST_COOKIE_NAME = "__Host-lqx_guest";
export const GUEST_AUTH_TTL_HOURS = 12;
export const GUEST_COOKIE_MAX_AGE_SECONDS = GUEST_AUTH_TTL_HOURS * 60 * 60; // 43200

export interface GuestCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function guestCookieOptions(): GuestCookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  };
}

/** 读取 guest cookie 中的 token（缺失/空 → ""）。 */
export function readGuestCookieToken(request: NextRequest): string {
  return request.cookies?.get(GUEST_COOKIE_NAME)?.value?.trim() ?? "";
}
