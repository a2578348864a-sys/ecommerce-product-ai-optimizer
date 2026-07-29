import "server-only";

import { randomUUID } from "node:crypto";

import type {
  ProductBatchItemInput,
  ProductBatchStore,
  ProductBatchView,
} from "@/lib/productBatchStore";
import {
  detectProductBatchCategory,
  type ProductBatchImportInspection,
} from "@/lib/productBatchPresentation";
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

function buildItems(input: {
  snapshot: ReturnType<typeof buildSellerSpriteMarketSnapshot>;
  shadow: ReturnType<typeof buildSellerSpriteBriefBoundShadowReport>;
  ranking: ReturnType<typeof rankSellerSpriteMarketSignals>;
}): ProductBatchItemInput[] {
  const products = new Map(input.snapshot.products.map((product) => [product.asin, product]));
  const shadow = new Map(input.shadow.products.map((product) => [product.asin, product]));
  return input.ranking.products.map((ranked, ordinal) => {
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
    return {
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
      imageSnapshotJson: JSON.stringify({ status: "not_cached" }),
    };
  });
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
  const items = buildItems({ snapshot, shadow, ranking });
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
    acceptedProductCount: items.length,
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
