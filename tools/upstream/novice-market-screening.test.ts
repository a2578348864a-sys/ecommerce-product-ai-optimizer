import { describe, expect, it } from "vitest";
import type { RankingRun, Stage1Result } from "../../lib/upstream/contracts";
import { stableHash } from "../../lib/upstream/pipeline";
import {
  buildNoviceMarketScreeningAcceptance,
  buildNoviceMarketScreeningRun,
  type NoviceBlindAnswer,
  type NoviceMarketScreeningInput,
} from "./novice-market-screening";

const YES_ANSWER: NoviceBlindAnswer = {
  blindItemId: "blind-01",
  productUnderstood: "yes",
  evidenceSufficient: "yes",
  obviousConcern: "no",
  investigateNext10Minutes: "yes",
  confidence: "medium",
  elapsedSeconds: 30,
  note: "仅用于测试",
};

function result(index: number, overrides: Partial<Stage1Result> = {}): Stage1Result {
  const productKey = `amazon:US:ASIN${String(index).padStart(2, "0")}`;
  return {
    schemaVersion: "stage1-result.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    productKey,
    candidateId: `candidate-${index}`,
    variantGroupKey: productKey,
    inputEvidenceHash: `evidence-hash-${index}`,
    rank: index,
    totalScore: 100 - index,
    componentScores: { priceFit: 25, ratingSignal: 25, reviewSignal: 25, placementDiversity: 25 },
    hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
    supportingEvidence: ["页面市场信号"],
    counterEvidence: [],
    missingEvidence: [],
    confidence: "high",
    promotionDecision: "promoted",
    recommendationTier: "high",
    nextValidationPlan: ["继续调查"],
    killCriteria: ["证据无法复核"],
    createdAt: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function input(count = 6): NoviceMarketScreeningInput {
  const results = Array.from({ length: count }, (_, index) => result(index + 1));
  const ranking: RankingRun = {
    schemaVersion: "ranking-run.v1",
    rankingRunId: "ranking-test",
    rankingRuleVersion: "stage1-deterministic-v1.1",
    briefId: "brief-test",
    collectionRunId: "run-test",
    inputHash: "package-hash-test",
    createdAt: "2026-07-15T12:00:00.000Z",
    results,
  };
  const blindReview = {
    schemaVersion: "blind-review-material.v1" as const,
    blindReviewId: "blind",
    criteria: ["是否值得进一步调查"],
    items: results.map((item, index) => ({
      blindItemId: `blind-${String(index + 1).padStart(2, "0")}`,
      candidateId: item.candidateId,
      evidenceSnapshotId: `snapshot-${index + 1}`,
      title: `商品 ${index + 1}`,
      sourceUrl: `https://www.amazon.com/dp/ASIN${String(index + 1).padStart(2, "0")}`,
      capturedAt: "2026-07-15T12:00:00.000Z",
      evidence: { price: 20, rating: 4.5, reviewCount: 100, missingEvidence: [] },
    })),
  };
  const novicePacketBody = {
    schemaVersion: "solo-novice-blind-review-packet.v1" as const,
    sourceBlindReviewId: blindReview.blindReviewId,
    sourceEvidenceHash: stableHash(blindReview),
    purpose: "测试",
    boundary: { validates: ["investigation_willingness"], doesNotValidate: ["profitability"] },
    questions: ["是否理解"],
    allowedAnswers: { ternary: ["yes", "no", "uncertain"], confidence: ["high", "medium", "low"] },
    reviewState: "pending_user_input" as const,
    items: blindReview.items.map((item) => ({
      blindItemId: item.blindItemId,
      title: item.title,
      sourceUrl: item.sourceUrl,
      capturedAt: item.capturedAt,
      evidence: item.evidence,
      response: {
        productUnderstood: null,
        evidenceSufficient: null,
        obviousConcern: null,
        investigateNext10Minutes: null,
        confidence: null,
        elapsedSeconds: null,
        note: null,
      },
    })),
  };
  const novicePacket = { ...novicePacketBody, packetHash: stableHash(novicePacketBody) };
  return {
    ranking,
    marketEvidence: {
      schemaVersion: "novice-screening-market-evidence.v1",
      sourceBatchId: "source-batch-test",
      qualityGates: {
        source: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
        context: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
        layout: { schemaVersion: "quality-gate-result.v1", status: "passed", errorCodes: [], missingReasons: [] },
      },
      candidates: results.map((item, index) => ({
        candidateId: item.candidateId,
        productKey: item.productKey,
        evidenceSnapshotId: `snapshot-${index + 1}`,
        inputEvidenceHash: item.inputEvidenceHash,
        minimumEvidencePack: {
          schemaVersion: "minimum-evidence-pack.v1",
          complete: true,
          missingEvidence: [],
        },
      })),
    },
    blindReview,
    novicePacket,
    responses: {
      schemaVersion: "solo-novice-blind-review-responses.v1",
      sourcePacketHash: novicePacket.packetHash,
      status: "completed",
      answers: results.map((_, index) => ({
        ...YES_ANSWER,
        blindItemId: `blind-${String(index + 1).padStart(2, "0")}`,
      })),
    },
    createdAt: "2026-07-15T12:00:00.000Z",
  };
}

describe("Stage 1.5 novice market screening", () => {
  it("uses market Quality Gates, Minimum Evidence and product binding for screeningEvidenceSufficient", () => {
    const value = input(4);
    value.marketEvidence.candidates[0].minimumEvidencePack.complete = false;
    value.marketEvidence.candidates[0].minimumEvidencePack.missingEvidence = ["rating"];
    value.marketEvidence.candidates[1].inputEvidenceHash = "mismatched";
    value.marketEvidence.qualityGates.context.status = "failed";
    value.marketEvidence.qualityGates.context.errorCodes = ["market_unknown"];

    const run = buildNoviceMarketScreeningRun(value);

    expect(run.items.every((item) => item.screeningEvidenceSufficient === false)).toBe(true);
    expect(run.items.every((item) => item.status === "insufficient")).toBe(true);
    expect(run.items[0].marketEvidenceReasons).toContain("minimum_evidence_incomplete");
    expect(run.items[1].marketEvidenceReasons).toContain("product_binding_invalid");
    expect(run.items[2].marketEvidenceReasons).toContain("quality_gate_context_failed");
  });

  it("keeps raw human answers and derives fail-closed booleans without using novice evidenceSufficient as a gate", () => {
    const value = input(4);
    value.responses.answers[0] = { ...value.responses.answers[0], evidenceSufficient: "no" };
    value.responses.answers[1] = { ...value.responses.answers[1], productUnderstood: "uncertain" };
    value.responses.answers[2] = { ...value.responses.answers[2], investigateNext10Minutes: "no" };
    value.responses.answers.splice(3, 1);

    const run = buildNoviceMarketScreeningRun(value);

    expect(run.items[0]).toMatchObject({
      rawHumanAnswer: { evidenceSufficient: "no" },
      userUnderstandsProduct: true,
      willingToContinueResearch: true,
      status: "advance",
    });
    expect(run.items[1]).toMatchObject({ userUnderstandsProduct: false, status: "watch" });
    expect(run.items[2]).toMatchObject({ willingToContinueResearch: false, status: "watch" });
    expect(run.items[3]).toMatchObject({
      rawHumanAnswer: {
        productUnderstood: "missing",
        evidenceSufficient: "missing",
        investigateNext10Minutes: "missing",
      },
      userUnderstandsProduct: false,
      willingToContinueResearch: false,
      status: "watch",
    });
  });

  it("applies evidence insufficiency before Hard Gate and Stage 1 rejection", () => {
    const value = input(3);
    value.ranking.results[0].hardGateResult = {
      schemaVersion: "hard-gate-result.v1", passed: false, errorCodes: ["regulated_product"],
    };
    value.ranking.results[0].promotionDecision = "rejected";
    value.marketEvidence.candidates[0].minimumEvidencePack.complete = false;
    value.ranking.results[1].promotionDecision = "rejected";

    const run = buildNoviceMarketScreeningRun(value);

    expect(run.items[0].status).toBe("insufficient");
    expect(run.items[1].status).toBe("reject");
  });

  it("selects at most five eligible items by Stage 1 rank then productKey and marks overflow watch", () => {
    const value = input(7);
    value.ranking.results[0].rank = 2;
    value.ranking.results[1].rank = 1;
    value.ranking.results[2].rank = 2;

    const run = buildNoviceMarketScreeningRun(value);
    const advance = run.items.filter((item) => item.status === "advance");

    expect(run.displayName).toBe("调查短名单预览");
    expect(run.advanceMeaning).toBe("top_k_investigation_quota_not_quality_or_commercial_approval");
    expect(advance).toHaveLength(5);
    expect(advance.map((item) => item.productKey)).toEqual([
      "amazon:US:ASIN02",
      "amazon:US:ASIN01",
      "amazon:US:ASIN03",
      "amazon:US:ASIN04",
      "amazon:US:ASIN05",
    ]);
    expect(run.items.find((item) => item.productKey === "amazon:US:ASIN06")?.status).toBe("watch");
  });

  it("uses insufficient_advance_pool only as a batch status", () => {
    const value = input(4);
    value.responses.answers[2].productUnderstood = "no";
    value.responses.answers[3].investigateNext10Minutes = "uncertain";

    const run = buildNoviceMarketScreeningRun(value);

    expect(run.status).toBe("insufficient_advance_pool");
    expect(run.summary.advance).toBe(2);
    expect(run.items.map((item) => item.status)).toEqual(["advance", "advance", "watch", "watch"]);
    expect(run.items.some((item) => (item.status as string) === "insufficient_advance_pool")).toBe(false);
  });

  it("produces a complete mutually exclusive partition", () => {
    const value = input(6);
    value.marketEvidence.candidates[0].minimumEvidencePack.complete = false;
    value.ranking.results[1].promotionDecision = "rejected";
    value.responses.answers[2].productUnderstood = "no";

    const run = buildNoviceMarketScreeningRun(value);
    const ids = run.items.map((item) => item.productKey);

    expect(run.items).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(Object.values(run.summary).reduce((sum, count) => sum + count, 0)).toBe(6);
    expect(run.items.every((item) => ["advance", "watch", "reject", "insufficient"].includes(item.status))).toBe(true);
  });

  it("is deterministic and excludes extra Stage 2 fields from the Hash boundary", () => {
    const value = input(6) as NoviceMarketScreeningInput & { stage2?: unknown };
    const first = buildNoviceMarketScreeningRun(value);
    value.stage2 = { bom: 2.73, fba: 999, profit: 12345 };
    const second = buildNoviceMarketScreeningRun(value);

    expect(second).toEqual(first);
    value.responses.answers[0].investigateNext10Minutes = "no";
    expect(buildNoviceMarketScreeningRun(value).inputHash).not.toBe(first.inputHash);
  });

  it("separates engineering acceptance from screening effectiveness", () => {
    const run = buildNoviceMarketScreeningRun(input(20));
    const replay = buildNoviceMarketScreeningRun(input(20));
    const acceptance = buildNoviceMarketScreeningAcceptance(run, replay.screeningHash);

    expect(acceptance.engineering.status).toBe("passed");
    expect(acceptance.engineering.conclusion).toBe("deterministic_scope_reduction_verified");
    expect(acceptance.effectiveness.status).toBe("not_validated");
    expect(acceptance.effectiveness.conclusion).toBe("screening_effectiveness_not_validated");
    expect(acceptance.effectiveness.reasonCodes).toContain("mechanical_top_k_quota_only");
  });

  it("does not pass engineering acceptance without an identical deterministic replay", () => {
    const run = buildNoviceMarketScreeningRun(input(20));

    expect(buildNoviceMarketScreeningAcceptance(run, null).engineering).toMatchObject({
      status: "failed",
      conclusion: "deterministic_scope_reduction_not_verified",
      reasonCodes: ["deterministicReplayVerified"],
    });
    expect(buildNoviceMarketScreeningAcceptance(run, "different-hash").engineering.reasonCodes)
      .toContain("deterministicReplayVerified");
  });
});
