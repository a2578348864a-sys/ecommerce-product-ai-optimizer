import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * B3 收口：历史 A–E 批量分析根路由已下线（V4 研究图 /api/v4/runs 替代）。
 * 返回明确 410，不解析 body、不调用管线/配额/Provider、不写数据。
 * 子路由（crawl / source-import / sellersprite-import / sellersprite-preview /
 * sellersprite-plugin-import）为保留服务，不受影响。
 */
export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { ok: false, error: { code: "legacy_endpoint", message: "该批量分析接口已下线，请使用新的研究与机会分析流程。" } },
    { status: 410 },
  );
}
