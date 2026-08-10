/**
 * Listing Quality Validator（Quality.1 + R1.4）
 *
 * 保存前 deterministic 校验：
 * - TITLE（R1.4 Amazon 2026 Title Policy）：
 *   - BLOCKING：非空、<=75 chars（Amazon US non-media 硬限，2026-07-27 起）、禁止字符、重复词/stuffing
 *   - ADVISORY：Amazon Ads 建议约 60 chars（titleLengthAdvisory，不阻断）
 * - BULLETS：3-5（资料足够时）、非空、非属性碎片、不与 Title 高度重复、bullet 间不高度重复、禁价格/促销/配送
 * - DESCRIPTION：非空、非 Title 复述、非 Bullet 拼接、相似度不超高
 * - BACKEND SEARCH TERMS：<=250 bytes、去重、不重复 Title 大量词、无明显无效标点
 * - SAFETY：继续由外部 Claim Evidence 负责（本层不重复）
 *
 * 结果结构：blockingIssues（阻止 ai_optimized_listing）/ advisories（仅提示）。
 * 只有 blockingIssues.length > 0 才 ok=false。
 *
 * 纯函数；无 DB/网络；同输入同输出。
 */

const TITLE_HARD_MAX = 75;
const TITLE_ADVISORY_MIN = 60;
const BULLET_MIN = 3;
const BULLET_MAX = 5;
const BULLET_MIN_WORDS = 3;
const BACKEND_MAX_BYTES = 250;

const FORBIDDEN_TITLE_CHARS = /[<>{}\[\]|\\^~@$]/u;
const PRICE_PROMO_DELIVERY = /\b(price|usd|\$|discount|sale|promotion|free shipping|delivery|shipping)\b/i;

export type QualityIssue = { target: string; code: string; message: string };

export type QualityValidationResult = {
  ok: boolean;
  /** 阻止 ai_optimized_listing 的硬失败（向后兼容：issues 即 blockingIssues） */
  blockingIssues: QualityIssue[];
  issues: QualityIssue[];
  /** 仅提示，不阻断 */
  advisories: QualityIssue[];
};

export type QualityCheckInput = {
  titles: string[];
  bullets: string[];
  description: string;
  backendSearchTerms: string[];
  planQuality: "optimized" | "safe_fact_draft";
};

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function repeatedWordStuffed(text: string): boolean {
  const words = text.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  // 任一非功能词出现 >=3 次 → 疑似 stuffing
  return [...counts.values()].some((c) => c >= 3);
}

function overlapRatio(a: string, b: string): number {
  const wordsA = new Set(a.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 1));
  const wordsB = b.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (wordsB.length === 0 || wordsA.size === 0) return 0;
  return wordsB.filter((w) => wordsA.has(w)).length / wordsB.length;
}

export function validateListingQuality(input: QualityCheckInput): QualityValidationResult {
  const blockingIssues: QualityIssue[] = [];
  const advisories: QualityIssue[] = [];
  const title = input.titles[0] ?? "";
  const t = title.trim();

  // ── TITLE（R1.4：Hard Policy 与 Advisory 分离）──
  if (!t) blockingIssues.push({ target: "title", code: "empty", message: "标题为空。" });
  else {
    if (t.length > TITLE_HARD_MAX) blockingIssues.push({ target: "title", code: "too_long", message: `标题超过 ${TITLE_HARD_MAX} 字符硬限（Amazon US non-media 2026 政策）。` });
    if (t.length > 0 && t.length < TITLE_ADVISORY_MIN && input.planQuality === "optimized") {
      advisories.push({ target: "title", code: "titleLengthAdvisory", message: `Amazon Ads 建议标题约 ${TITLE_ADVISORY_MIN} 字符（当前 ${t.length}）；仅为优化建议，不阻断。` });
    }
    if (FORBIDDEN_TITLE_CHARS.test(t)) blockingIssues.push({ target: "title", code: "forbidden_chars", message: "标题含 Amazon 禁止字符。" });
    if (repeatedWordStuffed(t)) blockingIssues.push({ target: "title", code: "keyword_stuffing", message: "标题疑似关键词堆砌。" });
  }

  // ── BULLETS ──
  const bullets = input.bullets.map((b) => b.trim()).filter(Boolean);
  if (input.planQuality === "optimized" && (bullets.length < BULLET_MIN || bullets.length > BULLET_MAX)) {
    blockingIssues.push({ target: "bullets", code: "count", message: `优化 Listing 需要 ${BULLET_MIN}-${BULLET_MAX} 条（当前 ${bullets.length}）。` });
  }
  bullets.forEach((b, i) => {
    if (wordCount(b) < BULLET_MIN_WORDS) {
      blockingIssues.push({ target: "bullets", code: "fragment", message: `Bullet ${i + 1} 只是属性碎片（少于 ${BULLET_MIN_WORDS} 个词）。` });
    }
    if (PRICE_PROMO_DELIVERY.test(b)) blockingIssues.push({ target: "bullets", code: "price_promo", message: `Bullet ${i + 1} 含价格/促销/配送内容。` });
  });
  if (t && bullets.length > 0 && overlapRatio(t, bullets[0]) > 0.6) {
    blockingIssues.push({ target: "bullets", code: "title_duplicate", message: "首条 Bullet 与 Title 高度重复。" });
  }
  for (let i = 0; i < bullets.length; i++) {
    for (let j = i + 1; j < bullets.length; j++) {
      if (overlapRatio(bullets[i], bullets[j]) > 0.6) {
        blockingIssues.push({ target: "bullets", code: "bullet_duplicate", message: `Bullet ${i + 1} 与 ${j + 1} 高度重复。` });
      }
    }
  }

  // ── DESCRIPTION ──
  const desc = input.description.trim();
  if (!desc) blockingIssues.push({ target: "description", code: "empty", message: "描述为空。" });
  else {
    if (t && overlapRatio(t, desc) > 0.7) blockingIssues.push({ target: "description", code: "title_duplicate", message: "描述只是标题复述。" });
    if (bullets.length > 0) {
      const joined = bullets.join(" ");
      if (overlapRatio(joined, desc) > 0.85) blockingIssues.push({ target: "description", code: "bullet_concat", message: "描述只是 Bullet 拼接。" });
    }
    if (wordCount(desc) < 8 && input.planQuality === "optimized") blockingIssues.push({ target: "description", code: "too_short", message: "优化描述需要完整句子。" });
  }

  // ── BACKEND SEARCH TERMS ──
  if (input.backendSearchTerms.length > 0) {
    const joined = input.backendSearchTerms.join(" ");
    const bytes = Buffer.byteLength(joined, "utf8");
    if (bytes > BACKEND_MAX_BYTES) blockingIssues.push({ target: "backend_search_terms", code: "too_long", message: `Backend Search Terms 超过 ${BACKEND_MAX_BYTES} bytes（当前 ${bytes}）。` });
    if (t) {
      const titleWords = new Set(t.toLocaleLowerCase().split(/\s+/).filter((w) => w.length > 1));
      const repeatCount = input.backendSearchTerms.filter((term) => titleWords.has(term.toLocaleLowerCase())).length;
      if (repeatCount > input.backendSearchTerms.length * 0.5 && input.backendSearchTerms.length >= 3) {
        blockingIssues.push({ target: "backend_search_terms", code: "title_repeat", message: "Backend Search Terms 大量重复 Title 已有词。" });
      }
    }
  }

  return {
    ok: blockingIssues.length === 0,
    blockingIssues,
    issues: blockingIssues,
    advisories,
  };
}
