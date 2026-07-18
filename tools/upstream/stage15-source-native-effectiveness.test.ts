import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAuthorization } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildStage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import { buildStage15SourceNativeEvaluationMaterials } from "./stage15-source-native-evaluation";
import { buildStage15SourceNativeScreening } from "./stage15-source-native-screening";
import {
  analyzeStage15SourceNativeEffectiveness,
  assertStage15SourceNativeEffectivenessIntegrity,
  type SourceNativeRoleAttestations,
} from "./stage15-source-native-effectiveness";

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}
function rehash<T extends Record<string, unknown>>(value: T, field: string): T {
  const { [field]: _discarded, ...body } = value;
  return { ...body, [field]: stableHash(body) } as T;
}
function batch() {
  const selectionBrief = selfHash({ schemaVersion: "stage15-source-native-selection-brief.v1" as const, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, market: "US", language: "en-US", currency: "USD", category: "desk-accessories", targetUseCase: "novice-market-screening", priceRange: { min: 15, max: 45 }, exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] }, sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "task8-test" }, stage1RuleFileHash: "1".repeat(64), stage15RuleFileHash: "2".repeat(64), weightsHash: "3".repeat(64), implementationVersion: "stage15-source-native-v1", imagePolicy: "external_https_only_no_download" as const, requestedSampleSize: 20 as const }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] };
  const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const accessRequest = selfHash({ schemaVersion: "stage15-source-native-access-request.v1" as const, requestId: "task8-request", qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, requestedActions: ["api_request"] as Array<"api_request">, policy, budget }, "requestHash");
  const authorization = selfHash({ schemaVersion: "stage15-source-native-authorization.v1" as const, requestHash: accessRequest.requestHash, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, approvedTextSha256: hashSourceNativeApprovalText(accessRequest), approvedActions: ["api_request"], approvedPolicy: policy, approvedBudget: budget, maxAutomaticRetries: 0 as const, approvedLedgerHeadHash: null }, "authorizationHash") as SourceNativeAuthorization;
  const accessLog = [selfHash({ schemaVersion: "stage15-source-native-access-log-entry.v1" as const, requestHash: accessRequest.requestHash, kind: "api_request" as const, sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId, target: "/v1/products", requestedAt: "2026-07-17T10:00:00.000Z", attempt: 1, paidAmountUsd: 0, previousLogHash: null, outcome: "success" as const }, "logHash")];
  const promoted = SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.map((record) => {
    const { recordHash: _recordHash, ...body } = record;
    return selfHash({ ...body, aggregate: { rating: 4.8, reviewCount: 600 } }, "recordHash");
  });
  return buildStage15SourceNativeBatch({ batchId: "task8-batch", selectionBrief, qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, accessRequest, authorization, accessLog, sampleLock: lockSourceNativeSample({ seed: "task8-test", frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: promoted }) }), records: promoted, createdAt: "2026-07-17T12:00:00.000Z" });
}
function operatorResult(materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>) {
  return rehash({ ...materials.operator.template, status: "completed" as const, completedAt: "2026-07-17T12:10:00.000Z", answers: materials.operator.template.answers.map((answer) => ({ ...answer, productUnderstood: "yes" as const, evidenceSufficient: "yes" as const, obviousConcern: "no" as const, investigateNext10Minutes: "yes" as const, confidence: "medium" as const, elapsedSeconds: 3, note: "operator review complete" })) }, "resultHash");
}
function roles(overrides: Partial<SourceNativeRoleAttestations> = {}): SourceNativeRoleAttestations {
  const body = { schemaVersion: "stage15-source-native-role-attestations.v1" as const, screeningOperatorDistinctFromOutcomeAssessors: true, outcomeAssessorsDistinct: true, identityHardGateReasons: [] as string[], ...overrides };
  const { attestationHash: _old, ...withoutHash } = body as typeof body & { attestationHash?: string };
  return { ...withoutHash, attestationHash: stableHash(withoutHash) };
}
function outcome(materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>, role: "a" | "b", advanceYes: number, nonAdvanceYes: number, insufficient = 0, evidenceYes = 20) {
  const template = role === "a" ? materials.outcome.assessorA.template : materials.outcome.assessorB.template;
  const answers = template.answers.map((answer, index) => ({
    ...answer,
    productUnderstood: "yes" as const,
    evidenceSufficient: index < evidenceYes ? "yes" as const : "no" as const,
    worthFurtherInvestigation: (index < insufficient ? "insufficient_evidence" : "no") as "yes" | "no" | "insufficient_evidence",
    dominantSignals: ["buyer_reviews"] as ["buyer_reviews"], confidence: "high" as const, elapsedSeconds: index + 1, reason: "frozen outcome review complete",
  }));
  // Outcome IDs are deliberately shuffled, so use bindings to target the five actual advances.
  const replaySource = batch();
  const replayMaterials = buildStage15SourceNativeEvaluationMaterials(replaySource, replaySource.createdAt);
  const replayScreening = buildStage15SourceNativeScreening({ batch: replaySource, materials: replayMaterials, operatorResult: operatorResult(replayMaterials) });
  const advanceProducts = new Set(replayScreening.screening.items.filter((item) => item.status === "advance").map((item) => item.productKey));
  const advanceIds = new Set(materials.outcome.bindings.bindings.filter((binding) => advanceProducts.has(binding.productKey)).map((binding) => binding.evaluationItemId));
  const advanceAnswers = answers.filter((answer) => advanceIds.has(answer.evaluationItemId));
  const nonAdvanceAnswers = answers.filter((answer) => !advanceIds.has(answer.evaluationItemId));
  advanceAnswers.slice(0, advanceYes).forEach((answer) => { answer.worthFurtherInvestigation = "yes"; });
  nonAdvanceAnswers.slice(0, nonAdvanceYes).forEach((answer) => { answer.worthFurtherInvestigation = "yes"; });
  advanceAnswers.slice(advanceYes, advanceYes + insufficient).forEach((answer) => { answer.worthFurtherInvestigation = "insufficient_evidence"; });
  return rehash({ ...template, status: "completed" as const, completedAt: role === "a" ? "2026-07-17T12:15:00.000Z" : "2026-07-17T12:16:00.000Z", roleIndependenceAttested: true, answers }, "resultHash");
}
function changeAgreementWithoutChangingThresholdMetrics(result: ReturnType<typeof outcome>, materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>, nonAdvanceChanges: number) {
  const replaySource = batch(); const replayMaterials = buildStage15SourceNativeEvaluationMaterials(replaySource, replaySource.createdAt);
  const replayScreening = buildStage15SourceNativeScreening({ batch: replaySource, materials: replayMaterials, operatorResult: operatorResult(replayMaterials) });
  const advanceProducts = new Set(replayScreening.screening.items.filter((item) => item.status === "advance").map((item) => item.productKey));
  const advanceIds = new Set(materials.outcome.bindings.bindings.filter((binding) => advanceProducts.has(binding.productKey)).map((binding) => binding.evaluationItemId));
  const advance = result.answers.filter((answer) => advanceIds.has(answer.evaluationItemId));
  const nonAdvance = result.answers.filter((answer) => !advanceIds.has(answer.evaluationItemId));
  const values: Array<"yes" | "no" | "insufficient_evidence"> = ["insufficient_evidence", "no", "yes", "yes", "yes"];
  const replacements = new Map(advance.map((answer, index) => [answer.evaluationItemId, values[index]]));
  nonAdvance.slice(0, nonAdvanceChanges).forEach((answer) => replacements.set(answer.evaluationItemId, "insufficient_evidence"));
  return rehash({ ...result, answers: result.answers.map((answer) => replacements.has(answer.evaluationItemId) ? { ...answer, worthFurtherInvestigation: replacements.get(answer.evaluationItemId)! } : answer) }, "resultHash");
}
function input(results: ReturnType<typeof outcome>[], roleAttestations = roles()) {
  const source = batch();
  const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
  const operator = operatorResult(materials);
  const screening = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: operator });
  return { batch: source, materials, screening: { kind: "task7_artifact" as const, artifact: screening, trustedInput: { batch: source, materials, operatorResult: operator } }, outcomeAssessorResults: results, roleAttestations };
}

describe("Stage 1.5 source-native effectiveness", () => {
  it("preserves exact boundary numerators and supports only the complete two-assessor threshold", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const result = analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 3, 0, 1), outcome(materials, "b", 3, 0, 1)]));
    expect(result.conclusion).toBe("screening_workflow_effectiveness_supported_on_batch_d");
    expect(result.assessors[0].metrics).toMatchObject({ advanceContinue: { numerator: 3, denominator: 5, rate: 0.6 }, nonAdvanceContinue: { numerator: 0, denominator: 15, rate: 0 }, continueRateLift: { numerator: 45, denominator: 75, rate: 0.6 }, advanceInsufficient: { numerator: 1, denominator: 5, rate: 0.2 }, overallEvidenceSufficient: { numerator: 20, denominator: 20, rate: 1 }, medianCompletionSeconds: 10.5 });
    expect(result.pairwise?.exactAgreement).toEqual({ numerator: 20, denominator: 20, rate: 1 });
    expect(result.roleStatus).toMatchObject({ screeningOperatorIndependent: true, outcomeAssessorAIndependent: true, outcomeAssessorBIndependent: true, allThreeRolesIndependent: true, hardGateReasons: [] });
    expect(result.boundaries).toEqual({ screeningEffectivenessValidated: false, commercialCandidateGenerated: false, profitabilityValidated: false, batchCModified: false, batchVUnlocked: false, productionEffect: false });
    expect(() => assertStage15SourceNativeEffectivenessIntegrity(result, input([outcome(materials, "a", 3, 0, 1), outcome(materials, "b", 3, 0, 1)]))).not.toThrow();
  });

  it.each([
    ["advance 2/5", 2, 0, 1, false, "directional_workflow_signal_observed"],
    ["lift below 0.20", 3, 7, 1, true, "directional_workflow_signal_observed"],
    ["insufficient 2/5", 3, 0, 2, false, "directional_workflow_signal_observed"],
  ])("keeps each one-step supported boundary below the top conclusion: %s", (_name, advanceYes, nonAdvanceYes, insufficient, shared, expected) => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", advanceYes, nonAdvanceYes, insufficient), outcome(materials, "b", shared ? advanceYes : 3, shared ? nonAdvanceYes : 0, shared ? insufficient : 1)])).conclusion).toBe(expected);
  });

  it("uses only directional for a complete single assessor or overlapping roles", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0)])).conclusion).toBe("directional_workflow_signal_observed");
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0), outcome(materials, "b", 5, 0)], roles({ outcomeAssessorsDistinct: false }))).conclusion).toBe("directional_workflow_signal_observed");
    expect(analyzeStage15SourceNativeEffectiveness(input([])).conclusion).toBe("evaluation_inconclusive");
  });

  it("keeps the exact agreement threshold at 15/20 and maps 14/20 to inconclusive", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const assessorA = outcome(materials, "a", 3, 0, 1);
    const exact15 = changeAgreementWithoutChangingThresholdMetrics(outcome(materials, "b", 3, 0, 1), materials, 2);
    const atThreshold = analyzeStage15SourceNativeEffectiveness(input([assessorA, exact15]));
    expect(atThreshold.pairwise?.exactAgreement).toEqual({ numerator: 15, denominator: 20, rate: 0.75 });
    expect(atThreshold.conclusion).toBe("screening_workflow_effectiveness_supported_on_batch_d");
    const belowThreshold = analyzeStage15SourceNativeEffectiveness(input([assessorA, changeAgreementWithoutChangingThresholdMetrics(outcome(materials, "b", 3, 0, 1), materials, 3)]));
    expect(belowThreshold.pairwise?.exactAgreement.numerator).toBe(14);
    expect(belowThreshold.conclusion).toBe("evaluation_inconclusive");
  });

  it("maps no positive direction, low agreement, and substantial evidence gaps deterministically", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 0, 0), outcome(materials, "b", 0, 0)])).conclusion).toBe("screening_workflow_signal_not_observed");
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 2, 7), outcome(materials, "b", 2, 7)])).conclusion).toBe("screening_workflow_signal_not_observed");
    const lowAgreement = analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0), outcome(materials, "b", 0, 5)]));
    expect(lowAgreement.pairwise?.exactAgreement.numerator).toBeLessThan(15);
    expect(lowAgreement.conclusion).toBe("evaluation_inconclusive");
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0, 0, 9), outcome(materials, "b", 5, 0, 0, 20)])).conclusion).toBe("evaluation_inconclusive");
  });

  it("blocks identity hard gates and fails closed for self-consistent packet, hash, or id forgeries", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0), outcome(materials, "b", 5, 0)], roles({ identityHardGateReasons: ["blindness_breach"] }))).conclusion).toBe("blocked");
    const data = input([outcome(materials, "a", 5, 0), outcome(materials, "b", 5, 0)]);
    const forged = rehash({ ...data.screening.artifact, screening: rehash({ ...data.screening.artifact.screening, summary: { advance: 4, watch: 16, reject: 0, insufficient: 0 } }, "screeningHash") }, "screeningHash");
    expect(() => analyzeStage15SourceNativeEffectiveness({ ...data, screening: { ...data.screening, artifact: forged } })).toThrow("SOURCE_NATIVE_EFFECTIVENESS_SCREENING_UNTRUSTED");
    const badId = outcome(data.materials, "a", 5, 0);
    expect(() => analyzeStage15SourceNativeEffectiveness({ ...data, outcomeAssessorResults: [rehash({ ...badId, answers: badId.answers.map((answer, index) => index === 0 ? { ...answer, evaluationItemId: "outcome-forged" } : answer) }, "resultHash")] })).toThrow("SOURCE_NATIVE_EFFECTIVENESS_OUTCOME_INVALID");
  });

  it("reports descriptive kappa for a known three-category fixture", () => {
    const source = batch(); const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const analysis = analyzeStage15SourceNativeEffectiveness(input([outcome(materials, "a", 5, 0), outcome(materials, "b", 5, 0)]));
    expect(analysis.pairwise?.cohenKappa).toEqual({ value: 1, descriptiveOnly: true, unavailableReason: null });
  });
});
