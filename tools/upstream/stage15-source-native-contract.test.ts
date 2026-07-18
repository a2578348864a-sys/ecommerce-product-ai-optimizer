import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  assertSourceNativeAccessLogEntryIntegrity,
  assertSourceNativeAccessRequestIntegrity,
  assertSourceNativeAuthorizationIntegrity,
  assertSourceNativeOutcomeAssessorResultIntegrity,
  assertSourceNativeProductRecordIntegrity,
  assertSourceNativeProductRecordSetIntegrity,
  assertSourceNativeQualificationIntegrity,
  assertSourceNativeSampleIntegrity,
  assertSourceNativeScreeningOperatorResultIntegrity,
  assertSourceNativeSelectionBriefIntegrity,
  type SourceNativeBatchReadiness,
  type SourceNativeEffectivenessConclusion,
} from "./stage15-source-native-contract";
import {
  FIXTURE_SOURCE_NATIVE_QUALIFICATION,
  SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS,
  SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
} from "./stage15-source-native-test-fixtures";

function withRecordHash(record: typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]) {
  const { recordHash: _recordHash, ...body } = record;
  return { ...body, recordHash: stableHash(body) };
}

function withSelfHash<T extends Record<string, unknown>, K extends string>(body: T, hashField: K): T & Record<K, string> {
  const { [hashField]: _existingHash, ...hashBody } = body;
  return { ...hashBody, [hashField]: stableHash(hashBody) } as T & Record<K, string>;
}

describe("Stage 1.5 source-native Batch D contract", () => {
  it.each<[string, Record<string, unknown>]>([
    ["non-HTTPS origin", { sourceOrigin: "http://catalog.synthetic.invalid" }],
    ["login required", { loginRequired: true }],
    ["unknown robots status", { robotsStatus: "unknown" }],
    ["unknown licence status", { licenseStatus: "unknown" }],
    ["no stable identifier capability", { stableIdentifierKinds: [] }],
  ])("rejects an unqualified source: %s", (_label, patch) => {
    expect(() => assertSourceNativeQualificationIntegrity({
      ...FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      ...patch,
    } as never)).toThrow("SOURCE_NATIVE_QUALIFICATION_INVALID");
  });

  it.each(["official_api_export", "licensed_structured_dataset", "public_source_native_site"] as const)(
    "accepts each planned source kind: %s",
    (sourceKind) => {
      expect(() => assertSourceNativeQualificationIntegrity(withSelfHash({
        ...FIXTURE_SOURCE_NATIVE_QUALIFICATION,
        sourceKind,
      }, "qualificationHash") as never)).not.toThrow();
    },
  );

  it("requires the source-gate policy, budget, retry, and target fields", () => {
    const request = withSelfHash({
      schemaVersion: "stage15-source-native-access-request.v1",
      requestId: "synthetic-source-gate-contract-request",
      qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
      requestedActions: ["api_request", "page_open"],
      policy: { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] },
      budget: { maxApiRequests: 2, maxReviewPages: 3, maxPaidAmountUsd: 0 },
    }, "requestHash");
    const authorization = withSelfHash({
      schemaVersion: "stage15-source-native-authorization.v1",
      requestHash: request.requestHash,
      qualificationHash: request.qualificationHash,
      approvedTextSha256: "a".repeat(64),
      approvedActions: request.requestedActions,
      approvedPolicy: request.policy,
      approvedBudget: request.budget,
      maxAutomaticRetries: 0,
      approvedLedgerHeadHash: null,
    }, "authorizationHash");
    const log = withSelfHash({
      schemaVersion: "stage15-source-native-access-log-entry.v1",
      requestHash: request.requestHash,
      kind: "page_open",
      sourceId: "synthetic-catalogue",
      target: "https://catalogue.synthetic.invalid/products/SN-001/reviews",
      requestedAt: "2026-07-17T10:00:00.000Z",
      attempt: 1,
      paidAmountUsd: 0,
      previousLogHash: null,
      outcome: "success",
    }, "logHash");

    expect(() => assertSourceNativeAccessRequestIntegrity(request as never)).not.toThrow();
    expect(() => assertSourceNativeAuthorizationIntegrity(authorization as never)).not.toThrow();
    expect(() => assertSourceNativeAccessLogEntryIntegrity(log as never)).not.toThrow();
    expect(() => assertSourceNativeAuthorizationIntegrity(withSelfHash({ ...authorization, maxAutomaticRetries: 1 }, "authorizationHash") as never))
      .toThrow("SOURCE_NATIVE_AUTHORIZATION_INVALID");
    expect(() => assertSourceNativeAccessLogEntryIntegrity(withSelfHash({ ...log, target: "" }, "logHash") as never))
      .toThrow("SOURCE_NATIVE_ACCESS_LOG_ENTRY_INVALID");
    expect(() => assertSourceNativeAuthorizationIntegrity(withSelfHash({
      ...authorization,
      approvalText: "plaintext must never persist",
      token: "plaintext must never persist",
    }, "authorizationHash") as never)).toThrow("SOURCE_NATIVE_AUTHORIZATION_INVALID");
  });

  it("validates stableHash self-hashes for every source-native control artifact", () => {
    const qualification = withSelfHash({ ...FIXTURE_SOURCE_NATIVE_QUALIFICATION }, "qualificationHash");
    const request = withSelfHash({
      schemaVersion: "stage15-source-native-access-request.v1",
      requestId: "synthetic-request-01",
      qualificationHash: qualification.qualificationHash,
      requestedActions: ["page_open"],
      policy: { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] },
      budget: { maxApiRequests: 2, maxReviewPages: 3, maxPaidAmountUsd: 0 },
    }, "requestHash");
    const authorization = withSelfHash({
      schemaVersion: "stage15-source-native-authorization.v1",
      requestHash: request.requestHash,
      qualificationHash: qualification.qualificationHash,
      approvedTextSha256: "c".repeat(64),
      approvedActions: request.requestedActions,
      approvedPolicy: request.policy,
      approvedBudget: request.budget,
      maxAutomaticRetries: 0,
      approvedLedgerHeadHash: null,
    }, "authorizationHash");
    const accessLog = withSelfHash({
      schemaVersion: "stage15-source-native-access-log-entry.v1",
      requestHash: request.requestHash,
      kind: "page_open",
      sourceId: qualification.sourceId,
      target: "https://catalogue.synthetic.invalid/products/SN-001/reviews",
      requestedAt: "2026-07-17T09:00:00.000Z",
      attempt: 1,
      paidAmountUsd: 0,
      previousLogHash: null,
      outcome: "success",
    }, "logHash");
    const selectionBrief = withSelfHash({
      schemaVersion: "stage15-source-native-selection-brief.v1",
      qualificationHash: qualification.qualificationHash,
      market: "US",
      language: "en-US",
      currency: "USD",
      category: "desk-accessories",
      targetUseCase: "novice-market-screening",
      priceRange: { min: 15, max: 45 },
      exclusions: { terms: [], categories: [], variants: [], compliance: [] },
      sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "contract-seed-v1" },
      stage1RuleFileHash: "1".repeat(64),
      stage15RuleFileHash: "2".repeat(64),
      weightsHash: "3".repeat(64),
      implementationVersion: "stage15-source-native-v1",
      imagePolicy: "external_https_only_no_download",
      requestedSampleSize: 20,
    }, "selectionBriefHash");
    const sample = withSelfHash({
      productKey: `source:synthetic-catalogue:SN-001:${stableHash("finish=aurora-1;size=standard").slice(0, 16)}`,
      sourceId: "synthetic-catalogue",
      sourceProductId: "SN-001",
      variantSignature: "finish=aurora-1;size=standard",
      recordHash: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0].recordHash,
    }, "sampleHash");
    const screeningResult = withSelfHash({
      role: "screening_operator",
      sampleHash: sample.sampleHash,
      completedAt: "2026-07-17T10:00:00.000Z",
    }, "resultHash");
    const outcomeResult = withSelfHash({
      role: "outcome_assessor_a",
      sampleHash: sample.sampleHash,
      completedAt: "2026-07-17T10:01:00.000Z",
    }, "resultHash");

    expect(() => assertSourceNativeQualificationIntegrity(qualification as never)).not.toThrow();
    expect(() => assertSourceNativeAccessRequestIntegrity(request as never)).not.toThrow();
    expect(() => assertSourceNativeAuthorizationIntegrity(authorization as never)).not.toThrow();
    expect(() => assertSourceNativeAccessLogEntryIntegrity(accessLog as never)).not.toThrow();
    expect(() => assertSourceNativeSelectionBriefIntegrity(selectionBrief as never)).not.toThrow();
    expect(() => assertSourceNativeSampleIntegrity(sample as never)).not.toThrow();
    expect(() => assertSourceNativeScreeningOperatorResultIntegrity(screeningResult as never)).not.toThrow();
    expect(() => assertSourceNativeOutcomeAssessorResultIntegrity(outcomeResult as never)).not.toThrow();

    expect(() => assertSourceNativeQualificationIntegrity({ ...qualification, sourceId: "changed" } as never)).toThrow("SOURCE_NATIVE_QUALIFICATION_INVALID");
    expect(() => assertSourceNativeAccessRequestIntegrity({ ...request, requestId: "changed" } as never)).toThrow("SOURCE_NATIVE_ACCESS_REQUEST_INVALID");
    expect(() => assertSourceNativeAuthorizationIntegrity({ ...authorization, approvedTextSha256: "d".repeat(64) } as never)).toThrow("SOURCE_NATIVE_AUTHORIZATION_INVALID");
    expect(() => assertSourceNativeAccessLogEntryIntegrity({ ...accessLog, outcome: "network_error" } as never)).toThrow("SOURCE_NATIVE_ACCESS_LOG_ENTRY_INVALID");
    expect(() => assertSourceNativeSelectionBriefIntegrity({ ...selectionBrief, requestedSampleSize: 19 } as never)).toThrow("SOURCE_NATIVE_SELECTION_BRIEF_INVALID");
    expect(() => assertSourceNativeSelectionBriefIntegrity(withSelfHash({
      ...selectionBrief,
      sampling: { ...selectionBrief.sampling, sortFields: ["title"] },
    }, "selectionBriefHash") as never)).toThrow("SOURCE_NATIVE_SELECTION_BRIEF_INVALID");
    expect(() => assertSourceNativeSampleIntegrity({ ...sample, productKey: "changed" } as never)).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeSampleIntegrity(withSelfHash({
      ...sample,
      productKey: "amazon:US:B07SYPLVTG",
    }, "sampleHash"))).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeSampleIntegrity(withSelfHash({
      ...sample,
      productKey: `source:synthetic-catalogue:B07SYPLVTG:${stableHash(sample.variantSignature).slice(0, 16)}`,
    }, "sampleHash"))).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeSampleIntegrity(withSelfHash({
      ...sample,
      sourceProductId: "amazon:US",
      productKey: `source:${sample.sourceId}:amazon:US:${stableHash(sample.variantSignature).slice(0, 16)}`,
    }, "sampleHash"))).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeSampleIntegrity(withSelfHash({
      ...sample,
      sourceId: "amazon",
      productKey: `source:amazon:${sample.sourceProductId}:${stableHash(sample.variantSignature).slice(0, 16)}`,
    }, "sampleHash"))).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeSampleIntegrity(withSelfHash({
      ...sample,
      sourceId: "amazon:US",
      productKey: `source:amazon:US:${sample.sourceProductId}:${stableHash(sample.variantSignature).slice(0, 16)}`,
    }, "sampleHash"))).toThrow("SOURCE_NATIVE_SAMPLE_INVALID");
    expect(() => assertSourceNativeScreeningOperatorResultIntegrity({ ...screeningResult, completedAt: "2026-07-17T11:00:00.000Z" } as never)).toThrow("SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID");
    expect(() => assertSourceNativeOutcomeAssessorResultIntegrity({ ...outcomeResult, role: "outcome_assessor_b" } as never)).toThrow("SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID");
  });

  it.each([
    ["qualification", assertSourceNativeQualificationIntegrity, "SOURCE_NATIVE_QUALIFICATION_INVALID"],
    ["access request", assertSourceNativeAccessRequestIntegrity, "SOURCE_NATIVE_ACCESS_REQUEST_INVALID"],
    ["authorization", assertSourceNativeAuthorizationIntegrity, "SOURCE_NATIVE_AUTHORIZATION_INVALID"],
    ["access log", assertSourceNativeAccessLogEntryIntegrity, "SOURCE_NATIVE_ACCESS_LOG_ENTRY_INVALID"],
    ["selection brief", assertSourceNativeSelectionBriefIntegrity, "SOURCE_NATIVE_SELECTION_BRIEF_INVALID"],
    ["sample", assertSourceNativeSampleIntegrity, "SOURCE_NATIVE_SAMPLE_INVALID"],
    ["screening result", assertSourceNativeScreeningOperatorResultIntegrity, "SOURCE_NATIVE_SCREENING_OPERATOR_RESULT_INVALID"],
    ["outcome result", assertSourceNativeOutcomeAssessorResultIntegrity, "SOURCE_NATIVE_OUTCOME_ASSESSOR_RESULT_INVALID"],
    ["product record", assertSourceNativeProductRecordIntegrity, "SOURCE_NATIVE_PRODUCT_RECORD_INVALID"],
    ["product record set", assertSourceNativeProductRecordSetIntegrity, "SOURCE_NATIVE_PRODUCT_RECORD_INVALID"],
  ])("rejects non-object and incomplete input without native errors: %s", (_label, assertIntegrity, expectedCode) => {
    [null, undefined, "not-an-object", {}, { reviewSignals: undefined }, { rawCapture: undefined }].forEach((value) => {
      expect(() => assertIntegrity(value as never)).toThrow(expectedCode);
    });
  });

  it("accepts 20 qualified synthetic records and classifies the four exclusions", () => {
    expect(SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS).toHaveLength(20);
    expect(SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS.map((item) => item.exclusionReason)).toEqual([
      "mixed_variant",
      "missing_negative_review",
      "missing_review_date",
      "duplicate_source_product_id",
    ]);
    SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS.forEach(({ record }) => {
      const { recordHash: _recordHash, ...body } = record;
      expect(record.recordHash).toBe(stableHash(body));
    });
    SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS.forEach((record) => {
      expect(() => assertSourceNativeProductRecordIntegrity(record)).not.toThrow();
    });
    SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS.slice(0, 3).forEach((item) => {
      expect(() => assertSourceNativeProductRecordIntegrity(item.record)).toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
    });
    const duplicate = SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS[3].record;
    expect(duplicate.sourceId).toBe(SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19].sourceId);
    expect(duplicate.sourceProductId).toBe(SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19].sourceProductId);
    expect(duplicate.variantSignature).toBe(SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19].variantSignature);
    expect(() => assertSourceNativeProductRecordSetIntegrity([
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
      duplicate,
    ])).toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  });

  it.each([
    ["missing stable identifier", (record: typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]) => ({ ...record, stableIdentifiers: [] })],
    ["missing variant binding", (record: typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]) => ({ ...record, variantBinding: { status: "unverified" as const } })],
    ["comment signal is too long", (record: typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]) => withRecordHash({
      ...record,
      reviewSignals: record.reviewSignals.map((review, index) => index === 0 ? { ...review, signal: "x".repeat(161) } : review),
    })],
    ["malformed raw capture hash", (record: typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]) => withRecordHash({
      ...record,
      rawCapture: { ...record.rawCapture, fileSha256: "not-a-sha256" },
    })],
  ])("rejects incomplete product evidence: %s", (_label, makeRecord) => {
    expect(() => assertSourceNativeProductRecordIntegrity(makeRecord(SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0])))
      .toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  });

  it.each([1, 160])("accepts a review signal with %i character(s)", (length) => {
    const record = withRecordHash({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      reviewSignals: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0].reviewSignals.map((review, index) => index === 0 ? { ...review, signal: "x".repeat(length) } : review),
    });
    expect(() => assertSourceNativeProductRecordIntegrity(record)).not.toThrow();
  });

  it.each([0, 161])("rejects a review signal with %i character(s)", (length) => {
    const record = withRecordHash({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      reviewSignals: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0].reviewSignals.map((review, index) => index === 0 ? { ...review, signal: "x".repeat(length) } : review),
    });
    expect(() => assertSourceNativeProductRecordIntegrity(record)).toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  });

  it("rejects a product body changed without recomputing its record hash", () => {
    expect(() => assertSourceNativeProductRecordIntegrity({
      ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
      title: "Tampered synthetic title",
    })).toThrow("SOURCE_NATIVE_PRODUCT_RECORD_INVALID");
  });

  it.each(["reviewerName", "avatar", "location", "orderId", "fullReviewBody"])(
    "rejects forbidden review privacy field: %s",
    (forbiddenField) => {
      const record = SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0] as unknown as Record<string, unknown>;
      const review = { ...(record.reviewSignals as Array<Record<string, unknown>>)[0], [forbiddenField]: "synthetic-private-value" };
      expect(() => assertSourceNativeProductRecordIntegrity({ ...record, reviewSignals: [review] } as never))
        .toThrow("SOURCE_NATIVE_REVIEW_PRIVACY_FIELD_FORBIDDEN");
    },
  );

  it.each(["email", "ipAddress", "deviceFingerprint", "reviewerId"])(
    "rejects recursively injected record privacy field after record hash recomputation: %s",
    (forbiddenField) => {
      const record = withRecordHash({
        ...SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[0],
        extension: { nested: { [forbiddenField]: "synthetic-private-value" } },
      } as typeof SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[number]);
      expect(() => assertSourceNativeProductRecordIntegrity(record)).toThrow("SOURCE_NATIVE_REVIEW_PRIVACY_FIELD_FORBIDDEN");
    },
  );

  it("exposes the planned readiness and conclusion contracts", () => {
    const readiness: SourceNativeBatchReadiness = {
      state: "ready_for_screening_operator",
      screeningOperatorSlots: 1,
      evaluationAllowed: true,
    };
    const conclusion: SourceNativeEffectivenessConclusion = "evaluation_inconclusive";
    expect(readiness.state).toBe("ready_for_screening_operator");
    expect(conclusion).toBe("evaluation_inconclusive");
  });
});
