import { describe, expect, it, vi } from "vitest";

const { existingBuilderSpy } = vi.hoisted(() => ({ existingBuilderSpy: vi.fn() }));

vi.mock("./novice-market-screening", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./novice-market-screening")>();
  return {
    ...actual,
    buildNoviceMarketScreeningRun: (...args: Parameters<typeof actual.buildNoviceMarketScreeningRun>) => {
      existingBuilderSpy(...args);
      return actual.buildNoviceMarketScreeningRun(...args);
    },
  };
});

import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAuthorization } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildStage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import { buildStage15SourceNativeEvaluationMaterials } from "./stage15-source-native-evaluation";
import {
  assertStage15SourceNativeScreeningIntegrity,
  buildStage15SourceNativeScreening,
} from "./stage15-source-native-screening";

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

function rehash<T extends Record<string, unknown>>(value: T, hashField: string): T {
  const { [hashField]: _hash, ...body } = value;
  return { ...body, [hashField]: stableHash(body) } as T;
}

function promotedRecords() {
  return SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.map((record) => {
    const { recordHash: _recordHash, ...body } = record;
    return selfHash({ ...body, aggregate: { rating: 4.8, reviewCount: 600 } }, "recordHash");
  });
}

function batch(records = SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS) {
  const selectionBrief = selfHash({
    schemaVersion: "stage15-source-native-selection-brief.v1" as const,
    qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
    market: "US", language: "en-US", currency: "USD", category: "desk-accessories", targetUseCase: "novice-market-screening",
    priceRange: { min: 15, max: 45 }, exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] },
    sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "task7-test" },
    stage1RuleFileHash: "1".repeat(64), stage15RuleFileHash: "2".repeat(64), weightsHash: "3".repeat(64),
    implementationVersion: "stage15-source-native-v1", imagePolicy: "external_https_only_no_download" as const, requestedSampleSize: 20 as const,
  }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] };
  const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const accessRequest = selfHash({ schemaVersion: "stage15-source-native-access-request.v1" as const, requestId: "task7-request", qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, requestedActions: ["api_request"] as Array<"api_request">, policy, budget }, "requestHash");
  const authorization = selfHash({ schemaVersion: "stage15-source-native-authorization.v1" as const, requestHash: accessRequest.requestHash, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, approvedTextSha256: hashSourceNativeApprovalText(accessRequest), approvedActions: ["api_request"], approvedPolicy: policy, approvedBudget: budget, maxAutomaticRetries: 0 as const, approvedLedgerHeadHash: null }, "authorizationHash") as SourceNativeAuthorization;
  const accessLog = [selfHash({ schemaVersion: "stage15-source-native-access-log-entry.v1" as const, requestHash: accessRequest.requestHash, kind: "api_request" as const, sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId, target: "/v1/products", requestedAt: "2026-07-17T10:00:00.000Z", attempt: 1, paidAmountUsd: 0, previousLogHash: null, outcome: "success" as const }, "logHash")];
  const sampleLock = lockSourceNativeSample({ seed: "task7-test", frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: records }) });
  return buildStage15SourceNativeBatch({ batchId: "task7-batch", selectionBrief, qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, accessRequest, authorization, accessLog, sampleLock, records, createdAt: "2026-07-17T12:00:00.000Z" });
}

function completedOperator(materials: ReturnType<typeof buildStage15SourceNativeEvaluationMaterials>) {
  return rehash({
    ...materials.operator.template,
    status: "completed" as const,
    completedAt: "2026-07-17T12:10:00.000Z",
    answers: materials.operator.template.answers.map((answer) => ({
      ...answer,
      productUnderstood: "yes" as const,
      evidenceSufficient: "yes" as const,
      obviousConcern: "no" as const,
      investigateNext10Minutes: "yes" as const,
      confidence: "medium" as const,
      elapsedSeconds: 3,
      note: "operator review completed",
    })),
  }, "resultHash");
}

describe("Stage 1.5 source-native screening", () => {
  it("projects one valid 20-item operator result through the existing deterministic screening builder", () => {
    const source = batch(promotedRecords());
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    existingBuilderSpy.mockClear();
    const output = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: completedOperator(materials) });

    expect(output.screening.items).toHaveLength(20);
    expect(output.screening.summary).toEqual({ advance: 5, watch: 15, reject: 0, insufficient: 0 });
    expect(existingBuilderSpy).toHaveBeenCalledOnce();
    expect(output.readiness).toEqual({ state: "ready_for_outcome_assessment", outcomePacketFrozen: true, screeningEffectivenessValidated: false });
    expect(output.boundaries).toEqual({ productionEffect: false, formalCandidateGenerated: false, productionDatabaseWritten: false, screeningEffectivenessValidated: false });
    expect(() => assertStage15SourceNativeScreeningIntegrity(output, { batch: source, materials, operatorResult: completedOperator(materials) })).not.toThrow();
  });

  it("preserves a valid low-score batch as zero advances instead of manufacturing promotion", () => {
    const source = batch();
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const output = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: completedOperator(materials) });

    expect(output.screening.summary).toEqual({ advance: 0, watch: 0, reject: 20, insufficient: 0 });
    expect(output.screening.status).toBe("insufficient_advance_pool");
  });

  it("fails closed for incomplete, unknown, duplicate, packet-mismatched, and invalid operator results", () => {
    const source = batch();
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const valid = completedOperator(materials);
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: rehash({ ...valid, answers: valid.answers.slice(0, 19) }, "resultHash") })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const unknown = valid.answers.map((answer, index) => index === 0 ? { ...answer, evaluationItemId: "operator-unknown" } : answer);
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: rehash({ ...valid, answers: unknown, evaluationItemIdsHash: stableHash(unknown.map((answer) => answer.evaluationItemId).sort()) }, "resultHash") })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const duplicate = valid.answers.map((answer, index) => index === 1 ? { ...answer, evaluationItemId: valid.answers[0].evaluationItemId } : answer);
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: rehash({ ...valid, answers: duplicate, evaluationItemIdsHash: stableHash(duplicate.map((answer) => answer.evaluationItemId).sort()) }, "resultHash") })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: rehash({ ...valid, packetHash: "f".repeat(64), sourcePacketHash: "f".repeat(64) }, "resultHash") })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    const invalidAnswer = rehash({ ...valid, answers: valid.answers.map((answer, index) => index === 0 ? { ...answer, confidence: "invalid" } : answer) }, "resultHash") as unknown as typeof valid;
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: invalidAnswer })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
  });

  it("rejects an outcome packet frozen after the operator completed and material tampering", () => {
    const source = batch();
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const operatorResult = completedOperator(materials);
    const latePacket = rehash({ ...materials.outcome.packet, frozenAt: "2026-07-17T12:11:00.000Z" }, "packetHash");
    const lateBindings = rehash({ ...materials.outcome.bindings, packetHash: latePacket.packetHash }, "bindingsHash");
    const lateMaterialsBody = { ...materials, outcome: { ...materials.outcome, packet: latePacket, bindings: lateBindings } };
    const lateMaterials = rehash(lateMaterialsBody, "materialsHash");
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials: lateMaterials, operatorResult })).toThrow("SOURCE_NATIVE_SCREENING_OUTCOME_FREEZE_LATE");
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials: { ...materials, materialsHash: "f".repeat(64) }, operatorResult })).toThrow("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
    expect(() => buildStage15SourceNativeScreening({
      batch: source,
      materials: { ...materials, operator: { ...materials.operator, packet: { ...materials.operator.packet, packetHash: "f".repeat(64) } } },
      operatorResult,
    })).toThrow("SOURCE_NATIVE_SCREENING_MATERIALS_INVALID");
    expect(() => buildStage15SourceNativeScreening({
      batch: source,
      materials: { ...materials, operator: { ...materials.operator, template: { ...materials.operator.template, templateHash: "f".repeat(64) } } },
      operatorResult,
    })).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
  });

  it("does not accept or serialize either outcome-assessor result, and has deterministic replay under operator answer reordering", () => {
    const source = batch();
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const operatorResult = completedOperator(materials);
    const first = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult });
    const reordered = rehash({ ...operatorResult, answers: [...operatorResult.answers].reverse() }, "resultHash");
    const second = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult: reordered });

    expect(second.screening.screeningHash).toBe(first.screening.screeningHash);
    expect(second.inputHash).toBe(first.inputHash);
    expect(JSON.stringify(first)).not.toMatch(/outcome_assessor_[ab]|worthFurtherInvestigation|roleIndependenceAttested/iu);
    expect(JSON.stringify(first)).not.toMatch(/resultHash.*outcome/iu);
    expect(() => assertStage15SourceNativeScreeningIntegrity({ ...first, screeningHash: "f".repeat(64) }, { batch: source, materials, operatorResult })).toThrow("SOURCE_NATIVE_SCREENING_HASH_INVALID");
  });

  it("rejects self-consistent operator and outcome material forgeries that no longer equal the trusted batch derivation", () => {
    const source = batch(promotedRecords());
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const forgedOperatorPacket = rehash({ ...materials.operator.packet, cards: materials.operator.packet.cards.map((card, index) => index === 0 ? { ...card, title: "forged visible title" } : card) }, "packetHash");
    const forgedOperatorBindings = rehash({ ...materials.operator.bindings, packetHash: forgedOperatorPacket.packetHash }, "bindingsHash");
    const forgedOperatorTemplate = rehash({ ...materials.operator.template, sourcePacketHash: forgedOperatorPacket.packetHash, packetHash: forgedOperatorPacket.packetHash }, "templateHash");
    const forgedOperatorMaterials = rehash({ ...materials, operator: { packet: forgedOperatorPacket, bindings: forgedOperatorBindings, template: forgedOperatorTemplate } }, "materialsHash");
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials: forgedOperatorMaterials, operatorResult: completedOperator(forgedOperatorMaterials) })).toThrow("SOURCE_NATIVE_SCREENING_MATERIALS_UNTRUSTED");

    const forgedOutcomePacket = rehash({ ...materials.outcome.packet, cards: materials.outcome.packet.cards.map((card, index) => index === 0 ? { ...card, title: "forged outcome title" } : card) }, "packetHash");
    const forgedOutcomeBindings = rehash({ ...materials.outcome.bindings, packetHash: forgedOutcomePacket.packetHash }, "bindingsHash");
    const forgedAssessorA = rehash({ ...materials.outcome.assessorA.template, sourcePacketHash: forgedOutcomePacket.packetHash, packetHash: forgedOutcomePacket.packetHash }, "templateHash");
    const forgedAssessorB = rehash({ ...materials.outcome.assessorB.template, sourcePacketHash: forgedOutcomePacket.packetHash, packetHash: forgedOutcomePacket.packetHash }, "templateHash");
    const forgedOutcomeMaterials = rehash({ ...materials, outcome: { packet: forgedOutcomePacket, bindings: forgedOutcomeBindings, assessorA: { template: forgedAssessorA }, assessorB: { template: forgedAssessorB } } }, "materialsHash");
    expect(() => buildStage15SourceNativeScreening({ batch: source, materials: forgedOutcomeMaterials, operatorResult: completedOperator(materials) })).toThrow("SOURCE_NATIVE_SCREENING_MATERIALS_UNTRUSTED");
  });

  it("rejects a self-hashed forged screening artifact during trusted replay", () => {
    const source = batch(promotedRecords());
    const materials = buildStage15SourceNativeEvaluationMaterials(source, source.createdAt);
    const operatorResult = completedOperator(materials);
    const output = buildStage15SourceNativeScreening({ batch: source, materials, operatorResult });
    const forgedScreening = rehash({ ...output.screening, summary: { advance: 4, watch: 16, reject: 0, insufficient: 0 } }, "screeningHash");
    const forgedOutput = rehash({ ...output, screening: forgedScreening }, "screeningHash");

    expect(() => assertStage15SourceNativeScreeningIntegrity(forgedOutput, { batch: source, materials, operatorResult })).toThrow("SOURCE_NATIVE_SCREENING_REPLAY_INVALID");
  });
});
