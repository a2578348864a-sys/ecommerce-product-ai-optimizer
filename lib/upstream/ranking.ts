import type { HardGateResult, ImportCandidate, ImportPackage, RankingRun, Stage1Result } from "./contracts";
import { stableHash } from "./pipeline";

const RULE_VERSION = "stage1-deterministic-v1.1";

function hardGate(candidate: ImportCandidate): HardGateResult {
  const allowedSignals = new Set(["confirmed_ip_risk", "regulated_product", "price_out_of_budget", "logistics_blocked", "verified_negative_contribution"]);
  const errors = candidate.evidenceSnapshot.product.observedRiskFlags.filter((item) => allowedSignals.has(item)).sort();
  return { schemaVersion: "hard-gate-result.v1", passed: errors.length === 0, errorCodes: errors };
}

function componentScores(candidate: ImportCandidate) {
  const product = candidate.evidenceSnapshot.product;
  const price = product.price.normalizedValue;
  const rating = product.rating.normalizedValue;
  const reviewCount = product.reviewCount.normalizedValue;
  const hasOrganicAppearance = candidate.appearances.some((appearance) => appearance.sponsored === false);
  const hasKnownSponsoredAppearance = candidate.appearances.some((appearance) => appearance.sponsored === true);
  return {
    priceFit: price !== null && price >= 15 && price <= 45 ? 25 : 0,
    ratingSignal: rating !== null ? (rating >= 4.5 ? 25 : rating >= 4 ? 18 : 8) : 0,
    reviewSignal: reviewCount !== null ? (reviewCount >= 500 ? 25 : reviewCount >= 100 ? 18 : 10) : 0,
    placementDiversity: hasOrganicAppearance ? 25 : hasKnownSponsoredAppearance ? 10 : 0,
  };
}

const EMPTY_COMPONENT_SCORES = {
  priceFit: 0,
  ratingSignal: 0,
  reviewSignal: 0,
  placementDiversity: 0,
};

export function rankStage1(pkg: ImportPackage, createdAt: string): RankingRun {
  const rankingRunId = `ranking-${stableHash({ packageHash: pkg.importPackageHash, rule: RULE_VERSION }).slice(0, 24)}`;
  const prepared = pkg.candidates.map((candidate) => {
    const gate = hardGate(candidate);
    const complete = candidate.minimumEvidencePack.complete;
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
      candidate.evidenceSnapshot.product.rating.normalizedValue !== null ? "页面可见评分" : null,
      candidate.evidenceSnapshot.product.reviewCount.normalizedValue !== null ? "页面可见评论数" : null,
      candidate.appearanceKeys.length > 1 ? "同次采集存在多个页面出现位置" : null,
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
      inputEvidenceHash: candidate.evidenceSnapshot.inputHash,
      rank: null,
      totalScore,
      componentScores: scores,
      hardGateResult: gate,
      supportingEvidence,
      counterEvidence,
      missingEvidence: [
        ...candidate.minimumEvidencePack.missingEvidence,
        ...(sponsoredUnknown ? ["sponsored_status"] : []),
      ],
      confidence: !complete || sponsoredUnknown ? "low" : supportingEvidence.length >= 2 ? "high" : "medium",
      promotionDecision,
      recommendationTier: totalScore === null ? "not_ranked" : totalScore >= 85 ? "high" : totalScore >= 70 ? "medium" : "low",
      nextValidationPlan: promotionDecision === "promoted"
        ? ["人工核验商品页证据", "补充供应链与物流输入", "进入少量 Stage 2 校准"]
        : promotionDecision === "insufficient_evidence"
          ? [`补齐最低证据：${candidate.minimumEvidencePack.missingEvidence.join("、")}`]
          : ["仅在硬阻断被可靠新证据推翻后重新评估"],
      killCriteria: gate.passed
        ? ["关键页面证据无法复核", "供应链或物流证据显示不可执行", "压力情景贡献利润不成立"]
        : gate.errorCodes.map((code) => `硬阻断持续成立：${code}`),
      createdAt,
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
    briefId: pkg.briefId,
    collectionRunId: pkg.collectionRunId,
    inputHash: pkg.importPackageHash,
    createdAt,
    results,
  };
}

export function buildBlindReviewMaterial(pkg: ImportPackage, blindReviewId: string) {
  const items = [...pkg.candidates]
    .sort((left, right) => stableHash(`${blindReviewId}:${left.productKey}`).localeCompare(stableHash(`${blindReviewId}:${right.productKey}`)))
    .map((candidate, index) => ({
      blindItemId: `${blindReviewId}-${String(index + 1).padStart(2, "0")}`,
      candidateId: candidate.candidateId,
      evidenceSnapshotId: candidate.evidenceSnapshot.evidenceSnapshotId,
      title: candidate.evidenceSnapshot.product.title.normalizedValue,
      sourceUrl: candidate.evidenceSnapshot.sourceUrl,
      capturedAt: candidate.evidenceSnapshot.capturedAt,
      evidence: {
        price: candidate.evidenceSnapshot.product.price.normalizedValue,
        rating: candidate.evidenceSnapshot.product.rating.normalizedValue,
        reviewCount: candidate.evidenceSnapshot.product.reviewCount.normalizedValue,
        missingEvidence: candidate.minimumEvidencePack.missingEvidence,
      },
    }));
  return {
    schemaVersion: "blind-review-material.v1" as const,
    blindReviewId,
    criteria: ["是否值得进一步调查", "证据是否充分", "是否存在明显淘汰原因", "机会强度：高／中／低", "信心：高／中／低"],
    items,
  };
}

export type Stage2CalibrationInput = {
  candidateId: string;
  currency: "USD";
  salePrice: number | null;
  bom: number | null;
  firstMile: number | null;
  platformCommission: number | null;
  fba: number | null;
  packaging: number | null;
  storage: number | null;
  returnReserve: number | null;
};

export function calibrateStage2(input: Stage2CalibrationInput) {
  const costFields = ["bom", "firstMile", "platformCommission", "fba", "packaging", "storage", "returnReserve"] as const;
  const missingInputs = [
    ...(input.salePrice === null || !Number.isFinite(input.salePrice) || input.salePrice <= 0 ? ["salePrice"] : []),
    ...costFields.filter((field) => input[field] === null || !Number.isFinite(input[field]) || input[field] < 0),
  ];
  if (missingInputs.length) {
    return {
      schemaVersion: "stage2-calibration.v1" as const,
      candidateId: input.candidateId,
      status: "profit_insufficient_evidence" as const,
      missingInputs,
      normalContributionMargin: null,
      stressContributionMargin: null,
      breakEvenAcos: null,
    };
  }
  const salePrice = input.salePrice as number;
  const totalCosts = costFields.reduce((sum, field) => sum + (input[field] as number), 0);
  const normalContributionMargin = salePrice - totalCosts;
  const stressContributionMargin = salePrice - totalCosts * 1.15;
  return {
    schemaVersion: "stage2-calibration.v1" as const,
    candidateId: input.candidateId,
    status: "calculated" as const,
    missingInputs: [],
    normalContributionMargin,
    stressContributionMargin,
    breakEvenAcos: normalContributionMargin / salePrice,
  };
}
