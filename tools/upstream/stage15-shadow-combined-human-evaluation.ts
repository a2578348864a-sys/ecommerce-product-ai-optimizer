import { stableHash } from "../../lib/upstream/pipeline";
import {
  validateStage15ShadowBlindEvaluationResult,
  type Stage15ShadowBlindEvaluationPacket,
  type Stage15ShadowBlindEvaluationResult,
} from "./stage15-shadow-blind-evaluation";

type Ternary = "yes" | "no" | "uncertain";
type Binary = "yes" | "no";
type InvestigationDecision = "yes" | "no" | "insufficient_evidence";
type DominantSignal = "market_validation" | "listing_maturity" | "buyer_reviews" | "product_fit" | "risk" | "other";
type Confidence = "high" | "medium" | "low";

export type Stage15ShadowCombinedHumanEvaluationAnswer = {
  evaluationItemId: string;
  productUnderstood: Ternary;
  investigateNext10Minutes: Ternary;
  screeningEvidenceSufficient: Binary;
  worthFurtherInvestigation: InvestigationDecision;
  evidenceSufficient: Binary;
  dominantSignals: DominantSignal[];
  confidence: Confidence;
  reason: string;
};

type CombinedPacket = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-packet.v1";
  batchLabel: string;
  status: "pending_human_evaluation";
  proofLevel: string;
  blindBoundary: Record<string, boolean>;
  items: Array<{ evaluationItemId: string }>;
  packetHash: string;
};

export type Stage15ShadowCombinedBinding = {
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
  bindings: Stage15ShadowCombinedBinding[];
  bindingHash: string;
};

export type Stage15ShadowCombinedHumanEvaluationResult = {
  schemaVersion: "stage15-shadow-combined-human-evaluation-result.v1";
  batchId: string;
  sourcePacketHash: string;
  status: "completed";
  completedAt: string;
  answers: Stage15ShadowCombinedHumanEvaluationAnswer[];
  boundary: {
    humanAnswersPreserved: true;
    commercialConclusionGenerated: false;
    stage1OrStage15WeightsChanged: false;
    candidateGenerated: false;
    databaseWritten: false;
  };
  resultHash: string;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactSet(values: string[], expected: string[]): boolean {
  return values.length === expected.length
    && new Set(values).size === values.length
    && values.every((value) => expected.includes(value));
}

function validatePacket(packet: CombinedPacket): string[] {
  if (packet.schemaVersion !== "stage15-shadow-combined-human-evaluation-packet.v1"
    || packet.status !== "pending_human_evaluation" || packet.items.length !== 20) {
    throw new Error("SHADOW_COMBINED_PACKET_INVALID");
  }
  const { packetHash, ...body } = packet;
  const ids = packet.items.map((item) => item.evaluationItemId);
  if (stableHash(body) !== packetHash || new Set(ids).size !== 20 || ids.some((id) => !id)) {
    throw new Error("SHADOW_COMBINED_PACKET_INVALID");
  }
  return ids;
}

function validateBindings(value: CombinedBindings, packetHash: string, expectedIds: string[]) {
  const { bindingHash, ...body } = value;
  const ids = value.bindings.map((binding) => binding.evaluationItemId);
  const productKeys = value.bindings.map((binding) => binding.productKey);
  if (value.schemaVersion !== "stage15-shadow-combined-human-evaluation-bindings.private.v1"
    || value.packetHash !== packetHash || !value.batchId || stableHash(body) !== bindingHash
    || !exactSet(ids, expectedIds) || new Set(productKeys).size !== 20
    || value.bindings.some((binding) => !binding.productKey || !binding.candidateId
      || !binding.evidenceSnapshotId || !binding.platformProductId || !binding.sourceUrl)) {
    throw new Error("SHADOW_COMBINED_BINDING_INVALID");
  }
}

export function validateStage15ShadowCombinedHumanEvaluationResult(
  value: unknown,
  packet: CombinedPacket,
  bindings: CombinedBindings,
): Stage15ShadowCombinedHumanEvaluationResult {
  const expectedIds = validatePacket(packet);
  validateBindings(bindings, packet.packetHash, expectedIds);
  if (!record(value) || value.schemaVersion !== "stage15-shadow-combined-human-evaluation-result.v1"
    || value.batchId !== bindings.batchId || value.sourcePacketHash !== packet.packetHash
    || value.status !== "completed" || typeof value.completedAt !== "string"
    || Number.isNaN(Date.parse(value.completedAt)) || !Array.isArray(value.answers)
    || value.answers.length !== 20) {
    throw new Error("SHADOW_COMBINED_RESULT_INVALID");
  }
  const ternary = new Set(["yes", "no", "uncertain"]);
  const binary = new Set(["yes", "no"]);
  const decisions = new Set(["yes", "no", "insufficient_evidence"]);
  const signals = new Set(["market_validation", "listing_maturity", "buyer_reviews", "product_fit", "risk", "other"]);
  const confidences = new Set(["high", "medium", "low"]);
  const byId = new Map<string, Stage15ShadowCombinedHumanEvaluationAnswer>();
  for (const raw of value.answers) {
    if (!record(raw) || typeof raw.evaluationItemId !== "string" || !expectedIds.includes(raw.evaluationItemId)
      || !ternary.has(String(raw.productUnderstood)) || !ternary.has(String(raw.investigateNext10Minutes))
      || !binary.has(String(raw.screeningEvidenceSufficient)) || !decisions.has(String(raw.worthFurtherInvestigation))
      || !binary.has(String(raw.evidenceSufficient)) || !Array.isArray(raw.dominantSignals)
      || raw.dominantSignals.length === 0 || new Set(raw.dominantSignals).size !== raw.dominantSignals.length
      || !raw.dominantSignals.every((signal) => signals.has(String(signal)))
      || !confidences.has(String(raw.confidence)) || typeof raw.reason !== "string" || !raw.reason.trim()
      || byId.has(raw.evaluationItemId)) {
      throw new Error("SHADOW_COMBINED_ANSWER_INVALID");
    }
    byId.set(raw.evaluationItemId, {
      evaluationItemId: raw.evaluationItemId,
      productUnderstood: raw.productUnderstood as Ternary,
      investigateNext10Minutes: raw.investigateNext10Minutes as Ternary,
      screeningEvidenceSufficient: raw.screeningEvidenceSufficient as Binary,
      worthFurtherInvestigation: raw.worthFurtherInvestigation as InvestigationDecision,
      evidenceSufficient: raw.evidenceSufficient as Binary,
      dominantSignals: raw.dominantSignals as DominantSignal[],
      confidence: raw.confidence as Confidence,
      reason: raw.reason,
    });
  }
  if (!exactSet([...byId.keys()], expectedIds)) throw new Error("SHADOW_COMBINED_ANSWER_IDENTITY_INVALID");
  const body = {
    schemaVersion: "stage15-shadow-combined-human-evaluation-result.v1" as const,
    batchId: bindings.batchId,
    sourcePacketHash: packet.packetHash,
    status: "completed" as const,
    completedAt: value.completedAt,
    answers: expectedIds.map((id) => byId.get(id) as Stage15ShadowCombinedHumanEvaluationAnswer),
    boundary: {
      humanAnswersPreserved: true as const,
      commercialConclusionGenerated: false as const,
      stage1OrStage15WeightsChanged: false as const,
      candidateGenerated: false as const,
      databaseWritten: false as const,
    },
  };
  return { ...body, resultHash: stableHash(body) };
}

export function buildStage15ShadowEvaluationProjections(input: {
  combinedResult: Stage15ShadowCombinedHumanEvaluationResult;
  combinedBindings: Stage15ShadowCombinedBinding[];
  novicePacketHash: string;
  shadowPacket: Stage15ShadowBlindEvaluationPacket;
  shadowBindings: Array<{ evaluationItemId: string; productKey: string }>;
}): {
  noviceResponses: {
    schemaVersion: "solo-novice-blind-review-responses.v1";
    sourcePacketHash: string;
    status: "completed";
    answers: Array<{
      blindItemId: string;
      productUnderstood: Ternary;
      evidenceSufficient: Binary;
      obviousConcern: null;
      investigateNext10Minutes: Ternary;
      confidence: Confidence;
      elapsedSeconds: null;
      note: string;
    }>;
  };
  shadowResult: Stage15ShadowBlindEvaluationResult;
} {
  if (!/^[a-f0-9]{64}$/u.test(input.novicePacketHash)
    || input.combinedBindings.length !== 20 || input.shadowBindings.length !== 20) {
    throw new Error("SHADOW_COMBINED_PROJECTION_INPUT_INVALID");
  }
  const combinedProductById = new Map(input.combinedBindings.map((binding) => [binding.evaluationItemId, binding.productKey]));
  const answerByProduct = new Map(input.combinedResult.answers.map((answer) => [
    combinedProductById.get(answer.evaluationItemId) ?? "",
    answer,
  ]));
  const shadowProductById = new Map(input.shadowBindings.map((binding) => [binding.evaluationItemId, binding.productKey]));
  const combinedProducts = input.combinedBindings.map((binding) => binding.productKey);
  const shadowProducts = input.shadowBindings.map((binding) => binding.productKey);
  const shadowIds = input.shadowPacket.items.map((item) => item.evaluationItemId);
  if (answerByProduct.has("") || new Set(combinedProducts).size !== 20 || new Set(shadowProducts).size !== 20
    || !exactSet(shadowProducts, combinedProducts)
    || !exactSet(input.shadowBindings.map((binding) => binding.evaluationItemId), shadowIds)) {
    throw new Error("SHADOW_COMBINED_PROJECTION_BINDING_INVALID");
  }
  const noviceResponses = {
    schemaVersion: "solo-novice-blind-review-responses.v1" as const,
    sourcePacketHash: input.novicePacketHash,
    status: "completed" as const,
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
  const shadowRaw = {
    schemaVersion: "stage15-shadow-blind-evaluation-result.v1",
    packetHash: input.shadowPacket.packetHash,
    completedAt: input.combinedResult.completedAt,
    answers: shadowIds.map((evaluationItemId) => {
      const productKey = shadowProductById.get(evaluationItemId);
      const answer = productKey ? answerByProduct.get(productKey) : null;
      if (!answer) throw new Error("SHADOW_COMBINED_PROJECTION_BINDING_INVALID");
      return {
        evaluationItemId,
        worthFurtherInvestigation: answer.worthFurtherInvestigation,
        evidenceSufficient: answer.evidenceSufficient,
        dominantSignals: answer.dominantSignals,
        confidence: answer.confidence,
        reason: answer.reason,
      };
    }),
  };
  return {
    noviceResponses,
    shadowResult: validateStage15ShadowBlindEvaluationResult(shadowRaw, input.shadowPacket),
  };
}
