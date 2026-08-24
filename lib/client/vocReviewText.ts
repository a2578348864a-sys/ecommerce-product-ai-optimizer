/**
 * VOC 评论展示文本清洁（R6 收口 + 修复）
 *
 * 纯函数：只处理用户可见的"评论原文"展示文本——
 * 1) 有界两轮规范化：先安全解码常见 HTML 实体，再移除 HTML 标签/头像片段（如 <img src="...">）；
 * 2) 移除被 2000 字符截断的未闭合标签尾部（<img src=... 无 ">")，不残留 img/avatar/尺寸参数；
 * 3) 清理多余空格与异常前缀（换行/制表/首尾空白）；
 * 4) 清理后为空时 isEmptyReviewText 返回 true（显示占位文案）。
 *
 * 另含"历史英文业务分析"纯函数（hasEnglishSentence / hasEnglishBusinessAnalysis）：
 * 只扫描 AI 生成的业务分析字段；商品名、品牌、ASIN、型号、单位、日期、评论原文等原始信息不单独触发。
 *
 * 不修改数据库中的原始评论，不修改证据引用；禁止 dangerouslySetInnerHTML。
 */

/** 安全解码常见 HTML 实体（仅白名单实体；不做任意嵌套解码） */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
    "&nbsp;": " ",
    "&apos;": "'",
  };
  return text.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp|apos);/g, (match) => entities[match] ?? match);
}

/**
 * 移除 HTML 标签以及未闭合标签尾部（截断场景）。
 * - 完整标签（含跨行属性/自闭合/大小写）：/<[^<>]*>/g
 * - 未闭合尾部：从最后一个 "<" + 字母 到末尾（如 <img src="https://... 被截断）；
 *   仅匹配「< 后紧跟字母」的片段，避免误伤 "<3"、"< 数字"、"x < b" 等普通文本。
 */
function stripDisplayTags(text: string): string {
  const noTags = text.replace(/<[^<>]*>/g, " ");
  return noTags.replace(/<[A-Za-z][^<>]*$/, " ");
}

/**
 * 清洗评论展示文本（R6 修复：先解码后剥标签的有界两轮规范化）：
 * - 第 1 轮：解码实体 → 剥标签（&lt;img&gt; 解码成 <img> 后立即移除，不会以字面量残留）；
 * - 第 2 轮：兜底双层实体（&amp;lt;img → 第 1 轮解码成 &lt;img → 第 2 轮解码成 <img → 剥除）；
 * - 每轮同时移除未闭合标签尾部（2000 字符截断场景）；
 * - 最后移除 Markdown/URL 图片残留并压缩空白。
 */
export function cleanReviewDisplayText(raw: string | null | undefined): string {
  const source = typeof raw === "string" ? raw : "";
  if (!source) return "";
  let current = source;
  for (let round = 0; round < 2; round++) {
    current = decodeHtmlEntities(current);
    current = stripDisplayTags(current);
  }
  const noImages = current.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  return noImages.replace(/\s+/g, " ").trim();
}

/** 清洗后是否无可用文字内容 */
export function isEmptyReviewText(cleaned: string): boolean {
  return cleaned.length === 0;
}

/* ── 历史英文业务分析判定（R6 修复） ── */

/**
 * 判断单个字段是否为「中文之外的英文句子」：
 * - 含中文（CJK 扩展区）→ 视为中文内容，false（中文业务句夹带品牌/ASIN/单位安全）；
 * - 先剔除英文月份日期片段（April 23 / 2026-08-19），日期不单独触发；
 * - 剩余 ≥2 个英文单词（每词 ≥2 字母）且总字母 ≥6 → true；
 * - 单个品牌/型号/ASIN/单位 token（THERMOS / FUNTAINER / B08NCVT244 / 10 oz）→ false。
 */
export function hasEnglishSentence(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  if (!text) return false;
  if (/[\u3400-\u9fff]/.test(text)) return false;
  const deDated = text
    .replace(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?/gi, " ")
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, " ");
  const words = deDated.match(/[A-Za-z]{2,}/g) || [];
  const letters = words.reduce((sum, word) => sum + word.length, 0);
  return words.length >= 2 && letters >= 6;
}

/** 主题扫描目标（结构化子集；组件视图类型可直接赋值） */
export type VocEnglishScanTheme = {
  label: string;
  summary: string;
  limitations: string | null;
};

/** 冲突扫描目标（结构化子集） */
export type VocEnglishScanConflict = {
  label: string;
  summary: string;
  note: string | null;
};

/** 历史英文识别扫描输入（全部为 AI 生成的业务分析字段） */
export type VocEnglishScanInput = {
  themes: {
    positiveThemes: VocEnglishScanTheme[];
    painPointThemes: VocEnglishScanTheme[];
    usageScenarios: VocEnglishScanTheme[];
    recurringRequests: VocEnglishScanTheme[];
    weakSignals: VocEnglishScanTheme[];
    conflicts: VocEnglishScanConflict[];
  };
  unknowns: string[];
  nextResearchSteps: string[];
};

/**
 * 扫描全部默认可见的 AI 业务分析字段；任一字段「含英文句子且无中文」→ true（历史英文）。
 * 不扫描：评论原文、商品身份、ASIN、品牌、单位、日期、runId/model/hash 等原始信息。
 */
export function hasEnglishBusinessAnalysis(input: VocEnglishScanInput): boolean {
  const themes = input?.themes;
  if (!themes) return false;
  const themeLists: VocEnglishScanTheme[][] = [
    themes.positiveThemes,
    themes.painPointThemes,
    themes.usageScenarios,
    themes.recurringRequests,
    themes.weakSignals,
  ];
  for (const list of themeLists) {
    for (const theme of list ?? []) {
      if (hasEnglishSentence(theme.label)
        || hasEnglishSentence(theme.summary)
        || hasEnglishSentence(theme.limitations)) {
        return true;
      }
    }
  }
  for (const conflict of themes.conflicts ?? []) {
    if (hasEnglishSentence(conflict.label)
      || hasEnglishSentence(conflict.summary)
      || hasEnglishSentence(conflict.note)) {
      return true;
    }
  }
  if ((input.unknowns ?? []).some((item) => hasEnglishSentence(item))) return true;
  if ((input.nextResearchSteps ?? []).some((item) => hasEnglishSentence(item))) return true;
  return false;
}
