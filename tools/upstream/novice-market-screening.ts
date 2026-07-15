import type { QualityGateResult, RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";

export type TernaryAnswer = "yes" | "no" | "uncertain";
export type RawTernaryAnswer = TernaryAnswer | "missing";
export type RawConfidenceAnswer = "high" | "medium" | "low" | "missing";

export type NoviceBlindAnswer = {
  blindItemId: string;
  productUnderstood?: TernaryAnswer | null;
  evidenceSufficient?: TernaryAnswer | null;
  obviousConcern?: TernaryAnswer | null;
  investigateNext10Minutes?: TernaryAnswer | null;
  confidence?: "high" | "medium" | "low" | null;
  elapsedSeconds?: number | null;
  note?: string | null;
};

type BlindReviewMaterial = {
  schemaVersion: "blind-review-material.v1";
  blindReviewId: string;
  criteria: string[];
  items: Array<{
    blindItemId: string;
    candidateId: string;
    evidenceSnapshotId: string;
    title: string | null;
    sourceUrl: string;
    capturedAt: string;
    evidence: {
      price: number | null;
      rating: number | null;
      reviewCount: number | null;
      missingEvidence: string[];
    };
  }>;
};

type NovicePacket = {
  schemaVersion: "solo-novice-blind-review-packet.v1";
  sourceBlindReviewId: string;
  sourceEvidenceHash: string;
  purpose: string;
  boundary: { validates: string[]; doesNotValidate: string[] };
  questions: readonly string[];
  allowedAnswers: { ternary: readonly string[]; confidence: readonly string[] };
  reviewState: string;
  items: unknown[];
  packetHash: string;
};

export type NoviceScreeningMarketEvidence = {
  schemaVersion: "novice-screening-market-evidence.v1";
  sourceBatchId: string;
  qualityGates: {
    source: QualityGateResult;
    context: QualityGateResult;
    layout: QualityGateResult;
  };
  candidates: Array<{
    candidateId: string;
    productKey: string;
    evidenceSnapshotId: string;
    inputEvidenceHash: string;
    minimumEvidencePack: {
      schemaVersion: "minimum-evidence-pack.v1";
      complete: boolean;
      missingEvidence: string[];
    };
  }>;
};

export type NoviceMarketScreeningInput = {
  ranking: RankingRun;
  marketEvidence: NoviceScreeningMarketEvidence;
  blindReview: BlindReviewMaterial;
  novicePacket: NovicePacket;
  responses: {
    schemaVersion: "solo-novice-blind-review-responses.v1";
    sourcePacketHash: string;
    status: string;
    answers: NoviceBlindAnswer[];
  };
  createdAt: string;
};

export type NoviceScreeningItemStatus = "advance" | "watch" | "reject" | "insufficient";

type PreservedHumanAnswer = {
  blindItemId: string | null;
  productUnderstood: RawTernaryAnswer;
  evidenceSufficient: RawTernaryAnswer;
  obviousConcern: RawTernaryAnswer;
  investigateNext10Minutes: RawTernaryAnswer;
  confidence: RawConfidenceAnswer;
  elapsedSeconds: number | null;
  note: string | null;
};

export type NoviceMarketScreeningItem = {
  schemaVersion: "novice-market-screening-item.v1";
  candidateId: string;
  productKey: string;
  stage1Rank: number | null;
  stage1PromotionDecision: "promoted" | "rejected" | "insufficient_evidence";
  screeningEvidenceSufficient: boolean;
  userUnderstandsProduct: boolean;
  willingToContinueResearch: boolean;
  rawHumanAnswer: PreservedHumanAnswer;
  marketEvidenceReasons: string[];
  humanGateReasons: string[];
  status: NoviceScreeningItemStatus;
  supportingEvidence: string[];
  counterEvidence: string[];
  missingEvidence: string[];
  nextValidationPlan: string[];
  killCriteria: string[];
};

export type NoviceMarketScreeningRun = {
  schemaVersion: "novice-market-screening-run.v1";
  displayName: "调查短名单预览";
  status: "completed" | "insufficient_advance_pool";
  advanceMeaning: "top_k_investigation_quota_not_quality_or_commercial_approval";
  selectionMechanism: "deterministic_top_k_quota";
  rankingRunId: string;
  rankingRuleVersion: string;
  briefId: string;
  collectionRunId: string;
  sourceBatchId: string;
  inputHash: string;
  createdAt: string;
  configuration: { advanceFloor: 3; advanceLimit: 5 };
  summary: Record<NoviceScreeningItemStatus, number>;
  items: NoviceMarketScreeningItem[];
  formalCandidateGenerated: false;
  productionDatabaseWritten: false;
  externalAiApiCalled: false;
  screeningHash: string;
};

function ternary(value: TernaryAnswer | null | undefined): RawTernaryAnswer {
  return value === "yes" || value === "no" || value === "uncertain" ? value : "missing";
}

function confidence(value: "high" | "medium" | "low" | null | undefined): RawConfidenceAnswer {
  return value === "high" || value === "medium" || value === "low" ? value : "missing";
}

function preserveAnswer(answer: NoviceBlindAnswer | undefined, expectedBlindItemId: string | null): PreservedHumanAnswer {
  return {
    blindItemId: answer?.blindItemId ?? expectedBlindItemId,
    productUnderstood: ternary(answer?.productUnderstood),
    evidenceSufficient: ternary(answer?.evidenceSufficient),
    obviousConcern: ternary(answer?.obviousConcern),
    investigateNext10Minutes: ternary(answer?.investigateNext10Minutes),
    confidence: confidence(answer?.confidence),
    elapsedSeconds: typeof answer?.elapsedSeconds === "number" && Number.isFinite(answer.elapsedSeconds)
      ? answer.elapsedSeconds
      : null,
    note: typeof answer?.note === "string" ? answer.note : null,
  };
}

function verifyPacketBindings(input: NoviceMarketScreeningInput) {
  if (input.ranking.schemaVersion !== "ranking-run.v1"
    || input.marketEvidence.schemaVersion !== "novice-screening-market-evidence.v1"
    || input.blindReview.schemaVersion !== "blind-review-material.v1"
    || input.novicePacket.schemaVersion !== "solo-novice-blind-review-packet.v1"
    || input.responses.schemaVersion !== "solo-novice-blind-review-responses.v1") {
    throw new Error("NOVICE_SCREENING_SCHEMA_INVALID");
  }
  if (input.novicePacket.sourceBlindReviewId !== input.blindReview.blindReviewId
    || input.novicePacket.sourceEvidenceHash !== stableHash(input.blindReview)) {
    throw new Error("NOVICE_SCREENING_BLIND_REVIEW_BINDING_INVALID");
  }
  const { packetHash, ...packetBody } = input.novicePacket;
  if (packetHash !== stableHash(packetBody) || input.responses.sourcePacketHash !== packetHash) {
    throw new Error("NOVICE_SCREENING_RESPONSE_BINDING_INVALID");
  }
}

function uniqueMap<T>(values: T[], keyFor: (value: T) => string, errorCode: string) {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key || result.has(key)) throw new Error(errorCode);
    result.set(key, value);
  }
  return result;
}

function rankOrder(left: { rank: number | null; productKey: string }, right: { rank: number | null; productKey: string }) {
  if (left.rank === null && right.rank !== null) return 1;
  if (left.rank !== null && right.rank === null) return -1;
  return (left.rank ?? 0) - (right.rank ?? 0) || left.productKey.localeCompare(right.productKey);
}

function canonicalInput(input: NoviceMarketScreeningInput) {
  return {
    ranking: input.ranking,
    marketEvidence: input.marketEvidence,
    blindReview: input.blindReview,
    novicePacket: input.novicePacket,
    responses: input.responses,
    configuration: { advanceFloor: 3, advanceLimit: 5 },
  };
}

export function buildNoviceMarketScreeningRun(input: NoviceMarketScreeningInput): NoviceMarketScreeningRun {
  verifyPacketBindings(input);
  const rankingByCandidate = uniqueMap(input.ranking.results, (item) => item.candidateId, "NOVICE_SCREENING_RANKING_DUPLICATE");
  if (uniqueMap(input.ranking.results, (item) => item.productKey, "NOVICE_SCREENING_PRODUCT_DUPLICATE").size !== rankingByCandidate.size) {
    throw new Error("NOVICE_SCREENING_PRODUCT_DUPLICATE");
  }
  const evidenceByCandidate = uniqueMap(
    input.marketEvidence.candidates,
    (item) => item.candidateId,
    "NOVICE_SCREENING_MARKET_EVIDENCE_DUPLICATE",
  );
  const blindByCandidate = uniqueMap(input.blindReview.items, (item) => item.candidateId, "NOVICE_SCREENING_BLIND_ITEM_DUPLICATE");
  const answersByBlindItem = uniqueMap(input.responses.answers, (item) => item.blindItemId, "NOVICE_SCREENING_ANSWER_DUPLICATE");
  const failedQualityGates = (Object.entries(input.marketEvidence.qualityGates) as Array<[
    "source" | "context" | "layout",
    QualityGateResult,
  ]>).filter(([, gate]) => gate.status !== "passed");

  const preliminary = [...input.ranking.results].sort(rankOrder).map((stage1) => {
    const market = evidenceByCandidate.get(stage1.candidateId);
    const blind = blindByCandidate.get(stage1.candidateId);
    const answer = blind ? answersByBlindItem.get(blind.blindItemId) : undefined;
    const rawHumanAnswer = preserveAnswer(answer, blind?.blindItemId ?? null);
    const marketEvidenceReasons = failedQualityGates.map(([name]) => `quality_gate_${name}_failed`);
    const productBindingValid = Boolean(market
      && blind
      && market.productKey === stage1.productKey
      && market.inputEvidenceHash === stage1.inputEvidenceHash
      && blind.evidenceSnapshotId === market.evidenceSnapshotId);
    if (!productBindingValid) marketEvidenceReasons.push("product_binding_invalid");
    if (!market?.minimumEvidencePack.complete) marketEvidenceReasons.push("minimum_evidence_incomplete");
    if (stage1.promotionDecision === "insufficient_evidence" && market?.minimumEvidencePack.complete) {
      marketEvidenceReasons.push("stage1_minimum_evidence_inconsistent");
    }
    const screeningEvidenceSufficient = failedQualityGates.length === 0
      && productBindingValid
      && market?.minimumEvidencePack.complete === true
      && stage1.promotionDecision !== "insufficient_evidence";
    const userUnderstandsProduct = rawHumanAnswer.productUnderstood === "yes";
    const willingToContinueResearch = rawHumanAnswer.investigateNext10Minutes === "yes";
    const humanGateReasons = [
      userUnderstandsProduct ? null : `product_understood_${rawHumanAnswer.productUnderstood}`,
      willingToContinueResearch ? null : `continue_research_${rawHumanAnswer.investigateNext10Minutes}`,
    ].filter((item): item is string => item !== null);

    const status: NoviceScreeningItemStatus = !screeningEvidenceSufficient
      ? "insufficient"
      : !stage1.hardGateResult.passed || stage1.promotionDecision === "rejected"
        ? "reject"
        : !userUnderstandsProduct || !willingToContinueResearch
          ? "watch"
          : "advance";
    return {
      schemaVersion: "novice-market-screening-item.v1" as const,
      candidateId: stage1.candidateId,
      productKey: stage1.productKey,
      stage1Rank: stage1.rank,
      stage1PromotionDecision: stage1.promotionDecision,
      screeningEvidenceSufficient,
      userUnderstandsProduct,
      willingToContinueResearch,
      rawHumanAnswer,
      marketEvidenceReasons,
      humanGateReasons,
      status,
      supportingEvidence: [...stage1.supportingEvidence],
      counterEvidence: [
        ...stage1.counterEvidence,
        ...(rawHumanAnswer.obviousConcern === "yes" ? ["新手报告存在需进一步核实的直观担忧"] : []),
      ],
      missingEvidence: [...new Set([
        ...stage1.missingEvidence,
        ...(market?.minimumEvidencePack.missingEvidence ?? []),
        ...marketEvidenceReasons,
        ...humanGateReasons,
      ])],
      nextValidationPlan: status === "insufficient"
        ? ["补齐市场层最低证据并重新绑定来源"]
        : status === "reject"
          ? ["仅在硬阻断或 Stage 1 淘汰依据被可靠新证据推翻后重评"]
          : status === "watch"
            ? ["保留观察；先解决理解、调查意愿或调查配额限制"]
            : ["进入调查短名单；专业商业验证仍为独立后续决定"],
      killCriteria: [...stage1.killCriteria],
    };
  });

  const eligible = preliminary.filter((item) => item.status === "advance").sort((left, right) => rankOrder(
    { rank: left.stage1Rank, productKey: left.productKey },
    { rank: right.stage1Rank, productKey: right.productKey },
  ));
  const selected = new Set(eligible.slice(0, 5).map((item) => item.productKey));
  const items = preliminary.map((item) => item.status === "advance" && !selected.has(item.productKey)
    ? {
        ...item,
        status: "watch" as const,
        humanGateReasons: [...item.humanGateReasons, "top_k_quota_not_allocated"],
        missingEvidence: [...item.missingEvidence, "top_k_quota_not_allocated"],
        nextValidationPlan: ["本批未获得调查配额；保留观察，不解释为质量或商业失败"],
      }
    : item);
  const summary = items.reduce<Record<NoviceScreeningItemStatus, number>>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { advance: 0, watch: 0, reject: 0, insufficient: 0 });
  const body = {
    schemaVersion: "novice-market-screening-run.v1" as const,
    displayName: "调查短名单预览" as const,
    status: summary.advance < 3 ? "insufficient_advance_pool" as const : "completed" as const,
    advanceMeaning: "top_k_investigation_quota_not_quality_or_commercial_approval" as const,
    selectionMechanism: "deterministic_top_k_quota" as const,
    rankingRunId: input.ranking.rankingRunId,
    rankingRuleVersion: input.ranking.rankingRuleVersion,
    briefId: input.ranking.briefId,
    collectionRunId: input.ranking.collectionRunId,
    sourceBatchId: input.marketEvidence.sourceBatchId,
    inputHash: stableHash(canonicalInput(input)),
    createdAt: input.createdAt,
    configuration: { advanceFloor: 3 as const, advanceLimit: 5 as const },
    summary,
    items,
    formalCandidateGenerated: false as const,
    productionDatabaseWritten: false as const,
    externalAiApiCalled: false as const,
  };
  return { ...body, screeningHash: stableHash(body) };
}

export function buildNoviceMarketScreeningAcceptance(
  run: NoviceMarketScreeningRun,
  replayScreeningHash: string | null,
) {
  const itemCount = run.items.length;
  const statusCount = Object.values(run.summary).reduce((sum, count) => sum + count, 0);
  const { screeningHash, ...runBody } = run;
  const checks = {
    schemaValid: run.schemaVersion === "novice-market-screening-run.v1",
    screeningHashValid: stableHash(runBody) === screeningHash,
    deterministicReplayVerified: replayScreeningHash === screeningHash,
    inputCountIsTwenty: itemCount === 20,
    partitionComplete: statusCount === itemCount && new Set(run.items.map((item) => item.productKey)).size === itemCount,
    advanceWithinTarget: run.summary.advance >= 3 && run.summary.advance <= 5,
    noFormalWrites: !run.formalCandidateGenerated && !run.productionDatabaseWritten && !run.externalAiApiCalled,
    topKMeaningExplicit: run.advanceMeaning === "top_k_investigation_quota_not_quality_or_commercial_approval",
  };
  const engineeringPassed = Object.values(checks).every(Boolean);
  const body = {
    schemaVersion: "novice-market-screening-acceptance.v1" as const,
    sourceScreeningHash: run.screeningHash,
    engineering: {
      status: engineeringPassed ? "passed" as const : "failed" as const,
      conclusion: engineeringPassed
        ? "deterministic_scope_reduction_verified" as const
        : "deterministic_scope_reduction_not_verified" as const,
      checks,
      reasonCodes: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    },
    effectiveness: {
      status: "not_validated" as const,
      conclusion: "screening_effectiveness_not_validated" as const,
      reasonCodes: ["mechanical_top_k_quota_only", "no_downstream_commercial_outcome", "no_expert_ground_truth"],
    },
  };
  return { ...body, evidenceHash: stableHash(body) };
}
