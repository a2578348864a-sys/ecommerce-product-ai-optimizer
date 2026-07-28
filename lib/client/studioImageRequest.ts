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
  compositionRequirements: string;
  prohibitedElements: string;
};

export type PromptImageFormIntent = SharedImageFormIntent & {
  creationMode: "prompt";
  creativePrompt: string;
  avoidElements: string;
};

export type StudioImageFormIntent = ImageFormIntent | PromptImageFormIntent;

export const EMPTY_IMAGE_INTENT: ImageFormIntent = {
  creationMode: "guided",
  imageType: "product_main",
  visualStyle: "minimal",
  count: 1,
  aspectRatio: "square_1_1",
  compositionRequirements: "",
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
}) {
  const common = {
    creationMode: input.intent.creationMode,
    productName: input.productName.trim(),
    description: input.description.trim(),
    count: input.intent.count,
    aspectRatio: input.intent.aspectRatio,
    mode: input.mode,
  };
  if (input.intent.creationMode === "prompt") {
    return {
      ...common,
      creativePrompt: input.intent.creativePrompt.trim(),
      avoidElements: input.intent.avoidElements.trim(),
    };
  }
  return {
    ...common,
    imageType: input.intent.imageType,
    visualStyle: input.intent.visualStyle,
    compositionRequirements: input.intent.compositionRequirements.trim(),
    prohibitedElements: input.intent.prohibitedElements.trim(),
  };
}
