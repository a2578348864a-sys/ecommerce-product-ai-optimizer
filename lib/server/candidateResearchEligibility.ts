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
  source?: string;
  status: string;
  convertedTaskId?: string | null;
  originProductBatchItemId?: string | null;
  sourceMetaJson: string;
  analysisJson: string;
};

export type CandidateResearchEligibility = {
  allowed: boolean;
  researchAction: CandidateResearchAction;
  researchBlockReasonCode: CandidateResearchBlockReasonCode | null;
  researchActionMessage: string | null;
  alreadyConverted: boolean;
  requiresRuntimeValidation: boolean;
  originKind: CandidateOriginKind;
  researchMode: "legacy_r22_stage2" | "market_research_only";
  promotionEligible: boolean;
  reasons: string[];
  productBatchSource?: ProductBatchCandidateSourceV1;
  sellerSpriteSource?: SellerSpriteMarketResearchSource;
};

export type CandidateResearchAction =
  | "converted"
  | "research_available"
  | "research_blocked"
  | "runtime_validation_required";

export type CandidateResearchBlockReasonCode =
  | "candidate_paused"
  | "candidate_rejected"
  | "candidate_not_ready"
  | "source_contract_invalid"
  | "research_gate_blocked";

export type CandidateResearchActionProjection = Pick<
  CandidateResearchEligibility,
  "researchAction" | "researchBlockReasonCode" | "researchActionMessage"
>;

const SELLERSPRITE_SOURCE_SCHEMA = "sellersprite_candidate_source_v1";
const MAX_STORED_TEXT_LENGTH = 500;
const MAX_STORED_URL_LENGTH = 2_048;

function claimsSellerSpriteMarketResearchSource(candidate: ResearchCandidate): boolean {
  if (candidate.source?.trim().toLowerCase() === "sellersprite") return true;
  try {
    const parsed: unknown = JSON.parse(candidate.sourceMetaJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    const source = typeof record.source === "object" && record.source !== null && !Array.isArray(record.source)
      ? record.source as Record<string, unknown>
      : null;
    return record.schema === SELLERSPRITE_SOURCE_SCHEMA
      || source?.provider === "SellerSprite"
      || source?.type === "sellersprite_xlsx";
  } catch {
    return false;
  }
}

function validNullableText(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && value.trim().length > 0 && value.length <= MAX_STORED_TEXT_LENGTH);
}

function validNullableNumber(
  value: unknown,
  options: { min: number; max: number; integer?: boolean },
): value is number | null {
  return value === null
    || (typeof value === "number"
      && Number.isFinite(value)
      && value >= options.min
      && value <= options.max
      && (!options.integer || Number.isSafeInteger(value)));
}

function validNullableHttpsUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STORED_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

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
  if (meta.source.marketplace !== "Amazon US") return null;
  if (meta.source.reportType !== "SellerSprite Search Results") return null;
  if (meta.source.capturedAt !== null) return null;
  if (!/^[a-f0-9]{64}$/u.test(meta.source.sourceFileSha256)) return null;
  if (!/^[a-f0-9]{64}$/u.test(meta.source.rowHash)) return null;
  if (typeof meta.source.importedAt !== "string"
    || !Number.isFinite(Date.parse(meta.source.importedAt))) return null;
  if (meta.estimates?.disclaimer !== "third_party_estimate_point_in_time") return null;
  if (meta.identity.parentAsin !== null
    && !/^[A-Z0-9]{10}$/u.test(meta.identity.parentAsin)) return null;
  if (!validNullableHttpsUrl(meta.snapshot.imageUrl)) return null;
  if (!validNullableNumber(meta.snapshot.priceUsd, { min: 0, max: 1_000_000 })) return null;
  if (!validNullableNumber(meta.snapshot.rating, { min: 0, max: 5 })) return null;
  if (!validNullableNumber(meta.snapshot.reviewCount, { min: 0, max: 1_000_000_000, integer: true })) return null;
  if (!validNullableText(meta.snapshot.brand) || !validNullableText(meta.snapshot.category)) return null;
  if (!validNullableNumber(meta.estimates.searchRank, { min: 0, max: 1_000_000_000, integer: true })) return null;
  if (!validNullableNumber(meta.estimates.estimatedMonthlySales, { min: 0, max: 1_000_000_000, integer: true })) return null;
  if (!validNullableNumber(meta.estimates.estimatedMonthlyRevenueUsd, { min: 0, max: 1_000_000_000 })) return null;

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
  researchBlockReasonCode: CandidateResearchBlockReasonCode,
  researchActionMessage: string,
): CandidateResearchEligibility {
  return {
    allowed: false,
    researchAction: "research_blocked",
    researchBlockReasonCode,
    researchActionMessage,
    alreadyConverted: false,
    requiresRuntimeValidation: false,
    originKind,
    researchMode,
    promotionEligible: false,
    reasons: [reason],
  };
}

function converted(candidate: ResearchCandidate): CandidateResearchEligibility {
  const sellerSprite = claimsSellerSpriteMarketResearchSource(candidate);
  const productBatch = claimsProductBatchCandidateSource(candidate.sourceMetaJson);
  return {
    allowed: false,
    researchAction: "converted",
    researchBlockReasonCode: null,
    researchActionMessage: null,
    alreadyConverted: true,
    requiresRuntimeValidation: false,
    originKind: sellerSprite
      ? CANDIDATE_ORIGIN_KINDS.sellerSpriteMarketResearch
      : productBatch
        ? CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch
        : CANDIDATE_ORIGIN_KINDS.legacyMarketScreening,
    researchMode: sellerSprite || productBatch ? "market_research_only" : "legacy_r22_stage2",
    promotionEligible: false,
    reasons: ["candidate_already_linked"],
  };
}

export function evaluateStoredCandidateResearchEligibility(
  candidate: ResearchCandidate,
): CandidateResearchEligibility {
  if (candidate.convertedTaskId) return converted(candidate);

  // Frozen SellerSprite market-research source. `status = "pending"` stays
  // untouched; only terminal states and already-linked candidates are blocked.
  const sellerSpriteSource = parseSellerSpriteMarketResearchSource(candidate.sourceMetaJson);
  if (sellerSpriteSource) {
    const originKind = CANDIDATE_ORIGIN_KINDS.sellerSpriteMarketResearch;
    const researchMode = "market_research_only" as const;
    if (normalizedName(candidate.name) !== normalizedName(sellerSpriteSource.title)) {
      return blocked(
        originKind,
        researchMode,
        "seller_sprite_identity_mismatch",
        "source_contract_invalid",
        "该候选的商品身份与导入来源不一致，当前不能开始研究。",
      );
    }
    if (candidate.status !== "pending"
      && candidate.status !== "worth_analyzing"
      && candidate.status !== "analyzed") {
      return blocked(
        originKind,
        researchMode,
        "candidate_not_ready",
        candidate.status === "paused" ? "candidate_paused" : "candidate_rejected",
        candidate.status === "paused"
          ? "该候选已暂缓，当前不能开始研究。"
          : "该候选已放弃，当前不能开始研究。",
      );
    }
    return {
      allowed: true,
      researchAction: "research_available",
      researchBlockReasonCode: null,
      researchActionMessage: null,
      alreadyConverted: false,
      requiresRuntimeValidation: false,
      originKind,
      researchMode,
      promotionEligible: false,
      reasons: [],
      sellerSpriteSource,
    };
  }

  if (claimsSellerSpriteMarketResearchSource(candidate)) {
    return blocked(
      CANDIDATE_ORIGIN_KINDS.sellerSpriteMarketResearch,
      "market_research_only",
      "seller_sprite_source_invalid",
      "source_contract_invalid",
      "该候选的 SellerSprite 来源合同已变化或不完整，当前不能开始研究。",
    );
  }

  if (claimsProductBatchCandidateSource(candidate.sourceMetaJson)) {
    const originKind = CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch;
    const researchMode = "market_research_only" as const;
    const source = parseProductBatchCandidateSource(candidate.sourceMetaJson);
    if (!source) return blocked(
      originKind,
      researchMode,
      "product_batch_source_invalid",
      "source_contract_invalid",
      "该候选的批次来源合同已变化或不完整，当前不能开始研究。",
    );
    if (!isCandidateReadyForAgent(candidate.status)) {
      return blocked(
        originKind,
        researchMode,
        "candidate_not_ready",
        candidate.status === "paused" ? "candidate_paused"
          : candidate.status === "rejected" ? "candidate_rejected" : "candidate_not_ready",
        "该候选当前状态不允许开始研究。",
      );
    }
    if (candidate.originProductBatchItemId !== source.productBatchItemId) {
      return blocked(originKind, researchMode, "product_batch_item_binding_mismatch", "source_contract_invalid", "该候选的批次身份已变化，当前不能开始研究。");
    }
    if (normalizedName(candidate.name) !== normalizedName(source.productName)) {
      return blocked(originKind, researchMode, "product_batch_name_mismatch", "source_contract_invalid", "该候选的批次商品身份已变化，当前不能开始研究。");
    }
    const analysis = parseProductBatchCandidateAnalysis(candidate.analysisJson);
    if (!analysis
      || analysis.itemHash !== source.itemHash
      || analysis.evidenceHash !== source.evidenceHash) {
      return blocked(originKind, researchMode, "product_batch_analysis_binding_invalid", "source_contract_invalid", "该候选的批次研究证据已变化，当前不能开始研究。");
    }
    return {
      allowed: true,
      researchAction: "runtime_validation_required",
      researchBlockReasonCode: null,
      researchActionMessage: "进入研究前需要服务端再次校验来源。",
      alreadyConverted: false,
      requiresRuntimeValidation: true,
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
    return blocked(
      originKind,
      researchMode,
      "candidate_not_ready",
      candidate.status === "paused" ? "candidate_paused"
        : candidate.status === "rejected" ? "candidate_rejected" : "candidate_not_ready",
      "该候选尚未满足研究条件，请先核对商品身份和来源。",
    );
  }
  const r22Gate = evaluateR22StoredCandidateStage2Gate({
    candidateId: candidate.id,
    analysisJson: candidate.analysisJson,
  });
  if (!r22Gate.allowed) {
    return {
      allowed: false,
      researchAction: "research_blocked",
      researchBlockReasonCode: "research_gate_blocked",
      researchActionMessage: "该候选尚未通过当前研究门禁。",
      alreadyConverted: false,
      requiresRuntimeValidation: false,
      originKind,
      researchMode,
      promotionEligible: false,
      reasons: r22Gate.reasons,
    };
  }
  return {
    allowed: true,
    researchAction: "research_available",
    researchBlockReasonCode: null,
    researchActionMessage: null,
    alreadyConverted: false,
    requiresRuntimeValidation: false,
    originKind,
    researchMode,
    promotionEligible: true,
    reasons: [],
  };
}

export function projectStoredCandidateResearchAction(
  candidate: ResearchCandidate,
): CandidateResearchActionProjection {
  let projectionCandidate = candidate;
  if (candidate.originProductBatchItemId === undefined
    && claimsProductBatchCandidateSource(candidate.sourceMetaJson)) {
    const source = parseProductBatchCandidateSource(candidate.sourceMetaJson);
    if (source) {
      projectionCandidate = {
        ...candidate,
        originProductBatchItemId: source.productBatchItemId,
      };
    }
  }
  const eligibility = evaluateStoredCandidateResearchEligibility(projectionCandidate);
  return {
    researchAction: eligibility.researchAction,
    researchBlockReasonCode: eligibility.researchBlockReasonCode,
    researchActionMessage: eligibility.researchActionMessage,
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
      "source_contract_invalid",
      "该候选的批次访问范围已变化，当前不能开始研究。",
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
        "source_contract_invalid",
        "该候选的批次来源已不存在，当前不能开始研究。",
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
        "source_contract_invalid",
        "该候选的批次来源已变化，当前不能开始研究。",
      );
    }
    return {
      ...stored,
      researchAction: "research_available",
      researchActionMessage: null,
      requiresRuntimeValidation: false,
    };
  } catch {
    return blocked(
      CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
      "market_research_only",
      "product_batch_source_unavailable",
      "source_contract_invalid",
      "批次来源暂时无法校验，当前不能开始研究。",
    );
  }
}
