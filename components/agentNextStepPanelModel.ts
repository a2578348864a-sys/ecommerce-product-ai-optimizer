import type { DecisionStatus } from "@/lib/tasks/decisionStatus";

type ReviewState = {
  exists: boolean;
  reviewedCount: number;
  totalReviewSteps: number;
  allReviewed: boolean;
};

type BatchMeta = {
  batchIndex: number;
  batchTotal: number;
} | null;

export type AgentNextStepPanelState = {
  stageLabel: string;
  stageDescription: string;
  stageClassName: string;
  reviewState: ReviewState;
  decisionLabel: string;
  riskLevel: "green" | "yellow" | "red" | "unknown";
  riskLabel: string;
  canTestSmallBatch: boolean;
  batchMeta: BatchMeta;
  primarySuggestion: string;
  nextActions: string[];
  manualReviewChecklist: string[];
};

export type AgentNextStepPanelInput = {
  taskType?: string;
  decisionStatus: DecisionStatus;
  result: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getStringArray(value: unknown, maxItems = 6) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, maxItems)
    : [];
}

function getReviewState(result: Record<string, unknown> | null): ReviewState {
  if (!result || !isRecord(result.reviewState)) {
    return { exists: false, reviewedCount: 0, totalReviewSteps: 4, allReviewed: false };
  }

  const reviewedFlags = [
    result.reviewState.sourcingReviewed,
    result.reviewState.riskReviewed,
    result.reviewState.summaryReviewed,
    result.reviewState.listingReviewed,
  ].filter(Boolean).length;
  const totalReviewSteps = Math.max(1, asNumber(result.reviewState.totalReviewSteps, 4));
  const reviewedCount = Math.min(totalReviewSteps, reviewedFlags);

  return {
    exists: true,
    reviewedCount,
    totalReviewSteps,
    allReviewed: reviewedCount >= totalReviewSteps,
  };
}

function getBatchMeta(result: Record<string, unknown> | null): BatchMeta {
  if (!result || !isRecord(result.batchMeta)) return null;
  const batchIndex = result.batchMeta.batchIndex;
  const batchTotal = result.batchMeta.batchTotal;
  if (typeof batchIndex !== "number" || typeof batchTotal !== "number") return null;
  if (!Number.isFinite(batchIndex) || !Number.isFinite(batchTotal)) return null;
  return { batchIndex, batchTotal };
}

function getRiskLevel(value: unknown): AgentNextStepPanelState["riskLevel"] {
  return value === "green" || value === "yellow" || value === "red" ? value : "unknown";
}

function getDecisionLabel(decisionStatus: DecisionStatus) {
  switch (decisionStatus) {
    case "continue":
      return "继续推进";
    case "need_info":
      return "需要补资料";
    case "rejected":
      return "已淘汰 / 暂不推进";
    case "pending":
    default:
      return "待人工决策";
  }
}

function getStage(input: {
  hasFinalReport: boolean;
  decisionStatus: DecisionStatus;
  reviewState: ReviewState;
  riskLevel: AgentNextStepPanelState["riskLevel"];
}) {
  if (!input.hasFinalReport) {
    return {
      label: "待分析 / 数据不足",
      description: "当前任务缺少可用分析结果，需要补资料或重新生成分析后再判断。",
      className: "border-slate-200 bg-slate-50 text-slate-700",
    };
  }

  if (input.decisionStatus === "rejected") {
    return {
      label: "已淘汰 / 暂停推进",
      description: "人工已标记为暂不推进，当前不建议继续投入采购、上架或投放动作。",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }

  if (input.decisionStatus === "need_info") {
    return {
      label: "需补充资料",
      description: "当前信息不足，先补供应商、成本、认证、平台规则等关键资料。",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (!input.reviewState.exists || !input.reviewState.allReviewed) {
    return {
      label: "待人工复核",
      description: "AI 已完成分析，但还不能直接推进。请先完成人工复核门槛。",
      className: "border-amber-200 bg-amber-50 text-amber-700",
    };
  }

  if (input.decisionStatus === "continue") {
    return {
      label: input.riskLevel === "red" ? "可继续推进（需风险复查）" : "可继续推进",
      description: input.riskLevel === "red"
        ? "人工已选择继续，但当前仍是高风险结果，必须先复查合规、认证和平台规则。"
        : "人工已选择继续，下一步仍需线下确认供应链、成本和平台规则。",
      className: input.riskLevel === "red"
        ? "border-rose-200 bg-rose-50 text-rose-700"
        : "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }

  return {
    label: "待人工决策",
    description: "必要复核已完成，请人工决定是继续推进、补资料，还是淘汰。",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  };
}

function buildPrimarySuggestion(input: {
  reviewState: ReviewState;
  decisionStatus: DecisionStatus;
  riskLevel: AgentNextStepPanelState["riskLevel"];
  canTestSmallBatch: boolean;
}) {
  if (input.decisionStatus === "rejected") return "暂停推进，不建议继续投入采购、上架或投放动作。";
  if (input.decisionStatus === "need_info") return "先补充供应商、成本、认证、物流和平台规则资料，再重新判断。";
  if (!input.reviewState.exists) return "当前任务缺少复核状态，请人工确认关键风险后再做决策。";
  if (!input.reviewState.allReviewed) return "先完成 4 步人工复核，再决定是否继续推进。";
  if (input.riskLevel === "red") return "高风险结果不建议小单测试，先暂停并人工复查合规与认证。";
  if (input.riskLevel === "yellow") return "先补充供应链、认证、成本和平台规则信息，再决定是否继续。";
  if (input.riskLevel === "green" && input.canTestSmallBatch) return "可人工决定是否做小单测试，系统不会自动测试或下单。";
  return "复核完成后，请人工选择继续推进、补资料或淘汰。";
}

function buildNextActions(input: {
  reviewState: ReviewState;
  decisionStatus: DecisionStatus;
  riskLevel: AgentNextStepPanelState["riskLevel"];
  canTestSmallBatch: boolean;
  reportNextSteps: string[];
}) {
  const actions: string[] = [];

  actions.push(buildPrimarySuggestion(input));

  if (!input.reviewState.exists || !input.reviewState.allReviewed) {
    actions.push("逐项确认货源判断、风险排查、小白结论和 Listing 文案。");
    actions.push("复核完成前，不要把 AI 结论用于采购、上架或投放。");
    return actions;
  }

  if (input.riskLevel === "red") {
    actions.push("复查侵权、禁售、认证、物流和售后风险，必要时直接淘汰。");
    actions.push("不要做小单测试，不要联系供应商下单。");
    return actions;
  }

  if (input.decisionStatus === "need_info") {
    actions.push("补齐供应商报价、MOQ、样品、运费、认证文件和目标平台规则。");
    actions.push("资料补齐后再回到任务中心重新标记人工决策状态。");
    return actions;
  }

  if (input.decisionStatus === "rejected") {
    actions.push("保留任务记录用于复盘，不再投入新的 AI 调用或运营动作。");
    return actions;
  }

  const safeReportSteps = input.reportNextSteps
    .filter((item) => !/小单|测试|下单|采购/.test(item))
    .slice(0, 3);

  if (safeReportSteps.length) actions.push(...safeReportSteps);
  if (input.riskLevel === "green" && input.canTestSmallBatch) {
    actions.push("如人工确认资源匹配，可线下准备小单测试计划。");
  }
  if (input.riskLevel === "yellow") {
    actions.push("黄色风险下，先补资料和复核平台规则，不要直接进入采购。");
  }

  return Array.from(new Set(actions)).slice(0, 5);
}

export function deriveAgentNextStepPanelState(input: AgentNextStepPanelInput): AgentNextStepPanelState {
  const result = isRecord(input.result) ? input.result : null;
  const finalReport = result && isRecord(result.finalReport) ? result.finalReport : null;
  const reviewState = getReviewState(result);
  const riskLevel = getRiskLevel(finalReport?.riskLevel);
  const canTestSmallBatch = finalReport?.canTestSmallBatch === true;
  const stage = getStage({
    hasFinalReport: Boolean(finalReport),
    decisionStatus: input.decisionStatus,
    reviewState,
    riskLevel,
  });
  const reportNextSteps = getStringArray(finalReport?.nextSteps, 5);
  const manualReviewChecklist = getStringArray(finalReport?.manualReviewChecklist, 6);

  return {
    stageLabel: stage.label,
    stageDescription: stage.description,
    stageClassName: stage.className,
    reviewState,
    decisionLabel: getDecisionLabel(input.decisionStatus),
    riskLevel,
    riskLabel: riskLevel === "green" ? "低风险" : riskLevel === "red" ? "高风险" : riskLevel === "yellow" ? "需注意" : "未知",
    canTestSmallBatch,
    batchMeta: getBatchMeta(result),
    primarySuggestion: buildPrimarySuggestion({
      reviewState,
      decisionStatus: input.decisionStatus,
      riskLevel,
      canTestSmallBatch,
    }),
    nextActions: buildNextActions({
      reviewState,
      decisionStatus: input.decisionStatus,
      riskLevel,
      canTestSmallBatch,
      reportNextSteps,
    }),
    manualReviewChecklist,
  };
}
