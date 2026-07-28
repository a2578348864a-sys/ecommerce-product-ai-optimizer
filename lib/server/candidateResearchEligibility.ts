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
};

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
