import type { RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import type { buildStage2CalibrationFromSubmission } from "./stage2-evidence-intake";

export type Stage2CalibrationRun = ReturnType<typeof buildStage2CalibrationFromSubmission>;

export type Stage2SourcePacket = {
  schemaVersion: "solo-stage2-objective-calibration-packet.v1";
  packetHash: string;
  sourceRankingRunId: string;
  samples: Array<{
    sampleId: string;
    candidateId: string;
    productKey: string;
    sourceEvidence: {
      title: string | null;
      sourceUrl: string | null;
      capturedAt: string;
      salePrice: number | null;
      currency: "USD";
      rating: number | null;
      reviewCount: number | null;
      missingEvidence: string[];
    };
    calibration: { candidateId: string };
  }>;
  [key: string]: unknown;
};

export type Stage2HumanDecision = "continue" | "stop" | "hold";

export type Stage2HumanDecisionSubmission = {
  schemaVersion: "stage2-human-decision-submission.v1";
  decisionBatchId: string;
  sourceCalibrationInputHash: string;
  decidedAt: string;
  decidedBy: string;
  boundary: {
    manualDecisionOnly: true;
    evidenceMayNotAutoDecide: true;
    stage1RankingMayNotBeRewritten: true;
  };
  decisions: Array<{
    sampleId: string;
    productKey: string;
    decision: Stage2HumanDecision | null;
    reason: string | null;
    evidenceReviewed: boolean;
  }>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DECISION_SUBMISSION_KEYS = new Set([
  "schemaVersion", "decisionBatchId", "sourceCalibrationInputHash", "decidedAt", "decidedBy", "boundary", "decisions",
]);
const DECISION_BOUNDARY_KEYS = new Set(["manualDecisionOnly", "evidenceMayNotAutoDecide", "stage1RankingMayNotBeRewritten"]);
const DECISION_ITEM_KEYS = new Set(["sampleId", "productKey", "decision", "reason", "evidenceReviewed"]);

function isIsoTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function assertCalibrationRun(calibration: Stage2CalibrationRun) {
  if (calibration.schemaVersion !== "stage2-evidence-calibration-run.v1"
    || !SHA256_PATTERN.test(calibration.inputHash)
    || !Array.isArray(calibration.samples)) {
    throw new Error("STAGE2_CALIBRATION_RUN_INVALID");
  }
  const ids = calibration.samples.map((sample) => sample.sampleId);
  const keys = calibration.samples.map((sample) => sample.productKey);
  if (new Set(ids).size !== ids.length || new Set(keys).size !== keys.length) {
    throw new Error("STAGE2_CALIBRATION_SAMPLE_MISMATCH");
  }
}

export function buildStage2HumanDecisionTemplate(
  calibration: Stage2CalibrationRun,
  options: { decisionBatchId: string; decidedAt: string; decidedBy: string },
): Stage2HumanDecisionSubmission {
  assertCalibrationRun(calibration);
  if (!options.decisionBatchId.trim() || !options.decidedBy.trim() || !isIsoTime(options.decidedAt)) {
    throw new Error("STAGE2_DECISION_TEMPLATE_OPTIONS_INVALID");
  }
  return {
    schemaVersion: "stage2-human-decision-submission.v1",
    decisionBatchId: options.decisionBatchId.trim(),
    sourceCalibrationInputHash: calibration.inputHash,
    decidedAt: options.decidedAt,
    decidedBy: options.decidedBy.trim(),
    boundary: {
      manualDecisionOnly: true,
      evidenceMayNotAutoDecide: true,
      stage1RankingMayNotBeRewritten: true,
    },
    decisions: calibration.samples.map((sample) => ({
      sampleId: sample.sampleId,
      productKey: sample.productKey,
      decision: null,
      reason: null,
      evidenceReviewed: false,
    })),
  };
}

function assertDecisionSampleSet(calibration: Stage2CalibrationRun, submission: Stage2HumanDecisionSubmission) {
  if (submission.sourceCalibrationInputHash !== calibration.inputHash
    || submission.decisions.length !== calibration.samples.length) {
    throw new Error("STAGE2_DECISION_SAMPLE_MISMATCH");
  }
  const expected = new Map(calibration.samples.map((sample) => [sample.sampleId, sample.productKey]));
  const seen = new Set<string>();
  for (const decision of submission.decisions) {
    if (seen.has(decision.sampleId) || expected.get(decision.sampleId) !== decision.productKey) {
      throw new Error("STAGE2_DECISION_SAMPLE_MISMATCH");
    }
    seen.add(decision.sampleId);
  }
}

export function validateStage2HumanDecisionSubmission(
  calibration: Stage2CalibrationRun,
  submission: Stage2HumanDecisionSubmission,
) {
  assertCalibrationRun(calibration);
  if (submission.schemaVersion !== "stage2-human-decision-submission.v1"
    || !Array.isArray(submission.decisions)) {
    throw new Error("STAGE2_DECISION_SUBMISSION_INVALID");
  }
  assertDecisionSampleSet(calibration, submission);

  const packageReasonCodes: string[] = [];
  if (Object.keys(submission).some((key) => !DECISION_SUBMISSION_KEYS.has(key))) {
    packageReasonCodes.push("unexpected_decision_submission_field");
  }
  if (!submission.decisionBatchId.trim()) packageReasonCodes.push("decision_batch_id_invalid");
  if (!submission.decidedBy.trim()) packageReasonCodes.push("decided_by_invalid");
  if (!isIsoTime(submission.decidedAt)) packageReasonCodes.push("decided_at_invalid");
  if (submission.boundary?.manualDecisionOnly !== true
    || submission.boundary?.evidenceMayNotAutoDecide !== true
    || submission.boundary?.stage1RankingMayNotBeRewritten !== true) {
    packageReasonCodes.push("decision_boundary_invalid");
  }
  if (submission.boundary
    && Object.keys(submission.boundary).some((key) => !DECISION_BOUNDARY_KEYS.has(key))) {
    packageReasonCodes.push("unexpected_decision_boundary_field");
  }

  const eligibleSampleIds = new Set(calibration.samples
    .filter((sample) => sample.evidenceStatus === "ready_for_calibration")
    .map((sample) => sample.sampleId));
  const items = submission.decisions.map((item) => {
    const reasonCodes: string[] = [];
    const eligible = eligibleSampleIds.has(item.sampleId);
    if (Object.keys(item).some((key) => !DECISION_ITEM_KEYS.has(key))) reasonCodes.push("unexpected_decision_field");
    if (!eligible && (item.decision !== null || item.reason !== null || item.evidenceReviewed)) {
      reasonCodes.push("decision_for_ineligible_sample");
    }
    if (item.decision !== null && !["continue", "stop", "hold"].includes(item.decision)) {
      reasonCodes.push("decision_invalid");
    }
    if (item.decision === null) {
      if (item.reason !== null) reasonCodes.push("reason_without_decision");
      if (item.evidenceReviewed) reasonCodes.push("review_without_decision");
    } else {
      if (typeof item.reason !== "string" || item.reason.trim().length < 3 || item.reason.length > 500) {
        reasonCodes.push("decision_reason_invalid");
      }
      if (item.evidenceReviewed !== true) reasonCodes.push("evidence_not_reviewed");
    }
    return {
      sampleId: item.sampleId,
      productKey: item.productKey,
      eligible,
      decision: item.decision,
      status: reasonCodes.length > 0 ? "rejected" as const
        : item.decision === null ? "pending_user_input" as const
          : "ready" as const,
      reasonCodes,
    };
  });

  const summary = {
    sampleCount: items.length,
    eligibleSampleCount: eligibleSampleIds.size,
    blockedByEvidenceCount: items.length - eligibleSampleIds.size,
    readyCount: items.filter((item) => item.status === "ready").length,
    pendingCount: items.filter((item) => item.status === "pending_user_input").length,
    rejectedCount: items.filter((item) => item.status === "rejected").length,
    continueCount: items.filter((item) => item.status === "ready" && item.decision === "continue").length,
    stopCount: items.filter((item) => item.status === "ready" && item.decision === "stop").length,
    holdCount: items.filter((item) => item.status === "ready" && item.decision === "hold").length,
  };
  const decisionHash = stableHash(submission);
  const eligibleReadyCount = items.filter((item) => item.eligible && item.status === "ready").length;
  const status = calibration.status === "synthetic_fixture_calculated" ? "blocked_non_real_evidence" as const
    : calibration.status === "rejected" || eligibleSampleIds.size === 0 ? "blocked_by_evidence" as const
      : packageReasonCodes.length > 0 || summary.rejectedCount > 0 ? "rejected" as const
        : eligibleReadyCount === eligibleSampleIds.size ? "ready_for_advancement_preview" as const
          : "pending_user_input" as const;
  const body = {
    schemaVersion: "stage2-human-decision-validation.v1" as const,
    status,
    sourceCalibrationInputHash: calibration.inputHash,
    decisionHash,
    inputHash: stableHash({ sourceCalibrationInputHash: calibration.inputHash, decisionHash }),
    packageReasonCodes,
    boundary: {
      humanDecisionWasAutoGenerated: false,
      candidateCreated: false,
      databaseWritten: false,
      stage1RankingModified: false,
    },
    summary,
    items,
  };
  return { ...body, evidenceHash: stableHash(body) };
}

function assertSourcePacket(stage2Packet: Stage2SourcePacket, ranking: RankingRun) {
  const { packetHash, ...body } = stage2Packet;
  if (stage2Packet.schemaVersion !== "solo-stage2-objective-calibration-packet.v1"
    || stableHash(body) !== packetHash
    || stage2Packet.sourceRankingRunId !== ranking.rankingRunId) {
    throw new Error("STAGE2_ADVANCEMENT_SOURCE_PACKET_INVALID");
  }
  const rankingByProduct = new Map(ranking.results.map((result) => [result.productKey, result]));
  for (const sample of stage2Packet.samples) {
    const result = rankingByProduct.get(sample.productKey);
    if (!result || result.candidateId !== sample.candidateId || sample.calibration.candidateId !== sample.candidateId) {
      throw new Error("STAGE2_ADVANCEMENT_SOURCE_MISMATCH");
    }
  }
}

export function buildCandidateAdvancementPreview(input: {
  ranking: RankingRun;
  stage2Packet: Stage2SourcePacket;
  calibration: Stage2CalibrationRun;
  decisions: Stage2HumanDecisionSubmission;
}) {
  assertSourcePacket(input.stage2Packet, input.ranking);
  const decisionValidation = validateStage2HumanDecisionSubmission(input.calibration, input.decisions);
  const eligibleProductKeys = new Set(input.calibration.samples
    .filter((sample) => sample.evidenceStatus === "ready_for_calibration")
    .map((sample) => sample.productKey));
  const blockedStatus = input.calibration.status === "synthetic_fixture_calculated" ? "blocked_non_real_evidence" as const
    : input.calibration.status === "rejected" || eligibleProductKeys.size === 0 ? "blocked_by_evidence" as const
      : decisionValidation.status !== "ready_for_advancement_preview" ? "blocked_by_human_decision" as const
        : null;
  const stage2ByProduct = new Map(input.stage2Packet.samples.map((sample) => [sample.productKey, sample]));
  const decisionByProduct = new Map(input.decisions.decisions.map((decision) => [decision.productKey, decision]));
  const continuedResults = blockedStatus ? [] : input.ranking.results
    .filter((result) => eligibleProductKeys.has(result.productKey)
      && decisionByProduct.get(result.productKey)?.decision === "continue");
  const excluded = continuedResults.flatMap((result) => {
    const source = stage2ByProduct.get(result.productKey);
    const reasonCode = result.promotionDecision !== "promoted" ? "stage1_not_promoted"
      : !result.hardGateResult.passed ? "hard_gate_failed"
        : !source?.sourceEvidence.title || !source.sourceEvidence.sourceUrl ? "source_evidence_insufficient"
          : null;
    return reasonCode ? [{ productKey: result.productKey, sourceCandidateId: result.candidateId, reasonCode }] : [];
  });
  const candidates = blockedStatus ? [] : input.ranking.results
    .filter((result) => eligibleProductKeys.has(result.productKey)
      && decisionByProduct.get(result.productKey)?.decision === "continue"
      && result.promotionDecision === "promoted"
      && result.hardGateResult.passed)
    .map((result) => {
      const source = stage2ByProduct.get(result.productKey);
      if (!source?.sourceEvidence.title || !source.sourceEvidence.sourceUrl) {
        throw new Error("STAGE2_ADVANCEMENT_SOURCE_EVIDENCE_INSUFFICIENT");
      }
      const trace = {
        briefId: input.ranking.briefId,
        collectionRunId: input.ranking.collectionRunId,
        rankingRunId: input.ranking.rankingRunId,
        rankingInputHash: input.ranking.inputHash,
        stage1EvidenceHash: result.inputEvidenceHash,
        stage2SourcePacketHash: input.stage2Packet.packetHash,
        stage2CalibrationInputHash: input.calibration.inputHash,
        humanDecisionEvidenceHash: decisionValidation.evidenceHash,
      };
      return {
        candidatePreviewId: `candidate-preview-${stableHash({ productKey: result.productKey, trace }).slice(0, 24)}`,
        formalCandidateId: null,
        persistenceStatus: "not_written" as const,
        sourceIntegrity: "pending_server_proof" as const,
        requestedCandidateStatus: "worth_analyzing" as const,
        sourceCandidateId: result.candidateId,
        productKey: result.productKey,
        name: source.sourceEvidence.title,
        link: source.sourceEvidence.sourceUrl,
        score: result.totalScore,
        rankingRuleVersion: result.rankingRuleVersion,
        recommendationTier: result.recommendationTier,
        promotionDecision: result.promotionDecision,
        trace,
      };
    });
  const body = {
    schemaVersion: "candidate-advancement-preview.v1" as const,
    status: blockedStatus ?? "preview_ready_not_persisted" as const,
    inputHash: stableHash({
      rankingInputHash: input.ranking.inputHash,
      stage2PacketHash: input.stage2Packet.packetHash,
      calibrationInputHash: input.calibration.inputHash,
      decisionEvidenceHash: decisionValidation.evidenceHash,
    }),
    boundary: {
      previewOnly: true,
      databaseWritten: false,
      apiCalled: false,
      authorizationProven: false,
      databaseTransactionProven: false,
      serverSourceProofCreated: false,
      candidateCreated: false,
      stage1RankingModified: false,
    },
    decisionSummary: decisionValidation.summary,
    excluded,
    candidates,
  };
  return { ...body, evidenceHash: stableHash(body) };
}
