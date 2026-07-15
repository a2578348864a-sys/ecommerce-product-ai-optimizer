import { describe, expect, it } from "vitest";
import type { RankingRun, Stage1Result } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import { calibrateStage2 } from "../../lib/upstream/ranking";
import {
  buildNoviceBlindReviewPacket,
  buildNoviceVisualBlindReviewPacket,
  buildSoloStage2CalibrationPacket,
  buildStage2EvidenceGapInventory,
  type BlindReviewMaterialInput,
  type NoviceVisualPresentationInput,
} from "./solo-validation-materials";

function result(index: number, tier: Stage1Result["recommendationTier"]): Stage1Result {
  const insufficient = tier === "not_ranked";
  return {
    schemaVersion: "stage1-result.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    productKey: `amazon:US:ASIN${index}`,
    candidateId: `candidate-${index}`,
    variantGroupKey: `amazon:US:ASIN${index}`,
    inputEvidenceHash: `evidence-hash-${index}`,
    rank: insufficient ? null : index,
    totalScore: insufficient ? null : 100 - index,
    componentScores: { priceFit: 25 },
    hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
    supportingEvidence: ["页面证据"],
    counterEvidence: [],
    missingEvidence: insufficient ? ["rating"] : [],
    confidence: insufficient ? "low" : "high",
    promotionDecision: insufficient ? "insufficient_evidence" : tier === "low" ? "rejected" : "promoted",
    recommendationTier: tier,
    nextValidationPlan: ["补充客观证据"],
    killCriteria: ["关键证据无法验证"],
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function fixtures() {
  const tiers: Stage1Result["recommendationTier"][] = [
    "high", "high", "high", "medium", "medium", "medium", "low", "low", "low", "not_ranked",
  ];
  const ranking: RankingRun = {
    schemaVersion: "ranking-run.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    briefId: "brief-test",
    collectionRunId: "run-test",
    inputHash: "ranking-input-hash",
    createdAt: "2026-07-14T00:00:00.000Z",
    results: tiers.map((tier, index) => result(index + 1, tier)),
  };
  const blindReview: BlindReviewMaterialInput = {
    schemaVersion: "blind-review-material.v1",
    blindReviewId: "blind-test",
    criteria: ["是否值得继续调查"],
    items: ranking.results.map((item, index) => ({
      blindItemId: `blind-test-${String(index + 1).padStart(2, "0")}`,
      candidateId: item.candidateId,
      evidenceSnapshotId: `evidence-${index + 1}`,
      title: `测试商品 ${index + 1}`,
      sourceUrl: `https://www.amazon.com/dp/ASIN${index + 1}`,
      capturedAt: "2026-07-14T00:00:00.000Z",
      evidence: {
        price: 20 + index,
        rating: index === 9 ? null : 4.5,
        reviewCount: index === 9 ? null : 100,
        missingEvidence: index === 9 ? ["rating", "review_count"] : [],
      },
    })),
  };
  return { ranking, blindReview };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([key, child]) => {
      keys.add(key);
      collectKeys(child, keys);
    });
  }
  return keys;
}

function rehashStage2Packet<T extends { packetHash: string }>(packet: T): T {
  const { packetHash: _packetHash, ...body } = packet;
  return { ...body, packetHash: stableHash(body) } as T;
}

function visualPresentation(blindReview: BlindReviewMaterialInput): NoviceVisualPresentationInput {
  return {
    schemaVersion: "solo-novice-visual-presentation-input.v1",
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceVisualEvidenceHash: "captured-source-evidence-hash",
    items: blindReview.items.map((item, index) => ({
      blindItemId: item.blindItemId,
      image: {
        imageUrl: `https://m.media-amazon.com/images/I/example-${index + 1}.jpg`,
        sourceType: "direct_observation",
        capturedAt: item.capturedAt,
        missingReason: null,
        localAsset: index === 0
          ? {
            status: "available",
            relativePath: "01-新手盲评-先填写/商品图/blind-item-01.jpg",
            contentSha256: "a".repeat(64),
            bytes: 1234,
            missingReason: null,
          }
          : {
            status: "not_cached",
            relativePath: null,
            contentSha256: null,
            bytes: null,
            missingReason: "not_cached_offline_no_external_access",
          },
      },
      chinesePresentation: {
        productTypeZh: `测试收纳商品 ${index + 1}`,
        primaryUseZh: "用于整理衣物和日常杂物。",
        sourceType: "ai_generated",
        status: "presentation_aid_not_source_fact",
        basedOnFields: ["title"],
      },
    })),
  };
}

describe("solo Stage 1 validation materials", () => {
  it("builds a novice packet without system ranking or internal identity fields", () => {
    const { blindReview } = fixtures();
    const packet = buildNoviceBlindReviewPacket(blindReview);

    expect(packet.items).toHaveLength(10);
    expect(packet.items.every((item) => Object.values(item.response).every((value) => value === null))).toBe(true);
    expect(packet.reviewState).toBe("pending_user_input");
    expect(packet.items.map((item) => item.blindItemId)).toEqual(blindReview.items.map((item) => item.blindItemId));
    const keys = collectKeys(packet);
    ["candidateId", "evidenceSnapshotId", "rank", "totalScore", "promotionDecision", "recommendationTier", "componentScores"]
      .forEach((key) => expect(keys.has(key)).toBe(false));
  });

  it("builds a separate visual novice packet with provenance and explicit visual completeness", () => {
    const { blindReview } = fixtures();
    const packet = buildNoviceVisualBlindReviewPacket(blindReview, visualPresentation(blindReview));

    expect(packet.schemaVersion).toBe("solo-novice-visual-blind-review-packet.v2");
    expect(packet.items).toHaveLength(10);
    expect(packet.visualSummary).toEqual({
      totalItemCount: 10,
      localImageAvailableCount: 1,
      localImageCompleteness: 0.1,
      reviewReadiness: "incomplete_visual_evidence",
    });
    expect(packet.items[0].image.sourceType).toBe("direct_observation");
    expect(packet.items[0].chinesePresentation).toMatchObject({
      sourceType: "ai_generated",
      status: "presentation_aid_not_source_fact",
    });
    expect(packet.items.every((item) => Object.values(item.response).every((value) => value === null))).toBe(true);
    const keys = collectKeys(packet);
    ["candidateId", "evidenceSnapshotId", "rank", "totalScore", "promotionDecision", "recommendationTier", "componentScores"]
      .forEach((key) => expect(keys.has(key)).toBe(false));
  });

  it("changes the visual packet hash when any image, Chinese use, source URL or local asset hash changes", () => {
    const { blindReview } = fixtures();
    const baselinePresentation = visualPresentation(blindReview);
    const baseline = buildNoviceVisualBlindReviewPacket(blindReview, baselinePresentation).packetHash;

    const mutateAndHash = (mutate: (input: NoviceVisualPresentationInput, blind: BlindReviewMaterialInput) => void) => {
      const nextBlind = structuredClone(blindReview);
      const nextPresentation = structuredClone(baselinePresentation);
      mutate(nextPresentation, nextBlind);
      return buildNoviceVisualBlindReviewPacket(nextBlind, nextPresentation).packetHash;
    };

    expect(mutateAndHash((input) => { input.items[0].image.imageUrl = "https://m.media-amazon.com/images/I/changed.jpg"; })).not.toBe(baseline);
    expect(mutateAndHash((input) => { input.items[0].chinesePresentation.primaryUseZh = "改为收纳鞋子。"; })).not.toBe(baseline);
    expect(mutateAndHash((_input, blind) => { blind.items[0].sourceUrl = "https://www.amazon.com/dp/CHANGED"; })).not.toBe(baseline);
    expect(mutateAndHash((input) => { input.items[0].image.localAsset.contentSha256 = "b".repeat(64); })).not.toBe(baseline);
  });

  it("fails closed when visual presentation items are missing, duplicated or unknown", () => {
    const { blindReview } = fixtures();

    const missing = visualPresentation(blindReview);
    missing.items.pop();
    expect(() => buildNoviceVisualBlindReviewPacket(blindReview, missing)).toThrow("VISUAL_PRESENTATION_ITEM_MISMATCH");

    const duplicated = visualPresentation(blindReview);
    duplicated.items[1].blindItemId = duplicated.items[0].blindItemId;
    expect(() => buildNoviceVisualBlindReviewPacket(blindReview, duplicated)).toThrow("VISUAL_PRESENTATION_ITEM_MISMATCH");

    const unknown = visualPresentation(blindReview);
    unknown.items[0].blindItemId = "blind-unknown";
    expect(() => buildNoviceVisualBlindReviewPacket(blindReview, unknown)).toThrow("VISUAL_PRESENTATION_ITEM_MISMATCH");
  });

  it("keeps the legacy V1 packet free of visual presentation fields", () => {
    const { blindReview } = fixtures();
    const packet = buildNoviceBlindReviewPacket(blindReview);

    expect(packet.schemaVersion).toBe("solo-novice-blind-review-packet.v1");
    expect(collectKeys(packet).has("image")).toBe(false);
    expect(collectKeys(packet).has("chinesePresentation")).toBe(false);
  });

  it("selects two high, two medium, two low and one insufficient sample deterministically", () => {
    const { ranking, blindReview } = fixtures();
    const first = buildSoloStage2CalibrationPacket(ranking, blindReview);
    const second = buildSoloStage2CalibrationPacket(ranking, blindReview);

    expect(second).toEqual(first);
    expect(first.selectionCounts).toEqual({ high: 2, medium: 2, low: 2, insufficient_evidence: 1 });
    expect(first.samples).toHaveLength(7);
    expect(first.samples.map((sample) => sample.sampleId)).toEqual([
      "stage2-high-01", "stage2-high-02", "stage2-medium-01", "stage2-medium-02",
      "stage2-low-01", "stage2-low-02", "stage2-insufficient-evidence-01",
    ]);
  });

  it("keeps every initial Stage 2 profit result fail-closed while commercial inputs are missing", () => {
    const { ranking, blindReview } = fixtures();
    const packet = buildSoloStage2CalibrationPacket(ranking, blindReview);

    expect(packet.status).toBe("pending_evidence");
    expect(packet.samples.every((sample) => sample.calibration.status === "profit_insufficient_evidence")).toBe(true);
    expect(packet.samples.every((sample) => sample.calibration.normalContributionMargin === null
      && sample.calibration.stressContributionMargin === null
      && sample.calibration.breakEvenAcos === null)).toBe(true);
    expect(packet.samples.every((sample) => sample.evidenceInputs.bom === null
      && sample.evidenceInputs.supplierUrl === null
      && sample.evidenceInputs.packageWeightKg === null)).toBe(true);
  });

  it("builds a deterministic Stage 2 evidence gap inventory without inventing values", () => {
    const { ranking, blindReview } = fixtures();
    const source = buildSoloStage2CalibrationPacket(ranking, blindReview);
    const first = buildStage2EvidenceGapInventory(source);
    const second = buildStage2EvidenceGapInventory(source);

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe("solo-stage2-evidence-gap-inventory.v1");
    expect(first.status).toBe("evidence_collection_required");
    expect(first.summary).toEqual({
      sampleCount: 7,
      samplesBlockedForProfit: 7,
      missingEvidenceFieldCount: 119,
      pendingHumanDecisionFieldCount: 14,
      readyForProfitCalculationCount: 0,
    });
    expect(first.samples.every((sample) => sample.currentProfitStatus === "profit_insufficient_evidence")).toBe(true);
    expect(first.samples.every((sample) => sample.evidenceGaps.length === 17)).toBe(true);
    expect(first.samples.flatMap((sample) => sample.evidenceGaps)
      .every((gap) => gap.currentValue === null && gap.status === "missing" && gap.sourceRequired)).toBe(true);
    expect(first.samples.every((sample) => sample.gates.readyForProfitCalculation === false
      && sample.gates.readyForHumanDecision === false)).toBe(true);
  });

  it("separates evidence gaps from pending human decision fields", () => {
    const { ranking, blindReview } = fixtures();
    const inventory = buildStage2EvidenceGapInventory(buildSoloStage2CalibrationPacket(ranking, blindReview));
    const first = inventory.samples[0];

    expect(first.evidenceGaps.map((gap) => gap.field)).toEqual([
      "supplierUrl", "supplierCapturedAt", "moq", "bom",
      "packageLengthCm", "packageWidthCm", "packageHeightCm", "packageWeightKg",
      "firstMile", "logisticsEvidenceUrl", "platformCommission", "fba", "packaging", "storage",
      "returnReserve", "complianceEvidenceUrl", "executionRiskNotes",
    ]);
    expect(first.pendingHumanDecision).toEqual({
      humanContinueDecision: { status: "pending_user_input", currentValue: null },
      humanDecisionReason: { status: "pending_user_input", currentValue: null },
    });
  });

  it("keeps the gap inventory blocked when commercial fields are filled but source sale price is missing", () => {
    const { ranking, blindReview } = fixtures();
    const source = buildSoloStage2CalibrationPacket(ranking, blindReview);
    const changed = structuredClone(source);
    const sample = changed.samples[0];
    Object.assign(sample.evidenceInputs as unknown as Record<string, unknown>, {
      supplierUrl: "https://example.com/supplier/item",
      supplierCapturedAt: "2026-07-15T00:00:00.000Z",
      moq: 100,
      bom: 4,
      firstMile: 1,
      platformCommission: 2,
      fba: 3,
      packaging: 0.5,
      storage: 0.25,
      returnReserve: 0.75,
      packageLengthCm: 30,
      packageWidthCm: 20,
      packageHeightCm: 10,
      packageWeightKg: 1,
      logisticsEvidenceUrl: "https://example.com/logistics/quote",
      complianceEvidenceUrl: "https://example.com/compliance/rule",
      executionRiskNotes: "fixture evidence",
    });
    sample.sourceEvidence.salePrice = null;
    sample.calibration = calibrateStage2({
      candidateId: sample.candidateId,
      currency: "USD",
      salePrice: null,
      bom: 4,
      firstMile: 1,
      platformCommission: 2,
      fba: 3,
      packaging: 0.5,
      storage: 0.25,
      returnReserve: 0.75,
    });

    const inventory = buildStage2EvidenceGapInventory(rehashStage2Packet(changed));

    expect(inventory.samples[0].evidenceGaps).toHaveLength(0);
    expect(inventory.samples[0].gates.readyForHumanDecision).toBe(false);
    expect(inventory.samples[0].gates.blockingReasonCodes).toContain("missing_salePrice");
    expect(inventory.status).toBe("evidence_collection_required");
  });

  it("binds the Stage 2 gap inventory hash to the source packet and observed evidence", () => {
    const { ranking, blindReview } = fixtures();
    const source = buildSoloStage2CalibrationPacket(ranking, blindReview);
    const baseline = buildStage2EvidenceGapInventory(source);
    const changed = structuredClone(source);
    changed.samples[0].sourceEvidence.salePrice = 999;
    const rehashed = rehashStage2Packet(changed);

    expect(buildStage2EvidenceGapInventory(rehashed).packetHash).not.toBe(baseline.packetHash);
  });

  it("fails closed for a duplicate sample or inconsistent profit missing-input evidence", () => {
    const { ranking, blindReview } = fixtures();
    const source = buildSoloStage2CalibrationPacket(ranking, blindReview);
    const duplicate = structuredClone(source);
    duplicate.samples[1].sampleId = duplicate.samples[0].sampleId;
    expect(() => buildStage2EvidenceGapInventory(rehashStage2Packet(duplicate)))
      .toThrow("STAGE2_GAP_SOURCE_SAMPLE_MISMATCH");

    const inconsistent = structuredClone(source);
    inconsistent.samples[0].calibration.missingInputs = inconsistent.samples[0].calibration.missingInputs
      .filter((field) => field !== "bom");
    expect(() => buildStage2EvidenceGapInventory(rehashStage2Packet(inconsistent)))
      .toThrow("STAGE2_GAP_SOURCE_CALIBRATION_MISMATCH");
  });

  it("rejects a ranking whose candidates cannot be mapped to the frozen blind evidence", () => {
    const { ranking, blindReview } = fixtures();
    blindReview.items = blindReview.items.slice(1);

    expect(() => buildSoloStage2CalibrationPacket(ranking, blindReview)).toThrow("BLIND_REVIEW_CANDIDATE_MISMATCH");
  });
});
