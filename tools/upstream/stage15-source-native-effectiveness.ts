import { stableHash } from "../../lib/upstream/pipeline";
import type { NoviceMarketScreeningRun } from "./novice-market-screening";
import { assertStage15SourceNativeBatchIntegrity, type Stage15SourceNativeBatch } from "./stage15-source-native-batch";
import {
  assertSourceNativeOutcomeAssessorResult,
  buildStage15SourceNativeEvaluationMaterials,
  type SourceNativeOutcomeAssessorResult,
  type Stage15SourceNativeEvaluationMaterials,
} from "./stage15-source-native-evaluation";
import {
  assertStage15SourceNativeScreeningIntegrity,
  buildStage15SourceNativeScreening,
  type BuildStage15SourceNativeScreeningInput,
  type Stage15SourceNativeScreening,
} from "./stage15-source-native-screening";

type Hash = string;
type Outcome = "yes" | "no" | "insufficient_evidence";
type Rate = { numerator: number; denominator: number; rate: number };

export type SourceNativeRoleAttestations = {
  schemaVersion: "stage15-source-native-role-attestations.v1";
  screeningOperatorDistinctFromOutcomeAssessors: boolean;
  outcomeAssessorsDistinct: boolean;
  identityHardGateReasons: string[];
  attestationHash: Hash;
};

export type SourceNativeEffectivenessScreeningSource =
  | { kind: "task7_artifact"; artifact: Stage15SourceNativeScreening; trustedInput: BuildStage15SourceNativeScreeningInput }
  | { kind: "verified_novice_market_screening"; run: NoviceMarketScreeningRun; trustedInput: BuildStage15SourceNativeScreeningInput };

export type BuildStage15SourceNativeEffectivenessInput = {
  batch: Stage15SourceNativeBatch;
  materials: Stage15SourceNativeEvaluationMaterials;
  screening: SourceNativeEffectivenessScreeningSource;
  outcomeAssessorResults: SourceNativeOutcomeAssessorResult[];
  roleAttestations: SourceNativeRoleAttestations;
};

export type SourceNativeEffectivenessAnalysis = {
  schemaVersion: "source-native-effectiveness-analysis.v1";
  inputHash: Hash;
  screeningSource: "task7_artifact" | "verified_novice_market_screening";
  roleStatus: {
    screeningOperatorIndependent: boolean;
    outcomeAssessorAIndependent: boolean;
    outcomeAssessorBIndependent: boolean;
    outcomeAssessorsIndependent: boolean;
    allThreeRolesIndependent: boolean;
    hardGateReasons: string[];
  };
  assessors: Array<{
    role: "outcome_assessor_a" | "outcome_assessor_b";
    completed: true;
    metrics: {
      advanceContinue: Rate;
      nonAdvanceContinue: Rate;
      continueRateLift: Rate;
      advanceInsufficient: Rate;
      overallEvidenceSufficient: Rate;
      medianCompletionSeconds: number;
    };
  }>;
  pairwise: null | {
    exactAgreement: Rate;
    cohenKappa: { value: number | null; descriptiveOnly: true; unavailableReason: "expected_agreement_one" | null };
  };
  conclusion: "blocked" | "evaluation_inconclusive" | "screening_workflow_signal_not_observed" | "directional_workflow_signal_observed" | "screening_workflow_effectiveness_supported_on_batch_d";
  boundaries: {
    screeningEffectivenessValidated: false;
    commercialCandidateGenerated: false;
    profitabilityValidated: false;
    batchCModified: false;
    batchVUnlocked: false;
    productionEffect: false;
  };
  analysisHash: Hash;
};

const HASH = /^[a-f0-9]{64}$/u;
const SAMPLE_SIZE = 20;
const ADVANCE_SIZE = 5;
const NON_ADVANCE_SIZE = 15;

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function hash(value: unknown): value is Hash { return typeof value === "string" && HASH.test(value); }
function rate(numerator: number, denominator: number): Rate { return { numerator, denominator, rate: numerator / denominator }; }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }

function assertRoleAttestations(value: unknown): asserts value is SourceNativeRoleAttestations {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "screeningOperatorDistinctFromOutcomeAssessors", "outcomeAssessorsDistinct", "identityHardGateReasons", "attestationHash"])
    || value.schemaVersion !== "stage15-source-native-role-attestations.v1" || typeof value.screeningOperatorDistinctFromOutcomeAssessors !== "boolean"
    || typeof value.outcomeAssessorsDistinct !== "boolean" || !Array.isArray(value.identityHardGateReasons)
    || value.identityHardGateReasons.some((reason) => typeof reason !== "string" || !reason.trim()) || new Set(value.identityHardGateReasons).size !== value.identityHardGateReasons.length || !hash(value.attestationHash)) {
    fail("SOURCE_NATIVE_EFFECTIVENESS_ROLE_ATTESTATION_INVALID");
  }
  const { attestationHash, ...body } = value;
  if (stableHash(body) !== attestationHash) fail("SOURCE_NATIVE_EFFECTIVENESS_ROLE_ATTESTATION_INVALID");
}

function trustedScreening(input: BuildStage15SourceNativeEffectivenessInput): NoviceMarketScreeningRun {
  try {
    assertStage15SourceNativeBatchIntegrity(input.batch);
    const expectedMaterials = buildStage15SourceNativeEvaluationMaterials(input.batch, input.batch.createdAt);
    if (stableHash(input.materials) !== stableHash(expectedMaterials)) fail("SOURCE_NATIVE_EFFECTIVENESS_MATERIALS_UNTRUSTED");
    const trusted = input.screening.trustedInput;
    if (stableHash(trusted.batch) !== stableHash(input.batch) || stableHash(trusted.materials) !== stableHash(input.materials)) fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_UNTRUSTED");
    const replay = buildStage15SourceNativeScreening(trusted);
    if (input.screening.kind === "task7_artifact") {
      assertStage15SourceNativeScreeningIntegrity(input.screening.artifact, trusted);
      if (stableHash(input.screening.artifact) !== stableHash(replay)) fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_UNTRUSTED");
    } else if (stableHash(input.screening.run) !== stableHash(replay.screening)) {
      fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_UNTRUSTED");
    }
    return replay.screening;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SOURCE_NATIVE_EFFECTIVENESS_")) throw error;
    fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_UNTRUSTED");
  }
}

function validateResults(input: BuildStage15SourceNativeEffectivenessInput): SourceNativeOutcomeAssessorResult[] {
  if (!Array.isArray(input.outcomeAssessorResults) || input.outcomeAssessorResults.length > 2) fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_INVALID");
  const results = [...input.outcomeAssessorResults].sort((left, right) => left.role.localeCompare(right.role));
  if (new Set(results.map((result) => result.role)).size !== results.length) fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_INVALID");
  try {
    for (const result of results) {
      const template = result.role === "outcome_assessor_a" ? input.materials.outcome.assessorA.template : input.materials.outcome.assessorB.template;
      assertSourceNativeOutcomeAssessorResult(result, template);
    }
  } catch {
    fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_INVALID");
  }
  return results;
}

function statusByProduct(screening: NoviceMarketScreeningRun): Map<string, "advance" | "nonadvance"> {
  if (screening.items.length !== SAMPLE_SIZE || screening.summary.advance !== ADVANCE_SIZE || Object.values(screening.summary).reduce((total, count) => total + count, 0) !== SAMPLE_SIZE) {
    fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_PARTITION_INVALID");
  }
  const statuses = new Map<string, "advance" | "nonadvance">();
  for (const item of screening.items) {
    if (!item.productKey || statuses.has(item.productKey)) fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_PARTITION_INVALID");
    statuses.set(item.productKey, item.status === "advance" ? "advance" : "nonadvance");
  }
  if ([...statuses.values()].filter((status) => status === "advance").length !== ADVANCE_SIZE) fail("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_PARTITION_INVALID");
  return statuses;
}

function metricsFor(result: SourceNativeOutcomeAssessorResult, materials: Stage15SourceNativeEvaluationMaterials, statuses: Map<string, "advance" | "nonadvance">) {
  const bindingById = new Map(materials.outcome.bindings.bindings.map((binding) => [binding.evaluationItemId, binding]));
  const answers = new Map(result.answers.map((answer) => [answer.evaluationItemId, answer]));
  if (bindingById.size !== SAMPLE_SIZE || answers.size !== SAMPLE_SIZE) fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_BINDING_INVALID");
  let advanceYes = 0; let nonAdvanceYes = 0; let advanceInsufficient = 0; let evidenceYes = 0;
  const ordered: Array<{ productKey: string; outcome: Outcome }> = [];
  for (const [evaluationItemId, binding] of bindingById) {
    const answer = answers.get(evaluationItemId); const status = statuses.get(binding.productKey);
    if (!answer || !status) fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_BINDING_INVALID");
    if (answer.evidenceSufficient === "yes") evidenceYes += 1;
    if (status === "advance") {
      if (answer.worthFurtherInvestigation === "yes") advanceYes += 1;
      if (answer.worthFurtherInvestigation === "insufficient_evidence") advanceInsufficient += 1;
    } else if (answer.worthFurtherInvestigation === "yes") nonAdvanceYes += 1;
    const outcome = answer.worthFurtherInvestigation;
    if (outcome !== "yes" && outcome !== "no" && outcome !== "insufficient_evidence") fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_BINDING_INVALID");
    ordered.push({ productKey: binding.productKey, outcome });
  }
  const elapsed = result.answers.map((answer): number => typeof answer.elapsedSeconds === "number" ? answer.elapsedSeconds : fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_INVALID")).sort((left, right) => left - right);
  const liftNumerator = advanceYes * NON_ADVANCE_SIZE - nonAdvanceYes * ADVANCE_SIZE;
  return {
    role: result.role,
    completed: true as const,
    metrics: {
      advanceContinue: rate(advanceYes, ADVANCE_SIZE), nonAdvanceContinue: rate(nonAdvanceYes, NON_ADVANCE_SIZE),
      continueRateLift: rate(liftNumerator, ADVANCE_SIZE * NON_ADVANCE_SIZE), advanceInsufficient: rate(advanceInsufficient, ADVANCE_SIZE),
      overallEvidenceSufficient: rate(evidenceYes, SAMPLE_SIZE), medianCompletionSeconds: (elapsed[9] + elapsed[10]) / 2,
    },
    ordered: ordered.sort((left, right) => left.productKey.localeCompare(right.productKey)),
  };
}

function pairwise(left: ReturnType<typeof metricsFor>, right: ReturnType<typeof metricsFor>): SourceNativeEffectivenessAnalysis["pairwise"] {
  let agreement = 0;
  const leftCounts: Record<Outcome, number> = { yes: 0, no: 0, insufficient_evidence: 0 };
  const rightCounts: Record<Outcome, number> = { yes: 0, no: 0, insufficient_evidence: 0 };
  for (let index = 0; index < SAMPLE_SIZE; index += 1) {
    if (left.ordered[index].productKey !== right.ordered[index].productKey) fail("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_BINDING_INVALID");
    const a = left.ordered[index].outcome; const b = right.ordered[index].outcome;
    leftCounts[a] += 1; rightCounts[b] += 1; if (a === b) agreement += 1;
  }
  const expectedNumerator = (leftCounts.yes * rightCounts.yes) + (leftCounts.no * rightCounts.no) + (leftCounts.insufficient_evidence * rightCounts.insufficient_evidence);
  const kappaDenominator = SAMPLE_SIZE * SAMPLE_SIZE - expectedNumerator;
  return { exactAgreement: rate(agreement, SAMPLE_SIZE), cohenKappa: { value: kappaDenominator === 0 ? null : ((agreement * SAMPLE_SIZE) - expectedNumerator) / kappaDenominator, descriptiveOnly: true, unavailableReason: kappaDenominator === 0 ? "expected_agreement_one" : null } };
}

function conclusionFor(analysis: Omit<SourceNativeEffectivenessAnalysis, "analysisHash">): SourceNativeEffectivenessAnalysis["conclusion"] {
  if (analysis.roleStatus.hardGateReasons.length > 0) return "blocked";
  if (analysis.assessors.length === 0) return "evaluation_inconclusive";
  if (analysis.assessors.some((assessor) => assessor.metrics.overallEvidenceSufficient.numerator < 10)) return "evaluation_inconclusive";
  if (analysis.assessors.length === 2 && (analysis.pairwise?.exactAgreement.numerator ?? 0) < 15) return "evaluation_inconclusive";
  const lift = (assessor: (typeof analysis.assessors)[number]) => assessor.metrics.continueRateLift.numerator;
  if (analysis.assessors.length === 1) return lift(analysis.assessors[0]) > 0 ? "directional_workflow_signal_observed" : "screening_workflow_signal_not_observed";
  const [first, second] = analysis.assessors;
  if ((lift(first) <= 0 && lift(second) <= 0) || (lift(first) < 0 && lift(second) <= 0) || (lift(second) < 0 && lift(first) <= 0)) return "screening_workflow_signal_not_observed";
  const supported = analysis.roleStatus.allThreeRolesIndependent
    && analysis.assessors.every((assessor) => assessor.metrics.advanceContinue.numerator >= 3 && assessor.metrics.continueRateLift.numerator >= 15 && assessor.metrics.advanceInsufficient.numerator <= 1)
    && (analysis.pairwise?.exactAgreement.numerator ?? 0) >= 15;
  return supported ? "screening_workflow_effectiveness_supported_on_batch_d" : "directional_workflow_signal_observed";
}

export function analyzeStage15SourceNativeEffectiveness(input: BuildStage15SourceNativeEffectivenessInput): SourceNativeEffectivenessAnalysis {
  assertRoleAttestations(input.roleAttestations);
  const screening = trustedScreening(input);
  const results = validateResults(input);
  const statuses = statusByProduct(screening);
  const projected = results.map((result) => metricsFor(result, input.materials, statuses));
  const assessors = projected.map(({ ordered: _ordered, ...assessor }) => assessor);
  const roleStatus = {
    screeningOperatorIndependent: input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors,
    outcomeAssessorAIndependent: results.some((result) => result.role === "outcome_assessor_a") && input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors,
    outcomeAssessorBIndependent: results.some((result) => result.role === "outcome_assessor_b") && input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors,
    outcomeAssessorsIndependent: input.roleAttestations.outcomeAssessorsDistinct,
    allThreeRolesIndependent: input.roleAttestations.screeningOperatorDistinctFromOutcomeAssessors && input.roleAttestations.outcomeAssessorsDistinct && results.length === 2,
    hardGateReasons: [...input.roleAttestations.identityHardGateReasons],
  };
  const pair = projected.length === 2 ? pairwise(projected[0], projected[1]) : null;
  const inputHash = stableHash({ batchHash: input.batch.batchHash, materialsHash: input.materials.materialsHash, screening: input.screening, outcomeResults: results, roleAttestations: input.roleAttestations });
  const base = {
    schemaVersion: "source-native-effectiveness-analysis.v1" as const, inputHash, screeningSource: input.screening.kind, roleStatus, assessors, pairwise: pair,
    conclusion: "evaluation_inconclusive" as const,
    boundaries: { screeningEffectivenessValidated: false as const, commercialCandidateGenerated: false as const, profitabilityValidated: false as const, batchCModified: false as const, batchVUnlocked: false as const, productionEffect: false as const },
  };
  const conclusion = conclusionFor(base);
  const body = { ...base, conclusion };
  return { ...body, analysisHash: stableHash(body) };
}

export const buildStage15SourceNativeEffectivenessAnalysis = analyzeStage15SourceNativeEffectiveness;

export function assertStage15SourceNativeEffectivenessIntegrity(value: unknown, trustedInput: BuildStage15SourceNativeEffectivenessInput): asserts value is SourceNativeEffectivenessAnalysis {
  if (!record(value) || !hash(value.analysisHash)) fail("SOURCE_NATIVE_EFFECTIVENESS_ARTIFACT_INVALID");
  const { analysisHash, ...body } = value;
  if (stableHash(body) !== analysisHash) fail("SOURCE_NATIVE_EFFECTIVENESS_HASH_INVALID");
  const expected = analyzeStage15SourceNativeEffectiveness(trustedInput);
  if (stableHash(value) !== stableHash(expected)) fail("SOURCE_NATIVE_EFFECTIVENESS_REPLAY_INVALID");
}
