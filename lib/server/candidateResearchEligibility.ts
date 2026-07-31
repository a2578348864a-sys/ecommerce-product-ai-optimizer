import "server-only";

import type { AccessContext } from "@/lib/server/accessPassword";
import { isCandidateReadyForAgent } from "@/lib/opportunityCandidatePool";
import { evaluateR22StoredCandidateStage2Gate } from "@/lib/r22CommercialValidation";
import {
  CANDIDATE_ORIGIN_KINDS,
  claimsProductBatchCandidateSource,
  parseProductBatchCandidateAnalysis,
  parseProductBatchCandidateSource,
  productBatchCandidateSourceMatches,
  type CandidateOriginKind,
  type ProductBatchCandidateSourceV1,
} from "@/lib/server/productBatchCandidateSource";
import { getProductBatchStore } from "@/lib/server/productBatchStoreResolver";
import { parseSellerSpriteCandidateSourceMeta } from "@/lib/server/sellerSpriteImportContract";

type ResearchCandidate = {
  id: string;
  name: string;
  status: string;
  convertedTaskId?: string | null;
  originProductBatchItemId?: string | null;
  sourceMetaJson: string;
  analysisJson: string;
};

export type CandidateResearchEligibility = {
  allowed: boolean;
  originKind: CandidateOriginKind;
  researchMode: "legacy_r22_stage2" | "market_research_only";
  promotionEligible: boolean;
  reasons: string[];
  productBatchSource?: ProductBatchCandidateSourceV1;
  sellerSpriteSource?: SellerSpriteMarketResearchSource;
};

/**
 * Frozen SellerSprite market-research source, validated from the server-side
 * saved `sellersprite_candidate_source_v1` snapshot only.
 */
export type SellerSpriteMarketResearchSource = {
  asin: string;
  parentAsin: string | null;
  productUrl: string;
  title: string;
  imageUrl: string | null;
  priceUsd: number | null;
  rating: number | null;
  reviewCount: number | null;
  brand: string | null;
  category: string | null;
  searchRank: number | null;
  estimatedMonthlySales: number | null;
  estimatedMonthlyRevenueUsd: number | null;
  importedAt: string;
  disclaimer: "third_party_estimate_point_in_time";
};

export function parseSellerSpriteMarketResearchSource(
  sourceMetaJson: string,
): SellerSpriteMarketResearchSource | null {
  const meta = parseSellerSpriteCandidateSourceMeta(sourceMetaJson);
  if (!meta) return null;
  // Exact provider / report-type contract.
  if (meta.source.provider !== "SellerSprite") return null;
  if (meta.source.type !== "sellersprite_xlsx") return null;

  // Validated Amazon US product URL whose ASIN matches the identity.
  let url: URL;
  try {
    url = new URL(meta.identity.productUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname.toLowerCase() !== "amazon.com"
    && url.hostname.toLowerCase() !== "www.amazon.com") return null;
  const urlAsin = /\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})(?:[/?]|$)/i
    .exec(url.pathname)?.[1]?.toUpperCase();
  if (!urlAsin || urlAsin !== meta.identity.asin) return null;

  const title = meta.snapshot.title;
  if (!title || !title.trim()) return null;

  return {
    asin: meta.identity.asin,
    parentAsin: meta.identity.parentAsin,
    productUrl: meta.identity.productUrl,
    title,
    imageUrl: meta.snapshot.imageUrl,
    priceUsd: meta.snapshot.priceUsd,
    rating: meta.snapshot.rating,
    reviewCount: meta.snapshot.reviewCount,
    brand: meta.snapshot.brand,
    category: meta.snapshot.category,
    searchRank: meta.estimates.searchRank,
    estimatedMonthlySales: meta.estimates.estimatedMonthlySales,
    estimatedMonthlyRevenueUsd: meta.estimates.estimatedMonthlyRevenueUsd,
    importedAt: meta.source.importedAt,
    disclaimer: "third_party_estimate_point_in_time",
  };
}

function normalizedName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

function blocked(
  originKind: CandidateOriginKind,
  researchMode: CandidateResearchEligibility["researchMode"],
  reason: string,
): CandidateResearchEligibility {
  return {
    allowed: false,
    originKind,
    researchMode,
    promotionEligible: false,
    reasons: [reason],
  };
}

export function evaluateStoredCandidateResearchEligibility(
  candidate: ResearchCandidate,
): CandidateResearchEligibility {
  // Frozen SellerSprite market-research source. `status = "pending"` stays
  // untouched; only terminal states and already-linked candidates are blocked.
  const sellerSpriteSource = parseSellerSpriteMarketResearchSource(candidate.sourceMetaJson);
  if (sellerSpriteSource) {
    const originKind = CANDIDATE_ORIGIN_KINDS.sellerSpriteMarketResearch;
    const researchMode = "market_research_only" as const;
    if (candidate.status === "rejected" || candidate.status === "paused") {
      return blocked(originKind, researchMode, "candidate_not_ready");
    }
    if (candidate.convertedTaskId) {
      return blocked(originKind, researchMode, "candidate_already_linked");
    }
    return {
      allowed: true,
      originKind,
      researchMode,
      promotionEligible: false,
      reasons: [],
      sellerSpriteSource,
    };
  }

  if (claimsProductBatchCandidateSource(candidate.sourceMetaJson)) {
    const originKind = CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch;
    const researchMode = "market_research_only" as const;
    const source = parseProductBatchCandidateSource(candidate.sourceMetaJson);
    if (!source) return blocked(originKind, researchMode, "product_batch_source_invalid");
    if (!isCandidateReadyForAgent(candidate.status)) {
      return blocked(originKind, researchMode, "candidate_not_ready");
    }
    if (candidate.convertedTaskId) {
      return blocked(originKind, researchMode, "candidate_already_linked");
    }
    if (candidate.originProductBatchItemId !== source.productBatchItemId) {
      return blocked(originKind, researchMode, "product_batch_item_binding_mismatch");
    }
    if (normalizedName(candidate.name) !== normalizedName(source.productName)) {
      return blocked(originKind, researchMode, "product_batch_name_mismatch");
    }
    const analysis = parseProductBatchCandidateAnalysis(candidate.analysisJson);
    if (!analysis
      || analysis.itemHash !== source.itemHash
      || analysis.evidenceHash !== source.evidenceHash) {
      return blocked(originKind, researchMode, "product_batch_analysis_binding_invalid");
    }
    return {
      allowed: true,
      originKind,
      researchMode,
      promotionEligible: false,
      reasons: [],
      productBatchSource: source,
    };
  }

  const originKind = CANDIDATE_ORIGIN_KINDS.legacyMarketScreening;
  const researchMode = "legacy_r22_stage2" as const;
  if (!isCandidateReadyForAgent(candidate.status)) {
    return blocked(originKind, researchMode, "candidate_not_ready");
  }
  if (candidate.convertedTaskId) {
    return blocked(originKind, researchMode, "candidate_already_linked");
  }
  const r22Gate = evaluateR22StoredCandidateStage2Gate({
    candidateId: candidate.id,
    analysisJson: candidate.analysisJson,
  });
  if (!r22Gate.allowed) {
    return {
      allowed: false,
      originKind,
      researchMode,
      promotionEligible: false,
      reasons: r22Gate.reasons,
    };
  }
  return {
    allowed: true,
    originKind,
    researchMode,
    promotionEligible: true,
    reasons: [],
  };
}

export async function evaluateCandidateResearchEligibility(
  context: AccessContext,
  candidate: ResearchCandidate,
): Promise<CandidateResearchEligibility> {
  const stored = evaluateStoredCandidateResearchEligibility(candidate);
  if (!stored.allowed || stored.originKind !== CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch) {
    return stored;
  }
  const source = stored.productBatchSource!;
  const expectedScope = context.mode === "owner" ? "owner:v1" : "visitor:sandbox";
  if (source.serverIdentityScope !== expectedScope) {
    return blocked(
      CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
      "market_research_only",
      "product_batch_identity_scope_mismatch",
    );
  }
  try {
    const store = getProductBatchStore(context);
    const batch = await store.getBatch(source.productBatchId);
    if (!batch) {
      return blocked(
        CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
        "market_research_only",
        "product_batch_source_not_found",
      );
    }
    const item = (await store.getBatchItems(batch.id)).find(
      (candidateItem) => candidateItem.id === source.productBatchItemId,
    );
    if (!item || !productBatchCandidateSourceMatches({
      source,
      batch,
      item,
      serverIdentityScope: expectedScope,
    })) {
      return blocked(
        CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
        "market_research_only",
        "product_batch_source_changed",
      );
    }
    return stored;
  } catch {
    return blocked(
      CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
      "market_research_only",
      "product_batch_source_unavailable",
    );
  }
}
