import {
  extractAgentRunSnapshot,
  extractListingPrepSnapshot,
  type AgentRunStep,
} from "@/lib/agentRunSnapshot";

export type AgentRunTimelineStatus = "completed" | "pending" | "warning" | "unavailable";

export type AgentRunTimelineItem = {
  key: string;
  label: string;
  status: AgentRunTimelineStatus;
  summary: string;
  evidence?: string;
};

type TimelineInput = {
  result: unknown;
  decisionStatus?: string | null;
};

const PENDING_DECISIONS = new Set(["pending", "need_info", ""]);
const COMPLETED_DECISIONS = new Set(["continue", "rejected", "watchlist", "archived"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function texts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function hasMeaningfulRecord(record: Record<string, unknown> | null): boolean {
  return !!record && Object.values(record).some((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined;
  });
}

function getStep(result: Record<string, unknown>, keys: string[]): AgentRunStep | null {
  const snapshot = extractAgentRunSnapshot(result);
  const snapshotStep = snapshot?.steps.find((step) => keys.includes(step.key));
  if (snapshotStep) return snapshotStep;

  const rawSteps = Array.isArray(result.steps) ? result.steps : [];
  for (const rawStep of rawSteps) {
    if (!isRecord(rawStep)) continue;
    const key = text(rawStep.key);
    if (!keys.includes(key)) continue;
    return {
      key,
      label: text(rawStep.label) || key,
      status: normalizeRawStepStatus(text(rawStep.status)),
      summary: text(rawStep.summary),
    };
  }

  return null;
}

function normalizeRawStepStatus(status: string): AgentRunStep["status"] {
  if (status === "running") return "running";
  if (status === "needs_manual_review") return "needs_manual_review";
  if (status === "warning") return "warning";
  if (status === "failed") return "failed";
  if (status === "not_started") return "not_started";
  return "completed";
}

function timelineStatusFromStep(step: AgentRunStep | null): AgentRunTimelineStatus {
  if (!step) return "unavailable";
  if (step.status === "completed") return "completed";
  if (step.status === "warning" || step.status === "failed" || step.status === "needs_manual_review") return "warning";
  return "pending";
}

function sourceSummary(result: Record<string, unknown>): AgentRunTimelineItem {
  const sourceMeta = recordAt(result, "sourceMeta");
  const productName = text(result.productName) || text(result.title) || text(result.productTitle);
  const candidateId = text(sourceMeta?.candidateId);
  const sourceName = text(sourceMeta?.opportunitySource) || text(sourceMeta?.entry);

  if (sourceMeta || productName) {
    return {
      key: "source",
      label: "接收商品 / 候选来源",
      status: "completed",
      summary: productName || "已接收候选来源信息",
      evidence: candidateId || sourceName || undefined,
    };
  }

  return {
    key: "source",
    label: "接收商品 / 候选来源",
    status: "unavailable",
    summary: "旧任务未保存来源字段",
  };
}

function stepItem(input: {
  key: string;
  label: string;
  step: AgentRunStep | null;
  fallbackRecord?: Record<string, unknown> | null;
  fallbackSummary: string;
  warningWhenRisky?: boolean;
}): AgentRunTimelineItem {
  const hasFallback = hasMeaningfulRecord(input.fallbackRecord ?? null);
  let status = timelineStatusFromStep(input.step);
  if (status === "unavailable" && hasFallback) status = "completed";
  if (input.warningWhenRisky && status === "completed") status = "warning";

  return {
    key: input.key,
    label: input.label,
    status,
    summary: input.step?.summary || (hasFallback ? input.fallbackSummary : "当前任务未保存该阶段明细"),
  };
}

function getRiskWarning(result: Record<string, unknown>): boolean {
  const snapshot = extractAgentRunSnapshot(result);
  const finalReport = recordAt(result, "finalReport");
  const risk = recordAt(result, "risk");
  const riskLevel = (
    text(snapshot?.riskLevel) ||
    text(finalReport?.riskLevel) ||
    text(risk?.overallLevel) ||
    text(recordAt(result, "riskReviewSnapshot")?.overallLevel)
  ).toLowerCase();
  return ["red", "high", "yellow", "medium", "mid"].includes(riskLevel);
}

function listingItem(result: Record<string, unknown>): AgentRunTimelineItem {
  const listingStep = getStep(result, ["listing"]);
  const hasListingSnapshot = !!extractListingPrepSnapshot(result)
    || hasMeaningfulRecord(recordAt(result, "aiListingPackSnapshot"))
    || hasMeaningfulRecord(recordAt(result, "listingPackSnapshot"))
    || hasMeaningfulRecord(recordAt(result, "listing"));

  let status = timelineStatusFromStep(listingStep);
  if (status === "unavailable") status = hasListingSnapshot ? "completed" : "pending";

  return {
    key: "listing",
    label: "Listing 草稿",
    status,
    summary: listingStep?.summary || (hasListingSnapshot ? "已生成或保存 Listing 草稿包" : "尚未保存 Listing 草稿"),
  };
}

function manualReviewItem(result: Record<string, unknown>, decisionStatus: string): AgentRunTimelineItem {
  const snapshot = extractAgentRunSnapshot(result);
  const reviewState = recordAt(result, "reviewState");
  const allReviewed = reviewState?.allReviewed === true;
  const manualConfirmed = snapshot?.manualConfirmed === true || allReviewed;
  const normalizedDecision = decisionStatus.trim();

  if (manualConfirmed || COMPLETED_DECISIONS.has(normalizedDecision)) {
    return {
      key: "manual_review",
      label: "人工复核",
      status: "completed",
      summary: manualConfirmed ? "关键检查项已人工确认" : "已形成运营决策",
    };
  }

  return {
    key: "manual_review",
    label: "人工复核",
    status: PENDING_DECISIONS.has(normalizedDecision) ? "pending" : "warning",
    summary: "仍需人工确认风险、利润、货源和 Listing 内容",
  };
}

function nextActionItem(result: Record<string, unknown>, decisionStatus: string): AgentRunTimelineItem {
  const snapshot = extractAgentRunSnapshot(result);
  const finalReport = recordAt(result, "finalReport");
  const nextSteps = snapshot?.nextSteps?.length ? snapshot.nextSteps : texts(finalReport?.nextSteps);
  const normalizedDecision = decisionStatus.trim();

  if (nextSteps.length > 0) {
    return {
      key: "next_action",
      label: "下一步建议",
      status: "completed",
      summary: nextSteps.slice(0, 2).join("；"),
    };
  }

  if (COMPLETED_DECISIONS.has(normalizedDecision)) {
    return {
      key: "next_action",
      label: "下一步建议",
      status: "completed",
      summary: "已根据人工决策进入下一步处理",
    };
  }

  return {
    key: "next_action",
    label: "下一步建议",
    status: "pending",
    summary: "等待补充人工决策后再推进",
  };
}

export function deriveAgentRunTimelineItems({ result, decisionStatus }: TimelineInput): AgentRunTimelineItem[] {
  const record = isRecord(result) ? result : {};
  const sourcingStep = getStep(record, ["sourcing"]);
  const riskStep = getStep(record, ["risk"]);

  return [
    sourceSummary(record),
    stepItem({
      key: "normalize",
      label: "数据清洗",
      step: getStep(record, ["normalize"]),
      fallbackRecord: recordAt(record, "normalized"),
      fallbackSummary: "已整理商品输入和关键字段",
    }),
    stepItem({
      key: "sourcing",
      label: "货源判断",
      step: sourcingStep,
      fallbackRecord: recordAt(record, "sourcing") || recordAt(record, "profitSnapshot"),
      fallbackSummary: "已评估货源、成本或利润信息",
      warningWhenRisky: sourcingStep?.status === "failed" || sourcingStep?.status === "warning",
    }),
    stepItem({
      key: "risk",
      label: "风险预筛",
      step: riskStep,
      fallbackRecord: recordAt(record, "risk") || recordAt(record, "riskReviewSnapshot"),
      fallbackSummary: "已生成风险预筛结果",
      warningWhenRisky: getRiskWarning(record),
    }),
    listingItem(record),
    manualReviewItem(record, decisionStatus || ""),
    nextActionItem(record, decisionStatus || ""),
  ];
}
