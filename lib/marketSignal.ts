/**
 * Opportunity Analysis Spike — 真实市场信号契约（前后端共享，纯函数，无 IO）。
 *
 * V1 要验的唯一问题：给 AI 接上真实市场信号后，机会判断是否变得更可判断。
 * V2 要验的唯一问题：系统自动取到的信号，能不能达到 V1 手动粘贴的效果。
 *
 * 边界（沿用 V0 的克制）：
 * - V1：信号由用户提供（粘贴真实评论 / 竞品反馈 / 关键词），不抓取、不联网、不落库。
 * - V2：信号由服务端从**已有研究任务**的证据中读出（reviewEvidence / vocAnalysis /
 *   keywordEvidence / competitorEvidence），仍然不抓取、不联网、不写库。
 * - 信号原文一律视为 UNTRUSTED DATA：只进 AI 的 user 数据字段，绝不进 system 指令。
 * - 信号条数、评分分布等统计由服务端 deterministic 计算，AI 不得自行编造数量。
 * - AI 只能引用真实存在的信号编号（S1/S2…），引用不到的条目一律剔除（防编造门禁）。
 *
 * 复用说明：`normalizeSignalText` 与 `lib/server/reviewEvidence.ts` 的
 * `normalizeReviewText` 保持同一语义（去控制字符 + 压缩空白 + 小写），
 * 因该服务端模块会拉入 prisma，故在共享契约内独立实现同一规则。
 */

export const MARKET_SIGNAL_MAX_RAW_CHARS = 12_000;
export const MARKET_SIGNAL_MAX_ITEMS = 120;
export const MARKET_SIGNAL_TEXT_MAX_CHARS = 600;
export const MIN_SIGNAL_TEXT_CHARS = 4;

export const MARKET_SIGNAL_KINDS = ["review", "competitor", "keyword", "pain_point"] as const;
export type MarketSignalKind = (typeof MARKET_SIGNAL_KINDS)[number];

export const MARKET_SIGNAL_KIND_LABELS: Record<MarketSignalKind, string> = {
  review: "评论",
  competitor: "竞品反馈",
  keyword: "关键词",
  pain_point: "痛点描述",
};

/**
 * 每行一条信号，可选前缀：
 *   [review] 文本          [competitor] 文本
 *   [keyword] 文本         [pain_point] 文本
 *   [review 2] 文本        ← 类型 + 评分（1-5）
 * 无前缀默认按 review 处理。
 */
const SIGNAL_LINE_PATTERN = /^\[(review|competitor|keyword|pain_point)(?:\s+([1-5]))?\]\s*(.*)$/;

export type MarketSignalItem = {
  /** AI 唯一可引用的编号：S1、S2…（由服务端按接受顺序生成，稳定不变） */
  ref: string;
  kind: MarketSignalKind;
  text: string;
  rating: number | null;
  /**
   * V2：信号来源说明（例如「已有研究任务《Owala FreeSip…》的评论」）。
   * 手动粘贴的信号没有来源，此字段缺省；自动信号必须带来源，供前端与 AI 追溯。
   */
  source?: string;
  /** V2：信号在证据中的采集/更新时间（ISO 字符串）。手动粘贴缺省。 */
  createdAt?: string;
};

/**
 * V2：未编号的信号草稿。编号、去重、截断、上限统一由 `buildMarketSignalSet` 处理，
 * 保证「手动粘贴」与「系统自动读取」两条路径走**同一套**编号与门禁逻辑。
 */
export type MarketSignalDraft = {
  kind: MarketSignalKind;
  text: string;
  rating?: number | null;
  source?: string;
  createdAt?: string;
};

export type MarketSignalStats = {
  rawLines: number;
  acceptedItems: number;
  duplicateItems: number;
  rejectedItems: number;
  withRating: number;
  averageRating: number | null;
  textCharTotal: number;
  byKind: Record<MarketSignalKind, number>;
};

export type MarketSignalSet = {
  provided: boolean;
  items: MarketSignalItem[];
  stats: MarketSignalStats;
};

/** 与 reviewEvidence.normalizeReviewText 同语义：用于信号去重。 */
export function normalizeSignalText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 信号编号：索引 0 → S1。 */
export function buildSignalRef(index: number): string {
  return `S${index + 1}`;
}

/**
 * V2：清洗来自证据库的原始文本。
 *
 * 已有任务里的 reviewText 是浏览器采集的原文，可能带 `<img>` 头像标签等标记；
 * 直接送进提示词会把噪声当事实。这里只做「去掉标签 + 还原少量实体 + 压缩空白」，
 * 不改动语义、不做摘要、不删句子。
 */
export function stripSignalHtmlTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function emptyStats(): MarketSignalStats {
  return {
    rawLines: 0,
    acceptedItems: 0,
    duplicateItems: 0,
    rejectedItems: 0,
    withRating: 0,
    averageRating: null,
    textCharTotal: 0,
    byKind: { review: 0, competitor: 0, keyword: 0, pain_point: 0 },
  };
}

export function emptyMarketSignalSet(): MarketSignalSet {
  return { provided: false, items: [], stats: emptyStats() };
}

function toRating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

/**
 * V1/V2 共用的信号构建器 —— 编号、去重、截断、上限、统计的唯一实现。
 *
 * 手动粘贴（parseMarketSignalText）与自动读取（marketSignalProvider）都走这里，
 * 保证两条路径产出的编号语义、去重规则、条数上限完全一致。
 */
export function buildMarketSignalSet(
  drafts: readonly MarketSignalDraft[],
  rawLineCount: number = drafts.length,
): MarketSignalSet {
  const stats = emptyStats();
  stats.rawLines = Number.isFinite(rawLineCount) && rawLineCount > 0 ? Math.floor(rawLineCount) : 0;
  if (drafts.length === 0) return { provided: false, items: [], stats };

  const seen = new Set<string>();
  const items: MarketSignalItem[] = [];
  let ratingSum = 0;

  for (const draft of drafts) {
    const cleaned = String(draft?.text ?? "").replace(/\s+/g, " ").trim().slice(0, MARKET_SIGNAL_TEXT_MAX_CHARS);
    if (cleaned.length < MIN_SIGNAL_TEXT_CHARS) {
      stats.rejectedItems += 1;
      continue;
    }

    const identity = normalizeSignalText(cleaned);
    if (seen.has(identity)) {
      stats.duplicateItems += 1;
      continue;
    }
    seen.add(identity);

    const rating = toRating(draft.rating);
    const item: MarketSignalItem = {
      ref: buildSignalRef(items.length),
      kind: draft.kind,
      text: cleaned,
      rating,
    };
    const source = typeof draft.source === "string" ? draft.source.replace(/\s+/g, " ").trim() : "";
    if (source) item.source = source.slice(0, 200);
    if (typeof draft.createdAt === "string" && draft.createdAt.trim()) item.createdAt = draft.createdAt.trim();

    items.push(item);
    stats.byKind[draft.kind] += 1;
    stats.textCharTotal += cleaned.length;
    if (rating !== null) {
      stats.withRating += 1;
      ratingSum += rating;
    }
    if (items.length >= MARKET_SIGNAL_MAX_ITEMS) break;
  }

  stats.acceptedItems = items.length;
  stats.averageRating = stats.withRating > 0 ? Number((ratingSum / stats.withRating).toFixed(2)) : null;

  return { provided: items.length > 0, items, stats };
}

/**
 * V2：合并多个信号集（手动优先、自动在后），去重后统一重新编号。
 *
 * 编号必须重新分配：AI 只认最终注入提示词的那一套编号，
 * 若沿用合并前的编号会出现重号（手动 S1 与自动 S1 同时存在）。
 */
export function mergeMarketSignalSets(sets: readonly MarketSignalSet[]): MarketSignalSet {
  const drafts: MarketSignalDraft[] = [];
  let rawLines = 0;
  for (const set of sets) {
    if (!set) continue;
    rawLines += set.stats.rawLines;
    for (const item of set.items) {
      drafts.push({
        kind: item.kind,
        text: item.text,
        rating: item.rating,
        ...(item.source ? { source: item.source } : {}),
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      });
    }
  }
  return buildMarketSignalSet(drafts, rawLines);
}

/**
 * 解析用户提供的市场信号原文。
 * 容错：空行忽略、超长截断、重复（归一化后相同）只保留首条、过短丢弃。
 */
export function parseMarketSignalText(raw: unknown): MarketSignalSet {
  const source = typeof raw === "string" ? raw.slice(0, MARKET_SIGNAL_MAX_RAW_CHARS) : "";
  if (!source.trim()) return emptyMarketSignalSet();

  const drafts: MarketSignalDraft[] = [];
  let rawLines = 0;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rawLines += 1;

    let kind: MarketSignalKind = "review";
    let rating: number | null = null;
    let body = trimmed;

    const matched = SIGNAL_LINE_PATTERN.exec(trimmed);
    if (matched) {
      kind = matched[1] as MarketSignalKind;
      rating = matched[2] ? Number(matched[2]) : null;
      body = matched[3];
    }

    drafts.push({ kind, text: body, rating });
  }

  return buildMarketSignalSet(drafts, rawLines);
}

/** 真实存在的信号编号集合 —— 防编造门禁的唯一判据。 */
export function collectSignalRefs(set: MarketSignalSet): Set<string> {
  return new Set(set.items.map((item) => item.ref));
}
