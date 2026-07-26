import {
  SELLERSPRITE_FIELD_KEYS,
  type SellerSpriteFieldApplicability,
  type SellerSpriteFieldKey,
  type SellerSpriteBsrNormalizedValue,
  type SellerSpriteMetricNature,
  type SellerSpriteNormalizedValue,
} from "./fields";
import {
  sellerSpriteDeterministicStringCompare,
  sellerSpriteStableHash,
} from "./canonical";
import type {
  SellerSpriteFieldValue,
  SellerSpritePrecheckError,
  SellerSpriteRecord,
} from "./precheck";
import type { SellerSpriteReportType } from "./reportType";

export type SellerSpriteEvidenceUsagePolicy =
  | "screening_signal_only"
  | "display_only"
  | "hard_gate_ineligible"
  | "unsupported";

export interface SellerSpriteProviderEvidence {
  source: "SellerSprite";
  sourceType: "provider_metric";
  metricNature: SellerSpriteMetricNature;
  applicability: SellerSpriteFieldApplicability;
  usagePolicy: SellerSpriteEvidenceUsagePolicy;
  fieldName: SellerSpriteFieldKey;
  raw: string | null;
  normalized: SellerSpriteNormalizedValue;
  unit: string | null;
  marketplace: "amazon.com";
  sourceFileSha256: string;
  occurrenceIdentity: string;
  appearanceIdentity: string | null;
  asin: string | null;
  capturedAt: string;
  capturedAtSemantics: "caller_supplied_ingestion_context";
  ingestedAt: string;
  exportedAt: null;
  providerUpdatedAt: null;
  freshnessStatus: "unknown";
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteSearchAppearance {
  schemaVersion: "sellersprite-search-appearance.v2";
  occurrenceType: "search_appearance";
  appearanceIdentity: string;
  occurrenceIdentity: string;
  sourceRowNumber: number;
  asin: string | null;
  parentAsin: string | null;
  placementType: "sponsored" | "organic" | "unknown";
  page: number | null;
  position: number | null;
  providerEvidence: ReadonlyArray<SellerSpriteProviderEvidence>;
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteCategoryCurrentRecord {
  schemaVersion: "sellersprite-category-current-record.v1";
  occurrenceType: "category_current_record";
  occurrenceIdentity: string;
  sourceRowNumber: number;
  asin: string | null;
  parentAsin: string | null;
  ordinalRaw: string | null;
  rootCategory: SellerSpriteFieldValue<string | null>;
  rootCategoryBsr: SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue>;
  subCategory: SellerSpriteFieldValue<string | null>;
  subCategoryBsr: SellerSpriteFieldValue<SellerSpriteBsrNormalizedValue>;
  providerEvidence: ReadonlyArray<SellerSpriteProviderEvidence>;
  warnings: ReadonlyArray<string>;
}

export type SellerSpriteSourceOccurrence =
  | SellerSpriteSearchAppearance
  | SellerSpriteCategoryCurrentRecord;

export type SellerSpriteProductMetricField =
  | "sku"
  | "brand"
  | "productTitle"
  | "productUrl"
  | "parentAsin"
  | "price"
  | "rating"
  | "reviews"
  | "estimatedMonthlySales"
  | "estimatedMonthlyRevenue"
  | "seller"
  | "variationCount"
  | "rootCategory"
  | "rootCategoryBsr"
  | "subCategory"
  | "subCategoryBsr";

export interface SellerSpriteResolvedProviderMetric {
  fieldName: SellerSpriteProductMetricField;
  nature: SellerSpriteMetricNature;
  source: "SellerSprite";
  sourceType: "provider_metric";
  usagePolicy: SellerSpriteEvidenceUsagePolicy;
  status: "resolved" | "missing" | "conflict";
  applicability: "available" | "missing" | "conflicting";
  rawValues: ReadonlyArray<string | null>;
  normalizedValues: ReadonlyArray<SellerSpriteNormalizedValue>;
  normalized: SellerSpriteNormalizedValue;
  unit: string | null;
}

export interface SellerSpriteProductPlacementSummary {
  status: "available" | "not_applicable";
  sponsoredCount: number | null;
  organicCount: number | null;
  unknownCount: number | null;
  bestSponsoredPosition: { page: number; position: number } | null;
  bestOrganicPosition: { page: number; position: number } | null;
}

export interface SellerSpriteCategoryEvidenceSummary {
  rootCategory: SellerSpriteResolvedProviderMetric;
  rootCategoryBsr: SellerSpriteResolvedProviderMetric;
  subCategory: SellerSpriteResolvedProviderMetric;
  subCategoryBsr: SellerSpriteResolvedProviderMetric;
}

export interface SellerSpriteProductObservation {
  schemaVersion: "sellersprite-product-observation.v2";
  reportType: SellerSpriteReportType;
  asin: string;
  parentAsin: string | null;
  parentAsins: ReadonlyArray<string>;
  occurrences: ReadonlyArray<SellerSpriteSourceOccurrence>;
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  categoryRecords: ReadonlyArray<SellerSpriteCategoryCurrentRecord>;
  occurrenceCount: number;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  unknownAppearanceCount: number | null;
  bestSponsoredPage: number | null;
  bestSponsoredPosition: number | null;
  bestOrganicPage: number | null;
  bestOrganicPosition: number | null;
  placementSummary: SellerSpriteProductPlacementSummary;
  categoryEvidenceSummary: SellerSpriteCategoryEvidenceSummary;
  providerMetrics: Readonly<Record<SellerSpriteProductMetricField, SellerSpriteResolvedProviderMetric>>;
  missingMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  conflictingMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  missingProviderMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  conflictingProviderMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteFamilyObservation {
  schemaVersion: "sellersprite-family-observation.v2";
  reportType: SellerSpriteReportType;
  familyIdentity: string;
  parentAsin: string;
  childAsins: ReadonlyArray<string>;
  observedProductAsins: ReadonlyArray<string>;
  productCount: number;
  occurrenceCount: number;
  appearanceCount: number | null;
  sponsoredAppearanceCount: number | null;
  organicAppearanceCount: number | null;
  occurrenceIdentities: ReadonlyArray<string>;
  appearanceIdentities: ReadonlyArray<string>;
  conflictingMetricWarnings: ReadonlyArray<string>;
  aggregationPolicy: "identity_only_no_metric_aggregation";
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteProjectionRow {
  rowIdentity: string;
  record: SellerSpriteRecord;
  errors: ReadonlyArray<SellerSpritePrecheckError>;
}

const PRODUCT_METRIC_FIELDS: ReadonlyArray<SellerSpriteProductMetricField> = [
  "sku",
  "brand",
  "productTitle",
  "productUrl",
  "parentAsin",
  "price",
  "rating",
  "reviews",
  "estimatedMonthlySales",
  "estimatedMonthlyRevenue",
  "seller",
  "variationCount",
  "rootCategory",
  "rootCategoryBsr",
  "subCategory",
  "subCategoryBsr",
];

function fieldValue(
  record: SellerSpriteRecord,
  field: SellerSpriteFieldKey,
): SellerSpriteFieldValue {
  return record[field] as SellerSpriteFieldValue;
}

function usagePolicy(field: SellerSpriteFieldKey): SellerSpriteEvidenceUsagePolicy {
  if (
    field === "asin"
    || field === "sku"
    || field === "brand"
    || field === "productTitle"
    || field === "productUrl"
    || field === "parentAsin"
    || field === "seller"
    || field === "rootCategory"
    || field === "subCategory"
  ) {
    return "display_only";
  }
  if (
    field === "price"
    || field === "rating"
    || field === "reviews"
    || field === "searchRank"
    || field === "estimatedMonthlySales"
    || field === "estimatedMonthlyRevenue"
    || field === "variationCount"
    || field === "rootCategoryBsr"
    || field === "subCategoryBsr"
  ) {
    return "screening_signal_only";
  }
  return "unsupported";
}

function unit(
  field: SellerSpriteFieldKey,
  normalized: SellerSpriteNormalizedValue,
): string | null {
  if (normalized === null) return null;
  if (field === "price" || field === "estimatedMonthlyRevenue") return "USD";
  if (field === "estimatedMonthlySales") return "units_per_month_estimate";
  if (field === "rating") return "score_0_5";
  if (field === "reviews" || field === "variationCount") return "count";
  if (field === "searchRank") return "search_placement";
  if (field === "rootCategoryBsr" || field === "subCategoryBsr") return "bsr_rank";
  return null;
}

function warningCodes(errors: ReadonlyArray<SellerSpritePrecheckError>): string[] {
  return [...new Set(errors.map((error) => (
    error.field ? `${error.code}:${error.field}` : error.code
  )))].sort();
}

function providerEvidence(
  sourceFileSha256: string,
  row: SellerSpriteProjectionRow,
  reportType: SellerSpriteReportType,
): SellerSpriteProviderEvidence[] {
  const warnings = warningCodes(row.errors);
  const asin = row.record.asin.normalized;
  return SELLERSPRITE_FIELD_KEYS.map((field) => {
    const value = fieldValue(row.record, field);
    return {
      source: "SellerSprite",
      sourceType: "provider_metric",
      metricNature: value.metricNature,
      applicability: value.applicability,
      usagePolicy: usagePolicy(field),
      fieldName: field,
      raw: value.raw,
      normalized: value.normalized,
      unit: unit(field, value.normalized),
      marketplace: "amazon.com",
      sourceFileSha256,
      occurrenceIdentity: row.rowIdentity,
      appearanceIdentity: reportType === "search_results" ? row.rowIdentity : null,
      asin,
      capturedAt: value.capturedAt,
      capturedAtSemantics: value.capturedAtSemantics,
      ingestedAt: value.ingestedAt,
      exportedAt: value.exportedAt,
      providerUpdatedAt: value.providerUpdatedAt,
      freshnessStatus: "unknown",
      warnings,
    };
  });
}

function occurrenceForRow(
  sourceFileSha256: string,
  reportType: SellerSpriteReportType,
  row: SellerSpriteProjectionRow,
): SellerSpriteSourceOccurrence {
  const warnings = warningCodes(row.errors);
  const evidence = providerEvidence(sourceFileSha256, row, reportType);
  if (reportType === "search_results") {
    const placement = row.record.searchRank.normalized;
    return {
      schemaVersion: "sellersprite-search-appearance.v2",
      occurrenceType: "search_appearance",
      appearanceIdentity: row.rowIdentity,
      occurrenceIdentity: row.rowIdentity,
      sourceRowNumber: row.record.rowNumber,
      asin: row.record.asin.normalized,
      parentAsin: row.record.parentAsin.normalized,
      placementType: placement?.placementType ?? "unknown",
      page: placement?.page ?? null,
      position: placement?.position ?? null,
      providerEvidence: evidence,
      warnings,
    };
  }
  return {
    schemaVersion: "sellersprite-category-current-record.v1",
    occurrenceType: "category_current_record",
    occurrenceIdentity: row.rowIdentity,
    sourceRowNumber: row.record.rowNumber,
    asin: row.record.asin.normalized,
    parentAsin: row.record.parentAsin.normalized,
    ordinalRaw: row.record.extraRaw["#"] ?? null,
    rootCategory: row.record.rootCategory,
    rootCategoryBsr: row.record.rootCategoryBsr,
    subCategory: row.record.subCategory,
    subCategoryBsr: row.record.subCategoryBsr,
    providerEvidence: evidence,
    warnings,
  };
}

function evidenceValue(
  occurrence: SellerSpriteSourceOccurrence,
  field: SellerSpriteProductMetricField,
): SellerSpriteProviderEvidence {
  const evidence = occurrence.providerEvidence.find((item) => item.fieldName === field);
  if (!evidence) throw new Error(`SELLERSPRITE_PROVIDER_EVIDENCE_MISSING:${field}`);
  return evidence;
}

function resolveMetric(
  occurrences: ReadonlyArray<SellerSpriteSourceOccurrence>,
  field: SellerSpriteProductMetricField,
): SellerSpriteResolvedProviderMetric {
  const evidence = occurrences.map((occurrence) => evidenceValue(occurrence, field));
  const normalizedValues = evidence.map((item) => item.normalized);
  const distinct = new Map<string, SellerSpriteNormalizedValue>();
  for (const value of normalizedValues) {
    if (value === null) continue;
    distinct.set(JSON.stringify(value), value);
  }
  const status = distinct.size === 0 ? "missing" : distinct.size === 1 ? "resolved" : "conflict";
  return {
    fieldName: field,
    nature: evidence[0]?.metricNature ?? "unknown",
    source: "SellerSprite",
    sourceType: "provider_metric",
    usagePolicy: evidence[0]?.usagePolicy ?? "unsupported",
    status,
    applicability: status === "resolved"
      ? "available"
      : status === "conflict"
        ? "conflicting"
        : "missing",
    rawValues: evidence.map((item) => item.raw),
    normalizedValues,
    normalized: status === "resolved" ? [...distinct.values()][0] : null,
    unit: evidence[0]?.unit ?? null,
  };
}

function bestPosition(
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>,
  placementType: "sponsored" | "organic",
): { page: number; position: number } | null {
  const positions = appearances
    .filter((appearance) => (
      appearance.placementType === placementType
      && appearance.page !== null
      && appearance.position !== null
    ))
    .map((appearance) => ({ page: appearance.page!, position: appearance.position! }))
    .sort((left, right) => left.page - right.page || left.position - right.position);
  return positions[0] ?? null;
}

export function buildSellerSpriteOfflineProjections(
  sourceFileSha256: string,
  reportType: SellerSpriteReportType,
  rows: ReadonlyArray<SellerSpriteProjectionRow>,
): {
  occurrences: ReadonlyArray<SellerSpriteSourceOccurrence>;
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  categoryRecords: ReadonlyArray<SellerSpriteCategoryCurrentRecord>;
  products: ReadonlyArray<SellerSpriteProductObservation>;
  families: ReadonlyArray<SellerSpriteFamilyObservation>;
} {
  const occurrences = rows
    .map((row) => occurrenceForRow(sourceFileSha256, reportType, row))
    .sort((left, right) => (
      left.sourceRowNumber - right.sourceRowNumber
      || sellerSpriteDeterministicStringCompare(
        left.occurrenceIdentity,
        right.occurrenceIdentity,
      )
    ));
  const appearances = occurrences.filter(
    (occurrence): occurrence is SellerSpriteSearchAppearance => (
      occurrence.occurrenceType === "search_appearance"
    ),
  );
  const categoryRecords = occurrences.filter(
    (occurrence): occurrence is SellerSpriteCategoryCurrentRecord => (
      occurrence.occurrenceType === "category_current_record"
    ),
  );
  const grouped = new Map<string, SellerSpriteSourceOccurrence[]>();
  for (const occurrence of occurrences) {
    if (occurrence.asin === null) continue;
    const current = grouped.get(occurrence.asin) ?? [];
    current.push(occurrence);
    grouped.set(occurrence.asin, current);
  }
  const products = [...grouped.entries()]
    .sort(([left], [right]) => sellerSpriteDeterministicStringCompare(left, right))
    .map(([asin, productOccurrences]): SellerSpriteProductObservation => {
      const productAppearances = productOccurrences.filter(
        (occurrence): occurrence is SellerSpriteSearchAppearance => (
          occurrence.occurrenceType === "search_appearance"
        ),
      );
      const productCategoryRecords = productOccurrences.filter(
        (occurrence): occurrence is SellerSpriteCategoryCurrentRecord => (
          occurrence.occurrenceType === "category_current_record"
        ),
      );
      const metrics = Object.fromEntries(PRODUCT_METRIC_FIELDS.map((field) => (
        [field, resolveMetric(productOccurrences, field)]
      ))) as Record<SellerSpriteProductMetricField, SellerSpriteResolvedProviderMetric>;
      const missingProviderMetrics = PRODUCT_METRIC_FIELDS
        .filter((field) => metrics[field].status === "missing");
      const conflictingProviderMetrics = PRODUCT_METRIC_FIELDS
        .filter((field) => metrics[field].status === "conflict");
      const parentAsins = [...new Set(productOccurrences
        .map((occurrence) => occurrence.parentAsin)
        .filter((value): value is string => value !== null))]
        .sort();
      const bestSponsored = bestPosition(productAppearances, "sponsored");
      const bestOrganic = bestPosition(productAppearances, "organic");
      const searchReport = reportType === "search_results";
      return {
        schemaVersion: "sellersprite-product-observation.v2",
        reportType,
        asin,
        parentAsin: parentAsins.length === 1 ? parentAsins[0] : null,
        parentAsins,
        occurrences: productOccurrences,
        appearances: productAppearances,
        categoryRecords: productCategoryRecords,
        occurrenceCount: productOccurrences.length,
        sponsoredAppearanceCount: searchReport
          ? productAppearances.filter((item) => item.placementType === "sponsored").length
          : null,
        organicAppearanceCount: searchReport
          ? productAppearances.filter((item) => item.placementType === "organic").length
          : null,
        unknownAppearanceCount: searchReport
          ? productAppearances.filter((item) => item.placementType === "unknown").length
          : null,
        bestSponsoredPage: searchReport ? bestSponsored?.page ?? null : null,
        bestSponsoredPosition: searchReport ? bestSponsored?.position ?? null : null,
        bestOrganicPage: searchReport ? bestOrganic?.page ?? null : null,
        bestOrganicPosition: searchReport ? bestOrganic?.position ?? null : null,
        placementSummary: searchReport ? {
          status: "available",
          sponsoredCount: productAppearances.filter(
            (item) => item.placementType === "sponsored",
          ).length,
          organicCount: productAppearances.filter(
            (item) => item.placementType === "organic",
          ).length,
          unknownCount: productAppearances.filter(
            (item) => item.placementType === "unknown",
          ).length,
          bestSponsoredPosition: bestSponsored,
          bestOrganicPosition: bestOrganic,
        } : {
          status: "not_applicable",
          sponsoredCount: null,
          organicCount: null,
          unknownCount: null,
          bestSponsoredPosition: null,
          bestOrganicPosition: null,
        },
        categoryEvidenceSummary: {
          rootCategory: metrics.rootCategory,
          rootCategoryBsr: metrics.rootCategoryBsr,
          subCategory: metrics.subCategory,
          subCategoryBsr: metrics.subCategoryBsr,
        },
        providerMetrics: metrics,
        missingMetrics: missingProviderMetrics,
        conflictingMetrics: conflictingProviderMetrics,
        missingProviderMetrics,
        conflictingProviderMetrics,
        warnings: [
          ...(productOccurrences.length > 1 ? ["duplicate_asin"] : []),
          ...conflictingProviderMetrics.map((field) => `conflicting_provider_metric:${field}`),
          ...new Set(productOccurrences.flatMap((occurrence) => occurrence.warnings)),
        ].sort(),
      };
    });

  const familyChildren = new Map<string, Set<string>>();
  for (const product of products) {
    if (product.parentAsin === null || product.asin === product.parentAsin) continue;
    const children = familyChildren.get(product.parentAsin) ?? new Set<string>();
    children.add(product.asin);
    familyChildren.set(product.parentAsin, children);
  }
  const observedAsins = new Set(products.map((product) => product.asin));
  const families = [...familyChildren.entries()]
    .sort(([left], [right]) => sellerSpriteDeterministicStringCompare(left, right))
    .map(([parentAsin, children]): SellerSpriteFamilyObservation => {
      const observedProductAsins = [
        ...(observedAsins.has(parentAsin) ? [parentAsin] : []),
        ...children,
      ].sort();
      const familyOccurrenceRows = occurrences.filter((occurrence) => (
        occurrence.asin !== null && observedProductAsins.includes(occurrence.asin)
      ));
      const familyAppearanceRows = familyOccurrenceRows.filter(
        (occurrence): occurrence is SellerSpriteSearchAppearance => (
          occurrence.occurrenceType === "search_appearance"
        ),
      );
      const conflictingMetricWarnings = products
        .filter((product) => observedProductAsins.includes(product.asin))
        .flatMap((product) => product.conflictingProviderMetrics.map(
          (field) => `conflicting_provider_metric:${product.asin}:${field}`,
        ))
        .sort();
      return {
        schemaVersion: "sellersprite-family-observation.v2",
        reportType,
        familyIdentity: `sellersprite-family-${sellerSpriteStableHash({
          marketplace: "amazon.com",
          reportType,
          parentAsin,
        }).slice(0, 24)}`,
        parentAsin,
        childAsins: [...children].sort(),
        observedProductAsins,
        productCount: observedProductAsins.length,
        occurrenceCount: familyOccurrenceRows.length,
        appearanceCount: reportType === "search_results" ? familyAppearanceRows.length : null,
        sponsoredAppearanceCount: reportType === "search_results"
          ? familyAppearanceRows.filter((item) => item.placementType === "sponsored").length
          : null,
        organicAppearanceCount: reportType === "search_results"
          ? familyAppearanceRows.filter((item) => item.placementType === "organic").length
          : null,
        occurrenceIdentities: familyOccurrenceRows
          .map((occurrence) => occurrence.occurrenceIdentity)
          .sort(),
        appearanceIdentities: familyAppearanceRows
          .map((appearance) => appearance.appearanceIdentity)
          .sort(),
        conflictingMetricWarnings,
        aggregationPolicy: "identity_only_no_metric_aggregation",
        warnings: ["provider_metrics_not_aggregated"],
      };
    });
  return { occurrences, appearances, categoryRecords, products, families };
}
