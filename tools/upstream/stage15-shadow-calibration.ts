import { stableHash } from "../../lib/upstream/pipeline";

export type ShadowEvidenceStatus = "observed" | "missing" | "not_applicable" | "conflicted";

export type ShadowEvidenceValue<T> = {
  value: T | null;
  status: ShadowEvidenceStatus;
  evidenceRefs: string[];
  capturedAt: string | null;
  exactVariant: true | false | null;
  missingReason: string | null;
};

export type Stage15ShadowObservationInput = {
  schemaVersion: "stage15-shadow-observation-input.v1";
  batchId: string;
  productKey: string;
  evidenceSnapshotId: string;
  marketValidation: {
    monthlyBought: ShadowEvidenceValue<number>;
    categoryRank: ShadowEvidenceValue<{ rank: number; category: string }>;
    rating: ShadowEvidenceValue<number>;
    reviewCount: ShadowEvidenceValue<number>;
  };
  listingMaturity: {
    firstAvailableAt: ShadowEvidenceValue<string>;
    ageDays: ShadowEvidenceValue<number>;
  };
  buyerReviews: {
    positive: ShadowEvidenceValue<string[]>;
    negative: ShadowEvidenceValue<string[]>;
    sampleCount: ShadowEvidenceValue<number>;
  };
  decisionImpact: false;
};

export type Stage15ShadowObservation = Omit<Stage15ShadowObservationInput, "schemaVersion"> & {
  schemaVersion: "stage15-shadow-observation.v1";
  observationHash: string;
};

const FORBIDDEN_KEYS = new Set([
  "score", "weight", "rankoverride", "statusoverride", "profit", "margin",
  "componentScores", "totalScore", "promotionDecision", "recommendationTier",
].map((value) => value.toLowerCase()));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNoForbiddenInputs(value: unknown): void {
  if (Array.isArray(value)) return value.forEach(assertNoForbiddenInputs);
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) throw new Error(`SHADOW_FORBIDDEN_INPUT:${key}`);
    assertNoForbiddenInputs(child);
  }
}

function iso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateEvidence<T>(field: ShadowEvidenceValue<T>, label: string): void {
  if (!isRecord(field) || !["observed", "missing", "not_applicable", "conflicted"].includes(field.status)) {
    throw new Error(`SHADOW_EVIDENCE_STATUS_INVALID:${label}`);
  }
  if (!Array.isArray(field.evidenceRefs) || !field.evidenceRefs.every(nonEmpty)) {
    throw new Error(`SHADOW_EVIDENCE_REFS_INVALID:${label}`);
  }
  if (field.status === "observed") {
    if (field.value === null || field.evidenceRefs.length === 0 || !iso(field.capturedAt) || field.missingReason !== null) {
      throw new Error(`SHADOW_OBSERVED_EVIDENCE_INVALID:${label}`);
    }
  } else if (field.status === "conflicted") {
    if (field.evidenceRefs.length < 2 || !iso(field.capturedAt) || !nonEmpty(field.missingReason)) {
      throw new Error(`SHADOW_CONFLICTED_EVIDENCE_INVALID:${label}`);
    }
  } else if (field.value !== null || !nonEmpty(field.missingReason)) {
    throw new Error(`SHADOW_MISSING_EVIDENCE_INVALID:${label}`);
  }
  if (field.exactVariant === true && field.evidenceRefs.some((ref) => /^similar_variant:/iu.test(ref))) {
    throw new Error(`SHADOW_VARIANT_CONFLICT:${label}`);
  }
}

function assertInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`SHADOW_NUMBER_INVALID:${label}`);
}

export function buildStage15ShadowObservation(input: Stage15ShadowObservationInput): Stage15ShadowObservation {
  assertNoForbiddenInputs(input);
  if (!isRecord(input) || input.schemaVersion !== "stage15-shadow-observation-input.v1"
    || !nonEmpty(input.batchId) || !nonEmpty(input.productKey) || !nonEmpty(input.evidenceSnapshotId)
    || input.decisionImpact !== false) throw new Error("SHADOW_OBSERVATION_INPUT_INVALID");

  const fields: Array<[string, ShadowEvidenceValue<unknown>]> = [
    ["monthlyBought", input.marketValidation.monthlyBought],
    ["categoryRank", input.marketValidation.categoryRank],
    ["rating", input.marketValidation.rating],
    ["reviewCount", input.marketValidation.reviewCount],
    ["firstAvailableAt", input.listingMaturity.firstAvailableAt],
    ["ageDays", input.listingMaturity.ageDays],
    ["buyerReviews.positive", input.buyerReviews.positive],
    ["buyerReviews.negative", input.buyerReviews.negative],
    ["buyerReviews.sampleCount", input.buyerReviews.sampleCount],
  ];
  fields.forEach(([label, value]) => validateEvidence(value, label));

  if (input.marketValidation.monthlyBought.status === "observed") assertInteger(input.marketValidation.monthlyBought.value, "monthlyBought");
  if (input.marketValidation.reviewCount.status === "observed") assertInteger(input.marketValidation.reviewCount.value, "reviewCount");
  if (input.marketValidation.rating.status === "observed"
    && (typeof input.marketValidation.rating.value !== "number" || input.marketValidation.rating.value < 0 || input.marketValidation.rating.value > 5)) {
    throw new Error("SHADOW_NUMBER_INVALID:rating");
  }
  if (input.marketValidation.categoryRank.status === "observed") {
    const rank = input.marketValidation.categoryRank.value;
    if (!isRecord(rank) || !Number.isInteger(rank.rank) || Number(rank.rank) <= 0 || !nonEmpty(rank.category)) {
      throw new Error("SHADOW_CATEGORY_RANK_INVALID");
    }
  }
  if (input.listingMaturity.firstAvailableAt.status === "observed" && !iso(input.listingMaturity.firstAvailableAt.value)) {
    throw new Error("SHADOW_FIRST_AVAILABLE_INVALID");
  }
  if (input.listingMaturity.ageDays.status === "observed") {
    assertInteger(input.listingMaturity.ageDays.value, "ageDays");
    if (input.listingMaturity.firstAvailableAt.status !== "observed" || !iso(input.listingMaturity.ageDays.capturedAt)) {
      throw new Error("SHADOW_AGE_BASIS_MISSING");
    }
    const expected = Math.floor((Date.parse(input.listingMaturity.ageDays.capturedAt)
      - Date.parse(input.listingMaturity.firstAvailableAt.value as string)) / 86_400_000);
    if (expected !== input.listingMaturity.ageDays.value) throw new Error("SHADOW_AGE_MISMATCH");
  }
  if (input.buyerReviews.sampleCount.status === "observed") assertInteger(input.buyerReviews.sampleCount.value, "sampleCount");

  const body = {
    schemaVersion: "stage15-shadow-observation.v1" as const,
    batchId: input.batchId,
    productKey: input.productKey,
    evidenceSnapshotId: input.evidenceSnapshotId,
    marketValidation: input.marketValidation,
    listingMaturity: input.listingMaturity,
    buyerReviews: input.buyerReviews,
    decisionImpact: false as const,
  };
  return { ...body, observationHash: stableHash(body) };
}

export type ShadowPolicyRule = {
  order: 1 | 2 | 3;
  signal: "market_validation" | "listing_maturity" | "buyer_reviews";
  predicate: string;
  effect: "shadow_priority" | "shadow_watch" | "shadow_stop" | "confidence_only";
};

export type Stage15ShadowPolicyCandidate = {
  schemaVersion: "stage15-shadow-policy-candidate.v1";
  status: "frozen" | "insufficient_evidence";
  sourceCalibrationBatchHash: string;
  sourceEvaluationHash: string;
  createdAt: string;
  rules: ShadowPolicyRule[];
  forbiddenInputs: string[];
  proposalOnly: true;
  productionEffect: false;
  policyHash: string;
};

export function buildStage15ShadowPolicyCandidate(input: {
  calibrationBatch: { batchHash: string; observations: Stage15ShadowObservation[] };
  blindEvaluationResult: { resultHash: string; answers: Array<{ evaluationItemId: string; worthFurtherInvestigation: "yes" | "no" | "insufficient_evidence" }> };
  allowedSignalMenu: Array<Omit<ShadowPolicyRule, "order">>;
  createdAt: string;
}): Stage15ShadowPolicyCandidate {
  if (!iso(input.createdAt) || input.calibrationBatch.observations.length !== 20
    || input.blindEvaluationResult.answers.length !== 20 || input.allowedSignalMenu.length > 3) {
    throw new Error("SHADOW_POLICY_INPUT_INVALID");
  }
  const allowedSignals = new Set(["market_validation", "listing_maturity", "buyer_reviews"]);
  const allowedEffects = new Set(["shadow_priority", "shadow_watch", "shadow_stop", "confidence_only"]);
  for (const rule of input.allowedSignalMenu) {
    if (!allowedSignals.has(rule.signal) || !allowedEffects.has(rule.effect) || !nonEmpty(rule.predicate)
      || (rule.signal === "listing_maturity" && !["shadow_watch", "confidence_only"].includes(rule.effect))) {
      throw new Error("SHADOW_POLICY_RULE_INVALID");
    }
  }
  const decided = input.blindEvaluationResult.answers.filter((answer) => answer.worthFurtherInvestigation !== "insufficient_evidence").length;
  const exactReviewCoverage = input.calibrationBatch.observations.filter((observation) =>
    observation.buyerReviews.sampleCount.status === "observed"
    && observation.buyerReviews.sampleCount.exactVariant === true).length;
  const status = decided >= 10 && exactReviewCoverage >= 10 && input.allowedSignalMenu.length > 0
    ? "frozen" as const
    : "insufficient_evidence" as const;
  const rules = status === "frozen"
    ? input.allowedSignalMenu.map((rule, index) => ({ ...rule, order: (index + 1) as 1 | 2 | 3 }))
    : [];
  const body = {
    schemaVersion: "stage15-shadow-policy-candidate.v1" as const,
    status,
    sourceCalibrationBatchHash: input.calibrationBatch.batchHash,
    sourceEvaluationHash: input.blindEvaluationResult.resultHash,
    createdAt: input.createdAt,
    rules,
    forbiddenInputs: ["weights", "scores", "product_name", "asin", "category_keyword", "hard_gate_relaxation"],
    proposalOnly: true as const,
    productionEffect: false as const,
  };
  return { ...body, policyHash: stableHash(body) };
}
