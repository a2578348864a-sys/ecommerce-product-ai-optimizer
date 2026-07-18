import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { AltReviewCapture } from "./stage15-shadow-alt-review-contract";
import { buildStage15ShadowAltReviewEvidencePackage } from "./stage15-shadow-alt-review-evidence";
import {
  captureWithReviews,
  eligibleCapture,
  identityConflictCapture,
  inputWithCaptures,
  inputWithSingleTerminalCapture,
  mixedVariantCapture,
  negativeReview,
  positiveReview,
  secondPositiveReview,
} from "./stage15-shadow-alt-review-test-fixtures";

function rehash(body: Omit<AltReviewCapture, "captureHash">): AltReviewCapture {
  return { ...body, captureHash: stableHash(body) };
}

describe("Stage 1.5 alternative review Evidence", () => {
  it("counts only exact products with two dated, rated, positive and negative reviews", () => {
    const result = buildStage15ShadowAltReviewEvidencePackage(inputWithCaptures([
      eligibleCapture("amazon:US:B0D7Q1DWPF"),
      eligibleCapture("amazon:US:B0044UP39U"),
      identityConflictCapture(),
    ]));

    expect(result.items.map((item) => item.outcome)).toEqual([
      "probe_product_eligible",
      "probe_product_eligible",
      "blocked_identity_conflict",
    ]);
    expect(result.readiness).toMatchObject({
      status: "probe_passed_pending_full_budget",
      eligibleProducts: 2,
      terminalProducts: 3,
      executionAllowed: false,
      humanEvaluationAllowed: false,
      batchVUnlocked: false,
      policyCandidateGenerated: false,
      databaseWritten: false,
      productionEffect: false,
    });
  });

  it.each([
    ["one review", captureWithReviews([positiveReview()]), "review_evidence_incomplete"],
    ["only positive", captureWithReviews([positiveReview(), secondPositiveReview()]), "review_evidence_incomplete"],
    ["mixed variant", mixedVariantCapture(), "mixed_variant_missing"],
    ["identity conflict", identityConflictCapture(), "blocked_identity_conflict"],
  ])("maps %s deterministically", (_label, capture, expected) => {
    const result = buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].outcome).toBe(expected);
    expect(result.readiness.status).toBe("probe_in_progress");
  });

  it("fails closed on capture Hash drift", () => {
    const capture = eligibleCapture("amazon:US:B0D7Q1DWPF");
    capture.reviews = [positiveReview(), negativeReview()];
    capture.reviews[0].theme = "tampered without rehash";

    expect(() => buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture)))
      .toThrow("SHADOW_ALT_REVIEW_CAPTURE_HASH_DRIFT");
  });

  it("requires a successful logged URL for every capture", () => {
    const { captureHash: _captureHash, ...body } = eligibleCapture("amazon:US:B0D7Q1DWPF");
    const capture = rehash({
      ...body,
      sourceUrl: "https://retailer-a.example.test/product/B0D7Q1DWPF/not-opened",
    });

    expect(() => buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture)))
      .toThrow("SHADOW_ALT_REVIEW_CAPTURE_URL_NOT_LOGGED");
  });

  it("rejects personal reviewer fields even when the capture Hash is internally consistent", () => {
    const { captureHash: _captureHash, ...body } = eligibleCapture("amazon:US:B0D7Q1DWPF");
    const reviews = body.reviews.map((review, index) => index === 0
      ? { ...review, reviewerName: "must-not-be-stored" }
      : review) as AltReviewCapture["reviews"];
    const capture = rehash({ ...body, reviews });

    expect(() => buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture)))
      .toThrow("SHADOW_ALT_REVIEW_PRIVACY_FIELD_FORBIDDEN");
  });

  it("rejects an unknown stable identifier kind from parsed JSON", () => {
    const { captureHash: _captureHash, ...body } = eligibleCapture("amazon:US:B0D7Q1DWPF");
    const identityBinding = {
      ...body.identityBinding,
      stableIdentifiers: [{ kind: "sku", value: "not-approved" }],
    } as unknown as AltReviewCapture["identityBinding"];
    const capture = rehash({ ...body, identityBinding });

    expect(() => buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture)))
      .toThrow("SHADOW_ALT_REVIEW_IDENTITY_EVIDENCE_INVALID");
  });

  it("rejects an unknown review sentiment from parsed JSON", () => {
    const { captureHash: _captureHash, ...body } = eligibleCapture("amazon:US:B0D7Q1DWPF");
    const reviews = body.reviews.map((review, index) => index === 0
      ? { ...review, sentiment: "neutral" }
      : review) as unknown as AltReviewCapture["reviews"];
    const capture = rehash({ ...body, reviews });

    expect(() => buildStage15ShadowAltReviewEvidencePackage(inputWithSingleTerminalCapture(capture)))
      .toThrow("SHADOW_ALT_REVIEW_REVIEW_EVIDENCE_INVALID");
  });
});
