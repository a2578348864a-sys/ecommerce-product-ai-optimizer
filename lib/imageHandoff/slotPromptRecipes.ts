/**
 * Slot Prompt Recipes — 视觉资产规划 6 大槽位的专业摄影与构图配方。
 *
 * 职责与第一性原理：
 * - 纯视觉控制：定义专业摄影参数（构图、焦距视角、布光方案、承托环境、留白排版与负面约束）。
 * - 绝不包含任何商品事实（材质名、尺寸数字、认证、性能承诺）。
 * - 纠偏 Slot 2 (卖点图) & Slot 3 (尺寸图)：坚决不要求生图模型直接绘制容易扭曲变形的微小文字、
 *   数字或标尺箭头，而是生成“主体清晰的高质商业底图 + 干净的排版留白负空间”。
 * - 纯函数与确定性数据字典，零外部依赖、零副作用。
 */

import type { StudioImageLifestyleScene, StudioImagePrimaryPurpose } from "@/lib/studioImageCreativeIntent";
import type { VisualAssetSlotType } from "@/lib/imageHandoff/visualAssetPlan";

export type SlotPromptRecipeId =
  | "main_white_studio"
  | "selling_points"
  | "dimension_specs"
  | "detail_closeup"
  | "lifestyle_in_use"
  | "packaging_bundle";

export type SlotPromptRecipe = {
  id: SlotPromptRecipeId;
  name: string;
  businessGoal: string;
  composition: string;
  cameraLanguage: string;
  lighting: string;
  environment: string;
  textPolicy: string;
  negativeConstraints: readonly string[];
};

export const SLOT_PROMPT_RECIPES: Record<SlotPromptRecipeId, SlotPromptRecipe> = {
  main_white_studio: {
    id: "main_white_studio",
    name: "白底合规主图",
    businessGoal: "Amazon compliant hero product shot for search result click-through and listing main image.",
    composition: "Centred hero product shot filling approximately 85% of the frame with balanced margins and a natural soft contact shadow anchoring the base.",
    cameraLanguage: "Eye-level or slight 10-degree downward angle, 85mm commercial lens perspective, crisp focus edge to edge with truthful proportions.",
    lighting: "Commercial 3-point softbox studio lighting, neutral even fill, gentle directional key light with zero color cast and no harsh specular blown-out spots.",
    environment: "Pure seamless solid white background (pure white RGB 255, 255, 255), completely clean with no horizon line, no platform reflection tricks and no backdrop scenery.",
    textPolicy: "Zero text, zero labels, zero logos, zero badges and zero graphic overlays.",
    negativeConstraints: [
      "no grey gradient or dark vignette background",
      "no horizon line or room walls",
      "no props, pedestals or set pieces",
      "no floating product with missing contact shadow",
      "no reflective floor mirror effect",
    ],
  },

  selling_points: {
    id: "selling_points",
    name: "核心卖点信息图",
    businessGoal: "High-impact visual foundation for listing secondary infographic slide, highlighting core product value.",
    composition: "Commercial split composition: product subject anchored clearly on one side (occupying roughly 55-65% of frame), leaving 35-45% clean, quiet negative space reserved for graphic overlay.",
    cameraLanguage: "Direct 3/4 commercial product perspective, 70mm focal length, sharp focus on primary functional zone.",
    lighting: "Even bright commercial commercial catalog light that cleanly separates the product edges from the background.",
    environment: "Subtle neutral high-key studio background with generous breathing room, structured spacing and zero visual noise.",
    textPolicy: "RESERVED LAYOUT SPACE: Keep all negative space and annotation zones completely blank and clean. Do NOT generate simulated text, fake typography, callout arrows, icons, badges or marketing slogans into the image.",
    negativeConstraints: [
      "no simulated text, gibberish letters or fabricated English labels",
      "no callout lines, arrows or measurement markers drawn into the frame",
      "no multi-panel collage, grid or moodboard layout",
      "no cluttered backdrop competing with the product subject",
    ],
  },

  dimension_specs: {
    id: "dimension_specs",
    name: "尺寸规格与空间图",
    businessGoal: "Clean spatial scale and physical proportion reference to eliminate buyer size confusion and prevent returns.",
    composition: "Straightforward scale-reference composition showing the full exterior silhouette of the product with ample surrounding buffer space for post-production dimension callouts.",
    cameraLanguage: "Orthographic straight-on or standard isometric perspective with zero wide-angle perspective distortion so physical proportions remain truthful.",
    lighting: "Crisp architectural studio lighting that defines exact silhouette edges and vertical/horizontal volume contours.",
    environment: "Minimal clean neutral surface with clear spatial boundaries and zero distracting decor.",
    textPolicy: "CLEAN SCALE TEMPLATE: Do NOT render dimension numbers (e.g. cm, inches), rulers, measurement tape, callout arrows or specification text. Provide an pristine commercial base image ready for vector overlays.",
    negativeConstraints: [
      "no rendered dimension numbers, measurement lines or arrow indicators",
      "no distorted perspective or fish-eye lens curvature",
      "no cropped product edges or clipped silhouette",
      "no confusing props that mislead real-world scale",
    ],
  },

  detail_closeup: {
    id: "detail_closeup",
    name: "材质工艺与细节特写",
    businessGoal: "Macro inspection of genuine craftsmanship, precision joints, seam finish and surface texture to build buyer trust.",
    composition: "Macro framing tightly focused on the authentic mechanical joint, finish texture or interface, with clean diagonal or horizontal lead-in lines.",
    cameraLanguage: "100mm macro lens, moderate f/8 aperture ensuring the key detail structure remains tack-sharp while soft background drops away smoothly.",
    lighting: "Controlled grazing side light (raking light) that accentuates surface tactile depth, physical finish grain and refined edge highlights.",
    environment: "Quiet neutral seamless studio backdrop that never distracts from the macro focal point.",
    textPolicy: "Zero text, zero measurement arrows and zero graphic callouts.",
    negativeConstraints: [
      "no invented mechanical parts, screws or seams not present in reference",
      "no ultra-shallow depth of field that blurs the critical detail area",
      "no synthetic CGI plastic sheen or artificial gloss",
    ],
  },

  lifestyle_in_use: {
    id: "lifestyle_in_use",
    name: "真实生活使用场景图",
    businessGoal: "Believable contextual staging in real living or work environments to inspire emotional connection and use-case clarity.",
    composition: "Still-life contextual composition where the product clearly remains the hero subject (occupying 40-50% visual weight) in natural in-use placement.",
    cameraLanguage: "Natural eye-level perspective, 50mm human-eye focal length, realistic shallow depth of field softly blurring background context.",
    lighting: "Soft natural directional daylight (simulating window or ambient daylight) with realistic ambient bounce and matching color temperature.",
    environment: "Authentic, clean and tidy lifestyle environment (kitchen, living space, desk or commute) with tasteful, non-competing everyday setting.",
    textPolicy: "Zero text, zero commercial slogans, zero watermarks and zero price badges.",
    negativeConstraints: [
      "no cluttered environment where product gets lost in background noise",
      "no distorted or malformed human hands interacting with product",
      "no mismatched lighting direction between subject and scene",
      "no exaggerated dramatic fantasy lighting",
    ],
  },

  packaging_bundle: {
    id: "packaging_bundle",
    name: "包装清单与配件展示",
    businessGoal: "Accurate what-is-in-the-box presentation displaying all confirmed package contents clearly to ensure buyer confidence.",
    composition: "Structured flat-lay (knolling arrangement) or clean editorial presentation with consistent spacing between each confirmed item.",
    cameraLanguage: "High 75-degree or top-down 90-degree angle, sharp focus across all components with honest comparative sizes.",
    lighting: "High-key overhead soft diffuse lighting minimizing cast shadow overlap between adjacent items.",
    environment: "Clean, neutral matte surface (light grey or soft neutral tone) with zero decorative set dressing.",
    textPolicy: "Zero fabricated box print text, zero unconfirmed barcode stickers and zero promotional badges.",
    negativeConstraints: [
      "no invented packaging boxes, sleeves or gift wrap not in facts",
      "no extra accessories, units, gifts or parts beyond confirmed list",
      "no overlapping items that hide the true quantity of contents",
      "no simulated printed brand copy on unconfirmed boxes",
    ],
  },
};

export type ResolveSlotRecipeInput = {
  slotType?: VisualAssetSlotType | string | null;
  primaryPurpose?: StudioImagePrimaryPurpose | string | null;
  lifestyleScene?: StudioImageLifestyleScene | string | null;
  stylePresetId?: string | null;
};

/**
 * 确定性解析当前任务/请求对应的视觉配方。
 */
export function resolveSlotRecipe(input: ResolveSlotRecipeInput): SlotPromptRecipe {
  const slotType = input.slotType;
  if (slotType) {
    if (slotType === "main_white_studio" || slotType === "slot-main") return SLOT_PROMPT_RECIPES.main_white_studio;
    if (slotType === "selling_points" || slotType === "slot-selling-points") return SLOT_PROMPT_RECIPES.selling_points;
    if (slotType === "dimension_specs" || slotType === "slot-dimension-specs") return SLOT_PROMPT_RECIPES.dimension_specs;
    if (slotType === "detail_closeup" || slotType === "slot-detail-closeup") return SLOT_PROMPT_RECIPES.detail_closeup;
    if (slotType === "lifestyle_in_use" || slotType === "slot-lifestyle-scene") return SLOT_PROMPT_RECIPES.lifestyle_in_use;
    if (slotType === "packaging_bundle" || slotType === "slot-packaging-bundle") return SLOT_PROMPT_RECIPES.packaging_bundle;
  }

  const purpose = input.primaryPurpose;
  const scene = input.lifestyleScene;

  if (purpose === "white_studio") {
    return SLOT_PROMPT_RECIPES.main_white_studio;
  }
  if (purpose === "dimension_specification") {
    return SLOT_PROMPT_RECIPES.dimension_specs;
  }
  if (purpose === "detail_closeup") {
    return SLOT_PROMPT_RECIPES.detail_closeup;
  }
  if (purpose === "packaging_bundle") {
    return SLOT_PROMPT_RECIPES.packaging_bundle;
  }
  if (scene && scene !== "none") {
    return SLOT_PROMPT_RECIPES.lifestyle_in_use;
  }
  if (purpose === "selling_point_infographic") {
    return SLOT_PROMPT_RECIPES.selling_points;
  }

  // 风格预设辅助推断
  if (input.stylePresetId === "macro_detail") return SLOT_PROMPT_RECIPES.detail_closeup;
  if (input.stylePresetId === "packaging_set") return SLOT_PROMPT_RECIPES.packaging_bundle;
  if (input.stylePresetId === "lifestyle_home" || input.stylePresetId === "outdoor_story") return SLOT_PROMPT_RECIPES.lifestyle_in_use;
  if (input.stylePresetId === "feature_board") return SLOT_PROMPT_RECIPES.selling_points;

  return SLOT_PROMPT_RECIPES.main_white_studio;
}

/**
 * 格式化输出槽位配方的结构化文本块，直接注入 Prompt。
 */
export function formatSlotRecipeBlock(recipe: SlotPromptRecipe): string {
  return [
    `=== 槽位视觉配方（SLOT RECIPE: ${recipe.name.toUpperCase()} / ${recipe.id}）===`,
    `Business Goal: ${recipe.businessGoal}`,
    `Composition: ${recipe.composition}`,
    `Camera & Lens: ${recipe.cameraLanguage}`,
    `Lighting Setup: ${recipe.lighting}`,
    `Environment & Surface: ${recipe.environment}`,
    `Text & UI Space: ${recipe.textPolicy}`,
    `Slot Negative Rules: ${recipe.negativeConstraints.join("; ")}`,
  ].join("\n");
}
