import { describe, expect, it } from "vitest";
import { createHash } from "crypto";

import { stableHash } from "../../lib/upstream/pipeline";
import type { SourceNativeAccessLogEntry, SourceNativeAuthorization, SourceNativeProductRecord } from "./stage15-source-native-contract";
import { FIXTURE_SOURCE_NATIVE_QUALIFICATION, SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS } from "./stage15-source-native-test-fixtures";
import { lockSourceNativeSample, buildSourceNativeSamplingFrame } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";
import { assertStage15SourceNativeBatchIntegrity, buildStage15SourceNativeBatch } from "./stage15-source-native-batch";

function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): T & Record<K, string> {
  return { ...body, [field]: stableHash(body) } as T & Record<K, string>;
}

function fixture() {
  const selectionBrief = selfHash({
    schemaVersion: "stage15-source-native-selection-brief.v1" as const,
    qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
    market: "US",
    language: "en-US",
    currency: "USD",
    category: "desk-accessories",
    targetUseCase: "novice-market-screening",
    priceRange: { min: 15, max: 45 },
    exclusions: { terms: ["hazardous"], categories: ["regulated"], variants: ["mixed"], compliance: ["unverified"] },
    sampling: { sortFields: ["sourceProductId"], dedupeKeys: ["sourceProductId", "variantSignature"], seed: "source-native-batch-test-v1" },
    stage1RuleFileHash: "1".repeat(64),
    stage15RuleFileHash: "2".repeat(64),
    weightsHash: "3".repeat(64),
    implementationVersion: "stage15-source-native-v1",
    imagePolicy: "external_https_only_no_download" as const,
    requestedSampleSize: 20 as const,
  }, "selectionBriefHash");
  const policy = { allowedApiEndpoints: ["/v1/products"], allowedPagePathPrefixes: ["/products/"] };
  const budget = { maxApiRequests: 3, maxReviewPages: 3, maxPaidAmountUsd: 0 };
  const accessRequest = selfHash({
    schemaVersion: "stage15-source-native-access-request.v1" as const,
    requestId: "source-native-batch-request",
    qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
    requestedActions: ["api_request"] as Array<"api_request" | "page_open">,
    policy,
    budget,
  }, "requestHash");
  const authorization = selfHash({
    schemaVersion: "stage15-source-native-authorization.v1" as const,
    requestHash: accessRequest.requestHash,
    qualificationHash: FIXTURE_SOURCE_NATIVE_QUALIFICATION.qualificationHash,
    approvedTextSha256: hashSourceNativeApprovalText(accessRequest),
    approvedActions: ["api_request"],
    approvedPolicy: policy,
    approvedBudget: budget,
    maxAutomaticRetries: 0 as const,
    approvedLedgerHeadHash: null,
  }, "authorizationHash") as unknown as SourceNativeAuthorization;
  const logBody = {
    schemaVersion: "stage15-source-native-access-log-entry.v1" as const,
    requestHash: authorization.requestHash,
    kind: "api_request" as const,
    sourceId: FIXTURE_SOURCE_NATIVE_QUALIFICATION.sourceId,
    target: "/v1/products",
    requestedAt: "2026-07-17T10:00:00.000Z",
    attempt: 1,
    paidAmountUsd: 0,
    previousLogHash: null,
    outcome: "success" as const,
  };
  const accessLog = [selfHash(logBody, "logHash") satisfies SourceNativeAccessLogEntry];
  const sampleLock = lockSourceNativeSample({
    seed: "source-native-batch-test-v1",
    frame: buildSourceNativeSamplingFrame({
      qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
      eligibleRecords: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    }),
  });
  return {
    batchId: "stage15-source-native-batch-d-test",
    selectionBrief,
    qualification: FIXTURE_SOURCE_NATIVE_QUALIFICATION,
    accessRequest,
    authorization,
    accessLog,
    sampleLock,
    records: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS,
    createdAt: "2026-07-17T12:00:00.000Z",
  };
}

function rehashRecord(record: SourceNativeProductRecord): SourceNativeProductRecord {
  const { recordHash: _recordHash, ...body } = record;
  return selfHash(body, "recordHash");
}

function publicText(value: unknown): string {
  return JSON.stringify(value);
}

function rawUtf8Hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function rehashManifestAndBatch(batch: ReturnType<typeof buildStage15SourceNativeBatch>, replacements: Record<string, unknown>) {
  const artifacts = batch.manifest.artifacts.map((entry) => {
    const artifact = replacements[entry.name];
    return artifact === undefined ? entry : { ...entry, rawUtf8Sha256: rawUtf8Hash(artifact), canonicalHash: stableHash(artifact) };
  });
  const { manifestHash: _manifestHash, ...manifestBody } = batch.manifest;
  const manifest = selfHash({ ...manifestBody, artifacts }, "manifestHash");
  const body = { ...batch, ...replacements, manifest, batchHash: undefined };
  return { ...body, batchHash: stableHash(body) };
}

describe("stage15 source-native Batch D closure", () => {
  it("builds a self-hashed source-native 20-record closure with a v1.1 Stage 1 run", () => {
    const batch = buildStage15SourceNativeBatch(fixture());

    expect(batch.readiness).toMatchObject({ state: "upstream_only", evaluationAllowed: false });
    expect(batch.readiness).toMatchObject({ pendingStages: expect.arrayContaining([
      "screening_operator_packet", "outcome_assessor_packet", "stage15_run",
    ]) });
    expect(batch.stage1.rankingRun.rankingRuleVersion).toBe("stage1-deterministic-v1.1");
    expect(batch.stage1.scoringInput.candidates).toHaveLength(20);
    expect(batch.stage1.scoringInput.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ minimumEvidenceComplete: true, observedRiskFlags: [], appearanceCount: 1, appearances: [{ sponsored: null }] }),
    ]));
    expect(batch.stage1.rankingRun.results.every((item) => item.productKey.startsWith("source:synthetic-catalogue:"))).toBe(true);
    expect(batch.manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "collection_run" }),
      expect.objectContaining({ name: "source_adapter_result" }),
      expect.objectContaining({ name: "source_native_import_projection" }),
      expect.objectContaining({ name: "stage1" }),
      expect.objectContaining({ name: "screening_visual_packet" }),
      expect.objectContaining({ name: "outcome_visual_packet" }),
    ]));
    expect(batch.manifest.pendingArtifacts.every((item) => item.status === "stage_required_pending")).toBe(true);
    expect(batch.manifest).toMatchObject({
      batchMode: "source_native_blind_validation_batch",
      batchRole: "prospective_validation",
      sampleSize: 20,
      primarySourceCount: 1,
      productionEffect: false,
    });
    expect(batch.manifest.pendingArtifacts.map((item) => item.name)).toEqual(expect.arrayContaining([
      "screening_operator_result_template",
      "outcome_assessor_a_result_template",
      "outcome_assessor_b_result_template",
    ]));
    expect(batch.controlArtifacts.accessRequest.requestHash).toBe(fixture().accessRequest.requestHash);
    expect(batch.controlArtifacts.accessLog.logHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(batch.manifest.artifacts.every((item) => item.relativePath.startsWith("source-native-batch-d/"))).toBe(true);
    expect(batch.manifest.artifacts.every((item) => /^[a-f0-9]{64}$/u.test(item.rawUtf8Sha256) && /^[a-f0-9]{64}$/u.test(item.canonicalHash))).toBe(true);
    expect(batch.batchHash).toBe(stableHash({ ...batch, batchHash: undefined }));
  });

  it.each([
    ["nineteen records", (input: ReturnType<typeof fixture>) => ({ ...input, records: input.records.slice(0, 19) }), "SOURCE_NATIVE_BATCH_EXACT_RECORD_COUNT_REQUIRED"],
    ["second source", (input: ReturnType<typeof fixture>) => ({ ...input, records: [rehashRecord({ ...input.records[0], sourceId: "another-catalogue" }), ...input.records.slice(1)] }), "SOURCE_NATIVE_BATCH_SINGLE_SOURCE_REQUIRED"],
    ["stale record hash", (input: ReturnType<typeof fixture>) => ({ ...input, records: [{ ...input.records[0], title: "changed without record hash" }, ...input.records.slice(1)] }), "SOURCE_NATIVE_BATCH_RECORD_INVALID"],
    ["mixed variant", (input: ReturnType<typeof fixture>) => ({ ...input, records: [rehashRecord({ ...input.records[0], variantBinding: { status: "mixed_variant" } }), ...input.records.slice(1)] }), "SOURCE_NATIVE_BATCH_RECORD_INVALID"],
    ["sample lock mismatch", (input: ReturnType<typeof fixture>) => ({ ...input, records: [rehashRecord({ ...input.records[0], title: "new locked record" }), ...input.records.slice(1)] }), "SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH"],
  ] as const)("fails closed for %s", (_label, mutate, code) => {
    expect(() => buildStage15SourceNativeBatch(mutate(fixture()))).toThrow(code);
  });

  it("fails closed on authorization budget and chained-log conflicts", () => {
    const input = fixture();
    const { authorizationHash: _authorizationHash, ...authorizationBody } = input.authorization;
    const authorization = selfHash({ ...authorizationBody, approvedBudget: { ...input.authorization.approvedBudget, maxApiRequests: 0 } }, "authorizationHash");
    expect(() => buildStage15SourceNativeBatch({ ...input, authorization })).toThrow("SOURCE_NATIVE_BATCH_REQUEST_BINDING_INVALID");
    const { logHash: _logHash, ...logBody } = input.accessLog[0];
    const brokenLog = selfHash({ ...logBody, previousLogHash: "e".repeat(64) }, "logHash");
    expect(() => buildStage15SourceNativeBatch({ ...input, accessLog: [brokenLog] })).toThrow("SOURCE_NATIVE_BATCH_LOG_CHAIN_INVALID");
  });

  it("requires a matching access request and at least one successful approved current action", () => {
    const input = fixture();
    const { requestHash: _requestHash, ...requestBody } = input.accessRequest;
    const mismatchedRequest = selfHash({ ...requestBody, budget: { ...requestBody.budget, maxApiRequests: 2 } }, "requestHash");
    expect(() => buildStage15SourceNativeBatch({ ...input, accessRequest: mismatchedRequest })).toThrow("SOURCE_NATIVE_BATCH_REQUEST_BINDING_INVALID");
    expect(() => buildStage15SourceNativeBatch({ ...input, accessLog: [] })).toThrow("SOURCE_NATIVE_BATCH_CURRENT_ACTION_REQUIRED");
  });

  it("replays the sample lock and makes reverse input order hash-identical", () => {
    const input = fixture();
    const baseline = buildStage15SourceNativeBatch(input);
    const reversed = buildStage15SourceNativeBatch({ ...input, records: [...input.records].reverse() });
    expect(reversed.batchHash).toBe(baseline.batchHash);
  });

  it("keeps both public packets blind while preserving Outcome rich source evidence", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    const forbidden = /productKey|sourceProductId|sourceUrl|http|rankingRunId|totalScore|componentScores|promotionDecision|recommendationTier|advance|watch|reject|insufficient|authorizationHash/iu;

    expect(publicText(batch.screeningVisualPacket)).not.toMatch(forbidden);
    expect(publicText(batch.outcomeVisualPacket)).not.toMatch(forbidden);
    expect(batch.outcomeVisualPacket.cards[0]).toMatchObject({
      imageAssetRefs: [expect.stringMatching(/^asset:/u)],
      display: expect.objectContaining({ brand: "Northwind Fabrication" }),
      specifications: expect.objectContaining({ dimensions: "10 x 8 x 3 cm", weight: "240 g" }),
      reviewSignals: expect.arrayContaining([expect.objectContaining({ sentiment: "positive", rating: 5 })]),
      evidenceComplete: false,
      missingReasons: expect.arrayContaining(["discount_status_not_provided"]),
    });
    expect(batch.screeningPrivateBindings.privateBindingHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(batch.outcomePrivateBindings.privateBindingHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a tampered public packet or private binding when revalidated as input", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    expect(() => assertStage15SourceNativeBatchIntegrity({
      ...batch,
      screeningVisualPacket: { ...batch.screeningVisualPacket, cards: [{ ...batch.screeningVisualPacket.cards[0], title: "tampered" }, ...batch.screeningVisualPacket.cards.slice(1)] },
    })).toThrow("SOURCE_NATIVE_BATCH_PACKET_HASH_INVALID");
    expect(() => assertStage15SourceNativeBatchIntegrity({
      ...batch,
      screeningPrivateBindings: { ...batch.screeningPrivateBindings, bindings: [] },
    })).toThrow("SOURCE_NATIVE_BATCH_PRIVATE_BINDING_INVALID");
  });

  it("rejects rehashed cross-boundary and public-content tampering", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    const { packetHash: _packetHash, ...packetBody } = batch.screeningVisualPacket;
    const rehashedPacket = selfHash({
      ...packetBody,
      cards: [{ ...batch.screeningVisualPacket.cards[0], title: "productKey injection" }, ...batch.screeningVisualPacket.cards.slice(1)],
    }, "packetHash");
    expect(() => assertStage15SourceNativeBatchIntegrity({ ...batch, screeningVisualPacket: rehashedPacket })).toThrow("SOURCE_NATIVE_BATCH_PUBLIC_PACKET_LEAK");
    const rehashedBindings = selfHash({
      ...batch.screeningPrivateBindings,
      bindings: batch.screeningPrivateBindings.bindings.map((binding, index) => index === 0 ? { ...binding, blindItemId: "blind-forged" } : binding),
    }, "privateBindingHash");
    expect(() => assertStage15SourceNativeBatchIntegrity({ ...batch, screeningPrivateBindings: rehashedBindings })).toThrow("SOURCE_NATIVE_BATCH_PRIVATE_BINDING_INVALID");
  });

  it("rejects a stop at the approved historical ledger head before accepting current records", () => {
    const input = fixture();
    const { logHash: _currentLogHash, ...currentLogBody } = input.accessLog[0];
    const stopped = selfHash({ ...currentLogBody, requestHash: "e".repeat(64), outcome: "captcha" as const }, "logHash");
    const current = selfHash({ ...currentLogBody, previousLogHash: stopped.logHash }, "logHash");
    const { authorizationHash: _authorizationHash, ...authorizationBody } = input.authorization;
    const authorization = selfHash({ ...authorizationBody, approvedLedgerHeadHash: stopped.logHash }, "authorizationHash") as unknown as SourceNativeAuthorization;
    expect(() => buildStage15SourceNativeBatch({ ...input, authorization, accessLog: [stopped, current] }))
      .toThrow("SOURCE_NATIVE_BATCH_STOP_CONDITION_ACTIVE");
  });

  it("rejects rehashed duplicate public blind IDs and a rehashed stale manifest entry", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    const { packetHash: _packetHash, ...packetBody } = batch.screeningVisualPacket;
    const duplicatePacket = selfHash({ ...packetBody, cards: [{ ...packetBody.cards[0] }, { ...packetBody.cards[1], blindItemId: packetBody.cards[0].blindItemId }, ...packetBody.cards.slice(2)] }, "packetHash");
    expect(() => assertStage15SourceNativeBatchIntegrity({ ...batch, screeningVisualPacket: duplicatePacket })).toThrow("SOURCE_NATIVE_BATCH_PACKET_BINDING_INVALID");
    const { manifestHash: _manifestHash, ...manifestBody } = batch.manifest;
    const staleManifest = selfHash({ ...manifestBody, artifacts: manifestBody.artifacts.map((entry, index) => index === 0 ? { ...entry, canonicalHash: "f".repeat(64) } : entry) }, "manifestHash");
    expect(() => assertStage15SourceNativeBatchIntegrity({ ...batch, manifest: staleManifest })).toThrow("SOURCE_NATIVE_BATCH_MANIFEST_INVALID");
  });

  it("rejects every fully rehashed derived-artifact semantic mutation", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    const { stage1Hash: _stage1Hash, ...stage1Body } = batch.stage1;
    const changedStage1 = selfHash({ ...stage1Body, rankingRun: { ...stage1Body.rankingRun, results: stage1Body.rankingRun.results.map((item, index) => index === 0 ? { ...item, totalScore: 0, rank: 20 } : item) } }, "stage1Hash");
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch(batch, { stage1: changedStage1 }))).toThrow();

    const { sourceAdapterResultHash: _adapterHash, ...adapterBody } = batch.sourceAdapterResult;
    const adapterRecords = adapterBody.records as Array<Record<string, unknown>>;
    const changedAdapter = selfHash({ ...adapterBody, records: adapterRecords.map((item, index) => index === 0 ? { ...item, recordHash: "f".repeat(64) } : item) }, "sourceAdapterResultHash");
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch(batch, { source_adapter_result: changedAdapter, sourceAdapterResult: changedAdapter }))).toThrow();

    const { importProjectionHash: _importHash, ...importBody } = batch.importProjection;
    const importCandidates = importBody.candidates as Array<Record<string, unknown>>;
    const changedImport = selfHash({ ...importBody, candidates: importCandidates.map((item, index) => index === 0 ? { ...item, price: 999 } : item) }, "importProjectionHash");
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch(batch, { source_native_import_projection: changedImport, importProjection: changedImport }))).toThrow();

    const { reviewEvidenceHash: _reviewHash, ...reviewBody } = batch.reviewEvidence;
    const reviewEvidence = reviewBody.evidence as Array<{ reviewSignals: Array<Record<string, unknown>> } & Record<string, unknown>>;
    const changedReview = selfHash({ ...reviewBody, evidence: reviewEvidence.map((item, index) => index === 0 ? { ...item, reviewSignals: [{ ...item.reviewSignals[0], signal: "changed direct signal" }, ...item.reviewSignals.slice(1)] } : item) }, "reviewEvidenceHash");
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch(batch, { source_native_review_evidence: changedReview, reviewEvidence: changedReview }))).toThrow();

    const { packetHash: _packetHash, ...packetBody } = batch.screeningVisualPacket;
    const changedPacket = selfHash({ ...packetBody, cards: [{ ...packetBody.cards[0], title: "different neutral title" }, ...packetBody.cards.slice(1)] }, "packetHash");
    const { privateBindingHash: _bindingHash, ...bindingBody } = batch.screeningPrivateBindings;
    const changedBindings = selfHash({ ...bindingBody, packetHash: changedPacket.packetHash }, "privateBindingHash");
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch(batch, { screening_visual_packet: changedPacket, screening_private_bindings: changedBindings, screeningVisualPacket: changedPacket, screeningPrivateBindings: changedBindings }))).toThrow();
  });

  it("rejects fully rehashed arbitrary approval text and divergent control frame", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    const { authorizationHash: _authorizationHash, ...authorizationBody } = batch.controlArtifacts.authorization;
    const changedAuthorization = selfHash({ ...authorizationBody, approvedTextSha256: "f".repeat(64) }, "authorizationHash");
    const changedControl = { ...batch.controlArtifacts, authorization: changedAuthorization };
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch({ ...batch, controlArtifacts: changedControl }, { access_authorization: changedAuthorization, controlArtifacts: changedControl }))).toThrow();
    const { frameHash: _frameHash, ...frameBody } = batch.controlArtifacts.samplingFrame;
    const divergentFrame = selfHash({ ...frameBody, records: [...frameBody.records].reverse() }, "frameHash");
    const divergentControl = { ...batch.controlArtifacts, samplingFrame: divergentFrame };
    expect(() => assertStage15SourceNativeBatchIntegrity(rehashManifestAndBatch({ ...batch, controlArtifacts: divergentControl }, { sampling_frame: divergentFrame, controlArtifacts: divergentControl }))).toThrow();
  });

  it("freezes the design paths and raw UTF-8 JSON bytes", () => {
    const batch = buildStage15SourceNativeBatch(fixture());
    expect(batch.manifest.artifacts.map((entry) => entry.relativePath)).toEqual(expect.arrayContaining([
      "source-native-batch-d/source-native-selection-brief.v1.json",
      "source-native-batch-d/import-package.v1.json",
      "source-native-batch-d/stage1-run.v1.json",
      "source-native-batch-d/source-native-outcome-private-bindings.v1.json",
    ]));
    const entry = batch.manifest.artifacts.find((item) => item.name === "selection_brief");
    expect(entry?.rawUtf8Sha256).toBe(rawUtf8Hash(batch.controlArtifacts.selectionBrief));
  });
});
