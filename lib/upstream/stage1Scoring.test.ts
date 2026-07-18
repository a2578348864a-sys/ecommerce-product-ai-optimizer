import { describe, expect, it } from "vitest";
import fixture from "./fixtures/amazon-us-closet-organizer.v1.json";
import { rankStage1Candidates, type Stage1ScoringInput } from "./stage1Scoring";
import { buildFixturePipeline, stableHash } from "./pipeline";
import { rankStage1 } from "./ranking";

const AMAZON_FIXTURE_RANKING_GOLDEN = {
  schemaVersion: "ranking-run.v1",
  rankingRunId: "ranking-2a23fc777c2f873968be90de",
  rankingRuleVersion: "stage1-deterministic-v1.1",
  briefId: "brief-amazon-us-closet-organizer-fixture-v1",
  collectionRunId: "run-fixture-amazon-us-closet-organizer-v1",
  inputHash: "f2d18ef1f312610eb071abc83bc8844bb3944c23a9fd1befaa6d58cc8b9125f7",
  createdAt: "2026-07-14T00:00:00.000Z",
  results: [
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00001", candidateId: "candidate-6d6a0b9f1dc17164db44", variantGroupKey: "amazon:US:B0PARENT01", inputEvidenceHash: "53eaa8c872ff7c88545c31c6bace6f9641547921acfde54bf319bae2422f360f",
      rank: 1, totalScore: 100, componentScores: { priceFit: 25, ratingSignal: 25, reviewSignal: 25, placementDiversity: 25 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
      supportingEvidence: ["页面可见评分", "页面可见评论数", "同次采集存在多个页面出现位置", "存在明确自然位页面出现"], counterEvidence: [], missingEvidence: [], confidence: "high", promotionDecision: "promoted", recommendationTier: "high",
      nextValidationPlan: ["人工核验商品页证据", "补充供应链与物流输入", "进入少量 Stage 2 校准"], killCriteria: ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"], createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00003", candidateId: "candidate-f2d364a5b7b2036d046c", variantGroupKey: "amazon:US:B0FIX00003", inputEvidenceHash: "3bdd0f10ce538616dd9748f6297397b31b7ec4579caa0be487f7cab7626c4f60",
      rank: 2, totalScore: 100, componentScores: { priceFit: 25, ratingSignal: 25, reviewSignal: 25, placementDiversity: 25 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
      supportingEvidence: ["页面可见评分", "页面可见评论数", "存在明确自然位页面出现"], counterEvidence: [], missingEvidence: [], confidence: "high", promotionDecision: "promoted", recommendationTier: "high",
      nextValidationPlan: ["人工核验商品页证据", "补充供应链与物流输入", "进入少量 Stage 2 校准"], killCriteria: ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"], createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00002", candidateId: "candidate-2b46bb334b8c67882a66", variantGroupKey: "amazon:US:B0PARENT01", inputEvidenceHash: "23ff3af15c8e59e28e6cf92cbeed8bf3de3f23ea77f64b4ea7ccbf4a1c32adc0",
      rank: 3, totalScore: 78, componentScores: { priceFit: 25, ratingSignal: 18, reviewSignal: 25, placementDiversity: 25 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
      supportingEvidence: ["页面可见评分", "页面可见评论数", "存在明确自然位页面出现"], counterEvidence: ["同一变体家族已有更优先代表"], missingEvidence: [], confidence: "high", promotionDecision: "promoted", recommendationTier: "medium",
      nextValidationPlan: ["人工核验商品页证据", "补充供应链与物流输入", "进入少量 Stage 2 校准"], killCriteria: ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"], createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00004", candidateId: "candidate-f399c741c54bb5fd2429", variantGroupKey: "amazon:US:B0FIX00004", inputEvidenceHash: "39d38c0b68b4302b47adbe5526a330487cb73fcdb77f9abd896582f32b7ab5a4",
      rank: null, totalScore: null, componentScores: { priceFit: 0, ratingSignal: 0, reviewSignal: 0, placementDiversity: 0 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: true, errorCodes: [] },
      supportingEvidence: ["存在明确自然位页面出现"], counterEvidence: [], missingEvidence: ["rating", "review_count"], confidence: "low", promotionDecision: "insufficient_evidence", recommendationTier: "not_ranked",
      nextValidationPlan: ["补齐最低证据：rating、review_count"], killCriteria: ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"], createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00005", candidateId: "candidate-45115dd743edfa580daa", variantGroupKey: "amazon:US:B0FIX00005", inputEvidenceHash: "32fe83dc651d5e967131c9430a5cc1cbbea40f2ad863215d697d9580a8295657",
      rank: null, totalScore: null, componentScores: { priceFit: 0, ratingSignal: 0, reviewSignal: 0, placementDiversity: 0 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: false, errorCodes: ["confirmed_ip_risk"] },
      supportingEvidence: ["页面可见评分", "页面可见评论数", "存在明确自然位页面出现"], counterEvidence: ["硬阻断：confirmed_ip_risk"], missingEvidence: [], confidence: "high", promotionDecision: "rejected", recommendationTier: "not_ranked",
      nextValidationPlan: ["仅在硬阻断被可靠新证据推翻后重新评估"], killCriteria: ["硬阻断持续成立：confirmed_ip_risk"], createdAt: "2026-07-14T00:00:00.000Z",
    },
    {
      schemaVersion: "stage1-result.v1", rankingRunId: "ranking-2a23fc777c2f873968be90de", rankingRuleVersion: "stage1-deterministic-v1.1",
      productKey: "amazon:US:B0FIX00006", candidateId: "candidate-43c9e673911dd6acd017", variantGroupKey: "amazon:US:B0FIX00006", inputEvidenceHash: "da82fb0adec203c36534cee8ca808fdc23d21c91e6572fbf4cc0e2cf75ec415b",
      rank: null, totalScore: null, componentScores: { priceFit: 0, ratingSignal: 0, reviewSignal: 0, placementDiversity: 0 }, hardGateResult: { schemaVersion: "hard-gate-result.v1", passed: false, errorCodes: ["price_out_of_budget"] },
      supportingEvidence: ["页面可见评分", "页面可见评论数", "存在明确自然位页面出现"], counterEvidence: ["硬阻断：price_out_of_budget"], missingEvidence: [], confidence: "high", promotionDecision: "rejected", recommendationTier: "not_ranked",
      nextValidationPlan: ["仅在硬阻断被可靠新证据推翻后重新评估"], killCriteria: ["硬阻断持续成立：price_out_of_budget"], createdAt: "2026-07-14T00:00:00.000Z",
    },
  ],
};

function toStage1ScoringInput(): Stage1ScoringInput {
  const pkg = buildFixturePipeline(fixture).importPackage;
  return {
    briefId: pkg.briefId,
    collectionRunId: pkg.collectionRunId,
    inputHash: pkg.importPackageHash,
    createdAt: fixture.brief.createdAt,
    candidates: pkg.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      productKey: candidate.productKey,
      variantGroupKey: candidate.variantGroupKey,
      inputEvidenceHash: candidate.evidenceSnapshot.inputHash,
      minimumEvidenceComplete: candidate.minimumEvidencePack.complete,
      minimumEvidenceMissing: candidate.minimumEvidencePack.missingEvidence,
      observedRiskFlags: candidate.evidenceSnapshot.product.observedRiskFlags,
      price: candidate.evidenceSnapshot.product.price.normalizedValue,
      rating: candidate.evidenceSnapshot.product.rating.normalizedValue,
      reviewCount: candidate.evidenceSnapshot.product.reviewCount.normalizedValue,
      appearanceCount: candidate.appearanceKeys.length,
      appearances: candidate.appearances.map((appearance) => ({ sponsored: appearance.sponsored })),
    })),
  };
}

describe("Stage 1 scoring kernel", () => {
  it("freezes the pre-extraction Amazon fixture ranking", () => {
    const ranking = rankStage1(buildFixturePipeline(fixture).importPackage, fixture.brief.createdAt);

    expect(ranking).toEqual(AMAZON_FIXTURE_RANKING_GOLDEN);
    expect(ranking.rankingRuleVersion).toBe("stage1-deterministic-v1.1");
    expect(stableHash(ranking)).toBe("f1d780c7235fc67604f80750f88ba108ba8087ea1747dff476ad9c86ac9aae5a");
  });

  it("scores source-neutral candidates with the frozen Amazon result", () => {
    expect(rankStage1Candidates(toStage1ScoringInput())).toEqual(AMAZON_FIXTURE_RANKING_GOLDEN);
  });

  it("keeps multiple appearances separate from the natural-placement signal", () => {
    const input = toStage1ScoringInput();
    const candidate = input.candidates.find((item) => item.productKey.endsWith("B0FIX00001"));
    if (!candidate) throw new Error("FIXTURE_CANDIDATE_MISSING");
    candidate.appearanceCount = 1;

    const result = rankStage1Candidates(input).results.find((item) => item.productKey === candidate.productKey);
    expect(result?.supportingEvidence).not.toContain("同次采集存在多个页面出现位置");
    expect(result?.supportingEvidence).toContain("存在明确自然位页面出现");
    expect(result?.componentScores.placementDiversity).toBe(25);
  });
});
