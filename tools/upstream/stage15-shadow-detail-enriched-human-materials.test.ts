import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { generateStage15ShadowPublicUpstream } from "./generate-stage15-shadow-public-upstream";
import { buildStage15ShadowDetailAccessRequest } from "./stage15-shadow-detail-access";
import { buildStage15ShadowDetailEvidencePackage } from "./stage15-shadow-detail-evidence";
import { buildStage15ShadowDetailEnrichedHumanMaterials } from "./stage15-shadow-detail-enriched-human-materials";
import { generateStage15ShadowDetailEnrichedHumanEvaluation } from "./generate-stage15-shadow-detail-enriched-human-evaluation";
import { buildStage15ShadowPolicyCandidate, type ShadowEvidenceValue } from "./stage15-shadow-calibration";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { force: true, recursive: true })));

function entry(index: number) {
  const asin = `B0${String(index).padStart(8, "0")}`;
  return `${index}. #${index} [![Image ${index}: Organizer ${index}](https://images.example.test/${index}.jpg)](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[Organizer ${index}](https://www.amazon.com/item-${index}/dp/${asin}/ref=rank)[_4.7 out of 5 stars_ ${1_000 + index}](https://www.amazon.com/product-reviews/${asin}) [$${10 + index}.99](https://www.amazon.com/item-${index}/dp/${asin})\n`;
}

function observed<T>(value: T, ref: string, capturedAt: string): ShadowEvidenceValue<T> {
  return { value, status: "observed", evidenceRefs: [ref], capturedAt, exactVariant: true, missingReason: null };
}

function missing<T>(reason: string): ShadowEvidenceValue<T> {
  return { value: null, status: "missing", evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: reason };
}

function fixture(reviewCoverage = 10) {
  const root = mkdtempSync(join(tmpdir(), "stage15-detail-materials-"));
  roots.push(root);
  const sourceMarkdown = Array.from({ length: 20 }, (_, index) => entry(index + 1)).join("\n");
  const generated = generateStage15ShadowPublicUpstream({
    role: "calibration",
    batchId: "stage15-shadow-calibration-c-20260717-01",
    manifestId: "manifest-c",
    briefId: "brief-c",
    collectionRunId: "run-c",
    query: "desk organizers",
    category: "Desk Organizers",
    targetScenario: "desk organization",
    targetPriceRange: { min: 8, max: 45 },
    sourceUrl: "https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514",
    sourceMarkdown,
    sourceFileSha256: createHash("sha256").update(sourceMarkdown, "utf8").digest("hex"),
    page: 1,
    capturedAt: "2026-07-17T05:00:00.000Z",
    accessBudget: {
      maxAggregatePageRequests: 1,
      maxDetailPageRequests: 0,
      maxAutomaticRetries: 0,
      maxImageDownloads: 0,
      actualAggregatePageRequests: 1,
      requestedUrls: ["https://www.amazon.com/Best-Sellers/zgbs/office-products/1069514"],
    },
    forbiddenPlatformProductIds: [],
    outputDirectory: root,
  });
  const targets = generated.privateBindings.bindings.map((binding) => ({
    productKey: binding.productKey,
    platformProductId: binding.platformProductId,
    sourceUrl: binding.sourceUrl,
  }));
  const request = buildStage15ShadowDetailAccessRequest({
    schemaVersion: "stage15-shadow-detail-access-request-input.v1",
    batchId: generated.manifest.batchId,
    role: "calibration",
    sourceManifest: { manifestId: generated.manifest.manifestId, manifestHash: generated.manifest.manifestHash, fileSha256: "a".repeat(64) },
    targets,
    proposedBudget: { maxDetailPageRequests: 20, maxRequestsPerProduct: 1, maxAutomaticRetries: 0, maxImageDownloads: 0 },
    createdAt: "2026-07-17T06:30:00.000Z",
  });
  const authorization = {
    schemaVersion: "stage15-shadow-detail-access-authorization.v1" as const,
    batchId: request.batchId,
    requestHash: request.requestHash,
    status: "approved" as const,
    approvedAt: "2026-07-17T07:00:00.000Z",
    approvedBudget: request.proposedBudget,
  };
  const accessLog = targets.map((target) => ({
    productKey: target.productKey,
    sourceUrl: target.sourceUrl,
    attempt: 1,
    outcome: "success" as const,
    requestedAt: "2026-07-17T07:01:00.000Z",
  }));
  const capturedAt = "2026-07-17T07:10:00.000Z";
  const sourceByProduct = new Map(generated.observations.map((observation) => [observation.productKey, observation]));
  const detailItems = targets.map((target, index) => {
    const source = sourceByProduct.get(target.productKey)!;
    const ref = `detail-capture:${index + 1}`;
    const reviews = index < reviewCoverage;
    return {
      productKey: target.productKey,
      evidenceSnapshotId: source.evidenceSnapshotId,
      sourceUrl: target.sourceUrl,
      sourceCapture: {
        relativePath: `detail-captures/${index + 1}.md`,
        fileSha256: String(index + 1).padStart(64, "0"),
        capturedAt,
        accessOutcome: "success" as const,
      },
      dimensions: observed("10 x 5 x 3 inches", ref, capturedAt),
      material: observed(["steel", "plastic"], ref, capturedAt),
      monthlyBought: observed(500 + index, ref, capturedAt),
      firstAvailableAt: observed("2025-01-01T00:00:00.000Z", ref, capturedAt),
      exactVariantRating: observed(4.6, ref, capturedAt),
      exactVariantReviewCount: observed(500 + index, ref, capturedAt),
      exactVariantPositiveReviews: reviews ? observed([`positive ${index + 1}`], ref, capturedAt) : missing<string[]>("not_visible"),
      exactVariantNegativeReviews: reviews ? observed([`negative ${index + 1}`], ref, capturedAt) : missing<string[]>("not_visible"),
      exactVariantReviewSampleCount: reviews ? observed(2, ref, capturedAt) : missing<number>("not_visible"),
    };
  });
  const detailEvidencePackage = buildStage15ShadowDetailEvidencePackage({
    schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
    request,
    authorization,
    accessLog,
    sourceObservations: generated.observations,
    detailItems,
    createdAt: "2026-07-17T07:30:00.000Z",
  });
  return { root, generated, detailEvidencePackage };
}

describe("Stage 1.5 detail-enriched combined human materials", () => {
  it("rebinds an enriched blind packet without exposing identities or changing the source packet", () => {
    const { generated, detailEvidencePackage } = fixture();
    const sourcePacketHash = generated.packet.packetHash;
    const value = buildStage15ShadowDetailEnrichedHumanMaterials({
      sourcePacket: generated.packet,
      sourceBindings: generated.privateBindings,
      detailEvidencePackage,
      createdAt: "2026-07-17T07:31:00.000Z",
    });
    expect(generated.packet.packetHash).toBe(sourcePacketHash);
    expect(value.packet.packetHash).not.toBe(sourcePacketHash);
    expect(value.packet.proofLevel).toBe("real_public_detail_page_exact_variant_evidence");
    expect(value.packet.items).toHaveLength(20);
    expect(value.packet.items[0].sourceEvidence).toMatchObject({
      dimensions: "10 x 5 x 3 inches",
      material: ["steel", "plastic"],
      monthlyBought: expect.any(Number),
      firstAvailableAt: "2025-01-01T00:00:00.000Z",
      exactVariantPositiveReviews: expect.any(Array),
      exactVariantNegativeReviews: expect.any(Array),
    });
    expect(value.bindings.packetHash).toBe(value.packet.packetHash);
    expect(value.resultTemplate.sourcePacketHash).toBe(value.packet.packetHash);
    expect(value.readiness).toMatchObject({ status: "ready_for_human_evaluation", exactVariantReviewCoverage: 10 });
    expect(JSON.stringify(value.packet)).not.toMatch(/amazon:US:|https:\/\/www\.amazon\.com\/dp\/|B0[A-Z0-9]{8}/u);
  });

  it("refuses to regenerate human materials below the frozen 10-item exact-review threshold", () => {
    const { generated, detailEvidencePackage } = fixture(9);
    expect(() => buildStage15ShadowDetailEnrichedHumanMaterials({
      sourcePacket: generated.packet,
      sourceBindings: generated.privateBindings,
      detailEvidencePackage,
      createdAt: "2026-07-17T07:31:00.000Z",
    })).toThrow("SHADOW_DETAIL_ENRICHED_REVIEW_COVERAGE_INSUFFICIENT");
  });

  it("fails closed when detail evidence identities drift from private bindings", () => {
    const { generated, detailEvidencePackage } = fixture();
    const driftedBody = {
      ...detailEvidencePackage,
      packageHash: undefined,
      observations: detailEvidencePackage.observations.map((observation, index) => index === 0
        ? { ...observation, evidenceSnapshotId: "wrong" }
        : observation),
    };
    const { packageHash: _ignored, ...hashableDriftedBody } = driftedBody;
    void _ignored;
    const drifted = {
      ...hashableDriftedBody,
      packageHash: stableHash(hashableDriftedBody),
    };
    expect(() => buildStage15ShadowDetailEnrichedHumanMaterials({
      sourcePacket: generated.packet,
      sourceBindings: generated.privateBindings,
      detailEvidencePackage: drifted,
      createdAt: "2026-07-17T07:31:00.000Z",
    })).toThrow("SHADOW_DETAIL_ENRICHED_IDENTITY_DRIFT");
  });

  it("writes the enriched packet and review-visible workbench into a separate idempotent directory", () => {
    const { root, generated, detailEvidencePackage } = fixture();
    const materials = buildStage15ShadowDetailEnrichedHumanMaterials({
      sourcePacket: generated.packet,
      sourceBindings: generated.privateBindings,
      detailEvidencePackage,
      createdAt: "2026-07-17T07:31:00.000Z",
    });
    const sourcePacketFile = join(root, "stage15-shadow-combined-human-evaluation-packet.v1.json");
    const sourceBefore = createHash("sha256").update(readFileSync(sourcePacketFile)).digest("hex");
    const input = {
      materials,
      sourceManifest: generated.manifest,
      sourceManifestFileSha256: "a".repeat(64),
      sourceBatchDirectory: root,
      createdAt: "2026-07-17T07:32:00.000Z",
    };
    const first = generateStage15ShadowDetailEnrichedHumanEvaluation(input);
    const second = generateStage15ShadowDetailEnrichedHumanEvaluation(input);
    expect(first.outputDirectory).toBe(join(root, "detail-enriched-evaluation-v1"));
    expect(first.artifactWrite.written).toHaveLength(7);
    expect(second.artifactWrite.unchanged).toEqual(first.files);
    expect(first.html).toContain("精确同款好评");
    expect(first.html).toContain("精确同款差评");
    expect(first.summary).toMatchObject({ status: "ready_for_human_evaluation", sourceV1Overwritten: false });
    expect(createHash("sha256").update(readFileSync(sourcePacketFile)).digest("hex")).toBe(sourceBefore);
  });

  it("replays the enriched observations through the existing proposal-only policy threshold", () => {
    const { detailEvidencePackage } = fixture();
    const evaluationBody = {
      answers: detailEvidencePackage.observations.map((_, index) => ({
        evaluationItemId: `C-${String(index + 1).padStart(2, "0")}`,
        worthFurtherInvestigation: index < 10 ? "yes" as const : "no" as const,
      })),
    };
    const policy = buildStage15ShadowPolicyCandidate({
      calibrationBatch: {
        batchHash: stableHash(detailEvidencePackage.observations),
        observations: detailEvidencePackage.observations,
      },
      blindEvaluationResult: {
        resultHash: stableHash(evaluationBody),
        answers: evaluationBody.answers,
      },
      allowedSignalMenu: [{ signal: "buyer_reviews", predicate: "exact_reviews_present", effect: "shadow_priority" }],
      createdAt: "2026-07-17T08:00:00.000Z",
    });
    expect(policy).toMatchObject({ status: "frozen", proposalOnly: true, productionEffect: false });
    expect(policy.rules).toHaveLength(1);
  });
});
