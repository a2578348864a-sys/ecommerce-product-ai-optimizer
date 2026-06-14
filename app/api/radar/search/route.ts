import { NextRequest, NextResponse } from "next/server";
import { defaultPlatformStatus, platformOptions } from "@/lib/types";
import type { Platform, PlatformSearchStatus } from "@/lib/types";

export const runtime = "nodejs";

function isRadarEnabled() {
  return process.env.NODE_ENV !== "production";
}

function radarNotFoundResponse() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function isLocalRequest(request: NextRequest) {
  const host = request.headers.get("host") || "";
  return host.startsWith("localhost:")
    || host.startsWith("127.0.0.1:")
    || host.startsWith("[::1]:");
}

function readableStatus(platform: Platform): PlatformSearchStatus {
  if (platform === "manual") {
    return {
      platform,
      status: "manual_required",
      message: "V1 以手动粘贴和截图为主，请复制你能看到的商品、榜单信息后再生成证据卡片。",
      itemCount: 0,
    };
  }

  if (platform === "jd") {
    return {
      platform,
      status: "manual_required",
      message: "V1 仅预留京东公开页面读取结构，当前不自动打开页面，请手动粘贴可见信息。",
      itemCount: 0,
    };
  }

  return {
    platform,
    status: "not_supported_yet",
    message: "该平台 V1 不做自动读取，请上传截图或手动复制公开可见信息。不会绕过登录、验证码或平台限制。",
    itemCount: 0,
  };
}

export async function POST(request: NextRequest) {
  if (!isRadarEnabled()) {
    return radarNotFoundResponse();
  }

  if (!isLocalRequest(request)) {
    return NextResponse.json(
      {
        error: "本地辅助查询只允许在 localhost 使用。线上环境请使用手动粘贴模式。",
        statuses: defaultPlatformStatus,
      },
      { status: 403 },
    );
  }

  let selectedPlatforms: Platform[] = ["manual"];
  try {
    const body = await request.json();
    if (Array.isArray(body?.selectedPlatforms)) {
      selectedPlatforms = body.selectedPlatforms.filter((item: unknown): item is Platform =>
        typeof item === "string" && platformOptions.includes(item as Platform),
      );
    }
  } catch {
    return NextResponse.json(
      {
        error: "查询参数格式不正确，请刷新页面后重试。",
        statuses: defaultPlatformStatus,
      },
      { status: 400 },
    );
  }

  const uniquePlatforms: Platform[] = Array.from(new Set<Platform>(selectedPlatforms.length ? selectedPlatforms : ["manual"]));
  return NextResponse.json({
    items: [],
    statuses: uniquePlatforms.map(readableStatus),
    message: "V1 不做真实平台自动读取，请使用图片、链接和手动文字继续分析。",
  });
}
