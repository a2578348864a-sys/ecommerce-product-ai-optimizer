import {
  parseR22MarketDecisionFromAnalysisJson,
  type R22MarketDecision,
  type R22MarketDecisionSnapshot,
} from "./r22DecisionModel";

export type R22CommercialEvidenceStatus =
  | "commercial_not_started"
  | "commercial_assumption_only"
  | "supplier_confirmation_required"
  | "commercial_blocked_risk"
  | "commercial_ready_for_decision";

export type R22CommercialEvidenceInput = {
  candidateId: string;
  marketDecision: R22MarketDecision;
  explicitHumanReview: boolean;
  collectionStarted?: boolean;
  evaluationVariantBound: boolean;
  candidateBoundSupplierEvidenceCount: number;
  candidateBoundFeeEvidenceCount: number;
  packagedDimensionsAndWeightBound: boolean;
  candidateBoundLogisticsEvidenceCount: number;
  candidateBoundRiskReviewCount: number;
  candidateBoundHtsEvidenceCount: number;
  assumptionOnlyEvidenceCount: number;
  criticalUnknownCount: number;
  fatalOrHighRiskCount: number;
  sourceRefs: string[];
};

export type R22CommercialEvidenceResult = {
  status: R22CommercialEvidenceStatus;
  reasons: string[];
};

export function classifyR22CommercialEvidence(
  input: R22CommercialEvidenceInput,
): R22CommercialEvidenceResult {
  const fatalCountValid = Number.isInteger(input.fatalOrHighRiskCount)
    && input.fatalOrHighRiskCount >= 0;
  if (fatalCountValid && input.fatalOrHighRiskCount > 0) {
    return { status: "commercial_blocked_risk", reasons: ["fatal_or_high_risk_present"] };
  }
  if (input.collectionStarted === false) {
    return { status: "commercial_not_started", reasons: ["commercial_collection_not_started"] };
  }

  const reasons: string[] = [];
  const addCountReason = (value: number, missingReason: string, invalidReason: string) => {
    if (!Number.isInteger(value) || value < 0) reasons.push(invalidReason);
    else if (value < 1) reasons.push(missingReason);
  };
  if (!input.evaluationVariantBound) reasons.push("evaluation_variant_not_bound");
  if (!fatalCountValid) reasons.push("invalid_fatal_or_high_risk_count");
  if (!Number.isInteger(input.assumptionOnlyEvidenceCount) || input.assumptionOnlyEvidenceCount < 0) {
    reasons.push("invalid_assumption_only_evidence_count");
  }
  addCountReason(input.candidateBoundSupplierEvidenceCount,
    "candidate_supplier_evidence_missing", "invalid_candidate_supplier_evidence_count");
  addCountReason(input.candidateBoundFeeEvidenceCount,
    "candidate_fee_evidence_missing", "invalid_candidate_fee_evidence_count");
  if (!input.packagedDimensionsAndWeightBound) reasons.push("packaged_dimensions_or_weight_missing");
  addCountReason(input.candidateBoundLogisticsEvidenceCount,
    "candidate_logistics_evidence_missing", "invalid_candidate_logistics_evidence_count");
  addCountReason(input.candidateBoundRiskReviewCount,
    "candidate_risk_review_missing", "invalid_candidate_risk_review_count");
  addCountReason(input.candidateBoundHtsEvidenceCount,
    "candidate_hts_evidence_missing", "invalid_candidate_hts_evidence_count");
  if (!Number.isInteger(input.criticalUnknownCount) || input.criticalUnknownCount < 0) {
    reasons.push("invalid_critical_unknown_count");
  } else if (input.criticalUnknownCount > 0) reasons.push("critical_unknowns_present");
  if (!input.sourceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0)) {
    reasons.push("candidate_source_refs_missing");
  }
  if (
    Number.isInteger(input.assumptionOnlyEvidenceCount)
    && input.assumptionOnlyEvidenceCount > 0
    && input.candidateBoundSupplierEvidenceCount < 1
    && input.candidateBoundFeeEvidenceCount < 1
  ) {
    return { status: "commercial_assumption_only", reasons };
  }
  if (reasons.length) {
    return { status: "supplier_confirmation_required", reasons };
  }
  return { status: "commercial_ready_for_decision", reasons: [] };
}

export type R22NumberRange = { low: number; high: number };

export type R22CommercialRangeInput = {
  netSalesRevenue: R22NumberRange;
  unitPurchaseCost: R22NumberRange;
  domesticFreightPerUnit: R22NumberRange;
  packagingLabelInspectionPerUnit: R22NumberRange;
  internationalFreightPerUnit: R22NumberRange;
  tariffAssessmentBasePerUnit: R22NumberRange;
  tariffRate: R22NumberRange;
  customsClearancePerUnit: R22NumberRange;
  referralFeePerUnit: R22NumberRange;
  fbaFulfillmentFeePerUnit: R22NumberRange;
  storagePerUnit: R22NumberRange;
  otherVariablePlatformFeePerUnit: R22NumberRange;
  advertisingRate: R22NumberRange;
  returnRate: R22NumberRange;
  returnLossRate: R22NumberRange;
};

type ContributionPoint = {
  contributionProfitPerUnit: number;
  contributionMarginRate: number;
  landedCostPerUnit: number;
  platformVariableCostPerUnit: number;
};

const RANGE_FIELDS = [
  "netSalesRevenue", "unitPurchaseCost", "domesticFreightPerUnit",
  "packagingLabelInspectionPerUnit", "internationalFreightPerUnit",
  "tariffAssessmentBasePerUnit", "tariffRate", "customsClearancePerUnit",
  "referralFeePerUnit", "fbaFulfillmentFeePerUnit", "storagePerUnit",
  "otherVariablePlatformFeePerUnit", "advertisingRate", "returnRate", "returnLossRate",
] as const satisfies readonly (keyof R22CommercialRangeInput)[];

function isRange(value: unknown, maximum = Number.POSITIVE_INFINITY): value is R22NumberRange {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<R22NumberRange>;
  return typeof candidate.low === "number"
    && Number.isFinite(candidate.low)
    && typeof candidate.high === "number"
    && Number.isFinite(candidate.high)
    && candidate.low >= 0
    && candidate.low <= candidate.high
    && candidate.high <= maximum;
}

function contributionPoint(
  input: R22CommercialRangeInput,
  salesSide: "low" | "high",
  costSide: "low" | "high",
): ContributionPoint {
  const revenue = input.netSalesRevenue[salesSide];
  const tariff = input.tariffAssessmentBasePerUnit[costSide] * input.tariffRate[costSide];
  const landedCostPerUnit = input.unitPurchaseCost[costSide]
    + input.domesticFreightPerUnit[costSide]
    + input.packagingLabelInspectionPerUnit[costSide]
    + input.internationalFreightPerUnit[costSide]
    + tariff
    + input.customsClearancePerUnit[costSide];
  const platformVariableCostPerUnit = input.referralFeePerUnit[costSide]
    + input.fbaFulfillmentFeePerUnit[costSide]
    + input.storagePerUnit[costSide]
    + input.otherVariablePlatformFeePerUnit[costSide];
  const reserves = revenue * input.advertisingRate[costSide]
    + revenue * input.returnRate[costSide] * input.returnLossRate[costSide];
  const contributionProfitPerUnit = revenue - landedCostPerUnit - platformVariableCostPerUnit - reserves;
  return {
    contributionProfitPerUnit,
    contributionMarginRate: contributionProfitPerUnit / revenue,
    landedCostPerUnit,
    platformVariableCostPerUnit,
  };
}

export function calculateR22ContributionRange(input: Partial<R22CommercialRangeInput>) {
  const rateFields = new Set<keyof R22CommercialRangeInput>([
    "tariffRate", "advertisingRate", "returnRate", "returnLossRate",
  ]);
  const missingFields = RANGE_FIELDS.filter((field) => (
    !isRange(input[field], rateFields.has(field) ? 1 : Number.POSITIVE_INFINITY)
  ));
  if (missingFields.length) return { status: "needs_data" as const, missingFields };
  const complete = input as R22CommercialRangeInput;
  if (complete.netSalesRevenue.low <= 0) {
    return { status: "needs_data" as const, missingFields: ["netSalesRevenue" as const] };
  }
  return {
    status: "calculated_range" as const,
    formulaVersion: "r22-contribution-range-v1" as const,
    worstCase: contributionPoint(complete, "low", "high"),
    bestCase: contributionPoint(complete, "high", "low"),
    singlePointEstimate: null,
  };
}

export type R22Stage2GateResult = { allowed: boolean; reasons: string[] };
const SHA256 = /^[a-f0-9]{64}$/i;

export type R22CommercialRunSnapshot = {
  schemaVersion: "r22-commercial-run-v1";
  runId: string;
  candidateId: string;
  stage1InputHash: string;
  ruleVersion: "r22-stage1-market-v1";
  evidenceVersion: "r22-evidence-semantics-v1";
  createdAt: string;
  marketDecision: "market_shortlisted" | "market_watch";
  commercialEvidenceStatus: "supplier_confirmation_required";
  commercialDecision: "not_evaluated";
  profitScenario: null;
  sourceRefs: string[];
};

function realRunId(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !value.startsWith("stage2-pending-")
    && !value.startsWith("r22-stage2-local-");
}

export function buildR22PendingCommercialRunSnapshot(
  market: R22MarketDecisionSnapshot,
  runId: string,
  createdAt: string,
): R22CommercialRunSnapshot {
  if (!realRunId(runId)) throw new Error("invalid_stage2_run_id");
  if (market.marketDecision !== "market_shortlisted" && market.marketDecision !== "market_watch") {
    throw new Error("market_decision_not_stage2_eligible");
  }
  if (!Number.isFinite(Date.parse(createdAt)) || Date.parse(createdAt) <= Date.parse(market.createdAt)) {
    throw new Error("stage2_run_must_follow_stage1_decision");
  }
  return {
    schemaVersion: "r22-commercial-run-v1",
    runId,
    candidateId: market.candidateId,
    stage1InputHash: market.inputHash,
    ruleVersion: market.ruleVersion,
    evidenceVersion: market.evidenceVersion,
    createdAt,
    marketDecision: market.marketDecision,
    commercialEvidenceStatus: "supplier_confirmation_required",
    commercialDecision: "not_evaluated",
    profitScenario: null,
    sourceRefs: [`stage1-input:${market.inputHash}`, `stage2-run:${runId}`],
  };
}

export function parseR22CommercialRunSnapshot(value: unknown): R22CommercialRunSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "r22-commercial-run-v1"
    || !realRunId(record.runId)
    || typeof record.candidateId !== "string" || !record.candidateId.trim()
    || typeof record.stage1InputHash !== "string" || !SHA256.test(record.stage1InputHash)
    || record.ruleVersion !== "r22-stage1-market-v1"
    || record.evidenceVersion !== "r22-evidence-semantics-v1"
    || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
    || (record.marketDecision !== "market_shortlisted" && record.marketDecision !== "market_watch")
    || record.commercialEvidenceStatus !== "supplier_confirmation_required"
    || record.commercialDecision !== "not_evaluated"
    || record.profitScenario !== null
    || !Array.isArray(record.sourceRefs)
    || !record.sourceRefs.includes(`stage1-input:${record.stage1InputHash}`)
    || !record.sourceRefs.includes(`stage2-run:${record.runId}`)
    || record.sourceRefs.some((ref) => typeof ref !== "string" || !ref.trim())) return null;
  return {
    schemaVersion: "r22-commercial-run-v1",
    runId: record.runId,
    candidateId: record.candidateId,
    stage1InputHash: record.stage1InputHash,
    ruleVersion: "r22-stage1-market-v1",
    evidenceVersion: "r22-evidence-semantics-v1",
    createdAt: record.createdAt,
    marketDecision: record.marketDecision,
    commercialEvidenceStatus: "supplier_confirmation_required",
    commercialDecision: "not_evaluated",
    profitScenario: null,
    sourceRefs: [...record.sourceRefs] as string[],
  };
}

type R22MarketWatchReview = {
  schemaVersion: "r22-market-watch-review-v1";
  reviewId: string;
  candidateId: string;
  stage1InputHash: string;
  reviewerType: "human";
  approved: true;
  reviewedAt: string;
};

function analysisRecord(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
}

function parseMarketWatchReview(
  value: unknown,
  candidateId: string,
  inputHash: string,
  decisionCreatedAt: string,
): R22MarketWatchReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== "r22-market-watch-review-v1"
    || typeof record.reviewId !== "string" || !record.reviewId.trim()
    || record.candidateId !== candidateId
    || record.stage1InputHash !== inputHash
    || record.reviewerType !== "human"
    || record.approved !== true
    || typeof record.reviewedAt !== "string"
    || !Number.isFinite(Date.parse(record.reviewedAt))
    || Date.parse(record.reviewedAt) <= Date.parse(decisionCreatedAt)) return null;
  return record as R22MarketWatchReview;
}

export function evaluateR22Stage2Entry(input: R22CommercialEvidenceInput): R22Stage2GateResult {
  const reasons: string[] = [];
  if (input.marketDecision === "market_reject") reasons.push("market_rejected");
  if (input.marketDecision === "insufficient_market_data") reasons.push("market_data_insufficient");
  if (input.marketDecision === "market_watch" && !input.explicitHumanReview) {
    reasons.push("market_watch_review_required");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function evaluateR22StoredCandidateStage2Gate(input: {
  candidateId: string;
  analysisJson: unknown;
}): R22Stage2GateResult & { applies: boolean } {
  const record = analysisRecord(input.analysisJson);
  if (!record
    && input.analysisJson !== null
    && input.analysisJson !== undefined
    && input.analysisJson !== "") {
    return { applies: true, allowed: false, reasons: ["invalid_analysis_json"] };
  }
  const hasR22Snapshot = Boolean(record
    && Object.prototype.hasOwnProperty.call(record, "r22MarketDecision"));
  const snapshot = parseR22MarketDecisionFromAnalysisJson(input.analysisJson);
  if (!snapshot) return hasR22Snapshot
    ? { applies: true, allowed: false, reasons: ["invalid_market_snapshot"] }
    : { applies: false, allowed: true, reasons: [] };
  if (snapshot.candidateId !== input.candidateId) {
    return { applies: true, allowed: false, reasons: ["market_snapshot_candidate_mismatch"] };
  }
  if (snapshot.marketDecision === "market_reject") {
    return { applies: true, allowed: false, reasons: ["market_rejected"] };
  }
  if (snapshot.marketDecision === "insufficient_market_data") {
    return { applies: true, allowed: false, reasons: ["market_data_insufficient"] };
  }
  if (snapshot.marketDecision === "market_watch") {
    const review = parseMarketWatchReview(
      record?.r22MarketWatchReview,
      input.candidateId,
      snapshot.inputHash,
      snapshot.createdAt,
    );
    if (!review) return { applies: true, allowed: false, reasons: ["market_watch_review_required"] };
  }
  return { applies: true, allowed: true, reasons: [] };
}

export function buildR22CommercialSnapshot(
  input: R22CommercialEvidenceInput,
  generatedAt: string,
) {
  return {
    version: "r22-commercial-evidence-v1" as const,
    generatedAt,
    candidateId: input.candidateId,
    appendOnly: true,
    marketDecision: input.marketDecision,
    stage2Entry: evaluateR22Stage2Entry(input),
    commercialEvidence: classifyR22CommercialEvidence(input),
    bindings: {
      evaluationVariantBound: input.evaluationVariantBound,
      candidateBoundSupplierEvidenceCount: input.candidateBoundSupplierEvidenceCount,
      candidateBoundFeeEvidenceCount: input.candidateBoundFeeEvidenceCount,
      packagedDimensionsAndWeightBound: input.packagedDimensionsAndWeightBound,
      candidateBoundLogisticsEvidenceCount: input.candidateBoundLogisticsEvidenceCount,
      candidateBoundRiskReviewCount: input.candidateBoundRiskReviewCount,
      candidateBoundHtsEvidenceCount: input.candidateBoundHtsEvidenceCount,
      sourceRefs: [...input.sourceRefs],
    },
  };
}

export function prepareR22Stage2Handoff(
  input: R22CommercialEvidenceInput,
  actor: "owner" | "visitor",
  generatedAt: string,
) {
  const snapshot = buildR22CommercialSnapshot(input, generatedAt);
  return {
    allowed: snapshot.stage2Entry.allowed,
    reasons: snapshot.stage2Entry.reasons,
    route: snapshot.stage2Entry.allowed ? "/agent/run" as const : null,
    storageTarget: actor === "owner" ? "owner_repository" as const : "visitor_sandbox" as const,
    snapshot,
  };
}
