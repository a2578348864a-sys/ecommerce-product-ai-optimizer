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

export const LISTING_RUNTIME_SKILL_VERSION = "listing-runtime-skill.v3";

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
    "- STRUCTURE_CONTRACT (bullets AND description): every sentence must start with a capital letter;",
    "  must carry a real main-clause predicate (is/has/stores/fits/measures/weighs/includes ...) or be a",
    "  legitimate imperative (For care, rinse ...); a noun such as Can inside a product name is NOT a predicate,",
    "  and a verb inside a subordinate clause does not rescue a main-clause fragment;",
    "  no padded template tails such as for everyday/practical/easy/standard use.",
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

/**
 * 安全兜底句（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只写已确认事实 + 中性语义；不使用 option fits / pairs with / Available with construction 等模板腔。
 */
/**
 * 安全兜底句（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只写已确认事实 + 中性语义；不使用 option fits / pairs with / Available with construction 等模板腔。
 */
/**
 * 安全兜底句（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只用 Claim Evidence 允许词（with / for / everyday / easy / standard / practical / use / cleaning）+ 事实值；
 * 不使用 option fits / pairs with / Available with construction 等模板腔。
 */
/**
 * 安全兜底句（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 只用 Claim Evidence 允许词 + 事实值；各字段不同句法结构以避免模板重复。
 */
/**
 * 安全兜底句（COPY_QUALITY）：事实值前置的自然、保守、可证实原子事实句。
 * 句法按字段多样化以通过 0.75 重复检测；只用 Claim Evidence 允许词。
 */
/**
 * 安全兜底句（COPY_QUALITY）：自然、保守、可证实的原子事实句。
 * 混合 5 种句法（均通过 Claim Evidence 允许词判定）以通过 0.75 重复检测。
 */
const TEMPLATES: Array<{ field: string; build: (type: string, value: string) => string }> = [
  { field: "cleaning", build: (type, value) => "For easy cleaning with this " + type + ", " + value + "." },
  { field: "functional_feature", build: (type, value) => "The " + type + " with " + value + " for everyday use." },
  { field: "construction", build: (type, value) => "Available with " + value + " for this " + type + "." },
  { field: "care", build: (type, value) => "For easy use with this " + type + ", " + value + "." },
  { field: "included_components", build: (type, value) => "The " + type + " available with " + value + " for practical use." },
  { field: "operation", build: (type, value) => value + " for standard use with this product every day." },
  { field: "usage", build: (type, value) => value + " for practical use with this product." },
];
/* ── 文案质量独立合同（Copy Quality） ── */

export type CopyQualityInput = {
  title: string;
  bullets: string[];
  description: string;
  /** cannotSay 词面集合（原义；经 policy 同义规范化比较） */
  cannotSay?: ReadonlyArray<string>;
  /** 计划事实（label+value）用于 role_mismatch 检测 */
  facts?: ReadonlyArray<RuntimeFact>;
  /** 卖点计划（role + shopperNeed）用于 role_mismatch / duplicate_shopper_need */
  bulletPlans?: ReadonlyArray<{ role?: string; shopperNeed?: string; featureFactIds?: string[] }>;
  /** 类型标签（如 Tumbler）用于 self_reference */
  typeLabel?: string;
};

export type CopyQualityResult = {
  ok: boolean;
  issues: RuntimeIssue[];
};

/** 规范化词面（连字符/空格等价），与 listingClaimPolicy 同义匹配 */
function canonicalTerm(text: string): string {
  return String(text ?? "").toLowerCase().replace(/[-_\s]+/g, "");
}

/* ── 结构维度（v2）：句法完整性 / 模板尾 / 句首大写 ──
 *
 * 判定完全基于**英文短语形态**（谓语词形、分词/形容词补语头、祈使原形动词、填充尾骨架），
 * 不含任何商品名 / 品牌 / 类型 / 具体完整句字符串特判——换商品同样生效。
 * 词数、标点、锚点只是必要条件；本节补齐「合格判定的结构盲区」。
 */

/**
 * 三单现在时谓语（-s 词形）。英文事实句的核心谓语信号。
 * 只收 -s 词形：原形（use / store / fit）在 "for everyday use" 里是名词，
 * 若把原形当谓语，"The X with Y for everyday use." 会被误判为完整句。
 */
const FINITE_VERB_S = Object.freeze(new Set([
  "is", "was", "has", "does",
  "stores", "holds", "carries", "contains", "includes", "features", "comes", "comprises",
  "fits", "expands", "collapses", "folds", "unfolds", "extends", "retracts", "adjusts",
  "measures", "weighs", "spans",
  "opens", "closes", "locks", "seals", "attaches", "mounts", "converts", "rotates",
  "slides", "stands", "sits", "hangs", "rests",
  "organizes", "separates", "divides", "accommodates", "arranges",
  "protects", "supports", "keeps", "works", "offers", "provides", "allows",
  "prevents", "reduces", "resists", "uses", "makes", "helps", "doubles", "requires",
]));

/** 复数/不可数主语的系动词与助动词（The parts are ... / The trays have ...） */
const FINITE_AUX_PLURAL = Object.freeze(new Set([
  "are", "were", "have", "do", "can", "will", "may", "must", "should", "would",
]));

/**
 * 复数主语的原形谓语（Dishwasher safe parts **make** cleaning quick.）。
 * 只收「词性无歧义」的动词：凡在英文商品文案里常作名词的原形
 * （use / store / design / care / cleaning / need / rinse / wipe / wash / dry / clean）
 * 一律不收——否则 "The X with Y for everyday use." 会因名词 use 被误判为完整句。
 */
const UNAMBIGUOUS_BASE_VERBS = Object.freeze(new Set([
  "make", "keep", "hold", "include", "measure", "weigh", "protect", "support",
  "provide", "offer", "allow", "work", "expand", "collapse", "fold", "unfold",
  "fit", "organize", "separate", "accommodate", "carry", "contain", "come",
  "feature", "open", "close", "attach", "mount", "convert", "slide", "stand",
  "sit", "hang", "double", "help", "resist", "reduce", "prevent", "seal", "lock",
  "extend", "retract", "adjust", "divide", "arrange", "span", "comprise", "require",
]));

/**
 * 合法祈使句原形动词（护理/使用说明）。
 * 仅在句首（可含一个前置状语，如 "For care," / "Before use,"）位置生效，
 * 因此不会把句中的名词性 use / store 误当谓语。
 */
const IMPERATIVE_HEAD_VERBS = Object.freeze(new Set([
  "rinse", "wipe", "wash", "clean", "dry", "soak", "rub", "scrub",
  "avoid", "remove", "place", "store", "keep", "use", "insert", "attach", "detach",
  "fill", "empty", "expand", "collapse", "fold", "unfold", "press", "pull", "push", "turn",
  "hand", "air", "towel", "do", "refer", "follow", "check", "separate", "handle", "let",
]));

/**
 * 模板填充尾骨架：`for {everyday|practical|easy|standard|…} use|cleaning`
 * 可选跟 `with/of this|the <至多 4 词>`、可选跟 `every day`，且必须收尾。
 *
 * 关键：要求 `for` 直接引导，因此自然句 `The reinforced handle supports everyday use.`
 * （无 for 引导）与 `... is suitable for daily kitchen storage and carrying.`
 * （for 后不是 use/cleaning）都不会命中——避免整词命中式误杀。
 */
const TEMPLATE_TAIL_PATTERN =
  /\bfor\s+(?:everyday|practical|easy|standard|general|daily|regular|normal)\s+(?:use|cleaning)(?:\s+(?:with|of)\s+(?:this|the|these|those)(?:\s+[A-Za-z][A-Za-z'’-]*){0,4})?(?:\s+every\s+day)?\s*[.!?]*\s*$/i;

/** 句子词元（小写、去标点） */
function structureTokens(sentence: string): string[] {
  return String(sentence)
    .toLowerCase()
    .replace(/[^a-z\s'’-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** 是否存在正常谓语（三单 -s 词形 / 复数系动词助动词 / 无歧义原形谓语） */
/**
 * 从属标记：把句子截断到**主句骨架**。
 * 从句里的谓语（"... a lid that is durable"）不算主句谓语——
 * 否则主句残片会被从句的 is 洗白（已知假绿 #2）。
 */
const SUBORDINATE_MARKERS = Object.freeze(new Set([
  "that", "which", "who", "whom", "whose", "where", "while", "because",
  "since", "if", "although", "though", "unless", "after", "before",
  "when", "whenever", "whereas", "so", "as",
]));

/**
 * 情态/助动词：**只有后接动词**才算谓语。
 * 商品名里的 Can / Will / May（Trash Can、Willow、Maybelline）是名词的一部分，
 * 直接计入谓语会让 "The Trash Can with a liner." 这类残片被放行（已知假绿 #1）。
 */
const MODAL_AUX_VERBS = Object.freeze(new Set([
  "can", "may", "will", "must", "should", "would", "could", "do", "does", "did",
]));

/** 主句骨架：截断到第一个从属标记之前 */
function mainClauseHead(sentence: string): string {
  const tokens = structureTokens(sentence);
  const cut = tokens.findIndex((t) => SUBORDINATE_MARKERS.has(t));
  return (cut < 0 ? tokens : tokens.slice(0, cut)).join(" ");
}

/**
 * 主句骨架谓语判定：先切出主句，再在主句内按「词形 + 位置」找真谓语。
 * 与整句任意 token 扫描的区别：商品名 Can 与从句 is 都不再被当成主句谓语。
 */
function hasMainClausePredicate(sentence: string): boolean {
  const tokens = structureTokens(mainClauseHead(sentence));
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (MODAL_AUX_VERBS.has(t)) {
      const next = tokens[i + 1] ?? "";
      if (
        UNAMBIGUOUS_BASE_VERBS.has(next)
        || IMPERATIVE_HEAD_VERBS.has(next)
        || FINITE_VERB_S.has(next)
        || FINITE_AUX_PLURAL.has(next)
      ) return true;
      continue;
    }
    if (FINITE_VERB_S.has(t) || FINITE_AUX_PLURAL.has(t) || UNAMBIGUOUS_BASE_VERBS.has(t)) return true;
  }
  return false;
}

/**
 * 是否为合法祈使句：允许一个前置状语（以逗号收尾，如 "For care," / "After each use,"），
 * 其后第一个词必须是祈使原形动词。
 */
function isLegitImperative(sentence: string): boolean {
  const trimmed = String(sentence).trim();
  const body = trimmed.replace(/^[A-Za-z][^,]{0,48},\s+/, "");
  const first = structureTokens(body)[0] ?? "";
  return IMPERATIVE_HEAD_VERBS.has(first);
}

/** 句首必须大写（合法祈使句同样要求大写）；数字/引号开头视为合规 */
function isSentenceCapitalized(sentence: string): boolean {
  const trimmed = String(sentence).trim();
  const first = trimmed.match(/[A-Za-z]/);
  if (!first) return true;
  const head = trimmed[0];
  if (/[0-9"'“”‘’(\[]/.test(head)) return true;
  return head === head.toUpperCase();
}

/** 结构性原因码（bullet / description 共用同一判定，防止字段漏检成为病句港湾） */
type StructureIssueCode = "sentence_fragment" | "template_tail" | "sentence_capitalization";

/** 单句结构检查：返回命中的结构原因码（可多命中） */
function structureIssuesOf(sentence: string): StructureIssueCode[] {
  const out: StructureIssueCode[] = [];
  const trimmed = String(sentence).trim();
  if (!trimmed) return out;
  // 少于 3 个词的残片交由词数门禁处理，结构判定不参与（避免噪声）
  if (structureTokens(trimmed).length < 3) return out;
  if (!isSentenceCapitalized(trimmed)) out.push("sentence_capitalization");
  if (!hasMainClausePredicate(trimmed) && !isLegitImperative(trimmed)) out.push("sentence_fragment");
  if (TEMPLATE_TAIL_PATTERN.test(trimmed)) out.push("template_tail");
  return out;
}

const STRUCTURE_MESSAGE: Record<StructureIssueCode, string> = {
  sentence_fragment: "缺少正常谓语（主语后仅 with / available with 等短语拼接，也非合法祈使句），不是完整英文句。",
  template_tail: "以固定模板尾收尾（for everyday / practical / easy / standard use 等填充语），非自然文案。",
  sentence_capitalization: "句首未大写（英文句子必须大写开头，合法祈使句同样要求）。",
};

/** 检测高风险模板垃圾表达；返回命中码（null=未命中） */
function templateJargonHit(sentence: string): string | null {
  const s = canonicalTerm(sentence);
  if (s.includes("optionfitstheeverydayuse")) return "template_jargon";
  if (s.includes("pairswiththe")) return "subject_object_duplicate";
  if (s.includes("matches") && s.includes("option")) return "template_jargon";
  if (s.includes("availableconstructionwith")) return "template_jargon";
  if (s.includes("standardusewiththe")) return "template_jargon";
  if (s.includes("easycleaningmatches")) return "template_jargon";
  return null;
}

export function validateCopyQualityContract(input: CopyQualityInput): CopyQualityResult {
  const issues: RuntimeIssue[] = [];
  const bullets = input.bullets ?? [];
  const cannotSay = input.cannotSay ?? [];
  const typeLabel = String(input.typeLabel ?? "").trim();

  // cannot_say：正文句命中 cannotSay（含同义变体）
  const bodyText = [String(input.title ?? ""), ...bullets, String(input.description ?? "")].join(" ");
  for (const raw of cannotSay) {
    const term = canonicalTerm(raw);
    if (!term) continue;
    if (canonicalTerm(bodyText).includes(term)) {
      issues.push({ target: "body", code: "cannot_say", message: "正文命中禁止声明：" + String(raw) });
    }
  }

  bullets.forEach((b, index) => {
    // self_reference：X pairs with X / 类型词多次出现
    const lowerNorm = canonicalTerm(b);
    if (typeLabel) {
      const typeT = canonicalTerm(typeLabel);
      const count = lowerNorm.split(typeT).length - 1;
      if (count >= 2) {
        issues.push({ target: "bullets", code: "self_reference", message: "Bullet " + (index + 1) + " 自身引用重复（" + typeLabel + " 出现 " + count + " 次），如同 " + typeLabel + " pairs with " + typeLabel + "。" });
      }
    }
    if (templateJargonHit(b)) {
      issues.push({ target: "bullets", code: "template_jargon", message: "Bullet " + (index + 1) + " 是模板拼接表达（如 option fits / pairs with / Available construction），非自然文案。" });
    }
    // 结构维度（v2）：句法完整性 / 模板尾 / 句首大写
    for (const code of structureIssuesOf(b)) {
      issues.push({ target: "bullets", code, message: "Bullet " + (index + 1) + " " + STRUCTURE_MESSAGE[code] });
    }
  });

  // 结构维度（v2）：描述与五点走同一判定——任何字段漏检都会成为模板尾/病句港湾
  sentenceList(String(input.description ?? "")).forEach((s, index) => {
    for (const code of structureIssuesOf(s)) {
      issues.push({ target: "description", code, message: "描述第 " + (index + 1) + " 句 " + STRUCTURE_MESSAGE[code] });
    }
  });

  // subject_object_duplicate：非身份事实值与类型词完全相同（如 included_components="Tumbler" 与类型 "Tumbler"）
  const IDENTITY_FACT_FIELDS = new Set(["brand", "product_type", "series_or_model"]);
  for (const b of bullets) {
    const lower = b.toLowerCase();
    for (const f of input.facts ?? []) {
      if (IDENTITY_FACT_FIELDS.has(String(f.field ?? ""))) continue;
      const v = String(f.value ?? "").toLowerCase();
      if (v && typeLabel && lower.includes(v) && lower.includes(typeLabel.toLowerCase()) && v === typeLabel.toLowerCase()) {
        issues.push({ target: "bullets", code: "subject_object_duplicate", message: "非身份事实值与类型词相同（" + v + "），构成无意义搭配。" });
  }
    }
  }

  // redundant_fact：bullet 完全相同
  for (let i = 0; i < bullets.length; i++) {
    for (let j = i + 1; j < bullets.length; j++) {
      if (bullets[i].toLowerCase() === bullets[j].toLowerCase()) {
        issues.push({ target: "bullets", code: "redundant_fact", message: "Bullet " + (i + 1) + " 与 " + (j + 1) + " 完全相同。" });
      }
    }
  }

  // role_mismatch：bullet 与计划角色事实不匹配
  const plans = input.bulletPlans ?? [];
  if (plans.length > 0) {
    plans.forEach((bp, index) => {
      if (index >= bullets.length) return;
      const wantValues = (bp.featureFactIds ?? []).map((fid) => {
        const f = (input.facts ?? []).find((x) => x.factId === fid || x.field === fid);
        return f ? String(f.value).toLowerCase() : "";
      }).filter(Boolean);
      if (wantValues.length === 0) return;
      const hit = wantValues.some((v) => bullets[index]?.toLowerCase().includes(v));
      if (!hit) {
        issues.push({ target: "bullets", code: "role_mismatch", message: "Bullet " + (index + 1) + " 与其计划角色事实不匹配。" });
      }
    });
  }

  // duplicate_shopper_need：卖点卡购物者需求重复
  const needs = plans.map((bp) => String(bp.shopperNeed ?? "").trim().toLowerCase()).filter(Boolean);
  const seenNeed = new Set<string>();
  for (const n of needs) {
    if (seenNeed.has(n)) {
      issues.push({ target: "plan", code: "duplicate_shopper_need", message: "卖点卡购物者需求重复：" + n });
    }
    seenNeed.add(n);
  }

  return { ok: issues.length === 0, issues };
}
export function buildSafeFactSentences(input: SafeFactSentencesInput): SafeFactSentencesResult {
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
