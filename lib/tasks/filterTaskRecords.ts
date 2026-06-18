/**
 * 任务记录搜索筛选纯函数
 *
 * 职责：对已归一化的任务记录列表执行 q 搜索 + taskType 筛选 + 分页。
 * 不做 API 调用、不做数据库操作。纯函数，可在测试中独立运行。
 *
 * 规则：
 * - 无 q 无 type → 返回全部
 * - 只有 q → 在所有类型中搜索
 * - 只有 type → 只返回该类型
 * - q + type → 交集（type 匹配 AND q 匹配）
 * - 搜索前先归一化 q（trim + 小写）
 * - 分页在过滤后执行
 */

import type { NormalizedTaskRecord } from "./normalizeTaskRecord";
import { buildSearchableText } from "./normalizeTaskRecord";

export type FilterInput = {
  /** 所有已归一化的记录 */
  records: NormalizedTaskRecord[];
  /** 搜索关键词 */
  q?: string;
  /** 筛选的任务类型（空串或省略表示不做类型筛选） */
  taskType?: string;
  /** 页码（从 1 开始） */
  page?: number;
  /** 每页条数 */
  limit?: number;
};

export type FilterResult = {
  /** 过滤后的记录（已分页） */
  items: NormalizedTaskRecord[];
  /** 过滤后的总数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页条数 */
  limit: number;
  /** 总页数 */
  totalPages: number;
  /** 是否有下一页 */
  hasMore: boolean;
};

/** 归一化搜索关键词 */
function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

/**
 * 对归一化后的任务记录执行搜索 + 筛选 + 分页。
 *
 * 所有操作在内存中完成。调用方负责传入完整的记录列表。
 * 调用顺序：type 筛选 → q 搜索 → 分页。
 */
export function filterTaskRecords(input: FilterInput): FilterResult {
  const q = normalizeQuery(input.q ?? "");
  const taskType = (input.taskType ?? "").trim() || "";
  const page = input.page && input.page > 0 ? input.page : 1;
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, 50) : 10;

  // 阶段 1：type 筛选
  let filtered = input.records;
  if (taskType) {
    filtered = filtered.filter((r) => r.type === taskType);
  }

  // 阶段 2：q 搜索（在 type 筛选后的结果中搜索）
  if (q) {
    filtered = filtered.filter((r) => buildSearchableText(r).toLowerCase().includes(q));
  }

  // 阶段 3：分页
  const total = filtered.length;
  const offset = (page - 1) * limit;
  const items = filtered.slice(offset, offset + limit);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = offset + items.length < total;

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasMore,
  };
}
