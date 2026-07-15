export type EvidenceSourceType =
  | "direct_observation"
  | "provider_metric"
  | "derived"
  | "manual"
  | "ai_generated";

export type MissingReason = string | null;

export type RequestedMarketContext = {
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
};

export type ObservedMarketContext = {
  marketplace: string | null;
  market: string | null;
  currency: string | null;
  deliveryRegion: string | null;
  deliveryRegionMarket: string | null;
  language: string | null;
};

export type CollectionPageStatus = "ok" | "captcha" | "login_wall" | "error_page" | "unknown_page";

export type ManualOverride<T> = {
  value: T;
  reason: string;
  overriddenAt: string;
  overriddenBy: string;
};

export type ObservedValue<T> = {
  sourceType: EvidenceSourceType;
  rawValue: T | null;
  normalizedValue: T | null;
  manualOverride: ManualOverride<T> | null;
  missingReason: MissingReason;
};

export type SelectionBrief = {
  schemaVersion: "selection-brief.v1";
  briefId: string;
  marketplace: "amazon.com";
  market: "US";
  query: string | null;
  category: string | null;
  targetScenario: string;
  targetPriceRange: { currency: "USD"; min: number; max: number };
  requiredEvidence: string[];
  hardExclusions: string[];
  sampleBudget: { maxPages: number; maxAppearances: number };
  rankingRuleVersion: string;
  createdAt: string;
  approvedBy: string;
};

export type CollectionRun = {
  schemaVersion: "collection-run.v2";
  collectionRunId: string;
  briefId: string;
  requested: RequestedMarketContext;
  observed: ObservedMarketContext;
  sampledObservationIds: string[];
  diagnosticVisiblePriceNodeCount: number | null;
  pageStatus: CollectionPageStatus;
  sourceUrl: string;
  capturedAt: string;
  collectorVersion: string;
  status: "completed" | "blocked" | "failed";
  errorCode: string | null;
  contentHash: string;
};

export type RawObservation = {
  schemaVersion: "raw-observation.v1";
  appearanceKey: string;
  collectionRunId: string;
  marketplace: "amazon.com";
  market: "US";
  sourceUrl: string;
  capturedAt: string;
  contentHash: string;
  page: number;
  position: number;
  sponsored: boolean | null;
  asin: string | null;
  parentAsin: string | null;
  title: string | null;
  price: number | null;
  priceCurrency: "USD" | "JPY" | null;
  rating: number | null;
  reviewCount: number | null;
  brand: string | null;
  productUrl: string;
  imageUrl: string | null;
  identityMissingReason: string | null;
  fieldMissingReasons: Record<string, string>;
  observedRiskFlags: string[];
  status: "observed" | "quarantined";
  errorCode: string | null;
};

export type NormalizedProduct = {
  schemaVersion: "normalized-product.v1";
  productKey: string;
  variantGroupKey: string;
  marketplace: "amazon.com";
  market: "US";
  platformProductId: string;
  sourceUrl: string;
  capturedAt: string;
  collectionRunId: string;
  inputHash: string;
  title: ObservedValue<string>;
  price: ObservedValue<number>;
  rating: ObservedValue<number>;
  reviewCount: ObservedValue<number>;
  brand: ObservedValue<string>;
  imageUrl: ObservedValue<string>;
  observedRiskFlags: string[];
  status: "normalized";
  errorCode: null;
};

export type EvidenceSnapshot = {
  schemaVersion: "evidence-snapshot.v1";
  evidenceSnapshotId: string;
  productKey: string;
  collectionRunId: string;
  marketplace: "amazon.com";
  market: "US";
  sourceUrl: string;
  capturedAt: string;
  inputHash: string;
  freshness: "fresh" | "stale" | "unknown";
  sourceTypes: EvidenceSourceType[];
  importBatchId: string;
  sourceState: "active" | "revoked" | "source_invalidated";
  product: NormalizedProduct;
  status: "valid";
  errorCode: null;
};

export type QualityGateResult = {
  schemaVersion: "quality-gate-result.v1";
  status: "passed" | "failed";
  errorCodes: string[];
  missingReasons: string[];
};

export type CompletenessMetric = {
  observedCount: number | null;
  denominator: number | null;
  ratio: number | null;
  missingReason: string | null;
};

export type MinimumEvidencePack = {
  schemaVersion: "minimum-evidence-pack.v1";
  importBatchId: string;
  productKey: string;
  evidenceSnapshotId: string;
  complete: boolean;
  missingEvidence: string[];
};

export type ImportCandidate = {
  candidateId: string;
  importBatchId: string;
  productKey: string;
  variantGroupKey: string;
  appearanceKeys: string[];
  appearances: Array<{ appearanceKey: string; sponsored: boolean | null }>;
  evidenceSnapshot: EvidenceSnapshot;
  minimumEvidencePack: MinimumEvidencePack;
};

export type ImportPackage = {
  schemaVersion: "import-package.v1";
  briefId: string;
  collectionRunId: string;
  marketplace: "amazon.com";
  market: "US";
  sourceUrl: string;
  capturedAt: string;
  importPackageHash: string;
  importIdempotencyKey: string;
  importBatchId: string;
  status: "preview_ready";
  errorCode: null;
  candidates: ImportCandidate[];
};

export type LayoutMetrics = {
  rawCardCount: number;
  requestedSampleLimit: number;
  expectedSampleCount: number;
  extractedObservationCount: number;
  samplingCoverage: CompletenessMetric;
  identitySuccessCount: number;
  priceVisibleCount: number;
  ratingVisibleCount: number;
  reviewVisibleCount: number;
  sponsoredKnownCount: number;
  quarantinedCount: number;
  uniqueProductCount: number;
  keyContainerFound: boolean;
  blockedPage: boolean;
};

export type HardGateResult = {
  schemaVersion: "hard-gate-result.v1";
  passed: boolean;
  errorCodes: string[];
};

export type NextValidationPlan = string[];
export type KillCriteria = string[];

export type Stage1Result = {
  schemaVersion: "stage1-result.v1";
  rankingRunId: string;
  rankingRuleVersion: string;
  productKey: string;
  candidateId: string;
  variantGroupKey: string;
  inputEvidenceHash: string;
  rank: number | null;
  totalScore: number | null;
  componentScores: Record<string, number>;
  hardGateResult: HardGateResult;
  supportingEvidence: string[];
  counterEvidence: string[];
  missingEvidence: string[];
  confidence: "high" | "medium" | "low";
  promotionDecision: "promoted" | "rejected" | "insufficient_evidence";
  recommendationTier: "high" | "medium" | "low" | "not_ranked";
  nextValidationPlan: NextValidationPlan;
  killCriteria: KillCriteria;
  createdAt: string;
};

export type RankingRun = {
  schemaVersion: "ranking-run.v1";
  rankingRunId: string;
  rankingRuleVersion: string;
  briefId: string;
  collectionRunId: string;
  inputHash: string;
  createdAt: string;
  results: Stage1Result[];
};

export type DecisionDiaryEntry = {
  schemaVersion: "decision-diary-entry.v1";
  sourceRunId: string;
  finalOutcome: string;
  outcomeReasons: string[];
  applicability: string;
  supportingEvidence: string[];
  counterExamples: string[];
  humanConfirmed: boolean;
  createdAt: string;
  revalidationCondition: string;
};
