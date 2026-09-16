/**
 * Core Product Login API
 *
 * POST /api/auth/login
 * Body: { password: string }
 *
 * Authenticates against Owner password (env var ACCESS_PASSWORD).
 * Returns an access token and owner mode.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAccessPassword } from "@/lib/server/accessPassword";
import { createOwnerSession } from "@/lib/server/accessSession";
import { generateSignedToken } from "@/lib/server/signedToken";

export async function POST(request: NextRequest) {
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

  const ownerPassword = getAccessPassword();
  if (ownerPassword && password === ownerPassword) {
    let signedToken: string;
    try {
      signedToken = generateSignedToken("owner");
    } catch {
      return NextResponse.json(
        { ok: false, error: { code: "server_error", message: "登录服务暂时不可用，请稍后重试。" } },
        { status: 500 }
      );
    }
    createOwnerSession();
    return NextResponse.json({
      ok: true,
      mode: "owner",
      accessToken: signedToken,
    });
  }

  return NextResponse.json(
    { ok: false, error: { code: "invalid_access", message: "访问密码错误，请检查后重试。" } },
    { status: 401 }
  );
}
