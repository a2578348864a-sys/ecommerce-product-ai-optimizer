import { stableHash } from "../../lib/upstream/pipeline";

const EXCLUDED_PROOF = [
  "amazon_operator_expert_review",
  "profitability",
  "supplier_and_logistics_validation",
  "compliance_or_ip_clearance",
  "api_integration",
  "database_transaction_and_concurrency",
  "owner_visitor_authorization",
  "formal_candidate_creation",
  "product_value",
] as const;

type Phase3AcceptanceInput = {
  stage1Summary: unknown;
  responses: unknown;
  responsesFileSha256: string;
  comparison: unknown;
  candidatePreview: unknown;
  evaluatedAt: string;
};

type Criteria = {
  stage1Deterministic: boolean;
  stage1EvidenceHashValid: boolean;
  blindReviewCompleted: boolean;
  systemRankingHiddenUntilResponsesLocked: boolean;
  comparisonLinkedToStage1AndResponses: boolean;
  systemCountsMatch: boolean;
  scopeReductionMeasured: boolean;
  reliabilityBoundaryPreserved: boolean;
  noviceReviewNotClaimedAsExpert: boolean;
  candidatePreviewEvidenceHashValid: boolean;
  previewModeExplicit: boolean;
  formalCandidateNotGenerated: boolean;
  productionDatabaseNotWritten: boolean;
  aiNotCalled: boolean;
};

type ReportBody = {
  schemaVersion: "phase3-acceptance-report.v1";
  status: "passed" | "failed";
  proofLevel: "real_source_offline_stage1_solo_novice_blind_review_preview_only";
  evaluatedAt: string;
  sourceHashes: {
    stage1Summary: string;
    responses: string;
    comparison: string;
    candidatePreview: string;
  };
  rankingRunId: string | null;
  rankingRuleVersion: string | null;
  counts: {
    inputCount: number;
    promoted: number;
    rejected: number;
    insufficientEvidence: number;
    completedBlindReviewAnswers: number;
    formalCandidateCount: number;
  };
  scopeReduction: {
    count: number;
    rate: number;
    reliablyReducedHumanInvestigation: false;
  };
  criteria: Criteria;
  validationConclusion: "limited_scope_reduction_not_business_validated";
  businessValidationProven: false;
  expertReviewProven: false;
  reasonCodes: string[];
  excludedProof: typeof EXCLUDED_PROOF;
};

export type Phase3AcceptanceReport = ReportBody & { evidenceHash: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function hashFieldIsValid(value: Record<string, unknown>) {
  const evidenceHash = value.evidenceHash;
  if (typeof evidenceHash !== "string" || !/^[a-f0-9]{64}$/i.test(evidenceHash)) return false;
  const { evidenceHash: _evidenceHash, ...body } = value;
  void _evidenceHash;
  return stableHash(body) === evidenceHash;
}

function reasonCodes(criteria: Criteria) {
  return [
    criteria.stage1Deterministic ? null : "stage1_not_deterministic",
    criteria.stage1EvidenceHashValid ? null : "stage1_evidence_hash_invalid",
    criteria.blindReviewCompleted ? null : "blind_review_incomplete",
    criteria.systemRankingHiddenUntilResponsesLocked ? null : "ranking_not_hidden_until_lock",
    criteria.comparisonLinkedToStage1AndResponses ? null : "comparison_source_mismatch",
    criteria.systemCountsMatch ? null : "system_counts_mismatch",
    criteria.scopeReductionMeasured ? null : "scope_reduction_not_measured",
    criteria.reliabilityBoundaryPreserved ? null : "reliability_boundary_missing",
    criteria.noviceReviewNotClaimedAsExpert ? null : "novice_review_claimed_as_expert",
    criteria.candidatePreviewEvidenceHashValid ? null : "candidate_preview_hash_invalid",
    criteria.previewModeExplicit ? null : "preview_boundary_missing",
    criteria.formalCandidateNotGenerated ? null : "formal_candidate_generated",
    criteria.productionDatabaseNotWritten ? null : "production_database_written",
    criteria.aiNotCalled ? null : "ai_called",
  ].filter((code): code is string => code !== null).sort();
}

export function buildPhase3AcceptanceReport(input: Phase3AcceptanceInput): Phase3AcceptanceReport {
  if (!Number.isFinite(Date.parse(input.evaluatedAt)) || !/^[a-f0-9]{64}$/i.test(input.responsesFileSha256)) {
    throw new Error("PHASE3_ACCEPTANCE_INPUT_INVALID");
  }
  const stage1 = record(input.stage1Summary);
  const responses = record(input.responses);
  const comparison = record(input.comparison);
  const preview = record(input.candidatePreview);
  if (stage1.schemaVersion !== "human-assisted-stage1-offline-run-summary.v1"
    || responses.schemaVersion !== "solo-novice-blind-review-responses.v1"
    || comparison.schemaVersion !== "solo-novice-stage1-comparison.v1"
    || preview.schemaVersion !== "candidate-advancement-preview.v1") {
    throw new Error("PHASE3_ACCEPTANCE_SCHEMA_INVALID");
  }
  const decisionCounts = record(stage1.decisionCounts);
  const reviewMethod = record(comparison.reviewMethod);
  const source = record(comparison.source);
  const systemSummary = record(comparison.systemSummary);
  const comparisonMetrics = record(comparison.comparison);
  const conclusion = record(comparison.conclusion);
  const reviewerProfile = record(responses.reviewerProfile);
  const boundary = record(preview.boundary);
  const answers = Array.isArray(responses.answers) ? responses.answers : [];
  const candidates = Array.isArray(preview.candidates) ? preview.candidates : [];
  const inputCount = numberValue(stage1.inputObservationCount);
  const promoted = numberValue(decisionCounts.promoted);
  const rejected = numberValue(decisionCounts.rejected);
  const insufficientEvidence = numberValue(decisionCounts.insufficient_evidence);
  const reductionCount = numberValue(comparisonMetrics.systemReductionCount);
  const reductionRate = numberValue(comparisonMetrics.systemReductionRate);
  const criteria: Criteria = {
    stage1Deterministic: stage1.deterministicReplayMatched === true,
    stage1EvidenceHashValid: hashFieldIsValid(stage1),
    blindReviewCompleted: responses.status === "completed"
      && answers.length === numberValue(reviewMethod.itemCount)
      && answers.length === numberValue(stage1.blindReviewItemCount)
      && new Set(answers.map((answer) => stringValue(record(answer).blindItemId))).size === answers.length,
    systemRankingHiddenUntilResponsesLocked: reviewMethod.systemRankingHiddenUntilResponsesLocked === true,
    comparisonLinkedToStage1AndResponses: source.rankingRunId === stage1.rankingRunId
      && source.rankingRuleVersion === stage1.rankingRuleVersion
      && source.novicePacketHash === responses.sourcePacketHash
      && source.responseFileSha256 === input.responsesFileSha256,
    systemCountsMatch: numberValue(systemSummary.promoted) === promoted
      && numberValue(systemSummary.rejected) === rejected
      && numberValue(systemSummary.insufficient_evidence) === insufficientEvidence
      && promoted + rejected + insufficientEvidence === numberValue(stage1.resultCount)
      && numberValue(stage1.resultCount) === inputCount,
    scopeReductionMeasured: conclusion.stage1NarrowedCount === true
      && reductionCount === rejected + insufficientEvidence
      && Math.abs(reductionRate - reductionCount / inputCount) < 1e-9,
    reliabilityBoundaryPreserved: conclusion.stage1ReliablyNarrowedHumanInvestigation === false
      && conclusion.status === "limited_scope_reduction_not_business_validated",
    noviceReviewNotClaimedAsExpert: reviewerProfile.expertReview === false && reviewMethod.expertReview === false,
    candidatePreviewEvidenceHashValid: hashFieldIsValid(preview),
    previewModeExplicit: boundary.previewOnly === true && boundary.databaseWritten === false && boundary.apiCalled === false,
    formalCandidateNotGenerated: stage1.formalCandidateGenerated === false
      && boundary.candidateCreated === false && candidates.length === 0,
    productionDatabaseNotWritten: stage1.productionDatabaseWritten === false && boundary.databaseWritten === false,
    aiNotCalled: stage1.aiCalled === false,
  };
  const failures = reasonCodes(criteria);
  const body: ReportBody = {
    schemaVersion: "phase3-acceptance-report.v1",
    status: failures.length === 0 ? "passed" : "failed",
    proofLevel: "real_source_offline_stage1_solo_novice_blind_review_preview_only",
    evaluatedAt: input.evaluatedAt,
    sourceHashes: {
      stage1Summary: stableHash(stage1),
      responses: stableHash(responses),
      comparison: stableHash(comparison),
      candidatePreview: stableHash(preview),
    },
    rankingRunId: stringValue(stage1.rankingRunId),
    rankingRuleVersion: stringValue(stage1.rankingRuleVersion),
    counts: {
      inputCount,
      promoted,
      rejected,
      insufficientEvidence,
      completedBlindReviewAnswers: answers.length,
      formalCandidateCount: candidates.length,
    },
    scopeReduction: { count: reductionCount, rate: reductionRate, reliablyReducedHumanInvestigation: false },
    criteria,
    validationConclusion: "limited_scope_reduction_not_business_validated",
    businessValidationProven: false,
    expertReviewProven: false,
    reasonCodes: failures,
    excludedProof: EXCLUDED_PROOF,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

export function phase3AcceptanceReportHashIsValid(report: Phase3AcceptanceReport) {
  const { evidenceHash, ...body } = report;
  return /^[a-f0-9]{64}$/i.test(evidenceHash) && stableHash(body) === evidenceHash;
}
