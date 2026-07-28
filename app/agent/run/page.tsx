import type { Metadata } from "next";
import { AgentRunClient, type AgentRunSourceMeta } from "@/components/agent/AgentRunClient";
import { parseCandidateEvidenceParam } from "@/lib/candidateEvidence";
import { parseR22MarketDecisionSnapshot } from "@/lib/r22DecisionModel";

export const metadata: Metadata = {
  title: "商品研究 - 轻选 Agent",
  description: "分三阶段理解商品、研究市场并准备 Listing 与图片方案，最终由人工确认。",
};

type AgentRunSearchParams = {
  product?: string | string[];
  productName?: string | string[];
  source?: string | string[];
  from?: string | string[];
  entry?: string | string[];
  opportunityTitle?: string | string[];
  sourceTitle?: string | string[];
  opportunityScore?: string | string[];
  opportunitySource?: string | string[];
  keyword?: string | string[];
  candidateType?: string | string[];
  sourceUrl?: string | string[];
  candidateId?: string | string[];
  originalName?: string | string[];
  analyzedName?: string | string[];
  evidence?: string | string[];
  r22Market?: string | string[];
  sourceMeta?: string | string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeDecode(value: string | undefined) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseProductBatchSourceMeta(
  raw: string | undefined,
  candidateId: string | undefined,
): AgentRunSourceMeta | null {
  if (!raw || !candidateId) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const meta = parsed as Record<string, unknown>;
  const text = (value: unknown, max: number) => (
    typeof value === "string" && value.trim() && value.length <= max
      ? value.trim()
      : null
  );
  const productName = text(meta.productName, 240);
  const productBatchId = text(meta.productBatchId, 128);
  const productBatchItemId = text(meta.productBatchItemId, 128);
  const marketplace = text(meta.marketplace, 32);
  const reportType = meta.reportType === "search_results" || meta.reportType === "category_current"
    ? meta.reportType
    : null;
  const researchPriority = text(meta.researchPriority, 80);
  const evidenceStatus = text(meta.evidenceStatus, 100);
  const evidenceHash = text(meta.evidenceHash, 64);
  const disclaimer = text(meta.sellerSpriteDisclaimerVersion, 128);
  const capturedAt = text(meta.capturedAt, 40);
  if (meta.version !== "product-batch-agent-run-source.v1"
    || meta.originKind !== "seller_sprite_product_batch"
    || meta.researchMode !== "market_research_only"
    || meta.promotionEligible !== false
    || !productName || !productBatchId || !productBatchItemId || !marketplace
    || !reportType || !researchPriority || !evidenceStatus
    || !evidenceHash || !/^[a-f0-9]{64}$/.test(evidenceHash)
    || !disclaimer || !capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    return null;
  }
  const nullableText = (value: unknown, max: number): string | null | undefined => {
    if (value === null) return null;
    return text(value, max) ?? undefined;
  };
  const asin = nullableText(meta.asin, 32);
  const query = nullableText(meta.query, 240);
  const category = nullableText(meta.category, 240);
  if (asin === undefined || query === undefined || category === undefined) return null;
  return {
    source: "opportunity",
    opportunityTitle: productName,
    opportunitySource: "SellerSprite ProductBatch",
    candidateId,
    sourceTitle: productName,
    originalName: productName,
    analyzedName: productName,
    originKind: "seller_sprite_product_batch",
    productBatchId,
    productBatchItemId,
    marketplace,
    asin,
    reportType,
    query,
    category,
    researchPriority,
    evidenceStatus,
    evidenceHash,
    sellerSpriteDisclaimerVersion: disclaimer,
    researchMode: "market_research_only",
    promotionEligible: false,
    importedAt: capturedAt,
  };
}

function productNameFromProductBatchMeta(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const productName = (parsed as { productName?: unknown }).productName;
    return typeof productName === "string" && productName.trim()
      ? productName.trim().slice(0, 240)
      : undefined;
  } catch {
    return undefined;
  }
}

function sourceMetaFromParams(params: AgentRunSearchParams, productName?: string): AgentRunSourceMeta | null {
  if (firstParam(params.source) !== "opportunity" || !productName) return null;

  const opportunityScoreRaw = firstParam(params.opportunityScore);
  const opportunityScoreNumber = opportunityScoreRaw === undefined ? Number.NaN : Number(opportunityScoreRaw);
  const opportunityScore = Number.isFinite(opportunityScoreNumber)
    ? Math.min(100, Math.max(0, Math.round(opportunityScoreNumber)))
    : undefined;
  const sourceTitle = safeDecode(firstParam(params.sourceTitle));
  const opportunityTitle = safeDecode(firstParam(params.opportunityTitle)) || sourceTitle || productName;
  const opportunitySource = safeDecode(firstParam(params.opportunitySource));
  const keyword = safeDecode(firstParam(params.keyword));
  const candidateType = safeDecode(firstParam(params.candidateType));
  const sourceUrl = safeDecode(firstParam(params.sourceUrl));
  const candidateId = safeDecode(firstParam(params.candidateId));
  const productBatchMeta = parseProductBatchSourceMeta(firstParam(params.sourceMeta), candidateId);
  if (productBatchMeta && productBatchMeta.opportunityTitle === productName) {
    return productBatchMeta;
  }
  const from = safeDecode(firstParam(params.from));
  const entry = safeDecode(firstParam(params.entry));
  const originalName = safeDecode(firstParam(params.originalName));
  const analyzedName = safeDecode(firstParam(params.analyzedName));
  const evidenceSnapshot = parseCandidateEvidenceParam(firstParam(params.evidence));
  let r22MarketDecisionSnapshot = null;
  const r22MarketRaw = firstParam(params.r22Market);
  if (r22MarketRaw) {
    try {
      r22MarketDecisionSnapshot = parseR22MarketDecisionSnapshot(JSON.parse(r22MarketRaw));
    } catch {
      r22MarketDecisionSnapshot = null;
    }
  }

  return {
    source: "opportunity",
    ...(from === "opportunity" ? { from } : {}),
    ...(entry === "candidate_to_agent_m1" || entry === "candidate_to_agent_run" ? { entry } : {}),
    opportunityTitle,
    ...(opportunitySource ? { opportunitySource } : {}),
    ...(opportunityScore !== undefined ? { opportunityScore } : {}),
    ...(keyword ? { keyword } : {}),
    ...(candidateType ? { candidateType } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(candidateId ? { candidateId } : {}),
    ...(sourceTitle ? { sourceTitle } : {}),
    ...(originalName ? { originalName } : {}),
    ...(analyzedName ? { analyzedName } : {}),
    ...(evidenceSnapshot ? { evidenceSnapshot } : {}),
    ...(r22MarketDecisionSnapshot ? { r22MarketDecisionSnapshot } : {}),
    importedAt: new Date().toISOString(),
  };
}

export default async function AgentRunPage({
  searchParams,
}: {
  searchParams: Promise<AgentRunSearchParams>;
}) {
  const params = await searchParams;
  const initialProductName = safeDecode(firstParam(params.productName))
    || safeDecode(firstParam(params.product))
    || productNameFromProductBatchMeta(firstParam(params.sourceMeta));
  const initialSourceMeta = sourceMetaFromParams(params, initialProductName);

  return (
    <AgentRunClient
      initialProductName={initialProductName}
      initialSourceMeta={initialSourceMeta}
    />
  );
}
