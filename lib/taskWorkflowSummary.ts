import { getDecisionStatusOption, type DecisionStatus } from "@/lib/tasks/decisionStatus";

export type TaskWorkflowSummaryInput = {
  type?: string | null;
  title?: string | null;
  materialText?: string | null;
  oneLineSummary?: string | null;
  level?: string | null;
  decisionStatus?: DecisionStatus | null;
  result: unknown;
};

export type TaskWorkflowSummary = {
  productName: string;
  verdictLabel: string;
  riskLabel: string;
  riskTone: "emerald" | "amber" | "rose" | "slate";
  beginnerLabel: string;
  smallBatchLabel: string;
  primaryNextAction: string;
  nextActions: string[];
  priorityLabel: string;
  priorityTone: "emerald" | "amber" | "rose" | "slate";
  reason: string;
  missingFields: string[];
  batchMeta: {
    batchId: string;
    batchName: string;
    batchIndex: number;
    batchTotal: number;
    source: string;
  } | null;
};

export type TaskSourceMeta = {
  source: "opportunity";
  opportunityTitle: string;
  opportunitySource?: string;
  opportunityScore?: number;
  keyword?: string;
  importedAt?: string;
  /** Phase 4-E.1: enhanced candidate context */
  candidateType?: string;
  sourceUrl?: string;
  candidateId?: string;
};

const DEFAULT_WORKFLOW_ACTIONS = [
  "联系供应商确认 MOQ、报价和发货周期",
  "核查侵权、认证、平台规则和售后风险",
  "核算到岸成本、平台佣金和最低毛利",
  "小单测试前由人工确认是否继续",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown, limit = 5) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, limit)
    : [];
}

function getFinalReport(result: unknown) {
  if (!isRecord(result)) return null;
  return isRecord(result.finalReport) ? result.finalReport : null;
}

export function getTaskBatchMeta(result: unknown): TaskWorkflowSummary["batchMeta"] {
  if (!isRecord(result) || !isRecord(result.batchMeta)) return null;
  const batchId = text(result.batchMeta.batchId);
  const batchName = text(result.batchMeta.batchName);
  const source = text(result.batchMeta.source);
  const batchIndex = result.batchMeta.batchIndex;
  const batchTotal = result.batchMeta.batchTotal;
  if (!batchId || typeof batchIndex !== "number" || typeof batchTotal !== "number") return null;
  if (!Number.isFinite(batchIndex) || !Number.isFinite(batchTotal)) return null;
  return {
    batchId,
    batchName: batchName || "批量分析",
    batchIndex,
    batchTotal,
    source: source || "workflow_batch_mvp",
  };
}

function boundedNumber(value: unknown, min: number, max: number) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

export function getTaskSourceMeta(result: unknown): TaskSourceMeta | null {
  if (!isRecord(result) || !isRecord(result.sourceMeta)) return null;
  if (text(result.sourceMeta.source) !== "opportunity") return null;

  const opportunityTitle = text(result.sourceMeta.opportunityTitle) || text(isRecord(result) ? result.productName : "");
  if (!opportunityTitle) return null;

  const opportunitySource = text(result.sourceMeta.opportunitySource);
  const keyword = text(result.sourceMeta.keyword);
  const importedAt = text(result.sourceMeta.importedAt);
  const opportunityScore = boundedNumber(result.sourceMeta.opportunityScore, 0, 100);
  // Phase 4-E.1: enhanced context
  const candidateType = text(result.sourceMeta.candidateType);
  const sourceUrl = text(result.sourceMeta.sourceUrl);
  const candidateId = text(result.sourceMeta.candidateId);

  return {
    source: "opportunity",
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(opportunityScore !== undefined ? { opportunityScore } : {}),
    ...(keyword ? { keyword } : {}),
    ...(importedAt ? { importedAt } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
  };
}

/** Phase 4-E.1: Derive workflow task lifecycle status from resultJson and reviewState */
export type WorkflowLifecycleStatus = {
  label: string;
  description: string;
  nextAction: string;
  tone: "amber" | "teal" | "emerald" | "slate" | "rose";
};

export function deriveWorkflowLifecycleStatus(
  result: Record<string, unknown> | null | undefined,
  reviewState: Record<string, unknown> | null | undefined,
  decisionStatus: string | null | undefined,
): WorkflowLifecycleStatus {
  // Check review state first
  const allReviewed = reviewState && typeof reviewState.allReviewed === "boolean" ? reviewState.allReviewed : false;
  const reviewedCount = reviewState && typeof reviewState.reviewedCount === "number" ? reviewState.reviewedCount : 0;

  // Decision status overrides
  if (decisionStatus === "abandoned" || decisionStatus === "dismissed") {
    return {
      label: "已放弃",
      description: "该候选已标记为放弃，不再继续推进。",
      nextAction: "如需重新评估，可将状态改回待决策。",
      tone: "slate",
    };
  }

  if (decisionStatus === "approved" || decisionStatus === "selected" || decisionStatus === "ready") {
    return {
      label: "准备推进",
      description: "已通过人工复核，可进入供应商报价、利润测算或准备测款。",
      nextAction: "补充供应商报价、利润测算和 Listing 草稿后再决定是否测款。",
      tone: "emerald",
    };
  }

  // Review-based statuses
  if (!allReviewed && reviewedCount === 0) {
    return {
      label: "待人工复核",
      description: "分析结果已生成，请逐项确认货源、风险、小白结论和 Listing。",
      nextAction: "点击上方步骤逐项复核，全部确认后可标记为已复核。",
      tone: "amber",
    };
  }

  if (!allReviewed && reviewedCount > 0) {
    return {
      label: `复核中（${reviewedCount}/4）`,
      description: `已完成 ${reviewedCount} 个步骤的复核，还需确认剩余 ${4 - reviewedCount} 步。`,
      nextAction: "继续完成剩余步骤的复核后，决定下一步动作。",
      tone: "amber",
    };
  }

  if (allReviewed && !decisionStatus) {
    return {
      label: "待决策",
      description: "四步复核已完成，请根据利润、风险、货源情况决定下一步。",
      nextAction: "选择观察、准备测款或放弃，系统将记录你的决策状态。",
      tone: "teal",
    };
  }

  // Fallback
  return {
    label: "待评估",
    description: "该任务状态未明确，请人工判断后续动作。",
    nextAction: "查看分析结果并完成人工复核后决定下一步。",
    tone: "slate",
  };
}

function getRisk(input: TaskWorkflowSummaryInput, finalReport: Record<string, unknown> | null) {
  const raw = (text(finalReport?.riskLevel) || text(input.level)).toLowerCase();
  if (raw === "green" || raw === "low" || raw.includes("低") || raw.includes("绿")) {
    return { label: "低风险", tone: "emerald" as const };
  }
  if (raw === "red" || raw === "high" || raw.includes("高") || raw.includes("红")) {
    return { label: "高风险", tone: "rose" as const };
  }
  if (raw === "yellow" || raw === "medium" || raw.includes("中") || raw.includes("黄") || raw.includes("需注意")) {
    return { label: "中风险", tone: "amber" as const };
  }
  return { label: "暂无", tone: "slate" as const };
}

function getPriority(
  input: TaskWorkflowSummaryInput,
  riskTone: TaskWorkflowSummary["riskTone"],
  verdictLabel: string,
  canTestSmallBatch: boolean | null,
  missingFields: string[],
) {
  const decision = input.decisionStatus ? getDecisionStatusOption(input.decisionStatus) : null;
  if (input.decisionStatus === "rejected") {
    return { label: "已放弃", tone: "rose" as const, reason: decision?.description || "人工已标记淘汰。" };
  }
  if (input.decisionStatus === "need_info") {
    return { label: "需补资料", tone: "amber" as const, reason: decision?.description || "信息不足，先补齐关键资料。" };
  }
  if (input.decisionStatus === "continue") {
    return { label: "可跟进", tone: "emerald" as const, reason: decision?.description || "人工已初步认可，可以继续推进。" };
  }
  if (riskTone === "rose" || /不建议|暂缓|放弃|淘汰|高风险/.test(verdictLabel)) {
    return { label: "暂缓/谨慎", tone: "rose" as const, reason: "存在高风险或不建议继续的信号，先人工确认。" };
  }
  if (canTestSmallBatch === true || /小单测试|可测试|可跟进|可以继续/.test(verdictLabel)) {
    return { label: "可跟进", tone: "emerald" as const, reason: "AI 结论支持继续验证，但关键动作仍需人工确认。" };
  }
  if (missingFields.length > 0) {
    return { label: "待补资料", tone: "amber" as const, reason: "结果字段不完整，建议先补齐信息再判断。" };
  }
  return { label: "待判断", tone: "slate" as const, reason: "等待人工判断下一步。" };
}

export function deriveTaskWorkflowSummary(input: TaskWorkflowSummaryInput): TaskWorkflowSummary {
  const finalReport = getFinalReport(input.result);
  const missingFields: string[] = [];
  const productName = text(isRecord(input.result) ? input.result.productName : "") || text(input.title) || text(input.materialText) || "暂无";
  const verdictLabel = text(finalReport?.finalVerdict) || text(input.oneLineSummary) || "暂无";
  const risk = getRisk(input, finalReport);
  const beginnerLabel = text(finalReport?.beginnerFit) || "暂无";
  const canTestSmallBatch = booleanValue(finalReport?.canTestSmallBatch);
  const smallBatchLabel = canTestSmallBatch === null ? "暂无" : canTestSmallBatch ? "可小单测试" : "先补充评估";
  const nextActions = stringList(finalReport?.nextSteps, 5);

  if (!finalReport) missingFields.push("finalReport");
  if (!text(finalReport?.finalVerdict)) missingFields.push("finalVerdict");
  if (!text(finalReport?.riskLevel)) missingFields.push("riskLevel");
  if (!text(finalReport?.beginnerFit)) missingFields.push("beginnerFit");
  if (canTestSmallBatch === null) missingFields.push("canTestSmallBatch");
  if (nextActions.length === 0) missingFields.push("nextSteps");

  const safeActions = nextActions.length > 0
    ? nextActions
    : input.type === "workflow"
      ? DEFAULT_WORKFLOW_ACTIONS
      : ["打开详情复核结果，再人工决定是否继续跟进"];
  const priority = getPriority(input, risk.tone, verdictLabel, canTestSmallBatch, missingFields);

  return {
    productName,
    verdictLabel,
    riskLabel: risk.label,
    riskTone: risk.tone,
    beginnerLabel,
    smallBatchLabel,
    primaryNextAction: safeActions[0] || "打开详情复核结果",
    nextActions: safeActions,
    priorityLabel: priority.label,
    priorityTone: priority.tone,
    reason: priority.reason,
    missingFields,
    batchMeta: getTaskBatchMeta(input.result),
  };
}

export function toneClass(tone: TaskWorkflowSummary["riskTone"] | TaskWorkflowSummary["priorityTone"]) {
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "rose") return "border-rose-200 bg-rose-50 text-rose-700";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}
