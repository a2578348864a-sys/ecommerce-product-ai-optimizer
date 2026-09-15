/**
 * Image Studio API — standalone image generation.
 * Uses studioImageGenerator which reuses the same provider as Task API.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { consumeIpBackstop } from "@/lib/server/ipBackstop";
import {
  AI_IMAGE_DRAFT_MAX_ITEMS,
  isSafeAiImageStorageKey,
  validateAiImageGenerateRequest,
  type AiImageDraftSnapshot,
} from "@/lib/aiImageDraft";
import {
  DEFAULT_IMAGE_STYLE_PRESET_ID,
  isImageStylePresetId,
  type ImageStylePresetId,
} from "@/lib/imageStyleLibrary";
import {
  parseStudioImageInput,
  toTaskImageTypeForContext,
  type StudioImageAspectRatio,
  type StudioImagePromptContext,
  type StudioImageResultMeta,
  type StudioImageType,
} from "@/lib/studioImageInput";
import { isRealAiImageEnabled, isRealAiVisitorImageEnabled } from "@/lib/server/realAiImageGate";
import {
  generateMockStudioImage,
  generateRealStudioImage,
} from "@/lib/server/studioImageGenerator";
import { readAiImage } from "@/lib/server/aiImageDraftStorage";
import { loadStudioImageSnapshot } from "@/lib/server/studioImageResultStore";
import {
  StudioReferenceImageError,
  validateStudioReferenceImageDataUrl,
} from "@/lib/server/studioReferenceImage";

export const runtime = "nodejs";

type StudioImageApiImages = Array<{ base64: string; width?: number; height?: number }>;
type StudioImageApiImageState = { base64: string; width?: number; height?: number };

type ApiResponse =
  | {
      ok: true;
      data: {
        images: StudioImageApiImages;
        meta: StudioImageResultMeta;
      };
      demoAccess?: import("@/lib/server/demoGuard").DemoAccessSnapshot;
    }
  | {
      ok: true;
      data: {
        images: StudioImageApiImages;
        meta: StudioImageResultMeta | null;
        state: "history";
        history: true;
        updatedAt: string;
      };
    }
  | { ok: false; error: { code: string; message: string } };

function json(body: ApiResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── 历史读取（GET）：复用 studioImageResultStore 的落盘快照 ────────────────────
// 只读取当前访问主体自己的快照（owner → owner.json；访客 → visitor-<hash>.json），
// 不跨身份聚合、不接受任何客户端传入的作用域。

const STUDIO_HISTORY_MAX_IMAGES = 2;
/** 与 studioImageResultStore 的 TTL 对齐；快照落盘本身即来自真实 Provider 结果。 */
const STUDIO_HISTORY_MAX_AGE_MS = 60 * 60 * 1_000;

const HISTORY_ASPECT_RATIOS: Array<{ id: StudioImageAspectRatio; width: number; height: number }> = [
  { id: "landscape_16_9", width: 1_200, height: 675 },
  { id: "portrait_4_5", width: 800, height: 1_000 },
  { id: "square_1_1", width: 800, height: 800 },
];

/** 由落盘尺寸反推比例：只用于展示标签，不改动任何请求参数。 */
function historyAspectRatio(width?: number, height?: number): StudioImageAspectRatio {
  if (!width || !height) return "square_1_1";
  const ratio = width / height;
  let best = HISTORY_ASPECT_RATIOS[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of HISTORY_ASPECT_RATIOS) {
    const delta = Math.abs(ratio - candidate.width / candidate.height);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best.id;
}

function historyImageType(imageType: string): StudioImageType {
  if (imageType === "lifestyle_scene") return "lifestyle_scene";
  if (imageType === "feature_infographic") return "selling_point_display";
  return "product_main";
}

/**
 * 把已落盘的真实结果还原成 ImageResultWorkspace 可直接渲染的展示元数据。
 *
 * 快照只持久化「结果 + 生成依据」，不持久化原始请求体，因此这里是从存储事实
 * **推导**的展示投影：商品名/描述/摘要来自 `generationBasis`，比例来自图片尺寸，
 * 视觉方向优先取候选上记录的风格 id。缺失维度（例如 guided 的 visualStyle）
 * 使用稳定兜底值，只影响展示标签，不会被回写成请求参数。
 */
function buildHistoryMeta(
  snapshot: AiImageDraftSnapshot,
  images: StudioImageApiImageState[],
): StudioImageResultMeta {
  const first = snapshot.items[0];
  const basis = first.generationBasis;
  const creativeDirection = basis.studioStyle?.creativeDirection?.trim() ?? "";
  const stylePresetId: ImageStylePresetId = isImageStylePresetId(first.stylePresetId)
    ? first.stylePresetId
    : isImageStylePresetId(basis.studioStyle?.presetId)
      ? basis.studioStyle!.presetId
      : DEFAULT_IMAGE_STYLE_PRESET_ID;
  const aspectRatio = historyAspectRatio(images[0]?.width, images[0]?.height);
  const imageType = historyImageType(first.imageType);
  const qualityCheck = {
    source: "manual_review_only" as const,
    logo: "not_automatically_checked" as const,
    text: "not_automatically_checked" as const,
    watermark: "not_automatically_checked" as const,
    descriptionConsistency: "not_automatically_checked" as const,
    humanReviewRequired: true as const,
  };

  if (creativeDirection) {
    const avoidElements = basis.riskWarnings
      .filter((warning) => warning.startsWith("[AVOID"))
      .map((warning) => warning.replace(/^\[AVOID \d+\/\d+\]\s*/u, "").trim())
      .filter(Boolean)
      .join(" ");
    const promptSummary = first.promptSummary
      || basis.sellingPoints[0]
      || basis.imageMaterialNeeds[0]
      || "历史候选图";
    const context: StudioImagePromptContext = {
      creationMode: "prompt",
      productName: basis.productName ?? "",
      description: basis.sellingPoints[0] ?? "",
      aspectRatio,
      count: images.length === 2 ? 2 : 1,
      stylePresetId,
      creativePrompt: creativeDirection,
      avoidElements,
    };
    return {
      mode: "real",
      visualAuthority: "composition_concept",
      creationMode: "prompt",
      duplicate: false,
      input: {
        creationMode: "prompt",
        productName: context.productName,
        description: context.description,
        aspectRatio: context.aspectRatio,
        count: context.count,
        stylePresetId: context.stylePresetId,
        promptSummary,
        avoidElementsSummary: avoidElements || "未设置额外避免元素",
      },
      promptSummary,
      avoidElementsSummary: avoidElements || "未设置额外避免元素",
      qualityCheck,
    };
  }

  const composition = basis.imageMaterialNeeds
    .filter((need) => !/^Studio requested aspect ratio:/u.test(need))
    .join(" ");
  return {
    mode: "real",
    visualAuthority: "composition_concept",
    creationMode: "guided",
    duplicate: false,
    input: {
      creationMode: "guided",
      productName: basis.productName ?? "",
      description: basis.sellingPoints[0] ?? "",
      imageType,
      // 原始 visualStyle 不在快照合同内；这里只作为展示兜底，不代表当时的实际取值。
      visualStyle: "minimal",
      stylePresetId,
      aspectRatio,
      count: images.length === 2 ? 2 : 1,
      compositionRequirements: composition,
      prohibitedElements: "",
    },
    qualityCheck,
  };
}

async function loadHistoryImages(snapshot: AiImageDraftSnapshot): Promise<StudioImageApiImageState[]> {
  const images: StudioImageApiImageState[] = [];
  for (const item of snapshot.items) {
    if (images.length >= STUDIO_HISTORY_MAX_IMAGES) break;
    if (!isSafeAiImageStorageKey(item.storageKey)) continue;
    try {
      const bytes = await readAiImage(item.storageKey);
      images.push({
        base64: `data:${item.mimeType};base64,${bytes.toString("base64")}`,
        width: item.width,
        height: item.height,
      });
    } catch {
      // 单张字节缺失/损坏不影响其余历史候选。
    }
  }
  return images;
}

export async function GET(request: NextRequest) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }

  const accessMode = auth.context.mode === "owner" ? "owner" as const : "visitor" as const;
  const visitorAccessId = auth.context.mode === "demo" ? auth.context.demoAccessId : undefined;
  const emptyHistory = () => json({
    ok: true,
    data: {
      images: [] as StudioImageApiImageState[],
      meta: null,
      state: "history" as const,
      history: true as const,
      updatedAt: "",
    },
  });

  try {
    const snapshot = await loadStudioImageSnapshot({ accessMode, visitorAccessId });
    if (!snapshot) return emptyHistory();

    const items = snapshot.items
      .filter((item) => Date.parse(item.createdAt) > Date.now() - STUDIO_HISTORY_MAX_AGE_MS)
      .slice(-Math.min(STUDIO_HISTORY_MAX_IMAGES, AI_IMAGE_DRAFT_MAX_ITEMS));
    if (items.length === 0) return emptyHistory();
    const scopedSnapshot: AiImageDraftSnapshot = { ...snapshot, items };

    const images = await loadHistoryImages(scopedSnapshot);
    if (images.length === 0) return emptyHistory();

    return json({
      ok: true,
      data: {
        images,
        meta: buildHistoryMeta(scopedSnapshot, images),
        state: "history" as const,
        history: true as const,
        updatedAt: items[items.length - 1].createdAt,
      },
    });
  } catch {
    // 存储损坏等确定性失败：返回稳定契约，不泄漏本地路径或上游原文。
    return json({ ok: false, error: { code: "studio_history_unavailable", message: "历史图片暂时无法读取，请重新生成。" } }, 500);
  }
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