import type {
  StudioImageAspectRatio,
  StudioImageMode,
  StudioImageType,
  StudioImageVisualStyle,
} from "@/lib/studioImageInput";

type SharedImageFormIntent = {
  count: 1 | 2;
  aspectRatio: StudioImageAspectRatio;
};

export type ImageFormIntent = SharedImageFormIntent & {
  creationMode: "guided";
  imageType: StudioImageType;
  visualStyle: StudioImageVisualStyle;
  scenePreset: ImageScenePreset;
  sceneIntent: ImageSceneIntent;
  customInstruction: string;
  prohibitedElements: string;
};

export type PromptImageFormIntent = SharedImageFormIntent & {
  creationMode: "prompt";
  creativePrompt: string;
  avoidElements: string;
};

export type StudioImageFormIntent = ImageFormIntent | PromptImageFormIntent;

export const STUDIO_IMAGE_SCENE_GROUPS = [
  {
    id: "ecommerce_basic",
    label: "电商基础",
    presets: [
      { id: "white_studio", label: "白底主图 / 棚拍", description: "干净背景，突出商品主体", intent: "clean_studio_product_focus", imageType: "product_main", visualStyle: "minimal", background: "Clean white studio background.", composition: "Centered product-first composition with a natural shadow." },
      { id: "selling_point_infographic", label: "卖点信息图", description: "预留可复核的信息标注区", intent: "selling_point_information_layout", imageType: "selling_point_display", visualStyle: "minimal", background: "Clean ecommerce information background.", composition: "Product-led layout with restrained callout zones and clear visual hierarchy; do not invent factual labels." },
      { id: "dimension_specification", label: "尺寸规格图", description: "为已确认尺寸预留标注区", intent: "dimension_specification_layout", imageType: "selling_point_display", visualStyle: "tech", background: "Neutral specification-board background.", composition: "Clear dimension-guide layout with empty annotation zones; only confirmed measurements may be added during human review." },
      { id: "detail_closeup", label: "产品细节特写", description: "突出可见材质或结构细节", intent: "product_detail_closeup", imageType: "selling_point_display", visualStyle: "premium", background: "Quiet studio detail background.", composition: "Close-up composition focused on one visible material or construction detail." },
      { id: "packaging_bundle", label: "包装 / 套装展示", description: "仅展示已确认的包装与配件", intent: "packaging_bundle_display", imageType: "selling_point_display", visualStyle: "minimal", background: "Clean product-set presentation background.", composition: "Balanced bundle layout; include packaging or accessories only when they are confirmed." },
      { id: "usage_steps", label: "使用步骤图", description: "多画面步骤构图，不编造操作", intent: "usage_steps_sequence", imageType: "selling_point_display", visualStyle: "minimal", background: "Clear instructional background.", composition: "Sequential multi-panel usage concept with empty caption zones; do not invent unconfirmed actions." },
    ],
  },
  {
    id: "lifestyle",
    label: "生活方式",
    presets: [
      { id: "home_lifestyle", label: "家居生活", description: "自然家居使用情境", intent: "home_lifestyle_context", imageType: "lifestyle_scene", visualStyle: "home", background: "Believable home-living context.", composition: "Natural in-use composition with clear product scale." },
      { id: "office_commute", label: "办公 / 通勤", description: "工作台或通勤使用情境", intent: "office_commute_context", imageType: "lifestyle_scene", visualStyle: "tech", background: "Believable office or commute context.", composition: "Practical in-use composition with uncluttered working space." },
      { id: "outdoor_travel", label: "户外 / 旅行", description: "户外或旅行使用情境", intent: "outdoor_travel_context", imageType: "lifestyle_scene", visualStyle: "outdoor", background: "Believable outdoor or travel context.", composition: "Natural in-use composition with clear scale and safe environmental cues." },
      { id: "sports_fitness", label: "运动 / 健身", description: "可信的运动环境，不暗示功效", intent: "sports_fitness_context", imageType: "lifestyle_scene", visualStyle: "outdoor", background: "Believable sports or fitness context.", composition: "Dynamic but credible in-use composition without performance claims." },
    ],
  },
  {
    id: "other",
    label: "其他",
    presets: [
      { id: "comparison", label: "对比展示", description: "并列构图，对比文案留待人工核验", intent: "comparison_layout", imageType: "selling_point_display", visualStyle: "minimal", background: "Neutral comparison-board background.", composition: "Side-by-side visual comparison layout; leave claims blank for human-verified copy." },
      { id: "custom", label: "自定义场景", description: "由你填写场景与构图要求", intent: "custom_scene_direction", imageType: "lifestyle_scene", visualStyle: "minimal", background: "User-defined scene direction.", composition: "Balanced ecommerce composition that follows the custom instruction." },
    ],
  },
] as const;

type ImageSceneDefinition = (typeof STUDIO_IMAGE_SCENE_GROUPS)[number]["presets"][number];
export type ImageScenePreset = ImageSceneDefinition["id"];
export type ImageSceneIntent = ImageSceneDefinition["intent"];

export function resolveImageScenePreset(scenePreset: ImageScenePreset): ImageSceneDefinition {
  const preset = STUDIO_IMAGE_SCENE_GROUPS
    .flatMap((group) => [...group.presets])
    .find((candidate) => candidate.id === scenePreset);
  return preset ?? STUDIO_IMAGE_SCENE_GROUPS[0].presets[0];
}

export function createImageSceneSelection(
  scenePreset: ImageScenePreset,
  customInstruction = "",
) {
  const preset = resolveImageScenePreset(scenePreset);
  return {
    scenePreset: preset.id,
    sceneIntent: preset.intent,
    customInstruction: customInstruction.trim(),
  };
}

export const EMPTY_IMAGE_INTENT: ImageFormIntent = {
  creationMode: "guided",
  imageType: "product_main",
  visualStyle: "minimal",
  ...createImageSceneSelection("white_studio"),
  count: 1,
  aspectRatio: "square_1_1",
  prohibitedElements: "",
};

export const EMPTY_PROMPT_IMAGE_INTENT: PromptImageFormIntent = {
  creationMode: "prompt",
  creativePrompt: "",
  avoidElements: "",
  count: 1,
  aspectRatio: "square_1_1",
};

export const STUDIO_IMAGE_PROMPT_TEMPLATES = [
  {
    id: "white_background",
    label: "白底主图",
    prompt: "Create a clean ecommerce product hero image on a seamless white background with balanced studio lighting and a natural product shadow.",
  },
  {
    id: "lifestyle_scene",
    label: "生活场景",
    prompt: "Place the product in a believable everyday setting with natural light, clear scale, and enough breathing room around the subject.",
  },
  {
    id: "detail_closeup",
    label: "细节特写",
    prompt: "Create a refined close-up that highlights material, texture, finish, and one important product detail with shallow depth of field.",
  },
  {
    id: "ad_creative",
    label: "广告素材",
    prompt: "Create a premium ecommerce campaign visual with a strong focal point, restrained graphic composition, and clear negative space for later copy placement.",
  },
] as const;

export function buildStudioImageRequestCore(input: {
  productName: string;
  description: string;
  intent: StudioImageFormIntent;
  mode: StudioImageMode;
  referenceImageDataUrl?: string;
  referenceImageApproved?: boolean;
}) {
  const common = {
    briefVersion: "studio-creative-brief.v1" as const,
    factsConfirmed: true as const,
    humanReviewRequired: true as const,
    creationMode: input.intent.creationMode,
    productName: input.productName.trim(),
    description: input.description.trim(),
    count: input.intent.count,
    aspectRatio: input.intent.aspectRatio,
    mode: input.mode,
    ...(input.referenceImageDataUrl
      ? {
          referenceImageDataUrl: input.referenceImageDataUrl,
          referenceImageApproved: input.referenceImageApproved === true,
        }
      : {}),
  };
  if (input.intent.creationMode === "prompt") {
    return {
      ...common,
      creativePrompt: input.intent.creativePrompt.trim(),
      avoidElements: input.intent.avoidElements.trim(),
    };
  }
  const scene = resolveImageScenePreset(input.intent.scenePreset);
  const compositionRequirements = [
    scene.background,
    scene.composition,
    input.intent.customInstruction.trim(),
  ].filter(Boolean).join(" ");
  return {
    ...common,
    imageType: scene.imageType,
    visualStyle: input.intent.visualStyle,
    compositionRequirements,
    prohibitedElements: input.intent.prohibitedElements.trim(),
  };
}
