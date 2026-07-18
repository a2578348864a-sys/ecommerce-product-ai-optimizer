import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildNoviceMarketScreeningRun,
  type NoviceMarketScreeningInput,
  type NoviceMarketScreeningRun,
} from "./novice-market-screening";
import {
  assertStage15SourceNativeBatchIntegrity,
  type Stage15SourceNativeBatch,
} from "./stage15-source-native-batch";
import {
  assertSourceNativeScreeningOperatorResult,
  buildStage15SourceNativeEvaluationMaterials,
  type SourceNativeScreeningOperatorResult,
  type Stage15SourceNativeEvaluationMaterials,
} from "./stage15-source-native-evaluation";

type Hash = string;

export type BuildStage15SourceNativeScreeningInput = {
  batch: Stage15SourceNativeBatch;
  materials: Stage15SourceNativeEvaluationMaterials;
  operatorResult: SourceNativeScreeningOperatorResult;
};

export type Stage15SourceNativeScreening = {
  schemaVersion: "stage15-source-native-screening.v1";
  batchId: string;
  inputHash: Hash;
  provenance: {
    batchHash: Hash;
    materialsHash: Hash;
    operatorPacketHash: Hash;
    operatorAnswersHash: Hash;
    operatorCompletedAt: string;
    outcomePacketHash: Hash;
    outcomeFrozenAt: string;
  };
  screening: NoviceMarketScreeningRun;
  readiness: {
    state: "ready_for_outcome_assessment";
    outcomePacketFrozen: true;
    screeningEffectivenessValidated: false;
  };
  boundaries: {
    productionEffect: false;
    formalCandidateGenerated: false;
    productionDatabaseWritten: false;
    screeningEffectivenessValidated: false;
  };
  screeningHash: Hash;
};

const HASH = /^[a-f0-9]{64}$/u;
const SAMPLE_SIZE = 20;

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function validHash(value: unknown): value is Hash { return typeof value === "string" && HASH.test(value); }
function iso(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function selfHashed(value: unknown, field: string): boolean {
  if (!record(value) || !validHash(value[field])) return false;
  const { [field]: hash, ...body } = value;
  return stableHash(body) === hash;
}
function uniqueMap<T>(values: T[], keyFor: (value: T) => string, code: string): Map<string, T> {
  const mapped = new Map<string, T>();
  for (const value of values) {
    const key = keyFor(value);
    if (!key || mapped.has(key)) fail(code);
    mapped.set(key, value);
  }
  return mapped;
}

function canonicalAnswers(result: SourceNativeScreeningOperatorResult) {
  return result.answers.map((answer) => ({ ...answer })).sort((left, right) => left.evaluationItemId.localeCompare(right.evaluationItemId));
}

function assertMaterialsShape(materials: Stage15SourceNativeEvaluationMaterials): void {
  if (!record(materials) || !record(materials.operator) || !record(materials.outcome)
    || !record(materials.operator.packet) || !record(materials.operator.bindings) || !record(materials.operator.template)
    || !record(materials.outcome.packet) || !record(materials.outcome.bindings)) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
  if (!selfHashed(materials.operator.packet, "packetHash") || !selfHashed(materials.outcome.packet, "packetHash")
    || !selfHashed(materials.operator.bindings, "bindingsHash") || !selfHashed(materials.outcome.bindings, "bindingsHash")) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
  const operatorCards = materials.operator.packet.cards;
  const operatorBindings = materials.operator.bindings.bindings;
  if (!Array.isArray(operatorCards) || !Array.isArray(operatorBindings) || operatorCards.length !== SAMPLE_SIZE || operatorBindings.length !== SAMPLE_SIZE
    || materials.operator.bindings.packetHash !== materials.operator.packet.packetHash
    || materials.operator.template.packetHash !== materials.operator.packet.packetHash
    || materials.operator.packet.sourcePacketHash === materials.operator.packet.packetHash) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
  const cardIds = operatorCards.map((card) => card.evaluationItemId);
  const bindingIds = operatorBindings.map((binding) => binding.evaluationItemId);
  if (new Set(cardIds).size !== SAMPLE_SIZE || new Set(bindingIds).size !== SAMPLE_SIZE
    || cardIds.some((id) => !bindingIds.includes(id))
    || materials.operator.template.evaluationItemIdsHash !== stableHash([...cardIds].sort())) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
  if (!iso(materials.outcome.packet.frozenAt) || materials.outcome.bindings.packetHash !== materials.outcome.packet.packetHash) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
}

function assertMaterialsHash(materials: Stage15SourceNativeEvaluationMaterials): void {
  const { materialsHash, ...body } = materials;
  if (!validHash(materialsHash) || stableHash(body) !== materialsHash) fail("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
}

function assertMaterialsMatchTrustedBatch(batch: Stage15SourceNativeBatch, materials: Stage15SourceNativeEvaluationMaterials): void {
  const expected = buildStage15SourceNativeEvaluationMaterials(batch, batch.createdAt);
  if (stableHash(materials) !== stableHash(expected)) fail("SOURCE_NATIVE_SCREENING_MATERIALS_UNTRUSTED");
}

function assertBatchBindings(batch: Stage15SourceNativeBatch, materials: Stage15SourceNativeEvaluationMaterials): void {
  const upstream = uniqueMap(batch.screeningPrivateBindings.bindings, (binding) => binding.blindItemId, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const bindings = uniqueMap(materials.operator.bindings.bindings, (binding) => binding.evaluationItemId, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  if (upstream.size !== SAMPLE_SIZE || bindings.size !== SAMPLE_SIZE) fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  for (const binding of bindings.values()) {
    const source = upstream.get(binding.blindItemId);
    if (!source || source.sampleHash !== binding.sampleHash || source.productKey !== binding.productKey || source.recordHash !== binding.recordHash) {
      fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
    }
  }
  if (materials.operator.packet.sourcePacketHash !== batch.screeningVisualPacket.packetHash
    || materials.operator.bindings.bindings.some((binding) => !batch.screeningVisualPacket.cards.some((card) => card.blindItemId === binding.blindItemId))) {
    fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  }
}

function toNoviceInput(batch: Stage15SourceNativeBatch, materials: Stage15SourceNativeEvaluationMaterials, result: SourceNativeScreeningOperatorResult): NoviceMarketScreeningInput {
  const operatorBindings = uniqueMap(materials.operator.bindings.bindings, (binding) => binding.evaluationItemId, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const privateBindings = uniqueMap(batch.screeningPrivateBindings.bindings, (binding) => binding.blindItemId, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const cards = uniqueMap(batch.screeningVisualPacket.cards, (card) => card.blindItemId, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const scoringByProduct = uniqueMap(batch.stage1.scoringInput.candidates, (candidate) => candidate.productKey, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const rankingProducts = uniqueMap(batch.stage1.rankingRun.results, (item) => item.productKey, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  const rawReviewEvidence = batch.reviewEvidence.evidence;
  if (!Array.isArray(rawReviewEvidence) || rawReviewEvidence.some((evidence) => !record(evidence) || typeof evidence.recordHash !== "string")) {
    fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
  }
  const reviewByRecord = uniqueMap(rawReviewEvidence as Array<{ recordHash: string }>, (evidence) => evidence.recordHash, "SOURCE_NATIVE_SCREENING_BINDING_INVALID");

  const mapped = canonicalAnswers(result).map((answer) => {
    const binding = operatorBindings.get(answer.evaluationItemId);
    if (!binding) fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
    const privateBinding = privateBindings.get(binding.blindItemId);
    const candidate = scoringByProduct.get(binding.productKey);
    const ranked = rankingProducts.get(binding.productKey);
    const card = cards.get(binding.blindItemId);
    if (!privateBinding || !candidate || !ranked || !card || !reviewByRecord.has(binding.recordHash)) fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");
    return { answer, binding, candidate, card };
  });
  if (mapped.length !== SAMPLE_SIZE || new Set(mapped.map((item) => item.binding.productKey)).size !== SAMPLE_SIZE) fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID");

  const blindReview = {
    schemaVersion: "blind-review-material.v1" as const,
    blindReviewId: `source-native-blind-${batch.screeningVisualPacket.packetHash.slice(0, 16)}`,
    criteria: ["product_understood", "evidence_sufficient", "obvious_concern", "investigate_next_10_minutes"],
    items: mapped.map(({ binding, card }) => ({
      blindItemId: binding.blindItemId,
      candidateId: scoringByProduct.get(binding.productKey)?.candidateId ?? fail("SOURCE_NATIVE_SCREENING_BINDING_INVALID"),
      evidenceSnapshotId: `source-native-evidence-${binding.recordHash}`,
      title: card.title,
      sourceUrl: `source-native://screening/${binding.recordHash}`,
      capturedAt: card.capturedAt,
      evidence: { price: card.price, rating: card.rating, reviewCount: card.reviewCount, missingEvidence: [...card.missingReasons] },
    })),
  };
  const novicePacketBody = {
    schemaVersion: "solo-novice-blind-review-packet.v1" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: stableHash(blindReview),
    purpose: "source_native_screening_operator_projection",
    boundary: { validates: ["screening_operator_review"], doesNotValidate: ["commercial_outcome", "screening_effectiveness"] },
    questions: ["product_understood", "evidence_sufficient", "obvious_concern", "investigate_next_10_minutes"],
    allowedAnswers: { ternary: ["yes", "no", "uncertain"], confidence: ["high", "medium", "low"] },
    reviewState: "completed_screening_operator",
    items: blindReview.items.map(({ blindItemId, title, capturedAt, evidence }) => ({ blindItemId, title, capturedAt, evidence })),
  };
  const novicePacket = { ...novicePacketBody, packetHash: stableHash(novicePacketBody) };
  return {
    ranking: batch.stage1.rankingRun,
    marketEvidence: {
      schemaVersion: "novice-screening-market-evidence.v1",
      sourceBatchId: batch.batchId,
      qualityGates: {
        source: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
        context: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
        layout: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
      },
      candidates: mapped.map(({ binding, candidate }) => ({
        candidateId: candidate.candidateId,
        productKey: candidate.productKey,
        evidenceSnapshotId: `source-native-evidence-${binding.recordHash}`,
        inputEvidenceHash: candidate.inputEvidenceHash,
        minimumEvidencePack: { schemaVersion: "minimum-evidence-pack.v1", complete: candidate.minimumEvidenceComplete, missingEvidence: [...candidate.minimumEvidenceMissing] },
      })),
    },
    blindReview,
    novicePacket,
    responses: {
      schemaVersion: "solo-novice-blind-review-responses.v1",
      sourcePacketHash: novicePacket.packetHash,
      status: "completed_screening_operator",
      answers: mapped.map(({ answer, binding }) => ({
        blindItemId: binding.blindItemId,
        productUnderstood: answer.productUnderstood,
        evidenceSufficient: answer.evidenceSufficient,
        obviousConcern: answer.obviousConcern,
        investigateNext10Minutes: answer.investigateNext10Minutes,
        confidence: answer.confidence,
        elapsedSeconds: answer.elapsedSeconds,
        note: answer.note,
      })),
    },
    createdAt: result.completedAt ?? fail("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID"),
  };
}

function screeningInputHash(batch: Stage15SourceNativeBatch, materials: Stage15SourceNativeEvaluationMaterials, result: SourceNativeScreeningOperatorResult, screening: NoviceMarketScreeningRun): Hash {
  return stableHash({
    batchHash: batch.batchHash,
    materialsHash: materials.materialsHash,
    operatorPacketHash: materials.operator.packet.packetHash,
    operatorAnswersHash: stableHash(canonicalAnswers(result)),
    operatorCompletedAt: result.completedAt,
    outcomePacketHash: materials.outcome.packet.packetHash,
    outcomeFrozenAt: materials.outcome.packet.frozenAt,
    noviceScreeningInputHash: screening.inputHash,
  });
}

export function finalizeStage15SourceNativeScreening(input: BuildStage15SourceNativeScreeningInput): Stage15SourceNativeScreening {
  assertStage15SourceNativeBatchIntegrity(input.batch);
  assertMaterialsShape(input.materials);
  assertSourceNativeScreeningOperatorResult(input.operatorResult, input.materials.operator.template);
  if (Date.parse(input.materials.outcome.packet.frozenAt) > Date.parse(input.operatorResult.completedAt ?? "")) fail("SOURCE_NATIVE_SCREENING_OUTCOME_FREEZE_LATE");
  assertMaterialsHash(input.materials);
  assertMaterialsMatchTrustedBatch(input.batch, input.materials);
  assertBatchBindings(input.batch, input.materials);
  const noviceInput = toNoviceInput(input.batch, input.materials, input.operatorResult);
  const screening = buildNoviceMarketScreeningRun(noviceInput);
  const provenance = {
    batchHash: input.batch.batchHash,
    materialsHash: input.materials.materialsHash,
    operatorPacketHash: input.materials.operator.packet.packetHash,
    operatorAnswersHash: stableHash(canonicalAnswers(input.operatorResult)),
    operatorCompletedAt: input.operatorResult.completedAt ?? fail("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID"),
    outcomePacketHash: input.materials.outcome.packet.packetHash,
    outcomeFrozenAt: input.materials.outcome.packet.frozenAt,
  };
  const body = {
    schemaVersion: "stage15-source-native-screening.v1" as const,
    batchId: input.batch.batchId,
    inputHash: screeningInputHash(input.batch, input.materials, input.operatorResult, screening),
    provenance,
    screening,
    readiness: { state: "ready_for_outcome_assessment" as const, outcomePacketFrozen: true as const, screeningEffectivenessValidated: false as const },
    boundaries: { productionEffect: false as const, formalCandidateGenerated: false as const, productionDatabaseWritten: false as const, screeningEffectivenessValidated: false as const },
  };
  return { ...body, screeningHash: stableHash(body) };
}

export const buildStage15SourceNativeScreening = finalizeStage15SourceNativeScreening;

export function assertStage15SourceNativeScreeningIntegrity(
  value: unknown,
  trustedInput: BuildStage15SourceNativeScreeningInput,
): asserts value is Stage15SourceNativeScreening {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "batchId", "inputHash", "provenance", "screening", "readiness", "boundaries", "screeningHash"])
    || !validHash(value.screeningHash)) {
    fail("SOURCE_NATIVE_SCREENING_ARTIFACT_INVALID");
  }
  const { screeningHash, ...body } = value;
  if (stableHash(body) !== screeningHash) fail("SOURCE_NATIVE_SCREENING_HASH_INVALID");
  const expected = finalizeStage15SourceNativeScreening(trustedInput);
  if (stableHash(value) !== stableHash(expected)) fail("SOURCE_NATIVE_SCREENING_REPLAY_INVALID");
}
