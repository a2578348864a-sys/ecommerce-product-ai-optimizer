import type {
  MarketScreeningBatchErrorCode,
  MarketScreeningBatchLoadResult,
  VerifiedMarketScreeningBatch,
  VerifiedUpstreamBatch,
} from "@/lib/marketScreeningBatchLoader";
import type { MarketScreeningArtifactKey } from "@/lib/marketScreeningBatchManifest";
import type {
  BatchReadiness,
  BatchReadinessReasonCode,
} from "@/lib/marketScreeningBatchReadiness";
import type {
  Stage15ScreeningPreviewItem,
  Stage15ScreeningPreviewView,
} from "@/lib/stage15ScreeningPreview";

type JsonRecord = Record<string, unknown>;
type EvidenceConfidence = "high" | "medium" | "low" | "unknown";

export type EvidenceField<T> = {
  value: T | null;
  source: MarketScreeningArtifactKey;
  capturedAt: string | null;
  confidence: EvidenceConfidence;
  missingReason: string | null;
};

export type MarketScreeningBriefView = {
  briefId: string;
  marketplace: EvidenceField<string>;
  market: EvidenceField<string>;
  query: EvidenceField<string>;
  targetScenario: EvidenceField<string>;
  priceRange: EvidenceField<{ currency: string; min: number; max: number }>;
  requiredEvidence: string[];
  hardExclusions: string[];
};

export type MarketScreeningSourceView = {
  sourceId: string;
  sourceBatchId: string;
  status: "completed" | "failed" | "blocked" | "pending";
  acceptedCount: number;
  quarantinedCount: number;
  reasonCodes: string[];
};

export type MarketScreeningBatchHealthView = {
  acceptedUniqueProductCount: number;
  imageAvailableCount: number;
  imageNotCachedCount: number;
  optionalDetailStatus: BatchReadiness["optionalDetailStatus"];
};

export type MarketScreeningGateSummaryView = {
  qualityPassedCount: number;
  minimumEvidencePassedCount: number;
  insufficientCount: number;
  reasonCodes: string[];
};

export type MarketScreeningStage1SummaryView = {
  rankingRunId: string;
  ruleVersion: string;
  inputCount: number;
  promoted: number;
  rejected: number;
  insufficientEvidence: number;
};

export type MarketScreeningStage15SummaryView = {
  screeningHash: string;
  advance: number;
  watch: number;
  reject: number;
  insufficient: number;
};

export type MarketScreeningItemView = {
  productKey: string;
  asin: string;
  status: "advance" | "watch" | "reject" | "insufficient";
  title: EvidenceField<string>;
  image: {
    status: "available" | "image_not_cached" | "image_integrity_failed";
    dataUrl: string | null;
  };
  price: EvidenceField<{ amount: number; currency: string }>;
  rating: EvidenceField<number>;
  reviewCount: EvidenceField<number>;
  features: EvidenceField<string[]>;
  detailEvidence: EvidenceField<Record<string, unknown>>;
  reasonCodes: string[];
  nextActions: string[];
};

export type MarketScreeningWorkbenchView = {
  manifestId: string;
  batchMode: "frozen_validation_batch";
  batchReadiness: BatchReadiness;
  brief: MarketScreeningBriefView;
  sourceRuns: MarketScreeningSourceView[];
  batchHealth: MarketScreeningBatchHealthView;
  gateSummary: MarketScreeningGateSummaryView;
  stage1Summary: MarketScreeningStage1SummaryView;
  stage15Summary: MarketScreeningStage15SummaryView;
  items: MarketScreeningItemView[];
};

export type MarketScreeningUpstreamView = {
  manifestId: string;
  batchMode: "frozen_validation_batch";
  batchReadiness: BatchReadiness & { status: "upstream_only" };
  brief: MarketScreeningBriefView;
  sourceRuns: MarketScreeningSourceView[];
  batchHealth: MarketScreeningBatchHealthView;
};

export type MarketScreeningWorkbenchRenderModel =
  | {
      status: "ready";
      readiness: "ready_full" | "ready_partial";
      view: MarketScreeningWorkbenchView;
    }
  | {
      status: "upstream_only";
      readiness: "upstream_only";
      view: MarketScreeningUpstreamView;
    }
  | {
      status: "blocked";
      readiness: "blocked";
      errorCode: MarketScreeningBatchErrorCode;
      reasonCodes: BatchReadinessReasonCode[];
    };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function evidence<T>(input: {
  value: T | null;
  source: MarketScreeningArtifactKey;
  capturedAt?: string | null;
  confidence?: EvidenceConfidence;
  missingReason?: string | null;
}): EvidenceField<T> {
  return {
    value: input.value,
    source: input.source,
    capturedAt: input.capturedAt ?? null,
    confidence: input.confidence ?? (input.value === null ? "unknown" : "high"),
    missingReason: input.missingReason ?? (input.value === null ? "not_available_in_verified_artifact" : null),
  };
}

function buildBrief(artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>): MarketScreeningBriefView {
  const brief = record(artifacts.selectionBrief);
  const capturedAt = text(brief.createdAt);
  const range = record(brief.targetPriceRange);
  const currency = text(range.currency);
  const min = number(range.min);
  const max = number(range.max);
  return {
    briefId: text(brief.briefId) ?? "unknown-brief",
    marketplace: evidence({ value: text(brief.marketplace), source: "selectionBrief", capturedAt }),
    market: evidence({ value: text(brief.market), source: "selectionBrief", capturedAt }),
    query: evidence({ value: text(brief.query), source: "selectionBrief", capturedAt }),
    targetScenario: evidence({ value: text(brief.targetScenario), source: "selectionBrief", capturedAt }),
    priceRange: evidence({
      value: currency && min !== null && max !== null ? { currency, min, max } : null,
      source: "selectionBrief",
      capturedAt,
    }),
    requiredEvidence: strings(brief.requiredEvidence),
    hardExclusions: strings(brief.hardExclusions),
  };
}

function sourceStatus(value: unknown): MarketScreeningSourceView["status"] {
  if (value === "completed") return "completed";
  if (value === "failed") return "failed";
  if (value === "blocked") return "blocked";
  return "pending";
}

function buildSources(artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>): MarketScreeningSourceView[] {
  const adapter = record(artifacts.sourceAdapterResult);
  const run = record(artifacts.collectionRun);
  const quality = record(adapter.qualitySummary);
  const reasonCodes = [
    ...strings(quality.errorCodes),
    ...(text(run.errorCode) ? [text(run.errorCode) as string] : []),
  ];
  return [{
    sourceId: text(adapter.sourceType) ?? "unknown-source",
    sourceBatchId: text(adapter.sourceBatchId) ?? "unknown-source-batch",
    status: sourceStatus(run.status),
    acceptedCount: number(adapter.acceptedCount) ?? 0,
    quarantinedCount: number(adapter.quarantinedCount) ?? 0,
    reasonCodes,
  }];
}

function visualCounts(
  artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>,
  preview?: Stage15ScreeningPreviewView,
) {
  if (preview) {
    return {
      available: preview.items.filter((item) => item.image.status === "available").length,
      notCached: preview.items.filter((item) => item.image.status === "image_not_cached").length,
    };
  }
  const items = records(record(artifacts.visualPacket).items);
  const statuses = items.map((item) => text(record(record(item.image).localAsset).status));
  return {
    available: statuses.filter((status) => status === "available").length,
    notCached: statuses.filter((status) => status === "not_cached").length,
  };
}

function buildHealth(
  readiness: BatchReadiness,
  artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>,
  preview?: Stage15ScreeningPreviewView,
): MarketScreeningBatchHealthView {
  const images = visualCounts(artifacts, preview);
  return {
    acceptedUniqueProductCount: readiness.acceptedUniqueProductCount,
    imageAvailableCount: images.available,
    imageNotCachedCount: images.notCached,
    optionalDetailStatus: readiness.optionalDetailStatus,
  };
}

function candidateMap(artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>) {
  return new Map(records(record(artifacts.importPackage).candidates).map((candidate) => [
    text(candidate.productKey) ?? "",
    candidate,
  ]));
}

function detailMap(artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>) {
  return new Map(records(record(artifacts.detailRun).pages).map((page) => [text(page.expectedAsin) ?? "", page]));
}

function previewMap(preview?: Stage15ScreeningPreviewView) {
  return new Map((preview?.items ?? []).map((item) => [item.productKey, item]));
}

function stage15Items(artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>) {
  return records(record(artifacts.stage15Run).items);
}

function productValue(candidate: JsonRecord, field: string) {
  const snapshot = record(candidate.evidenceSnapshot);
  const product = record(snapshot.product);
  return { snapshot, product, field: record(product[field]) };
}

function previewReasonCodes(item: Stage15ScreeningPreviewItem | undefined): string[] {
  if (!item) return [];
  return [...new Set([
    ...item.reasons.marketEvidence,
    ...item.reasons.humanGate,
    ...item.reasons.counterEvidence,
    ...item.reasons.missingEvidence,
  ])];
}

function buildItems(
  artifacts: Partial<Record<MarketScreeningArtifactKey, JsonRecord>>,
  preview?: Stage15ScreeningPreviewView,
): MarketScreeningItemView[] {
  const candidates = candidateMap(artifacts);
  const details = detailMap(artifacts);
  const previews = previewMap(preview);
  return stage15Items(artifacts).map((stageItem) => {
    const productKey = text(stageItem.productKey) ?? "unknown-product";
    const asin = /^amazon:US:([A-Z0-9]{10})$/u.exec(productKey)?.[1] ?? "unknown";
    const candidate = candidates.get(productKey) ?? {};
    const previewItem = previews.get(productKey);
    const title = productValue(candidate, "title");
    const price = productValue(candidate, "price");
    const rating = productValue(candidate, "rating");
    const reviewCount = productValue(candidate, "reviewCount");
    const capturedAt = text(title.snapshot.capturedAt);
    const priceCurrency = text(title.product.market) === "US" ? "USD" : "unknown";
    const detail = details.get(asin);
    const detailProduct = record(detail?.productEvidence);
    const features = strings(detailProduct.featureBullets);
    const detailCapturedAt = text(detail?.capturedAt);
    const statusValue = text(stageItem.status);
    const status = statusValue === "advance" || statusValue === "watch" || statusValue === "reject"
      || statusValue === "insufficient" ? statusValue : "insufficient";
    return {
      productKey,
      asin,
      status,
      title: evidence({
        value: text(title.field.normalizedValue),
        source: "importPackage",
        capturedAt,
        missingReason: text(title.field.missingReason),
      }),
      image: previewItem?.image ?? { status: "image_not_cached", dataUrl: null },
      price: evidence({
        value: number(price.field.normalizedValue) === null
          ? null
          : { amount: number(price.field.normalizedValue) as number, currency: priceCurrency },
        source: "importPackage",
        capturedAt,
        missingReason: text(price.field.missingReason),
      }),
      rating: evidence({
        value: number(rating.field.normalizedValue),
        source: "importPackage",
        capturedAt,
        missingReason: text(rating.field.missingReason),
      }),
      reviewCount: evidence({
        value: number(reviewCount.field.normalizedValue),
        source: "importPackage",
        capturedAt,
        missingReason: text(reviewCount.field.missingReason),
      }),
      features: evidence({
        value: detail && features.length > 0 ? features : null,
        source: "detailRun",
        capturedAt: detailCapturedAt,
        confidence: detail ? "medium" : "unknown",
        missingReason: detail ? text(record(detailProduct.missingReasons).featureBullets) : "detail_evidence_not_collected_for_item",
      }),
      detailEvidence: evidence({
        value: detail ? detailProduct : null,
        source: "detailRun",
        capturedAt: detailCapturedAt,
        confidence: detail ? "medium" : "unknown",
        missingReason: detail ? null : "detail_evidence_not_collected_for_item",
      }),
      reasonCodes: previewReasonCodes(previewItem),
      nextActions: previewItem?.nextValidationPlan ?? strings(stageItem.nextValidationPlan),
    };
  });
}

export function buildMarketScreeningWorkbenchView(
  batch: VerifiedMarketScreeningBatch,
  preview?: Stage15ScreeningPreviewView,
): MarketScreeningWorkbenchView {
  const artifacts = batch.artifacts;
  const summary = record(artifacts.stage1Summary);
  const decisions = record(summary.decisionCounts);
  const stage15 = record(artifacts.stage15Run);
  const partition = record(stage15.summary);
  const rankings = records(record(artifacts.stage1Ranking).results);
  const candidates = records(record(artifacts.importPackage).candidates);
  const qualityPassedCount = rankings.filter((item) => record(item.hardGateResult).passed === true).length;
  const minimumEvidencePassedCount = candidates.filter((item) => record(item.minimumEvidencePack).complete === true).length;
  const reasonCodes = [...new Set(rankings.flatMap((item) => strings(record(item.hardGateResult).errorCodes)))];

  return {
    manifestId: batch.manifest.manifestId,
    batchMode: batch.manifest.batchMode,
    batchReadiness: batch.batchReadiness,
    brief: buildBrief(artifacts),
    sourceRuns: buildSources(artifacts),
    batchHealth: buildHealth(batch.batchReadiness, artifacts, preview),
    gateSummary: {
      qualityPassedCount,
      minimumEvidencePassedCount,
      insufficientCount: number(decisions.insufficient_evidence) ?? 0,
      reasonCodes,
    },
    stage1Summary: {
      rankingRunId: text(summary.rankingRunId) ?? "unknown-ranking",
      ruleVersion: text(summary.rankingRuleVersion) ?? "unknown-rule",
      inputCount: number(summary.resultCount) ?? rankings.length,
      promoted: number(decisions.promoted) ?? 0,
      rejected: number(decisions.rejected) ?? 0,
      insufficientEvidence: number(decisions.insufficient_evidence) ?? 0,
    },
    stage15Summary: {
      screeningHash: text(stage15.screeningHash) ?? "unknown-screening",
      advance: number(partition.advance) ?? 0,
      watch: number(partition.watch) ?? 0,
      reject: number(partition.reject) ?? 0,
      insufficient: number(partition.insufficient) ?? 0,
    },
    items: buildItems(artifacts, preview),
  };
}

function buildUpstreamView(upstream: VerifiedUpstreamBatch): MarketScreeningUpstreamView {
  return {
    manifestId: upstream.manifest.manifestId,
    batchMode: upstream.manifest.batchMode,
    batchReadiness: upstream.batchReadiness,
    brief: buildBrief(upstream.artifacts),
    sourceRuns: buildSources(upstream.artifacts),
    batchHealth: buildHealth(upstream.batchReadiness, upstream.artifacts),
  };
}

export function buildMarketScreeningWorkbenchRenderModel(
  result: MarketScreeningBatchLoadResult,
  preview?: Stage15ScreeningPreviewView,
): MarketScreeningWorkbenchRenderModel {
  switch (result.status) {
    case "ready":
      return {
        status: "ready",
        readiness: result.batch.batchReadiness.status,
        view: buildMarketScreeningWorkbenchView(result.batch, preview),
      };
    case "upstream_only":
      return {
        status: "upstream_only",
        readiness: "upstream_only",
        view: buildUpstreamView(result.upstream),
      };
    case "blocked":
      return {
        status: "blocked",
        readiness: "blocked",
        errorCode: result.errorCode,
        reasonCodes: result.batchReadiness.reasonCodes,
      };
  }
}
