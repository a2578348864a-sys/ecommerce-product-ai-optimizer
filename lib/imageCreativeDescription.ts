import {
  isStudioImageLifestyleScene,
  isStudioImagePrimaryPurpose,
  inferStudioImageCreativeIntentFromPreferences,
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
  /**
   * 可见安全资料投影。`field` = Handoff confirmedFacts[].field 的 canonical 字段名。
   *
   * V2.1 修复（前后端事实门禁同源）：此前 DTO 只带 label，前端只能用 label 做就绪度判定，
   * 与服务端 `evaluatePurposeRequirements` 的 canonical field 判据可能不一致。
   * 这里补上 canonical field，使两侧输入完全相同；缺失时为空字符串（历史兼容，不猜测放行）。
   */
  confirmedFacts: Array<{ field: string; label: string; value: string }>;
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
        // canonical 字段名原样透出（仅做长度与字符规范化，不改写取值）；
        // 历史数据缺失时保留空串，由消费方按「资料不足」处理，绝不用 label 猜测补齐。
        field: normalizeText(String(fact.field ?? ""), 64),
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
    `为“${productName}”制作图片。`,
    primaryImagePurpose === "custom" && customImagePurpose
      ? `创作方向：${normalizeText(customImagePurpose, TASK_IMAGE_CUSTOM_PURPOSE_MAX_LENGTH)}。`
      : "",
    lifestyleScene !== "none" ? "用户可在创作描述中补充场景。" : "",
    facts.length > 0 ? `画面仅依据已确认信息：${facts.join("；")}。` : "当前没有更多已确认规格，不补充或猜测商品事实。",
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
  const userDescription = normalizeText(
    direction.userCreativeDescription,
    TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH,
  );
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
    // MVP 只把用户输入作为创作描述传给生成链；用途/场景仍保留在 typed
    // 字段供服务端门禁使用，但不再自动展开为视觉策略或模板 Prompt。
    creativePreferences: userDescription ? { additionalRequirements: userDescription } : {},
  };
}
