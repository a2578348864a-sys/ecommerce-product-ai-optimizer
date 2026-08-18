import {
  isStudioImageLifestyleScene,
  isStudioImagePrimaryPurpose,
  inferStudioImageCreativeIntentFromPreferences,
  lifestyleSceneLabel,
  primaryPurposeLabel,
  resolveStudioImageCreativeIntent,
  type StudioImageCreativeIntent,
  type StudioImageLifestyleScene,
  type StudioImagePrimaryPurpose,
} from "@/lib/studioImageCreativeIntent";
import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";

export const TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH = 1_200;
export const TASK_IMAGE_CUSTOM_PURPOSE_MAX_LENGTH = 160;

export type TaskImageCreativeDescriptionContext = {
  productName: string;
  confirmedFacts: Array<{ label: string; value: string }>;
  existingVisualRequirements: string[];
  hasApprovedReference: boolean;
  suggestedCreativeIntent?: StudioImageCreativeIntent;
};

export type TaskImageCreativeDirection = {
  primaryImagePurpose: StudioImagePrimaryPurpose;
  lifestyleScene: StudioImageLifestyleScene;
  customImagePurpose: string;
  userCreativeDescription: string;
};

const UNSAFE_CREATIVE_DESCRIPTION_PATTERNS = [
  /(?:https?|file):\/\//iu,
  /(?:^|\s)(?:[a-z]:\\|\\\\|\/(?:etc|opt|usr|var|tmp|home|models?)(?:[/\\]|$)|\.\.?[/\\])/iu,
  /\b(?:provider|model(?:path)?|endpoint|base[\s_-]?url)\s*[:=]/iu,
  /\b(?:ignore|disregard|override)\b.{0,40}\b(?:previous|prior|system|instructions?|rules?|safety)\b/iu,
  /(?:(?:忽略|无视).{0,20}(?:之前|以上|系统|规则|安全|指令)|(?:覆盖|绕过).{0,20}(?:系统|规则|安全|指令))/u,
  /(?:\[system\]|<system(?:\s|>))/iu,
] as const;

function normalizeText(value: string, maxLength: number) {
  return value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function textValue(value: unknown) {
  if (typeof value === "string") return normalizeText(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return normalizeText(value.filter((item): item is string => typeof item === "string").join("；"), 500);
  }
  return "";
}

function containsUnsafeInstruction(value: string) {
  const comparable = value.normalize("NFKC");
  return UNSAFE_CREATIVE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(comparable));
}

/** 仅投影 Task 图片表单所需的可见安全资料，不返回 Handoff 内部标识或绑定字段。 */
export function buildTaskImageCreativeDescriptionContext(
  handoff: ProductCreativeHandoffV1,
): TaskImageCreativeDescriptionContext {
  const version = handoff.versions[handoff.versions.length - 1];
  const preferences = version?.creativePreferences;
  const existingVisualRequirements = preferences && typeof preferences === "object"
    ? ["imageStyle", "backgroundPreference", "compositionPreference", "additionalRequirements"]
      .map((key) => textValue((preferences as unknown as Record<string, unknown>)[key]))
      .filter(Boolean)
    : [];
  const approvedReferences = version?.visualReferences?.filter((reference) => (
    reference.identityBound === true
      && reference.humanApprovedForReference === true
      && typeof reference.approvedAt === "string"
      && typeof reference.approvedBy === "object"
      && typeof reference.confirmationReference === "string"
  )) ?? [];

  return {
    productName: normalizeText(version?.productIdentity?.displayName ?? "", 200) || "本商品",
    confirmedFacts: (version?.confirmedFacts ?? [])
      .filter((fact) => fact.usageScopes.includes("image"))
      .map((fact) => ({
        label: normalizeText(fact.label, 80),
        value: textValue(fact.value),
      }))
      .filter((fact) => fact.label && fact.value)
      .slice(0, 12),
    existingVisualRequirements: existingVisualRequirements.slice(0, 8),
    hasApprovedReference: approvedReferences.length > 0,
    suggestedCreativeIntent: inferStudioImageCreativeIntentFromPreferences(
      preferences as unknown as Record<string, unknown> | undefined,
    ),
  };
}

export function buildTaskImageCreativeDescription(
  context: TaskImageCreativeDescriptionContext,
  primaryImagePurpose: StudioImagePrimaryPurpose,
  lifestyleScene: StudioImageLifestyleScene,
  customImagePurpose = "",
) {
  const intent = resolveStudioImageCreativeIntent({
    primaryImagePurpose,
    lifestyleScene,
    customImagePurpose,
  });
  const productName = normalizeText(context.productName, 200) || "本商品";
  const facts = context.confirmedFacts
    .map((fact) => ({
      label: normalizeText(fact.label, 80),
      value: normalizeText(fact.value, 240),
    }))
    .filter((fact) => fact.label && fact.value)
    .slice(0, 12)
    .map((fact) => `${fact.label}：${fact.value}`);
  const requirements = context.existingVisualRequirements
    .map((item) => normalizeText(item, 240))
    .filter(Boolean)
    .slice(0, 8);

  const parts = [
    `为“${productName}”制作${intent.label || primaryPurposeLabel(primaryImagePurpose)}图片。`,
    lifestyleScene !== "none" ? `生活场景：${lifestyleSceneLabel(lifestyleScene)}。` : "",
    facts.length > 0 ? `画面仅依据已确认信息：${facts.join("；")}。` : "当前没有更多已确认规格，不补充或猜测商品事实。",
    `${intent.direction}。`,
    requirements.length > 0 ? `现有视觉要求：${requirements.join("；")}。` : "",
    context.hasApprovedReference
      ? "商品外观以已批准参考图为视觉依据，结果仍需人工检查商品外观和文字。"
      : "当前没有已确认商品参考图，生成结果只用于构图、场景和视觉方向参考，不代表真实商品外观。",
  ].filter(Boolean);

  return normalizeText(parts.join(""), TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH);
}

export function parseTaskImageCreativeDirection(value: unknown):
  | { ok: true; data: TaskImageCreativeDirection }
  | { ok: false; code:
      | "invalid_primary_image_purpose"
      | "invalid_lifestyle_scene"
      | "white_background_scene_conflict"
      | "custom_image_purpose_required"
      | "invalid_creative_description"
      | "unsafe_creative_description" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "invalid_creative_description" };
  }
  const record = value as Record<string, unknown>;
  if (!isStudioImagePrimaryPurpose(record.primaryImagePurpose)) {
    return { ok: false, code: "invalid_primary_image_purpose" };
  }
  if (!isStudioImageLifestyleScene(record.lifestyleScene)) {
    return { ok: false, code: "invalid_lifestyle_scene" };
  }
  if (record.primaryImagePurpose === "white_studio" && record.lifestyleScene !== "none") {
    return { ok: false, code: "white_background_scene_conflict" };
  }
  if (typeof record.customImagePurpose !== "string") {
    return { ok: false, code: "custom_image_purpose_required" };
  }
  const customImagePurpose = normalizeText(
    record.customImagePurpose,
    TASK_IMAGE_CUSTOM_PURPOSE_MAX_LENGTH + 1,
  );
  if (record.primaryImagePurpose === "custom" && !customImagePurpose) {
    return { ok: false, code: "custom_image_purpose_required" };
  }
  if (customImagePurpose.length > TASK_IMAGE_CUSTOM_PURPOSE_MAX_LENGTH) {
    return { ok: false, code: "custom_image_purpose_required" };
  }
  if (typeof record.userCreativeDescription !== "string") {
    return { ok: false, code: "invalid_creative_description" };
  }
  const description = normalizeText(
    record.userCreativeDescription,
    TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH + 1,
  );
  if (description.length > TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH) {
    return { ok: false, code: "invalid_creative_description" };
  }
  if (containsUnsafeInstruction(description) || containsUnsafeInstruction(customImagePurpose)) {
    return { ok: false, code: "unsafe_creative_description" };
  }
  return {
    ok: true,
    data: {
      primaryImagePurpose: record.primaryImagePurpose,
      lifestyleScene: record.lifestyleScene,
      customImagePurpose: record.primaryImagePurpose === "custom" ? customImagePurpose : "",
      userCreativeDescription: description,
    },
  };
}

export function applyTaskImageCreativeDirection(
  input: ImageGenerationInput,
  direction: TaskImageCreativeDirection,
): ImageGenerationInput {
  const intent = resolveStudioImageCreativeIntent(direction);
  return {
    ...input,
    productFacts: input.productFacts.map((fact) => ({ ...fact })),
    approvedVisualReferences: input.approvedVisualReferences.map((reference) => ({ ...reference })),
    compositionReferences: [...input.compositionReferences],
    prohibitedVisualClaims: [...input.prohibitedVisualClaims],
    unknowns: [...input.unknowns],
    // V3 Creative Intent Propagation：显式 typed 字段（purpose/scene 保持独立可追踪，不混入文本）
    primaryPurpose: direction.primaryImagePurpose,
    lifestyleScene: direction.lifestyleScene,
    ...(direction.primaryImagePurpose === "custom" && direction.customImagePurpose
      ? { customPurposeText: direction.customImagePurpose }
      : {}),
    creativePreferences: {
      ...input.creativePreferences,
      imageStyle: intent.visualStyle,
      backgroundPreference: intent.background,
      compositionPreference: intent.composition,
      additionalRequirements: [
        `图片用途：${intent.label}。${intent.direction}。`,
        direction.userCreativeDescription
          ? `用户可编辑创作描述（仅作为视觉偏好，不改变已确认事实、禁用声明或参考图安全状态）：${direction.userCreativeDescription}`
          : "用户已清空创作描述；仅使用服务端已确认事实、场景和安全限制。",
      ].join(" ").slice(0, 1_600),
    },
  };
}
