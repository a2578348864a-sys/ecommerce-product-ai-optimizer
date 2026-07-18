import type { ImportPackage, RankingRun } from "./contracts";
import { stableHash } from "./pipeline";
import { rankStage1Candidates, type Stage1ScoringInput } from "./stage1Scoring";

function projectAmazonPackage(pkg: ImportPackage, createdAt: string): Stage1ScoringInput {
  return {
    briefId: pkg.briefId,
    collectionRunId: pkg.collectionRunId,
    inputHash: pkg.importPackageHash,
    createdAt,
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

export function rankStage1(pkg: ImportPackage, createdAt: string): RankingRun {
  return rankStage1Candidates(projectAmazonPackage(pkg, createdAt));
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
