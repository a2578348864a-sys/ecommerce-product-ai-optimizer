import type { AiImageDraftType } from "@/lib/aiImageDraft";
import {
  isStudioImageLifestyleScene,
  isStudioImagePrimaryPurpose,
  resolveStudioImageCreativeIntent,
  type StudioImageLifestyleScene,
  type StudioImagePrimaryPurpose,
} from "@/lib/studioImageCreativeIntent";

export const STUDIO_IMAGE_CREATION_MODES = ["guided", "prompt"] as const;

export const STUDIO_IMAGE_TYPES = [
  "product_main",
  "lifestyle_scene",
  "selling_point_display",
  "ad_creative",
] as const;

export const STUDIO_IMAGE_VISUAL_STYLES = [
  "minimal",
  "premium",
  "tech",
  "home",
  "outdoor",
  "brand_ad",
] as const;

export const STUDIO_IMAGE_ASPECT_RATIOS = [
  "square_1_1",
  "portrait_4_5",
  "landscape_16_9",
] as const;

export const STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH = 1_200;
export const STUDIO_IMAGE_AVOID_ELEMENTS_MAX_LENGTH = 400;

export type StudioImageCreationMode = (typeof STUDIO_IMAGE_CREATION_MODES)[number];
export type StudioImageType = (typeof STUDIO_IMAGE_TYPES)[number];
export type StudioImageVisualStyle = (typeof STUDIO_IMAGE_VISUAL_STYLES)[number];
export type StudioImageAspectRatio = (typeof STUDIO_IMAGE_ASPECT_RATIOS)[number];
export type StudioImageMode = "mock" | "real";

type StudioImageBaseContext = {
  productName: string;
  description: string;
  aspectRatio: StudioImageAspectRatio;
  count: 1 | 2;
};

export type StudioImageGuidedContext = StudioImageBaseContext & {
  creationMode: "guided";
  primaryImagePurpose?: StudioImagePrimaryPurpose;
  lifestyleScene?: StudioImageLifestyleScene;
  customImagePurpose?: string;
  imageType: StudioImageType;
  visualStyle: StudioImageVisualStyle;
  compositionRequirements: string;
  prohibitedElements: string;
};

export type StudioImagePromptContext = StudioImageBaseContext & {
  creationMode: "prompt";
  creativePrompt: string;
  avoidElements: string;
};

export type StudioImageContext = StudioImageGuidedContext | StudioImagePromptContext;
export type StudioImagePublicPromptContext = Omit<
  StudioImagePromptContext,
  "creativePrompt" | "avoidElements"
> & {
  promptSummary: string;
  avoidElementsSummary: string;
};

export type StudioImageQualityCheck = {
  source: "local_mock_helper" | "manual_review_only";
  logo: "mock_not_added" | "not_automatically_checked";
  text: "mock_label_present" | "not_automatically_checked";
  watermark: "mock_not_added" | "not_automatically_checked";
  descriptionConsistency: "request_context_embedded" | "not_automatically_checked";
  humanReviewRequired: true;
};

type StudioImageResultMetaBase = {
  mode: StudioImageMode;
  duplicate: boolean;
  visualAuthority?: "composition_concept" | "product_visual_draft";
  qualityCheck: StudioImageQualityCheck;
};

export type StudioImageResultMeta =
  | (StudioImageResultMetaBase & {
      creationMode: "guided";
      input: StudioImageGuidedContext;
      promptSummary?: never;
      avoidElementsSummary?: never;
    })
  | (StudioImageResultMetaBase & {
      creationMode: "prompt";
      input: StudioImagePublicPromptContext;
      promptSummary: string;
      avoidElementsSummary: string;
    });

type StudioImageExecutionInput = {
  briefVersion?: "studio-creative-brief.v1";
  factsConfirmed?: true;
  humanReviewRequired?: true;
  visualAuthority?: "composition_concept" | "product_visual_draft";
  referenceImageDataUrl?: string;
  referenceImageApproved?: boolean;
  mode: StudioImageMode;
  confirmRealAi: boolean;
  idempotencyKey: string;
  legacyAdditionalDirection: string;
};

export type StudioImageInput = StudioImageContext & StudioImageExecutionInput;

type StudioImageInputErrorCode =
  | "invalid_studio_image_input"
  | "invalid_creation_mode"
  | "invalid_mode"
  | "missing_product_name"
  | "missing_creative_prompt"
  | "unsafe_creative_prompt"
  | "invalid_image_type"
  | "invalid_visual_style"
  | "invalid_aspect_ratio"
  | "invalid_image_count"
  | "unsupported_request_field"
  | "invalid_studio_brief"
  | "studio_brief_confirmation_required"
  | "invalid_reference_image"
  | "reference_image_confirmation_required";

export type StudioImageInputResult =
  | { ok: true; data: StudioImageInput }
  | { ok: false; error: { code: StudioImageInputErrorCode; message: string } };

const LEGACY_IMAGE_TYPES: Record<string, StudioImageType> = {
  white_background_concept: "product_main",
  lifestyle_scene: "lifestyle_scene",
  feature_infographic: "selling_point_display",
};

export const STUDIO_IMAGE_ALLOWED_FIELDS = new Set([
  "briefVersion",
  "factsConfirmed",
  "humanReviewRequired",
  "referenceImageDataUrl",
  "referenceImageApproved",
  "creationMode",
  "productName",
  "description",
  "creativePrompt",
  "avoidElements",
  "imageType",
  "visualStyle",
  "primaryImagePurpose",
  "lifestyleScene",
  "customImagePurpose",
  "aspectRatio",
  "count",
  "compositionRequirements",
  "prohibitedElements",
  "additionalDirection",
  "mode",
  "confirmRealAi",
  "idempotencyKey",
  "accessToken",
  "accessPassword",
]);

const UNSAFE_CREATIVE_PROMPT_PATTERNS = [
  /(?:https?|file):\/\//iu,
  /(?:^|\s)(?:[a-z]:\\|\\\\|\/(?:etc|opt|usr|var|tmp|home|models?)(?:[/\\]|$)|\.\.?[/\\])/iu,
  /\b(?:provider|model(?:path)?|endpoint|base[\s_-]?url)\s*[:=]/iu,
  /\b(?:ignore|disregard|override)\b.{0,40}\b(?:previous|prior|system|instructions?|rules?|safety)\b/iu,
  /(?:(?:\u5ffd\u7565|\u65e0\u89c6).{0,20}(?:\u4e4b\u524d|\u4ee5\u4e0a|\u7cfb\u7edf|\u89c4\u5219|\u5b89\u5168|\u6307\u4ee4)|(?:\u8986\u76d6|\u7ed5\u8fc7).{0,20}(?:\u7cfb\u7edf|\u89c4\u5219|\u5b89\u5168|\u6307\u4ee4))/u,
  /(?:\[system\]|<system(?:\s|>))/iu,
] as const;

function fail(code: StudioImageInputErrorCode, message: string): StudioImageInputResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readText(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
  fallback = "",
): { ok: true; value: string } | { ok: false; message: string } {
  const value = input[key];
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string") return { ok: false, message: `${key} must be a string.` };
  const normalized = normalizeText(value);
  if (normalized.length > maxLength) {
    return { ok: false, message: `${key} must not exceed ${maxLength} characters.` };
  }
  return { ok: true, value: normalized };
}

function readEnum<T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): { ok: true; value: T } | { ok: false } {
  const value = input[key];
  if (value === undefined) return { ok: true, value: fallback };
  if (typeof value !== "string" || !allowed.includes(value as T)) return { ok: false };
  return { ok: true, value: value as T };
}

function readImageType(input: Record<string, unknown>) {
  const value = input.imageType;
  if (value === undefined) return { ok: true as const, value: "product_main" as const };
  if (typeof value !== "string") return { ok: false as const };
  if (STUDIO_IMAGE_TYPES.includes(value as StudioImageType)) {
    return { ok: true as const, value: value as StudioImageType };
  }
  const legacy = LEGACY_IMAGE_TYPES[value];
  return legacy ? { ok: true as const, value: legacy } : { ok: false as const };
}

function containsUnsafeCreativeInstruction(value: string) {
  return UNSAFE_CREATIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(value));
}

function readReferenceImage(input: Record<string, unknown>) {
  const value = input.referenceImageDataUrl;
  if (value === undefined || value === "") return { ok: true as const, value: undefined };
  if (typeof value !== "string" || value.length > 14_000_000) return { ok: false as const };
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    return { ok: false as const };
  }
  return { ok: true as const, value };
}

export function parseStudioImageInput(value: unknown): StudioImageInputResult {
  if (!isRecord(value)) {
    return fail("invalid_studio_image_input", "Request body must be a JSON object.");
  }
  if (Object.keys(value).some((key) => !STUDIO_IMAGE_ALLOWED_FIELDS.has(key))) {
    return fail("unsupported_request_field", "Request contains an unsupported field.");
  }
  if (value.briefVersion !== "studio-creative-brief.v1" || value.humanReviewRequired !== true) {
    return fail("invalid_studio_brief", "创作资料合同无效，请刷新页面后重新确认。");
  }
  if (value.factsConfirmed !== true) {
    return fail(
      "studio_brief_confirmation_required",
      "请确认商品资料由你提供或确认，生成结果仅作为待人工复核的草稿。",
    );
  }
  if (value.referenceImageApproved !== undefined && typeof value.referenceImageApproved !== "boolean") {
    return fail("invalid_reference_image", "参考图确认状态无效。");
  }
  const referenceImage = readReferenceImage(value);
  if (!referenceImage.ok) return fail("invalid_reference_image", "参考图格式无效，请上传 PNG、JPEG 或 WebP 图片。");
  if (referenceImage.value && value.referenceImageApproved !== true) {
    return fail("reference_image_confirmation_required", "请确认你有权使用该参考图，并批准其用于本次商品视觉草稿。");
  }
  const creationMode = readEnum(
    value,
    "creationMode",
    STUDIO_IMAGE_CREATION_MODES,
    "guided",
  );
  if (!creationMode.ok) {
    return fail("invalid_creation_mode", "Creation mode is invalid.");
  }
  if (value.mode !== undefined && value.mode !== "mock" && value.mode !== "real") {
    return fail("invalid_mode", "Generation mode is invalid.");
  }
  if (value.confirmRealAi !== undefined && typeof value.confirmRealAi !== "boolean") {
    return fail("invalid_studio_image_input", "confirmRealAi must be a boolean.");
  }

  const productName = readText(value, "productName", 200);
  const description = readText(value, "description", 1_000);
  const creativePrompt = readText(
    value,
    "creativePrompt",
    STUDIO_IMAGE_CREATIVE_PROMPT_MAX_LENGTH,
  );
  const avoidElements = readText(
    value,
    "avoidElements",
    STUDIO_IMAGE_AVOID_ELEMENTS_MAX_LENGTH,
  );
  const legacyDirection = readText(value, "additionalDirection", 300);
  const idempotencyKey = readText(value, "idempotencyKey", 100);
  const aspectRatio = readEnum(value, "aspectRatio", STUDIO_IMAGE_ASPECT_RATIOS, "square_1_1");
  const invalidText = [
    productName,
    description,
    creativePrompt,
    avoidElements,
    legacyDirection,
    idempotencyKey,
  ].find((field) => !field.ok);
  if (invalidText && !invalidText.ok) {
    return fail("invalid_studio_image_input", invalidText.message);
  }
  if (!aspectRatio.ok) return fail("invalid_aspect_ratio", "Please choose a supported aspect ratio.");
  if (value.count !== undefined && value.count !== 1 && value.count !== 2) {
    return fail("invalid_image_count", "Image count must be 1 or 2.");
  }
  if (
    !productName.ok
    || !description.ok
    || !creativePrompt.ok
    || !avoidElements.ok
    || !legacyDirection.ok
    || !idempotencyKey.ok
  ) {
    return fail("invalid_studio_image_input", "Request contains invalid Image Studio input.");
  }

  const execution: StudioImageExecutionInput = {
    briefVersion: "studio-creative-brief.v1",
    factsConfirmed: true,
    humanReviewRequired: true,
    visualAuthority: referenceImage.value ? "product_visual_draft" : "composition_concept",
    ...(referenceImage.value ? { referenceImageDataUrl: referenceImage.value } : {}),
    referenceImageApproved: referenceImage.value ? true : value.referenceImageApproved === true,
    mode: value.mode === "real" ? "real" : "mock",
    confirmRealAi: value.confirmRealAi === true,
    idempotencyKey: idempotencyKey.value,
    legacyAdditionalDirection: legacyDirection.value,
  };
  const common: StudioImageBaseContext = {
    productName: productName.value,
    description: description.value,
    aspectRatio: aspectRatio.value,
    count: value.count === 2 ? 2 : 1,
  };

  if (creationMode.value === "prompt") {
    if (!creativePrompt.value) {
      return fail("missing_creative_prompt", "Please enter a creative prompt.");
    }
    if (
      containsUnsafeCreativeInstruction(creativePrompt.value)
      || containsUnsafeCreativeInstruction(avoidElements.value)
    ) {
      return fail(
        "unsafe_creative_prompt",
        "Creative prompt contains unsupported provider, path, URL, or instruction-control content.",
      );
    }
    if (
      value.imageType !== undefined
      || value.visualStyle !== undefined
      || value.compositionRequirements !== undefined
      || value.prohibitedElements !== undefined
      || value.additionalDirection !== undefined
      || value.primaryImagePurpose !== undefined
      || value.lifestyleScene !== undefined
      || value.customImagePurpose !== undefined
    ) {
      return fail(
        "invalid_studio_image_input",
        "Guided image fields are not supported in prompt mode.",
      );
    }
    return {
      ok: true,
      data: {
        creationMode: "prompt",
        ...common,
        creativePrompt: creativePrompt.value,
        avoidElements: avoidElements.value,
        ...execution,
      },
    };
  }

  if (value.creativePrompt !== undefined || value.avoidElements !== undefined) {
    return fail(
      "invalid_studio_image_input",
      "Prompt image fields require prompt creation mode.",
    );
  }
  if (!productName.value) {
    return fail("missing_product_name", "Please enter a product name.");
  }

  const composition = readText(value, "compositionRequirements", 240);
  const prohibited = readText(value, "prohibitedElements", 240);
  const customImagePurpose = readText(value, "customImagePurpose", 160);
  const hasCreativeIntent = value.primaryImagePurpose !== undefined
    || value.lifestyleScene !== undefined
    || value.customImagePurpose !== undefined;
  const invalidGuidedText = [composition, prohibited, customImagePurpose].find((field) => !field.ok);
  if (invalidGuidedText && !invalidGuidedText.ok) {
    return fail("invalid_studio_image_input", invalidGuidedText.message);
  }
  if (!composition.ok || !prohibited.ok || !customImagePurpose.ok) {
    return fail("invalid_studio_image_input", "Request contains invalid Image Studio input.");
  }

  if (hasCreativeIntent) {
    if (!isStudioImagePrimaryPurpose(value.primaryImagePurpose)) {
      return fail("invalid_image_type", "请选择一个图片主用途。");
    }
    if (!isStudioImageLifestyleScene(value.lifestyleScene)) {
      return fail("invalid_studio_image_input", "请选择支持的生活场景。");
    }
    if (value.primaryImagePurpose === "white_studio" && value.lifestyleScene !== "none") {
      return fail("invalid_studio_image_input", "白底主图不使用生活场景，请改选其他主用途。");
    }
    if (value.primaryImagePurpose === "custom" && !customImagePurpose.value) {
      return fail("invalid_studio_image_input", "请填写自定义图片用途。");
    }
    if (containsUnsafeCreativeInstruction(customImagePurpose.value)) {
      return fail("unsafe_creative_prompt", "自定义图片用途包含不支持的指令内容。");
    }
    if (
      value.imageType !== undefined
      || value.visualStyle !== undefined
      || value.compositionRequirements !== undefined
      || value.additionalDirection !== undefined
    ) {
      return fail("invalid_studio_image_input", "图片用途字段不能与内部构图字段同时提交。");
    }
    const creativeIntent = resolveStudioImageCreativeIntent({
      primaryImagePurpose: value.primaryImagePurpose,
      lifestyleScene: value.lifestyleScene,
      customImagePurpose: customImagePurpose.value,
    });
    return {
      ok: true,
      data: {
        creationMode: "guided",
        ...common,
        primaryImagePurpose: creativeIntent.primaryImagePurpose,
        lifestyleScene: creativeIntent.lifestyleScene,
        customImagePurpose: creativeIntent.customImagePurpose,
        imageType: creativeIntent.imageType,
        visualStyle: creativeIntent.visualStyle,
        compositionRequirements: `${creativeIntent.background} ${creativeIntent.composition}`.trim(),
        prohibitedElements: prohibited.value,
        ...execution,
      },
    };
  }

  const imageType = readImageType(value);
  const visualStyle = readEnum(value, "visualStyle", STUDIO_IMAGE_VISUAL_STYLES, "minimal");
  if (!imageType.ok) return fail("invalid_image_type", "Please choose a supported image type.");
  if (!visualStyle.ok) return fail("invalid_visual_style", "Please choose a supported visual style.");

  return {
    ok: true,
    data: {
      creationMode: "guided",
      ...common,
      imageType: imageType.value,
      visualStyle: visualStyle.value,
      compositionRequirements: composition.value || legacyDirection.value,
      prohibitedElements: prohibited.value,
      ...execution,
    },
  };
}

export function toStudioImageContext(input: StudioImageInput): StudioImageContext {
  const common: StudioImageBaseContext = {
    productName: input.productName,
    description: input.description,
    aspectRatio: input.aspectRatio,
    count: input.count,
  };
  if (input.creationMode === "prompt") {
    return {
      creationMode: "prompt",
      ...common,
      creativePrompt: input.creativePrompt,
      avoidElements: input.avoidElements,
    };
  }
  return {
    creationMode: "guided",
    ...common,
    ...(input.primaryImagePurpose ? { primaryImagePurpose: input.primaryImagePurpose } : {}),
    ...(input.lifestyleScene ? { lifestyleScene: input.lifestyleScene } : {}),
    ...(input.customImagePurpose !== undefined ? { customImagePurpose: input.customImagePurpose } : {}),
    imageType: input.imageType,
    visualStyle: input.visualStyle,
    compositionRequirements: input.compositionRequirements,
    prohibitedElements: input.prohibitedElements,
  };
}

export function toTaskImageType(imageType: StudioImageType): AiImageDraftType {
  if (imageType === "product_main") return "white_background_concept";
  if (imageType === "lifestyle_scene") return "lifestyle_scene";
  return "feature_infographic";
}

export function toTaskImageTypeForContext(context: StudioImageContext): AiImageDraftType {
  if (context.creationMode === "guided") return toTaskImageType(context.imageType);
  const prompt = context.creativePrompt.toLocaleLowerCase("en");
  if (/(?:lifestyle|everyday|home|outdoor|scene|natural setting)/u.test(prompt)) {
    return "lifestyle_scene";
  }
  if (/(?:detail|close[- ]?up|feature|callout|infographic|texture)/u.test(prompt)) {
    return "feature_infographic";
  }
  return "white_background_concept";
}
