/**
 * Listing 运行时 Skill（R6 closure）
 *
 * 唯一可执行的 Amazon Listing 规则模块：
 * - Prompt 规则：确认事实 + 实际研究参考（NOT FACT 分层）+ 关键词计划；
 *   五点 = 确认事实 → 买家价值/适用场景；禁止编造性能/认证/绝对承诺。
 * - 质量合同（Quality Contract）：3-5 条、完整句、每条 8-30 英文词、逐条事实锚点；
 *   标题品牌不重复；关键词大小写不敏感去重（保序）；描述 2-4 个自然句（每句 >= 6 词）。
 * - 安全兜底：只把已确认事实按安全模板组成完整句（不新增性能声明）；
 *   事实不足（无法组成 >= 3 条合格句）→ ok:false + rejected（中文原因），页面显示「暂无合格草稿」。
 *
 * 纯函数 + 常量；无 DB/网络；同输入同输出。禁止事实门禁/质量门禁各自维护冲突阈值：
 * 生成链（taskLinkedAiListing / 组合 / 兜底）统一引用本模块。
 */

export const LISTING_RUNTIME_SKILL_VERSION = "listing-runtime-skill.v1";

export type RuntimeFact = {
  factId: string;
  field: string;
  label: string;
  value: string;
};

export type RuntimeIssue = { target: string; code: string; message: string };

export type RuntimeQualityInput = {
  title: string;
  bullets: string[];
  description: string;
  keywords: string[];
  facts: RuntimeFact[];
  usedFactIds: string[];
};

export type RuntimeQualityResult = {
  ok: boolean;
  issues: RuntimeIssue[];
  /** 保序、大小写不敏感去重后的关键词（供生成链采用） */
  normalizedKeywords: string[];
};

/* ── Prompt 规则（taskLinkedAiListing 唯一来源） ── */

export function buildRuntimePromptRules(input: {
  keywordOptimizationEnabled: boolean;
  factsCount: number;
  hasPlan: boolean;
}): string {
  return [
    "LISTING_RUNTIME_SKILL = " + LISTING_RUNTIME_SKILL_VERSION,
    "QUALITY_CONTRACT:",
    "- bullets: 3-5 complete sentences; each 8-30 English words; each bullet MUST anchor to at least one confirmed fact value from CONFIRMED_FACTS.",
    "- Feature -> buyer value: anchor on a confirmed fact FIRST, then state the shopper benefit or use context.",
    "- Title: brand appears at most once; no keyword stuffing; no unconfirmed attributes.",
    "- keywords: case-insensitive dedupe, order preserved; never a doubled term such as THERMOS THERMOS.",
    "- description: 2-4 natural sentences (each >= 6 words); never paste attribute fragments.",
    "- Do not fabricate performance/certification/absolute claims (BPA-free, keeps food warm for X hours, guaranteed, best seller, FDA, CE, medical/health).",
    "- Research reference layers are NOT FACT: never turn VOC/competitor/supplier/AI reference content into a product claim.",
    "INPUT_BOUNDS: facts=" + input.factsCount + ", plan=" + (input.hasPlan ? "yes" : "no") + ", keywordOptimization=" + (input.keywordOptimizationEnabled ? "ENABLED" : "DISABLED"),
  ].join("\n");
}

/* ── 质量合同（唯一判定函数） ── */

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentenceList(text: string): string[] {
  // 小数（3.5"L）中的句点不是句子边界：与 Claim Evidence 的 splitSegments 同规则保护，否则描述句数误判。
  const protectedText = text
    .replace(/(\d)\.(\d)/g, "$1__DEC__$2")
    .replace(/\b(approx)\.(?!\s*[0-9]+\s*x)/gi, "$1__DOT__");
  return protectedText
    .split(/[.!?]+/)
    .map((s) => s.trim().replace(/__DEC__/g, ".").replace(/__DOT__/g, "."))
    .filter((s) => s.length > 0);
}

function normalizeKeywordTerm(term: string): string {
  const words = String(term).trim().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out.join(" ");
}

function dedupeKeywordsOrdered(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const norm = normalizeKeywordTerm(item);
    const key = norm.toLowerCase();
    if (!norm || seen.has(key)) continue;
    seen.add(key);
    out.push(norm);
  }
  return out;
}

function valueOf(facts: RuntimeFact[], field: string): string {
  const f = facts.find((x) => x.field === field);
  return f ? String(f.value).trim() : "";
}

function exactWordCount(text: string, needle: string): number {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const key = needle.toLowerCase();
  return words.filter((w) => w === key).length;
}

export function validateRuntimeQualityContract(input: RuntimeQualityInput): RuntimeQualityResult {
  const issues: RuntimeIssue[] = [];
  const facts = input.facts ?? [];
  const used = input.usedFactIds ?? [];
  const usedValues = used
    .map((id) => valueOf(facts, id))
    .concat(used.map((id) => {
      const f = facts.find((x) => x.factId === id || x.field === id);
      return f ? String(f.value).trim() : "";
    }))
    .filter((v) => v.length > 0);

  // 标题品牌重复
  const brand = valueOf(facts, "brand");
  if (brand && exactWordCount(input.title, brand) > 1) {
    issues.push({ target: "title", code: "brand_repeat", message: "标题中品牌词出现了 2 次或以上（不得重复）。" });
  }

  // Bullets
  const bullets = input.bullets ?? [];
  if (bullets.length < 3 || bullets.length > 5) {
    issues.push({ target: "bullets", code: "count", message: "五点数量应为 3-5 条（当前 " + bullets.length + "）。" });
  }
  bullets.forEach((b, index) => {
    const wc = wordCount(b);
    if (wc < 8) {
      issues.push({
        target: "bullets",
        code: wc < 3 ? "fragment" : "too_short",
        message: "Bullet " + (index + 1) + " 不是合格句（" + wc + " 个词，需 8-30 词）。",
      });
    } else if (wc > 30) {
      issues.push({ target: "bullets", code: "too_long", message: "Bullet " + (index + 1) + " 超过 30 词（" + wc + "）。" });
    }
    if (!/[.!?]$/.test(b.trim())) {
      issues.push({ target: "bullets", code: "fragment", message: "Bullet " + (index + 1) + " 不是完整句（缺少句末标点）。" });
    }
    const lower = b.toLowerCase();
    const anchored = usedValues.some((v) => lower.includes(v.toLowerCase()));
    if (!anchored) {
      issues.push({ target: "bullets", code: "no_fact_anchor", message: "Bullet " + (index + 1) + " 未绑定已确认事实值。" });
    }
  });

  // 关键词：大小写不敏感去重 + 保序
  const normalizedKeywords = dedupeKeywordsOrdered(input.keywords ?? []);
  const rawKey = (input.keywords ?? []).map((k) => k.trim().toLowerCase()).join("\u0001");
  const normKey = normalizedKeywords.join("\u0001").toLowerCase();
  if (rawKey !== normKey) {
    issues.push({
      target: "keywords",
      code: "keyword_duplicate",
      message: "关键词存在重复项或词内重复（如 THERMOS THERMOS）；已按大小写不敏感去重并保序。",
    });
  }

  // 描述
  const sentences = sentenceList(input.description ?? "");
  if (sentences.length < 2 || sentences.length > 4) {
    issues.push({
      target: "description",
      code: "description_sentences",
      message: "描述应为 2-4 个自然句（当前 " + sentences.length + " 句）。",
    });
  }
  if (sentences.some((s) => wordCount(s) < 6)) {
    issues.push({
      target: "description",
      code: "description_fragments",
      message: "描述存在属性碎片句（每句至少 6 个词）。",
    });
  }

  // 多样性：bullet 两两高度重复或描述拼 bullet → 拒绝（与旧 validator 同源规则，统一收敛到本模块）
  const wordSet = (text: string) => new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 1));
  const overlapRatio = (a: string, b: string): number => {
    const setA = wordSet(a);
    const wordsB = wordSet(b);
    if (wordsB.size === 0 || setA.size === 0) return 0;
    return [...wordsB].filter((w) => setA.has(w)).length / wordsB.size;
  };
  for (let i = 0; i < bullets.length; i++) {
    for (let j = i + 1; j < bullets.length; j++) {
      if (overlapRatio(bullets[i], bullets[j]) > 0.75) {
        issues.push({ target: "bullets", code: "bullet_duplicate", message: "Bullet " + (i + 1) + " 与 " + (j + 1) + " 高度重复。" });
      }
    }
  }
  if (bullets.length > 0 && overlapRatio(bullets.join(" "), input.description ?? "") > 0.85) {
    issues.push({ target: "description", code: "bullet_concat", message: "描述只是 Bullet 拼接。" });
  }

  return {
    ok: issues.length === 0,
    issues,
    normalizedKeywords,
  };
}

/* ── 安全兜底句（事实模板；无性能声明） ── */

export type SafeFactSentencesInput = {
  typeLabel: string;
  facts: RuntimeFact[];
};

export type SafeFactSentencesResult =
  | { ok: true; sentences: string[] }
  | { ok: false; sentences: string[]; rejected: Array<{ text: string; reason: string }> };

const TEMPLATES: Array<{ field: string; build: (type: string, value: string) => string }> = [
  {
    field: "cleaning",
    build: (type, value) => "The " + value + " option fits for cleaning this " + type + ".",
  },
  {
    field: "functional_feature",
    build: (type, value) => "The " + value + " option fits this " + type + " for everyday use.",
  },
  {
    field: "construction",
    build: (type, value) => "Available with the " + value + " construction for this " + type + ".",
  },
  {
    field: "care",
    build: (type, value) => "Easy cleaning with the " + value + " option for this " + type + ".",
  },
  {
    field: "included_components",
    build: (type, value) => "This " + type + " pairs with the " + value + " for easy use.",
  },
  {
    field: "operation",
    build: (type, value) => "The " + value + " keeps this " + type + " easy to use.",
  },
  {
    field: "usage",
    build: (type, value) => "Everyday use with the " + value + " for this " + type + ".",
  },
];export function buildSafeFactSentences(input: SafeFactSentencesInput): SafeFactSentencesResult {
  const typeLabel = String(input.typeLabel || "product").trim();
  const sentences: string[] = [];
  const rejected: Array<{ text: string; reason: string }> = [];
  const RISKY_MARKETING_WORDS = /(?:leakproof|bpa\s*[- ]?free|guaranteed|100%|fda|ce certified|best seller|self\s*[- ]?sealing|luxury|premium|military|medically|keeps\s*cold|keeps\s*warm|hours\s*cold|pairs with|feel like|safe\s*[- ]?for|non\s*[- ]?to\s*[- ]?xic|spill\s*[- ]?proof|never\s*leaks|no\s*leaks|shockproof|crushproof|slashproof|military\s*[- ]?grade)/i;
  for (const tpl of TEMPLATES) {
    const fact = input.facts.find((f) => f.field === tpl.field && f.value && String(f.value).trim());
    if (!fact) continue;
    const value = String(fact.value).trim();
    if (RISKY_MARKETING_WORDS.test(value)) {
      rejected.push({ text: value.slice(0, 140), reason: "该确认事实值含未确认的营销/性能表述（如防漏、保温、认证、绝对承诺），不进入安全兜底句。" });
      continue;
    }
    const sentence = tpl.build(typeLabel, value);
    const wc = wordCount(sentence);
    if (wc >= 8 && wc <= 30 && /[.!?]$/.test(sentence)) {
      sentences.push(sentence);
    } else {
      rejected.push({ text: sentence, reason: "确认事实值过短，无法组成合格句（8-30 词）。" });
    }
    if (sentences.length >= 5) break;
  }
  if (sentences.length >= 3) {
    return { ok: true, sentences: sentences.slice(0, 5) };
  }
  for (const s of sentences) {
    rejected.push({ text: s, reason: "该句可生成，但事实不足以组成至少 3 条合格句。" });
  }
  if (rejected.length === 0) {
    rejected.push({ text: "", reason: "确认事实不足以组成任何合格句（缺少功能/场景等已确认事实），无法生成草稿。" });
  }
  return { ok: false, sentences: sentences.slice(0, 5), rejected: rejected.slice(0, 5) };
}

/* ── 不变式（生成链统一引用，禁止各自维护阈值） ── */

export const RUNTIME_QUALITY_LIMITS = {
  bulletsMin: 3,
  bulletsMax: 5,
  bulletWordsMin: 8,
  bulletWordsMax: 30,
  descriptionSentencesMin: 2,
  descriptionSentencesMax: 4,
  rejectedDisplayMax: 5,
  rejectedTextMax: 140,
} as const;
