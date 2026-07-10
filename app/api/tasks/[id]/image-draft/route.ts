import { NextRequest, NextResponse } from "next/server";
import { extractAiImageDraftSnapshot, validateAiImageGenerateRequest } from "@/lib/aiImageDraft";
import { generateAiImageDraft } from "@/lib/server/aiImageDraftService";
import { loadAiImageTask } from "@/lib/server/aiImageTaskAccess";
import { getLatestDemoSnapshot } from "@/lib/server/demoGuard";
import { isRealAiImageEnabled } from "@/lib/server/realAiImageGate";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id?: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function taskIdFrom(context: RouteContext): Promise<string> {
  const id = (await context.params).id;
  return typeof id === "string" ? id.trim() : "";
}

function errorStatus(code: string): number {
  if (code === "real_ai_disabled" || code === "visitor_ai_quota_exceeded") return 403;
  if (["image_request_in_progress", "image_request_already_failed", "image_request_conflict"].includes(code)) return 409;
  if (code === "image_provider_rate_limited") return 429;
  if (["image_provider_timeout", "image_provider_unavailable", "image_provider_error", "image_response_invalid"].includes(code)) return 502;
  if (code === "image_content_blocked") return 422;
  return 500;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const taskId = await taskIdFrom(context);
  if (!taskId) return json({ ok: false, error: { code: "invalid_id", message: "请提供有效的任务记录 ID。" } }, 400);

  const loaded = await loadAiImageTask({ request, taskId });
  if (!loaded.ok) return json({ ok: false, error: { code: loaded.code, message: loaded.message } }, loaded.status);

  const visitorAccess = loaded.data.accessMode === "visitor"
    ? getLatestDemoSnapshot(loaded.data.accessContext)
    : null;
  return json({
    ok: true,
    data: {
      enabled: isRealAiImageEnabled(),
      accessMode: loaded.data.accessMode,
      maxCount: loaded.data.accessMode === "owner" ? 2 : 1,
      snapshot: extractAiImageDraftSnapshot(loaded.data.task.resultJson),
      visitorAccess,
    },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const taskId = await taskIdFrom(context);
  if (!taskId) return json({ ok: false, error: { code: "invalid_id", message: "请提供有效的任务记录 ID。" } }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  const bodyRecord = isRecord(body) ? body : {};
  const loaded = await loadAiImageTask({ request, taskId, body: bodyRecord });
  if (!loaded.ok) return json({ ok: false, error: { code: loaded.code, message: loaded.message } }, loaded.status);

  const validated = validateAiImageGenerateRequest(body, loaded.data.accessMode);
  if (!validated.ok) return json({ ok: false, error: { code: validated.code, message: validated.message } }, 400);

  const generated = await generateAiImageDraft({ loadedTask: loaded.data, request: validated.data });
  if (!generated.ok) {
    return json({ ok: false, error: generated.error }, errorStatus(generated.error.code));
  }
  return json({ ok: true, data: generated.data });
}
