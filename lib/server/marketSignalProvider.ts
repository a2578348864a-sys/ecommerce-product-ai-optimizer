import "server-only";

import {
  MARKET_SIGNAL_KIND_LABELS,
  buildMarketSignalSet,
  emptyMarketSignalSet,
  stripSignalHtmlTags,
  type MarketSignalDraft,
  type MarketSignalSet,
} from "@/lib/marketSignal";
import { prisma } from "@/lib/server/db";

/**
 * Opportunity Analysis Spike — V2 `marketSignalProvider`
 *
 * 要验的唯一问题：**系统自动取到的信号，能不能达到 V1 手动粘贴的效果。**
 *
 * 定位（对应 V2 任务的「优先级 A：已有数据可以按关键词/品类关联 → 直接增加查询层」）：
 * - 把**已有研究任务**里已经存在的真实证据，转换成 V1 已定义的统一 marketSignal 格式。
 * - 输入：商品方向 / keyword / candidate。
 * - 输出：{ type, text, score?, source, createdAt? } 形态的信号草稿（编号由共享构建器分配）。
 *
 * 铁律（与 V1 一致，不放松）：
 * - **不抓取、不联网、不写库**：只读本机 SQLite 里已存在的证据。
 * - 信号原文一律视为 UNTRUSTED DATA，只进 AI 的 user 数据字段。
 * - 每一条自动信号都必须带 `source`（哪个任务、哪类证据），否则前端与 AI 无法追溯，
 *   就退化成「AI 编造数据」，与 V1 的防编造门禁冲突。
 * - 关联不到证据时**返回空**并说明原因，绝不退化为「让 AI 自己编」。
 *
 * 关联依据（审计结论，见报告）：
 * - `ViralAnalysisRecord.id` 即 taskId；证据挂在 `resultJson` 的
 *   `reviewEvidence` / `vocAnalysis` / `keywordEvidence` / `competitorEvidence` 命名空间下。
 * - `ViralAnalysisRecord.title` / `materialText` 承载商品名，可直接按关键词匹配。
 * - `OpportunityCandidate.convertedTaskId` 提供「候选 → 任务」的直达链路。
 */

/* ── 常量 ── */

export const PROVIDER_MAX_TOKENS = 12;
export const PROVIDER_MAX_TASKS = 3;
export const PROVIDER_DEFAULT_MAX_ITEMS = 24;
export const PROVIDER_MIN_TASK_SCORE = 3;
export const PROVIDER_COARSE_FETCH_LIMIT = 40;

/** 单个任务内各类证据的取用上限（按价值排序取，先取到的优先保留编号）。 */
export const PROVIDER_PER_TASK_LIMITS = {
  painPoint: 5,
  recurringRequest: 2,
  review: 3,
  keyword: 3,
  competitor: 2,
} as const;

/**
 * 浏览器采集的评论会混入页面框架文本
 * （例如「5 星（最高 5 星）…在…发布评论…已确认购买」）。
 * 这类文本不是用户观点，直接当信号会污染 AI 判断 —— 命中任一标记即整条丢弃。
 * 标记只挑**不会出现在真实评论里**的界面文案，避免误杀。
 */
export const REVIEW_NOISE_MARKERS = [
  "星（最高",   // 评分控件的可访问性文本
  "发布评论",   // 列表页「发表于」标签
  "已确认购买", // 购买凭证标签
] as const;

/** 抓取附加在评论尾部的规格元数据（`Color: X Size: Y`），不属于用户观点。 */
const VARIANT_TAIL_PATTERN = /\s*(?:Color|Colour|颜色)\s*[:：][\s\S]{0,60}?(?:Size|尺寸)\s*[:：][\s\S]{0,40}$/i;

/** 停止词：不参与匹配，避免「the / 的」这类词把所有任务都命中。 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "to", "by", "at",
  "is", "are", "be", "as", "it", "this", "that", "from", "my", "your",
  "的", "了", "和", "与", "或", "在", "是", "这", "那",
]);

/** 匹配权重：命中标题/商品名最可信，关键词次之，短词最弱。 */
const WEIGHT_TITLE = 3;
const WEIGHT_KEYWORD_STRONG = 3;
const WEIGHT_KEYWORD_WEAK = 1;

const CJK_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/* ── 类型 ── */

export type MarketSignalProviderInput = {
  /** 商品方向（必填）：例如「insulated water bottle」「午餐盒」。 */
  direction: string;
  /** 额外关键词（可选），与 direction 一起参与分词。 */
  keyword?: string | null;
  /** 指定候选（可选）：命中时通过 convertedTaskId 直达对应任务，不依赖文本匹配。 */
  candidateId?: string | null;
  maxTasks?: number;
  maxItems?: number;
};

/** 一条已存在的研究任务快照（只读）。 */
export type EvidenceTaskSnapshot = {
  taskId: string;
  title: string;
  materialText: string;
  updatedAt: string;
  resultJson: string;
};

export type EvidenceTaskMatch = {
  taskId: string;
  title: string;
  updatedAt: string;
  score: number;
  matchedTokens: string[];
  /** 命中的字段面：标题 / 关键词 / 翻译 / 候选直达 */
  matchedSurfaces: string[];
  reviewCount: number;
  hasVoc: boolean;
  hasKeywordEvidence: boolean;
  hasCompetitorEvidence: boolean;
};

export type MarketSignalProviderSource = {
  taskId: string;
  title: string;
  matchedTokens: string[];
  matchedSurfaces: string[];
  score: number;
  signalCount: number;
  reviewCount: number;
};

export type MarketSignalProviderOutcome = {
  /**
   * 去重、截断、编号后的最终信号集 —— 唯一可信的条数来源。
   * 注意不能用 drafts.length：去重会减少条数，两者不一致会把「24 条」这种错误数字展示给用户。
   */
  set: MarketSignalSet;
  sources: MarketSignalProviderSource[];
  /** ok=取到信号；no_direction=方向为空/无有效词；no_match=有方向但无匹配任务；no_evidence=匹配到任务但任务里没有可用证据 */
  reason: "ok" | "no_direction" | "no_match" | "no_evidence";
  /** 本次实际参与打分的任务数 */
  scannedTaskCount: number;
  /** 库内已有研究任务总数（用于前端如实说明检索范围） */
  totalTaskCount: number;
  /** 通过关键词匹配上的任务数（含候选直达） */
  matchedTaskCount: number;
  tokens: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseResultJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/* ── 分词 ── */

/**
 * 把商品方向切成匹配词。
 *
 * - 拉丁文按非字母数字切分，长度 ≥2 才保留（`insulated water bottle` → 3 个词）。
 * - 中日韩文本按整段 + 滑动二字词切分：整段用于精确命中关键词翻译，
 *   二字词用于命中「户外露营用品 → 露营桌」这类部分重合。
 * - 去停止词、去重、上限 12 个，避免把 SQL 条件撑爆。
 */
export function tokenizeDirection(raw: string): string[] {
  const source = asText(raw).toLowerCase();
  if (!source.trim()) return [];

  const tokens: string[] = [];
  const push = (value: string) => {
    const token = value.trim();
    if (!token) return;
    if (token.length < 2) return;
    if (STOPWORDS.has(token)) return;
    if (tokens.includes(token)) return;
    tokens.push(token);
  };

  for (const segment of source.split(/[^\p{L}\p{N}]+/u)) {
    if (!segment) continue;
    if (!CJK_PATTERN.test(segment)) {
      push(segment);
      continue;
    }
    push(segment);
    if (segment.length >= 4) {
      for (let index = 0; index + 2 <= segment.length; index += 1) {
        push(segment.slice(index, index + 2));
      }
    }
  }

  return tokens.slice(0, PROVIDER_MAX_TOKENS);
}

/* ── 打分 ── */

type KeywordRow = { keyword: string; keywordTranslation: string | null };

function readKeywordRows(parsed: Record<string, unknown>): KeywordRow[] {
  const evidence = parsed.keywordEvidence;
  if (!isRecord(evidence) || !Array.isArray(evidence.rows)) return [];
  const rows: KeywordRow[] = [];
  for (const raw of evidence.rows) {
    if (!isRecord(raw)) continue;
    const keyword = asText(raw.keyword).trim();
    if (!keyword) continue;
    const translation = asText(raw.keywordTranslation).trim();
    rows.push({ keyword, keywordTranslation: translation || null });
  }
  return rows;
}

/** 命中即返回该 token 的权重；未命中返回 0。 */
function matchWeight(haystack: string, token: string): number {
  const target = haystack.toLowerCase();
  if (!target) return 0;
  if (target === token) return WEIGHT_KEYWORD_STRONG;
  if (!target.includes(token)) return 0;
  return token.length >= 4 ? WEIGHT_KEYWORD_STRONG : WEIGHT_KEYWORD_WEAK;
}

/**
 * 给一条已有任务打分。
 *
 * 分值语义：≥ `PROVIDER_MIN_TASK_SCORE` 才认为「这条任务的证据与用户问的方向有关」。
 * 返回 null 表示不相关 —— 宁可不给信号，也不给错信号。
 */
export function scoreEvidenceTask(
  task: EvidenceTaskSnapshot,
  tokens: readonly string[],
): EvidenceTaskMatch | null {
  if (tokens.length === 0) return null;
  const parsed = parseResultJson(task.resultJson);
  const keywordRows = readKeywordRows(parsed);

  const title = `${task.title} ${task.materialText}`.toLowerCase();
  const matchedTokens = new Set<string>();
  const matchedSurfaces = new Set<string>();
  let score = 0;

  for (const token of tokens) {
    let hit = false;

    if (matchWeight(title, token) > 0) {
      score += WEIGHT_TITLE;
      matchedSurfaces.add("标题/商品名");
      hit = true;
    }

    for (const row of keywordRows) {
      const keywordHit = matchWeight(row.keyword, token);
      const translationHit = row.keywordTranslation ? matchWeight(row.keywordTranslation, token) : 0;
      if (keywordHit > 0 || translationHit > 0) {
        score += Math.max(keywordHit, translationHit);
        matchedSurfaces.add(translationHit > 0 && keywordHit === 0 ? "关键词翻译" : "关键词");
        hit = true;
      }
    }

    if (hit) matchedTokens.add(token);
  }

  if (score < PROVIDER_MIN_TASK_SCORE) return null;

  const reviewEvidence = parsed.reviewEvidence;
  const reviews = isRecord(reviewEvidence) && isRecord(reviewEvidence.dataset) && Array.isArray(reviewEvidence.dataset.reviews)
    ? reviewEvidence.dataset.reviews
    : [];

  return {
    taskId: task.taskId,
    title: asText(task.title).trim() || task.taskId,
    updatedAt: task.updatedAt,
    score,
    matchedTokens: [...matchedTokens],
    matchedSurfaces: [...matchedSurfaces],
    reviewCount: reviews.length,
    hasVoc: isRecord(parsed.vocAnalysis),
    hasKeywordEvidence: keywordRows.length > 0,
    hasCompetitorEvidence: isRecord(parsed.competitorEvidence),
  };
}

/* ── 证据 → 信号 ── */

function shortTitle(title: string): string {
  const trimmed = title.trim() || "未命名任务";
  return trimmed.length <= 22 ? trimmed : `${trimmed.slice(0, 22)}…`;
}

function sourceLabel(title: string, kindLabel: string): string {
  return `已有研究任务《${shortTitle(title)}》· ${kindLabel}`;
}

/**
 * 清洗浏览器采集的评论原文：
 * 1) 去掉 HTML 标签；2) 去掉抓取附加的规格尾巴（`Color: X Size: Y`）；3) 压缩空白。
 */
export function cleanReviewText(value: string): string {
  return stripSignalHtmlTags(asText(value))
    .replace(VARIANT_TAIL_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 命中页面框架文案的评论不是用户观点，整条丢弃。 */
export function isNoisyReviewText(value: string): boolean {
  return REVIEW_NOISE_MARKERS.some((marker) => value.includes(marker));
}

function readMonthlySearches(row: Record<string, unknown>): number | null {
  const fields = row.fields;
  if (!isRecord(fields)) return null;
  const metric = fields.monthlySearches;
  if (!isRecord(metric)) return null;
  const candidate = typeof metric.normalized === "number" && Number.isFinite(metric.normalized)
    ? metric.normalized
    : Number(asText(metric.raw));
  // 0 / 非有限值一律视为「平台未提供」——宁可不显示，也不显示一个会被误读的 0。
  if (!Number.isFinite(candidate) || candidate <= 0) return null;
  return candidate;
}

type VocThemeLike = {
  label: string;
  summary: string;
  reviewCount: number;
  strength: string;
};

function readVocThemes(parsed: Record<string, unknown>, bucket: string): VocThemeLike[] {
  const voc = parsed.vocAnalysis;
  if (!isRecord(voc) || !isRecord(voc.themes)) return [];
  const list = voc.themes[bucket];
  if (!Array.isArray(list)) return [];
  const themes: VocThemeLike[] = [];
  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const label = asText(raw.label).trim();
    if (!label) continue;
    themes.push({
      label,
      summary: asText(raw.summary).trim(),
      reviewCount: typeof raw.reviewCount === "number" ? raw.reviewCount : 0,
      strength: asText(raw.strength) || "isolated",
    });
  }
  return themes;
}

const STRENGTH_LABELS: Record<string, string> = {
  isolated: "个别提及",
  weak: "少量提及",
  recurring: "反复出现",
};

/** 一条 VOC 主题 → 信号草稿。 */
function vocThemeToDraft(
  theme: VocThemeLike,
  title: string,
  kindLabel: string,
  createdAt: string | undefined,
): MarketSignalDraft {
  const strength = STRENGTH_LABELS[theme.strength] ?? theme.strength;
  const count = theme.reviewCount > 0 ? `${theme.reviewCount} 条评论${strength}` : strength;
  const body = theme.summary ? `${theme.label}：${theme.summary}` : theme.label;
  return {
    kind: "pain_point",
    text: `${body}（${count}）`,
    rating: null,
    source: sourceLabel(title, kindLabel),
    ...(createdAt ? { createdAt } : {}),
  };
}

/** 竞品去重键：同一个品牌换一条 ASIN 仍然是同一条信号。 */
export function competitorDedupeKey(note: string): string {
  return asText(note).replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 从一条已匹配任务的证据里抽出信号草稿。
 *
 * 取用顺序即优先级（先取的先拿到小号 S 编号）：
 *   1. VOC 痛点主题（已由项目自身的 VOC 流程归纳过，信息密度最高）
 *   2. VOC 高频需求
 *   3. 评论原文（低分优先，因为痛点信息集中在低分评论）
 *   4. 关键词（按搜索量）
 *   5. 竞品（有商品名的才有信息量，光一个 ASIN 不给）
 *
 * @param seenCompetitorNotes 跨任务共享的竞品去重集合（同一个品牌只出一条信号）。
 */
export function extractSignalDrafts(
  task: EvidenceTaskSnapshot,
  limits: typeof PROVIDER_PER_TASK_LIMITS = PROVIDER_PER_TASK_LIMITS,
  seenCompetitorNotes?: Set<string>,
): MarketSignalDraft[] {
  const parsed = parseResultJson(task.resultJson);
  const title = asText(task.title).trim();
  const drafts: MarketSignalDraft[] = [];

  const vocUpdatedAt = isRecord(parsed.vocAnalysis) ? asText(parsed.vocAnalysis.updatedAt) || undefined : undefined;

  // 1) VOC 痛点主题
  for (const theme of readVocThemes(parsed, "painPointThemes").slice(0, limits.painPoint)) {
    drafts.push(vocThemeToDraft(theme, title, "VOC 痛点", vocUpdatedAt));
  }

  // 2) VOC 高频需求
  for (const theme of readVocThemes(parsed, "recurringRequests").slice(0, limits.recurringRequest)) {
    drafts.push(vocThemeToDraft(theme, title, "VOC 高频需求", vocUpdatedAt));
  }

  // 3) 评论原文（低分优先；去 HTML；过短的丢弃）
  const reviewEvidence = parsed.reviewEvidence;
  const rawReviews = isRecord(reviewEvidence)
    && isRecord(reviewEvidence.dataset)
    && Array.isArray(reviewEvidence.dataset.reviews)
    ? reviewEvidence.dataset.reviews
    : [];
  const reviews = rawReviews
    .filter(isRecord)
    .map((raw) => ({
      text: cleanReviewText(asText(raw.reviewText)),
      rating: typeof raw.rating === "number" ? raw.rating : null,
      asin: asText(raw.productAsin).trim(),
      capturedAt: asText(raw.capturedAt).trim(),
    }))
    // 过短的评论信息量太低（例如「The best!!」），页面框架文本更不是用户观点。
    .filter((review) => review.text.length >= 20 && !isNoisyReviewText(review.text))
    .sort((a, b) => {
      const left = a.rating ?? 6;
      const right = b.rating ?? 6;
      if (left !== right) return left - right;
      return b.capturedAt.localeCompare(a.capturedAt);
    })
    .slice(0, limits.review);

  for (const review of reviews) {
    drafts.push({
      kind: "review",
      text: review.text,
      rating: review.rating,
      source: sourceLabel(title, review.asin ? `评论 · ${review.asin}` : "评论"),
      ...(review.capturedAt ? { createdAt: review.capturedAt } : {}),
    });
  }

  // 4) 关键词（命中的优先，其次按月搜索量）
  const keywordEvidence = parsed.keywordEvidence;
  const keywordCapturedAt = isRecord(keywordEvidence) ? asText(keywordEvidence.capturedAt) || undefined : undefined;
  const keywordRows = (isRecord(keywordEvidence) && Array.isArray(keywordEvidence.rows) ? keywordEvidence.rows : [])
    .filter(isRecord)
    .map((raw) => ({
      keyword: asText(raw.keyword).trim(),
      translation: asText(raw.keywordTranslation).trim(),
      searches: readMonthlySearches(raw),
    }))
    .filter((row) => row.keyword.length > 0)
    .sort((a, b) => (b.searches ?? -1) - (a.searches ?? -1))
    .slice(0, limits.keyword);

  for (const row of keywordRows) {
    const searches = row.searches !== null ? ` · 月搜索量约 ${row.searches.toLocaleString("en-US")}（平台估算）` : "";
    const translation = row.translation && row.translation !== row.keyword ? `（${row.translation}）` : "";
    drafts.push({
      kind: "keyword",
      text: `${row.keyword}${translation}${searches}`,
      rating: null,
      source: sourceLabel(title, "关键词趋势"),
      ...(keywordCapturedAt ? { createdAt: keywordCapturedAt } : {}),
    });
  }

  // 5) 竞品（只取有商品名的；只有 ASIN 的信息量太低）
  const competitorEvidence = parsed.competitorEvidence;
  const competitorCapturedAt = isRecord(competitorEvidence)
    ? asText(competitorEvidence.updatedAt) || undefined
    : undefined;
  const competitors = (isRecord(competitorEvidence) && Array.isArray(competitorEvidence.asins) ? competitorEvidence.asins : [])
    .filter(isRecord)
    .map((raw) => ({
      asin: asText(raw.asin).trim(),
      note: asText(raw.note).trim(),
      sourceUrl: asText(raw.sourceUrl).trim(),
    }))
    .filter((row) => row.note.length > 0)
    // 同一个品牌往往以多条 ASIN 出现（Owala × 3），全量输出只是噪声 —— 按商品名去重。
    .filter((row, index, list) => {
      const key = row.note.toLowerCase();
      return list.findIndex((other) => other.note.toLowerCase() === key) === index;
    })
    .slice(0, limits.competitor);

  for (const row of competitors) {
    const key = competitorDedupeKey(row.note);
    if (seenCompetitorNotes) {
      if (seenCompetitorNotes.has(key)) continue;
      seenCompetitorNotes.add(key);
    }
    drafts.push({
      kind: "competitor",
      text: `竞品：${row.note}${row.asin ? `（ASIN ${row.asin}）` : ""}`,
      rating: null,
      source: sourceLabel(title, "竞品"),
      ...(competitorCapturedAt ? { createdAt: competitorCapturedAt } : {}),
    });
  }

  return drafts;
}

/* ── 查询层（只读） ── */

/**
 * 按商品方向自动收集已有证据并转换为市场信号。
 *
 * 数据来源只有一处：本机 SQLite 里**已经存在**的研究任务证据。
 * 不抓取、不联网、不写库；匹配不到就如实返回 no_match。
 */
export async function collectMarketSignals(
  input: MarketSignalProviderInput,
): Promise<MarketSignalProviderOutcome> {
  const tokens = tokenizeDirection(`${asText(input.direction)} ${asText(input.keyword ?? "")}`);
  const maxTasks = Math.max(1, Math.min(input.maxTasks ?? PROVIDER_MAX_TASKS, 10));
  const maxItems = Math.max(1, Math.min(input.maxItems ?? PROVIDER_DEFAULT_MAX_ITEMS, 120));

  const empty = (reason: MarketSignalProviderOutcome["reason"]): MarketSignalProviderOutcome => ({
    set: emptyMarketSignalSet(),
    sources: [],
    reason,
    scannedTaskCount: 0,
    totalTaskCount: 0,
    matchedTaskCount: 0,
    tokens,
  });

  if (tokens.length === 0) return empty("no_direction");

  const totalTaskCount = await prisma.viralAnalysisRecord.count();

  // 候选直达：convertedTaskId 提供「候选 → 任务」的确定性链路，不依赖文本匹配。
  const directTaskIds = new Set<string>();
  const candidateId = asText(input.candidateId ?? "").trim();
  if (candidateId) {
    const candidate = await prisma.opportunityCandidate.findFirst({
      where: { id: candidateId },
      select: { convertedTaskId: true },
    });
    if (candidate?.convertedTaskId) directTaskIds.add(candidate.convertedTaskId);
  }

  const coarseRows = await prisma.viralAnalysisRecord.findMany({
    where: {
      OR: tokens.flatMap((token) => [
        { title: { contains: token } },
        { materialText: { contains: token } },
        { resultJson: { contains: token } },
      ]),
    },
    select: { id: true, title: true, materialText: true, resultJson: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: PROVIDER_COARSE_FETCH_LIMIT,
  });

  const snapshots = new Map<string, EvidenceTaskSnapshot>();
  for (const row of coarseRows) {
    snapshots.set(row.id, {
      taskId: row.id,
      title: asText(row.title),
      materialText: asText(row.materialText),
      updatedAt: row.updatedAt.toISOString(),
      resultJson: row.resultJson,
    });
  }

  // 候选直达的任务即使没被文本命中，也要补进来（保证「指定候选」永远可用）。
  const missingDirectIds = [...directTaskIds].filter((id) => !snapshots.has(id));
  if (missingDirectIds.length > 0) {
    const directRows = await prisma.viralAnalysisRecord.findMany({
      where: { id: { in: missingDirectIds } },
      select: { id: true, title: true, materialText: true, resultJson: true, updatedAt: true },
    });
    for (const row of directRows) {
      snapshots.set(row.id, {
        taskId: row.id,
        title: asText(row.title),
        materialText: row.materialText,
        updatedAt: row.updatedAt.toISOString(),
        resultJson: row.resultJson,
      });
    }
  }

  const scannedTaskCount = snapshots.size;
  if (scannedTaskCount === 0) {
    return { ...empty("no_match"), totalTaskCount };
  }

  const matches: Array<{ snapshot: EvidenceTaskSnapshot; match: EvidenceTaskMatch }> = [];
  for (const snapshot of snapshots.values()) {
    const scored = scoreEvidenceTask(snapshot, tokens);
    if (scored) {
      matches.push({ snapshot, match: scored });
      continue;
    }
    if (directTaskIds.has(snapshot.taskId)) {
      matches.push({
        snapshot,
        match: {
          taskId: snapshot.taskId,
          title: snapshot.title.trim() || snapshot.taskId,
          updatedAt: snapshot.updatedAt,
          score: Number.MAX_SAFE_INTEGER,
          matchedTokens: [],
          matchedSurfaces: ["候选直达"],
          reviewCount: 0,
          hasVoc: false,
          hasKeywordEvidence: false,
          hasCompetitorEvidence: false,
        },
      });
    }
  }

  if (matches.length === 0) {
    return { ...empty("no_match"), scannedTaskCount, totalTaskCount };
  }

  matches.sort((a, b) => {
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    return b.match.updatedAt.localeCompare(a.match.updatedAt);
  });

  const drafts: MarketSignalDraft[] = [];
  const sources: MarketSignalProviderSource[] = [];
  const seenCompetitorNotes = new Set<string>();

  for (const { snapshot, match } of matches.slice(0, maxTasks)) {
    if (drafts.length >= maxItems) break;
    const taskDrafts = extractSignalDrafts(snapshot, PROVIDER_PER_TASK_LIMITS, seenCompetitorNotes)
      .slice(0, maxItems - drafts.length);
    if (taskDrafts.length === 0) continue;
    drafts.push(...taskDrafts);
    sources.push({
      taskId: match.taskId,
      title: match.title,
      matchedTokens: match.matchedTokens,
      matchedSurfaces: match.matchedSurfaces,
      score: match.score,
      signalCount: taskDrafts.length,
      reviewCount: match.reviewCount,
    });
  }

  if (drafts.length === 0) {
    return { ...empty("no_evidence"), scannedTaskCount, totalTaskCount, matchedTaskCount: matches.length };
  }

  return {
    set: buildMarketSignalSet(drafts, drafts.length),
    sources,
    reason: "ok",
    scannedTaskCount,
    totalTaskCount,
    matchedTaskCount: matches.length,
    tokens,
  };
}

/** 供前端/提示词使用的人类可读说明（确定性，不含 AI 生成内容）。 */
export function describeProviderOutcome(outcome: MarketSignalProviderOutcome): string {
  if (outcome.reason === "no_direction") {
    return "未填写商品方向，无法自动检索已有证据。";
  }
  if (outcome.reason === "no_match") {
    return `已在 ${outcome.totalTaskCount} 个已有研究任务中检索，没有找到与「${outcome.tokens.join(" / ")}」相关的已有证据。`;
  }
  if (outcome.reason === "no_evidence") {
    return `找到 ${outcome.matchedTaskCount} 个相关任务，但这些任务里还没有可用的真实证据（评论 / VOC / 关键词 / 竞品）。`;
  }
  const accepted = outcome.set.items.length;
  const kindText = Object.entries(outcome.set.stats.byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${MARKET_SIGNAL_KIND_LABELS[kind as keyof typeof MARKET_SIGNAL_KIND_LABELS] ?? kind} ${count}`)
    .join(" · ");
  const duplicate = outcome.set.stats.duplicateItems > 0
    ? `，去重 ${outcome.set.stats.duplicateItems} 条`
    : "";
  return `已从 ${outcome.sources.length} 个已有研究任务自动加载 ${accepted} 条真实信号（${kindText}${duplicate}）。`;
}
