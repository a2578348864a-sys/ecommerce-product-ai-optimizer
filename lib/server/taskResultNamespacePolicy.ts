import "server-only";

export const SYSTEM_MANAGED_TASK_RESULT_KEYS = Object.freeze([
  "researchRecord",
  "researchVerification",
  "researchHash",
  "decisionEvents",
  "productLifecycle",
  "listingPackSnapshot",
  "aiListing",
  "aiListingPackSnapshot",
  "aiImageDraftSnapshot",
  "imageHandoffBinding",
  "listingHandoffBinding",
  "creativeHandoff",
  "creativeHandoffRequestLedger",
  "candidateToTask",
  "candidateAnalysisContext",
  "r22CommercialValidation",
  "productBatchBinding",
  "decisionEvidence",
  "humanDecision",
  "agentOutputSnapshot",
  "reviewState",
  "sourceMeta",
  "researchMode",
  "promotionEligible",
  "profitSnapshot",
  "riskReviewSnapshot",
  "agentRunSnapshot",
  "listingPrepSnapshot",
] as const);

export type SystemManagedTaskResultKey = typeof SYSTEM_MANAGED_TASK_RESULT_KEYS[number];

export class TaskResultNamespacePolicyError extends Error {
  readonly code = "reserved_system_namespace";

  constructor(public readonly key: SystemManagedTaskResultKey) {
    super("系统管理的任务结果字段不能通过通用创建接口写入。");
    this.name = "TaskResultNamespacePolicyError";
  }
}

export function assertGenericTaskResultAllowed(result: Record<string, unknown>): void {
  for (const key of SYSTEM_MANAGED_TASK_RESULT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new TaskResultNamespacePolicyError(key);
    }
  }
}
