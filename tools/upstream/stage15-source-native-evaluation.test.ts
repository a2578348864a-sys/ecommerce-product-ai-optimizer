import { describe, expect, it } from "vitest";

import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAccessLogEntry, SourceNativeAuthorization } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildStage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import {
  assertSourceNativeOutcomeAssessorResult,
  assertSourceNativeScreeningOperatorResult,
  buildStage15SourceNativeEvaluationMaterials,
} from "./stage15-source-native-evaluation";

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

function batch() {
  const selectionBrief = selfHash({
    schemaVersion: "stage15-source-native-selection-brief.v1" as const,
    qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
    market: "US", language: "en-US", currency: "USD", category: "desk-accessories", targetUseCase: "novice-market-screening",
    priceRange: { min: 15, max: 45 }, exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] },
    sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "task6-test" },
    stage1RuleFileHash: "1".repeat(64), stage15RuleFileHash: "2".repeat(64), weightsHash: "3".repeat(64),
    implementationVersion: "stage15-source-native-v1", imagePolicy: "external_https_only_no_download" as const, requestedSampleSize: 20 as const,
  }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] };
  const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const accessRequest = selfHash({ schemaVersion: "stage15-source-native-access-request.v1" as const, requestId: "task6-request", qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, requestedActions: ["api_request"] as Array<"api_request">, policy, budget }, "requestHash");
  const authorization = selfHash({ schemaVersion: "stage15-source-native-authorization.v1" as const, requestHash: accessRequest.requestHash, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, approvedTextSha256: hashSourceNativeApprovalText(accessRequest), approvedActions: ["api_request"], approvedPolicy: policy, approvedBudget: budget, maxAutomaticRetries: 0 as const, approvedLedgerHeadHash: null }, "authorizationHash") as SourceNativeAuthorization;
  const accessLog = [selfHash({ schemaVersion: "stage15-source-native-access-log-entry.v1" as const, requestHash: accessRequest.requestHash, kind: "api_request" as const, sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId, target: "/v1/products", requestedAt: "2026-07-17T10:00:00.000Z", attempt: 1, paidAmountUsd: 0, previousLogHash: null, outcome: "success" as const }, "logHash") satisfies SourceNativeAccessLogEntry];
  const sampleLock = lockSourceNativeSample({ seed: "task6-test", frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS }) });
  return buildStage15SourceNativeBatch({ batchId: "task6-batch", selectionBrief, qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, accessRequest, authorization, accessLog, sampleLock, records: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS, createdAt: "2026-07-17T12:00:00.000Z" });
}

function rehash<T extends Record<string, unknown>>(value: T, hashField: string): T { const { [hashField]: _hash, ...body } = value; return { ...body, [hashField]: stableHash(body) } as T; }

describe("Stage 1.5 source-native evaluation materials", () => {
  it("creates isolated 20-item operator and frozen outcome packets with blank templates and ready state", () => {
    const source = batch();
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(materials.readiness).toEqual({ state: "ready_for_screening_operator", screeningOperatorSlots: 1, evaluationAllowed: true });
    expect(materials.operator.packet.cards).toHaveLength(20);
    expect(materials.outcome.packet.cards).toHaveLength(20);
    expect(materials.operator.template.answers.every(({ evaluationItemId: _id, ...answer }) => Object.values(answer).every((value) => value === null || value === "" || Array.isArray(value)))).toBe(true);
    expect(materials.outcome.assessorA.template.roleIndependenceAttested).toBeNull();
    expect(materials.operator.packet.packetHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(materials.operator.template.templateHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(materials.operator.packet.cards.map((card) => card.evaluationItemId)).not.toEqual(materials.outcome.packet.cards.map((card) => card.evaluationItemId));
    expect(materials.operator.packet.cards[0]).not.toHaveProperty("specifications");
    expect(materials.operator.packet.cards[0]).not.toHaveProperty("reviewSignals");
    expect(materials.operator.packet.cards[0]).not.toHaveProperty("qualitySignals");
    expect(JSON.stringify(materials.operator.packet)).not.toMatch(/productKey|sourceUrl/iu);
    expect(materials.outcome.packet.cards[0]).not.toHaveProperty("stage1Rank");
    expect(JSON.stringify(materials.outcome.packet)).not.toMatch(/private|sourceUrl/iu);
    expect(materials.outcome.packet.frozenAt).toBe(source.createdAt);
    expect(materials.operator.bindings.bindings[0]).toMatchObject({ blindItemId: expect.any(String), sampleHash: expect.any(String), productKey: expect.any(String), recordHash: expect.any(String) });
  });

  it("rejects tampered material, later freeze time, invalid completed answers, and slot crossover", () => {
    const source = batch();
    expect(() => buildStage15SourceNativeEvaluationMaterials(source, "2026-07-17T12:00:00.001Z")).toThrow("SOURCE_NATIVE_EVALUATION_FREEZE_INVALID");
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    expect(() => assertSourceNativeScreeningOperatorResult({ ...materials.operator.template, status: "completed" }, materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const answers = materials.operator.template.answers.map((answer) => ({ ...answer, productUnderstood: "yes" as const, evidenceSufficient: "yes" as const, obviousConcern: "no" as const, investigateNext10Minutes: "yes" as const, confidence: "medium" as const, elapsedSeconds: 3, note: "保留原话" }));
    const complete = rehash({ ...materials.operator.template, status: "completed" as const, completedAt: "2026-07-17T12:10:00.000Z", answers }, "resultHash");
    expect(() => assertSourceNativeScreeningOperatorResult(complete, materials.operator.template)).not.toThrow();
    expect(() => assertSourceNativeScreeningOperatorResult(rehash({ ...complete, answers: complete.answers.slice(0, 19) }, "resultHash"), materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const unknownOperatorIds = complete.answers.map((answer, index) => index === 0 ? { ...answer, evaluationItemId: "operator-unknown" } : answer);
    expect(() => assertSourceNativeScreeningOperatorResult(rehash({ ...complete, answers: unknownOperatorIds, evaluationItemIdsHash: stableHash(unknownOperatorIds.map((answer) => answer.evaluationItemId).sort()) }, "resultHash"), materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    expect(() => assertSourceNativeScreeningOperatorResult(rehash({ ...complete, answers: complete.answers.map((answer, index) => index === 0 ? { ...answer, confidence: "invalid" } : answer) }, "resultHash"), materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    expect(() => assertSourceNativeScreeningOperatorResult(rehash({ ...complete, answers: complete.answers.map((answer, index) => index === 0 ? { ...answer, note: "联系 user@example.test" } : answer) }, "resultHash"), materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    expect(() => assertSourceNativeScreeningOperatorResult(rehash({ ...complete, email: "not-allowed" }, "resultHash"), materials.operator.template)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const outcomeAnswers = materials.outcome.assessorA.template.answers.map((answer) => ({ ...answer, productUnderstood: "yes" as const, evidenceSufficient: "yes" as const, worthFurtherInvestigation: "yes" as const, dominantSignals: ["buyer_reviews"], confidence: "high" as const, elapsedSeconds: 2, reason: "有足够的具体理由" }));
    const outcome = rehash({ ...materials.outcome.assessorA.template, status: "completed" as const, completedAt: "2026-07-17T12:15:00.000Z", roleIndependenceAttested: true, answers: outcomeAnswers }, "resultHash");
    expect(() => assertSourceNativeOutcomeAssessorResult(outcome, materials.outcome.assessorA.template)).not.toThrow();
    expect(() => assertSourceNativeOutcomeAssessorResult(rehash({ ...outcome, slot: "outcome_assessor_b" }, "resultHash"), materials.outcome.assessorA.template)).toThrow("SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
    expect(() => assertSourceNativeOutcomeAssessorResult(rehash({ ...outcome, roleIndependenceAttested: false }, "resultHash"), materials.outcome.assessorA.template)).toThrow("SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
    expect(() => assertSourceNativeOutcomeAssessorResult(rehash({ ...outcome, answers: outcome.answers.map((answer, index) => index === 0 ? { ...answer, reason: "call +1 415-555-0123" } : answer) }, "resultHash"), materials.outcome.assessorA.template)).toThrow("SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
    expect(() => assertSourceNativeOutcomeAssessorResult(rehash({ ...outcome, answers: outcome.answers.map((answer, index) => index === 0 ? { ...answer, reason: "" } : answer) }, "resultHash"), materials.outcome.assessorA.template)).toThrow("SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
    expect(() => buildStage15SourceNativeEvaluationMaterials({ ...source, screeningVisualPacket: { ...source.screeningVisualPacket, packetHash: "f".repeat(64) } }, source.createdAt)).toThrow();
  });
});
