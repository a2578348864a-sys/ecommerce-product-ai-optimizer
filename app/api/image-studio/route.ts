/**
 * Image Studio API — standalone image generation.
 * Uses studioImageGenerator which reuses the same provider as Task API.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { validateAiImageGenerateRequest } from "@/lib/aiImageDraft";
import {
  parseStudioImageInput,
  toTaskImageTypeForContext,
  type StudioImageResultMeta,
} from "@/lib/studioImageInput";
import { isRealAiImageEnabled, isRealAiVisitorImageEnabled } from "@/lib/server/realAiImageGate";
import {
  generateMockStudioImage,
  generateRealStudioImage,
} from "@/lib/server/studioImageGenerator";

export const runtime = "nodejs";

type ApiResponse =
  | {
      ok: true;
      data: {
        images: Array<{ base64: string; width?: number; height?: number }>;
        meta: StudioImageResultMeta;
      };
    }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体不是合法 JSON。" } }, 400);
  }
  if (!isRecord(body)) {
    return json({ ok: false, error: { code: "invalid_json", message: "请求体必须是 JSON object。" } }, 400);
  }

  const auth = requireAuthenticated(request, body);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: { code: auth.code, message: auth.message } }, { status: auth.status });
  }

  const parsed = parseStudioImageInput(body);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const studioInput = parsed.data;
  const realMode = studioInput.mode === "real";

  if (!realMode) {
    const mock = generateMockStudioImage(studioInput);
    if (!mock.ok) return json({ ok: false, error: mock.error }, mock.status);
    return json({ ok: true, data: { images: mock.images, meta: mock.meta } });
  }

  if (!studioInput.confirmRealAi) {
    return json({
      ok: false,
      error: { code: "real_ai_confirmation_required", message: "真实 AI 图片生成需要显式确认。" },
    }, 400);
  }

  // V2 Final Integration（规格十四节）: 真实图片生成已迁移到任务详情页的 Creative Handoff 链。
  // 此独立 Studio 的 real 模式绕过 Handoff Gate / Visual Gate / Binding，一律返回已迁移错误。
  return json({
    ok: false,
    error: { code: "image_studio_real_migrated", message: "真实图片生成已迁移到任务详情页的创作交接流程，请在任务内生成。" },
  }, 422);
}
