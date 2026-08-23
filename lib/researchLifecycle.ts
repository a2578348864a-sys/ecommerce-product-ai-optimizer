/**
 * V3 Final Interaction Correction — R5：Research Lifecycle 统一分类器
 *
 * V3 Current Research Normalization 增补：
 * - researchCompletion（research-completion.v1，resultJson 顶层）为正式完成标记：
 *   completed = 本轮研究已收口（最终人工判断可继续）；abandoned = 放弃研究。
 *   两者均属 historical（研究记录），同一 canonical Task 的 lifecycle 视图。
 * - 无 researchRecord 但有当前 Evidence 的任务（candidate_research 等）= CURRENT_ACTIVE，
 *   不是 legacy；historical_legacy 仅保留为无活跃决定语义旧批次的 defensive 分支。
 *
 * 任务 39 节：不按创建时间区分；按正式 research lifecycle / decision state。
 *
 * 真实 domain mapping（代码实证，非猜测）：
 * - 新版 product-research-record.v1 latestDecision.status：
 *   "creative_ready" | "needs_information" | "abandoned"
 * - 旧版 task.decisionStatus：
 *   "pending" | "continue" | "need_info" | "rejected"
 */

export type ResearchLifecycle = "active" | "historical";

export type ResearchLifecycleDetail =
  | "active_open"        // 无新版 record，旧版状态 ∈ {pending, continue, need_info}
  | "active_creative"    // 新版 record，latestDecision = creative_ready
  | "active_need_info"   // 新版 record，latestDecision = needs_information
  | "historical_completed" // researchCompletion = completed（本轮研究已收口）
  | "historical_abandoned" // 新版 abandoned、旧版 rejected，或 researchCompletion = abandoned
  | "historical_legacy"; // defensive：无活跃决定语义的旧批次（当前真实数据不命中）

export type ResearchLifecycleInput = {
  decisionStatus: string;
  result: Record<string, unknown> | null;
  type?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取正式完成标记（research-completion.v1） */
function readResearchCompletion(result: Record<string, unknown> | null): "completed" | "abandoned" | null {
  if (!result) return null;
  const completion = result.researchCompletion;
  if (!isRecord(completion)) return null;
  if (completion.schema !== "research-completion.v1") return null;
  if (completion.status === "completed") return "completed";
  if (completion.status === "abandoned") return "abandoned";
  return null;
}

function readVersionedDecision(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  // 权威存储：resultJson.researchRecord（product-research-record.v1，与 creative-handoff gate 同源）
  const record = result.researchRecord;
  if (isRecord(record) && record.schema === "product-research-record.v1") {
    const latest = isRecord(record.latestDecision) ? record.latestDecision : null;
    const status = latest && typeof latest.status === "string" ? latest.status : "";
    if (status === "creative_ready" || status === "needs_information" || status === "abandoned") {
      return status;
    }
  }
  return null;
}

/** 统一生命周期分类（/research 与 /tasks 共用；Sidebar highlight / Breadcrumb 复用） */
export function classifyResearchLifecycle(input: ResearchLifecycleInput): {
  lifecycle: ResearchLifecycle;
  detail: ResearchLifecycleDetail;
} {
  // V3 Current Research Normalization：完成标记优先（同一 Task 的 lifecycle 收口）
  const completion = readResearchCompletion(input.result);
  if (completion === "completed") {
    return { lifecycle: "historical", detail: "historical_completed" };
  }
  if (completion === "abandoned") {
    return { lifecycle: "historical", detail: "historical_abandoned" };
  }
  const decision = readVersionedDecision(input.result);
  if (decision === "abandoned") {
    return { lifecycle: "historical", detail: "historical_abandoned" };
  }
  if (decision === "creative_ready") {
    return { lifecycle: "active", detail: "active_creative" };
  }
  if (decision === "needs_information") {
    return { lifecycle: "active", detail: "active_need_info" };
  }
  // 旧版决策语义
  if (input.decisionStatus === "rejected") {
    return { lifecycle: "historical", detail: "historical_abandoned" };
  }
  if (input.decisionStatus === "pending" || input.decisionStatus === "continue" || input.decisionStatus === "need_info") {
    return { lifecycle: "active", detail: "active_open" };
  }
  // defensive：无活跃决定语义的旧批次（当前真实数据不命中）
  return { lifecycle: "historical", detail: "historical_legacy" };
}

/** 是否属于"商品研究"（active）——/research 列表过滤 */
export function isActiveResearch(input: ResearchLifecycleInput): boolean {
  return classifyResearchLifecycle(input).lifecycle === "active";
}

/** 是否属于"研究记录"（historical）——/tasks 列表过滤 */
export function isHistoricalResearch(input: ResearchLifecycleInput): boolean {
  return classifyResearchLifecycle(input).lifecycle === "historical";
}

/** 分页失败与保护上限触发的显式失败信号（fail-closed）。 */
export class ProductResearchTasksUnavailableError extends Error {
  constructor(readonly reason: string) {
    super("product_research_tasks_unavailable");
    this.name = "ProductResearchTasksUnavailableError";
  }
}

/**
 * §2.5 完整分页读取直到 hasMore=false（不只读前 50 条静默聚合）。
 * fail-closed：任意页无效（null / 结构错误 / 网络错误）或保护上限触发 → 抛错，
 * 绝不返回已收集的部分数据。
 */
export async function collectPagedTasks<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; hasMore: boolean } | null>,
): Promise<T[]> {
  const collected: T[] = [];
  const size = 50;
  const MAX_PAGE_COUNT = 200;
  let offset = 0;
  let pageCount = 0;
  for (;;) {
    if (pageCount >= MAX_PAGE_COUNT) {
      throw new ProductResearchTasksUnavailableError("分页保护上限触发（>200 页）");
    }
    const page = await fetchPage(offset);
    if (!page) {
      throw new ProductResearchTasksUnavailableError("分页读取失败（offset=" + offset + "）");
    }
    collected.push(...page.items);
    if (!page.hasMore) return collected;
    offset += size;
    pageCount += 1;
  }
}



/* ── 轮 6：/ 与 /research 共享的三组状态分类器（not_started ≠ AI 研究中） ── */

import type { DecisionStatus } from "@/lib/tasks/decisionStatus";
import { deriveResearchHistoryStatus } from "@/lib/taskResearchHistoryPresentation";

export type ProductProjectGroup = "needs_action" | "researching" | "completed";

export type ProductProjectGroupView = {
  group: ProductProjectGroup;
  statusLabel: string;
  nextLabel: string;
};

/**
 * 工作台与商品研究列表共用的项目状态分类（唯一口径）：
 * 1) stale 最高优先 → 需要我处理；
 * 2) 仅 AI run=running → AI 研究中；waiting → 需要我处理（AI 等待处理不算研究中）；
 * 3) failed_recoverable / failed_terminal / cancelled → 需要我处理（优先于旧研究/决定）；
 * 4) 研究+人工决定已保存且无终态失败 → 已完成；否则 → 需要我处理。
 * not_started / 无 run 一律不算 AI 研究中。
 */
export function deriveProductProjectGroup(input: {
  aiRunStatus?: string | null;
  decisionStatus: DecisionStatus;
  result: unknown;
  oneLineSummary: string;
}): ProductProjectGroupView {
  const runStatus = typeof input.aiRunStatus === "string" ? input.aiRunStatus : "";
  if (runStatus === "research_stale") {
    return { group: "needs_action", statusLabel: "研究资料需重新确认", nextLabel: "重新确认研究资料" };
  }
  if (runStatus === "running") {
    return { group: "researching", statusLabel: "AI 正在研究", nextLabel: "查看研究进度" };
  }
  if (runStatus === "waiting") {
    return { group: "needs_action", statusLabel: "研究等待处理", nextLabel: "查看研究进度" };
  }
  if (runStatus === "failed_recoverable" || runStatus === "failed_terminal") {
    return { group: "needs_action", statusLabel: "研究失败，待处理", nextLabel: "补充研究资料" };
  }
  if (runStatus === "cancelled") {
    return { group: "needs_action", statusLabel: "研究已取消，待处理", nextLabel: "重新发起研究" };
  }
  const researchStatus = deriveResearchHistoryStatus({
    result: input.result,
    decisionStatus: input.decisionStatus,
    oneLineSummary: input.oneLineSummary,
  });
  if (researchStatus.key === "abandoned") {
    return { group: "completed", statusLabel: "已放弃", nextLabel: "查看研究记录" };
  }
  if (researchStatus.key === "completed") {
    return { group: "completed", statusLabel: researchStatus.label, nextLabel: "查看研究结果" };
  }
  if (researchStatus.key === "awaiting_decision") {
    return { group: "needs_action", statusLabel: researchStatus.label, nextLabel: "查看并决定" };
  }
  return { group: "needs_action", statusLabel: researchStatus.label, nextLabel: "补充研究资料" };
}
