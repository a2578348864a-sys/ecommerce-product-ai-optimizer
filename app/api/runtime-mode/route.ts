/**
 * V3.1 Phase 1 — Runtime Mode 公开只读端点
 * GET /api/runtime-mode → { ok: true, mode, noAuthOwner }
 *
 * 供客户端决定渲染（公开 landing / 无认证工作台 / 登录页）。模式本身是部署配置，非秘密；
 * 权限边界始终由服务端 resolver 强制（契约 01-2 / §29 / §30）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getRuntimeMode, isLocalOwnerNoAuthTrust } from "@/lib/server/runtimeMode";

export async function GET(request: NextRequest) {
  void request;
  return NextResponse.json({
    ok: true,
    mode: getRuntimeMode(),
    noAuthOwner: isLocalOwnerNoAuthTrust(),
  });
}
