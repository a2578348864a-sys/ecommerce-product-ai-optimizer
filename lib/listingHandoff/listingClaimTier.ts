/**
 * 轮 16：Claim 三级判定（verified / review / blocked）。
 *
 * 用于 AI 输出服务端门禁与 UI 人工审核辅助：
 * - verified：句内每个硬属性提及（材质/容量/规格/认证/耐用/防水/兼容等）
 *   均可在已确认事实值中找到对应事实（单位归一化后），无新增硬属性；
 * - review：明确依附已确认功能的低风险价值表达（如已确认 cord storage 后的"收纳方便"），
 *   保留在草稿并标"需人工确认表达"（AI 起草、人工判断）；
 * - blocked：无事实支持的新增硬属性（材质/尺寸/容量/认证/耐用/防水/防漏/兼容性/效果/
 *   比较级/绝对承诺），从可复制成品移除并列出原因（沿用 unsupportedClaims）。
 *
 * 纯函数：无 DB/网络；同输入同输出。
 */

export type ClaimTier = "verified" | "review" | "blocked";

export type TieredClaim = {
  text: string;
  tier: ClaimTier;
  /** blocked 原因（blocked 时非空；review 时提示人工确认） */
  reason: string | null;
};

/** 硬属性信号词（无对应事实 → blocked） */
const HARD_PROPERTY_HINTS: RegExp[] = [
  /\b(stainless steel|plastic|ceramic|glass|aluminum|silicone|bpa.free|phthalate.free|non.toxic)\b/i,
  /\b(\d+\s*(oz|ml|l|liter|gal|lb|kg|gram|inches|inch|cm|mm|qt|cups?))\b/i,
  /\b(dimension|capacity|weight|size)\b/i,
  /\b(certified|certification|fda|ul|csa|ce|rohs|gmp|organic)\b/i,
  /\b(waterproof|leakproof|spill.proof|spill.resistant|leak.resistant|water.resistant|durable|long.lasting|rust.free|heat.resistant|scratch.resistant|non.stick)\b/i,
  /\b(compatible|compatibility|works with|fits)\b/i,
  /\b(best|guaranteed|guarantee|no.1|#1|top.rated|premium.quality|medical.grade)\b/i,
  /\b(effective|improves|reduces|prevents|heals|treats|cures)\b/i,
];

/** 依附已确认功能的低风险价值表达特征（非硬属性） */
const REVIEW_FRAMING_HINTS: RegExp[] = [
  /\b(convenient|easy to|keeps?|makes? .+ easy|handy|tidy|clutter.free|compact|ready to use|mess.free)\b/i,
  /\b(great for|ideal for|perfect for|suited for|good for)\b/i,
  /\b(simple|quick|cares? for)\b/i,
];

/**
 * 单位归一化：把 "12 oz / 12 ounce / 12 ounces / 12oz" 等写成同一形态，
 * 使已确认事实值（如 "12 ounces"）与文案提及（如 "12 ounce"）可相互匹配。
 * 仅影响数字+单位；不影响其余文本。
 */
export function canonicalizeUnits(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/\b(\d+)\s*(ounces?|oz)\b/g, "$1 oz")
    .replace(/\b(\d+)\s*(gallons?|gal)\b/g, "$1 gal")
    .replace(/\b(\d+)\s*(milliliters?|ml)\b/g, "$1 ml")
    .replace(/\b(\d+)\s*(liters?|l)\b/g, "$1 l")
    .replace(/\b(\d+)\s*(pounds?|lb)\b/g, "$1 lb")
    .replace(/\b(\d+)\s*(kilograms?|kg)\b/g, "$1 kg")
    .replace(/\b(\d+)\s*(grams?|g)\b/g, "$1 g")
    .replace(/\b(\d+)\s*(inches?|in)\b/g, "$1 in")
    .replace(/\b(\d+)\s*(centimeters?|cm)\b/g, "$1 cm")
    .replace(/\b(\d+)\s*(millimeters?|mm)\b/g, "$1 mm")
    .replace(/\b(\d+)\s*(qt|cups?)\b/g, "$1 qt");
}

/** 句内所有硬属性提及（单位归一化后逐条提取，尽量保留原始提及形态） */
function hardMentions(claimCanonical: string): string[] {
  const mentions: string[] = [];
  for (const re of HARD_PROPERTY_HINTS) {
    const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
    const g = new RegExp(re.source, flags);
    let m: RegExpExecArray | null;
    while ((m = g.exec(claimCanonical)) !== null) {
      const hit = m[0].trim();
      if (hit) mentions.push(hit);
      if (m.index === g.lastIndex) g.lastIndex += 1;
    }
  }
  return mentions;
}

/** 尺寸/规格类提及词（本身不是事实值，取决于句中是否有已确认的数值规格） */
const DIMENSION_WORDS = /^(dimensions?|capacity|weight|size)$/;

/**
 * 对一组 Claim 句做三级分类。
 * @param supported 已通过 verifyListingClaims 的句子（无 unsupported）
 * @param confirmedValues 已确认事实的小写值集（用于 verified 判定；单位归一化后匹配）
 */
export function classifyClaimTier(
  supported: string[],
  confirmedValues: string[],
): TieredClaim[] {
  const values = confirmedValues.map((v) => canonicalizeUnits(v)).filter(Boolean);
  return supported.map((text) => {
    const lower = text.toLowerCase();
    const canonical = canonicalizeUnits(lower);
    // 1) 含硬属性信号 → 逐提及校验：每个硬属性提及都须有已确认事实值支撑 →
    //    verified；任一提及无支撑 → blocked（含修饰/绝对/疗效词）。
    //    尺寸/规格类提及词（size/capacity/weight/dimension）以句中已确认数值规格为准。
    const hardHit = HARD_PROPERTY_HINTS.find((re) => re.test(lower));
    if (hardHit) {
      const mentions = hardMentions(canonical);
      const hasBackedNumeric = mentions.some((m) => /\d/.test(m) && values.some((v) => v.includes(m) || m.includes(v)));
      const allBacked = mentions.length > 0 && mentions.every((m) => {
        if (DIMENSION_WORDS.test(m)) return hasBackedNumeric || values.some((v) => v.includes(m) || m.includes(v));
        return values.some((v) => v.includes(m) || m.includes(v));
      });
      if (allBacked) {
        return { text, tier: "verified", reason: null };
      }
      return { text, tier: "blocked", reason: "无已确认事实支持的新增硬属性/承诺" };
    }
    // 2) 事实锚点：句子必须"明确包含已确认事实值"——已确认值的连续短语（≥2 词的
    //    连续片段，或 ≤2 词值的全部词）在句中出现；任意词重叠不算锚点。
    //    无锚点 → blocked（未支持内容不得默认 verified/review）。
    const hasAnchor = values.some((v) => {
      const vTokens = v.split(/\s+/).filter((w) => w.length > 1);
      if (vTokens.length === 0) return false;
      if (vTokens.length === 1) {
        return canonical.includes(vTokens[0]);
      }
      if (canonical.includes(v)) return true;
      for (let start = 0; start + 1 < vTokens.length; start++) {
        const phrase = vTokens.slice(start, start + 2).join(" ");
        if (canonical.includes(phrase)) return true;
      }
      return false;
    });
    // 3) 依附已确认功能的低风险价值表达 → review（必须同时含明确事实锚点；AI 起草、人工判断）
    const reviewHit = REVIEW_FRAMING_HINTS.some((re) => re.test(lower));
    if (reviewHit && hasAnchor) {
      return { text, tier: "review", reason: "依附已确认功能的价值表达，请人工确认" };
    }
    // 4) 无事实锚点（未支持内容）→ blocked：不进入可复制结果
    if (!hasAnchor) {
      return { text, tier: "blocked", reason: "无已确认事实锚点的泛化表达" };
    }
    // 5) 其余（含锚点的事实陈述）→ verified
    return { text, tier: "verified", reason: null };
  });
}
