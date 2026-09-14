/**
 * Slot Prompt Recipes — 视觉资产规划 6 大槽位的专业摄影与构图配方。
 *
 * 职责与第一性原理：
 * - 纯视觉控制：定义专业摄影参数（构图、焦距视角、布光方案、承托环境、留白排版与负面约束）。
 * - 绝不包含任何商品事实（材质名、尺寸数字、认证、性能承诺）。
 * - 纠偏 Slot 2 (卖点图) & Slot 3 (尺寸图)：坚决不要求生图模型直接绘制容易扭曲变形的微小文字、
 *   数字或标尺箭头，而是生成“主体清晰的高质商业底图 + 干净的排版留白负空间”。
 * - 纯函数与确定性数据字典，零外部依赖、零副作用。
 *
 * 机器可读字段（在既有 7 个字段名与语义不变的前提下新增）：
 * - recipeVersion：由配方内容确定性派生（sha256 前 8 位），禁止手写，改内容即改版本；
 * - buyerQuestion：这张图要回答的购买疑问，只写“帮助用户了解…”，不写未经证实的结论；
 * - requiredFactKinds：该槽位依赖的已确认事实种类，唯一来源是 purposeRequirements 的既有判定，
 *   本文件不复制任何字段白名单，也不新增第二套门禁规则；
 * - textAllowed / backgroundPolicy：把既有 textPolicy / environment 文案的结论显式化为机器可读值。
 */

import type { StudioImageLifestyleScene, StudioImagePrimaryPurpose } from "@/lib/studioImageCreativeIntent";
import { requiredFactKindsForPurpose, type RequiredFactKind } from "@/lib/imageHandoff/purposeRequirements";
import type { VisualAssetSlotType } from "@/lib/imageHandoff/visualAssetPlan";

export type SlotPromptRecipeId =
  | "main_white_studio"
  | "selling_points"
  | "dimension_specs"
  | "detail_closeup"
  | "lifestyle_in_use"
  | "packaging_bundle"
  | "usage_steps";

/** 背景策略：与 environment 文案一致（纯白合规底 / 中性棚拍面 / 真实场景环境） */
export type SlotBackgroundPolicy = "pure_white" | "neutral" | "scene";

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
  /** 内容确定性派生版本（sha256(recipeId + "|" + 规范化序列化) 前 8 位）；禁止手写 */
  recipeVersion: string;
  /** 这张图要回答的购买疑问（疑问句式，不得写成未经证实的结论） */
  buyerQuestion: string;
  /** 该槽位依赖的已确认事实种类（源自 purposeRequirements 的派生结果） */
  requiredFactKinds: readonly RequiredFactKind[];
  /** 是否允许画面出现文字：与既有 textPolicy 文案一致 */
  textAllowed: boolean;
  /** 背景策略：与既有 environment 文案一致 */
  backgroundPolicy: SlotBackgroundPolicy;
};

/** recipeVersion 的哈希输入内容：全部配方字段，但不含 recipeVersion 自身（避免自指） */
export type SlotPromptRecipeContent = Omit<SlotPromptRecipe, "recipeVersion">;

// ── recipeVersion 确定性派生（SHA-256，零依赖实现）──────────────────────────
/**
 * 这里没有使用 node:crypto：本模块同时被服务端提示词链路与展示层复用，
 * node:crypto 会污染客户端 bundle。故使用无环境依赖的纯 TS SHA-256
 * （Node / Edge / 浏览器结果一致），并由测试与 node:crypto 的 sha256 逐条对照校验。
 */
const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_INITIAL_HASH = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(input: string): string {
  const message = new TextEncoder().encode(input);
  const paddedLength = (((message.length + 8) >> 6) << 6) + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  const bitLength = message.length * 8;
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = Uint32Array.from(SHA256_INITIAL_HASH);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = paddedView.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = words[i - 15];
      const w2 = words[i - 2];
      const s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >>> 3);
      const s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + SHA256_ROUND_CONSTANTS[i] + words[i]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join("");
}

/**
 * 规范化序列化：按固定字段顺序取值（与对象键顺序无关），数组保持原顺序，
 * 输入内容不含 recipeVersion 自身，避免自指导致的版本漂移。
 */
function canonicalSlotRecipeSource(content: SlotPromptRecipeContent): string {
  return JSON.stringify([
    content.id,
    content.name,
    content.businessGoal,
    content.composition,
    content.cameraLanguage,
    content.lighting,
    content.environment,
    content.textPolicy,
    [...content.negativeConstraints],
    content.buyerQuestion,
    [...content.requiredFactKinds],
    content.textAllowed,
    content.backgroundPolicy,
  ]);
}

/** 由内容派生 recipeVersion：sha256(recipeId + "|" + 规范化序列化).slice(0, 8) */
export function deriveSlotRecipeVersion(content: SlotPromptRecipeContent): string {
  return sha256Hex(`${content.id}|${canonicalSlotRecipeSource(content)}`).slice(0, 8);
}

/** 事实门禁用途对齐：只做槽位 → 既有用途枚举的映射，事实种类一律来自 purposeRequirements 派生 */
const MAIN_STUDIO_FACT_KINDS = requiredFactKindsForPurpose("white_studio");
const DETAIL_CLOSEUP_FACT_KINDS = requiredFactKindsForPurpose("detail_closeup");
/**
 * 场景槽位不依赖任何已确认事实种类：
 * visualAssetPlan 中该槽位是构图概念探索槽位，readiness 恒为 ready，不读取任何 has*Evidence 结果，
 * 因此这里与规划保持一致（不额外收紧门禁，也不宣布任何事实已满足）。
 */
const LIFESTYLE_FACT_KINDS: readonly RequiredFactKind[] = Object.freeze([]);

const RECIPE_DEFINITIONS: Record<SlotPromptRecipeId, SlotPromptRecipeContent> = {
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
    buyerQuestion: "帮助用户了解商品在纯白背景下的真实外观、整体比例与主体轮廓是什么样的。",
    // environment: Pure seamless solid white background (pure white RGB 255, 255, 255) → pure_white
    backgroundPolicy: "pure_white",
    // textPolicy: Zero text, zero labels … → 禁止文字
    textAllowed: false,
    requiredFactKinds: MAIN_STUDIO_FACT_KINDS,
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
    buyerQuestion: "帮助用户了解这款商品有哪些已确认的功能、材质或结构特征值得关注。",
    // environment: Subtle neutral high-key studio background → neutral
    backgroundPolicy: "neutral",
    // textPolicy: Do NOT generate simulated text … → 禁止文字
    textAllowed: false,
    requiredFactKinds: requiredFactKindsForPurpose("selling_point_infographic"),
  },

  dimension_specs: {
    id: "dimension_specs",
    name: "尺寸规格与空间图",
    businessGoal: "Clear spatial scale and physical proportion reference to eliminate buyer size confusion and prevent returns.",
    composition: "Intuitive scale-comparison composition: stage the product naturally alongside a recognized, standard everyday physical object (such as a standard smartphone, coffee mug, pen, or human hand placed next to the base) to clearly demonstrate truthful human-scale volume, height and depth, while maintaining generous negative space around the silhouette for post-production graphic annotations.",
    cameraLanguage: "Orthographic straight-on or standard isometric perspective with zero wide-angle perspective distortion so physical proportions and relative scale remain truthful.",
    lighting: "Crisp architectural studio lighting that defines exact silhouette edges and vertical/horizontal volume contours against the reference object.",
    environment: "Clean, contemporary neutral tabletop or studio surface with clear spatial boundaries, subtle natural contact shadows and truthful depth reference.",
    textPolicy: "CLEAN SCALE TEMPLATE: Do NOT render dimension numbers (e.g. cm, inches), rulers, measurement tape, callout arrows or specification text. Provide an pristine commercial base image ready for vector overlays.",
    negativeConstraints: [
      "no rendered dimension numbers, measurement lines or arrow indicators",
      "no distorted perspective or fish-eye lens curvature",
      "no cropped product edges or clipped silhouette",
      "no misleading reference objects with non-standard or deceptive scale",
      "no plain isolated product on blank white background without scale reference context",
    ],
    buyerQuestion: "帮助用户了解商品的实际尺寸、体积与占用空间大概有多大。",
    // environment: Clean, contemporary neutral tabletop or studio surface → neutral
    backgroundPolicy: "neutral",
    // textPolicy: Do NOT render dimension numbers … or specification text → 禁止文字
    textAllowed: false,
    requiredFactKinds: requiredFactKindsForPurpose("dimension_specification"),
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
    buyerQuestion: "帮助用户了解商品的做工细节、接缝处理与表面质感是什么样的。",
    // environment: Quiet neutral seamless studio backdrop → neutral
    backgroundPolicy: "neutral",
    // textPolicy: Zero text, zero measurement arrows … → 禁止文字
    textAllowed: false,
    requiredFactKinds: DETAIL_CLOSEUP_FACT_KINDS,
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
    buyerQuestion: "帮助用户了解商品放进真实生活场景后是什么样子、适合在哪些场合使用。",
    // environment: Authentic … lifestyle environment (kitchen, living space, desk or commute) → scene
    backgroundPolicy: "scene",
    // textPolicy: Zero text, zero commercial slogans … → 禁止文字
    textAllowed: false,
    requiredFactKinds: LIFESTYLE_FACT_KINDS,
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
    buyerQuestion: "帮助用户了解套装里包含哪些物品、每样各有多少件。",
    // environment: Clean, neutral matte surface (light grey or soft neutral tone) → neutral
    backgroundPolicy: "neutral",
    // textPolicy: Zero fabricated box print text … → 禁止文字
    textAllowed: false,
    requiredFactKinds: requiredFactKindsForPurpose("packaging_bundle"),
  },

  usage_steps: {
    id: "usage_steps",
    name: "使用步骤与操作指引",
    businessGoal: "Clear multi-step sequential workflow guide illustrating practical operation, setup or usage flow to eliminate customer confusion and support post-purchase confidence.",
    composition: "Multi-step sequential layout presenting distinct operational phases (e.g. step 1 preparation, step 2 action, step 3 completion) in a clean logical progression with dedicated blank caption zones beneath each stage.",
    cameraLanguage: "Consistent eye-level or 45-degree instructional angle across all step panels, 50mm natural focal length, crisp focus locked on the product mechanism and active operation point.",
    lighting: "Even, bright, shadow-free commercial instructional lighting with balanced fill, ensuring mechanical parts, latches, caps and buttons are distinctly visible.",
    environment: "Clean, neutral practical workspace or everyday countertop appropriate to the product function, completely free of visual clutter.",
    textPolicy: "RESERVED STEP CAPTIONS: Keep all caption areas, numbering zones, callout circles and instructional labels completely blank and clean. Do NOT generate simulated numbers, text, arrows or icons.",
    negativeConstraints: [
      "no distorted or malformed human hands, missing knuckles, extra fingers or unnatural grip angles",
      "no invented mechanical parts, latches, lids, hinges, valves or buttons not present in reference image",
      "no simulated text, step numbers, callout arrows, badges or typography drawn into the frame",
      "no chaotic background clutter competing with the functional demonstration",
      "no single-step plain product photo masking as a multi-step sequence",
    ],
    buyerQuestion: "帮助用户了解这件商品从准备到完成需要按什么步骤操作。",
    // environment: Clean, neutral practical workspace or everyday countertop → neutral
    backgroundPolicy: "neutral",
    // textPolicy: Do NOT generate simulated numbers, text, arrows or icons → 禁止文字
    textAllowed: false,
    requiredFactKinds: requiredFactKindsForPurpose("usage_steps"),
  },
};

function withRecipeVersion(content: SlotPromptRecipeContent): SlotPromptRecipe {
  return Object.freeze({
    ...content,
    negativeConstraints: Object.freeze([...content.negativeConstraints]),
    requiredFactKinds: Object.freeze([...content.requiredFactKinds]),
    recipeVersion: deriveSlotRecipeVersion(content),
  });
}

function buildSlotPromptRecipes(): Record<SlotPromptRecipeId, SlotPromptRecipe> {
  const recipes = {} as Record<SlotPromptRecipeId, SlotPromptRecipe>;
  for (const id of Object.keys(RECIPE_DEFINITIONS) as SlotPromptRecipeId[]) {
    recipes[id] = withRecipeVersion(RECIPE_DEFINITIONS[id]);
  }
  return Object.freeze(recipes);
}

export const SLOT_PROMPT_RECIPES: Record<SlotPromptRecipeId, SlotPromptRecipe> = buildSlotPromptRecipes();

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
    if (slotType === "usage_steps" || slotType === "slot-usage-steps") return SLOT_PROMPT_RECIPES.usage_steps;
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
  if (purpose === "usage_steps") {
    return SLOT_PROMPT_RECIPES.usage_steps;
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
