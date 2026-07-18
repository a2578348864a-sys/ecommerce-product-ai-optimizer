import { stableHash } from "../../lib/upstream/pipeline";
import type { QualityGateResult, RankingRun } from "../../lib/upstream/contracts";
import {
  buildNoviceMarketScreeningAcceptance,
  buildNoviceMarketScreeningRun,
  type NoviceMarketScreeningInput,
  type NoviceScreeningMarketEvidence,
} from "./novice-market-screening";
import type { buildStage15ShadowPublicSource } from "./stage15-shadow-public-source";
import type { Stage15ShadowCombinedHumanEvaluationResult } from "./stage15-shadow-combined-human-evaluation";

type PublicSourceRun = ReturnType<typeof buildStage15ShadowPublicSource>;

type CombinedPacket = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1";
  packetHash: string;
  items: Array<{ evaluationItemId: string }>;
};

type CombinedBinding = {
  evaluationItemId: string;
  productKey: string;
  candidateId: string;
  evidenceSnapshotId: string;
  platformProductId: string;
  sourceUrl: string;
};

type CombinedBindings = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-bindings.private.v1";
  batchId: string;
  packetHash: string;
  bindings: CombinedBinding[];
  bindingHash: string;
};

type BlindReview = NoviceMarketScreeningInput["blindReview"];
type NovicePacket = NoviceMarketScreeningInput["novicePacket"];

export type Stage15ShadowEvaluationBridge = {
  schemaVersion: "stage15-shadow-evaluation-bridge.private.v1";
  batchId: string;
  sourceUpstreamManifestHash: string;
  sourceCombinedPacketHash: string;
  rankingInputHash: string;
  rankingRunHash: string;
  blindReview: BlindReview;
  novicePacket: NovicePacket;
  marketEvidence: NoviceScreeningMarketEvidence;
  boundary: {
    privateIdentityBridge: true;
    qualityGatesCopiedFromVerifiedPipeline: true;
    humanAnswersPresent: false;
    databaseWritten: false;
    candidateGenerated: false;
    productionEffect: false;
  };
  createdAt: string;
  bridgeHash: string;
};

function qualityGate(value: { status: string; errorCodes: string[]; missingReasons?: string[] }): QualityGateResult {
  return {
    schemaVersion: "quality-gate-result.v1",
    status: value.status === "passed" ? "passed" : "failed",
    errorCodes: [...value.errorCodes],
    missingReasons: [...(value.missingReasons ?? [])],
  };
}

function exactSet(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((value) => right.includes(value));
}

function withoutBridgeHash(bridge: Stage15ShadowEvaluationBridge) {
  const { bridgeHash: _bridgeHash, ...body } = bridge;
  void _bridgeHash;
  return body;
}

export function buildStage15ShadowEvaluationBridge(input: {
  source: PublicSourceRun;
  combinedPacket: CombinedPacket;
  combinedBindings: CombinedBindings;
  sourceUpstreamManifestHash: string;
  createdAt: string;
}): Stage15ShadowEvaluationBridge {
  const pipeline = input.source.sourceAdapterResult.pipeline;
  const { packetHash, ...packetBody } = input.combinedPacket;
  const { bindingHash, ...bindingBody } = input.combinedBindings;
  const candidates = input.source.importPackage.candidates;
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  const productKeys = candidates.map((candidate) => candidate.productKey);
  const evidenceIds = candidates.map((candidate) => candidate.evidenceSnapshot.evidenceSnapshotId);
  const packetIds = input.combinedPacket.items.map((item) => item.evaluationItemId);
  const bindingIds = input.combinedBindings.bindings.map((binding) => binding.evaluationItemId);
  const prefix = input.source.role === "calibration" ? "C-" : "V-";
  if (!pipeline || input.source.importPackage.candidates.length !== 20 || input.source.rankingRun.results.length !== 20
    || input.combinedBindings.bindings.length !== 20 || input.combinedPacket.items.length !== 20
    || input.combinedBindings.batchId !== input.source.batchId || input.combinedBindings.packetHash !== packetHash
    || stableHash(packetBody) !== packetHash || stableHash(bindingBody) !== bindingHash
    || !/^[a-f0-9]{64}$/u.test(input.sourceUpstreamManifestHash) || Number.isNaN(Date.parse(input.createdAt))
    || !exactSet(packetIds, bindingIds) || packetIds.some((id) => !id.startsWith(prefix))
    || !exactSet(candidateIds, input.combinedBindings.bindings.map((binding) => binding.candidateId))
    || !exactSet(productKeys, input.combinedBindings.bindings.map((binding) => binding.productKey))
    || !exactSet(evidenceIds, input.combinedBindings.bindings.map((binding) => binding.evidenceSnapshotId))
    || pipeline.importPackage.importPackageHash !== input.source.importPackage.importPackageHash
    || input.source.rankingRun.inputHash !== input.source.importPackage.importPackageHash
    || input.source.formalCandidateGenerated !== false || input.source.productionDatabaseWritten !== false) {
    throw new Error("SHADOW_EVALUATION_BRIDGE_SOURCE_INVALID");
  }
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const bindingById = new Map(input.combinedBindings.bindings.map((binding) => [binding.evaluationItemId, binding]));
  const blindReview: BlindReview = {
    schemaVersion: "blind-review-material.v1",
    blindReviewId: `blind-${input.source.batchId}-combined-bridge`,
    criteria: ["是否值得进一步调查", "证据是否充分", "是否存在明显淘汰原因", "信心：高／中／低"],
    items: packetIds.map((blindItemId) => {
      const binding = bindingById.get(blindItemId);
      const candidate = binding ? candidateById.get(binding.candidateId) : null;
      if (!binding || !candidate || candidate.productKey !== binding.productKey
        || candidate.evidenceSnapshot.evidenceSnapshotId !== binding.evidenceSnapshotId) {
        throw new Error("SHADOW_EVALUATION_BRIDGE_BINDING_INVALID");
      }
      return {
        blindItemId,
        candidateId: candidate.candidateId,
        evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
        title: candidate.evidenceSnapshot.product.title.normalizedValue,
        sourceUrl: candidate.evidenceSnapshot.sourceUrl,
        capturedAt: candidate.evidenceSnapshot.capturedAt,
        evidence: {
          price: candidate.evidenceSnapshot.product.price.normalizedValue,
          rating: candidate.evidenceSnapshot.product.rating.normalizedValue,
          reviewCount: candidate.evidenceSnapshot.product.reviewCount.normalizedValue,
          missingEvidence: [...candidate.minimumEvidencePack.missingEvidence],
        },
      };
    }),
  };
  const novicePacketBody = {
    schemaVersion: "solo-novice-blind-review-packet.v1" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: stableHash(blindReview),
    purpose: "新批次 Stage 1.5 与影子校准共用盲化人工输入；不验证商业价值",
    boundary: {
      validates: ["商品理解", "继续调查意愿", "人评证据充分性"],
      doesNotValidate: ["盈利", "供应链", "合规", "商业候选"],
    },
    questions: [
      "能否理解商品",
      "是否愿意继续调查10分钟",
      "Stage 1.5证据是否足够",
      "是否值得进一步调查",
      "影子评价证据是否足够",
      "理由与主导信号",
    ] as const,
    allowedAnswers: {
      ternary: ["yes", "no", "uncertain"] as const,
      confidence: ["high", "medium", "low"] as const,
    },
    reviewState: "pending_human_evaluation",
    items: packetIds.map((blindItemId) => ({ blindItemId })),
  };
  const novicePacket: NovicePacket = { ...novicePacketBody, packetHash: stableHash(novicePacketBody) };
  const marketEvidence: NoviceScreeningMarketEvidence = {
    schemaVersion: "novice-screening-market-evidence.v1",
    sourceBatchId: input.source.sourceAdapterResult.sourceBatchId,
    qualityGates: {
      source: qualityGate(input.source.sourceAdapterResult.qualitySummary),
      context: qualityGate(pipeline.contextGate),
      layout: qualityGate(pipeline.layoutGate),
    },
    candidates: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      productKey: candidate.productKey,
      evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
      inputEvidenceHash: candidate.evidenceSnapshot.inputHash,
      minimumEvidencePack: {
        schemaVersion: "minimum-evidence-pack.v1",
        complete: candidate.minimumEvidencePack.complete,
        missingEvidence: [...candidate.minimumEvidencePack.missingEvidence],
      },
    })),
  };
  const body = {
    schemaVersion: "stage15-shadow-evaluation-bridge.private.v1" as const,
    batchId: input.source.batchId,
    sourceUpstreamManifestHash: input.sourceUpstreamManifestHash,
    sourceCombinedPacketHash: packetHash,
    rankingInputHash: input.source.rankingRun.inputHash,
    rankingRunHash: stableHash(input.source.rankingRun),
    blindReview,
    novicePacket,
    marketEvidence,
    boundary: {
      privateIdentityBridge: true as const,
      qualityGatesCopiedFromVerifiedPipeline: true as const,
      humanAnswersPresent: false as const,
      databaseWritten: false as const,
      candidateGenerated: false as const,
      productionEffect: false as const,
    },
    createdAt: input.createdAt,
  };
  return { ...body, bridgeHash: stableHash(body) };
}

export function finalizeStage15ShadowCombinedHumanEvaluation(input: {
  bridge: Stage15ShadowEvaluationBridge;
  rankingRun: RankingRun;
  combinedResult: Stage15ShadowCombinedHumanEvaluationResult;
  createdAt: string;
}) {
  if (stableHash(withoutBridgeHash(input.bridge)) !== input.bridge.bridgeHash
    || input.bridge.schemaVersion !== "stage15-shadow-evaluation-bridge.private.v1") {
    throw new Error("SHADOW_EVALUATION_BRIDGE_INVALID");
  }
  if (input.rankingRun.inputHash !== input.bridge.rankingInputHash
    || stableHash(input.rankingRun) !== input.bridge.rankingRunHash) {
    throw new Error("SHADOW_EVALUATION_RANKING_DRIFT");
  }
  const { resultHash, ...resultBody } = input.combinedResult;
  const expectedIds = input.bridge.blindReview.items.map((item) => item.blindItemId);
  const answerIds = input.combinedResult.answers.map((answer) => answer.evaluationItemId);
  if (stableHash(resultBody) !== resultHash || input.combinedResult.batchId !== input.bridge.batchId
    || input.combinedResult.sourcePacketHash !== input.bridge.sourceCombinedPacketHash
    || !exactSet(answerIds, expectedIds) || Number.isNaN(Date.parse(input.createdAt))
    || Date.parse(input.createdAt) < Date.parse(input.combinedResult.completedAt)) {
    throw new Error("SHADOW_EVALUATION_RESULT_DRIFT");
  }
  const noviceResponses: NoviceMarketScreeningInput["responses"] = {
    schemaVersion: "solo-novice-blind-review-responses.v1",
    sourcePacketHash: input.bridge.novicePacket.packetHash,
    status: "completed",
    answers: input.combinedResult.answers.map((answer) => ({
      blindItemId: answer.evaluationItemId,
      productUnderstood: answer.productUnderstood,
      evidenceSufficient: answer.screeningEvidenceSufficient,
      obviousConcern: null,
      investigateNext10Minutes: answer.investigateNext10Minutes,
      confidence: answer.confidence,
      elapsedSeconds: null,
      note: answer.reason,
    })),
  };
  const screeningInput: NoviceMarketScreeningInput = {
    ranking: input.rankingRun,
    marketEvidence: input.bridge.marketEvidence,
    blindReview: input.bridge.blindReview,
    novicePacket: input.bridge.novicePacket,
    responses: noviceResponses,
    createdAt: input.createdAt,
  };
  const screeningRun = buildNoviceMarketScreeningRun(screeningInput);
  const replay = buildNoviceMarketScreeningRun(screeningInput);
  const acceptance = buildNoviceMarketScreeningAcceptance(screeningRun, replay.screeningHash);
  const boundary = {
    humanAnswersPreserved: true as const,
    databaseWritten: false as const,
    candidateGenerated: false as const,
    productionEffect: false as const,
    stage1OrStage15WeightsChanged: false as const,
    effectivenessConclusion: "screening_effectiveness_not_validated" as const,
  };
  const finalizationBody = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-finalization.v1" as const,
    batchId: input.bridge.batchId,
    sourceBridgeHash: input.bridge.bridgeHash,
    sourceCombinedResultHash: input.combinedResult.resultHash,
    noviceResponses,
    screeningRun,
    acceptance,
    boundary,
    createdAt: input.createdAt,
  };
  return { ...finalizationBody, finalizationHash: stableHash(finalizationBody) };
}
