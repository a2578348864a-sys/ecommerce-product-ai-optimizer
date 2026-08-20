/**
 * Image Studio API — standalone image generation.
 * Uses studioImageGenerator which reuses the same provider as Task API.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { consumeIpBackstop } from "@/lib/server/ipBackstop";
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
import {
  StudioReferenceImageError,
  validateStudioReferenceImageDataUrl,
} from "@/lib/server/studioReferenceImage";

export const runtime = "nodejs";

type ApiResponse =
  | {
      ok: true;
      data: {
        images: Array<{ base64: string; width?: number; height?: number }>;
        meta: StudioImageResultMeta;
      };
      demoAccess?: import("@/lib/server/demoGuard").DemoAccessSnapshot;
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

  try {
    await validateStudioReferenceImageDataUrl(studioInput.referenceImageDataUrl);
  } catch (error) {
    if (error instanceof StudioReferenceImageError) {
      return json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
    }
    return json({ ok: false, error: { code: "invalid_reference_image", message: "参考图校验失败，请重新上传。" } }, 400);
  }

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

  if (!isRealAiImageEnabled()) {
    return json({ ok: false, error: { code: "real_ai_disabled", message: "真实 AI 图片生成暂未开启。" } }, 403);
  }
  if (auth.context.mode === "demo" && !isRealAiVisitorImageEnabled()) {
    return json({
      ok: false,
      error: { code: "visitor_image_generation_disabled", message: "图片生成暂未对访客开放。" },
    }, 403);
  }

  const validated = validateAiImageGenerateRequest({
    imageType: toTaskImageTypeForContext(studioInput),
    count: studioInput.count,
    additionalDirection: studioInput.creationMode === "guided"
      ? studioInput.legacyAdditionalDirection || studioInput.compositionRequirements || undefined
      : undefined,
    confirmed: studioInput.confirmRealAi,
    idempotencyKey: studioInput.idempotencyKey,
  }, auth.context.mode === "owner" ? "owner" : "visitor", { allowVisitorBatch: true });
  if (!validated.ok) {
    return json({ ok: false, error: { code: validated.code, message: validated.message } }, 400);
  }

  const result = await generateRealStudioImage({
    accessContext: auth.context,
    studio: studioInput,
    request: validated.data,
  });
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);

  return json({
    ok: true,
    data: { images: result.images, meta: result.meta },
    ...(result.demoAccess ? { demoAccess: result.demoAccess } : {}),
  });
}