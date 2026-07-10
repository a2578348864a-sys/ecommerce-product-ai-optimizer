import { NextRequest } from "next/server";
import { extractAiImageDraftSnapshot } from "@/lib/aiImageDraft";
import { readAiImage } from "@/lib/server/aiImageDraftStorage";
import { loadAiImageTask } from "@/lib/server/aiImageTaskAccess";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id?: string; imageId?: string }> };

function jsonError(code: string, message: string, status: number) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const taskId = typeof params.id === "string" ? params.id.trim() : "";
  const imageId = typeof params.imageId === "string" ? params.imageId.trim() : "";
  if (!taskId || !imageId) return jsonError("invalid_id", "图片记录标识无效。", 400);

  const loaded = await loadAiImageTask({ request, taskId });
  if (!loaded.ok) return jsonError(loaded.code, loaded.message, loaded.status);

  const snapshot = extractAiImageDraftSnapshot(loaded.data.task.resultJson);
  const item = snapshot?.accessMode === loaded.data.accessMode
    ? snapshot.items.find((candidate) => candidate.id === imageId)
    : undefined;
  if (!item) return jsonError("image_not_found", "图片草稿不存在或不可访问。", 404);

  try {
    const bytes = await readAiImage(item.storageKey);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": item.mimeType,
        "content-length": String(bytes.length),
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${item.id}.${item.mimeType === "image/jpeg" ? "jpg" : item.mimeType.split("/")[1]}"`,
      },
    });
  } catch {
    return jsonError("image_not_found", "图片草稿不存在或不可访问。", 404);
  }
}
