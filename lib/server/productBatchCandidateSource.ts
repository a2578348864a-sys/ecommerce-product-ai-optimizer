import "server-only";

import {
  assertProductBatchImageSnapshot,
  assertProductBatchItemForPersistence,
} from "@/lib/productBatchContract";
import type {
  ProductBatchItemView,
  ProductBatchView,
} from "@/lib/productBatchStore";

export const CANDIDATE_ORIGIN_KINDS = {
  legacyMarketScreening: "legacy_market_screening",
  sellerSpriteProductBatch: "seller_sprite_product_batch",
  sellerSpriteMarketResearch: "seller_sprite_market_research",
} as const;

export type CandidateOriginKind =
  typeof CANDIDATE_ORIGIN_KINDS[keyof typeof CANDIDATE_ORIGIN_KINDS];

export type ProductBatchCandidateProductFacts = Partial<Record<
  | "productTitle"
  | "brand"
  | "price"
  | "rating"
  | "reviews"
  | "estimatedMonthlySales"
  | "estimatedMonthlyRevenue"
  | "rootCategory"
  | "rootCategoryBsr"
  | "subCategory"
  | "subCategoryBsr"
  | "variationCount"
  | "sellerCount",
  string | number | boolean | null
>>;

export type ProductBatchCandidateSourceV1 = {
  version: "product-batch-candidate-source.v1";
  originKind: "seller_sprite_product_batch";
  productBatchId: string;
  productBatchItemId: string;
  serverIdentityScope: "owner:v1" | "visitor:sandbox";
  productKey: string;
  productName: string;
  marketplace: string;
  asin: string | null;
  parentAsin: string | null;
  reportType: "search_results" | "category_current";
  query: string | null;
  category: string | null;
  manifestHash: string;
  snapshotHash: string;
  itemIdentityHash: string;
  itemHash: string;
  evidenceHash: string;
  researchPriority: string;
  provisionalDisposition: string;
  evidenceStatus: string;
  promotionEligible: false;
  sellerSpriteDisclaimerVersion: string;
  imageSnapshot: Record<string, unknown>;
  productFacts: ProductBatchCandidateProductFacts;
  capturedAt: string;
};

export type ProductBatchCandidateAnalysisV1 = {
  version: "product_batch_research_entry.v1";
  originKind: "seller_sprite_product_batch";
  researchMode: "market_research_only";
  promotionEligible: false;
  evidenceHash: string;
  itemHash: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PRODUCT_FACT_FIELDS = [
  "productTitle",
  "brand",
  "price",
  "rating",
  "reviews",
  "estimatedMonthlySales",
  "estimatedMonthlyRevenue",
  "rootCategory",
  "rootCategoryBsr",
  "subCategory",
  "subCategoryBsr",
  "variationCount",
  "sellerCount",
] as const;
const SOURCE_FIELDS = new Set([
  "version",
  "originKind",
  "productBatchId",
  "productBatchItemId",
  "serverIdentityScope",
  "productKey",
  "productName",
  "marketplace",
  "asin",
  "parentAsin",
  "reportType",
  "query",
  "category",
  "manifestHash",
  "snapshotHash",
  "itemIdentityHash",
  "itemHash",
  "evidenceHash",
  "researchPriority",
  "provisionalDisposition",
  "evidenceStatus",
  "promotionEligible",
  "sellerSpriteDisclaimerVersion",
  "imageSnapshot",
  "productFacts",
  "capturedAt",
]);
const ANALYSIS_FIELDS = new Set([
  "version",
  "originKind",
  "researchMode",
  "promotionEligible",
  "evidenceHash",
  "itemHash",
]);
const RESEARCH_PRIORITIES = new Set([
  "priority_1",
  "priority_2",
  "priority_3",
  "unranked_insufficient_evidence",
]);
const PROVISIONAL_DISPOSITIONS = new Set([
  "provisional_score_only",
  "insufficient_hard_gate_evidence",
  "conflicting_provider_metrics",
  "insufficient_required_signals",
]);
const EVIDENCE_STATUSES = new Set([
  "sufficient_for_comparison",
  "limited_evidence",
  "insufficient_evidence",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function nullableBoundedText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  return boundedText(value, maxLength) ?? undefined;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 40
    && !Number.isNaN(Date.parse(value));
}

function safeScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return boundedText(value, 500) ?? undefined;
}

function parseProductFacts(value: unknown): ProductBatchCandidateProductFacts | null {
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !PRODUCT_FACT_FIELDS.includes(
    key as typeof PRODUCT_FACT_FIELDS[number],
  ))) {
    return null;
  }
  const facts: ProductBatchCandidateProductFacts = {};
  for (const field of PRODUCT_FACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
    const parsed = safeScalar(value[field]);
    if (parsed === undefined) return null;
    facts[field] = parsed;
  }
  return facts;
}

function productFactsFromItem(item: ProductBatchItemView): ProductBatchCandidateProductFacts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.normalizedProductJson);
  } catch {
    throw new Error("product_batch_item_normalized_product_invalid");
  }
  if (!isRecord(parsed) || !isRecord(parsed.providerMetrics)) {
    throw new Error("product_batch_item_normalized_product_invalid");
  }
  const facts: ProductBatchCandidateProductFacts = {};
  for (const field of PRODUCT_FACT_FIELDS) {
    const metric = parsed.providerMetrics[field];
    if (!isRecord(metric) || metric.status !== "resolved") continue;
    const normalized = safeScalar(metric.normalized);
    if (normalized !== undefined) facts[field] = normalized;
  }
  return facts;
}

function productNameFromFacts(
  facts: ProductBatchCandidateProductFacts,
  item: ProductBatchItemView,
): string {
  const title = boundedText(facts.productTitle, 500);
  if (title && title.length >= 2) return title.slice(0, 120);
  const identity = item.asin ?? boundedText(item.productKey, 200);
  if (!identity) throw new Error("product_batch_item_name_missing");
  return `Amazon 商品 ${identity}`.slice(0, 120);
}

export function buildProductBatchCandidateSource(input: {
  batch: ProductBatchView;
  item: ProductBatchItemView;
  serverIdentityScope: ProductBatchCandidateSourceV1["serverIdentityScope"];
}): ProductBatchCandidateSourceV1 {
  return deriveProductBatchCandidateSource(input, true);
}

function deriveProductBatchCandidateSource(input: {
  batch: ProductBatchView;
  item: ProductBatchItemView;
  serverIdentityScope: ProductBatchCandidateSourceV1["serverIdentityScope"];
}, requireReady: boolean): ProductBatchCandidateSourceV1 {
  const { batch, item } = input;
  if (batch.id !== item.batchId
    || (requireReady ? batch.batchStatus !== "ready" : !["ready", "archived"].includes(batch.batchStatus))) {
    throw new Error("product_batch_item_not_convertible");
  }
  assertProductBatchItemForPersistence(item);
  if (!batch.manifestHash || !batch.snapshotHash || !batch.sellerSpriteDisclaimerVersion) {
    throw new Error("product_batch_source_incomplete");
  }
  assertProductBatchImageSnapshot(item.imageSnapshotJson);
  const imageSnapshot: unknown = JSON.parse(item.imageSnapshotJson);
  if (!isRecord(imageSnapshot)) throw new Error("product_batch_image_snapshot_invalid");
  const productFacts = productFactsFromItem(item);
  const capturedAt = batch.importedAt ?? item.createdAt;
  if (!validIso(capturedAt)) throw new Error("product_batch_source_capture_time_invalid");

  return {
    version: "product-batch-candidate-source.v1",
    originKind: CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
    productBatchId: batch.id,
    productBatchItemId: item.id,
    serverIdentityScope: input.serverIdentityScope,
    productKey: item.productKey,
    productName: productNameFromFacts(productFacts, item),
    marketplace: batch.marketplace,
    asin: item.asin,
    parentAsin: item.parentAsin,
    reportType: batch.reportType,
    query: batch.query,
    category: batch.category,
    manifestHash: batch.manifestHash,
    snapshotHash: batch.snapshotHash,
    itemIdentityHash: item.itemIdentityHash,
    itemHash: item.itemHash,
    evidenceHash: item.evidenceHash,
    researchPriority: item.researchPriority,
    provisionalDisposition: item.provisionalDisposition,
    evidenceStatus: item.evidenceStatus,
    promotionEligible: false,
    sellerSpriteDisclaimerVersion: batch.sellerSpriteDisclaimerVersion,
    imageSnapshot,
    productFacts,
    capturedAt,
  };
}

export function productBatchCandidateSourceMatches(input: {
  source: ProductBatchCandidateSourceV1;
  batch: ProductBatchView;
  item: ProductBatchItemView;
  serverIdentityScope: ProductBatchCandidateSourceV1["serverIdentityScope"];
}): boolean {
  try {
    const expected = deriveProductBatchCandidateSource({
      batch: input.batch,
      item: input.item,
      serverIdentityScope: input.serverIdentityScope,
    }, false);
    return JSON.stringify(expected) === JSON.stringify(input.source);
  } catch {
    return false;
  }
}

export function buildProductBatchCandidateAnalysis(
  source: ProductBatchCandidateSourceV1,
): ProductBatchCandidateAnalysisV1 {
  return {
    version: "product_batch_research_entry.v1",
    originKind: CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
    researchMode: "market_research_only",
    promotionEligible: false,
    evidenceHash: source.evidenceHash,
    itemHash: source.itemHash,
  };
}

function decodeRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function claimsProductBatchCandidateSource(value: unknown): boolean {
  return decodeRecord(value)?.originKind === CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch;
}

export function parseProductBatchCandidateSource(
  value: unknown,
): ProductBatchCandidateSourceV1 | null {
  const record = decodeRecord(value);
  if (!record
    || Object.keys(record).some((key) => !SOURCE_FIELDS.has(key))
    || record.version !== "product-batch-candidate-source.v1"
    || record.originKind !== CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch
    || (record.serverIdentityScope !== "owner:v1"
      && record.serverIdentityScope !== "visitor:sandbox")
    || record.promotionEligible !== false
    || (record.reportType !== "search_results" && record.reportType !== "category_current")
    || !sha256(record.manifestHash)
    || !sha256(record.snapshotHash)
    || !sha256(record.itemIdentityHash)
    || !sha256(record.itemHash)
    || !sha256(record.evidenceHash)
    || !validIso(record.capturedAt)
  ) {
    return null;
  }
  const productBatchId = boundedText(record.productBatchId, 128);
  const productBatchItemId = boundedText(record.productBatchItemId, 128);
  const productKey = boundedText(record.productKey, 512);
  const productName = boundedText(record.productName, 120);
  const marketplace = boundedText(record.marketplace, 32);
  const asin = nullableBoundedText(record.asin, 32);
  const parentAsin = nullableBoundedText(record.parentAsin, 32);
  const query = nullableBoundedText(record.query, 240);
  const category = nullableBoundedText(record.category, 240);
  const researchPriority = boundedText(record.researchPriority, 80);
  const provisionalDisposition = boundedText(record.provisionalDisposition, 100);
  const evidenceStatus = boundedText(record.evidenceStatus, 100);
  const disclaimer = boundedText(record.sellerSpriteDisclaimerVersion, 128);
  const productFacts = parseProductFacts(record.productFacts);
  if (!productBatchId || !productBatchItemId || !productKey || !productName
    || productName.length < 2 || !marketplace || asin === undefined
    || parentAsin === undefined || query === undefined || category === undefined
    || !researchPriority || !provisionalDisposition || !evidenceStatus
    || !RESEARCH_PRIORITIES.has(researchPriority)
    || !PROVISIONAL_DISPOSITIONS.has(provisionalDisposition)
    || !EVIDENCE_STATUSES.has(evidenceStatus)
    || !disclaimer || !productFacts || !isRecord(record.imageSnapshot)) {
    return null;
  }
  try {
    assertProductBatchImageSnapshot(JSON.stringify(record.imageSnapshot));
  } catch {
    return null;
  }
  return {
    version: "product-batch-candidate-source.v1",
    originKind: CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
    productBatchId,
    productBatchItemId,
    serverIdentityScope: record.serverIdentityScope,
    productKey,
    productName,
    marketplace,
    asin,
    parentAsin,
    reportType: record.reportType,
    query,
    category,
    manifestHash: record.manifestHash,
    snapshotHash: record.snapshotHash,
    itemIdentityHash: record.itemIdentityHash,
    itemHash: record.itemHash,
    evidenceHash: record.evidenceHash,
    researchPriority,
    provisionalDisposition,
    evidenceStatus,
    promotionEligible: false,
    sellerSpriteDisclaimerVersion: disclaimer,
    imageSnapshot: record.imageSnapshot,
    productFacts,
    capturedAt: record.capturedAt,
  };
}

export function parseProductBatchCandidateAnalysis(
  value: unknown,
): ProductBatchCandidateAnalysisV1 | null {
  const record = decodeRecord(value);
  if (!record
    || Object.keys(record).some((key) => !ANALYSIS_FIELDS.has(key))
    || record.version !== "product_batch_research_entry.v1"
    || record.originKind !== CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch
    || record.researchMode !== "market_research_only"
    || record.promotionEligible !== false
    || !sha256(record.evidenceHash)
    || !sha256(record.itemHash)
  ) {
    return null;
  }
  return {
    version: "product_batch_research_entry.v1",
    originKind: CANDIDATE_ORIGIN_KINDS.sellerSpriteProductBatch,
    researchMode: "market_research_only",
    promotionEligible: false,
    evidenceHash: record.evidenceHash,
    itemHash: record.itemHash,
  };
}
