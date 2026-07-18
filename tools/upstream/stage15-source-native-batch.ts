import { createHash } from "crypto";

import type { RankingRun } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import { rankStage1Candidates, type Stage1ScoringInput } from "../../lib/upstream/stage1Scoring";
import {
  assertSourceNativeAccessLogEntryIntegrity,
  assertSourceNativeAccessRequestIntegrity,
  assertSourceNativeAuthorizationIntegrity,
  assertSourceNativeProductRecordIntegrity,
  assertSourceNativeProductRecordSetIntegrity,
  assertSourceNativeQualificationIntegrity,
  assertSourceNativeSampleIntegrity,
  assertSourceNativeSelectionBriefIntegrity,
  type SourceNativeAccessLogEntry,
  type SourceNativeAccessRequest,
  type SourceNativeAuthorization,
  type SourceNativeBatchReadiness,
  type SourceNativeProductRecord,
  type SourceNativeSelectionBrief,
  type SourceNativeSourceQualification,
} from "./stage15-source-native-contract";
import { lockSourceNativeSample, type SourceNativeSampleLock, type SourceNativeSamplingFrame } from "./stage15-source-native-sampling";
import { hashSourceNativeApprovalText } from "./stage15-source-native-source-gate";

const SAMPLE_SIZE = 20;
const ROOT = "source-native-batch-d";
const PUBLIC_FORBIDDEN = /productKey|sourceProductId|sourceUrl|http|rankingRunId|totalScore|componentScores|promotionDecision|recommendationTier|advance|watch|reject|insufficient|authorizationHash/iu;
const STOP_OUTCOMES = new Set(["login_wall", "captcha", "access_denied", "robots_unknown", "license_unknown"]);
const PENDING_ARTIFACTS = [
  "stage15_run", "screening_operator_packet", "outcome_assessor_packet", "screening_operator_result_template", "outcome_assessor_a_result_template", "outcome_assessor_b_result_template", "screening_operator_result", "outcome_assessor_results", "effectiveness_analysis",
] as const;

type Hashed<T extends Record<string, unknown>, K extends string> = T & Record<K, string>;
type ArtifactName =
  | "selection_brief" | "source_qualification" | "access_request" | "access_authorization" | "access_log"
  | "sampling_frame" | "sample_lock" | "collection_run" | "source_adapter_result" | "source_native_import_projection"
  | "stage1" | "source_native_review_evidence" | "screening_visual_packet" | "outcome_visual_packet"
  | "screening_private_bindings" | "outcome_private_bindings";

export type SourceNativeVisualCard = {
  blindItemId: string; title: string; price: number; currency: string; rating: number; reviewCount: number;
  missingReasons: string[]; capturedAt: string; imageAssetRefs: string[];
};
export type SourceNativeOutcomeVisualCard = SourceNativeVisualCard & {
  display: { brand: string; model: string; variant: string };
  discountStatus: { status: "not_provided"; missingReason: "discount_status_not_provided" };
  specifications: { dimensions: string; weight: string; materials: string[]; features: string[] };
  reviewSignals: Array<{ sentiment: "positive" | "negative"; rating: number; reviewedAt: string; signal: string; evidenceRef: string }>;
  qualitySignals: Array<{ sentiment: "positive" | "negative"; signal: string }>;
  evidenceComplete: false;
};
export type SourceNativeVisualPacket<T> = { schemaVersion: string; batchId: string; capturedAt: string; cards: T[]; packetHash: string };
export type SourceNativePrivateBindings = {
  schemaVersion: "stage15-source-native-private-bindings.v1"; packetHash: string;
  bindings: Array<{ blindItemId: string; sampleHash: string; productKey: string; sourceProductId: string; recordHash: string; sourceUrl: string;
    images: Array<{ imageAssetRef: string; imageUrl: string; imageUrlHash: string; recordHash: string }> }>;
  privateBindingHash: string;
};
export type SourceNativeManifestEntry = { name: ArtifactName; relativePath: string; rawUtf8Sha256: string; canonicalHash: string };
export type SourceNativeControlArtifacts = {
  selectionBrief: SourceNativeSelectionBrief; qualification: SourceNativeSourceQualification; accessRequest: SourceNativeAccessRequest;
  authorization: SourceNativeAuthorization; accessLog: Hashed<{ schemaVersion: "stage15-source-native-access-log.v1"; entries: SourceNativeAccessLogEntry[] }, "logHash">;
  samplingFrame: SourceNativeSamplingFrame; sampleLock: SourceNativeSampleLock;
};
export type Stage15SourceNativeBatch = {
  batchId: string; createdAt: string; controlArtifacts: SourceNativeControlArtifacts;
  collectionRun: Hashed<Record<string, unknown>, "collectionRunHash">; sourceAdapterResult: Hashed<Record<string, unknown>, "sourceAdapterResultHash">;
  importProjection: Hashed<Record<string, unknown>, "importProjectionHash">;
  stage1: { schemaVersion: "stage15-source-native-stage1.v1"; scoringInput: Stage1ScoringInput; rankingRun: RankingRun; stage1Hash: string };
  reviewEvidence: Hashed<Record<string, unknown>, "reviewEvidenceHash">;
  screeningVisualPacket: SourceNativeVisualPacket<SourceNativeVisualCard>; outcomeVisualPacket: SourceNativeVisualPacket<SourceNativeOutcomeVisualCard>;
  screeningPrivateBindings: SourceNativePrivateBindings; outcomePrivateBindings: SourceNativePrivateBindings;
  readiness: Extract<SourceNativeBatchReadiness, { state: "upstream_only" }>;
  manifest: { schemaVersion: "stage15-source-native-initial-manifest.v1"; batchId: string; batchMode: "source_native_blind_validation_batch"; batchRole: "prospective_validation"; sampleSize: 20; primarySourceCount: 1; productionEffect: false; artifacts: SourceNativeManifestEntry[];
    pendingArtifacts: Array<{ name: typeof PENDING_ARTIFACTS[number]; status: "stage_required_pending" }>; manifestHash: string };
  batchHash: string;
};
export type BuildStage15SourceNativeBatchInput = {
  batchId: string; selectionBrief: SourceNativeSelectionBrief; qualification: SourceNativeSourceQualification; accessRequest: SourceNativeAccessRequest;
  authorization: SourceNativeAuthorization; accessLog: ReadonlyArray<SourceNativeAccessLogEntry>; sampleLock: SourceNativeSampleLock;
  records: ReadonlyArray<SourceNativeProductRecord>; createdAt: string;
};

function fail(code: string): never { throw new Error(code); }
function selfHash<T extends Record<string, unknown>, K extends string>(body: T, field: K): Hashed<T, K> { return { ...body, [field]: stableHash(body) } as Hashed<T, K>; }
function selfHashed(value: unknown, field: string): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { [field]: hash, ...body } = value as Record<string, unknown>;
  return typeof hash === "string" && stableHash(body) === hash;
}
export function serializeSourceNativeArtifactUtf8(value: unknown): string { return JSON.stringify(value); }
export function rawUtf8Sha256(value: unknown): string { return createHash("sha256").update(serializeSourceNativeArtifactUtf8(value), "utf8").digest("hex"); }
function assetRef(url: string): string { return `asset:${stableHash(url)}`; }
function blindId(sampleHash: string): string { return `blind-${stableHash(sampleHash).slice(0, 20)}`; }
function candidateId(sampleHash: string): string { return `candidate-${stableHash(sampleHash).slice(0, 20)}`; }
function variantGroupKey(record: SourceNativeProductRecord): string {
  return `variant:${stableHash({ stableIdentifiers: record.stableIdentifiers.map((id) => `${id.kind}:${id.value}`).sort(), variantSignature: record.variantSignature }).slice(0, 24)}`;
}
function publicScan(packet: unknown): void { if (PUBLIC_FORBIDDEN.test(JSON.stringify(packet))) fail("SOURCE_NATIVE_BATCH_PUBLIC_PACKET_LEAK"); }
function validPageTarget(target: string, qualification: SourceNativeSourceQualification, request: SourceNativeAccessRequest): boolean {
  try { const url = new URL(target); return url.protocol === "https:" && !url.username && !url.password && url.origin === qualification.sourceOrigin && request.policy.allowedPagePathPrefixes.some((prefix) => url.pathname.startsWith(prefix)); } catch { return false; }
}

function assertAccessClosure(input: BuildStage15SourceNativeBatchInput): Hashed<{ schemaVersion: "stage15-source-native-access-log.v1"; entries: SourceNativeAccessLogEntry[] }, "logHash"> {
  let previous: string | null = null; let api = 0; let pages = 0; let paid = 0; let currentSuccesses = 0;
  let headFound = input.authorization.approvedLedgerHeadHash === null; let currentMayBegin = input.authorization.approvedLedgerHeadHash === null;
  for (const entry of input.accessLog) {
    try { assertSourceNativeAccessLogEntryIntegrity(entry); } catch { fail("SOURCE_NATIVE_BATCH_LOG_INVALID"); }
    if (entry.sourceId !== input.qualification.sourceId || entry.previousLogHash !== previous) fail("SOURCE_NATIVE_BATCH_LOG_CHAIN_INVALID");
    previous = entry.logHash;
    if (STOP_OUTCOMES.has(entry.outcome)) fail("SOURCE_NATIVE_BATCH_STOP_CONDITION_ACTIVE");
    if (entry.logHash === input.authorization.approvedLedgerHeadHash) { headFound = true; currentMayBegin = true; continue; }
    if (entry.requestHash !== input.accessRequest.requestHash) continue;
    if (!currentMayBegin) fail("SOURCE_NATIVE_BATCH_LOG_CHAIN_INVALID");
    if (entry.attempt !== 1) fail("SOURCE_NATIVE_BATCH_RETRY_FORBIDDEN");
    if (!input.accessRequest.requestedActions.includes(entry.kind) || !input.authorization.approvedActions.includes(entry.kind)) fail("SOURCE_NATIVE_BATCH_ACTION_NOT_APPROVED");
    if (entry.kind === "api_request") { if (!input.authorization.approvedPolicy.allowedApiEndpoints.includes(entry.target)) fail("SOURCE_NATIVE_BATCH_URL_NOT_ALLOWED"); api += 1; }
    else { if (!validPageTarget(entry.target, input.qualification, input.accessRequest)) fail("SOURCE_NATIVE_BATCH_URL_NOT_ALLOWED"); pages += 1; }
    paid += entry.paidAmountUsd;
    if (entry.outcome === "success") currentSuccesses += 1;
  }
  if (!headFound) fail("SOURCE_NATIVE_BATCH_LOG_CHAIN_INVALID");
  if (currentSuccesses < 1) fail("SOURCE_NATIVE_BATCH_CURRENT_ACTION_REQUIRED");
  if (api > input.authorization.approvedBudget.maxApiRequests) fail("SOURCE_NATIVE_BATCH_API_BUDGET_EXCEEDED");
  if (pages > input.authorization.approvedBudget.maxReviewPages) fail("SOURCE_NATIVE_BATCH_PAGE_BUDGET_EXCEEDED");
  if (paid > input.authorization.approvedBudget.maxPaidAmountUsd) fail("SOURCE_NATIVE_BATCH_PAID_LIMIT_EXCEEDED");
  return selfHash({ schemaVersion: "stage15-source-native-access-log.v1" as const, entries: input.accessLog.map((entry) => structuredClone(entry)) }, "logHash");
}

function assertInputClosure(input: BuildStage15SourceNativeBatchInput): SourceNativeProductRecord[] {
  if (!input || typeof input !== "object" || !input.batchId?.trim() || Number.isNaN(Date.parse(input.createdAt))) fail("SOURCE_NATIVE_BATCH_INPUT_INVALID");
  try { assertSourceNativeQualificationIntegrity(input.qualification); assertSourceNativeSelectionBriefIntegrity(input.selectionBrief); assertSourceNativeAccessRequestIntegrity(input.accessRequest); assertSourceNativeAuthorizationIntegrity(input.authorization); } catch { fail("SOURCE_NATIVE_BATCH_CONTROL_INVALID"); }
  if (input.selectionBrief.qualificationHash !== input.qualification.qualificationHash || input.accessRequest.qualificationHash !== input.qualification.qualificationHash
    || input.authorization.qualificationHash !== input.qualification.qualificationHash || input.authorization.requestHash !== input.accessRequest.requestHash
    || stableHash(input.authorization.approvedPolicy) !== stableHash(input.accessRequest.policy)
    || stableHash(input.authorization.approvedBudget) !== stableHash(input.accessRequest.budget)
    || stableHash(input.authorization.approvedActions) !== stableHash(input.accessRequest.requestedActions)
    || input.authorization.approvedTextSha256 !== hashSourceNativeApprovalText(input.accessRequest)) fail("SOURCE_NATIVE_BATCH_REQUEST_BINDING_INVALID");
  if (!Array.isArray(input.records) || input.records.length !== SAMPLE_SIZE) fail("SOURCE_NATIVE_BATCH_EXACT_RECORD_COUNT_REQUIRED");
  try { assertSourceNativeProductRecordSetIntegrity(input.records); } catch { fail("SOURCE_NATIVE_BATCH_RECORD_INVALID"); }
  if (input.records.some((record) => record.sourceId !== input.qualification.sourceId)) fail("SOURCE_NATIVE_BATCH_SINGLE_SOURCE_REQUIRED");
  if (input.records.some((record) => record.price.currency !== input.selectionBrief.currency || record.price.amount < input.selectionBrief.priceRange.min || record.price.amount > input.selectionBrief.priceRange.max)) fail("SOURCE_NATIVE_BATCH_BRIEF_CONSTRAINT_INVALID");
  if (!selfHashed(input.sampleLock, "lockHash") || input.sampleLock.qualificationHash !== input.qualification.qualificationHash
    || input.sampleLock.sourceId !== input.qualification.sourceId || input.sampleLock.seed !== input.selectionBrief.sampling.seed
    || !selfHashed(input.sampleLock.frame, "frameHash") || input.sampleLock.frame.qualificationHash !== input.qualification.qualificationHash
    || input.sampleLock.frame.sourceId !== input.qualification.sourceId) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_INVALID");
  let replay: SourceNativeSampleLock;
  try { replay = lockSourceNativeSample({ seed: input.selectionBrief.sampling.seed, frame: input.sampleLock.frame }); } catch { fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_INVALID"); }
  if (replay.lockHash !== input.sampleLock.lockHash || replay.samples.length !== SAMPLE_SIZE || replay.samples.some((sample, index) => sample.sampleHash !== input.sampleLock.samples[index]?.sampleHash)) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_INVALID");
  const inputByHash = new Map(input.records.map((record) => [record.recordHash, record]));
  const ordered = input.sampleLock.samples.map((sample) => {
    try { assertSourceNativeSampleIntegrity(sample); } catch { fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_INVALID"); }
    const record = inputByHash.get(sample.recordHash);
    if (!record || sample.sourceId !== record.sourceId || sample.sourceProductId !== record.sourceProductId || sample.variantSignature !== record.variantSignature) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH");
    return structuredClone(record);
  });
  if (new Set(ordered.map((record) => record.recordHash)).size !== SAMPLE_SIZE || inputByHash.size !== SAMPLE_SIZE) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH");
  assertAccessClosure(input);
  return ordered;
}

function makePrivateBindings(packetHash: string, records: SourceNativeProductRecord[], samples: SourceNativeSampleLock["samples"]): SourceNativePrivateBindings {
  const sampleByRecord = new Map(samples.map((sample) => [sample.recordHash, sample]));
  return selfHash({ schemaVersion: "stage15-source-native-private-bindings.v1" as const, packetHash, bindings: records.map((record) => {
    const sample = sampleByRecord.get(record.recordHash); if (!sample) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH");
    return { blindItemId: blindId(sample.sampleHash), sampleHash: sample.sampleHash, productKey: sample.productKey, sourceProductId: record.sourceProductId, recordHash: record.recordHash, sourceUrl: record.sourceUrl,
      images: record.imageUrls.map((imageUrl) => ({ imageAssetRef: assetRef(imageUrl), imageUrl, imageUrlHash: stableHash(imageUrl), recordHash: record.recordHash })) };
  }) }, "privateBindingHash");
}
function artifactEntry(name: ArtifactName, artifact: unknown): SourceNativeManifestEntry {
  const fileNames: Record<ArtifactName, string> = {
    selection_brief: "source-native-selection-brief.v1.json", source_qualification: "source-native-source-qualification.v1.json", access_request: "source-native-access-request.v1.json", access_authorization: "source-native-access-authorization.v1.json", access_log: "source-native-access-log.v1.json", sampling_frame: "source-native-sampling-frame.v1.json", sample_lock: "source-native-sample-lock.v1.json", collection_run: "collection-run.v1.json", source_adapter_result: "source-adapter-result.v1.json", source_native_import_projection: "import-package.v1.json", stage1: "stage1-run.v1.json", source_native_review_evidence: "source-native-review-evidence.v1.json", screening_visual_packet: "source-native-screening-visual-packet.v1.json", outcome_visual_packet: "source-native-outcome-visual-packet.v1.json", screening_private_bindings: "source-native-screening-private-bindings.v1.json", outcome_private_bindings: "source-native-outcome-private-bindings.v1.json",
  };
  return { name, relativePath: `${ROOT}/${fileNames[name]}`, rawUtf8Sha256: rawUtf8Sha256(artifact), canonicalHash: stableHash(artifact) };
}

function expectedArtifacts(batch: Omit<Stage15SourceNativeBatch, "manifest" | "batchHash">): Array<[ArtifactName, unknown]> {
  return [
    ["selection_brief", batch.controlArtifacts.selectionBrief], ["source_qualification", batch.controlArtifacts.qualification], ["access_request", batch.controlArtifacts.accessRequest],
    ["access_authorization", batch.controlArtifacts.authorization], ["access_log", batch.controlArtifacts.accessLog], ["sampling_frame", batch.controlArtifacts.samplingFrame], ["sample_lock", batch.controlArtifacts.sampleLock],
    ["collection_run", batch.collectionRun], ["source_adapter_result", batch.sourceAdapterResult], ["source_native_import_projection", batch.importProjection], ["stage1", batch.stage1],
    ["source_native_review_evidence", batch.reviewEvidence], ["screening_visual_packet", batch.screeningVisualPacket], ["outcome_visual_packet", batch.outcomeVisualPacket],
    ["screening_private_bindings", batch.screeningPrivateBindings], ["outcome_private_bindings", batch.outcomePrivateBindings],
  ];
}

export function assertStage15SourceNativeBatchIntegrity(value: unknown): asserts value is Stage15SourceNativeBatch {
  if (!value || typeof value !== "object") fail("SOURCE_NATIVE_BATCH_ARTIFACT_INVALID");
  const batch = value as Stage15SourceNativeBatch;
  const control = batch.controlArtifacts;
  if (!control) fail("SOURCE_NATIVE_BATCH_CONTROL_INVALID");
  try { assertSourceNativeQualificationIntegrity(control.qualification); assertSourceNativeSelectionBriefIntegrity(control.selectionBrief); assertSourceNativeAccessRequestIntegrity(control.accessRequest); assertSourceNativeAuthorizationIntegrity(control.authorization); } catch { fail("SOURCE_NATIVE_BATCH_CONTROL_INVALID"); }
  if (!selfHashed(control.accessLog, "logHash") || !selfHashed(control.samplingFrame, "frameHash") || !selfHashed(control.sampleLock, "lockHash")
    || control.samplingFrame.frameHash !== control.sampleLock.frame.frameHash) fail("SOURCE_NATIVE_BATCH_CONTROL_INVALID");
  const input: BuildStage15SourceNativeBatchInput = { batchId: batch.batchId, selectionBrief: control.selectionBrief, qualification: control.qualification, accessRequest: control.accessRequest, authorization: control.authorization, accessLog: control.accessLog.entries, sampleLock: control.sampleLock,
    records: control.sampleLock.samples.map((sample) => control.samplingFrame.records.find((record) => record.recordHash === sample.recordHash)).filter((record): record is SourceNativeProductRecord => Boolean(record)), createdAt: batch.createdAt };
  const records = assertInputClosure(input);
  const accessLog = assertAccessClosure(input);
  if (accessLog.logHash !== control.accessLog.logHash) fail("SOURCE_NATIVE_BATCH_CROSS_HASH_INVALID");
  if (!selfHashed(batch.collectionRun, "collectionRunHash") || !selfHashed(batch.sourceAdapterResult, "sourceAdapterResultHash") || !selfHashed(batch.importProjection, "importProjectionHash") || !selfHashed(batch.stage1, "stage1Hash") || !selfHashed(batch.reviewEvidence, "reviewEvidenceHash")) fail("SOURCE_NATIVE_BATCH_ARTIFACT_HASH_INVALID");
  const c = batch.collectionRun as Record<string, unknown>; const a = batch.sourceAdapterResult as Record<string, unknown>; const i = batch.importProjection as Record<string, unknown>; const r = batch.reviewEvidence as Record<string, unknown>;
  if (c.selectionBriefHash !== control.selectionBrief.selectionBriefHash || c.qualificationHash !== control.qualification.qualificationHash || c.requestHash !== control.accessRequest.requestHash || c.authorizationHash !== control.authorization.authorizationHash || c.accessLogHash !== control.accessLog.logHash || c.frameHash !== control.samplingFrame.frameHash || c.sampleLockHash !== control.sampleLock.lockHash
    || a.collectionRunHash !== batch.collectionRun.collectionRunHash || i.sourceAdapterResultHash !== batch.sourceAdapterResult.sourceAdapterResultHash || i.stage1InputHash !== batch.stage1.scoringInput.inputHash || r.sourceAdapterResultHash !== batch.sourceAdapterResult.sourceAdapterResultHash) fail("SOURCE_NATIVE_BATCH_CROSS_HASH_INVALID");
  if (batch.stage1.rankingRun.rankingRuleVersion !== "stage1-deterministic-v1.1" || batch.stage1.scoringInput.inputHash !== batch.stage1.rankingRun.inputHash || batch.stage1.scoringInput.candidates.length !== SAMPLE_SIZE || batch.stage1.rankingRun.results.length !== SAMPLE_SIZE) fail("SOURCE_NATIVE_BATCH_STAGE1_INVALID");
  for (const packet of [batch.screeningVisualPacket, batch.outcomeVisualPacket]) { if (!selfHashed(packet, "packetHash")) fail("SOURCE_NATIVE_BATCH_PACKET_HASH_INVALID"); publicScan(packet); if (packet.batchId !== batch.batchId || packet.cards.length !== SAMPLE_SIZE || new Set(packet.cards.map((card) => card.blindItemId)).size !== SAMPLE_SIZE) fail("SOURCE_NATIVE_BATCH_PACKET_BINDING_INVALID"); }
  if (batch.outcomeVisualPacket.cards.some((card) => card.evidenceComplete || !card.missingReasons.includes("discount_status_not_provided"))) fail("SOURCE_NATIVE_BATCH_PACKET_BINDING_INVALID");
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record])); const samplesByHash = new Map(control.sampleLock.samples.map((sample) => [sample.sampleHash, sample]));
  for (const [packet, bindings] of [[batch.screeningVisualPacket, batch.screeningPrivateBindings], [batch.outcomeVisualPacket, batch.outcomePrivateBindings]] as const) {
    if (!selfHashed(bindings, "privateBindingHash") || bindings.packetHash !== packet.packetHash || bindings.bindings.length !== SAMPLE_SIZE) fail("SOURCE_NATIVE_BATCH_PRIVATE_BINDING_INVALID");
    const ids = new Set(bindings.bindings.map((binding) => binding.blindItemId)); if (ids.size !== SAMPLE_SIZE || [...ids].some((id) => !packet.cards.some((card) => card.blindItemId === id))) fail("SOURCE_NATIVE_BATCH_PRIVATE_BINDING_INVALID");
    for (const binding of bindings.bindings) { const sample = samplesByHash.get(binding.sampleHash); const record = recordsByHash.get(binding.recordHash); const card = packet.cards.find((item) => item.blindItemId === binding.blindItemId);
      if (!sample || !record || !card || binding.productKey !== sample.productKey || binding.sourceProductId !== record.sourceProductId || binding.sourceUrl !== record.sourceUrl
        || binding.images.length !== record.imageUrls.length || binding.images.some((image) => image.recordHash !== record.recordHash || image.imageUrlHash !== stableHash(image.imageUrl) || image.imageAssetRef !== assetRef(image.imageUrl) || !card.imageAssetRefs.includes(image.imageAssetRef))) fail("SOURCE_NATIVE_BATCH_PRIVATE_BINDING_INVALID"); }
  }
  if (!selfHashed(batch.manifest, "manifestHash") || batch.manifest.batchId !== batch.batchId || batch.manifest.batchMode !== "source_native_blind_validation_batch" || batch.manifest.batchRole !== "prospective_validation" || batch.manifest.sampleSize !== SAMPLE_SIZE || batch.manifest.primarySourceCount !== 1 || batch.manifest.productionEffect !== false || batch.manifest.pendingArtifacts.length !== PENDING_ARTIFACTS.length || batch.manifest.pendingArtifacts.some((item, index) => item.name !== PENDING_ARTIFACTS[index] || item.status !== "stage_required_pending")) fail("SOURCE_NATIVE_BATCH_MANIFEST_INVALID");
  const actualArtifacts = expectedArtifacts(batch); if (batch.manifest.artifacts.length !== actualArtifacts.length || new Set(batch.manifest.artifacts.map((entry) => entry.name)).size !== actualArtifacts.length) fail("SOURCE_NATIVE_BATCH_MANIFEST_INVALID");
  for (const [name, artifact] of actualArtifacts) { const actual = batch.manifest.artifacts.find((entry) => entry.name === name); const wanted = artifactEntry(name, artifact); if (!actual || actual.relativePath !== wanted.relativePath || actual.rawUtf8Sha256 !== wanted.rawUtf8Sha256 || actual.canonicalHash !== wanted.canonicalHash || !actual.relativePath.startsWith(`${ROOT}/`) || actual.relativePath.includes("..")) fail("SOURCE_NATIVE_BATCH_MANIFEST_INVALID"); }
  const expected = deriveBatchArtifacts(input);
  if (stableHash(expected) !== stableHash(batch)) fail("SOURCE_NATIVE_BATCH_DERIVED_MISMATCH");
  const { batchHash, ...body } = batch; if (stableHash(body) !== batchHash) fail("SOURCE_NATIVE_BATCH_HASH_INVALID");
}

function deriveBatchArtifacts(input: BuildStage15SourceNativeBatchInput): Stage15SourceNativeBatch {
  const records = assertInputClosure(input); const accessLog = assertAccessClosure(input);
  const controlArtifacts: SourceNativeControlArtifacts = { selectionBrief: structuredClone(input.selectionBrief), qualification: structuredClone(input.qualification), accessRequest: structuredClone(input.accessRequest), authorization: structuredClone(input.authorization), accessLog, samplingFrame: structuredClone(input.sampleLock.frame), sampleLock: structuredClone(input.sampleLock) };
  const collectionRun = selfHash({ schemaVersion: "stage15-source-native-collection-run.v1", batchId: input.batchId, selectionBriefHash: input.selectionBrief.selectionBriefHash, qualificationHash: input.qualification.qualificationHash, requestHash: input.accessRequest.requestHash, authorizationHash: input.authorization.authorizationHash, accessLogHash: accessLog.logHash, frameHash: input.sampleLock.frame.frameHash, sampleLockHash: input.sampleLock.lockHash, recordHashes: records.map((record) => record.recordHash), createdAt: input.createdAt }, "collectionRunHash");
  const sourceAdapterResult = selfHash({ schemaVersion: "stage15-source-native-source-adapter-result.v1", batchId: input.batchId, collectionRunHash: collectionRun.collectionRunHash, records: records.map((record) => ({ recordHash: record.recordHash, captureSha256: record.captureSha256, capturedAt: record.rawCapture.capturedAt })) }, "sourceAdapterResultHash");
  const sampleByRecord = new Map(input.sampleLock.samples.map((sample) => [sample.recordHash, sample]));
  const candidates = records.map((record) => { const sample = sampleByRecord.get(record.recordHash); if (!sample) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH"); return { candidateId: candidateId(sample.sampleHash), productKey: sample.productKey, variantGroupKey: variantGroupKey(record), inputEvidenceHash: stableHash({ recordHash: record.recordHash, sampleHash: sample.sampleHash }), minimumEvidenceComplete: true, minimumEvidenceMissing: [], observedRiskFlags: [], price: record.price.amount, rating: record.aggregate.rating, reviewCount: record.aggregate.reviewCount, appearanceCount: 1, appearances: [{ sponsored: null }] }; });
  const scoringInput: Stage1ScoringInput = { briefId: `source-native-brief-${input.selectionBrief.selectionBriefHash.slice(0, 16)}`, collectionRunId: `source-native-collection-${collectionRun.collectionRunHash.slice(0, 16)}`, inputHash: stableHash({ sourceAdapterResultHash: sourceAdapterResult.sourceAdapterResultHash, candidates }), createdAt: input.createdAt, candidates };
  const rankingRun = rankStage1Candidates(scoringInput); const stage1 = selfHash({ schemaVersion: "stage15-source-native-stage1.v1" as const, scoringInput, rankingRun }, "stage1Hash");
  const importProjection = selfHash({ schemaVersion: "stage15-source-native-import-projection.v1", batchId: input.batchId, sourceAdapterResultHash: sourceAdapterResult.sourceAdapterResultHash, stage1InputHash: scoringInput.inputHash, candidates: candidates.map(({ candidateId: id, productKey, inputEvidenceHash, price, rating, reviewCount }) => ({ candidateId: id, productKey, inputEvidenceHash, price, rating, reviewCount })) }, "importProjectionHash");
  const reviewEvidence = selfHash({ schemaVersion: "stage15-source-native-review-evidence.v1", batchId: input.batchId, sourceAdapterResultHash: sourceAdapterResult.sourceAdapterResultHash, evidence: records.map((record) => ({ recordHash: record.recordHash, captureSha256: record.captureSha256, reviewSignals: record.reviewSignals.map((signal) => ({ ...signal })) })) }, "reviewEvidenceHash");
  const screeningVisualPacket = selfHash({ schemaVersion: "stage15-screening-visual-packet.v1", batchId: input.batchId, capturedAt: input.createdAt, cards: records.map((record) => { const sample = sampleByRecord.get(record.recordHash); if (!sample) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH"); return { blindItemId: blindId(sample.sampleHash), title: record.title, price: record.price.amount, currency: record.price.currency, rating: record.aggregate.rating, reviewCount: record.aggregate.reviewCount, missingReasons: ["sponsored_status_not_captured"], capturedAt: record.rawCapture.capturedAt, imageAssetRefs: record.imageUrls.map(assetRef) }; }) }, "packetHash") as SourceNativeVisualPacket<SourceNativeVisualCard>;
  const outcomeVisualPacket = selfHash({ schemaVersion: "stage15-outcome-visual-packet.v1", batchId: input.batchId, capturedAt: input.createdAt, cards: records.map((record) => { const sample = sampleByRecord.get(record.recordHash); if (!sample) fail("SOURCE_NATIVE_BATCH_SAMPLE_LOCK_MISMATCH"); return { blindItemId: blindId(sample.sampleHash), title: record.title, price: record.price.amount, currency: record.price.currency, rating: record.aggregate.rating, reviewCount: record.aggregate.reviewCount, missingReasons: ["discount_status_not_provided"], capturedAt: record.rawCapture.capturedAt, imageAssetRefs: record.imageUrls.map(assetRef), display: { brand: record.brand, model: record.model, variant: record.variantSignature }, discountStatus: { status: "not_provided" as const, missingReason: "discount_status_not_provided" as const }, specifications: structuredClone(record.specifications), reviewSignals: record.reviewSignals.map((signal) => ({ sentiment: signal.sentiment, rating: signal.rating, reviewedAt: signal.reviewedAt, signal: signal.signal, evidenceRef: `evidence:${stableHash({ recordHash: record.recordHash, evidenceRef: signal.evidenceRef })}` })), qualitySignals: record.reviewSignals.map((signal) => ({ sentiment: signal.sentiment, signal: signal.signal })), evidenceComplete: false as const }; }) }, "packetHash") as SourceNativeVisualPacket<SourceNativeOutcomeVisualCard>;
  publicScan(screeningVisualPacket); publicScan(outcomeVisualPacket);
  const screeningPrivateBindings = makePrivateBindings(screeningVisualPacket.packetHash, records, input.sampleLock.samples); const outcomePrivateBindings = makePrivateBindings(outcomeVisualPacket.packetHash, records, input.sampleLock.samples);
  const readiness = { state: "upstream_only" as const, pendingStages: [...PENDING_ARTIFACTS], evaluationAllowed: false as const };
  const base = { batchId: input.batchId, createdAt: input.createdAt, controlArtifacts, collectionRun, sourceAdapterResult, importProjection, stage1, reviewEvidence, screeningVisualPacket, outcomeVisualPacket, screeningPrivateBindings, outcomePrivateBindings, readiness };
  const manifest = selfHash({ schemaVersion: "stage15-source-native-initial-manifest.v1" as const, batchId: input.batchId, batchMode: "source_native_blind_validation_batch" as const, batchRole: "prospective_validation" as const, sampleSize: 20 as const, primarySourceCount: 1 as const, productionEffect: false as const, artifacts: expectedArtifacts(base).map(([name, artifact]) => artifactEntry(name, artifact)), pendingArtifacts: PENDING_ARTIFACTS.map((name) => ({ name, status: "stage_required_pending" as const })) }, "manifestHash");
  const body = { ...base, manifest }; return { ...body, batchHash: stableHash(body) };
}

export function buildStage15SourceNativeBatch(input: BuildStage15SourceNativeBatchInput): Stage15SourceNativeBatch {
  const batch = deriveBatchArtifacts(input);
  assertStage15SourceNativeBatchIntegrity(batch);
  return batch;
}
