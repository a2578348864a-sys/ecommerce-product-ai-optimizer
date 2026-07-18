import type { HardGateResult, RankingRun, Stage1Result } from "./contracts";
import { stableHash } from "./pipeline";

const RULE_VERSION = "stage1-deterministic-v1.1";

export type Stage1ScoringCandidate = {
  candidateId: string;
  productKey: string;
  variantGroupKey: string;
  inputEvidenceHash: string;
  minimumEvidenceComplete: boolean;
  minimumEvidenceMissing: string[];
  observedRiskFlags: string[];
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  appearanceCount: number;
  appearances: Array<{ sponsored: boolean | null }>;
};

export type Stage1ScoringInput = {
  briefId: string;
  collectionRunId: string;
  inputHash: string;
  createdAt: string;
  candidates: Stage1ScoringCandidate[];
};

function hardGate(candidate: Stage1ScoringCandidate): HardGateResult {
  const allowedSignals = new Set(["confirmed_ip_risk", "regulated_product", "price_out_of_budget", "logistics_blocked", "verified_negative_contribution"]);
  const errors = candidate.observedRiskFlags.filter((item) => allowedSignals.has(item)).sort();
  return { schemaVersion: "hard-gate-result.v1", passed: errors.length === 0, errorCodes: errors };
}

function componentScores(candidate: Stage1ScoringCandidate) {
  const hasOrganicAppearance = candidate.appearances.some((appearance) => appearance.sponsored === false);
  const hasKnownSponsoredAppearance = candidate.appearances.some((appearance) => appearance.sponsored === true);
  return {
    priceFit: candidate.price !== null && candidate.price >= 15 && candidate.price <= 45 ? 25 : 0,
    ratingSignal: candidate.rating !== null ? (candidate.rating >= 4.5 ? 25 : candidate.rating >= 4 ? 18 : 8) : 0,
    reviewSignal: candidate.reviewCount !== null ? (candidate.reviewCount >= 500 ? 25 : candidate.reviewCount >= 100 ? 18 : 10) : 0,
    placementDiversity: hasOrganicAppearance ? 25 : hasKnownSponsoredAppearance ? 10 : 0,
  };
}

const EMPTY_COMPONENT_SCORES = {
  priceFit: 0,
  ratingSignal: 0,
  reviewSignal: 0,
  placementDiversity: 0,
};

export function rankStage1Candidates(input: Stage1ScoringInput): RankingRun {
  const rankingRunId = `ranking-${stableHash({ packageHash: input.inputHash, rule: RULE_VERSION }).slice(0, 24)}`;
  const prepared = input.candidates.map((candidate) => {
    const gate = hardGate(candidate);
    const complete = candidate.minimumEvidenceComplete;
    const eligible = complete && gate.passed;
    const scores = eligible ? componentScores(candidate) : { ...EMPTY_COMPONENT_SCORES };
    const baseScore = Object.values(scores).reduce((sum, score) => sum + score, 0);
    return { candidate, scores, baseScore, gate, complete, eligible };
  });
  const familyLeaders = new Map<string, string>();
  for (const item of prepared.filter((candidate) => candidate.eligible)
    .sort((left, right) => right.baseScore - left.baseScore || left.candidate.productKey.localeCompare(right.candidate.productKey))) {
    if (!familyLeaders.has(item.candidate.variantGroupKey)) familyLeaders.set(item.candidate.variantGroupKey, item.candidate.productKey);
  }

  const provisional: Stage1Result[] = prepared.map(({ candidate, scores, baseScore, gate, complete, eligible }) => {
    const familyLeader = familyLeaders.get(candidate.variantGroupKey);
    const familyDuplicate = eligible && familyLeader !== undefined && familyLeader !== candidate.productKey;
    const sponsoredUnknown = candidate.appearances.every((appearance) => appearance.sponsored === null);
    const totalScore = complete && gate.passed ? Math.max(0, baseScore - (familyDuplicate ? 15 : 0)) : null;
    const promotionDecision = !gate.passed
      ? "rejected" as const
      : !complete
        ? "insufficient_evidence" as const
        : totalScore !== null && totalScore >= 70
          ? "promoted" as const
          : "rejected" as const;
    const supportingEvidence = [
      candidate.rating !== null ? "页面可见评分" : null,
      candidate.reviewCount !== null ? "页面可见评论数" : null,
      candidate.appearanceCount > 1 ? "同次采集存在多个页面出现位置" : null,
      candidate.appearances.some((appearance) => appearance.sponsored === false) ? "存在明确自然位页面出现" : null,
    ].filter((item): item is string => item !== null);
    const counterEvidence = [
      familyDuplicate ? "同一变体家族已有更优先代表" : null,
      sponsoredUnknown ? "广告或自然位状态未确认" : null,
      ...gate.errorCodes.map((code) => `硬阻断：${code}`),
    ].filter((item): item is string => item !== null);
    return {
      schemaVersion: "stage1-result.v1",
      rankingRunId,
      rankingRuleVersion: RULE_VERSION,
      productKey: candidate.productKey,
      candidateId: candidate.candidateId,
      variantGroupKey: candidate.variantGroupKey,
      inputEvidenceHash: candidate.inputEvidenceHash,
      rank: null,
      totalScore,
      componentScores: scores,
      hardGateResult: gate,
      supportingEvidence,
      counterEvidence,
      missingEvidence: [
        ...candidate.minimumEvidenceMissing,
        ...(sponsoredUnknown ? ["sponsored_status"] : []),
      ],
      confidence: !complete || sponsoredUnknown ? "low" : supportingEvidence.length >= 2 ? "high" : "medium",
      promotionDecision,
      recommendationTier: totalScore === null ? "not_ranked" : totalScore >= 85 ? "high" : totalScore >= 70 ? "medium" : "low",
      nextValidationPlan: promotionDecision === "promoted"
        ? ["人工核验商品页证据", "补充供应链与物流输入", "进入少量 Stage 2 校准"]
        : promotionDecision === "insufficient_evidence"
          ? [`补齐最低证据：${candidate.minimumEvidenceMissing.join("、")}`]
          : ["仅在硬阻断被可靠新证据推翻后重新评估"],
      killCriteria: gate.passed
        ? ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"]
        : gate.errorCodes.map((code) => `硬阻断持续成立：${code}`),
      createdAt: input.createdAt,
    };
  });

  const ranked = provisional.filter((item) => item.totalScore !== null)
    .sort((left, right) => (right.totalScore ?? 0) - (left.totalScore ?? 0) || left.productKey.localeCompare(right.productKey));
  ranked.forEach((item, index) => { item.rank = index + 1; });
  const results = [...provisional].sort((left, right) => {
    if (left.rank === null && right.rank !== null) return 1;
    if (left.rank !== null && right.rank === null) return -1;
    return (left.rank ?? 0) - (right.rank ?? 0) || left.productKey.localeCompare(right.productKey);
  });
  return {
    schemaVersion: "ranking-run.v1",
    rankingRunId,
    rankingRuleVersion: RULE_VERSION,
    briefId: input.briefId,
    collectionRunId: input.collectionRunId,
    inputHash: input.inputHash,
    createdAt: input.createdAt,
    results,
  };
}
