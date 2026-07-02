import { getRiskFlagLabel } from "@/lib/candidateEvidence";
import { extractAgentOutputSnapshotFromTask } from "@/lib/agentOutputSnapshot";
import { getTaskSourceMeta, type TaskWorkflowSummaryInput } from "@/lib/taskWorkflowSummary";

export type TaskOperationStage =
  | "needs_review"
  | "verify_supplier"
  | "check_compliance"
  | "prepare_listing"
  | "small_batch_test"
  | "watch"
  | "abandoned"
  | "unknown";

export type TaskOperationDecision = "recommended" | "cautious" | "not_recommended" | "unknown";
export type TaskOperationRiskLevel = "low" | "medium" | "high" | "unknown";
export type TaskListingReadiness = "ready" | "partial" | "missing" | "unknown";

export type TaskOperationSummary = {
  stage: TaskOperationStage;
  stageLabel: string;
  decision: TaskOperationDecision;
  decisionLabel: string;
  riskLevel: TaskOperationRiskLevel;
  riskLabel: string;
  primaryAction: string;
  actionLabel: string;
  blockingIssues: string[];
  reviewFocus: string[];
  evidenceSummary: string;
  agentReason: string;
  listingReadiness: TaskListingReadiness;
  listingReadinessLabel: string;
  sourceQualityScore?: number;
  confidence?: "low" | "medium" | "high";
  fallbackUsed: boolean;
  warnings: string[];
};

const STAGE_LABELS: Record<TaskOperationStage, string> = {
  needs_review: "待人工复核",
  verify_supplier: "核实供应商",
  check_compliance: "核查合规风险",
  prepare_listing: "准备 Listing",
  small_batch_test: "小批量测试",
  watch: "观察数据",
  abandoned: "已放弃",
  unknown: "历史任务未记录标准化运营推进摘要",
};

const DECISION_LABELS: Record<TaskOperationDecision, string> = {
  recommended: "建议推进",
  cautious: "谨慎推进",
  not_recommended: "不建议推进",
  unknown: "待人工判断",
};

const RISK_LABELS: Record<TaskOperationRiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "风险未知",
};

const LISTING_LABELS: Record<TaskListingReadiness, string> = {
  ready: "已准备",
  partial: "部分完成",
  missing: "缺失",
  unknown: "历史任务未记录",
};

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function uniqueLimited(values: unknown[], limit = 5) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = text(value);
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function decisionFromEvidence(value: unknown): TaskOperationDecision {
  if (value === "recommended") return "recommended";
  if (value === "cautious") return "cautious";
  if (value === "rejected") return "not_recommended";
  return "unknown";
}

function normalizeDecision(value: unknown): TaskOperationDecision {
  if (value === "recommended" || value === "cautious" || value === "not_recommended") return value;
  return "unknown";
}

function normalizeRisk(value: unknown): TaskOperationRiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  const raw = text(value).toLowerCase();
  if (raw === "green" || raw.includes("低")) return "low";
  if (raw === "yellow" || raw === "medium" || raw.includes("中") || raw.includes("黄")) return "medium";
  if (raw === "red" || raw === "high" || raw.includes("高") || raw.includes("红")) return "high";
  return "unknown";
}

function arrayOfText(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function deriveListingReadiness(snapshot: ReturnType<typeof extractAgentOutputSnapshotFromTask>): TaskListingReadiness {
  if (!snapshot) return "unknown";
  const listing = snapshot.listingSnapshot;
  const hasTitle = Boolean(text(listing.titleDraft));
  const hasBullets = listing.bulletDrafts.length > 0;
  const hasKeywords = listing.keywordHints.length > 0;
  const missingInputs = listing.missingInputs.length > 0;
  if (hasTitle && hasBullets && hasKeywords && !missingInputs) return "ready";
  if (hasTitle || hasBullets || hasKeywords || missingInputs) return "partial";
  return "missing";
}

function deriveStage(input: {
  decision: TaskOperationDecision;
  riskLevel: TaskOperationRiskLevel;
  primaryAction: string;
  humanReviewRequired: boolean;
}): TaskOperationStage {
  if (input.humanReviewRequired) return "needs_review";
  if (input.riskLevel === "high") return "check_compliance";
  if (input.primaryAction === "verify_supplier") return "verify_supplier";
  if (input.primaryAction === "check_compliance") return "check_compliance";
  if (input.primaryAction === "prepare_listing") return "prepare_listing";
  if (input.primaryAction === "small_batch_test") return "small_batch_test";
  if (input.primaryAction === "watch") return "watch";
  if (input.primaryAction === "abandon" || input.decision === "not_recommended") return "abandoned";
  if (input.primaryAction === "manual_review") return "needs_review";
  return "unknown";
}

function fallbackPrimaryAction(decision: TaskOperationDecision) {
  if (decision === "recommended") return { primaryAction: "prepare_listing", actionLabel: "准备 Listing 并人工确认" };
  if (decision === "cautious") return { primaryAction: "manual_review", actionLabel: "先人工复核" };
  if (decision === "not_recommended") return { primaryAction: "abandon", actionLabel: "暂不推进" };
  return { primaryAction: "unknown", actionLabel: "打开详情人工判断" };
}

export function deriveTaskOperationSummary(input: TaskWorkflowSummaryInput): TaskOperationSummary {
  const agentSnapshot = extractAgentOutputSnapshotFromTask(input.result);
  const sourceMeta = getTaskSourceMeta(input.result);
  const evidence = agentSnapshot?.candidateEvidence || sourceMeta?.evidenceSnapshot || null;
  const warnings: string[] = [];

  const decision = agentSnapshot
    ? normalizeDecision(agentSnapshot.summarySnapshot.decision)
    : decisionFromEvidence(evidence && "decision" in evidence ? evidence.decision : undefined);

  const riskLevel = agentSnapshot
    ? normalizeRisk(agentSnapshot.riskSnapshot.riskLevel)
    : evidence && Array.isArray(evidence.riskFlags) && evidence.riskFlags.length > 0
      ? "medium"
      : normalizeRisk(input.level);

  const nextAction = agentSnapshot
    ? {
      primaryAction: agentSnapshot.nextActionSnapshot.primaryAction,
      actionLabel: text(agentSnapshot.nextActionSnapshot.actionLabel) || text(agentSnapshot.nextActionSnapshot.suggestedOwnerStep) || "打开详情人工判断",
    }
    : fallbackPrimaryAction(decision);

  const humanReviewRequired = Boolean(agentSnapshot?.humanReviewSnapshot.required);
  const stage = deriveStage({
    decision,
    riskLevel,
    primaryAction: nextAction.primaryAction,
    humanReviewRequired,
  });

  const fallbackUsed = Boolean(!agentSnapshot);
  if (!agentSnapshot && !sourceMeta?.evidenceSnapshot) {
    warnings.push("历史任务未记录标准化运营推进摘要");
  }

  const riskFlagFocus = evidence && Array.isArray(evidence.riskFlags)
    ? evidence.riskFlags.map((flag) => getRiskFlagLabel(flag))
    : [];

  const blockingIssues = agentSnapshot
    ? uniqueLimited([
      ...agentSnapshot.nextActionSnapshot.blockingIssues,
      ...agentSnapshot.humanReviewSnapshot.reasons,
      ...agentSnapshot.riskSnapshot.complianceConcerns,
      ...agentSnapshot.riskSnapshot.logisticsConcerns,
      ...agentSnapshot.sourcingSnapshot.missingInfo,
      ...agentSnapshot.listingSnapshot.missingInputs,
    ], 5)
    : uniqueLimited(riskFlagFocus, 5);

  const reviewFocus = agentSnapshot
    ? uniqueLimited([
      ...agentSnapshot.humanReviewSnapshot.reviewFocus,
      ...agentSnapshot.riskSnapshot.complianceConcerns,
      ...agentSnapshot.riskSnapshot.ipConcerns,
      ...agentSnapshot.riskSnapshot.safetyConcerns,
      ...riskFlagFocus,
    ], 5)
    : uniqueLimited(riskFlagFocus, 5);

  const sourceQualityScore = typeof evidence?.qualityScore === "number"
    ? evidence.qualityScore
    : sourceMeta?.opportunityScore;
  const confidence = evidence?.confidence === "low" || evidence?.confidence === "medium" || evidence?.confidence === "high"
    ? evidence.confidence
    : agentSnapshot?.summarySnapshot.confidence;
  const listingReadiness = deriveListingReadiness(agentSnapshot);

  return {
    stage,
    stageLabel: STAGE_LABELS[stage],
    decision,
    decisionLabel: DECISION_LABELS[decision],
    riskLevel,
    riskLabel: RISK_LABELS[riskLevel],
    primaryAction: nextAction.primaryAction,
    actionLabel: nextAction.actionLabel,
    blockingIssues,
    reviewFocus,
    evidenceSummary: text(evidence?.decisionReason) || text(sourceMeta?.opportunitySource) || "历史任务未记录标准化来源证据",
    agentReason: text(agentSnapshot?.summarySnapshot.decisionReason) || text(input.oneLineSummary) || "历史任务未记录标准化 Agent 结论",
    listingReadiness,
    listingReadinessLabel: LISTING_LABELS[listingReadiness],
    ...(sourceQualityScore !== undefined ? { sourceQualityScore } : {}),
    ...(confidence ? { confidence } : {}),
    fallbackUsed,
    warnings,
  };
}
