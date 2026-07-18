import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  assertStage15ShadowBatchIsolation,
  buildStage15ShadowBatch,
  type Stage15ShadowBatchBuildInput,
} from "./stage15-shadow-batch";
import { buildStage15ShadowObservation, type Stage15ShadowObservationInput } from "./stage15-shadow-calibration";

function fixture(role: "calibration" | "validation", prefix: string): Stage15ShadowBatchBuildInput {
  const batchId = `batch-${role}`;
  const productKeys = Array.from({ length: 20 }, (_, index) => `amazon:US:${prefix}${String(index).padStart(8, "0")}`);
  const missing = { value: null, status: "missing" as const, evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: "not_collected" };
  const observations = productKeys.map((productKey, index) => buildStage15ShadowObservation({
    schemaVersion: "stage15-shadow-observation-input.v1",
    batchId,
    productKey,
    evidenceSnapshotId: `evidence-${prefix}-${index}`,
    marketValidation: { monthlyBought: missing, categoryRank: missing, rating: missing, reviewCount: missing },
    listingMaturity: { firstAvailableAt: missing, ageDays: missing },
    buyerReviews: { positive: missing, negative: missing, sampleCount: missing },
    decisionImpact: false,
  } satisfies Stage15ShadowObservationInput));
  const selectionBrief = { schemaVersion: "selection-brief.v1", briefId: `brief-${role}`, query: role };
  const collectionRun = { schemaVersion: "collection-run.v2", collectionRunId: `run-${role}`, briefId: `brief-${role}`, sampledObservationIds: productKeys };
  const sourceAdapterResult = { schemaVersion: "source-adapter-result.v1", sourceBatchId: `source-${role}`, acceptedCount: 20 };
  const importPackage = { schemaVersion: "import-package.v1", briefId: `brief-${role}`, collectionRunId: `run-${role}`, candidates: productKeys.map((productKey) => ({ productKey })) };
  const rankingRun = { schemaVersion: "ranking-run.v1", briefId: `brief-${role}`, collectionRunId: `run-${role}`, results: productKeys.map((productKey, index) => ({ productKey, rank: index + 1 })) };
  const screeningRun = { schemaVersion: "novice-market-screening-run.v1", items: productKeys.map((productKey, index) => ({ productKey, status: index < 5 ? "advance" : "watch" })) };
  const visualPacket = { schemaVersion: "novice-visual-blind-review-packet.v2", items: productKeys.map((productKey, index) => ({ productKey, blindItemId: `${role}-${index + 1}` })) };
  const artifacts = { selectionBrief, collectionRun, sourceAdapterResult, importPackage, rankingRun, screeningRun, visualPacket, observations };
  return {
    role,
    manifest: {
      schemaVersion: "stage15-shadow-batch-manifest.v1",
      batchId,
      role,
      expectedCount: 20,
      briefId: `brief-${role}`,
      collectionRunId: `run-${role}`,
      sourceBatchId: `source-${role}`,
      artifactHashes: Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, stableHash(value)])),
      fileSha256: Object.fromEntries(Object.keys(artifacts).map((key) => [key, "a".repeat(64)])),
    },
    ...artifacts,
    actualFileSha256: Object.fromEntries(Object.keys(artifacts).map((key) => [key, "a".repeat(64)])),
    detailEvidence: undefined,
    createdAt: "2026-07-17T06:00:00.000Z",
  };
}

describe("stage15 shadow batch", () => {
  it("binds the complete 20-item identity and hash closure", () => {
    const batch = buildStage15ShadowBatch(fixture("calibration", "C0"));
    expect(batch.readiness).toBe("ready_partial");
    expect(batch.productKeys).toHaveLength(20);
    expect(batch.missingReasons).toEqual(["optional_detail_evidence_not_attached"]);
    expect(batch.batchHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts optional detail only as a complete five-artifact group", () => {
    const input = fixture("calibration", "C1");
    input.detailEvidence = [{}, {}, {}, {}, {}];
    const artifacts = { ...input, detailEvidence: input.detailEvidence };
    input.manifest.artifactHashes.detailEvidence = stableHash(input.detailEvidence);
    input.manifest.fileSha256.detailEvidence = "b".repeat(64);
    input.actualFileSha256.detailEvidence = "b".repeat(64);
    expect(buildStage15ShadowBatch(input).readiness).toBe("ready_full");
    void artifacts;
  });

  it.each([
    ["count", (value: Stage15ShadowBatchBuildInput) => value.rankingRun.results.pop()],
    ["identity", (value: Stage15ShadowBatchBuildInput) => { value.visualPacket.items[0].productKey = "amazon:US:CONFLICT00"; }],
    ["canonical hash", (value: Stage15ShadowBatchBuildInput) => { value.manifest.artifactHashes.rankingRun = "f".repeat(64); }],
    ["file hash", (value: Stage15ShadowBatchBuildInput) => { value.actualFileSha256.rankingRun = "f".repeat(64); }],
    ["brief binding", (value: Stage15ShadowBatchBuildInput) => { value.collectionRun.briefId = "other"; }],
  ])("fails closed on %s conflict", (_name, mutate) => {
    const value = fixture("calibration", "C2");
    mutate(value);
    expect(() => buildStage15ShadowBatch(value)).toThrow();
  });

  it("rejects cross-batch identity overlap", () => {
    const calibration = buildStage15ShadowBatch(fixture("calibration", "C3"));
    const validationInput = fixture("validation", "V3");
    validationInput.importPackage.candidates[0].productKey = calibration.productKeys[0];
    validationInput.rankingRun.results[0].productKey = calibration.productKeys[0];
    validationInput.screeningRun.items[0].productKey = calibration.productKeys[0];
    validationInput.visualPacket.items[0].productKey = calibration.productKeys[0];
    validationInput.observations[0] = { ...validationInput.observations[0], productKey: calibration.productKeys[0] };
    for (const key of ["importPackage", "rankingRun", "screeningRun", "visualPacket", "observations"] as const) {
      validationInput.manifest.artifactHashes[key] = stableHash(validationInput[key]);
    }
    const validation = buildStage15ShadowBatch(validationInput);
    expect(() => assertStage15ShadowBatchIsolation(calibration, validation)).toThrow("SHADOW_BATCH_IDENTITY_OVERLAP");
  });
});
