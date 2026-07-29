export type CandidateResearchContext = {
  candidateId: string;
  productName: string;
  sourceType: "legacy_market_screening" | "seller_sprite_product_batch";
  sourceLabel: string;
  productBatchName?: string;
  productBatchId?: string;
  productBatchItemId?: string;
  marketplace?: string;
  asin?: string | null;
  reportType?: "search_results" | "category_current";
  query?: string | null;
  category?: string | null;
  evidenceStatus: string;
  researchPriority: string;
  promotionEligible: false;
  sellerSpriteDisclaimerVersion?: string;
  capturedAt: string;
  contextHash: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCandidateResearchContext(value: unknown): CandidateResearchContext | null {
  if (!isRecord(value)) return null;
  const sourceType = value.sourceType;
  if (sourceType !== "legacy_market_screening"
    && sourceType !== "seller_sprite_product_batch") return null;
  if (typeof value.candidateId !== "string" || !value.candidateId.trim()
    || typeof value.productName !== "string" || !value.productName.trim()
    || typeof value.sourceLabel !== "string" || !value.sourceLabel.trim()
    || typeof value.evidenceStatus !== "string" || !value.evidenceStatus.trim()
    || typeof value.researchPriority !== "string" || !value.researchPriority.trim()
    || value.promotionEligible !== false
    || typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))
    || typeof value.contextHash !== "string" || !/^[a-f0-9]{64}$/i.test(value.contextHash)) {
    return null;
  }
  if (sourceType === "seller_sprite_product_batch") {
    if (typeof value.productBatchName !== "string" || !value.productBatchName.trim()
      || typeof value.productBatchId !== "string" || !value.productBatchId.trim()
      || typeof value.productBatchItemId !== "string" || !value.productBatchItemId.trim()
      || typeof value.marketplace !== "string" || !value.marketplace.trim()
      || (value.asin !== null && typeof value.asin !== "string")
      || (value.reportType !== "search_results" && value.reportType !== "category_current")
      || (value.query !== null && typeof value.query !== "string")
      || (value.category !== null && typeof value.category !== "string")
      || typeof value.sellerSpriteDisclaimerVersion !== "string"
      || !value.sellerSpriteDisclaimerVersion.trim()) {
      return null;
    }
  }
  return value as CandidateResearchContext;
}
