import { NextRequest, NextResponse } from "next/server";
import { checkAccessPassword } from "@/lib/server/accessPassword";
import { getTaskProductImageBuffer } from "@/lib/server/taskProductImage";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> },
) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });

  const { id: rawId } = await context.params;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id) {
    return NextResponse.json({ ok: false, error: { code: "invalid_id", message: "缺少任务 ID。" } }, { status: 400 });
  }

  try {
    const image = await getTaskProductImageBuffer(id);
    if (!image) {
      return NextResponse.json({ ok: false, error: { code: "image_unavailable", message: "商品主图不可用。" } }, { status: 404 });
    }

    return new NextResponse(image.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.buffer.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "server_error", message: "读取商品图片失败。" } }, { status: 500 });
  }
}
