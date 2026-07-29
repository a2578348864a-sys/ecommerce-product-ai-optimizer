import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/server/demoGuard";
import { getAuthoritativeCandidate } from "@/lib/server/candidateAuthority";
import {
  buildCandidateAnalysisContext,
  createCandidateAnalysisBindingHash,
} from "@/lib/server/candidateAnalysisContext";
import { evaluateCandidateResearchEligibility } from "@/lib/server/candidateResearchEligibility";
import { getProductBatchStore } from "@/lib/server/productBatchStoreResolver";
import type { CandidateResearchContext } from "@/lib/candidateResearchContext";
import { readCandidateProductImageSnapshot } from "@/lib/productResearchImage";

export const runtime = "nodejs";

const NOT_FOUND = {
  ok: false,
  error: {
    code: "candidate_not_found",
    message: "候选不存在或不属于当前访问身份，请返回发现商品重新选择。",
  },
} as const;

function bounded(value: string, maxLength: number): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function notFound() {
  return NextResponse.json(NOT_FOUND, { status: 404 });
}

export async function GET(request: NextRequest) {
  const auth = requireAuthenticated(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: { code: auth.code, message: auth.message } },
      { status: auth.status },
    );
  }

  const candidateId = request.nextUrl.searchParams.get("candidateId")?.trim().slice(0, 80) || "";
  if (!candidateId) return notFound();

  const candidate = await getAuthoritativeCandidate(auth.context, candidateId);
  if (!candidate) return notFound();

  const eligibility = await evaluateCandidateResearchEligibility(auth.context, candidate);
  if (!eligibility.allowed) return notFound();

  const analysisContext = buildCandidateAnalysisContext(candidate);
  if (analysisContext.integrity === "unverified") return notFound();
  const contextHash = createCandidateAnalysisBindingHash(candidate, analysisContext);
  const capturedAt = analysisContext.facts.capturedAt;
  const imageSnapshot = readCandidateProductImageSnapshot(candidate.sourceMetaJson);
  const productImage = imageSnapshot
    ? {
      dataUrl: imageSnapshot.dataUrl,
      mimeType: imageSnapshot.mimeType,
      contentHash: imageSnapshot.contentHash,
      provenance: imageSnapshot.source === "sellersprite_product_batch"
        ? "product_batch_snapshot" as const
        : "candidate_fallback" as const,
    }
    : undefined;

  let data: CandidateResearchContext;
  if (eligibility.originKind === "seller_sprite_product_batch") {
    const source = eligibility.productBatchSource;
    if (!source) return notFound();
    let batch;
    try {
      batch = await getProductBatchStore(auth.context).getBatch(source.productBatchId);
    } catch {
      return notFound();
    }
    if (!batch) return notFound();
    data = {
      candidateId: candidate.id,
      productName: bounded(candidate.name, 120),
      sourceType: "seller_sprite_product_batch",
      sourceLabel: "SellerSprite ProductBatch",
      productBatchName: bounded(batch.batchName, 160),
      productBatchId: source.productBatchId,
      productBatchItemId: source.productBatchItemId,
      marketplace: source.marketplace,
      asin: source.asin,
      reportType: source.reportType,
      query: source.query,
      category: source.category,
      evidenceStatus: source.evidenceStatus,
      researchPriority: source.researchPriority,
      promotionEligible: false,
      sellerSpriteDisclaimerVersion: source.sellerSpriteDisclaimerVersion,
      capturedAt,
      contextHash,
      ...(productImage ? { productImage } : {}),
    };
  } else {
    const publicContext = analysisContext.integrity === "verified_public"
      ? analysisContext
      : null;
    if (!publicContext) return notFound();
    data = {
      candidateId: candidate.id,
      productName: bounded(candidate.name, 120),
      sourceType: "legacy_market_screening",
      sourceLabel: bounded(candidate.source || "发现商品 Candidate", 120),
      evidenceStatus: publicContext.integrity,
      researchPriority: publicContext.assessment.queueSuggestion,
      promotionEligible: false,
      capturedAt,
      contextHash,
      ...(productImage ? { productImage } : {}),
    };
  }

  return NextResponse.json({ ok: true, data }, { status: 200 });
}
