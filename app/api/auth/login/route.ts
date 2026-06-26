/**
 * Phase Demo-Login.1-C — Unified Login API
 *
 * POST /api/auth/login
 * Body: { password: string }
 *
 * Authenticates against Owner password (env var) or Demo passwords (file store).
 * Returns an access token and mode info. Does NOT return the original password.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccessPassword } from "@/lib/server/accessPassword";
import { findDemoAccessByPassword, isDemoAccessActive, getRemainingAiCalls, activateDemoAccessOnFirstLogin } from "@/lib/server/demoAccess";
import { createOwnerSession, createDemoSession } from "@/lib/server/accessSession";

export async function POST(request: NextRequest) {
  // Parse body
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_request", message: "请求格式无效。" } },
      { status: 400 }
    );
  }

  const password = (body.password || "").trim();
  if (!password) {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_access", message: "请输入访问密码。" } },
      { status: 401 }
    );
  }

  // 1) Check Owner password (from env var)
  const ownerPassword = getAccessPassword();
  if (ownerPassword && password === ownerPassword) {
    const session = createOwnerSession();
    return NextResponse.json({
      ok: true,
      mode: "owner",
      accessToken: session.token,
    });
  }

  // 2) Check Demo passwords (from file store)
  let demoAccess = findDemoAccessByPassword(password);
  if (demoAccess) {
    if (!demoAccess.isActive) {
      return NextResponse.json(
        { ok: false, error: { code: "demo_access_inactive", message: "该演示访问已被停用。" } },
        { status: 403 }
      );
    }

    // Activate on first login: start 24h timer from now
    if (!demoAccess.expiresAt) {
      const activated = activateDemoAccessOnFirstLogin(demoAccess.id, 24);
      if (activated) demoAccess = activated;
    }

    // Check expiry (only relevant after activation)
    if (demoAccess.expiresAt && new Date(demoAccess.expiresAt) < new Date()) {
      return NextResponse.json(
        { ok: false, error: { code: "demo_access_expired", message: "该演示访问已超过 24 小时有效期。" } },
        { status: 403 }
      );
    }

    // Allow login even with 0 remaining AI calls — frontend shows 0, API will block actual AI calls later
    const session = createDemoSession(demoAccess.id);
    return NextResponse.json({
      ok: true,
      mode: "demo",
      accessToken: session.token,
      demoAccess: {
        id: demoAccess.id,
        label: demoAccess.label,
        expiresAt: demoAccess.expiresAt,
        maxAiCalls: demoAccess.maxAiCalls,
        usedAiCalls: demoAccess.usedAiCalls,
        remainingAiCalls: getRemainingAiCalls(demoAccess),
      },
    });
  }

  // 3) Invalid password
  return NextResponse.json(
    { ok: false, error: { code: "invalid_access", message: "访问密码无效。" } },
    { status: 401 }
  );
}
