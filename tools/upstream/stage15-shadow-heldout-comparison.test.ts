import { describe, expect, it } from "vitest";
import { stableHash } from "../../lib/upstream/pipeline";
import type { Stage15ShadowBatch } from "./stage15-shadow-batch";
import type { Stage15ShadowPolicyCandidate } from "./stage15-shadow-calibration";
import { compareStage15ShadowHeldout } from "./stage15-shadow-heldout-comparison";

function input(mode: "equal" | "better" | "worse" | "hard_gate") {
  const productKeys = Array.from({ length: 20 }, (_, index) => `amazon:US:V0${String(index).padStart(8, "0")}`);
  const missing = { value: null, status: "missing" as const, evidenceRefs: [], capturedAt: null, exactVariant: null, missingReason: "not_collected" };
  const observedRank = (rank: number) => ({ value: { rank, category: "Desk" }, status: "observed" as const, evidenceRefs: ["evidence:rank"], capturedAt: "2026-07-17T06:00:00.000Z", exactVariant: true as const, missingReason: null });
  const observations = productKeys.map((productKey, index) => ({
    schemaVersion: "stage15-shadow-observation.v1" as const, batchId: "batch-v", productKey, evidenceSnapshotId: `e-${index}`,
    marketValidation: { monthlyBought: missing, categoryRank: index >= 5 && index < 10 ? observedRank(index + 1) : missing, rating: missing, reviewCount: missing },
    listingMaturity: { firstAvailableAt: missing, ageDays: missing }, buyerReviews: { positive: missing, negative: missing, sampleCount: missing }, decisionImpact: false as const,
    observationHash: stableHash({ productKey }),
  }));
  const batchBody = { schemaVersion: "stage15-shadow-batch.v1" as const, batchId: "batch-v", role: "validation" as const, readiness: "ready_partial" as const, productKeys, observations, baseline: productKeys.map((productKey, index) => ({ productKey, rank: index + 1, status: mode === "hard_gate" && index === 5 ? "reject" : index < 5 ? "advance" : "watch" })), missingReasons: ["optional_detail_evidence_not_attached"], createdAt: "2026-07-17T06:30:00.000Z" };
  const validationBatch: Stage15ShadowBatch = { ...batchBody, batchHash: stableHash(batchBody) };
  const policyBody = { schemaVersion: "stage15-shadow-policy-candidate.v1" as const, status: "frozen" as const, sourceCalibrationBatchHash: "a".repeat(64), sourceEvaluationHash: "b".repeat(64), createdAt: "2026-07-17T07:00:00.000Z", rules: [{ order: 1 as const, signal: "market_validation" as const, predicate: "category_rank_observed", effect: "shadow_priority" as const }], forbiddenInputs: [], proposalOnly: true as const, productionEffect: false as const };
  const frozenPolicy: Stage15ShadowPolicyCandidate = { ...policyBody, policyHash: stableHash(policyBody) };
  const bindings = productKeys.map((productKey, index) => ({ evaluationItemId: `V-${String(index + 1).padStart(2, "0")}`, productKey }));
  const answers = bindings.map((binding, index) => ({ evaluationItemId: binding.evaluationItemId, worthFurtherInvestigation: (mode === "better" ? index >= 5 && index < 10 : mode === "worse" ? index >= 10 : index < 5) ? "yes" as const : "no" as const }));
  return { validationBatch, frozenPolicy, blindEvaluationResult: { packetHash: "c".repeat(64), completedAt: "2026-07-17T08:00:00.000Z", answers }, bindings, calibrationProductKeys: Array.from({ length: 20 }, (_, index) => `amazon:US:C0${String(index).padStart(8, "0")}`), policyFileSha256: "d".repeat(64), policyFrozenAt: "2026-07-17T07:00:00.000Z", validationPacketFrozenAt: "2026-07-17T06:45:00.000Z", createdAt: "2026-07-17T09:00:00.000Z" };
}

describe("stage15 shadow heldout comparison", () => {
  it.each([
    ["equal", "shadow_policy_not_supported"],
    ["better", "directional_shadow_signal_observed"],
    ["worse", "shadow_policy_not_supported"],
  ] as const)("classifies %s without upgrading formal validity", (mode, conclusion) => {
    const result = compareStage15ShadowHeldout(input(mode));
    expect(result.conclusion).toBe(conclusion);
    expect(result).not.toHaveProperty("screening_effectiveness_validated");
    expect(JSON.stringify(result)).not.toMatch(/weightChange|productionEffect":true/);
    expect(result.metrics.baseline.denominator).toBe(5);
    expect(result.metrics.shadow.denominator).toBe(5);
  });

  it("blocks hard-gate regression", () => {
    const result = compareStage15ShadowHeldout(input("hard_gate"));
    expect(result.conclusion).toBe("blocked");
    expect(result.hardGateRegressionCount).toBeGreaterThan(0);
  });

  it.each(["incomplete", "overlap", "late policy"])("blocks %s", (mode) => {
    const value = input("better");
    if (mode === "incomplete") value.blindEvaluationResult.answers.pop();
    if (mode === "overlap") value.calibrationProductKeys[0] = value.validationBatch.productKeys[0];
    if (mode === "late policy") value.policyFrozenAt = "2026-07-17T08:30:00.000Z";
    expect(compareStage15ShadowHeldout(value).conclusion).toBe("blocked");
  });
});
