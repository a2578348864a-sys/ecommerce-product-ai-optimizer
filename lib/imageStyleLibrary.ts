/**
 * Image Style Library V1 — 电商视觉方向库（纯视觉，不含任何商品事实）。
 *
 * 职责边界（本文件的第一原则）：
 * - Confirmed Facts 决定「允许画什么」；本库只决定「怎么画」。
 * - 这里的每一条文案都是摄影/构图/灯光/色彩语言，不得包含任何
 *   材质、容量、性能、认证、尺寸、重量、配件或功能类断言。
 *   任何事实类表达必须改写为纯视觉表达（见 IMAGE_STYLE_FORBIDDEN_FACT_TOKENS
 *   与 findImageStyleFactLeak，测试会逐条校验 8 个预设）。
 * - 本库是纯静态数据 + 纯函数，不依赖数据库、网络、Provider，也不读取
 *   Confirmed Facts、参考图或用户输入。
 *
 * Prompt-as-Code：本库只提供「风格配方」，由 lib/imagePromptComposer.ts 在最后
 * 一步与事实通道合流；风格永远不能覆盖事实优先级。
 */
import type { StudioImagePrimaryPurpose } from "@/lib/studioImageCreativeIntent";
import type { StudioImageVisualStyle } from "@/lib/studioImageInput";

export const IMAGE_STYLE_LIBRARY_VERSION = "image-style-library.v1" as const;

export const IMAGE_STYLE_PRESET_IDS = [
  "amazon_clean_hero",
  "premium_editorial",
  "lifestyle_home",
  "outdoor_story",
  "macro_detail",
  "feature_board",
  "packaging_set",
  "campaign_visual",
] as const;

export type ImageStylePresetId = (typeof IMAGE_STYLE_PRESET_IDS)[number];

export type ImageStyleCategory =
  | "catalog"
  | "editorial"
  | "lifestyle"
  | "detail"
  | "information"
  | "set"
  | "campaign";

export type ImageStylePreset = {
  id: ImageStylePresetId;
  /** 中文短标题（UI 卡片标题）。 */
  label: string;
  /** 一句中文说明（UI 卡片副标题）。 */
  description: string;
  category: ImageStyleCategory;
  /** 适用的图片用途；用于默认推荐与兼容性校验，不强制用户选择。 */
  compatiblePurposes: readonly StudioImagePrimaryPurpose[];
  /**
   * 兼容既有视觉轴（mock 调色板 / 结果标签 / 请求指纹仍以它为准）。
   * 风格预设叠加在它之上，不替代它。
   */
  visualStyle: StudioImageVisualStyle;
  composition: string;
  lighting: string;
  environment: string;
  colorMood: string;
  cameraLanguage: string;
  propPolicy: string;
  textPolicy: string;
  negativeRules: readonly string[];
};

/**
 * 事实类词汇黑名单：风格库自身文案绝不允许出现这些「商品事实类」表达。
 * 覆盖材质、性能、认证、温控、结构承诺等类别；命中即视为事实泄漏。
 */
export const IMAGE_STYLE_FORBIDDEN_FACT_TOKENS: readonly string[] = [
  // 材质 / 表面工艺
  "titanium", "aluminium", "aluminum", "stainless", "steel", "leather", "silicone",
  "ceramic", "porcelain", "bamboo", "marble", "granite", "velvet", "wooden", "brushed",
  "anodized", "galvanized", "titanium-plated", "gold-plated", "chrome-plated",
  "钛", "铝合金", "不锈钢", "真皮", "硅胶", "陶瓷", "大理石", "实木",
  // 性能 / 耐用 / 防护
  "waterproof", "leakproof", "rustproof", "shockproof", "scratchproof", "unbreakable",
  "durable", "durability", "heavy-duty", "non-toxic", "food-grade", "insulated",
  "keeps cold", "keeps hot", "heat-resistant", "防水", "防漏", "防摔", "耐用",
  "保温", "耐高温", "无毒", "食品级",
  // 认证 / 合规 / 承诺
  "fda", "ce-certified", "rohs", "certified", "certification", "fda-approved",
  "approved badge", "guaranteed", "lifetime warranty", "认证", "保证", "质保",
  // 容量 / 尺寸 / 重量 / 数量事实
  "capacity", "milliliter", "ounce capacity", "gram weight", "inch size",
  "容量", "毫升", "克重", "尺寸", "重量",
  // 配件 / 结构 / 功能承诺
  "extra accessory", "included accessory", "extra bundle", "add-on part",
  "附带配件", "赠送配件", "额外配件", "拆卸结构",
];

/**
 * 返回风格文案中命中事实黑名单的词汇（空数组 = 无事实泄漏）。
 *
 * 否定语境不算断言：「no certification badges」「never invent packaging」是在**禁止**
 * 某类事实表达，而不是声称商品具备它，因此不计为泄漏。判定方式只看命中词之前
 * 一小段文本是否处于否定结构，避免把整句否定误判成事实声明。
 * 「not only / not just」是让步对比（后面往往跟着真实断言），不构成豁免。
 */
const FACT_LEAK_NEGATION = /(?:\b(?:no|not|never|without|avoid|avoids|excludes?|excluding|free of)\b|不要|禁止|不含|无)(?!\s+(?:only|just)\b)[^.;]{0,18}$/u;

/**
 * 归一化被扫描文本：NFKC 折叠全角/兼容字符并转小写。
 * 零宽/格式控制字符**不能直接删除**（「tita​anium」删掉零宽后仍不等于 titanium），
 * 而是在词条匹配时允许其出现在字符之间。
 */
function normaliseForFactScan(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en");
}

/** 字符之间允许的伪装：空白、连字符、下划线、零宽与格式控制字符。 */
const FACT_TOKEN_GAP = "[\\s\\-_\\p{Cf}]*";

function factTokenPattern(token: string): RegExp {
  const body = [...token]
    .map((char) => char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(FACT_TOKEN_GAP);
  return new RegExp(body, "gu");
}

const FACT_TOKEN_PATTERNS: readonly (readonly [token: string, pattern: RegExp])[] =
  IMAGE_STYLE_FORBIDDEN_FACT_TOKENS.map((token) => [token, factTokenPattern(token)] as const);

export function findImageStyleFactLeak(value: string): string[] {
  const normalized = normaliseForFactScan(value);
  const hits: string[] = [];
  for (const [token, pattern] of FACT_TOKEN_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(normalized);
    while (match) {
      const before = normalized.slice(Math.max(0, match.index - 28), match.index);
      if (!FACT_LEAK_NEGATION.test(before)) {
        hits.push(token);
        break;
      }
      match = pattern.exec(normalized);
    }
  }
  return hits;
}

const PRESETS: readonly ImageStylePreset[] = [
  {
    id: "amazon_clean_hero",
    label: "高级白底",
    description: "干净棚拍，突出商品主体",
    category: "catalog",
    compatiblePurposes: ["white_studio", "custom"],
    visualStyle: "minimal",
    composition: "Centred product-first framing with even, generous margins and a natural contact shadow.",
    lighting: "Balanced soft studio key with gentle fill and no colour cast.",
    environment: "Seamless light studio sweep; nothing else in frame.",
    colorMood: "High-key neutral background; product colour rendered as-is with no grading shift.",
    cameraLanguage: "Eye-level or slightly above product centre, moderate focal length, product sharp from edge to edge.",
    propPolicy: "No props and no set dressing; the product is the only subject.",
    textPolicy: "No text, badges, watermarks or graphic overlays.",
    negativeRules: [
      "no background scenery or horizon",
      "no colour grading that shifts the product's own colour",
      "no added units, accessories or packaging",
      "no reflective floor tricks that alter the product's apparent shape",
    ],
  },
  {
    id: "premium_editorial",
    label: "杂志质感",
    description: "克制侧光与高级商业摄影",
    category: "editorial",
    compatiblePurposes: ["custom", "white_studio", "detail_closeup"],
    visualStyle: "premium",
    composition: "Editorial still-life with the subject placed off-centre and deliberate negative space.",
    lighting: "Controlled directional side light with a subtle rim highlight and clean shadow falloff.",
    environment: "Restrained single-surface studio set with a tonal backdrop.",
    colorMood: "Muted low-saturation palette with soft neutral mid-tones.",
    cameraLanguage: "Medium focal length, moderate depth of field, subject crisply resolved against a soft background.",
    propPolicy: "At most one neutral non-functional surface element; never an object of the product's own category.",
    textPolicy: "No text, masthead, logo or graphic device.",
    negativeRules: [
      "no material or finish implication",
      "no surface texture the product does not visibly have",
      "no luxury wording rendered as image text",
      "no brand marks",
    ],
  },
  {
    id: "lifestyle_home",
    label: "家居生活",
    description: "自然窗光与真实家庭场景",
    category: "lifestyle",
    compatiblePurposes: ["custom", "usage_steps", "packaging_bundle"],
    visualStyle: "home",
    composition: "Believable in-use placement with realistic scale against the surrounding room.",
    lighting: "Natural window light with soft directional falloff and a believable shadow direction.",
    environment: "Everyday home interior — table, counter or shelf — with restrained, uncluttered dressing.",
    colorMood: "Warm neutral daylight palette that does not tint the product itself.",
    cameraLanguage: "Eye-level three-quarter view with moderate depth of field; product remains the focus.",
    propPolicy: "Only generic unbranded household context that implies no unconfirmed function or extra item.",
    textPolicy: "No text or labels in frame.",
    negativeRules: [
      "no unconfirmed use, action or function",
      "no extra product units in the scene",
      "no branded household objects",
      "no people whose actions imply an unconfirmed feature",
    ],
  },
  {
    id: "outdoor_story",
    label: "户外故事",
    description: "自然环境中的使用叙事",
    category: "lifestyle",
    compatiblePurposes: ["custom", "usage_steps"],
    visualStyle: "outdoor",
    composition: "Environmental storytelling with the product clearly separated from the background.",
    lighting: "Natural daylight, soft directional sun with realistic ambient bounce.",
    environment: "Believable outdoor or travel setting; portable context only when the confirmed facts allow it.",
    colorMood: "Natural outdoor palette, gentle contrast, no heavy stylisation.",
    cameraLanguage: "Slightly lowered eye-level view with moderate depth of field and clear scale cues.",
    propPolicy: "No equipment, gear or accessories beyond what the confirmed facts list.",
    textPolicy: "No text or signage in frame.",
    negativeRules: [
      "no performance, endurance or weather-resistance implication",
      "no environment that implies an unconfirmed use",
      "no extra gear, tools or accessories",
      "no dramatic hero effects that exaggerate size",
    ],
  },
  {
    id: "macro_detail",
    label: "微距细节",
    description: "突出结构、纹理和工艺细节",
    category: "detail",
    compatiblePurposes: ["detail_closeup", "custom"],
    visualStyle: "premium",
    composition: "Macro close-up on a single visibly present detail with a clean diagonal or centred framing.",
    lighting: "Controlled grazing light that reveals form without inventing surface texture.",
    environment: "Neutral seamless backdrop so nothing competes with the detail.",
    colorMood: "Neutral tones with true-to-product colour and soft falloff.",
    cameraLanguage: "Macro perspective, shallow depth of field, focus locked on the confirmed detail.",
    propPolicy: "No props; only the product's own visible surface.",
    textPolicy: "No measurement arrows, callouts or text.",
    negativeRules: [
      "no invented material, grain, coating or finish",
      "no added seams, joints, buttons or parts",
      "no implied craftsmanship or quality wording",
      "no scale cue that implies a different size",
    ],
  },
  {
    id: "feature_board",
    label: "卖点视觉",
    description: "商品主体 + 信息留白",
    category: "information",
    compatiblePurposes: ["selling_point_infographic", "dimension_specification", "usage_steps", "comparison"],
    visualStyle: "minimal",
    composition: "Product-led layout with a clear visual hierarchy and reserved empty annotation zones.",
    lighting: "Even commercial light that keeps the product readable and consistently lit across the frame.",
    environment: "Clean neutral information background with structured spacing.",
    colorMood: "Restrained two-tone palette; accents only in the background, never on the product.",
    cameraLanguage: "Straight-on product view with minimal distortion so proportions stay truthful.",
    propPolicy: "No props; the product plus empty layout zones only.",
    textPolicy: "Leave every annotation zone empty this round — no numbers, icons, certification marks or claim text.",
    negativeRules: [
      "no embedded factual claims, numbers or specification values",
      "no certification, award or ranking icons",
      "no before/after implication",
      "no text rendered into the image",
      "no moodboard or collage grid of several competing layouts",
    ],
  },
  {
    id: "packaging_set",
    label: "套装展示",
    description: "包装、组件和套装规整呈现",
    category: "set",
    compatiblePurposes: ["packaging_bundle", "comparison", "custom"],
    visualStyle: "minimal",
    composition: "Flat-lay or editorial set arrangement of the confirmed items with even spacing and clean hierarchy.",
    lighting: "Soft even overhead light with minimal shadow overlap between items.",
    environment: "Plain neutral surface with no additional set dressing.",
    colorMood: "Neutral background so each confirmed item reads separately.",
    cameraLanguage: "Top-down or high three-quarter view with consistent scale across all items.",
    propPolicy: "Only items the confirmed facts list; never invent packaging, boxes, manuals or accessories.",
    textPolicy: "No printed labels, model numbers or marketing text.",
    negativeRules: [
      "no invented packaging, box or retail sleeve",
      "no extra accessories, units or bundle items",
      "no arrangement that implies a larger quantity",
      "no overlapping that hides how many items are present",
    ],
  },
  {
    id: "campaign_visual",
    label: "Campaign",
    description: "更强主视觉和广告构图",
    category: "campaign",
    compatiblePurposes: ["custom", "selling_point_infographic"],
    visualStyle: "brand_ad",
    composition: "Strong single focal point with a commercial campaign composition and generous negative space for later copy.",
    lighting: "Dramatic but controlled lighting with one clear key and restrained accent light.",
    environment: "Abstract graphic set that supports the focal point without implying a place or use.",
    colorMood: "Bold limited palette with deep contrast, keeping the product's own colour true.",
    cameraLanguage: "Dynamic angle allowed; product still legible and proportionally honest.",
    propPolicy: "No props, no set pieces, no product category look-alikes.",
    textPolicy: "No slogan, logo, tagline, price, promotion banner or fabricated text of any kind.",
    negativeRules: [
      "no logo, wordmark or brand mark",
      "no slogan or fabricated copy",
      "no performance, certification or ranking claim",
      "no competitor identity or look-alike packaging",
      "no effect that changes the product's shape, colour or parts",
      "no multi-panel moodboard or collage grid — one single campaign frame",
    ],
  },
];

export const IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = PRESETS;

export const DEFAULT_IMAGE_STYLE_PRESET_ID: ImageStylePresetId = "amazon_clean_hero";

/** 图片用途 → 默认视觉方向（§20 推荐映射；只做推荐，不覆盖用户显式选择）。 */
export const DEFAULT_IMAGE_STYLE_PRESET_BY_PURPOSE: Record<StudioImagePrimaryPurpose, ImageStylePresetId> = {
  white_studio: "amazon_clean_hero",
  selling_point_infographic: "feature_board",
  dimension_specification: "feature_board",
  detail_closeup: "macro_detail",
  packaging_bundle: "packaging_set",
  usage_steps: "feature_board",
  comparison: "feature_board",
  custom: "premium_editorial",
};

export function isImageStylePresetId(value: unknown): value is ImageStylePresetId {
  return typeof value === "string" && (IMAGE_STYLE_PRESET_IDS as readonly string[]).includes(value);
}

export function getImageStylePreset(id: ImageStylePresetId): ImageStylePreset {
  const preset = PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`unknown_image_style_preset:${id}`);
  return preset;
}

export function imageStylePresetLabel(id: ImageStylePresetId): string {
  return getImageStylePreset(id).label;
}

export function recommendedImageStylePreset(purpose: StudioImagePrimaryPurpose): ImageStylePresetId {
  return DEFAULT_IMAGE_STYLE_PRESET_BY_PURPOSE[purpose] ?? DEFAULT_IMAGE_STYLE_PRESET_ID;
}

export function isImageStylePresetCompatibleWithPurpose(
  id: ImageStylePresetId,
  purpose: StudioImagePrimaryPurpose,
): boolean {
  return getImageStylePreset(id).compatiblePurposes.includes(purpose);
}
