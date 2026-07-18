import { describe, expect, it } from "vitest";
import { buildStage15ShadowObservation, type ShadowEvidenceValue } from "./stage15-shadow-calibration";
import { buildStage15ShadowDetailAccessRequest } from "./stage15-shadow-detail-access";
import { buildStage15ShadowDetailEvidencePackage } from "./stage15-shadow-detail-evidence";

const capturedAt = "2026-07-17T07:10:00.000Z";

function observed<T>(value: T, ref: string): ShadowEvidenceValue<T> {
  return { value, status: "observed", evidenceRefs: [ref], capturedAt, exactVariant: true, missingReason: null };
}

function missing<T>(reason: string): ShadowEvidenceValue<T> {
  return { value: null, status: "missing", evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: reason };
}

function setup() {
  const targets = Array.from({ length: 20 }, (_, index) => {
    const platformProductId = `B0${String(index + 1).padStart(8, "0")}`;
    return {
      productKey: `amazon:US:${platformProductId}`,
      platformProductId,
      sourceUrl: `https://www.amazon.com/example-${index + 1}/dp/${platformProductId}`,
    };
  });
  const request = buildStage15ShadowDetailAccessRequest({
    schemaVersion: "stage15-shadow-detail-access-request-input.v1",
    batchId: "stage15-shadow-calibration-c-20260717-01",
    role: "calibration",
    sourceManifest: { manifestId: "manifest-c", manifestHash: "a".repeat(64), fileSha256: "b".repeat(64) },
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
  const sourceObservations = targets.map((target, index) => buildStage15ShadowObservation({
    schemaVersion: "stage15-shadow-observation-input.v1",
    batchId: request.batchId,
    productKey: target.productKey,
    evidenceSnapshotId: `evidence-${index + 1}`,
    marketValidation: {
      monthlyBought: missing("not_collected"),
      categoryRank: observed({ rank: index + 1, category: "Desk Organizers" }, `category:${index + 1}`),
      rating: observed(4.5, `category:${index + 1}`),
      reviewCount: observed(100 + index, `category:${index + 1}`),
    },
    listingMaturity: { firstAvailableAt: missing("not_collected"), ageDays: missing("not_collected") },
    buyerReviews: {
      positive: missing("not_collected"),
      negative: missing("not_collected"),
      sampleCount: missing("not_collected"),
    },
    decisionImpact: false,
  }));
  const detailItems = targets.map((target, index) => {
    const ref = `detail-capture:${index + 1}`;
    const hasReviews = index < 10;
    return {
      productKey: target.productKey,
      evidenceSnapshotId: `evidence-${index + 1}`,
      sourceUrl: target.sourceUrl,
      sourceCapture: {
        relativePath: `detail-captures/${index + 1}.md`,
        fileSha256: String(index + 1).padStart(64, "0"),
        capturedAt,
        accessOutcome: "success" as const,
      },
      dimensions: observed("10 x 5 x 3 inches", ref),
      material: observed(["steel", "plastic"], ref),
      monthlyBought: observed(500 + index, ref),
      firstAvailableAt: observed("2025-01-01T00:00:00.000Z", ref),
      exactVariantRating: observed(4.6, ref),
      exactVariantReviewCount: observed(500 + index, ref),
      exactVariantPositiveReviews: hasReviews ? observed([`positive ${index + 1}`], ref) : missing<string[]>("exact_variant_review_snippets_not_visible"),
      exactVariantNegativeReviews: hasReviews ? observed([`negative ${index + 1}`], ref) : missing<string[]>("exact_variant_review_snippets_not_visible"),
      exactVariantReviewSampleCount: hasReviews ? observed(2, ref) : missing<number>("exact_variant_review_snippets_not_visible"),
    };
  });
  return { request, authorization, accessLog, sourceObservations, detailItems };
}

describe("Stage 1.5 shadow detail evidence package", () => {
  it("builds deterministic enriched observations and reports policy-eligible exact-variant coverage", () => {
    const input = setup();
    const value = buildStage15ShadowDetailEvidencePackage({
      ...input,
      schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
      createdAt: "2026-07-17T07:30:00.000Z",
    });
    expect(value.coverage).toEqual({
      detailPagesAttempted: 20,
      detailPagesSucceeded: 20,
      dimensionsObserved: 20,
      materialObserved: 20,
      exactVariantReviewPolicyEligible: 10,
      completeExactVariantReviewEvidence: 10,
    });
    expect(value.observations).toHaveLength(20);
    expect(value.observations[0].marketValidation.rating).toMatchObject({ status: "observed", exactVariant: true, value: 4.6 });
    expect(value.observations[0].listingMaturity.ageDays).toMatchObject({ status: "observed", exactVariant: true });
    expect(value.boundary).toMatchObject({ decisionImpact: false, databaseWritten: false, productionEffect: false });
    expect(value.packageHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(buildStage15ShadowDetailEvidencePackage({
      ...input,
      schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
      createdAt: "2026-07-17T07:30:00.000Z",
    })).toEqual(value);
  });

  it("fails closed on identity drift or evidence that is not exact-variant and source-bound", () => {
    const input = setup();
    expect(() => buildStage15ShadowDetailEvidencePackage({
      ...input,
      schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
      detailItems: input.detailItems.map((item, index) => index === 0 ? { ...item, evidenceSnapshotId: "wrong" } : item),
      createdAt: "2026-07-17T07:30:00.000Z",
    })).toThrow("SHADOW_DETAIL_EVIDENCE_IDENTITY_DRIFT");
    expect(() => buildStage15ShadowDetailEvidencePackage({
      ...input,
      schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
      detailItems: input.detailItems.map((item, index) => index === 0
        ? { ...item, exactVariantReviewSampleCount: { ...item.exactVariantReviewSampleCount, exactVariant: false } }
        : item),
      createdAt: "2026-07-17T07:30:00.000Z",
    })).toThrow("SHADOW_DETAIL_EVIDENCE_EXACT_VARIANT_REQUIRED");
  });

  it("requires stopped pages to contain only explicit missing evidence", () => {
    const input = setup();
    const stoppedItem = {
      ...input.detailItems[0],
      sourceCapture: { ...input.detailItems[0].sourceCapture, accessOutcome: "captcha" as const },
    };
    const accessLog = input.accessLog.map((entry, index) => index === 0 ? { ...entry, outcome: "captcha" as const } : entry);
    expect(() => buildStage15ShadowDetailEvidencePackage({
      ...input,
      accessLog,
      detailItems: [stoppedItem, ...input.detailItems.slice(1)],
      schemaVersion: "stage15-shadow-detail-evidence-package-input.v1",
      createdAt: "2026-07-17T07:30:00.000Z",
    })).toThrow("SHADOW_DETAIL_STOPPED_PAGE_HAS_OBSERVED_EVIDENCE");
  });
});
