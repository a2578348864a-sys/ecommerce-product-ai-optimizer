import { stableHash } from "../../lib/upstream/pipeline";
import { assertStage15SourceNativeBatchIntegrity, type SourceNativeOutcomeVisualCard, type SourceNativeVisualCard, type Stage15SourceNativeBatch } from "./stage15-source-native-batch";

type Hash = string;
type OperatorAnswer = {
  evaluationItemId: string;
  productUnderstood: "yes" | "no" | "uncertain" | null;
  evidenceSufficient: "yes" | "no" | "uncertain" | null;
  obviousConcern: "yes" | "no" | "uncertain" | null;
  investigateNext10Minutes: "yes" | "no" | "uncertain" | null;
  confidence: "high" | "medium" | "low" | null;
  elapsedSeconds: number | null;
  note: string;
};
type OutcomeAnswer = {
  evaluationItemId: string;
  productUnderstood: "yes" | "no" | "uncertain" | null;
  evidenceSufficient: "yes" | "no" | null;
  worthFurtherInvestigation: "yes" | "no" | "insufficient_evidence" | null;
  dominantSignals: Array<"market_validation" | "listing_maturity" | "buyer_reviews" | "product_fit" | "risk" | "other">;
  confidence: "high" | "medium" | "low" | null;
  elapsedSeconds: number | null;
  reason: string;
};

export type SourceNativeOperatorPacket = {
  schemaVersion: "stage15-source-native-operator-packet.v1"; batchId: string;
  sourcePacketHash: Hash; cards: Array<Omit<SourceNativeVisualCard, "blindItemId"> & { evaluationItemId: string }>;
  packetHash: Hash;
};
export type SourceNativeOutcomePacket = {
  schemaVersion: "stage15-source-native-outcome-packet.v1"; batchId: string; sourcePacketHash: Hash; frozenAt: string;
  cards: Array<Omit<SourceNativeOutcomeVisualCard, "blindItemId"> & { evaluationItemId: string }>;
  packetHash: Hash;
};
type IsolatedBindings = { schemaVersion: "stage15-source-native-evaluation-bindings.v1"; role: "screening_operator" | "outcome_assessor"; packetHash: Hash; bindings: Array<{ evaluationItemId: string; blindItemId: string; sampleHash: string; productKey: string; recordHash: string }>; bindingsHash: Hash };
export type SourceNativeScreeningOperatorResult = {
  schemaVersion: "stage15-source-native-screening-operator-result.v1"; role: "screening_operator"; slot: "screening_operator";
  sourcePacketHash: Hash; packetHash: Hash; evaluationItemIdsHash: Hash; status: "pending" | "completed"; completedAt: string | null; answers: OperatorAnswer[]; templateHash: Hash; resultHash?: Hash;
};
export type SourceNativeOutcomeAssessorResult = {
  schemaVersion: "stage15-source-native-outcome-assessor-result.v1"; role: "outcome_assessor_a" | "outcome_assessor_b"; slot: "outcome_assessor_a" | "outcome_assessor_b";
  sourcePacketHash: Hash; packetHash: Hash; evaluationItemIdsHash: Hash; status: "pending" | "completed"; completedAt: string | null; roleIndependenceAttested: boolean | null; answers: OutcomeAnswer[]; templateHash: Hash; resultHash?: Hash;
};
export type Stage15SourceNativeEvaluationMaterials = {
  operator: { packet: SourceNativeOperatorPacket; bindings: IsolatedBindings; template: SourceNativeScreeningOperatorResult };
  outcome: { packet: SourceNativeOutcomePacket; bindings: IsolatedBindings; assessorA: { template: SourceNativeOutcomeAssessorResult }; assessorB: { template: SourceNativeOutcomeAssessorResult } };
  readiness: { state: "ready_for_screening_operator"; screeningOperatorSlots: 1; evaluationAllowed: true };
  materialsHash: Hash;
};

const HASH = /^[a-f0-9]{64}$/u;
const OPERATOR_KEYS = ["evaluationItemId", "productUnderstood", "evidenceSufficient", "obviousConcern", "investigateNext10Minutes", "confidence", "elapsedSeconds", "note"];
const OUTCOME_KEYS = ["evaluationItemId", "productUnderstood", "evidenceSufficient", "worthFurtherInvestigation", "dominantSignals", "confidence", "elapsedSeconds", "reason"];
const OUTCOME_SIGNALS = new Set(["market_validation", "listing_maturity", "buyer_reviews", "product_fit", "risk", "other"]);
const PII = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)|(?:(?:\+?\d[\s().-]*){7,}\d)/iu;

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function selfHash<T extends Record<string, unknown>>(body: T, field: string): T & Record<string, Hash> { return { ...body, [field]: stableHash(body) }; }
function validHash(value: unknown): value is Hash { return typeof value === "string" && HASH.test(value); }
function sameIds(left: string[], right: string[]): boolean { return left.length === 20 && right.length === 20 && new Set(left).size === 20 && new Set(right).size === 20 && left.every((id) => right.includes(id)); }
function iso(value: string | null): boolean { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }

function operatorId(sourcePacketHash: string, blindItemId: string): string { return `operator-${stableHash({ sourcePacketHash, blindItemId }).slice(0, 24)}`; }
function outcomeId(sourcePacketHash: string, blindItemId: string): string { return `outcome-${stableHash({ sourcePacketHash, blindItemId }).slice(0, 24)}`; }
function makeBindings(packetHash: string, role: IsolatedBindings["role"], cards: Array<{ evaluationItemId: string; blindItemId: string }>, upstream: Stage15SourceNativeBatch["screeningPrivateBindings"]): IsolatedBindings {
  const lookup = new Map(upstream.bindings.map((binding) => [binding.blindItemId, binding]));
  const bindings = cards.map((card) => {
    const original = lookup.get(card.blindItemId); if (!original) fail("SOURCE_NATIVE_EVALUATION_BINDING_INVALID");
    return { evaluationItemId: card.evaluationItemId, blindItemId: original.blindItemId, sampleHash: original.sampleHash, productKey: original.productKey, recordHash: original.recordHash };
  });
  return selfHash({ schemaVersion: "stage15-source-native-evaluation-bindings.v1" as const, role, packetHash, bindings }, "bindingsHash") as unknown as IsolatedBindings;
}
function operatorTemplate(packet: SourceNativeOperatorPacket): SourceNativeScreeningOperatorResult {
  const body = { schemaVersion: "stage15-source-native-screening-operator-result.v1" as const, role: "screening_operator" as const, slot: "screening_operator" as const, sourcePacketHash: packet.packetHash, packetHash: packet.packetHash, evaluationItemIdsHash: stableHash(packet.cards.map((card) => card.evaluationItemId).sort()), status: "pending" as const, completedAt: null, answers: packet.cards.map((card) => ({ evaluationItemId: card.evaluationItemId, productUnderstood: null, evidenceSufficient: null, obviousConcern: null, investigateNext10Minutes: null, confidence: null, elapsedSeconds: null, note: "" })) };
  return selfHash(body, "templateHash") as unknown as SourceNativeScreeningOperatorResult;
}
function outcomeTemplate(packet: SourceNativeOutcomePacket, role: "outcome_assessor_a" | "outcome_assessor_b"): SourceNativeOutcomeAssessorResult {
  const body = { schemaVersion: "stage15-source-native-outcome-assessor-result.v1" as const, role, slot: role, sourcePacketHash: packet.packetHash, packetHash: packet.packetHash, evaluationItemIdsHash: stableHash(packet.cards.map((card) => card.evaluationItemId).sort()), status: "pending" as const, completedAt: null, roleIndependenceAttested: null, answers: packet.cards.map((card) => ({ evaluationItemId: card.evaluationItemId, productUnderstood: null, evidenceSufficient: null, worthFurtherInvestigation: null, dominantSignals: [], confidence: null, elapsedSeconds: null, reason: "" })) };
  return selfHash(body, "templateHash") as unknown as SourceNativeOutcomeAssessorResult;
}

export function buildStage15SourceNativeEvaluationMaterials(batch: Stage15SourceNativeBatch, frozenAt: string): Stage15SourceNativeEvaluationMaterials {
  assertStage15SourceNativeBatchIntegrity(batch);
  if (batch.readiness.state !== "upstream_only" || frozenAt !== batch.createdAt || !iso(frozenAt)) fail("SOURCE_NATIVE_EVALUATION_FREEZE_INVALID");
  const screeningCards = batch.screeningVisualPacket.cards.map(({ blindItemId, ...card }) => ({ ...card, evaluationItemId: operatorId(batch.screeningVisualPacket.packetHash, blindItemId), blindItemId }));
  const outcomeCards = batch.outcomeVisualPacket.cards.map(({ blindItemId, ...card }) => ({ ...card, evaluationItemId: outcomeId(batch.outcomeVisualPacket.packetHash, blindItemId), blindItemId }));
  const operatorPacket = selfHash({ schemaVersion: "stage15-source-native-operator-packet.v1" as const, batchId: batch.batchId, sourcePacketHash: batch.screeningVisualPacket.packetHash, cards: screeningCards.map(({ blindItemId: _blind, ...card }) => card) }, "packetHash") as unknown as SourceNativeOperatorPacket;
  const outcomePacket = selfHash({ schemaVersion: "stage15-source-native-outcome-packet.v1" as const, batchId: batch.batchId, sourcePacketHash: batch.outcomeVisualPacket.packetHash, frozenAt, cards: outcomeCards.map(({ blindItemId: _blind, ...card }) => card) }, "packetHash") as unknown as SourceNativeOutcomePacket;
  const operatorBindings = makeBindings(operatorPacket.packetHash, "screening_operator", screeningCards, batch.screeningPrivateBindings);
  const outcomeBindings = makeBindings(outcomePacket.packetHash, "outcome_assessor", outcomeCards, batch.outcomePrivateBindings);
  const operator = { packet: operatorPacket, bindings: operatorBindings, template: operatorTemplate(operatorPacket) };
  const outcome = { packet: outcomePacket, bindings: outcomeBindings, assessorA: { template: outcomeTemplate(outcomePacket, "outcome_assessor_a") }, assessorB: { template: outcomeTemplate(outcomePacket, "outcome_assessor_b") } };
  const readiness = { state: "ready_for_screening_operator" as const, screeningOperatorSlots: 1 as const, evaluationAllowed: true as const };
  return selfHash({ operator, outcome, readiness }, "materialsHash") as unknown as Stage15SourceNativeEvaluationMaterials;
}

function assertResultHash(value: Record<string, unknown>, code: string): void {
  const { resultHash, ...body } = value;
  if (!validHash(resultHash) || stableHash(body) !== resultHash) fail(code);
}
function answerKeys(answer: unknown, keys: string[]): answer is Record<string, unknown> { return record(answer) && exactKeys(answer, keys); }
function requiredCommon(value: Record<string, unknown>, role: string[], code: string): void {
  if (!exactKeys(value, ["schemaVersion", "role", "slot", "sourcePacketHash", "packetHash", "evaluationItemIdsHash", "status", "completedAt", "answers", "templateHash", "resultHash"])
    || !role.includes(String(value.role)) || value.slot !== value.role || value.status !== "completed" || typeof value.completedAt !== "string" || !iso(value.completedAt)
    || !validHash(value.sourcePacketHash) || value.sourcePacketHash !== value.packetHash || !validHash(value.packetHash) || !validHash(value.evaluationItemIdsHash) || !validHash(value.templateHash) || !Array.isArray(value.answers)) fail(code);
  assertResultHash(value, code);
}

function assertOperatorTemplate(template: unknown, code: string): asserts template is SourceNativeScreeningOperatorResult {
  if (!record(template) || !exactKeys(template, ["schemaVersion", "role", "slot", "sourcePacketHash", "packetHash", "evaluationItemIdsHash", "status", "completedAt", "answers", "templateHash"])
    || template.schemaVersion !== "stage15-source-native-screening-operator-result.v1" || template.role !== "screening_operator" || template.slot !== "screening_operator" || template.status !== "pending" || template.completedAt !== null || !validHash(template.sourcePacketHash) || template.sourcePacketHash !== template.packetHash || !validHash(template.packetHash) || !validHash(template.evaluationItemIdsHash) || !validHash(template.templateHash) || !Array.isArray(template.answers)) fail(code);
  const { templateHash, ...body } = template;
  if (stableHash(body) !== templateHash || template.answers.length !== 20 || stableHash((template.answers as Array<Record<string, unknown>>).map((answer) => answer.evaluationItemId).sort()) !== template.evaluationItemIdsHash) fail(code);
}
function assertOutcomeTemplate(template: unknown, code: string): asserts template is SourceNativeOutcomeAssessorResult {
  if (!record(template) || !exactKeys(template, ["schemaVersion", "role", "slot", "sourcePacketHash", "packetHash", "evaluationItemIdsHash", "status", "completedAt", "roleIndependenceAttested", "answers", "templateHash"])
    || template.schemaVersion !== "stage15-source-native-outcome-assessor-result.v1" || !["outcome_assessor_a", "outcome_assessor_b"].includes(String(template.role)) || template.slot !== template.role || template.status !== "pending" || template.completedAt !== null || template.roleIndependenceAttested !== null || !validHash(template.sourcePacketHash) || template.sourcePacketHash !== template.packetHash || !validHash(template.packetHash) || !validHash(template.evaluationItemIdsHash) || !validHash(template.templateHash) || !Array.isArray(template.answers)) fail(code);
  const { templateHash, ...body } = template;
  if (stableHash(body) !== templateHash || template.answers.length !== 20 || stableHash((template.answers as Array<Record<string, unknown>>).map((answer) => answer.evaluationItemId).sort()) !== template.evaluationItemIdsHash) fail(code);
}

export function assertSourceNativeScreeningOperatorResult(value: unknown, trustedTemplate: SourceNativeScreeningOperatorResult): asserts value is SourceNativeScreeningOperatorResult {
  const code = "SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID";
  assertOperatorTemplate(trustedTemplate, code);
  if (!record(value)) fail(code);
  requiredCommon(value, ["screening_operator"], code);
  if (value.schemaVersion !== "stage15-source-native-screening-operator-result.v1" || value.sourcePacketHash !== trustedTemplate.sourcePacketHash || value.packetHash !== trustedTemplate.packetHash || value.templateHash !== trustedTemplate.templateHash || value.evaluationItemIdsHash !== trustedTemplate.evaluationItemIdsHash) fail(code);
  const answers = value.answers as unknown[];
  const ids = answers.map((answer) => record(answer) ? answer.evaluationItemId : "");
  if (answers.length !== 20 || new Set(ids).size !== 20 || stableHash([...ids].sort()) !== value.evaluationItemIdsHash) fail(code);
  for (const answer of answers) {
    if (!answerKeys(answer, OPERATOR_KEYS) || !["yes", "no", "uncertain"].includes(String(answer.productUnderstood)) || !["yes", "no", "uncertain"].includes(String(answer.evidenceSufficient)) || !["yes", "no", "uncertain"].includes(String(answer.obviousConcern)) || !["yes", "no", "uncertain"].includes(String(answer.investigateNext10Minutes)) || !["high", "medium", "low"].includes(String(answer.confidence)) || !Number.isFinite(answer.elapsedSeconds) || Number(answer.elapsedSeconds) <= 0 || typeof answer.note !== "string" || answer.note.length > 500 || !answer.note.trim() || PII.test(answer.note)) fail(code);
  }
}

export function assertSourceNativeOutcomeAssessorResult(value: unknown, trustedTemplate: SourceNativeOutcomeAssessorResult): asserts value is SourceNativeOutcomeAssessorResult {
  const code = "SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID";
  assertOutcomeTemplate(trustedTemplate, code);
  if (!record(value) || !exactKeys(value, ["schemaVersion", "role", "slot", "sourcePacketHash", "packetHash", "evaluationItemIdsHash", "status", "completedAt", "roleIndependenceAttested", "answers", "templateHash", "resultHash"])) fail(code);
  if (value.schemaVersion !== "stage15-source-native-outcome-assessor-result.v1" || value.role !== trustedTemplate.role || value.slot !== trustedTemplate.slot || value.sourcePacketHash !== trustedTemplate.sourcePacketHash || value.packetHash !== trustedTemplate.packetHash || value.templateHash !== trustedTemplate.templateHash || value.evaluationItemIdsHash !== trustedTemplate.evaluationItemIdsHash || !["outcome_assessor_a", "outcome_assessor_b"].includes(String(value.role)) || value.slot !== value.role || value.status !== "completed" || value.roleIndependenceAttested !== true || typeof value.completedAt !== "string" || !iso(value.completedAt) || !validHash(value.sourcePacketHash) || value.sourcePacketHash !== value.packetHash || !validHash(value.packetHash) || !validHash(value.evaluationItemIdsHash) || !validHash(value.templateHash) || !Array.isArray(value.answers)) fail(code);
  assertResultHash(value, code);
  const answers = value.answers as unknown[];
  const ids = answers.map((answer) => record(answer) ? answer.evaluationItemId : "");
  if (answers.length !== 20 || new Set(ids).size !== 20 || stableHash([...ids].sort()) !== value.evaluationItemIdsHash) fail(code);
  for (const answer of answers) {
    if (!answerKeys(answer, OUTCOME_KEYS) || !["yes", "no", "uncertain"].includes(String(answer.productUnderstood)) || !["yes", "no"].includes(String(answer.evidenceSufficient)) || !["yes", "no", "insufficient_evidence"].includes(String(answer.worthFurtherInvestigation)) || !Array.isArray(answer.dominantSignals) || answer.dominantSignals.length < 1 || answer.dominantSignals.some((signal) => !OUTCOME_SIGNALS.has(String(signal))) || !["high", "medium", "low"].includes(String(answer.confidence)) || !Number.isFinite(answer.elapsedSeconds) || Number(answer.elapsedSeconds) <= 0 || typeof answer.reason !== "string" || !answer.reason.trim() || answer.reason.length > 500 || PII.test(answer.reason)) fail(code);
  }
}
