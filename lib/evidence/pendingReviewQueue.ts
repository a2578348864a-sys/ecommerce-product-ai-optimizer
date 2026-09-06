/**
 * Pending 审查队列与 Needs User 队列纯函数聚合逻辑
 *
 * 核心契约：
 * 1. 待确认队列（derivePendingReviewQueue）：
 *    - 仅当 source.status === "awaiting_confirmation" 时进入待确认队列；
 *    - ready, running, needs_user, failed 绝对不进入待确认队列；
 *    - 提供规范的文案、条数、tab 导航以及无前导 # 的干净 DOM anchorId。
 * 2. 需要处理队列（deriveNeedsUserQueue）：
 *    - 仅当 source.status === "needs_user" 时进入需要处理队列；
 *    - ready, running, awaiting_confirmation, failed 绝对不进入 needs_user 队列；
 *    - 规范映射 reasonText 与 actionLabel。
 * 3. 红线：
 *    - 纯函数无副作用，严禁调用 LLM，严禁 autoConfirm / autoSave；
 *    - 严禁任何外部 HTTP 请求。
 */

import type { ResearchOrchestratorSources } from "@/lib/server/researchCollectionOrchestrator";

export type PendingQueueItem = {
  sourceKey: "amazon" | "keywords_competitors" | "voc" | "sourcing_1688";
  backendKey: "amazon" | "keywordCompetitor" | "voc" | "sourcing1688";
  title: string;
  countText: string;
  previewId?: string | null;
  actionLabel: string; // 默认 "查看并确认"
  tabKey: "market" | "buyers" | "sourcing";
  anchorId: string; // 干净的 DOM id，无前导 #
};

export type NeedsUserQueueItem = {
  sourceKey: "amazon" | "keywords_competitors" | "voc" | "sourcing_1688";
  backendKey: "amazon" | "keywordCompetitor" | "voc" | "sourcing1688";
  title: string;
  reasonText: string;
  actionLabel: string; // 如 "前往处理" 或 "前往登录"
  tabKey: "market" | "buyers" | "sourcing";
  anchorId: string; // 干净的 DOM id，无前导 #
};

/**
 * 确保 anchorId 无前导 #
 */
function cleanAnchorId(id: string): string {
  return id.replace(/^#+/, "").trim();
}

/**
 * 根据 message 智能解析 needs_user 的 actionLabel
 */
function resolveNeedsUserActionLabel(message?: string): string {
  if (!message) return "前往处理";
  if (message.includes("选择采集方式")) {
    return "前往处理";
  }
  if (/未登录|请登录|需要登录/i.test(message)) {
    return "前往登录";
  }
  return "前往处理";
}

/**
 * 派生待确认队列（Pending Review Queue）
 * 仅 status === "awaiting_confirmation" 的来源进入此队列
 */
export function derivePendingReviewQueue(
  sources: ResearchOrchestratorSources | Partial<ResearchOrchestratorSources> | undefined | null,
): PendingQueueItem[] {
  if (!sources) return [];

  const queue: PendingQueueItem[] = [];

  // 1. Amazon 商品资料
  if (sources.amazon?.status === "awaiting_confirmation") {
    queue.push({
      sourceKey: "amazon",
      backendKey: "amazon",
      title: "Amazon 商品资料",
      countText: "1 项页面证据待确认",
      previewId: sources.amazon.previewId ?? null,
      actionLabel: "查看并确认",
      tabKey: "market",
      anchorId: cleanAnchorId("workbench-browser-evidence"),
    });
  }

  // 2. 关键词与竞品
  if (sources.keywordCompetitor?.status === "awaiting_confirmation") {
    const count = sources.keywordCompetitor.itemCount || 5;
    queue.push({
      sourceKey: "keywords_competitors",
      backendKey: "keywordCompetitor",
      title: "关键词与竞品",
      countText: `${count} 项采集结果等待确认`,
      previewId: sources.keywordCompetitor.previewId ?? null,
      actionLabel: "查看并确认",
      tabKey: "market",
      anchorId: cleanAnchorId("formal-v2-market-evidence"),
    });
  }

  // 3. 买家评论 / VOC
  if (sources.voc?.status === "awaiting_confirmation") {
    const count = sources.voc.itemCount || 1;
    queue.push({
      sourceKey: "voc",
      backendKey: "voc",
      title: "买家评论 / VOC",
      countText: `${count} 条评论等待确认`,
      previewId: sources.voc.previewId ?? null,
      actionLabel: "查看并确认",
      tabKey: "buyers",
      anchorId: cleanAnchorId("formal-v2-buyer-evidence"),
    });
  }

  // 4. 1688 货源
  if (sources.sourcing1688?.status === "awaiting_confirmation") {
    const count = sources.sourcing1688.itemCount || 1;
    queue.push({
      sourceKey: "sourcing_1688",
      backendKey: "sourcing1688",
      title: "1688 货源",
      countText: `${count} 项候选货源等待确认`,
      previewId: sources.sourcing1688.previewId ?? null,
      actionLabel: "查看并确认",
      tabKey: "sourcing",
      anchorId: cleanAnchorId("formal-v2-sourcing-evidence"),
    });
  }

  return queue;
}

/**
 * 派生需要用户处理队列（Needs User Queue）
 * 仅 status === "needs_user" 的来源进入此队列
 */
export function deriveNeedsUserQueue(
  sources: ResearchOrchestratorSources | Partial<ResearchOrchestratorSources> | undefined | null,
): NeedsUserQueueItem[] {
  if (!sources) return [];

  const queue: NeedsUserQueueItem[] = [];

  // 1. Amazon 商品资料
  if (sources.amazon?.status === "needs_user") {
    const reasonText = sources.amazon.message || "待采集 Amazon 详情资料";
    queue.push({
      sourceKey: "amazon",
      backendKey: "amazon",
      title: "Amazon 商品资料",
      reasonText,
      actionLabel: resolveNeedsUserActionLabel(sources.amazon.message),
      tabKey: "market",
      anchorId: cleanAnchorId("workbench-browser-evidence"),
    });
  }

  // 2. 关键词与竞品
  if (sources.keywordCompetitor?.status === "needs_user") {
    const reasonText = sources.keywordCompetitor.message || "待采集关键词与竞品资料";
    queue.push({
      sourceKey: "keywords_competitors",
      backendKey: "keywordCompetitor",
      title: "关键词与竞品",
      reasonText,
      actionLabel: resolveNeedsUserActionLabel(sources.keywordCompetitor.message),
      tabKey: "market",
      anchorId: cleanAnchorId("formal-v2-market-evidence"),
    });
  }

  // 3. 买家评论 / VOC
  if (sources.voc?.status === "needs_user") {
    const reasonText = sources.voc.message || "待采集买家评论";
    queue.push({
      sourceKey: "voc",
      backendKey: "voc",
      title: "买家评论 / VOC",
      reasonText,
      actionLabel: resolveNeedsUserActionLabel(sources.voc.message),
      tabKey: "buyers",
      anchorId: cleanAnchorId("formal-v2-buyer-evidence"),
    });
  }

  // 4. 1688 货源
  if (sources.sourcing1688?.status === "needs_user") {
    const reasonText = sources.sourcing1688.message || "需要登录或选择采集方式";
    queue.push({
      sourceKey: "sourcing_1688",
      backendKey: "sourcing1688",
      title: "1688 货源",
      reasonText,
      actionLabel: resolveNeedsUserActionLabel(sources.sourcing1688.message),
      tabKey: "sourcing",
      anchorId: cleanAnchorId("formal-v2-sourcing-evidence"),
    });
  }

  return queue;
}
