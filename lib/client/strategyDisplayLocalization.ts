/**
 * 策略展示层中文化映射工具 (Strategy Display Localization)
 *
 * 仅用于 UI 展示层，不改变任何数据结构、存储或后端生成链路。
 */

const TARGET_AUDIENCE_MAP: Record<string, string> = {
  "shoppers seeking a simpler everyday routine": "追求日常使用更省心便捷的实用型买家",
  "shoppers comparing practical product options": "对比日常实用生活用品的精明买家",
  "shoppers comparing practical daily-use options": "对比日常高频使用产品的精明买家",
  "family shoppers seeking reliable essentials": "注重品质与可靠耐用的家庭买家",
  "commuters needing compact hydration": "注重轻量便携的通勤与出行买家",
  "parents seeking safe school lunch essentials": "注重安全健康与耐用性的学生家长",
};

export function localizeTargetAudience(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (TARGET_AUDIENCE_MAP[lower]) return TARGET_AUDIENCE_MAP[lower];
  for (const [pattern, translation] of Object.entries(TARGET_AUDIENCE_MAP)) {
    if (lower.includes(pattern)) return translation;
  }
  if (lower.includes("simpler everyday")) return "追求日常使用更省心便捷的实用型买家";
  if (lower.includes("comparing practical")) return "对比日常实用生活用品的精明买家";
  if (lower.includes("family") || lower.includes("parents")) return "注重安全与耐用的家庭买家";
  if (lower.includes("kids") || lower.includes("children")) return "注重安全便携的儿童用品买家";
  if (lower.includes("outdoor") || lower.includes("travel")) return "户外出行与旅行便携买家";
  return "追求日常实用与可靠品质的消费者";
}

const PURCHASE_MOTIVATION_MAP: Record<string, string> = {
  "clear everyday value": "看重明确的日常实用价值与性价比",
  "keep everyday spaces organized": "保持日常空间整洁有序、便于收纳",
  "make everyday sipping convenient": "日常饮水/吸管使用更顺畅便捷",
  "keep routines simple to manage": "日常携带与打理更简单省心",
  "feel confident carrying the product": "出行随身携带更安心、密封防漏",
  "trust it to hold up in daily use": "日常使用坚固耐用、经久抗摔",
  "get the size right for the space": "尺寸规格精准贴合实际使用空间",
  "know how much it holds": "容量明确充足，满足日常分量需求",
  "keep it easy to clean": "结构易拆好洗，清洁保养省力",
  "get it set up without fuss": "开箱即用，无需繁琐安装与调试",
  "match the look they want": "外观颜值符合审美与搭配预期",
  "get the colour they expected": "实物色彩真实，符合视觉预期",
  "see the value for the price": "物有所值，性价比符合预期",
  "work as a gift": "包装与品质适合作贴心礼品",
};

export function localizePurchaseMotivation(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (PURCHASE_MOTIVATION_MAP[lower]) return PURCHASE_MOTIVATION_MAP[lower];
  for (const [pattern, translation] of Object.entries(PURCHASE_MOTIVATION_MAP)) {
    if (lower.includes(pattern)) return translation;
  }
  if (lower.includes("leak") || lower.includes("spill")) return "出行随身携带更安心、密封防漏";
  if (lower.includes("clean") || lower.includes("dishwasher")) return "结构易拆好洗，清洁保养省力";
  if (lower.includes("durab") || lower.includes("sturdy")) return "日常使用坚固耐用、经久抗摔";
  if (lower.includes("carry") || lower.includes("portable")) return "日常携带与出行更简单省心";
  if (lower.includes("capacity") || lower.includes("hold")) return "容量规格清晰明确，满足日常需求";
  if (lower.includes("size") || lower.includes("dimension")) return "尺寸规格适中，便于收纳携带";
  return "看重明确的日常实用价值与可靠品质";
}

export function localizePrimaryAngle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (/make .+ easier to understand and use/i.test(lower)) {
    return "聚焦商品核心规格与随附配件，让买家一眼看清实用价值与适用场景";
  }
  if (lower.includes("highlight verified physical specifications")) {
    return "突出已核验的物理规格与真实使用体验";
  }
  if (lower.includes("easy comparison")) return "清晰对比核心规格优势";
  if (lower.includes("simple setup")) return "直观易懂的使用方式";
  if (lower.includes("routine fit")) return "无缝契合日常生活节奏";
  return "聚焦商品核心规格与配件，帮助买家明确选购决策";
}

const TONE_MAP: Record<string, string> = {
  "clear": "清晰明确",
  "practical": "实用务实",
  "shopper-focused": "聚焦买家关切",
  "informative": "信息详实",
  "concise": "简练直接",
  "benefit-led": "卖点突出",
  "professional": "专业可信",
  "casual": "亲切自然",
  "friendly": "亲和友好",
  "objective": "客观严谨",
  "honest": "真实诚恳",
  "reassuring": "安心可靠",
};

export function localizeTone(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (TONE_MAP[lower]) return TONE_MAP[lower];
  return "清晰务实";
}

const USE_CASE_MAP: Record<string, string> = {
  "everyday use": "日常高频使用",
  "confident carrying the product": "随身携带与外出通勤",
  "routines simple to manage": "日常便携打理",
  "everyday sipping convenient": "日常饮水与便携饮用",
  "everyday spaces organized": "桌面与居家收纳整理",
  "it to hold up in daily use": "日常高频使用",
  "the size right for the space": "背包与午餐包收纳摆放",
  "how much it holds": "一人份餐食或饮品盛装",
  "it easy to clean": "洗碗机或日常手洗清洁",
  "it set up without fuss": "开箱即用与随身携带",
  "the look they want": "个性搭配与送礼场景",
  "the colour they expected": "日常搭配使用",
  "the value for the price": "日常高性价比代步使用",
  "as a gift": "节日礼品与开学送礼",
  "school lunch": "学校带餐与午餐",
  "office lunch": "办公室带餐与日常通勤",
};

export function localizeUseCase(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (USE_CASE_MAP[lower]) return USE_CASE_MAP[lower];
  for (const [pattern, translation] of Object.entries(USE_CASE_MAP)) {
    if (lower.includes(pattern)) return translation;
  }
  if (lower.includes("lunch") || lower.includes("school")) return "上学带餐与午餐日常";
  if (lower.includes("commute") || lower.includes("travel")) return "外出通勤与出行携带";
  if (lower.includes("carry")) return "日常随身携带";
  return "日常居家与外出便携";
}

const AVOID_CLAIM_MAP: Record<string, string> = {
  "unsupported performance or certification": "未经核查的性能承诺或虚假认证（如绝对防漏、保冷保热时长、官方认证等）",
  "absolute guarantees": "绝对化极限词与保证性承诺（如 100%、绝对、完美、终身）",
  "competitor wording": "提及竞品品牌名称、侵权商标或直接对比贬低",
  "do not make absolute claims.": "严禁虚构未确认的商品事实与极限夸大承诺",
  "unverified marketing claims": "未经验证的营销夸大宣传",
  "subjective praise": "主观臆造的褒奖夸大用语",
};

export function localizeAvoidClaim(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (AVOID_CLAIM_MAP[lower]) return AVOID_CLAIM_MAP[lower];
  for (const [pattern, translation] of Object.entries(AVOID_CLAIM_MAP)) {
    if (lower.includes(pattern)) return translation;
  }
  if (lower.includes("competitor")) return "提及竞品品牌名称或侵权商标";
  if (lower.includes("guarantee") || lower.includes("absolute")) return "绝对化极限词与保证性承诺";
  if (lower.includes("unsupported") || lower.includes("certification")) return "未经核查的性能承诺或虚假认证";
  return "避免夸大、未经核验的事实声明或侵权词汇";
}

export function localizeStrategyList(
  list: unknown,
  localizer: (item: string) => string
): string {
  if (!Array.isArray(list)) return "";
  const items = list
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .map(localizer)
    .filter(Boolean);
  return items.join("、");
}

const BENEFIT_ROLE_MAP: Record<string, string> = {
  core_outcome: "核心成效",
  pain_relief: "痛点纾解",
  use_scenario: "使用场景",
  ease_of_use: "简易操作",
  proof_or_fit: "规格佐证",
};

export function localizeBenefitRole(role: unknown): string {
  if (typeof role !== "string" || !role.trim()) return "";
  const trimmed = role.trim();
  return BENEFIT_ROLE_MAP[trimmed] ?? trimmed;
}

const INTENT_STAGE_MAP: Record<string, string> = {
  awareness: "认知阶段",
  consideration: "对比考量期",
  decision: "决策期",
  purchase_ready: "购买决断期",
};

export function localizeIntentStage(stage: unknown): string {
  if (typeof stage !== "string" || !stage.trim()) return "";
  const trimmed = stage.trim();
  return INTENT_STAGE_MAP[trimmed] ?? trimmed;
}

