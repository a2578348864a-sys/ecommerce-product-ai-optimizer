/**
 * 任务记录归一化工具
 *
 * 职责：把数据库行 / API 返回的原始记录归一化为统一的可搜索、可筛选结构。
 * 处理字段命名不一致（type/taskType/agentType）、旧字段兼容、result JSON 解析。
 *
 * 不依赖数据库、不依赖外部服务。纯函数，可在测试中独立运行。
 */

export type RawTaskRecord = {
  id: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  /** 任务类型（数据库主字段） */
  type?: string;
  /** 兼容旧字段 */
  taskType?: string;
  agentType?: string;
  recordType?: string;
  sourceType?: string;
  title?: string | null;
  /** 兼容旧字段 */
  productName?: string | null;
  productTitle?: string | null;
  platform?: string;
  productUrl?: string | null;
  materialText?: string;
  /** 兼容旧字段 */
  input?: string | null;
  inputText?: string | null;
  query?: string | null;
  rawInput?: string | null;
  source?: string;
  score?: number;
  level?: string;
  oneLineSummary?: string;
  summary?: string | null;
  /** result 可能是 JSON 字符串、对象或 null */
  result?: unknown;
  resultJson?: string;
  metadata?: unknown;
  /** 状态字段（旧数据可能缺失） */
  status?: string;
};

export type NormalizedTaskRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 归一化后的任务类型（统一用 type） */
  type: string;
  /** agentType：从 type 推断，若无则空 */
  agentType: string;
  /** status：缺失则默认 completed（历史记录都是已完成） */
  status: string;
  title: string;
  platform: string;
  productUrl: string;
  materialText: string;
  source: string;
  score: number;
  level: string;
  oneLineSummary: string;
  /** 解析后的 result 对象（解析失败为 null） */
  result: Record<string, unknown> | null;
  /** 解析后的 metadata 对象（解析失败为 null） */
  metadata: Record<string, unknown> | null;
};

/** 已知的合法任务类型 */
export const KNOWN_TASK_TYPES = new Set([
  "viral",
  "radar",
  "product",
  "risk",
  "sourcing",
  "material",
  "summary",
]);

/** agentType 到 taskType 的映射（agentType 派生自 type） */
const TYPE_TO_AGENT: Record<string, string> = {
  viral: "viral",
  radar: "radar",
  product: "product",
  risk: "risk",
  sourcing: "sourcing",
  material: "material",
  summary: "summary",
};

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value);
  return text || null;
}

function asIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return value;
  }
  return "";
}

function asScore(value: unknown): number {
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** 安全解析 JSON：接受对象、JSON 字符串 */
function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 归一化一条任务记录。
 *
 * 字段优先级与兼容：
 * - type：type > taskType > agentType > recordType > sourceType > "viral"（默认）
 * - title：title > productTitle > productName > materialText 截断 > "未命名记录"
 * - materialText：materialText > input > inputText > query > rawInput > title
 * - oneLineSummary：oneLineSummary > summary > ""
 * - result：result（对象/JSON 字符串）> resultJson（JSON 字符串）
 * - status：status > "completed"（历史记录默认已完成）
 */
export function normalizeTaskRecord(raw: RawTaskRecord): NormalizedTaskRecord {
  const type =
    asString(raw.type)
    || asString(raw.taskType)
    || asString(raw.agentType)
    || asString(raw.recordType)
    || asString(raw.sourceType)
    || "viral";

  const title =
    asOptionalString(raw.title)
    || asOptionalString(raw.productTitle)
    || asOptionalString(raw.productName)
    || asString(raw.materialText).slice(0, 20)
    || "未命名记录";

  const materialText =
    asString(raw.materialText)
    || asString(raw.input)
    || asString(raw.inputText)
    || asString(raw.query)
    || asString(raw.rawInput)
    || asString(title);

  const oneLineSummary =
    asString(raw.oneLineSummary)
    || asString(raw.summary);

  const result = parseJsonObject(raw.result) ?? parseJsonObject(raw.resultJson);
  const metadata = parseJsonObject(raw.metadata);

  const agentType = asString(raw.agentType) || TYPE_TO_AGENT[type] || "";
  const status = asString(raw.status) || "completed";

  return {
    id: asString(raw.id),
    createdAt: asIsoDate(raw.createdAt),
    updatedAt: asIsoDate(raw.updatedAt),
    type,
    agentType,
    status,
    title,
    platform: asString(raw.platform) || "manual",
    productUrl: asOptionalString(raw.productUrl) || "",
    materialText,
    source: asString(raw.source) || "mock",
    score: asScore(raw.score),
    level: asString(raw.level),
    oneLineSummary,
    result,
    metadata,
  };
}

/**
 * 从归一化记录中提取可搜索的文本（用于 q 关键词匹配）。
 * 覆盖：title、type、agentType、materialText、oneLineSummary、
 * platform、level、productUrl、result 主要文本、metadata 安全字段。
 */
export function buildSearchableText(record: NormalizedTaskRecord): string {
  const parts: string[] = [
    record.title,
    record.type,
    record.agentType,
    record.materialText,
    record.oneLineSummary,
    record.platform,
    record.level,
    record.productUrl,
  ];

  // result 中的字符串值（递归一层 + 数组字符串）
  if (record.result) {
    parts.push(extractStringsFromObject(record.result));
  }

  // metadata 中的字符串值
  if (record.metadata) {
    parts.push(extractStringsFromObject(record.metadata));
  }

  return parts.filter(Boolean).join(" ");
}

/** 递归提取对象/数组中的字符串值（限制深度避免无限递归） */
function extractStringsFromObject(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return "";
  if (Array.isArray(value)) {
    return value.map((item) => extractStringsFromObject(item, depth + 1)).filter(Boolean).join(" ");
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value)
      .map((item) => extractStringsFromObject(item, depth + 1))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}
