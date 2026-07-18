import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage15ShadowObservation, Stage15ShadowPolicyCandidate, ShadowPolicyRule } from "./stage15-shadow-calibration";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";

type Answer = { evaluationItemId: string; worthFurtherInvestigation: "yes" | "no" | "insufficient_evidence" };
type ComparisonConclusion = "shadow_policy_not_supported" | "directional_shadow_signal_observed" | "blocked";

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, ratio: denominator === 0 ? null : numerator / denominator };
}

function policyBody(policy: Stage15ShadowPolicyCandidate) {
  const { policyHash: _policyHash, ...body } = policy;
  void _policyHash;
  return body;
}

function ruleMatches(rule: ShadowPolicyRule, observation: Stage15ShadowObservation): boolean {
  if (rule.signal === "market_validation" && rule.predicate === "category_rank_observed") {
    return observation.marketValidation.categoryRank.status === "observed";
  }
  if (rule.signal === "listing_maturity" && rule.predicate === "age_missing") {
    return observation.listingMaturity.ageDays.status === "missing";
  }
  if (rule.signal === "buyer_reviews" && rule.predicate === "exact_reviews_missing") {
    return observation.buyerReviews.sampleCount.status !== "observed"
      || observation.buyerReviews.sampleCount.exactVariant !== true;
  }
  return false;
}

export function compareStage15ShadowHeldout(input: {
  validationBatch: Stage15ShadowBatch;
  frozenPolicy: Stage15ShadowPolicyCandidate;
  blindEvaluationResult: { packetHash: string; completedAt: string; answers: Answer[] };
  bindings: Array<{ evaluationItemId: string; productKey: string }>;
  calibrationProductKeys: string[];
  policyFileSha256: string;
  policyFrozenAt: string;
  validationPacketFrozenAt: string;
  createdAt: string;
}) {
  const blockedReasons: string[] = [];
  if (input.validationBatch.role !== "validation" || input.validationBatch.productKeys.length !== 20
    || input.blindEvaluationResult.answers.length !== 20 || input.bindings.length !== 20) blockedReasons.push("validation_incomplete");
  const calibrationKeys = new Set(input.calibrationProductKeys);
  if (input.validationBatch.productKeys.some((key) => calibrationKeys.has(key))) blockedReasons.push("cross_batch_identity_overlap");
  if (input.frozenPolicy.status !== "frozen" || stableHash(policyBody(input.frozenPolicy)) !== input.frozenPolicy.policyHash
    || !/^[a-f0-9]{64}$/u.test(input.policyFileSha256)) blockedReasons.push("policy_integrity_invalid");
  const packetTime = Date.parse(input.validationPacketFrozenAt);
  const policyTime = Date.parse(input.policyFrozenAt);
  const completedTime = Date.parse(input.blindEvaluationResult.completedAt);
  if (![packetTime, policyTime, completedTime, Date.parse(input.createdAt)].every(Number.isFinite)
    || packetTime >= policyTime || policyTime >= completedTime) blockedReasons.push("policy_time_order_invalid");

  const observationByKey = new Map(input.validationBatch.observations.map((value) => [value.productKey, value]));
  const baselineTop5 = input.validationBatch.baseline
    .filter((item) => item.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number))
    .slice(0, 5)
    .map((item) => item.productKey);
  const baselineRank = new Map(input.validationBatch.baseline.map((item) => [item.productKey, item.rank ?? Number.MAX_SAFE_INTEGER]));
  const baselineStatus = new Map(input.validationBatch.baseline.map((item) => [item.productKey, item.status]));
  const shadowCandidates = input.validationBatch.productKeys.map((productKey) => {
    const observation = observationByKey.get(productKey);
    let priority = 0;
    let stopped = false;
    if (observation) {
      for (const rule of input.frozenPolicy.rules) {
        if (!ruleMatches(rule, observation)) continue;
        if (rule.effect === "shadow_priority") priority -= 100 - rule.order;
        if (rule.effect === "shadow_watch") priority += 100 + rule.order;
        if (rule.effect === "shadow_stop") stopped = true;
      }
    }
    return { productKey, priority, stopped, baselineRank: baselineRank.get(productKey) ?? Number.MAX_SAFE_INTEGER };
  });
  const shadowTop5 = shadowCandidates.filter((item) => !item.stopped)
    .sort((a, b) => a.priority - b.priority || a.baselineRank - b.baselineRank || a.productKey.localeCompare(b.productKey))
    .slice(0, 5).map((item) => item.productKey);
  const hardGateRegressionCount = shadowTop5.filter((key) => ["reject", "insufficient"].includes(baselineStatus.get(key) ?? "")).length;
  if (hardGateRegressionCount > 0) blockedReasons.push("hard_gate_regression");

  const productByEvaluationId = new Map(input.bindings.map((binding) => [binding.evaluationItemId, binding.productKey]));
  const decisionByProduct = new Map(input.blindEvaluationResult.answers.map((answer) => [
    productByEvaluationId.get(answer.evaluationItemId) ?? "",
    answer.worthFurtherInvestigation,
  ]));
  if (decisionByProduct.has("") || new Set(input.bindings.map((binding) => binding.productKey)).size !== 20) {
    blockedReasons.push("evaluation_binding_invalid");
  }
  const metricsFor = (keys: string[]) => {
    const yes = keys.filter((key) => decisionByProduct.get(key) === "yes").length;
    const insufficient = keys.filter((key) => decisionByProduct.get(key) === "insufficient_evidence").length;
    return { ...ratio(yes, keys.length), insufficientEvidence: insufficient };
  };
  const baselineMetrics = metricsFor(baselineTop5);
  const shadowMetrics = metricsFor(shadowTop5);
  let conclusion: ComparisonConclusion = "shadow_policy_not_supported";
  if (blockedReasons.length > 0) conclusion = "blocked";
  else if (shadowMetrics.numerator > baselineMetrics.numerator
    && shadowMetrics.insufficientEvidence <= baselineMetrics.insufficientEvidence) conclusion = "directional_shadow_signal_observed";
  const baselineSet = new Set(baselineTop5);
  const shadowSet = new Set(shadowTop5);
  const body = {
    schemaVersion: "stage15-shadow-heldout-comparison.v1" as const,
    validationBatchHash: input.validationBatch.batchHash,
    policyHash: input.frozenPolicy.policyHash,
    baselineTop5,
    shadowTop5,
    metrics: {
      baseline: baselineMetrics,
      shadow: shadowMetrics,
      numeratorDelta: shadowMetrics.numerator - baselineMetrics.numerator,
      ratioDelta: (shadowMetrics.ratio ?? 0) - (baselineMetrics.ratio ?? 0),
    },
    overlap: baselineTop5.filter((key) => shadowSet.has(key)),
    flips: {
      removed: baselineTop5.filter((key) => !shadowSet.has(key)),
      added: shadowTop5.filter((key) => !baselineSet.has(key)),
    },
    hardGateRegressionCount,
    insufficientEvidenceCount: input.blindEvaluationResult.answers.filter((answer) => answer.worthFurtherInvestigation === "insufficient_evidence").length,
    conclusion,
    reasonCodes: blockedReasons,
    createdAt: input.createdAt,
    productionEffect: false as const,
  };
  return { ...body, comparisonHash: stableHash(body) };
}
