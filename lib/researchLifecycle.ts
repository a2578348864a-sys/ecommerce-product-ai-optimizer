/**
 * V3 Final Interaction Correction — R5：Research Lifecycle 统一分类器
 *
 * 任务 39 节：不按创建时间区分；按正式 research lifecycle / decision state。
 *
 * 真实 domain mapping（代码实证，非猜测）：
 * - 新版 product-research-record.v1 latestDecision.status：
 *   "creative_ready" | "needs_information" | "abandoned"
 * - 旧版 task.decisionStatus：
 *   "pending" | "continue" | "need_info" | "rejected"
 *
 * 分类：
 * - active（商品研究 /research）：
 *   无新版 record 且旧版状态 ∈ {pending, continue, need_info}（研究尚未结束/待补）
 *   或 新版 record 且 latestDecision ∈ {creative_ready, needs_information}
 *   —— creative_ready 仍属"研究中"：决定可随时重开（ProductResearchDecisionPanel
 *      支持 creative_ready ↔ needs_information ↔ abandoned 双向流转），且用户
 *      需要从"商品研究"找回刚决定完继续创作的任务；研究记录只放已终结历史。
 * - historical（研究记录 /tasks）：
 *   旧版 rejected（已淘汰）或 新版 abandoned（放弃研究）
 *   或 旧版历史批次（无 researchRecord 且无活跃决定语义——见 legacy 判定）
 *
 * legacy 判定（任务 40 节）：candidate_research / 历史批次默认归研究记录，
 * 除非其真实生命周期明确仍 active（decisionStatus ∈ pending/continue/need_info）。
 */

export type ResearchLifecycle = "active" | "historical";

export type ResearchLifecycleDetail =
  | "active_open"        // 无新版 record，旧版状态 ∈ {pending, continue, need_info}
  | "active_creative"    // 新版 record，latestDecision = creative_ready
  | "active_need_info"   // 新版 record，latestDecision = needs_information
  | "historical_abandoned" // 新版 abandoned 或旧版 rejected
  | "historical_legacy"; // 旧版历史批次（无活跃决定语义）

export type ResearchLifecycleInput = {
  decisionStatus: string;
  result: Record<string, unknown> | null;
  type?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  // 无活跃决定语义的旧版历史批次（candidate_research 等）→ 历史记录
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
