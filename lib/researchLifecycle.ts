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
