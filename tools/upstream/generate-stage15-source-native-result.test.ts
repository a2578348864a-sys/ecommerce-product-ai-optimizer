import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAccessLogEntry, SourceNativeAuthorization } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { buildStage15SourceNativeBatch } from "./stage15-source-native-batch";
import { buildSourceNativeSamplingFrame, lockSourceNativeSample } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import { generateStage15SourceNativePreparation } from "./generate-stage15-source-native-preparation";
import { generateStage15SourceNativeResult } from "./generate-stage15-source-native-result";
import { buildStage15SourceNativeEvaluationMaterials, type SourceNativeScreeningOperatorResult } from "./stage15-source-native-evaluation";
import { finalizeStage15SourceNativeScreening } from "./stage15-source-native-screening";

function hashed<T extends Record<string, unknown>>(value: T): T & { resultHash: string } { return { ...value, resultHash: stableHash(value) }; }
function selfHash<T extends Record<string, unknown>, K extends string>(body: T, key: K): T & Record<K, string> { return { ...body, [key]: stableHash(body) } as T & Record<K, string>; }
function sourceNativeBatch(records = SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS) {
  const brief = selfHash({ schemaVersion: "stage15-source-native-selection-brief.v1" as const, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, market: "US", language: "en-US", currency: "USD", category: "desk-accessories", targetUseCase: "novice-market-screening", priceRange: { min: 15, max: 45 }, exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] }, sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "task9" }, stage1RuleFileHash: "1".repeat(64), stage15RuleFileHash: "2".repeat(64), weightsHash: "3".repeat(64), implementationVersion: "stage15-source-native-v1", imagePolicy: "external_https_only_no_download" as const, requestedSampleSize: 20 as const }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] }; const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const request = selfHash({ schemaVersion: "stage15-source-native-access-request.v1" as const, requestId: "task9", qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, requestedActions: ["api_request"] as Array<"api_request">, policy, budget }, "requestHash");
  const authorization = selfHash({ schemaVersion: "stage15-source-native-authorization.v1" as const, requestHash: request.requestHash, qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash, approvedTextSha256: hashSourceNativeApprovalText(request), approvedActions: ["api_request"], approvedPolicy: policy, approvedBudget: budget, maxAutomaticRetries: 0 as const, approvedLedgerHeadHash: null }, "authorizationHash") as SourceNativeAuthorization;
  const accessLog = [selfHash({ schemaVersion: "stage15-source-native-access-log-entry.v1" as const, requestHash: request.requestHash, kind: "api_request" as const, sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId, target: "/v1/products", requestedAt: "2026-07-17T10:00:00.000Z", attempt: 1, paidAmountUsd: 0, previousLogHash: null, outcome: "success" as const }, "logHash") satisfies SourceNativeAccessLogEntry];
  const sampleLock = lockSourceNativeSample({ seed: "task9", frame: buildSourceNativeSamplingFrame({ qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, eligibleRecords: records }) });
  return buildStage15SourceNativeBatch({ batchId: "task9-batch", selectionBrief: brief, qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION, accessRequest: request, authorization, accessLog, sampleLock, records, createdAt: "2026-07-17T12:00:00.000Z" });
}
function promoted() { return sourceNativeBatch().controlArtifacts.sampleLock.frame.records.map((record) => { const { recordHash: _hash, ...body } = record; const next = { ...body, aggregate: { rating: 4.8, reviewCount: 600 } }; return { ...next, recordHash: stableHash(next) }; }); }
const rawSha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
function completedOperator(template: SourceNativeScreeningOperatorResult): SourceNativeScreeningOperatorResult { return hashed({ ...template, status: "completed", completedAt: "2026-07-17T12:10:00.000Z", answers: template.answers.map((answer) => ({ ...answer, productUnderstood: "yes", evidenceSufficient: "yes", obviousConcern: "no", investigateNext10Minutes: "yes", confidence: "medium", elapsedSeconds: 3, note: "operator review complete" })) }) as SourceNativeScreeningOperatorResult; }
function completedOutcomes(batch = sourceNativeBatch(promoted())) {
  const materials = buildStage15SourceNativeEvaluationMaterials(batch, batch.createdAt); const operator = completedOperator(materials.operator.template); const screening = finalizeStage15SourceNativeScreening({ batch, materials, operatorResult: operator });
  const advances = new Set(screening.screening.items.filter((item) => item.status === "advance").map((item) => item.productKey));
  const outcome = (template: typeof materials.outcome.assessorA.template) => {
    const advanceIds = new Set(materials.outcome.bindings.bindings.filter((binding) => advances.has(binding.productKey)).map((binding) => binding.evaluationItemId)); let advanceSeen = 0;
    return hashed({ ...template, status: "completed", completedAt: "2026-07-17T12:15:00.000Z", roleIndependenceAttested: true, answers: template.answers.map((answer) => {
      const isAdvance = advanceIds.has(answer.evaluationItemId); const index = isAdvance ? advanceSeen++ : -1;
      return { ...answer, productUnderstood: "yes", evidenceSufficient: "yes", worthFurtherInvestigation: isAdvance && index < 3 ? "yes" : isAdvance && index === 3 ? "insufficient_evidence" : "no", dominantSignals: ["buyer_reviews"], confidence: "high", elapsedSeconds: 2, reason: "frozen outcome review complete" };
    }) });
  };
  return { operator, assessorA: outcome(materials.outcome.assessorA.template), assessorB: outcome(materials.outcome.assessorB.template) };
}

describe("source-native terminal artifact closure", () => {
  it("requires explicit preparation and all three role results", () => {
    expect(() => generateStage15SourceNativeResult({ preparationDirectory: "relative", outputRoot: "relative", createdAt: "not-a-time", roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: false, outcomeAssessorsDistinctFromEachOther: false }, operatorResultPath: "a", outcomeAssessorAResultPath: "b", outcomeAssessorBResultPath: "c" })).toThrow("SOURCE_NATIVE_RESULT_PATH_INVALID");
  });

  it("replays the frozen preparation, consumes exact role templates, and creates a sibling execution without overwriting preparation", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-source-native-result-")); try {
      const preparation = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(promoted()), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" });
      const operatorTemplate = JSON.parse(readFileSync(join(preparation.directory, "source-native-screening-operator-result-template.v1.json"), "utf8"));
      const operator = hashed({ ...operatorTemplate, status: "completed", completedAt: "2026-07-17T12:10:00.000Z", answers: operatorTemplate.answers.map((answer: Record<string, unknown>) => ({ ...answer, productUnderstood: "yes", evidenceSufficient: "yes", obviousConcern: "no", investigateNext10Minutes: "yes", confidence: "medium", elapsedSeconds: 3, note: "completed operator answer" })) });
      const completeOutcome = (file: string) => { const template = JSON.parse(readFileSync(join(preparation.directory, file), "utf8")); return hashed({ ...template, status: "completed", completedAt: "2026-07-17T12:15:00.000Z", roleIndependenceAttested: true, answers: template.answers.map((answer: Record<string, unknown>) => ({ ...answer, productUnderstood: "yes", evidenceSufficient: "yes", worthFurtherInvestigation: "yes", dominantSignals: ["buyer_reviews"], confidence: "high", elapsedSeconds: 2, reason: "specific evidence supports further investigation" })) }); };
      const paths = [join(root, "operator.json"), join(root, "a.json"), join(root, "b.json")]; const results = [operator, completeOutcome("source-native-outcome-assessor-a-result-template.v1.json"), completeOutcome("source-native-outcome-assessor-b-result-template.v1.json")]; results.forEach((value, index) => writeFileSync(paths[index], JSON.stringify(value, null, index === 0 ? 2 : undefined)));
      const input = { preparationDirectory: preparation.directory, outputRoot: root, createdAt: "2026-07-17T12:20:00.000Z", roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: true, outcomeAssessorsDistinctFromEachOther: true }, operatorResultPath: paths[0], outcomeAssessorAResultPath: paths[1], outcomeAssessorBResultPath: paths[2] };
      const first = generateStage15SourceNativeResult(input);
      expect(first.directory).toBe(join(root, `execution-${preparation.manifest.preparationHash.slice(0, 12)}`)); expect(first.manifest.status).toBe("ready"); expect(first.manifest.pendingArtifacts).toEqual([]);
      expect(readFileSync(join(first.directory, "source-native-screening-operator-result.v1.json"), "utf8")).toBe(readFileSync(paths[0], "utf8"));
      expect(generateStage15SourceNativeResult(input).write.unchanged.length).toBeGreaterThan(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves each valid human-result Buffer verbatim and records its raw SHA-256", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-source-native-result-")); try {
      const preparation = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(promoted()), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }); const values = completedOutcomes();
      const paths = [join(root, "operator.json"), join(root, "a.json"), join(root, "b.json")]; const buffers = [Buffer.from(`  ${JSON.stringify(values.operator)}\n`, "utf8"), Buffer.from(JSON.stringify(values.assessorA, null, 2), "utf8"), Buffer.from(`${JSON.stringify(values.assessorB)}\n\t`, "utf8")];
      buffers.forEach((buffer, index) => writeFileSync(paths[index], buffer));
      const result = generateStage15SourceNativeResult({ preparationDirectory: preparation.directory, outputRoot: root, createdAt: "2026-07-17T12:20:00.000Z", roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: true, outcomeAssessorsDistinctFromEachOther: true }, operatorResultPath: paths[0], outcomeAssessorAResultPath: paths[1], outcomeAssessorBResultPath: paths[2] });
      const names = ["source-native-screening-operator-result.v1.json", "source-native-outcome-assessor-a-result.v1.json", "source-native-outcome-assessor-b-result.v1.json"];
      names.forEach((name, index) => expect(readFileSync(join(result.directory, name))).toEqual(buffers[index]));
      names.forEach((name, index) => expect(result.manifest.artifacts.find((entry) => entry.relativePath === name)?.rawUtf8Sha256).toBe(rawSha256(buffers[index])));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects malformed UTF-8 in any required human result", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-source-native-result-")); try {
      const preparation = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(promoted()), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }); const values = completedOutcomes(); const paths = [join(root, "operator.json"), join(root, "a.json"), join(root, "b.json")];
      writeFileSync(paths[0], Buffer.from([0xc3, 0x28])); writeFileSync(paths[1], JSON.stringify(values.assessorA)); writeFileSync(paths[2], JSON.stringify(values.assessorB));
      expect(() => generateStage15SourceNativeResult({ preparationDirectory: preparation.directory, outputRoot: root, createdAt: "2026-07-17T12:20:00.000Z", roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: true, outcomeAssessorsDistinctFromEachOther: true }, operatorResultPath: paths[0], outcomeAssessorAResultPath: paths[1], outcomeAssessorBResultPath: paths[2] })).toThrow("SOURCE_NATIVE_RESULT_INPUT_INVALID");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps supported evidence supported only when all role attestations are true", () => {
    const root = mkdtempSync(join(tmpdir(), "stage15-source-native-result-")); const directionalRoot = mkdtempSync(join(tmpdir(), "stage15-source-native-result-")); try {
      const preparation = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(promoted()), outputRoot: root, createdAt: "2026-07-17T12:00:00.000Z" }); const values = completedOutcomes(); const paths = [join(root, "operator.json"), join(root, "a.json"), join(root, "b.json")];
      [values.operator, values.assessorA, values.assessorB].forEach((value, index) => writeFileSync(paths[index], JSON.stringify(value)));
      const base = { preparationDirectory: preparation.directory, outputRoot: root, createdAt: "2026-07-17T12:20:00.000Z", operatorResultPath: paths[0], outcomeAssessorAResultPath: paths[1], outcomeAssessorBResultPath: paths[2] };
      expect(generateStage15SourceNativeResult({ ...base, roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: true, outcomeAssessorsDistinctFromEachOther: true } }).analysis.conclusion).toBe("screening_workflow_effectiveness_supported_on_batch_d");
      const directionalPreparation = generateStage15SourceNativePreparation({ batch: sourceNativeBatch(promoted()), outputRoot: directionalRoot, createdAt: "2026-07-17T12:00:00.000Z" }); const directionalPaths = [join(directionalRoot, "operator.json"), join(directionalRoot, "a.json"), join(directionalRoot, "b.json")];
      [values.operator, values.assessorA, values.assessorB].forEach((value, index) => writeFileSync(directionalPaths[index], JSON.stringify(value)));
      expect(generateStage15SourceNativeResult({ preparationDirectory: directionalPreparation.directory, outputRoot: directionalRoot, createdAt: "2026-07-17T12:20:00.000Z", roleAttestations: { screeningOperatorDistinctFromOutcomeAssessors: false, outcomeAssessorsDistinctFromEachOther: false }, operatorResultPath: directionalPaths[0], outcomeAssessorAResultPath: directionalPaths[1], outcomeAssessorBResultPath: directionalPaths[2] }).analysis.conclusion).toBe("directional_workflow_signal_observed");
    } finally { rmSync(root, { recursive: true, force: true }); rmSync(directionalRoot, { recursive: true, force: true }); }
  });
});
