import { NextRequest, NextResponse } from "next/server";
import { checkAccessPassword, getAccessContext } from "@/lib/server/accessPassword";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";
import { readCandidateProductImageSnapshot } from "@/lib/productResearchImage";

export const runtime = "nodejs";

/**
 * 轮 6：候选商品身份绑定真实缓存主图（仅当前 Owner/Sandbox 访问域）。
 * - 图片读取复用既有权威解析器（parseCandidateImage：版本/内容哈希/身份一致性）。
 * - 不暴露 sourceMeta / candidateId 绑定信息 / 内部 hash（响应只有图片字节与 MIME）。
 * - 损坏、身份冲突、缺图、越权（候选不在当前访问域）统一 404。
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> },
) {
  const authError = checkAccessPassword(request);
  if (authError) return NextResponse.json(authError.body, { status: authError.status });
  const access = getAccessContext(request);
  if (!access) {
    return NextResponse.json({ ok: false, error: { code: "invalid_access", message: "请先登录后再操作。" } }, { status: 401 });
  }
  const params = await context.params;
  const id = (params.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: { code: "invalid_id", message: "缺少候选 ID。" } }, { status: 400 });
  }
  try {
    const candidate = await getAuthoritativeCandidate(access, id);
    if (!candidate) {
      return NextResponse.json({ ok: false, error: { code: "image_unavailable", message: "商品图暂不可用。" } }, { status: 404 });
    }
    const image = readCandidateProductImageSnapshot(candidate.sourceMetaJson);
    if (!image) {
      return NextResponse.json({ ok: false, error: { code: "image_unavailable", message: "商品图暂不可用。" } }, { status: 404 });
    }
    const base64 = image.dataUrl.split(",")[1] ?? "";
    const bytes = Buffer.from(base64, "base64");
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: { code: "image_unavailable", message: "商品图暂不可用。" } }, { status: 404 });
  }
}
