import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import { buildStage15ShadowObservation } from "./stage15-shadow-calibration";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";
import {
  buildStage15ShadowBlindEvaluation,
  validateStage15ShadowBlindEvaluationResult,
} from "./stage15-shadow-blind-evaluation";

function batch(): Stage15ShadowBatch {
  const missing = { value: null, status: "missing" as const, evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: "not_collected" };
  const observations = Array.from({ length: 20 }, (_, index) => buildStage15ShadowObservation({
    schemaVersion: "stage15-shadow-observation-input.v1",
    batchId: "batch-c",
    productKey: `amazon:US:C0${String(index).padStart(8, "0")}`,
    evidenceSnapshotId: `evidence-${index}`,
    marketValidation: { monthlyBought: missing, categoryRank: missing, rating: missing, reviewCount: missing },
    listingMaturity: { firstAvailableAt: missing, ageDays: missing },
    buyerReviews: { positive: missing, negative: missing, sampleCount: missing },
    decisionImpact: false,
  }));
  const body = {
    schemaVersion: "stage15-shadow-batch.v1" as const,
    batchId: "batch-c",
    role: "calibration" as const,
    readiness: "ready_partial" as const,
    productKeys: observations.map((item) => item.productKey).sort(),
    observations,
    baseline: observations.map((item, index) => ({ productKey: item.productKey, rank: index + 1, status: index < 5 ? "advance" : "watch" })),
    missingReasons: ["optional_detail_evidence_not_attached"],
    createdAt: "2026-07-17T06:00:00.000Z",
  };
  return { ...body, batchHash: stableHash(body) };
}

describe("stage15 shadow blind evaluation", () => {
  it("creates 20 stable neutral items without prohibited identity or decision fields", () => {
    const input = batch();
    const material = buildStage15ShadowBlindEvaluation({
      batch: input,
      packetVersion: "stage15-shadow-blind-evaluation-packet.v1",
      presentationByProductKey: Object.fromEntries(input.productKeys.map((key, index) => [key, {
        titleZh: `桌面收纳用品 ${index + 1}`,
        purposeZh: "帮助整理桌面物品",
        image: { status: "not_cached", dataUrl: null, missingReason: "image_not_cached" },
        price: null,
        dimensions: null,
        material: null,
      }])),
      createdAt: "2026-07-17T07:00:00.000Z",
    });
    expect(material.packet.items).toHaveLength(20);
    expect(new Set(material.packet.items.map((item) => item.evaluationItemId)).size).toBe(20);
    expect(material.packet.items.every((item) => item.presentationLabel === "presentation_aid_not_source_fact")).toBe(true);
    const publicJson = JSON.stringify(material.packet);
    expect(publicJson).not.toMatch(/amazon:US:|B0[A-Z0-9]{8}|https?:\/\/|productKey|candidateId|totalScore|promotionDecision|advance|watch/iu);
    expect(material.bindings).toHaveLength(20);
    expect(material.packet.packetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates complete three-state answers and preserves the original reason", () => {
    const input = batch();
    const material = buildStage15ShadowBlindEvaluation({ batch: input, packetVersion: "stage15-shadow-blind-evaluation-packet.v1", presentationByProductKey: Object.fromEntries(input.productKeys.map((key, index) => [key, { titleZh: `对象 ${index}`, purposeZh: "用途辅助", image: { status: "not_cached", dataUrl: null, missingReason: "not_cached" }, price: null, dimensions: null, material: null }])), createdAt: "2026-07-17T07:00:00.000Z" });
    const result = validateStage15ShadowBlindEvaluationResult({
      schemaVersion: "stage15-shadow-blind-evaluation-result.v1",
      packetHash: material.packet.packetHash,
      completedAt: "2026-07-17T08:00:00.000Z",
      answers: material.packet.items.map((item, index) => ({
        evaluationItemId: item.evaluationItemId,
        worthFurtherInvestigation: index % 3 === 0 ? "insufficient_evidence" : "yes",
        evidenceSufficient: index % 3 === 0 ? "no" : "yes",
        dominantSignals: ["market_validation"],
        confidence: "medium",
        reason: `原始理由 ${index}`,
      })),
    }, material.packet);
    expect(result.answers[0].reason).toBe("原始理由 0");
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["wrong packet", "duplicate", "missing", "invalid enum", "empty reason"])("fails closed on %s", (mode) => {
    const input = batch();
    const material = buildStage15ShadowBlindEvaluation({ batch: input, packetVersion: "stage15-shadow-blind-evaluation-packet.v1", presentationByProductKey: Object.fromEntries(input.productKeys.map((key, index) => [key, { titleZh: `对象 ${index}`, purposeZh: "用途辅助", image: { status: "not_cached", dataUrl: null, missingReason: "not_cached" }, price: null, dimensions: null, material: null }])), createdAt: "2026-07-17T07:00:00.000Z" });
    const answers = material.packet.items.map((item) => ({ evaluationItemId: item.evaluationItemId, worthFurtherInvestigation: "yes", evidenceSufficient: "yes", dominantSignals: ["market_validation"], confidence: "medium", reason: "保留原话" })) as Array<Record<string, unknown>>;
    if (mode === "duplicate") answers[1].evaluationItemId = answers[0].evaluationItemId;
    if (mode === "missing") answers.pop();
    if (mode === "invalid enum") answers[0].worthFurtherInvestigation = "maybe";
    if (mode === "empty reason") answers[0].reason = "";
    expect(() => validateStage15ShadowBlindEvaluationResult({ schemaVersion: "stage15-shadow-blind-evaluation-result.v1", packetHash: mode === "wrong packet" ? "f".repeat(64) : material.packet.packetHash, completedAt: "2026-07-17T08:00:00.000Z", answers }, material.packet)).toThrow();
  });
});
