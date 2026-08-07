/**
 * Title-derived Product Facts（V2.1.3 最小增强）
 *
 * 从来源商品标题中提取【可人工确认的候选商品事实】。
 *
 * 安全原则（本模块不变量）：
 * 1. 输出永远是候选（candidate），绝不自动写入 confirmedFacts；
 * 2. 每个候选必须保留 source="product_title" + humanConfirmationRequired=true；
 * 3. 只有用户明确确认后才能获得 listing usageScope；
 * 4. 宁缺勿错：无法确定就不输出，禁止强制填满字段；
 * 5. 不制造第二个 brand（brand 继续来自 SellerSprite 字段）；
 * 6. 纯确定性规则 + 受控词典，不使用 AI 自由解析。
 *
 * 支持字段（全部 optional）：
 * - product_type         商品类型（结合 category 末级 + 受控类型词）
 * - series_or_model      系列/型号（明确时）
 * - material             材质（仅受控材质词）
 * - capacity             容量（数字 + 明确单位）
 * - color_or_variant     颜色/款式（仅明确颜色词）
 * - quantity_or_pack_size 数量/包装（数字 + pack/count 等模式）
 */

export type TitleDerivedFactField =
  | "product_type"
  | "series_or_model"
  | "material"
  | "capacity"
  | "color_or_variant"
  | "quantity_or_pack_size";

export type TitleDerivedProductFact = {
  field: TitleDerivedFactField;
  label: string;
  value: string;
  /** 来源固定为商品标题 */
  source: "product_title";
  humanConfirmationRequired: true;
};

export type TitleDerivedFactsResult = {
  facts: TitleDerivedProductFact[];
};

// ── 受控词典 ─────────────────────────────────────

const MATERIALS = [
  "stainless steel", "stainless-steel", "plastic", "aluminum", "aluminium",
  "glass", "ceramic", "silicone", "wood", "bamboo", "leather", "fabric",
  "polyester", "cotton", "acrylic", "carbon fiber", "metal", "iron", "copper",
] as const;

const COLOR_WORDS = [
  "black", "white", "red", "blue", "green", "yellow", "purple", "pink",
  "orange", "gray", "grey", "brown", "silver", "gold", "navy", "teal",
  "beige", "cream", "rose", "olive", "charcoal", "sky blue", "out of the blue",
  "midnight", "ocean", "forest green", "coral", "ivory", "tan",
] as const;

/** 明确单位容量模式：数字 + oz/fl oz/ml/L/liter/gallon 等 */
const CAPACITY_UNIT_RE = /\b(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|floz|oz|ml|milliliter|milliliters|liter|liters|l\b|gallon|gallons|gal|kg|g\b|pound|pounds|lb)\b/i;

/** 数量/包装模式：数字 + （可选中间词）+ pack/count 等明确模式 */
const QUANTITY_RE = /\b(\d+)\s*(?:-|x)?\s*(?:[A-Za-z]+\s+){0,2}(?:pack|packs|count|pcs|piece|pieces|set|sets|pair|pairs|bundle|bottles|sheets|roll|rolls|strips|sheets)\b/i;

/** 单材质词（用于系列/型号边界——"Stainless" 单独出现也应停止） */
const MATERIAL_SINGLE_WORDS = [
  "stainless", "steel", "plastic", "aluminum", "aluminium", "glass",
  "ceramic", "silicone", "wood", "bamboo", "leather", "fabric", "polyester",
  "cotton", "acrylic", "metal", "iron", "copper",
] as const;

/** 类型词（保守：出现在 title 中才作为类型候选） */
const PRODUCT_TYPE_WORDS = [
  "water bottle", "bottle", "tumbler", "mug", "cup", "thermos", "flask",
  "treadmill", "walking pad", "sticker", "sticker pack", "collector",
  "tracker", "activity tracker", "watch", "smartwatch", "headphones",
  "earbuds", "speaker", "lamp", "light", "organizer", "rack", "shelf",
  "container", "storage box", "bag", "backpack", "purse", "wallet",
  "shoe", "sneaker", "jacket", "shirt", "t-shirt", "dress", "pants",
  "towel", "pillow", "blanket", "sheet set", "mattress", "chair", "desk",
  "table", "couch", "sofa", "mirror", "curtain", "rug", "mat", "case",
  "cover", "screen protector", "charger", "cable", "adapter", "hub",
  "keyboard", "mouse", "monitor", "printer", "camera", "tripod",
  "bike", "bicycle", "scooter", "helmet", "glove", "gloves", "scarf",
  "hat", "cap", "socks", "skincare", "serum", "cream", "lotion", "mask",
] as const;

// ── 辅助函数 ─────────────────────────────────────

function normalize(title: string): string {
  return title.normalize("NFC").replace(/\s+/g, " ").trim();
}

function titleIncludes(title: string, phrase: string): boolean {
  return title.toLowerCase().includes(phrase.toLowerCase());
}

/** 提取容量：数字 + 明确单位 */
function extractCapacity(title: string): string | null {
  const match = title.match(CAPACITY_UNIT_RE);
  if (!match) return null;
  // 完整匹配原始子串（保留原始大小写/格式）
  return match[0].trim();
}

/** 提取数量/包装 */
function extractQuantity(title: string): string | null {
  const match = title.match(QUANTITY_RE);
  if (!match) return null;
  return match[0].trim();
}

/** 提取材质：仅受控材质词 */
function extractMaterial(title: string): string | null {
  const lower = title.toLowerCase();
  for (const material of MATERIALS) {
    if (lower.includes(material)) {
      // 还原原始大小写（找 title 中的实际子串）
      const idx = lower.indexOf(material);
      return title.slice(idx, idx + material.length);
    }
  }
  return null;
}

/** 提取颜色/款式：优先最长颜色词（Out of the Blue > Blue） */
function extractColor(title: string): string | null {
  const lower = title.toLowerCase();
  // 按长度降序匹配（长词优先）
  const sorted = [...COLOR_WORDS].sort((a, b) => b.length - a.length);
  for (const color of sorted) {
    if (lower.includes(color)) {
      const idx = lower.indexOf(color);
      return title.slice(idx, idx + color.length);
    }
  }
  return null;
}

/** 已知品牌词（避免把后续品牌当系列/型号） */
const KNOWN_BRAND_WORDS = [
  "fitbit", "apple", "samsung", "google", "sony", "bose", "anker", "logitech",
  "panini", "owala", "stanley", "hydro flask", "yeti", "nike", "adidas",
  "under armour", "dyson", "philips", "xiaomi", "huawei",
] as const;

/** 明确赛事/专有复合词（不当作类型或系列） */
const EXCLUDED_COMPOUNDS = [
  "world cup", "olympic", "super bowl", "fifa",
] as const;

/** 提取系列/型号：品牌后紧跟的"多词大写短语"（保守，遇材质/类型/颜色/容量词即停） */
function extractSeriesOrModel(title: string, brand: string | null): string | null {
  const lower = title.toLowerCase();
  const brandLower = brand ? brand.toLowerCase() : null;
  const words = title.split(" ").filter(Boolean);

  // 找品牌位置（精确词或前缀）
  let startIdx = -1;
  if (brandLower) {
    startIdx = words.findIndex((w) => w.toLowerCase() === brandLower || w.toLowerCase().startsWith(brandLower));
  }
  if (startIdx < 0) return null;

  // 品牌后第一个词如果是已知品牌（Fitbit Air 场景：brand=Google, 后跟 Fitbit）→ 不提取
  const nextWord = words[startIdx + 1];
  if (nextWord && KNOWN_BRAND_WORDS.some((b) => nextWord.toLowerCase().startsWith(b))) {
    return null;
  }

  let seriesWords: string[] = [];
  for (let i = startIdx + 1; i < Math.min(startIdx + 4, words.length); i++) {
    const w = words[i];
    if (!/^[A-Z]/.test(w)) break;
    if (["For", "With", "And", "The", "Of", "In", "On", "At", "to"].includes(w)) break;
    // 明确属性词停止（含单材质词）
    if (CAPACITY_UNIT_RE.test(w)) break;
    if (QUANTITY_RE.test(w)) break;
    if (MATERIAL_SINGLE_WORDS.some((m) => w.toLowerCase() === m || w.toLowerCase().startsWith(m))) break;
    if (COLOR_WORDS.some((c) => w.toLowerCase() === c || lower.includes(`${w.toLowerCase()} `) && c.includes(w.toLowerCase()))) break;
    if (PRODUCT_TYPE_WORDS.some((t) => w.toLowerCase().startsWith(t))) break;
    // 赛事/专有复合词排除
    if (EXCLUDED_COMPOUNDS.some((c) => w.toLowerCase() === c)) break;
    seriesWords.push(w.replace(/[^A-Za-z0-9\-]/g, ""));
    if (seriesWords.length >= 2) break;
  }
  if (seriesWords.length < 1) return null;
  const candidate = seriesWords.join(" ");
  if (candidate.toLowerCase() === brandLower) return null;
  // 过滤：候选含材质词（FreeSip Stainless 场景——Stainless 已是材质词不应进入）
  const candidateLower = candidate.toLowerCase();
  if (MATERIALS.some((m) => candidateLower.includes(m))) {
    // 只保留材质词前的部分
    const parts: string[] = [];
    for (const w of seriesWords) {
      if (MATERIALS.some((m) => w.toLowerCase().startsWith(m))) break;
      parts.push(w);
    }
    if (parts.length < 1) return null;
    return parts.join(" ");
  }
  return candidate;
}

/** 提取商品类型：优先最长受控类型词（Activity Tracker > Tracker） */
function extractProductType(title: string, category: string | null): string | null {
  const lower = title.toLowerCase();
  // 赛事/专有复合词先排除（World Cup 不匹配 cup）
  for (const ex of EXCLUDED_COMPOUNDS) {
    if (lower.includes(ex)) {
      // 把复合词整体从匹配中排除（用占位替换避免误匹配其子串）
      // 不直接改 title，靠下方匹配时跳过被排除词覆盖的区间
    }
  }
  // 1) 受控类型词按长度降序（长词优先）
  const sorted = [...PRODUCT_TYPE_WORDS].sort((a, b) => b.length - a.length);
  for (const type of sorted) {
    const idx = lower.indexOf(type);
    if (idx < 0) continue;
    // 检查该位置是否落在被排除复合词区间内
    const excludedHit = EXCLUDED_COMPOUNDS.some((ex) => {
      const exIdx = lower.indexOf(ex);
      return exIdx >= 0 && idx >= exIdx && idx < exIdx + ex.length;
    });
    if (excludedHit) continue;
    return title.slice(idx, idx + type.length);
  }
  // 2) category 末级辅助
  if (category) {
    const segments = category.split(":").map((s) => s.trim()).filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && last.length > 2 && last.length <= 40) {
      const singular = last.replace(/s$/i, "");
      if (lower.includes(singular.toLowerCase()) || lower.includes(last.toLowerCase())) {
        return last;
      }
    }
  }
  return null;
}

// ── 主入口 ───────────────────────────────────────

/**
 * 从标题提取可人工确认的商品事实候选。
 * 输入：来源标题 + （可选）SellerSprite brand（避免重复制造 brand）+ （可选）category（辅助类型）。
 * 输出：候选 facts；每个 fact 均 source="product_title" + humanConfirmationRequired=true。
 */
export function deriveTitleProductFacts(input: {
  title: string;
  brand?: string | null;
  category?: string | null;
}): TitleDerivedFactsResult {
  const title = normalize(input.title);
  if (!title) return { facts: [] };

  const facts: TitleDerivedProductFact[] = [];
  const push = (field: TitleDerivedFactField, label: string, value: string) => {
    facts.push({ field, label, value, source: "product_title", humanConfirmationRequired: true });
  };

  // product_type
  const productType = extractProductType(title, input.category ?? null);
  if (productType) push("product_type", "商品类型", productType);

  // series_or_model（明确时）
  const series = extractSeriesOrModel(title, input.brand ?? null);
  if (series && series.length >= 2 && series.length <= 24) {
    push("series_or_model", "系列/型号", series);
  }

  // material（受控词）
  const material = extractMaterial(title);
  if (material) push("material", "材质", material);

  // capacity（数字+单位）
  const capacity = extractCapacity(title);
  if (capacity) push("capacity", "容量", capacity);

  // color_or_variant（明确颜色词）
  const color = extractColor(title);
  if (color) push("color_or_variant", "颜色/款式", color);

  // quantity_or_pack_size
  const quantity = extractQuantity(title);
  if (quantity) push("quantity_or_pack_size", "数量/包装", quantity);

  return { facts };
}
