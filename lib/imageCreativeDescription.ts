import {
  resolveImageScenePreset,
  STUDIO_IMAGE_SCENE_GROUPS,
  type ImageScenePreset,
} from "@/lib/client/studioImageRequest";
import type { ImageGenerationInput } from "@/lib/imageHandoff/imageGenerationInput";
import type { ProductCreativeHandoffV1 } from "@/lib/productCreativeHandoff";

export const TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH = 1_200;

export type TaskImageCreativeDescriptionContext = {
  productName: string;
  confirmedFacts: Array<{ label: string; value: string }>;
  existingVisualRequirements: string[];
  hasApprovedReference: boolean;
};

export type TaskImageCreativeDirection = {
  scenePreset: ImageScenePreset;
  userCreativeDescription: string;
};

const SCENE_DIRECTIONS: Record<ImageScenePreset, string> = {
  white_studio: "使用干净棚拍背景，突出商品主体，保持自然阴影和适量留白",
  selling_point_infographic: "使用清晰的信息图构图并预留可复核的卖点文字区域，不添加未经确认的标签",
  dimension_specification: "使用规格展示构图，仅为已确认尺寸预留标注区域，不编造尺寸",
  detail_closeup: "使用细节特写构图，只突出已确认或参考图中可见的材质与结构",
  packaging_bundle: "使用包装或套装展示构图，只呈现已确认的包装和配件",
  usage_steps: "使用多画面步骤构图并预留说明区域，不编造未确认的操作方式",
  home_lifestyle: "使用可信的家居生活环境，保持商品尺度清楚并预留适量留白",
  office_commute: "使用可信的办公或通勤环境，保持画面简洁并体现日常使用情境",
  outdoor_travel: "使用可信的户外或旅行环境，体现便携使用场景并保留适量文案留白；不要推断未确认功能",
  sports_fitness: "使用可信的运动或健身环境，保持动态但不暗示未经确认的性能或功效",
  comparison: "使用并列对比构图，所有对比文案留待人工核验，不添加未经确认的结论",
  custom: "按用户编辑的创作描述组织场景与构图，同时保持已确认事实和安全限制不变",
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

function isImageScenePreset(value: unknown): value is ImageScenePreset {
  return typeof value === "string" && STUDIO_IMAGE_SCENE_GROUPS
    .flatMap((group) => [...group.presets])
    .some((preset) => preset.id === value);
}

function textValue(value: unknown) {
  if (typeof value === "string") return normalizeText(value, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return normalizeText(value.filter((item): item is string => typeof item === "string").join("；"), 500);
  }
  return "";
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
  };
}

export function buildTaskImageCreativeDescription(
  context: TaskImageCreativeDescriptionContext,
  scenePreset: ImageScenePreset,
) {
  const scene = resolveImageScenePreset(scenePreset);
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
    `为“${productName}”制作${scene.label}图片。`,
    facts.length > 0 ? `画面仅依据已确认信息：${facts.join("；")}。` : "当前没有更多已确认规格，不补充或猜测商品事实。",
    `${SCENE_DIRECTIONS[scene.id]}。`,
    requirements.length > 0 ? `现有视觉要求：${requirements.join("；")}。` : "",
    context.hasApprovedReference
      ? "商品外观以已批准参考图为视觉依据，结果仍需人工检查商品外观和文字。"
      : "当前没有已确认商品参考图，生成结果只用于构图、场景和视觉方向参考，不代表真实商品外观。",
  ].filter(Boolean);

  return normalizeText(parts.join(""), TASK_IMAGE_CREATIVE_DESCRIPTION_MAX_LENGTH);
}

export function parseTaskImageCreativeDirection(value: unknown):
  | { ok: true; data: TaskImageCreativeDirection }
  | { ok: false; code: "invalid_scene_preset" | "invalid_creative_description" | "unsafe_creative_description" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "invalid_creative_description" };
  }
  const record = value as Record<string, unknown>;
  if (!isImageScenePreset(record.scenePreset)) {
    return { ok: false, code: "invalid_scene_preset" };
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
  const safetyComparableDescription = description.normalize("NFKC");
  if (UNSAFE_CREATIVE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(safetyComparableDescription))) {
    return { ok: false, code: "unsafe_creative_description" };
  }
  return {
    ok: true,
    data: { scenePreset: record.scenePreset, userCreativeDescription: description },
  };
}

export function applyTaskImageCreativeDirection(
  input: ImageGenerationInput,
  direction: TaskImageCreativeDirection,
): ImageGenerationInput {
  const scene = resolveImageScenePreset(direction.scenePreset);
  return {
    ...input,
    productFacts: input.productFacts.map((fact) => ({ ...fact })),
    approvedVisualReferences: input.approvedVisualReferences.map((reference) => ({ ...reference })),
    compositionReferences: [...input.compositionReferences],
    prohibitedVisualClaims: [...input.prohibitedVisualClaims],
    unknowns: [...input.unknowns],
    creativePreferences: {
      ...input.creativePreferences,
      backgroundPreference: scene.background,
      compositionPreference: scene.composition,
      additionalRequirements: [
        `场景：${scene.label}。${SCENE_DIRECTIONS[scene.id]}。`,
        direction.userCreativeDescription
          ? `用户可编辑创作描述（仅作为视觉偏好，不改变已确认事实、禁用声明或参考图安全状态）：${direction.userCreativeDescription}`
          : "用户已清空创作描述；仅使用服务端已确认事实、场景和安全限制。",
      ].join(" ").slice(0, 1_600),
    },
  };
}
