import type { OpportunityCandidatePoolItem } from "@/lib/opportunityCandidatePool";
import { deriveTaskWorkflowSummary } from "@/lib/taskWorkflowSummary";
import { normalizeDecisionStatus, type DecisionStatus } from "@/lib/tasks/decisionStatus";

export const WORKFLOW_SINGLE_RUN_STORAGE_KEY = "qx:workflow-single-run:v1";
export const WORKFLOW_SINGLE_RUN_TTL_MS = 2 * 60 * 60 * 1000;

export type HomeDashboardTaskItem = {
  id?: string;
  type?: string | null;
  title?: string | null;
  materialText?: string | null;
  oneLineSummary?: string | null;
  level?: string | null;
  decisionStatus?: DecisionStatus | null;
  result: unknown;
};

export type CandidatePoolSummary = {
  total: number;
  worthAnalyzing: number;
  pausedOrHighRisk: number;
  pending: number;
  analyzed: number;
  rejected: number;
};

export type TaskFollowUpSummary = {
  total: number;
  pendingReview: number;
  followable: number;
};

export type RecentSingleRunSummary = {
  productName: string;
  completedAt: number | null;
  hasResult: boolean;
  savedTaskId: string | null;
} | null;

export type RecommendedNextAction = {
  title: string;
  description: string;
  href: "/opportunities" | "/workflow" | "/tasks";
  cta: string;
  priority: "candidate_pool" | "tasks" | "recent_analysis" | "new_user";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function summarizeCandidatePool(items: OpportunityCandidatePoolItem[]): CandidatePoolSummary {
  return items.reduce<CandidatePoolSummary>((summary, item) => {
    const riskLevel = item.riskLevel.toLowerCase();
    const isHighRisk = riskLevel === "red" || riskLevel.includes("高");

    return {
      total: summary.total + 1,
      worthAnalyzing: summary.worthAnalyzing + (item.candidateStatus === "worth_analyzing" ? 1 : 0),
      pausedOrHighRisk: summary.pausedOrHighRisk + (item.candidateStatus === "paused" || isHighRisk ? 1 : 0),
      pending: summary.pending + (item.candidateStatus === "pending" ? 1 : 0),
      analyzed: summary.analyzed + (item.candidateStatus === "analyzed" ? 1 : 0),
      rejected: summary.rejected + (item.candidateStatus === "rejected" ? 1 : 0),
    };
  }, {
    total: 0,
    worthAnalyzing: 0,
    pausedOrHighRisk: 0,
    pending: 0,
    analyzed: 0,
    rejected: 0,
  });
}

export function summarizeTaskFollowUp(items: HomeDashboardTaskItem[]): TaskFollowUpSummary {
  return items.reduce<TaskFollowUpSummary>((summary, item) => {
    const decisionStatus = normalizeDecisionStatus(item.decisionStatus);
    const taskSummary = deriveTaskWorkflowSummary({
      type: item.type,
      title: item.title,
      materialText: item.materialText,
      oneLineSummary: item.oneLineSummary,
      level: item.level,
      decisionStatus,
      result: item.result,
    });

    const isWorkflow = item.type === "workflow";
    const needsReview = decisionStatus === "pending"
      || (isWorkflow && taskSummary.missingFields.length > 0);
    const followable = taskSummary.priorityLabel === "可跟进";

    return {
      total: summary.total + 1,
      pendingReview: summary.pendingReview + (needsReview ? 1 : 0),
      followable: summary.followable + (followable ? 1 : 0),
    };
  }, {
    total: 0,
    pendingReview: 0,
    followable: 0,
  });
}

export function parseRecentSingleRun(raw: string | null, now = Date.now()): RecentSingleRunSummary {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.value)) return null;
    const updatedAt = numberOrNull(parsed.updatedAt);
    if (!updatedAt || now - updatedAt > WORKFLOW_SINGLE_RUN_TTL_MS) return null;

    const run = parsed.value;
    const productName = text(run.productName);
    const hasResult = isRecord(run.result);
    if (!productName && !hasResult) return null;

    const savedTaskId = text(run.savedTaskId) || null;

    return {
      productName: productName || text(isRecord(run.result) ? run.result.productName : "") || "未命名单品",
      completedAt: numberOrNull(run.completedAt) ?? updatedAt,
      hasResult,
      savedTaskId,
    };
  } catch {
    return null;
  }
}

export function getRecommendedNextAction(input: {
  candidatePool: CandidatePoolSummary;
  tasks: TaskFollowUpSummary | null;
  recentSingleRun: RecentSingleRunSummary;
}): RecommendedNextAction {
  if (input.candidatePool.worthAnalyzing > 0) {
    return {
      title: `先深挖 ${input.candidatePool.worthAnalyzing} 个值得分析的候选品`,
      description: "候选池里已经有可继续判断的商品，先选一个进入单品分析。",
      href: "/opportunities",
      cta: "去候选池",
      priority: "candidate_pool",
    };
  }

  if (input.tasks && input.tasks.pendingReview > 0) {
    return {
      title: `先处理 ${input.tasks.pendingReview} 个待复核任务`,
      description: "任务中心里还有等待人工判断的结果，先复核再决定是否继续。",
      href: "/tasks",
      cta: "去任务中心",
      priority: "tasks",
    };
  }

  if (input.recentSingleRun?.hasResult && !input.recentSingleRun.savedTaskId) {
    return {
      title: "先保存最近一次单品分析",
      description: `${input.recentSingleRun.productName} 已有分析结果，建议保存到任务中心继续跟进。`,
      href: "/workflow",
      cta: "继续单品分析",
      priority: "recent_analysis",
    };
  }

  return {
    title: "先从机会雷达添加 2-3 个候选品",
    description: "没有明确商品时，先建立候选池，再挑一个商品深挖。",
    href: "/opportunities",
    cta: "去找机会",
    priority: "new_user",
  };
}
