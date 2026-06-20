/**
 * V2 工作流沙盒 — 从 opportunities 任务记录中提取候选品数组。
 *
 * 纯函数，不访问网络，不调用 AI，不写数据库。
 */

export type V2Candidate = {
  name: string;
  score: number;
  level: string;
  levelLabel: string;
  displayRiskLevel: string;
  reasons: string[];
  risks: string[];
  nextAction: string;
  sourcingSummary: string;
  riskSummary: string;
  summaryVerdict: string;
  status: string;
};

export type V2RecordsInput = {
  items?: Array<{
    type?: string;
    result?: unknown;
  }>;
  records?: Array<{
    type?: string;
    result?: unknown;
  }>;
};

const FALLBACK = "暂无该项数据";

function safeString(v: unknown, fallback = FALLBACK): string {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return fallback;
}

function safeNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return 0;
}

function safeArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  return [];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 从 opportunities 任务 API 响应中提取最新一条记录的类型。
 * 如果不是 opportunities 类型，返回 null（前端应显示空状态）。
 */
function findLatestOpportunitiesResult(raw: V2RecordsInput): Record<string, unknown> | null {
  const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.records) ? raw.records : [];
  for (const item of items) {
    if (isRecord(item) && item.type === "opportunities" && isRecord(item.result)) {
      return item.result as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * 从 result.candidates 提取候选品数组。
 * 缺失字段用安全默认值填充，不抛异常，不输出 undefined/null。
 */
export function extractCandidates(raw: V2RecordsInput): V2Candidate[] {
  const result = findLatestOpportunitiesResult(raw);
  if (!result) return [];

  const rawCandidates = result.candidates;
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) return [];

  return rawCandidates.map((c: unknown) => {
    const item = isRecord(c) ? c : {};

    return {
      name: safeString(item.name, "未命名商品"),
      score: safeNumber(item.score),
      level: safeString(item.level, ""),
      levelLabel: safeString(item.levelLabel, ""),
      displayRiskLevel: safeString(item.displayRiskLevel, ""),
      reasons: safeArray(item.reasons),
      risks: safeArray(item.risks),
      nextAction: safeString(item.nextAction, ""),
      sourcingSummary: safeString(item.sourcingSummary, FALLBACK),
      riskSummary: safeString(item.riskSummary, FALLBACK),
      summaryVerdict: safeString(item.summaryVerdict, FALLBACK),
      status: safeString(item.status, ""),
    };
  });
}
