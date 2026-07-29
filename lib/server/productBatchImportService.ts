import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  ProductBatchItemInput,
  ProductBatchStore,
  ProductBatchView,
} from "@/lib/productBatchStore";
import { PRODUCT_BATCH_MAX_IMAGE_BYTES } from "@/lib/productBatchContract";
import {
  detectProductBatchCategory,
  type ProductBatchImportInspection,
} from "@/lib/productBatchPresentation";
import {
  fetchSellerSpriteMainImage,
  type ProductBatchFetchedImage,
} from "@/lib/server/productBatchImageFetcher";
import { sellerSpriteStableHash } from "@/lib/upstream/sellersprite/canonical";
import { buildSellerSpriteBriefBoundShadowReport } from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import { rankSellerSpriteMarketSignals } from "@/lib/upstream/sellersprite/marketSignalRanking";
import { buildSellerSpriteMarketSnapshot } from "@/lib/upstream/sellersprite/marketSnapshot";
import {
  precheckSellerSpriteXlsx,
  type SellerSpritePrecheckResult,
} from "@/lib/upstream/sellersprite/precheck";
import type { SellerSpriteReportType } from "@/lib/upstream/sellersprite/reportType";
import { createSellerSpriteShadowSelectionBrief } from "@/lib/upstream/sellersprite/shadowBrief";
import {
  parseXlsxEmbeddedImages,
  type XlsxEmbeddedImage,
  type XlsxEmbeddedImageParseResult,
} from "@/lib/upstream/sellersprite/xlsx";

export const SELLERSPRITE_PRODUCT_BATCH_DISCLAIMER_VERSION =
  "sellersprite-v1-frozen.2026-07-27" as const;

export class ProductBatchImportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchImportError";
  }
}

export interface SellerSpriteProductBatchImportInput {
  store: ProductBatchStore;
  bytes: Uint8Array;
  sourceFileName: string;
  reportType: SellerSpriteReportType | null;
  query: string | null;
  category: string;
  priceMin: number;
  priceMax: number;
  now?: Date;
  fetchMainImage?: (url: string) => Promise<ProductBatchFetchedImage>;
}

export interface SellerSpriteProductBatchImportResult {
  batch: ProductBatchView;
  created: boolean;
}

export function inspectSellerSpriteProductBatch(
  bytes: Uint8Array,
  now = new Date(),
): ProductBatchImportInspection {
  if (Number.isNaN(now.getTime())) {
    fail("import_time_invalid", "Import time is invalid.");
  }
  const precheck = precheckSellerSpriteXlsx(bytes, {
    capturedAt: now.toISOString(),
  });
  if (precheck.reportType === "unknown") {
    const blocking = precheck.errors.some((error) => (
      error.severity === "error"
      && error.code !== "unsupported_report_type"
    ));
    if (blocking) workbookFailure(precheck);
    return {
      reportType: "unknown",
      reportTypeDetected: false,
      categoryDetection: detectProductBatchCategory({
        reportType: "unknown",
        rootCategories: [],
      }),
      query: null,
      queryDetection: "not_available",
    };
  }
  workbookFailure(precheck);
  return {
    reportType: precheck.reportType,
    reportTypeDetected: true,
    categoryDetection: detectProductBatchCategory({
      reportType: precheck.reportType,
      rootCategories: precheck.records
        .map((record) => record.rootCategory.normalized)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    }),
    query: null,
    queryDetection: "not_available",
  };
}

function fail(code: string, message: string): never {
  throw new ProductBatchImportError(code, message);
}

function workbookFailure(precheck: SellerSpritePrecheckResult): void {
  const fatal = precheck.errors.filter(
    (error) => error.severity === "error" && error.rowNumber === undefined,
  );
  if (fatal.some((error) => error.code === "report_type_mismatch")) {
    fail("report_type_mismatch", "Selected report type does not match the workbook.");
  }
  if (fatal.some((error) => error.code === "unsupported_report_type")) {
    fail("unsupported_report_type", "SellerSprite report type is unsupported.");
  }
  if (fatal.some((error) => error.code === "unsupported_sheet")) {
    fail("unsupported_sheet", "No supported SellerSprite US sheet was found.");
  }
  if (fatal.length > 0) {
    fail("unsafe_or_invalid_workbook", "SellerSprite workbook failed the frozen V1 precheck.");
  }
  if (precheck.acceptedRows === 0) {
    fail("no_accepted_rows", "SellerSprite workbook has no accepted product rows.");
  }
}

function toCents(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    fail("brief_validation_failed", `${field} must be a non-negative number.`);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    fail("brief_validation_failed", `${field} is too large.`);
  }
  return cents;
}

const PRODUCT_IMAGE_HEADERS = [
  "商品主图",
  "图片",
  "Main Image",
  "Product Image",
] as const;
const REMOTE_IMAGE_HEADERS = [
  "商品主图",
  "Main Image",
  "Product Image",
] as const;
const EMBEDDED_IMAGE_HEADER_PRIORITY = new Map([
  ["图片", 0],
  ["Image", 0],
  ["商品主图", 1],
  ["Main Image", 1],
  ["Product Image", 1],
]);

type VersionedImageSourceKind = "xlsx_embedded" | "xlsx_main_image_url";
type NotCachedReason =
  | "not_available"
  | "embedded_image_rejected"
  | "ambiguous_embedded_image"
  | "remote_url_rejected"
  | "remote_fetch_failed";

function cachedImageSnapshot(input: {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  sha256?: string;
  sourceKind: VersionedImageSourceKind;
  capturedAt: string;
}): string {
  const bytes = Buffer.from(input.bytes);
  return JSON.stringify({
    version: "product-batch-image-snapshot.v1",
    status: "cached",
    mimeType: input.mimeType,
    sizeBytes: bytes.byteLength,
    byteLength: bytes.byteLength,
    sha256: input.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
    base64: bytes.toString("base64"),
    sourceKind: input.sourceKind,
    capturedAt: input.capturedAt,
  });
}

function notCachedImageSnapshot(
  reason: NotCachedReason,
  capturedAt: string,
): string {
  return JSON.stringify({
    version: "product-batch-image-snapshot.v1",
    status: "not_cached",
    reason,
    capturedAt,
  });
}

function dataUrlImageSnapshot(
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>,
  asin: string,
  capturedAt: string,
): string | null {
  const dataUrls = new Set(snapshot.records
    .filter((record) => record.asin.normalized === asin)
    .flatMap((record) => PRODUCT_IMAGE_HEADERS.map((header) => record.extraRaw[header]))
    .filter((value): value is string => (
      typeof value === "string" && value.trim().startsWith("data:image/")
    ))
    .map((value) => value.trim()));
  if (dataUrls.size !== 1) return null;

  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
    [...dataUrls][0],
  );
  if (!match || match[2].length % 4 !== 0) {
    return null;
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0
    || bytes.length > PRODUCT_BATCH_MAX_IMAGE_BYTES
    || bytes.toString("base64") !== match[2]) {
    return null;
  }
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
  if ((match[1] === "image/jpeg" && !jpeg) || (match[1] === "image/png" && !png)) {
    return null;
  }
  return cachedImageSnapshot({
    bytes,
    mimeType: match[1] as "image/jpeg" | "image/png",
    sourceKind: "xlsx_embedded",
    capturedAt,
  });
}

function preferredEmbeddedImage(input: {
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>;
  embeddedImages: XlsxEmbeddedImageParseResult;
  asin: string;
}): { image: XlsxEmbeddedImage | null; reason: NotCachedReason | null } {
  const rows = new Set(input.snapshot.records
    .filter((record) => record.asin.normalized === input.asin)
    .map((record) => record.rowNumber));
  const candidates = input.embeddedImages.images
    .filter((image) => rows.has(image.rowNumber))
    .map((image) => ({
      image,
      priority: EMBEDDED_IMAGE_HEADER_PRIORITY.get(image.columnHeader ?? ""),
    }))
    .filter((candidate): candidate is { image: XlsxEmbeddedImage; priority: number } => (
      candidate.priority !== undefined
    ));
  if (candidates.length === 0) {
    const rejected = input.embeddedImages.rejected.some((image) => rows.has(image.rowNumber));
    return {
      image: null,
      reason: rejected ? "embedded_image_rejected" : null,
    };
  }
  const bestPriority = Math.min(...candidates.map((candidate) => candidate.priority));
  const preferred = candidates.filter((candidate) => candidate.priority === bestPriority);
  const uniqueByHash = new Map(preferred.map((candidate) => [
    candidate.image.sha256,
    candidate.image,
  ]));
  if (uniqueByHash.size !== 1) {
    return { image: null, reason: "ambiguous_embedded_image" };
  }
  return { image: [...uniqueByHash.values()][0], reason: null };
}

function uniqueImageFieldValues(
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>,
  asin: string,
): string[] {
  return [...new Set(snapshot.records
    .filter((record) => record.asin.normalized === asin)
    .flatMap((record) => REMOTE_IMAGE_HEADERS.map((header) => record.extraRaw[header]))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim()))];
}

async function productImageSnapshot(input: {
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>;
  embeddedImages: XlsxEmbeddedImageParseResult;
  asin: string;
  capturedAt: string;
  fetchMainImage: (url: string) => Promise<ProductBatchFetchedImage>;
}): Promise<string> {
  const embedded = preferredEmbeddedImage(input);
  if (embedded.image) {
    return cachedImageSnapshot({
      bytes: embedded.image.bytes,
      mimeType: embedded.image.mimeType,
      sha256: embedded.image.sha256,
      sourceKind: "xlsx_embedded",
      capturedAt: input.capturedAt,
    });
  }
  const dataUrl = dataUrlImageSnapshot(input.snapshot, input.asin, input.capturedAt);
  if (dataUrl) return dataUrl;

  const remoteValues = uniqueImageFieldValues(input.snapshot, input.asin)
    .filter((value) => !value.startsWith("data:"));
  if (remoteValues.length === 0) {
    return notCachedImageSnapshot(embedded.reason ?? "not_available", input.capturedAt);
  }
  if (remoteValues.length !== 1) {
    return notCachedImageSnapshot("remote_url_rejected", input.capturedAt);
  }
  try {
    const fetched = await input.fetchMainImage(remoteValues[0]);
    return cachedImageSnapshot({
      ...fetched,
      sourceKind: "xlsx_main_image_url",
      capturedAt: input.capturedAt,
    });
  } catch {
    return notCachedImageSnapshot("remote_fetch_failed", input.capturedAt);
  }
}

async function buildItems(input: {
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>;
  shadow: ReturnType<typeof buildSellerSpriteBriefBoundShadowReport>;
  ranking: ReturnType<typeof rankSellerSpriteMarketSignals>;
  embeddedImages: XlsxEmbeddedImageParseResult;
  capturedAt: string;
  fetchMainImage: (url: string) => Promise<ProductBatchFetchedImage>;
}): Promise<ProductBatchItemInput[]> {
  const products = new Map(input.snapshot.products.map((product) => [product.asin, product]));
  const shadow = new Map(input.shadow.products.map((product) => [product.asin, product]));
  const items: ProductBatchItemInput[] = [];
  for (const [ordinal, ranked] of input.ranking.products.entries()) {
    const product = products.get(ranked.asin);
    const shadowProduct = shadow.get(ranked.asin);
    if (!product || !shadowProduct) {
      fail("projection_integrity_failed", "SellerSprite projections disagree by ASIN.");
    }
    const family = input.snapshot.families.find(
      (candidate) => candidate.observedProductAsins.includes(ranked.asin),
    ) ?? null;
    const occurrenceProjection = {
      schemaVersion: "sellersprite-product-occurrence-projection.v1",
      reportType: input.snapshot.reportType,
      asin: ranked.asin,
      occurrences: product.occurrences,
    };
    const familyProjection = {
      schemaVersion: "sellersprite-product-family-projection.v1",
      reportType: input.snapshot.reportType,
      asin: ranked.asin,
      family,
    };
    const productKey = `amazon:US:${ranked.asin}`;
    items.push({
      productKey,
      ordinal,
      asin: ranked.asin,
      parentAsin: ranked.parentAsin,
      itemIdentityHash: sellerSpriteStableHash({
        schemaVersion: "product-batch-item-identity.v1",
        productKey,
        reportType: input.snapshot.reportType,
      }),
      itemHash: sellerSpriteStableHash(product),
      evidenceHash: sellerSpriteStableHash({
        providerMetrics: product.providerMetrics,
        occurrences: product.occurrences,
      }),
      normalizedProductJson: JSON.stringify(product),
      occurrenceProjectionJson: JSON.stringify(occurrenceProjection),
      familyProjectionJson: JSON.stringify(familyProjection),
      rankingJson: JSON.stringify(ranked),
      provisionalDisposition: shadowProduct.provisionalDisposition,
      researchPriority: ranked.researchPriority,
      evidenceStatus: ranked.evidenceStatus,
      promotionEligible: false,
      imageSnapshotJson: await productImageSnapshot({
        snapshot: input.snapshot,
        embeddedImages: input.embeddedImages,
        asin: ranked.asin,
        capturedAt: input.capturedAt,
        fetchMainImage: input.fetchMainImage,
      }),
    });
  }
  return items;
}

export async function importSellerSpriteProductBatch(
  input: SellerSpriteProductBatchImportInput,
): Promise<SellerSpriteProductBatchImportResult> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    fail("import_time_invalid", "Import time is invalid.");
  }
  const capturedAt = now.toISOString();
  const precheck = precheckSellerSpriteXlsx(input.bytes, {
    capturedAt,
    ...(input.reportType ? { expectedReportType: input.reportType } : {}),
  });
  if (!input.reportType && precheck.reportType === "unknown") {
    fail("report_type_required", "SellerSprite report type could not be detected.");
  }
  workbookFailure(precheck);
  const reportType = precheck.reportType as SellerSpriteReportType;
  const snapshot = buildSellerSpriteMarketSnapshot(precheck);
  let embeddedImages: XlsxEmbeddedImageParseResult;
  try {
    embeddedImages = parseXlsxEmbeddedImages(input.bytes, snapshot.sheetName);
  } catch {
    fail(
      "unsafe_or_invalid_workbook",
      "SellerSprite workbook drawing relationships are invalid.",
    );
  }
  const briefCommon = {
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    category: input.category,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    requiredSignals: reportType === "search_results"
      ? ["price", "rating", "reviews", "searchRank"]
      : ["price", "rating", "reviews"],
    optionalSignals: [
      "estimatedMonthlySales",
      "estimatedMonthlyRevenue",
      "variationCount",
    ],
    createdAt: capturedAt,
    briefSource: "product-batch-v1-unified-import",
  };
  let brief;
  try {
    brief = reportType === "search_results"
      ? createSellerSpriteShadowSelectionBrief({
          ...briefCommon,
          reportType,
          query: input.query ?? "",
        })
      : createSellerSpriteShadowSelectionBrief({
          ...briefCommon,
          reportType,
          query: null,
        });
  } catch {
    fail("brief_validation_failed", "SellerSprite selection brief is invalid.");
  }
  const shadow = buildSellerSpriteBriefBoundShadowReport(snapshot, brief);
  const ranking = rankSellerSpriteMarketSignals({ snapshot, brief });
  const manifest = {
    schemaVersion: "sellersprite-local-preview-manifest.v3",
    reportSchemaVersion: shadow.schemaVersion,
    rankingSchemaVersion: ranking.schemaVersion,
    modelVersion: ranking.modelVersion,
    rankingHash: ranking.rankingHash,
    reportType: snapshot.reportType,
    reportHash: shadow.reportHash,
    generatedAt: capturedAt,
    sourceFileSha256: snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: brief.briefHash,
    jsonFileName: null,
    jsonFileSha256: null,
    markdownFileName: null,
    markdownFileSha256: null,
    reportStatus: snapshot.rejectedRows === 0 ? "complete" : "partial",
    authoritative: false,
    promotionEligible: false,
    manifestRegistered: false,
    productionEffect: false,
    productionDatabaseWritten: false,
  } as const;
  const quality = {
    schemaVersion: "product-batch-quality-summary.v1",
    status: snapshot.rejectedRows === 0 ? "passed" : "passed_with_quarantine",
    acceptedProductCount: ranking.products.length,
    quarantinedRowCount: snapshot.rejectedRows,
    warningCounts: snapshot.warningCounts,
    missingSignals: snapshot.missingSignals,
  } as const;
  const created = await input.store.createOrReuseProcessingBatch({
    batchName: input.query
      ? `${input.category} · ${input.query}`
      : `${input.category} · 当前商品`,
    marketplace: "US",
    currency: "USD",
    reportType,
    query: brief.query,
    category: brief.category,
    priceMinCents: toCents(brief.priceMin, "priceMin"),
    priceMaxCents: toCents(brief.priceMax, "priceMax"),
    briefHash: brief.briefHash,
    sourceFileName: input.sourceFileName,
    sourceFileSha256: snapshot.sourceFileSha256,
    sellerSpriteDisclaimerVersion: SELLERSPRITE_PRODUCT_BATCH_DISCLAIMER_VERSION,
  });
  if (created.batch.batchStatus === "ready" || created.batch.batchStatus === "archived") {
    return created;
  }
  let processing = created.batch;
  if (processing.batchStatus === "blocked") {
    processing = await input.store.retryBlocked(processing.id);
  }
  if (processing.batchStatus !== "processing") {
    fail("batch_state_invalid", "Existing ProductBatch cannot resume this import.");
  }
  try {
    const items = await buildItems({
      snapshot,
      shadow,
      ranking,
      embeddedImages,
      capturedAt,
      fetchMainImage: input.fetchMainImage ?? fetchSellerSpriteMainImage,
    });
    await input.store.saveBatchItems(processing.id, items);
    const batch = await input.store.markReady(processing.id, {
      normalizedBusinessHash: snapshot.normalizedBusinessHash,
      snapshotHash: snapshot.sourceBoundSnapshotHash,
      manifestHash: sellerSpriteStableHash(manifest),
      itemCount: items.length + snapshot.rejectedRows,
      acceptedCount: items.length,
      quarantinedCount: snapshot.rejectedRows,
      dataQualityStatus: snapshot.rejectedRows === 0
        ? "passed"
        : "passed_with_quarantine",
      importedAt: now,
      sellerSpriteDisclaimerVersion: SELLERSPRITE_PRODUCT_BATCH_DISCLAIMER_VERSION,
      normalizedSnapshotJson: JSON.stringify(snapshot),
      manifestJson: JSON.stringify(manifest),
      qualitySummaryJson: JSON.stringify(quality),
      errorJson: null,
    });
    return { batch, created: created.created };
  } catch (error) {
    try {
      await input.store.markBlocked(processing.id, {
        errorJson: JSON.stringify({
          code: "product_batch_import_failed",
          requestId: randomUUID(),
        }),
        qualitySummaryJson: JSON.stringify(quality),
      });
    } catch {
      // Preserve the original import failure; the Store itself remains fail-closed.
    }
    throw error;
  }
}
