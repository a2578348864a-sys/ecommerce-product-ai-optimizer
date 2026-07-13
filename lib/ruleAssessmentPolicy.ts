export const LEGACY_RULE_ASSESSMENT_ALGORITHM = "radar-score-v1";
export const CURRENT_RULE_ASSESSMENT_ALGORITHM = "radar-evidence-v2";

export type SignedSourceCandidateType =
  | "product_candidate"
  | "category_hint"
  | "trend_signal"
  | "rejected";

export type SignedSourceQueueSuggestion = "review" | "watch" | "reject";

export type SignedSourceQueuePolicyReason =
  | "ready_for_review"
  | "manual_watch"
  | "not_product_candidate"
  | "queue_rejected"
  | "unsupported_algorithm";

export type SignedSourceQueuePolicy = {
  canSave: boolean;
  defaultSelected: boolean;
  reason: SignedSourceQueuePolicyReason;
};

const SUPPORTED_STORED_ALGORITHMS = new Set<string>([
  LEGACY_RULE_ASSESSMENT_ALGORITHM,
  CURRENT_RULE_ASSESSMENT_ALGORITHM,
]);

export function isSupportedStoredAssessmentAlgorithm(value: unknown): boolean {
  return typeof value === "string" && SUPPORTED_STORED_ALGORITHMS.has(value);
}

export function getSignedSourceQueuePolicy(input: {
  algorithm: unknown;
  candidateType: unknown;
  queueSuggestion: unknown;
}): SignedSourceQueuePolicy {
  if (input.algorithm !== CURRENT_RULE_ASSESSMENT_ALGORITHM) {
    return { canSave: false, defaultSelected: false, reason: "unsupported_algorithm" };
  }
  if (input.candidateType !== "product_candidate") {
    return { canSave: false, defaultSelected: false, reason: "not_product_candidate" };
  }
  if (input.queueSuggestion === "review") {
    return { canSave: true, defaultSelected: true, reason: "ready_for_review" };
  }
  if (input.queueSuggestion === "watch") {
    return { canSave: true, defaultSelected: false, reason: "manual_watch" };
  }
  return { canSave: false, defaultSelected: false, reason: "queue_rejected" };
}
