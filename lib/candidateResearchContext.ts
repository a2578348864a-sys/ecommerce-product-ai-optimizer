import type { ResearchProductImageDisplay } from "@/lib/productResearchImage";

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
  productImage?: ResearchProductImageDisplay;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProductImage(value: unknown): ResearchProductImageDisplay | null {
  if (!isRecord(value)
    || (value.mimeType !== "image/jpeg" && value.mimeType !== "image/png")
    || typeof value.contentHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.contentHash)
    || (value.provenance !== "candidate_fallback"
      && value.provenance !== "product_batch_snapshot")
    || typeof value.dataUrl !== "string"
    || value.dataUrl.length > 2_800_000) {
    return null;
  }
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]*={0,2})$/u.exec(
    value.dataUrl,
  );
  if (!match || match[1] !== value.mimeType || match[2].length % 4 !== 0) return null;
  try {
    const binary = atob(match[2]);
    if (!binary || btoa(binary) !== match[2]) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const jpeg = bytes.length >= 3
      && bytes[0] === 0xff
      && bytes[1] === 0xd8
      && bytes[2] === 0xff;
    const png = bytes.length >= 8
      && bytes[0] === 0x89
      && bytes[1] === 0x50
      && bytes[2] === 0x4e
      && bytes[3] === 0x47
      && bytes[4] === 0x0d
      && bytes[5] === 0x0a
      && bytes[6] === 0x1a
      && bytes[7] === 0x0a;
    if ((value.mimeType === "image/jpeg" && !jpeg)
      || (value.mimeType === "image/png" && !png)) {
      return null;
    }
  } catch {
    return null;
  }
  return value as ResearchProductImageDisplay;
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
  const productImage = value.productImage === undefined
    ? undefined
    : parseProductImage(value.productImage);
  if (value.productImage !== undefined && !productImage) return null;
  return {
    ...(value as CandidateResearchContext),
    ...(productImage ? { productImage } : {}),
  };
}
