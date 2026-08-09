export const STUDIO_IMAGE_PRIMARY_PURPOSES = [
  { id: "white_studio", label: "白底主图/棚拍" },
  { id: "selling_point_infographic", label: "卖点信息图" },
  { id: "dimension_specification", label: "尺寸规格图" },
  { id: "detail_closeup", label: "产品细节特写" },
  { id: "packaging_bundle", label: "包装/套装展示" },
  { id: "usage_steps", label: "使用步骤图" },
  { id: "comparison", label: "对比展示" },
  { id: "custom", label: "自定义" },
] as const;

export const STUDIO_IMAGE_LIFESTYLE_SCENES = [
  { id: "none", label: "不指定" },
  { id: "home_lifestyle", label: "家居生活" },
  { id: "office_commute", label: "办公/通勤" },
  { id: "outdoor_travel", label: "户外/旅行" },
  { id: "sports_fitness", label: "运动/健身" },
] as const;

export type StudioImagePrimaryPurpose = (typeof STUDIO_IMAGE_PRIMARY_PURPOSES)[number]["id"];
export type StudioImageLifestyleScene = (typeof STUDIO_IMAGE_LIFESTYLE_SCENES)[number]["id"];

export type StudioImageCreativeIntent = {
  primaryImagePurpose: StudioImagePrimaryPurpose;
  lifestyleScene: StudioImageLifestyleScene;
  customImagePurpose: string;
};

export const DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT: StudioImageCreativeIntent = {
  primaryImagePurpose: "white_studio",
  lifestyleScene: "none",
  customImagePurpose: "",
};

export function isStudioImagePrimaryPurpose(value: unknown): value is StudioImagePrimaryPurpose {
  return typeof value === "string"
    && STUDIO_IMAGE_PRIMARY_PURPOSES.some((candidate) => candidate.id === value);
}

export function isStudioImageLifestyleScene(value: unknown): value is StudioImageLifestyleScene {
  return typeof value === "string"
    && STUDIO_IMAGE_LIFESTYLE_SCENES.some((candidate) => candidate.id === value);
}

export function normalizeStudioImageCreativeIntent(
  intent: StudioImageCreativeIntent,
): StudioImageCreativeIntent {
  if (intent.primaryImagePurpose === "white_studio") {
    return {
      primaryImagePurpose: "white_studio",
      lifestyleScene: "none",
      customImagePurpose: "",
    };
  }
  return {
    primaryImagePurpose: intent.primaryImagePurpose,
    lifestyleScene: intent.lifestyleScene,
    customImagePurpose: intent.primaryImagePurpose === "custom"
      ? intent.customImagePurpose.trim()
      : "",
  };
}

export function primaryPurposeLabel(purpose: StudioImagePrimaryPurpose) {
  return STUDIO_IMAGE_PRIMARY_PURPOSES.find((candidate) => candidate.id === purpose)?.label ?? "自定义";
}

export function lifestyleSceneLabel(scene: StudioImageLifestyleScene) {
  return STUDIO_IMAGE_LIFESTYLE_SCENES.find((candidate) => candidate.id === scene)?.label ?? "不指定";
}

export function resolveStudioImageCreativeIntent(intent: StudioImageCreativeIntent) {
  const normalized = normalizeStudioImageCreativeIntent(intent);
  const purposeDirections = {
    white_studio: {
      imageType: "product_main" as const,
      visualStyle: "minimal" as const,
      background: "Clean white studio background.",
      composition: "Centered product-first composition with a natural shadow.",
      direction: "使用干净棚拍背景，突出商品主体，保持自然阴影和适量留白",
    },
    selling_point_infographic: {
      imageType: "selling_point_display" as const,
      visualStyle: "minimal" as const,
      background: "Clean ecommerce information background.",
      composition: "Product-led layout with restrained callout zones; do not invent factual labels.",
      direction: "使用清晰的信息图构图并预留可复核的卖点文字区域，不添加未经确认的标签",
    },
    dimension_specification: {
      imageType: "selling_point_display" as const,
      visualStyle: "tech" as const,
      background: "Neutral specification-board background.",
      composition: "Clear dimension-guide layout with empty annotation zones; only confirmed measurements may be added during human review.",
      direction: "使用规格展示构图，仅为已确认尺寸预留标注区域，不编造尺寸",
    },
    detail_closeup: {
      imageType: "selling_point_display" as const,
      visualStyle: "premium" as const,
      background: "Quiet studio detail background.",
      composition: "Close-up composition focused on one visible material or construction detail.",
      direction: "使用细节特写构图，只突出已确认或参考图中可见的材质与结构",
    },
    packaging_bundle: {
      imageType: "selling_point_display" as const,
      visualStyle: "minimal" as const,
      background: "Clean product-set presentation background.",
      composition: "Balanced bundle layout; include packaging or accessories only when confirmed.",
      direction: "使用包装或套装展示构图，只呈现已确认的包装和配件",
    },
    usage_steps: {
      imageType: "selling_point_display" as const,
      visualStyle: "minimal" as const,
      background: "Clear instructional background.",
      composition: "Sequential multi-panel usage concept with empty caption zones; do not invent unconfirmed actions.",
      direction: "使用多画面步骤构图并预留说明区域，不编造未确认的操作方式",
    },
    comparison: {
      imageType: "selling_point_display" as const,
      visualStyle: "minimal" as const,
      background: "Neutral comparison-board background.",
      composition: "Side-by-side visual comparison layout; leave claims blank for human-verified copy.",
      direction: "使用并列对比构图，所有对比文案留待人工核验，不添加未经确认的结论",
    },
    custom: {
      imageType: "lifestyle_scene" as const,
      visualStyle: "minimal" as const,
      background: "User-defined product presentation background.",
      composition: "Balanced ecommerce composition that follows the reviewed custom purpose.",
      direction: normalized.customImagePurpose || "按用户填写的图片用途组织构图",
    },
  }[normalized.primaryImagePurpose];

  const sceneDirections = {
    none: null,
    home_lifestyle: {
      visualStyle: "home" as const,
      background: "Believable home-living context.",
      composition: "Natural in-use composition with clear product scale.",
      direction: "使用可信的家居生活环境，保持商品尺度清楚并预留适量留白",
    },
    office_commute: {
      visualStyle: "tech" as const,
      background: "Believable office or commute context.",
      composition: "Practical in-use composition with uncluttered working space.",
      direction: "使用可信的办公或通勤环境，保持画面简洁并体现日常使用情境",
    },
    outdoor_travel: {
      visualStyle: "outdoor" as const,
      background: "Believable outdoor or travel context.",
      composition: "Natural in-use composition with clear scale and safe environmental cues.",
      direction: "使用可信的户外或旅行环境，体现便携使用情境并保留适量留白；不要推断未确认功能",
    },
    sports_fitness: {
      visualStyle: "outdoor" as const,
      background: "Believable sports or fitness context.",
      composition: "Dynamic but credible in-use composition without performance claims.",
      direction: "使用可信的运动或健身环境，不暗示未经确认的性能或功效",
    },
  }[normalized.lifestyleScene];

  return {
    ...normalized,
    label: normalized.primaryImagePurpose === "custom"
      ? normalized.customImagePurpose
      : primaryPurposeLabel(normalized.primaryImagePurpose),
    imageType: purposeDirections.imageType,
    visualStyle: sceneDirections?.visualStyle ?? purposeDirections.visualStyle,
    background: sceneDirections?.background ?? purposeDirections.background,
    composition: [purposeDirections.composition, sceneDirections?.composition].filter(Boolean).join(" "),
    direction: [purposeDirections.direction, sceneDirections?.direction].filter(Boolean).join("；"),
  };
}

type StudioImageLegacyPreferences = {
  imageStyle?: unknown;
  backgroundPreference?: unknown;
  compositionPreference?: unknown;
  additionalRequirements?: unknown;
};

function normalizedPreference(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function matchesResolvedPreferences(
  preferences: StudioImageLegacyPreferences,
  resolved: ReturnType<typeof resolveStudioImageCreativeIntent>,
) {
  const background = normalizedPreference(preferences.backgroundPreference);
  const composition = normalizedPreference(preferences.compositionPreference);
  const style = normalizedPreference(preferences.imageStyle);
  return Boolean(background && composition)
    && background === resolved.background
    && composition === resolved.composition
    && (!style || style === resolved.visualStyle);
}

/**
 * Restores only the user's creative intent from the established safe Handoff preferences.
 * The result is presentation state, not an authoritative product fact or Provider payload.
 */
export function inferStudioImageCreativeIntentFromPreferences(
  preferences: StudioImageLegacyPreferences | null | undefined,
): StudioImageCreativeIntent {
  if (!preferences) return DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT;

  for (const purpose of STUDIO_IMAGE_PRIMARY_PURPOSES) {
    if (purpose.id === "custom") continue;
    for (const scene of STUDIO_IMAGE_LIFESTYLE_SCENES) {
      if (purpose.id === "white_studio" && scene.id !== "none") continue;
      const candidate: StudioImageCreativeIntent = {
        primaryImagePurpose: purpose.id,
        lifestyleScene: scene.id,
        customImagePurpose: "",
      };
      if (matchesResolvedPreferences(preferences, resolveStudioImageCreativeIntent(candidate))) {
        return candidate;
      }
    }
  }

  const additionalRequirements = normalizedPreference(preferences.additionalRequirements);
  const customPurposeMatch = additionalRequirements.match(/图片用途：([^。]{1,160})。/u);
  const customImagePurpose = customPurposeMatch?.[1]?.trim() ?? "";
  if (customImagePurpose) {
    for (const scene of STUDIO_IMAGE_LIFESTYLE_SCENES) {
      const candidate: StudioImageCreativeIntent = {
        primaryImagePurpose: "custom",
        lifestyleScene: scene.id,
        customImagePurpose,
      };
      if (matchesResolvedPreferences(preferences, resolveStudioImageCreativeIntent(candidate))) {
        return candidate;
      }
    }
  }

  return DEFAULT_STUDIO_IMAGE_CREATIVE_INTENT;
}
