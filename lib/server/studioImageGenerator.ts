import "server-only";

import { createHash } from "node:crypto";
import type { AiImageGenerateRequest } from "@/lib/aiImageDraft";
import {
  toStudioImageContext,
  toTaskImageTypeForContext,
  type StudioImageInput,
  type StudioImagePublicPromptContext,
  type StudioImageResultMeta,
  type StudioImageType,
  type StudioImageVisualStyle,
} from "@/lib/studioImageInput";
import type { AccessContext } from "@/lib/server/accessPassword";
import type { DemoAccessSnapshot } from "@/lib/server/demoGuard";
import { generateAiImageDraft } from "@/lib/server/aiImageDraftService";
import { readAiImage } from "@/lib/server/aiImageDraftStorage";
import type { LoadedAiImageTask } from "@/lib/server/aiImageTaskAccess";
import type { AiImageProvider } from "@/lib/server/openaiImageClient";
import {
  loadStudioImageSnapshot,
  saveStudioImageSnapshot,
} from "@/lib/server/studioImageResultStore";

export type StudioImageResult =
  | {
      ok: true;
      images: Array<{ base64: string; width?: number; height?: number }>;
      meta: StudioImageResultMeta;
      demoAccess: DemoAccessSnapshot | null;
    }
  | { ok: false; error: { code: string; message: string }; status: number };

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] || character);
}

const STYLE_PALETTES: Record<StudioImageVisualStyle, {
  base: string;
  surface: string;
  accent: string;
  accentSoft: string;
  ink: string;
}> = {
  minimal: {
    base: "#f1faf4",
    surface: "#ffffff",
    accent: "#18b96b",
    accentSoft: "#ddfbea",
    ink: "#173127",
  },
  premium: {
    base: "#eeece7",
    surface: "#fbfaf7",
    accent: "#8b7250",
    accentSoft: "#ddd2c2",
    ink: "#302b26",
  },
  tech: {
    base: "#edf8f1",
    surface: "#fbfffc",
    accent: "#0e9655",
    accentSoft: "#d9f5e5",
    ink: "#173127",
  },
  home: {
    base: "#f2eee8",
    surface: "#fffaf4",
    accent: "#a16f55",
    accentSoft: "#ead5c6",
    ink: "#41332d",
  },
  outdoor: {
    base: "#edf2e9",
    surface: "#fafcf7",
    accent: "#557c60",
    accentSoft: "#cfe0cf",
    ink: "#26372b",
  },
  brand_ad: {
    base: "#eff7f2",
    surface: "#ffffff",
    accent: "#087542",
    accentSoft: "#d8f1e2",
    ink: "#173127",
  },
};

const IMAGE_DIMENSIONS = {
  square_1_1: { width: 800, height: 800 },
  portrait_4_5: { width: 800, height: 1_000 },
  landscape_16_9: { width: 1_200, height: 675 },
} as const;

const TYPE_MARKERS: Record<StudioImageType, string> = {
  product_main: "product-main",
  lifestyle_scene: "lifestyle-scene",
  selling_point_display: "selling-point-display",
  ad_creative: "ad-creative",
};

function compact(value: string, maxLength: number) {
  return escapeXml(value.slice(0, maxLength));
}

function mockLayout(input: Pick<StudioImageInput & { creationMode: "guided" }, "visualStyle" | "imageType">, width: number, height: number, variant: number) {
  const palette = STYLE_PALETTES[input.visualStyle];
  const offset = variant * Math.max(18, Math.round(width * 0.025));
  const productX = Math.round(width * 0.34) + offset;
  const productY = Math.round(height * 0.22);
  const productW = Math.round(width * 0.32);
  const productH = Math.round(height * 0.38);

  if (input.imageType === "product_main") {
    return `
      <g data-mock-layout="product-main">
        <ellipse cx="${Math.round(width * 0.5) + offset}" cy="${Math.round(height * 0.69)}" rx="${Math.round(width * 0.22)}" ry="${Math.round(height * 0.035)}" fill="${palette.ink}" opacity=".12"/>
        <rect x="${productX}" y="${productY}" width="${productW}" height="${productH}" rx="${Math.round(Math.min(width, height) * 0.055)}" fill="${palette.surface}" stroke="${palette.accent}" stroke-width="4"/>
        <rect x="${productX + Math.round(productW * 0.13)}" y="${productY + Math.round(productH * 0.15)}" width="${Math.round(productW * 0.74)}" height="${Math.round(productH * 0.54)}" rx="20" fill="${palette.accentSoft}"/>
        <circle cx="${productX + Math.round(productW * 0.78)}" cy="${productY + Math.round(productH * 0.82)}" r="${Math.round(Math.min(width, height) * 0.018)}" fill="${palette.accent}"/>
      </g>`;
  }
  if (input.imageType === "lifestyle_scene") {
    return `
      <g data-mock-layout="lifestyle-scene">
        <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.16)}" width="${Math.round(width * 0.36)}" height="${Math.round(height * 0.34)}" rx="24" fill="${palette.surface}" opacity=".82"/>
        <path d="M ${Math.round(width * 0.26)} ${Math.round(height * 0.16)} V ${Math.round(height * 0.5)} M ${Math.round(width * 0.08)} ${Math.round(height * 0.33)} H ${Math.round(width * 0.44)}" stroke="${palette.accentSoft}" stroke-width="8"/>
        <rect x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.64)}" width="${Math.round(width * 0.9)}" height="${Math.round(height * 0.08)}" rx="18" fill="${palette.accentSoft}"/>
        <rect x="${Math.round(width * 0.58) + offset}" y="${Math.round(height * 0.36)}" width="${Math.round(width * 0.25)}" height="${Math.round(height * 0.28)}" rx="28" fill="${palette.surface}" stroke="${palette.accent}" stroke-width="4"/>
        <circle cx="${Math.round(width * 0.17)}" cy="${Math.round(height * 0.58)}" r="${Math.round(Math.min(width, height) * 0.065)}" fill="${palette.accent}" opacity=".5"/>
      </g>`;
  }
  if (input.imageType === "selling_point_display") {
    return `
      <g data-mock-layout="selling-point-display">
        <rect x="${Math.round(width * 0.11) + offset}" y="${Math.round(height * 0.24)}" width="${Math.round(width * 0.34)}" height="${Math.round(height * 0.43)}" rx="34" fill="${palette.surface}" stroke="${palette.accent}" stroke-width="4"/>
        <circle cx="${Math.round(width * 0.66)}" cy="${Math.round(height * 0.28)}" r="${Math.round(Math.min(width, height) * 0.035)}" fill="${palette.accent}"/>
        <circle cx="${Math.round(width * 0.74)}" cy="${Math.round(height * 0.48)}" r="${Math.round(Math.min(width, height) * 0.035)}" fill="${palette.accent}"/>
        <circle cx="${Math.round(width * 0.65)}" cy="${Math.round(height * 0.68)}" r="${Math.round(Math.min(width, height) * 0.035)}" fill="${palette.accent}"/>
        <path d="M ${Math.round(width * 0.44)} ${Math.round(height * 0.34)} H ${Math.round(width * 0.62)} M ${Math.round(width * 0.44)} ${Math.round(height * 0.49)} H ${Math.round(width * 0.7)} M ${Math.round(width * 0.44)} ${Math.round(height * 0.61)} H ${Math.round(width * 0.61)}" stroke="${palette.accent}" stroke-width="4" stroke-linecap="round" opacity=".62"/>
      </g>`;
  }
  return `
    <g data-mock-layout="ad-creative">
      <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.28)}" r="${Math.round(Math.min(width, height) * 0.23)}" fill="${palette.accent}" opacity=".15"/>
      <path d="M ${Math.round(width * 0.02)} ${Math.round(height * 0.9)} L ${Math.round(width * 0.66)} ${Math.round(height * 0.13)} L ${Math.round(width * 0.98)} ${Math.round(height * 0.13)} L ${Math.round(width * 0.34)} ${Math.round(height * 0.9)} Z" fill="${palette.accentSoft}" opacity=".7"/>
      <rect x="${Math.round(width * 0.59) + offset}" y="${Math.round(height * 0.22)}" width="${Math.round(width * 0.26)}" height="${Math.round(height * 0.48)}" rx="34" fill="${palette.surface}" stroke="${palette.accent}" stroke-width="4"/>
      <rect x="${Math.round(width * 0.09)}" y="${Math.round(height * 0.3)}" width="${Math.round(width * 0.31)}" height="${Math.round(height * 0.05)}" rx="14" fill="${palette.ink}" opacity=".86"/>
      <rect x="${Math.round(width * 0.09)}" y="${Math.round(height * 0.39)}" width="${Math.round(width * 0.24)}" height="${Math.round(height * 0.035)}" rx="12" fill="${palette.accent}" opacity=".66"/>
      <rect x="${Math.round(width * 0.09)}" y="${Math.round(height * 0.52)}" width="${Math.round(width * 0.17)}" height="${Math.round(height * 0.07)}" rx="18" fill="${palette.accent}"/>
    </g>`;
}

type StudioPromptInput = Extract<StudioImageInput, { creationMode: "prompt" }>;

const PROMPT_STYLE_ORDER: StudioImageVisualStyle[] = [
  "minimal",
  "premium",
  "tech",
  "home",
  "outdoor",
  "brand_ad",
];

function promptTheme(input: StudioPromptInput) {
  const taskType = toTaskImageTypeForContext(toStudioImageContext(input));
  if (taskType === "lifestyle_scene") return { label: "生活场景", imageType: "lifestyle_scene" as const };
  if (taskType === "feature_infographic") return { label: "细节与卖点", imageType: "selling_point_display" as const };
  return { label: "商品主视觉", imageType: "product_main" as const };
}

function promptSummary(input: StudioPromptInput) {
  const theme = promptTheme(input);
  const ratio = {
    square_1_1: "1:1",
    portrait_4_5: "4:5",
    landscape_16_9: "16:9",
  }[input.aspectRatio];
  return `${input.productName || "未指定商品"} · 自定义创意 · ${theme.label} · ${ratio}`;
}

function publicPromptContext(input: StudioPromptInput): StudioImagePublicPromptContext {
  const summary = promptSummary(input);
  return {
    creationMode: "prompt",
    productName: input.productName,
    description: input.description,
    aspectRatio: input.aspectRatio,
    count: input.count,
    promptSummary: summary,
    avoidElementsSummary: input.avoidElements || "未设置额外避免元素",
  };
}

function promptVisualStyle(input: StudioPromptInput, seed: Buffer): StudioImageVisualStyle {
  const prompt = input.creativePrompt.toLocaleLowerCase("en");
  if (/(?:premium|luxury|editorial)/u.test(prompt)) return "premium";
  if (/(?:tech|futuristic|digital)/u.test(prompt)) return "tech";
  if (/(?:home|interior|kitchen|desk)/u.test(prompt)) return "home";
  if (/(?:outdoor|travel|nature)/u.test(prompt)) return "outdoor";
  if (/(?:campaign|advert|brand)/u.test(prompt)) return "brand_ad";
  return PROMPT_STYLE_ORDER[seed[0] % PROMPT_STYLE_ORDER.length];
}

function generatePromptMockStudioImage(input: StudioPromptInput): StudioImageResult {
  const context = publicPromptContext(input);
  const seedHex = createHash("sha256")
    .update(JSON.stringify(toStudioImageContext(input)))
    .digest("hex");
  const seed = Buffer.from(seedHex, "hex");
  const theme = promptTheme(input);
  const visualStyle = promptVisualStyle(input, seed);
  const renderIntent = { creationMode: "guided" as const, imageType: theme.imageType, visualStyle };
  const palette = STYLE_PALETTES[visualStyle];
  const { width, height } = IMAGE_DIMENSIONS[input.aspectRatio];
  const summary = compact(context.promptSummary, 92);
  const avoid = compact(context.avoidElementsSummary, 72);
  const product = compact(input.productName || "Custom creative", 54);
  const metadata = escapeXml(JSON.stringify(context));
  const images = Array.from({ length: input.count }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Local Mock prompt preview" data-mock-variant="${index + 1}" data-mock-seed="${seedHex}">
      <metadata>${metadata}</metadata>
      <rect fill="${palette.base}" width="${width}" height="${height}"/>
      <circle cx="${Math.round(width * 0.88)}" cy="${Math.round(height * 0.12)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="${palette.accentSoft}" opacity=".52"/>
      ${mockLayout(renderIntent, width, height, index + (seed[1] % 3))}
      <g font-family="system-ui,-apple-system,sans-serif" fill="${palette.ink}">
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.08)}" font-size="${Math.max(15, Math.round(Math.min(width, height) * 0.024))}" font-weight="700">LOCAL MOCK · PROMPT</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.82)}" font-size="${Math.max(22, Math.round(Math.min(width, height) * 0.04))}" font-weight="720">${product}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.88)}" font-size="${Math.max(13, Math.round(Math.min(width, height) * 0.02))}" opacity=".76">${summary}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.94)}" font-size="${Math.max(12, Math.round(Math.min(width, height) * 0.017))}" opacity=".58">Avoid: ${avoid} · Variant ${index + 1}</text>
      </g>
    </svg>`;
    return {
      base64: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      width,
      height,
    };
  });
  return {
    ok: true,
    images,
    demoAccess: null,
    meta: {
      mode: "mock",
      visualAuthority: input.visualAuthority ?? "composition_concept",
      creationMode: "prompt",
      duplicate: false,
      input: context,
      promptSummary: context.promptSummary,
      avoidElementsSummary: context.avoidElementsSummary,
      qualityCheck: {
        source: "local_mock_helper",
        logo: "mock_not_added",
        text: "mock_label_present",
        watermark: "mock_not_added",
        descriptionConsistency: "request_context_embedded",
        humanReviewRequired: true,
      },
    },
  };
}

function chunkUntrustedText(value: string, chunkSize = 180) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

export function generateMockStudioImage(input: StudioImageInput): StudioImageResult {
  if (input.creationMode === "prompt") return generatePromptMockStudioImage(input);
  const count = input.count;
  const context = toStudioImageContext(input);
  const { width, height } = IMAGE_DIMENSIONS[input.aspectRatio];
  const palette = STYLE_PALETTES[input.visualStyle];
  const productName = compact(input.productName, 54);
  const description = compact(input.description || "No description supplied", 72);
  const composition = compact(input.compositionRequirements || "Default balanced composition", 64);
  const exclusions = compact(input.prohibitedElements || "Standard safety exclusions", 58);
  const metadata = escapeXml(JSON.stringify(context));
  const images = Array.from({ length: count }, (_, index) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Local Mock preview" data-mock-variant="${index + 1}">
      <metadata>${metadata}</metadata>
      <rect fill="${palette.base}" width="${width}" height="${height}"/>
      <circle cx="${Math.round(width * 0.88)}" cy="${Math.round(height * 0.12)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="${palette.accentSoft}" opacity=".52"/>
      ${mockLayout(input, width, height, index)}
      <g font-family="system-ui,-apple-system,sans-serif" fill="${palette.ink}">
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.08)}" font-size="${Math.max(15, Math.round(Math.min(width, height) * 0.024))}" font-weight="700">LOCAL MOCK · ${TYPE_MARKERS[input.imageType].toUpperCase()}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.82)}" font-size="${Math.max(22, Math.round(Math.min(width, height) * 0.04))}" font-weight="720">${productName}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.87)}" font-size="${Math.max(14, Math.round(Math.min(width, height) * 0.022))}" opacity=".76">${description}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.92)}" font-size="${Math.max(12, Math.round(Math.min(width, height) * 0.018))}" opacity=".62">Composition: ${composition}</text>
        <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.955)}" font-size="${Math.max(12, Math.round(Math.min(width, height) * 0.017))}" opacity=".58">Excluded: ${exclusions} · Variant ${index + 1}</text>
      </g>
    </svg>`;
    return {
      base64: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      width,
      height,
    };
  });
  return {
    ok: true,
    images,
    demoAccess: null,
    meta: {
      mode: "mock",
      visualAuthority: input.visualAuthority ?? "composition_concept",
      creationMode: "guided",
      duplicate: false,
      input: context.creationMode === "guided" ? context : input,
      qualityCheck: {
        source: "local_mock_helper",
        logo: "mock_not_added",
        text: "mock_label_present",
        watermark: "mock_not_added",
        descriptionConsistency: "request_context_embedded",
        humanReviewRequired: true,
      },
    },
  };
}

function serviceErrorStatus(code: string) {
  if ([
    "real_ai_disabled",
    "visitor_ai_quota_exceeded",
    "demo_standalone_image_quota_exceeded",
    "visitor_image_generation_disabled",
  ].includes(code)) return 403;
  if (["image_request_in_progress", "image_request_already_failed", "image_request_conflict"].includes(code)) return 409;
  if (code === "image_provider_rate_limited") return 429;
  if (["image_provider_timeout", "image_provider_unavailable", "image_provider_error", "image_response_invalid"].includes(code)) return 502;
  if (code === "image_content_blocked") return 422;
  return 500;
}

export async function generateRealStudioImage(input: {
  accessContext: AccessContext;
  studio: StudioImageInput;
  request: AiImageGenerateRequest;
}): Promise<StudioImageResult> {
  const accessMode = input.accessContext.mode === "owner" ? "owner" as const : "visitor" as const;
  const visitorAccessId = input.accessContext.mode === "demo" ? input.accessContext.demoAccessId : undefined;
  let snapshot;
  try {
    snapshot = await loadStudioImageSnapshot({ accessMode, visitorAccessId });
  } catch {
    return {
      ok: false,
      status: 500,
      error: { code: "studio_result_store_corrupt", message: "Studio 图片结果存储损坏，本次没有调用真实 AI。" },
    };
  }

  const studioContext = toStudioImageContext(input.studio);
  let resultJson: string;
  if (input.studio.creationMode === "prompt") {
    const promptChunks = chunkUntrustedText(input.studio.creativePrompt);
    const avoidChunks = chunkUntrustedText(input.studio.avoidElements);
    resultJson = JSON.stringify({
      productName: input.studio.productName || "Image Studio prompt concept",
      finalReport: {
        sellingPoints: input.studio.description ? [input.studio.description] : [],
        riskWarnings: [
          "Studio concept image requires human review.",
          ...avoidChunks.map((chunk, index) => `[AVOID ${index + 1}/${avoidChunks.length}] ${chunk}`),
        ],
      },
      listingPrepSnapshot: {
        imageMaterialNeeds: [
          `Studio requested aspect ratio: ${input.studio.aspectRatio}`,
          ...promptChunks.map((chunk, index) => `[UC ${index + 1}/${promptChunks.length}] ${chunk}`),
        ],
      },
      ...(snapshot ? { aiImageDraftSnapshot: snapshot } : {}),
    });
  } else {
    resultJson = JSON.stringify({
      productName: input.studio.productName,
      finalReport: {
        sellingPoints: input.studio.description ? [input.studio.description] : [],
        riskWarnings: [
          "Studio concept image requires human review.",
          input.studio.prohibitedElements
            ? `User requested exclusions: ${input.studio.prohibitedElements}`
            : "",
        ].filter(Boolean),
      },
      listingPrepSnapshot: {
        imageMaterialNeeds: [
          `Studio image type: ${input.studio.imageType}`,
          `Visual style: ${input.studio.visualStyle}`,
          `Aspect ratio: ${input.studio.aspectRatio}`,
          input.studio.compositionRequirements
            ? `Composition requirement: ${input.studio.compositionRequirements}`
            : "",
        ].filter(Boolean),
      },
      ...(snapshot ? { aiImageDraftSnapshot: snapshot } : {}),
    });
  }
  const loadedTask: LoadedAiImageTask = {
    taskId: "studio-image",
    accessMode,
    accessContext: input.accessContext,
    visitorAccessId,
    task: {
      title: input.studio.productName || "Image Studio prompt concept",
      materialText: input.studio.description || input.studio.productName || "Studio creative request",
      level: "studio",
      oneLineSummary: input.studio.description || "Studio image concept",
      resultJson,
    },
    persistResult: async (result) => {
      await saveStudioImageSnapshot({ accessMode, visitorAccessId, result });
    },
  };
  const requestContextHash = createHash("sha256").update(JSON.stringify({
    studio: toStudioImageContext(input.studio),
    taskImageType: input.request.imageType,
    additionalDirection: input.request.additionalDirection || "",
  })).digest("hex");
  const referenceProvider: AiImageProvider | undefined = input.studio.referenceImageDataUrl
    ? async (providerInput) => {
        const { generateOpenAiImageEdit } = await import("@/lib/server/openaiImageEditClient");
        const output = await generateOpenAiImageEdit({
          imageDataUrl: input.studio.referenceImageDataUrl!,
          prompt: providerInput.prompt,
          count: providerInput.count,
        });
        providerInput.onResultReceived?.(output.images.length);
        return {
          model: output.model,
          provider: output.provider,
          images: output.images,
          requestedFormat: "webp",
        };
      }
    : undefined;
  const generated = await generateAiImageDraft({
    loadedTask,
    request: input.request,
    requestContextHash,
    visitorQuotaScope: "standalone",
    ...(referenceProvider ? { provider: referenceProvider } : {}),
  });
  if (!generated.ok) {
    return {
      ok: false,
      status: serviceErrorStatus(generated.error.code),
      error: { code: generated.error.code, message: generated.error.message },
    };
  }

  try {
    const images = await Promise.all(generated.data.items.map(async (item) => ({
      base64: `data:${item.mimeType};base64,${(await readAiImage(item.storageKey)).toString("base64")}`,
      width: item.width,
      height: item.height,
    })));
    return {
      ok: true,
      images,
      demoAccess: generated.data.visitorAccess,
      meta: input.studio.creationMode === "prompt" ? {
        mode: "real",
        visualAuthority: input.studio.visualAuthority ?? "composition_concept",
        creationMode: "prompt",
        duplicate: generated.data.duplicate,
        input: publicPromptContext(input.studio),
        promptSummary: promptSummary(input.studio),
        avoidElementsSummary: input.studio.avoidElements || "未设置额外避免元素",
        qualityCheck: {
          source: "manual_review_only",
          logo: "not_automatically_checked",
          text: "not_automatically_checked",
          watermark: "not_automatically_checked",
          descriptionConsistency: "not_automatically_checked",
          humanReviewRequired: true,
        },
      } : {
        mode: "real",
        visualAuthority: input.studio.visualAuthority ?? "composition_concept",
        creationMode: "guided",
        duplicate: generated.data.duplicate,
        input: studioContext.creationMode === "guided" ? studioContext : input.studio,
        qualityCheck: {
          source: "manual_review_only",
          logo: "not_automatically_checked",
          text: "not_automatically_checked",
          watermark: "not_automatically_checked",
          descriptionConsistency: "not_automatically_checked",
          humanReviewRequired: true,
        },
      },
    };
  } catch {
    return {
      ok: false,
      status: 500,
      error: { code: "studio_image_result_unavailable", message: "Studio 图片结果暂时不可用，请使用新的请求标识重试。" },
    };
  }
}
