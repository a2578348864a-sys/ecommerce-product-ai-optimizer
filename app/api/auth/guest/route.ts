/**
 * V3.1 Phase 1 — Guest Start（契约 02-5 / 03 / 09 / §11 / §31）
 *
 * POST /api/auth/guest
 *
 * 行为（FROZEN）：
 *   - 仅 PUBLIC_SHOWCASE 模式提供（LOCAL_OWNER / 缺省 = 现状语义下返回 403）。
 *   - 合法 __Host-lqx_guest cookie → REUSE 当前 demo-access / quota / sandbox identity（不重建 Guest）。
 *   - missing / expired / revoked / invalid → 创建 anonymous demo-access → 铸造 existing stok_v1 → Set-Cookie。
 *   - Cookie 只存 signed token；响应体不返回 token（浏览器只经 HttpOnly Cookie 携带）。
 *   - CSRF 基础（契约 09-4 / §28）：跨站 Origin → 403。
 */
import { NextRequest, NextResponse } from "next/server";
import { generateSignedToken } from "@/lib/server/signedToken";
import { getAccessSession } from "@/lib/server/accessSession";
import { createDemoAccess, getDemoAccessById, updateDemoLastUsed } from "@/lib/server/demoAccess";
import { buildDemoAccessSnapshot } from "@/lib/server/demoGuard";
import { isSameOriginRequest } from "@/lib/server/accessPassword";
import { isPublicShowcase } from "@/lib/server/runtimeMode";
import {
  GUEST_COOKIE_NAME,
  GUEST_AUTH_TTL_HOURS,
  guestCookieOptions,
  readGuestCookieToken,
} from "@/lib/server/guestCookie";

export async function POST(request: NextRequest) {
  // 仅 PUBLIC_SHOWCASE 提供 guest 铸造（§7）；缺省/显式 local_owner 保持现状语义
  if (!isPublicShowcase()) {
    return NextResponse.json(
      { ok: false, error: { code: "guest_start_unavailable", message: "当前运行模式不提供公开访客体验。" } },
      { status: 403 }
    );
  }

  // CSRF 基础：跨站 Origin 禁止调用 guest mutation（§28）
  const origin = request.headers.get("origin") || "";
  if (origin && !isSameOriginRequest(origin, request)) {
    return NextResponse.json(
      { ok: false, error: { code: "origin_mismatch", message: "请求来源校验失败。" } },
      { status: 403 }
    );
  }

  try {
    // 1) REUSE：合法 guest cookie → 同一 demo-access / quota / sandbox identity（§11 / §31）
    const cookieToken = readGuestCookieToken(request);
    if (cookieToken) {
      const session = getAccessSession(cookieToken);
      if (session && session.mode === "demo" && session.demoAccessId) {
        const record = getDemoAccessById(session.demoAccessId);
        if (record && record.isActive && record.credentialKind === "anonymous") {
          updateDemoLastUsed(record.id);
          return NextResponse.json({
            ok: true,
            mode: "demo",
            reused: true,
            cookieName: GUEST_COOKIE_NAME,
            ttlHours: GUEST_AUTH_TTL_HOURS,
            demoAccess: buildDemoAccessSnapshot(record),
          });
        }
      }
    }

    // 2) CREATE：missing / expired / revoked / invalid → 新 anonymous demo-access + stok_v1 + Set-Cookie
    const { record } = createDemoAccess({ label: "公开访客", credentialKind: "anonymous" });
    const token = generateSignedToken("demo", record.id);

    const response = NextResponse.json({
      ok: true,
      mode: "demo",
      reused: false,
      cookieName: GUEST_COOKIE_NAME,
      ttlHours: GUEST_AUTH_TTL_HOURS,
      demoAccess: buildDemoAccessSnapshot(record),
    });
    // Cookie = token 传输层（契约 09-1）：HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200; 无 Domain
    response.cookies.set(GUEST_COOKIE_NAME, token, guestCookieOptions());
    return response;
  } catch (error) {
    console.error("[auth/guest] guest start failed", {
      code: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { ok: false, error: { code: "server_error", message: "演示体验暂时不可用，请稍后重试。" } },
      { status: 500 }
    );
  }
}
