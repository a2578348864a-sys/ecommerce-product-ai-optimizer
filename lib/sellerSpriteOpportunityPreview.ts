import type {
  SellerSpriteBriefBoundShadowReport,
  SellerSpriteProvisionalDisposition,
} from "@/lib/upstream/sellersprite/briefBoundShadowReport";
import type {
  SellerSpriteConcentrationSummary,
  SellerSpriteMarketNumericSummaries,
  SellerSpriteMarketSnapshot,
} from "@/lib/upstream/sellersprite/marketSnapshot";
import type {
  SellerSpriteProductMetricField,
  SellerSpriteProductObservation,
} from "@/lib/upstream/sellersprite/projections";
import type { SellerSpriteReportType } from "@/lib/upstream/sellersprite/reportType";
import type { SellerSpriteBsrNormalizedValue } from "@/lib/upstream/sellersprite/fields";

export const SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION =
  "sellersprite-opportunity-preview.v2" as const;
export const SELLERSPRITE_PREVIEW_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const SELLERSPRITE_PREVIEW_MAX_REQUEST_BYTES =
  SELLERSPRITE_PREVIEW_MAX_FILE_BYTES + 64 * 1024;

export interface SellerSpritePreviewConcentration {
  status: SellerSpriteConcentrationSummary["status"];
  entityCount: number;
  validShareCount: number;
  missingShareCount: number;
  topEntity: string | null;
  topShare: number | null;
  top3Share: number | null;
}

export interface SellerSpritePreviewProduct {
  reportType: SellerSpriteReportType;
  asin: string;
  title: string | null;
  brand: string | null;
  parentAsin: string | null;
  price: number | null;
  estimatedMonthlySales: number | null;
  rating: number | null;
  reviews: number | null;
  variationCount: number | null;
  occurrenceCount: number;
  appearanceCount: number | null;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  unknownAppearanceCount: number | null;
  bestSponsoredPage: number | null;
  bestSponsoredPosition: number | null;
  bestOrganicPage: number | null;
  bestOrganicPosition: number | null;
  rootCategory: string | null;
  rootCategoryBsr: SellerSpriteBsrNormalizedValue;
  subCategory: string | null;
  subCategoryBsr: SellerSpriteBsrNormalizedValue;
  missingSignals: ReadonlyArray<string>;
  conflictingSignals: ReadonlyArray<string>;
  priceBandStatus: "within" | "outside" | "missing" | "conflict";
  provisionalDisposition: SellerSpriteProvisionalDisposition;
  authoritative: false;
  promotionEligible: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
}

export interface SellerSpriteOpportunityPreviewViewModel {
  schemaVersion: typeof SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION;
  reportType: SellerSpriteReportType;
  requestId: string;
  reportStatus: "complete" | "partial";
  sourceFileName: string;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  briefHash: string;
  reportHash: string;
  source: "SellerSprite";
  sourceType: "provider_metric";
  authoritative: false;
  promotionAllowed: false;
  hardGateEvaluable: false;
  currentStage1Invoked: false;
  productionEffect: false;
  productionDatabaseWritten: false;
  manifestRegistered: false;
  marketplace: "amazon.com";
  market: "US";
  currency: "USD";
  query: string | null;
  category: string;
  priceMin: number;
  priceMax: number;
  sheetName: string;
  headerColumnCount: number;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  occurrenceCount: number;
  occurrenceLabel: "Search Appearance" | "Category Current 记录";
  appearanceCount: number | null;
  productCount: number;
  familyCount: number;
  uniqueAsinCount: number;
  duplicateOccurrenceGroupCount: number;
  duplicateAppearanceGroupCount: number | null;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  unknownAppearanceCount: number | null;
  placementSummary: SellerSpriteMarketSnapshot["placementSummary"];
  categoryBsrSummary: SellerSpriteMarketSnapshot["categoryBsrSummary"];
  warningCounts: Readonly<Record<string, number>>;
  conflictCount: number;
  missingSignals: ReadonlyArray<string>;
  fieldMapping: SellerSpriteMarketSnapshot["fieldMapping"];
  fieldCoverage: SellerSpriteMarketSnapshot["fieldCoverage"];
  metricNatureCoverage: SellerSpriteMarketSnapshot["metricNatureCoverage"];
  productWeightedStatistics: SellerSpriteMarketNumericSummaries;
  occurrenceWeightedStatistics: SellerSpriteMarketNumericSummaries;
  appearanceWeightedStatistics: SellerSpriteMarketNumericSummaries | null;
  brandConcentration: SellerSpritePreviewConcentration;
  sellerConcentration: SellerSpritePreviewConcentration;
  products: ReadonlyArray<SellerSpritePreviewProduct>;
}

function resolvedNumber(
  product: SellerSpriteProductObservation,
  field: Extract<
    SellerSpriteProductMetricField,
    | "price"
    | "estimatedMonthlySales"
    | "rating"
    | "reviews"
    | "variationCount"
    | "rootCategoryBsr"
    | "subCategoryBsr"
  >,
): number | null {
  const metric = product.providerMetrics[field];
  return metric.status === "resolved" && typeof metric.normalized === "number"
    ? metric.normalized
    : null;
}

function resolvedString(
  product: SellerSpriteProductObservation,
  field: Extract<
    SellerSpriteProductMetricField,
    "brand" | "productTitle" | "rootCategory" | "subCategory"
  >,
): string | null {
  const metric = product.providerMetrics[field];
  return metric.status === "resolved" && typeof metric.normalized === "string"
    ? metric.normalized
    : null;
}

function resolvedBsr(
  product: SellerSpriteProductObservation,
  field: "rootCategoryBsr" | "subCategoryBsr",
): SellerSpriteBsrNormalizedValue {
  const metric = product.providerMetrics[field];
  if (metric.status !== "resolved") return null;
  if (typeof metric.normalized === "number" || Array.isArray(metric.normalized)) {
    return metric.normalized as SellerSpriteBsrNormalizedValue;
  }
  return null;
}

function projectConcentration(
  input: SellerSpriteConcentrationSummary,
): SellerSpritePreviewConcentration {
  return {
    status: input.status,
    entityCount: input.entityCount,
    validShareCount: input.validShareCount,
    missingShareCount: input.missingShareCount,
    topEntity: input.topEntity,
    topShare: input.topShare,
    top3Share: input.top3Share,
  };
}

function assertReadOnlyShadowContract(report: SellerSpriteBriefBoundShadowReport): void {
  if (
    report.authoritative !== false
    || report.promotionAllowed !== false
    || report.hardGateEvaluable !== false
    || report.currentStage1Invoked !== false
    || report.productionEffect !== false
    || report.productionDatabaseWritten !== false
    || report.manifestRegistered !== false
  ) {
    throw new Error("SELLERSPRITE_PREVIEW_READ_ONLY_CONTRACT_VIOLATION");
  }
}

export function buildSellerSpriteOpportunityPreviewViewModel(input: {
  requestId: string;
  sourceFileName: string;
  headerColumnCount: number;
  snapshot: SellerSpriteMarketSnapshot;
  report: SellerSpriteBriefBoundShadowReport;
}): SellerSpriteOpportunityPreviewViewModel {
  const { snapshot, report } = input;
  assertReadOnlyShadowContract(report);
  if (
    snapshot.sourceFileSha256 !== report.sourceFileSha256
    || snapshot.sourceBoundSnapshotHash !== report.sourceBoundSnapshotHash
    || snapshot.normalizedBusinessHash !== report.normalizedBusinessHash
    || snapshot.reportType !== report.reportType
  ) {
    throw new Error("SELLERSPRITE_PREVIEW_SNAPSHOT_REPORT_MISMATCH");
  }
  if (report.brief.category.trim() === "") {
    throw new Error("SELLERSPRITE_PREVIEW_CATEGORY_REQUIRED");
  }

  const reportByAsin = new Map(report.products.map((product) => [product.asin, product]));
  const products = snapshot.products.map((product): SellerSpritePreviewProduct => {
    const shadow = reportByAsin.get(product.asin);
    if (!shadow) throw new Error("SELLERSPRITE_PREVIEW_PRODUCT_REPORT_MISMATCH");
    return {
      reportType: snapshot.reportType,
      asin: product.asin,
      title: resolvedString(product, "productTitle"),
      brand: resolvedString(product, "brand"),
      parentAsin: product.parentAsin,
      price: resolvedNumber(product, "price"),
      estimatedMonthlySales: resolvedNumber(product, "estimatedMonthlySales"),
      rating: resolvedNumber(product, "rating"),
      reviews: resolvedNumber(product, "reviews"),
      variationCount: resolvedNumber(product, "variationCount"),
      occurrenceCount: product.occurrenceCount,
      appearanceCount: snapshot.reportType === "search_results"
        ? product.appearances.length
        : null,
      sponsoredAppearanceCount: product.sponsoredAppearanceCount,
      organicAppearanceCount: product.organicAppearanceCount,
      unknownAppearanceCount: product.unknownAppearanceCount,
      bestSponsoredPage: product.bestSponsoredPage,
      bestSponsoredPosition: product.bestSponsoredPosition,
      bestOrganicPage: product.bestOrganicPage,
      bestOrganicPosition: product.bestOrganicPosition,
      rootCategory: resolvedString(product, "rootCategory"),
      rootCategoryBsr: resolvedBsr(product, "rootCategoryBsr"),
      subCategory: resolvedString(product, "subCategory"),
      subCategoryBsr: resolvedBsr(product, "subCategoryBsr"),
      missingSignals: shadow.missingSignals,
      conflictingSignals: shadow.conflictingSignals,
      priceBandStatus: shadow.briefPriceBandResult.status,
      provisionalDisposition: shadow.provisionalDisposition,
      authoritative: false,
      promotionEligible: false,
      productionEffect: false,
      productionDatabaseWritten: false,
      manifestRegistered: false,
    };
  });

  return {
    schemaVersion: SELLERSPRITE_OPPORTUNITY_PREVIEW_SCHEMA_VERSION,
    reportType: snapshot.reportType,
    requestId: input.requestId,
    reportStatus: snapshot.rejectedRows === 0 ? "complete" : "partial",
    sourceFileName: input.sourceFileName,
    sourceFileSha256: snapshot.sourceFileSha256,
    sourceBoundSnapshotHash: snapshot.sourceBoundSnapshotHash,
    normalizedBusinessHash: snapshot.normalizedBusinessHash,
    briefHash: report.briefHash,
    reportHash: report.reportHash,
    source: "SellerSprite",
    sourceType: "provider_metric",
    authoritative: false,
    promotionAllowed: false,
    hardGateEvaluable: false,
    currentStage1Invoked: false,
    productionEffect: false,
    productionDatabaseWritten: false,
    manifestRegistered: false,
    marketplace: "amazon.com",
    market: "US",
    currency: "USD",
    query: report.brief.query,
    category: report.brief.category,
    priceMin: report.brief.priceMin,
    priceMax: report.brief.priceMax,
    sheetName: snapshot.sheetName,
    headerColumnCount: input.headerColumnCount,
    totalRows: snapshot.totalRows,
    acceptedRows: snapshot.acceptedRows,
    rejectedRows: snapshot.rejectedRows,
    occurrenceCount: snapshot.occurrences.length,
    occurrenceLabel: snapshot.reportType === "search_results"
      ? "Search Appearance"
      : "Category Current 记录",
    appearanceCount: snapshot.reportType === "search_results"
      ? snapshot.appearances.length
      : null,
    productCount: snapshot.products.length,
    familyCount: snapshot.families.length,
    uniqueAsinCount: snapshot.uniqueAsinCount,
    duplicateOccurrenceGroupCount: snapshot.products.filter(
      (product) => product.occurrences.length > 1,
    ).length,
    duplicateAppearanceGroupCount: snapshot.reportType === "search_results"
      ? snapshot.products.filter((product) => product.appearances.length > 1).length
      : null,
    sponsoredAppearanceCount: snapshot.sponsoredPlacementCount,
    organicAppearanceCount: snapshot.organicPlacementCount,
    unknownAppearanceCount: snapshot.unknownPlacementCount,
    placementSummary: snapshot.placementSummary,
    categoryBsrSummary: snapshot.categoryBsrSummary,
    warningCounts: snapshot.warningCounts,
    conflictCount: Object.values(report.conflictCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    missingSignals: report.missingSignals,
    fieldMapping: snapshot.fieldMapping,
    fieldCoverage: snapshot.fieldCoverage,
    metricNatureCoverage: snapshot.metricNatureCoverage,
    productWeightedStatistics: snapshot.productWeightedSummary,
    occurrenceWeightedStatistics: snapshot.occurrenceWeightedSummary,
    appearanceWeightedStatistics: snapshot.appearanceWeightedSummary,
    brandConcentration: projectConcentration(snapshot.brandConcentrationSummary),
    sellerConcentration: projectConcentration(snapshot.sellerConcentrationSummary),
    products,
  };
}
