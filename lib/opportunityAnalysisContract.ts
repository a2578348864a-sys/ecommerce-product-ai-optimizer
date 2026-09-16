/**
 * Opportunity Analysis Spike — V0 共享契约（前端 / 后端共用，纯函数，无 IO）。
 *
 * V0 边界：
 * - 不接任何外部数据源（SellerSprite / Amazon API / Keepa / 爬虫），只验证流程。
 * - 输出只允许"值得研究 / 可能存在机会 / 需要验证"这类假设性表述；
 *   禁止"爆款 / 一定赚钱 / 高销量 / 市场巨大"等确定性结论，命中即净化。
 */

export const DEFAULT_MARKETPLACE = "Amazon US";

export const SUPPORTED_MARKETPLACES = [
  "Amazon US",
  "Amazon UK",
  "Amazon DE",
  "Amazon JP",
  "Amazon CA",
] as const;

export type SupportedMarketplace = (typeof SUPPORTED_MARKETPLACES)[number];

export const MIN_CANDIDATES = 3;
export const MAX_CANDIDATES = 6;
export const MAX_CATEGORY_LENGTH = 120;
export const MAX_CONSTRAINTS_LENGTH = 500;
export const MAX_CANDIDATE_TITLE_LENGTH = 80;
export const MAX_CANDIDATE_REASON_LENGTH = 400;
export const MAX_POINT_LENGTH = 200;
export const MAX_POINTS_PER_CANDIDATE = 5;

export type OpportunityCandidate = {
  title: string;
  reason: string;
  painPoints: string[];
  validationNeeded: string[];
};

export type OpportunityAnalysisResult = {
  candidates: OpportunityCandidate[];
};

/**
 * 违禁结论表达 → 等价的可验证表述。
 * 顺序有意义：先命中先替换。
 */
export const BANNED_CLAIM_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/爆款/g, "值得研究的候选方向"],
  [/一定赚钱|稳赚|躺赚|肯定赚钱|必然盈利|保证赚钱|肯定大卖/g, "可能存在机会"],
  [/高销量|超高销量|销量很高|销量极高|销量巨大|大卖/g, "需求信号待验证"],
  [/市场巨大|市场很大|市场非常巨大|市场空间巨大|需求巨大|蛋糕很大/g, "市场空间待验证"],
];

export const DEFAULT_PAIN_POINT = "目标用户的真实使用痛点尚未验证。";
export const DEFAULT_VALIDATION_NEEDED = "该方向的需求规模与竞争强度尚未验证。";
export const DEFAULT_REASON = "值得研究；是否存在机会仍需验证。";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** 净化为合规表述：先替换违禁结论词，再压缩空白。 */
export function sanitizeOpportunityText(value: string): string {
  let output = value;
  for (const [pattern, replacement] of BANNED_CLAIM_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(/\s+/g, " ").trim();
}

/** 返回命中的违禁词原文（用于测试与验收证据，不修改文本）。 */
export function findBannedClaimPhrases(value: string): string[] {
  const hits: string[] = [];
  for (const [pattern] of BANNED_CLAIM_REPLACEMENTS) {
    const matches = value.match(pattern);
    if (matches) hits.push(...matches);
  }
  return hits;
}

function toPointList(value: unknown, fallback: string): string[] {
  const raw = Array.isArray(value)
    ? value.map(asText)
    : typeof value === "string"
      ? value.split(/\r?\n|；|;/)
      : [];
  const points: string[] = [];
  for (const item of raw) {
    const point = sanitizeOpportunityText(item).slice(0, MAX_POINT_LENGTH);
    if (point && !points.includes(point)) points.push(point);
    if (points.length >= MAX_POINTS_PER_CANDIDATE) break;
  }
  return points.length > 0 ? points : [fallback];
}

/**
 * 把 AI 原始输出归一化为固定结构。
 * 容错：接受字符串或数组；去重；按 title 去重；截断到 MAX_CANDIDATES。
 */
export function normalizeOpportunityAnalysisResult(raw: unknown): OpportunityCandidate[] {
  const record = isRecord(raw) ? raw : {};
  const rawCandidates = Array.isArray(record.candidates) ? record.candidates : [];
  const seen = new Set<string>();
  const candidates: OpportunityCandidate[] = [];

  for (const item of rawCandidates) {
    if (!isRecord(item)) continue;
    const title = sanitizeOpportunityText(asText(item.title)).slice(0, MAX_CANDIDATE_TITLE_LENGTH);
    if (!title) continue;
    const identity = title.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);

    candidates.push({
      title,
      reason: sanitizeOpportunityText(asText(item.reason)).slice(0, MAX_CANDIDATE_REASON_LENGTH) || DEFAULT_REASON,
      painPoints: toPointList(item.painPoints, DEFAULT_PAIN_POINT),
      validationNeeded: toPointList(item.validationNeeded, DEFAULT_VALIDATION_NEEDED),
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return candidates;
}

/* ────────────────────────────────────────────────────────────────────────────
 * V1：真实市场信号增强（向后兼容 V0）
 *
 * 与 V0 的唯一区别：候选多出一层「有出处的判断」。
 * 关键门禁：userPainPoints[].signalRefs 只能引用真实存在的信号编号，
 * 引用不到的编号一律剔除；一条痛点若引用全部无效，仍保留文本但 signalRefs 为空
 * （前端据此显示"无真实依据"），绝不把 AI 编造的编号当作证据展示。
 * ──────────────────────────────────────────────────────────────────────────── */

export const MAX_MARKET_OPPORTUNITY_LENGTH = 600;
export const MAX_EVIDENCE_BASIS_LENGTH = 300;
export const MAX_EVIDENCE_BASIS_PER_CANDIDATE = 5;
export const MAX_RISK_LENGTH = 200;
export const MAX_RISKS_PER_CANDIDATE = 5;
export const MAX_RECOMMENDATION_REASON_LENGTH = 300;
export const MAX_SIGNAL_REFS_PER_POINT = 5;

export type OpportunityPainPoint = {
  text: string;
  /** 已通过门禁过滤的真实信号编号；空数组 = 该痛点没有真实信号支撑 */
  signalRefs: string[];
};

export type OpportunityResearchRecommendation = {
  recommended: boolean;
  reason: string;
};

export type OpportunityCandidateV1 = OpportunityCandidate & {
  /** 1. 市场机会描述 */
  marketOpportunity: string;
  /** 2. 用户痛点（带真实信号出处） */
  userPainPoints: OpportunityPainPoint[];
  /** 3. 验证依据 */
  evidenceBasis: string[];
  /** 4. 风险点 */
  risks: string[];
  /** 5. 是否建议进入 Research */
  researchRecommendation: OpportunityResearchRecommendation;
};

function toBoundedTextList(
  value: unknown,
  maxLength: number,
  maxItems: number,
  fallback: string[],
): string[] {
  const raw = Array.isArray(value)
    ? value.map(asText)
    : typeof value === "string"
      ? value.split(/\r?\n|；|;/)
      : [];
  const points: string[] = [];
  for (const item of raw) {
    const point = sanitizeOpportunityText(item).slice(0, maxLength);
    if (point && !points.includes(point)) points.push(point);
    if (points.length >= maxItems) break;
  }
  return points.length > 0 ? points : fallback;
}

/** 防编造门禁：只保留真实存在的信号编号。 */
function toSignalRefs(value: unknown, validSignalRefs: ReadonlySet<string>): string[] {
  const raw = Array.isArray(value) ? value : [];
  const refs: string[] = [];
  for (const item of raw) {
    const ref = asText(item).trim().toUpperCase();
    if (!ref || !validSignalRefs.has(ref) || refs.includes(ref)) continue;
    refs.push(ref);
    if (refs.length >= MAX_SIGNAL_REFS_PER_POINT) break;
  }
  return refs;
}

function toPainPoints(value: unknown, validSignalRefs: ReadonlySet<string>): OpportunityPainPoint[] {
  const raw = Array.isArray(value) ? value : [];
  const points: OpportunityPainPoint[] = [];
  for (const item of raw) {
    let text = "";
    let signalRefs: string[] = [];
    if (typeof item === "string") {
      text = sanitizeOpportunityText(item).slice(0, MAX_POINT_LENGTH);
    } else if (isRecord(item)) {
      text = sanitizeOpportunityText(asText(item.text)).slice(0, MAX_POINT_LENGTH);
      signalRefs = toSignalRefs(item.signalRefs, validSignalRefs);
    }
    if (text && !points.some((point) => point.text === text)) points.push({ text, signalRefs });
    if (points.length >= MAX_POINTS_PER_CANDIDATE) break;
  }
  return points;
}

function toRecommendation(value: unknown): OpportunityResearchRecommendation {
  const record = isRecord(value) ? value : {};
  const raw = record.recommended;
  const recommended = raw === true || raw === "true" || raw === "yes" || raw === "建议";
  const reason =
    sanitizeOpportunityText(asText(record.reason)).slice(0, MAX_RECOMMENDATION_REASON_LENGTH)
    || "是否值得进入研究仍需人工判断。";
  return { recommended, reason };
}

/**
 * 把带真实市场信号的 AI 输出归一化为固定结构。
 * 兼容性：V1 字段缺失时回落到 V0 字段，因此同一份输出在两种契约下都能解析。
 */
export function normalizeOpportunityAnalysisResultV1(
  raw: unknown,
  validSignalRefs: ReadonlySet<string>,
): OpportunityCandidateV1[] {
  const record = isRecord(raw) ? raw : {};
  const rawCandidates = Array.isArray(record.candidates) ? record.candidates : [];
  const seen = new Set<string>();
  const candidates: OpportunityCandidateV1[] = [];

  for (const item of rawCandidates) {
    if (!isRecord(item)) continue;
    const title = sanitizeOpportunityText(asText(item.title)).slice(0, MAX_CANDIDATE_TITLE_LENGTH);
    if (!title) continue;
    const identity = title.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);

    const marketOpportunity =
      sanitizeOpportunityText(asText(item.marketOpportunity)).slice(0, MAX_MARKET_OPPORTUNITY_LENGTH)
      || sanitizeOpportunityText(asText(item.reason)).slice(0, MAX_MARKET_OPPORTUNITY_LENGTH)
      || DEFAULT_REASON;

    const normalizedPainPoints = toPainPoints(item.userPainPoints, validSignalRefs);
    const userPainPoints: OpportunityPainPoint[] = normalizedPainPoints.length > 0
      ? normalizedPainPoints
      : toPointList(item.painPoints, DEFAULT_PAIN_POINT).map((text) => ({ text, signalRefs: [] }));

    candidates.push({
      title,
      marketOpportunity,
      userPainPoints,
      evidenceBasis: toBoundedTextList(
        item.evidenceBasis,
        MAX_EVIDENCE_BASIS_LENGTH,
        MAX_EVIDENCE_BASIS_PER_CANDIDATE,
        [],
      ),
      risks: toBoundedTextList(item.risks, MAX_RISK_LENGTH, MAX_RISKS_PER_CANDIDATE, []),
      researchRecommendation: toRecommendation(item.researchRecommendation),
      reason:
        sanitizeOpportunityText(asText(item.reason)).slice(0, MAX_CANDIDATE_REASON_LENGTH)
        || marketOpportunity.slice(0, MAX_CANDIDATE_REASON_LENGTH),
      painPoints: userPainPoints.map((point) => point.text),
      validationNeeded: toPointList(item.validationNeeded, DEFAULT_VALIDATION_NEEDED),
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }

  return candidates;
}
