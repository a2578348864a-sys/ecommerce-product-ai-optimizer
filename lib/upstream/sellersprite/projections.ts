import {
  SELLERSPRITE_FIELD_KEYS,
  type SellerSpriteFieldKey,
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

export type SellerSpriteEvidenceUsagePolicy =
  | "screening_signal_only"
  | "display_only"
  | "hard_gate_ineligible"
  | "unsupported";

export interface SellerSpriteProviderEvidence {
  source: "SellerSprite";
  sourceType: "provider_metric";
  metricNature: SellerSpriteMetricNature;
  usagePolicy: SellerSpriteEvidenceUsagePolicy;
  fieldName: SellerSpriteFieldKey;
  raw: string | null;
  normalized: SellerSpriteNormalizedValue;
  unit: string | null;
  marketplace: "amazon.com";
  sourceFileSha256: string;
  appearanceIdentity: string;
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
  schemaVersion: "sellersprite-search-appearance.v1";
  appearanceIdentity: string;
  sourceRowNumber: number;
  asin: string | null;
  parentAsin: string | null;
  placementType: "sponsored" | "organic" | "unknown";
  page: number | null;
  position: number | null;
  providerEvidence: ReadonlyArray<SellerSpriteProviderEvidence>;
  warnings: ReadonlyArray<string>;
}

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
  | "variationCount";

export interface SellerSpriteResolvedProviderMetric {
  fieldName: SellerSpriteProductMetricField;
  nature: SellerSpriteMetricNature;
  source: "SellerSprite";
  sourceType: "provider_metric";
  usagePolicy: SellerSpriteEvidenceUsagePolicy;
  status: "resolved" | "missing" | "conflict";
  rawValues: ReadonlyArray<string | null>;
  normalizedValues: ReadonlyArray<SellerSpriteNormalizedValue>;
  normalized: SellerSpriteNormalizedValue;
  unit: string | null;
}

export interface SellerSpriteProductObservation {
  schemaVersion: "sellersprite-product-observation.v1";
  asin: string;
  parentAsin: string | null;
  parentAsins: ReadonlyArray<string>;
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  sponsoredAppearanceCount: number;
  organicAppearanceCount: number;
  unknownAppearanceCount: number;
  bestSponsoredPage: number | null;
  bestSponsoredPosition: number | null;
  bestOrganicPage: number | null;
  bestOrganicPosition: number | null;
  placementSummary: {
    sponsoredCount: number;
    organicCount: number;
    unknownCount: number;
    bestSponsoredPosition: { page: number; position: number } | null;
    bestOrganicPosition: { page: number; position: number } | null;
  };
  providerMetrics: Readonly<Record<SellerSpriteProductMetricField, SellerSpriteResolvedProviderMetric>>;
  missingMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  conflictingMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  missingProviderMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  conflictingProviderMetrics: ReadonlyArray<SellerSpriteProductMetricField>;
  warnings: ReadonlyArray<string>;
}

export interface SellerSpriteFamilyObservation {
  schemaVersion: "sellersprite-family-observation.v1";
  familyIdentity: string;
  parentAsin: string;
  childAsins: ReadonlyArray<string>;
  observedProductAsins: ReadonlyArray<string>;
  productCount: number;
  appearanceCount: number;
  sponsoredAppearanceCount: number;
  organicAppearanceCount: number;
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
];

function fieldValue(
  record: SellerSpriteRecord,
  field: SellerSpriteFieldKey,
): SellerSpriteFieldValue {
  return record[field] as SellerSpriteFieldValue;
}

function usagePolicy(field: SellerSpriteFieldKey): SellerSpriteEvidenceUsagePolicy {
  if (field === "asin" || field === "sku" || field === "brand" || field === "productTitle"
    || field === "productUrl" || field === "parentAsin" || field === "seller") {
    return "display_only";
  }
  if (field === "price" || field === "rating" || field === "reviews"
    || field === "searchRank" || field === "estimatedMonthlySales"
    || field === "estimatedMonthlyRevenue" || field === "variationCount") {
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
  return null;
}

function warningCodes(errors: ReadonlyArray<SellerSpritePrecheckError>): string[] {
  return [...new Set(errors.map((error) => (
    error.field ? `${error.code}:${error.field}` : error.code
  )))].sort();
}

function appearanceForRow(
  sourceFileSha256: string,
  row: SellerSpriteProjectionRow,
): SellerSpriteSearchAppearance {
  const placement = row.record.searchRank.normalized;
  const warnings = warningCodes(row.errors);
  const asin = row.record.asin.normalized;
  return {
    schemaVersion: "sellersprite-search-appearance.v1",
    appearanceIdentity: row.rowIdentity,
    sourceRowNumber: row.record.rowNumber,
    asin,
    parentAsin: row.record.parentAsin.normalized,
    placementType: placement?.placementType ?? "unknown",
    page: placement?.page ?? null,
    position: placement?.position ?? null,
    providerEvidence: SELLERSPRITE_FIELD_KEYS.map((field) => {
      const value = fieldValue(row.record, field);
      return {
        source: "SellerSprite",
        sourceType: "provider_metric",
        metricNature: value.metricNature,
        usagePolicy: usagePolicy(field),
        fieldName: field,
        raw: value.raw,
        normalized: value.normalized,
        unit: unit(field, value.normalized),
        marketplace: "amazon.com",
        sourceFileSha256,
        appearanceIdentity: row.rowIdentity,
        asin,
        capturedAt: value.capturedAt,
        capturedAtSemantics: value.capturedAtSemantics,
        ingestedAt: value.ingestedAt,
        exportedAt: value.exportedAt,
        providerUpdatedAt: value.providerUpdatedAt,
        freshnessStatus: "unknown",
        warnings,
      };
    }),
    warnings,
  };
}

function evidenceValue(
  appearance: SellerSpriteSearchAppearance,
  field: SellerSpriteProductMetricField,
): SellerSpriteProviderEvidence {
  const evidence = appearance.providerEvidence.find((item) => item.fieldName === field);
  if (!evidence) throw new Error(`SELLERSPRITE_PROVIDER_EVIDENCE_MISSING:${field}`);
  return evidence;
}

function resolveMetric(
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>,
  field: SellerSpriteProductMetricField,
): SellerSpriteResolvedProviderMetric {
  const evidence = appearances.map((appearance) => evidenceValue(appearance, field));
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
  rows: ReadonlyArray<SellerSpriteProjectionRow>,
): {
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  products: ReadonlyArray<SellerSpriteProductObservation>;
  families: ReadonlyArray<SellerSpriteFamilyObservation>;
} {
  const appearances = rows
    .map((row) => appearanceForRow(sourceFileSha256, row))
    .sort((left, right) => (
      left.sourceRowNumber - right.sourceRowNumber
      || sellerSpriteDeterministicStringCompare(
        left.appearanceIdentity,
        right.appearanceIdentity,
      )
    ));
  const grouped = new Map<string, SellerSpriteSearchAppearance[]>();
  for (const appearance of appearances) {
    if (appearance.asin === null) continue;
    const current = grouped.get(appearance.asin) ?? [];
    current.push(appearance);
    grouped.set(appearance.asin, current);
  }
  const products = [...grouped.entries()]
    .sort(([left], [right]) => sellerSpriteDeterministicStringCompare(left, right))
    .map(([asin, productAppearances]): SellerSpriteProductObservation => {
      const metrics = Object.fromEntries(PRODUCT_METRIC_FIELDS.map((field) => (
        [field, resolveMetric(productAppearances, field)]
      ))) as Record<SellerSpriteProductMetricField, SellerSpriteResolvedProviderMetric>;
      const missingProviderMetrics = PRODUCT_METRIC_FIELDS
        .filter((field) => metrics[field].status === "missing");
      const conflictingProviderMetrics = PRODUCT_METRIC_FIELDS
        .filter((field) => metrics[field].status === "conflict");
      const parentAsins = [...new Set(productAppearances
        .map((appearance) => appearance.parentAsin)
        .filter((value): value is string => value !== null))]
        .sort();
      return {
        schemaVersion: "sellersprite-product-observation.v1",
        asin,
        parentAsin: parentAsins.length === 1 ? parentAsins[0] : null,
        parentAsins,
        appearances: productAppearances,
        sponsoredAppearanceCount: productAppearances.filter(
          (appearance) => appearance.placementType === "sponsored",
        ).length,
        organicAppearanceCount: productAppearances.filter(
          (appearance) => appearance.placementType === "organic",
        ).length,
        unknownAppearanceCount: productAppearances.filter(
          (appearance) => appearance.placementType === "unknown",
        ).length,
        bestSponsoredPage: bestPosition(productAppearances, "sponsored")?.page ?? null,
        bestSponsoredPosition: bestPosition(productAppearances, "sponsored")?.position ?? null,
        bestOrganicPage: bestPosition(productAppearances, "organic")?.page ?? null,
        bestOrganicPosition: bestPosition(productAppearances, "organic")?.position ?? null,
        placementSummary: {
          sponsoredCount: productAppearances.filter(
            (appearance) => appearance.placementType === "sponsored",
          ).length,
          organicCount: productAppearances.filter(
            (appearance) => appearance.placementType === "organic",
          ).length,
          unknownCount: productAppearances.filter(
            (appearance) => appearance.placementType === "unknown",
          ).length,
          bestSponsoredPosition: bestPosition(productAppearances, "sponsored"),
          bestOrganicPosition: bestPosition(productAppearances, "organic"),
        },
        providerMetrics: metrics,
        missingMetrics: missingProviderMetrics,
        conflictingMetrics: conflictingProviderMetrics,
        missingProviderMetrics,
        conflictingProviderMetrics,
        warnings: [
          ...(productAppearances.length > 1 ? ["duplicate_asin"] : []),
          ...conflictingProviderMetrics.map((field) => `conflicting_provider_metric:${field}`),
          ...new Set(productAppearances.flatMap((appearance) => appearance.warnings)),
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
      const familyAppearanceRows = appearances.filter((appearance) => (
        appearance.asin !== null && observedProductAsins.includes(appearance.asin)
      ));
      const conflictingMetricWarnings = products
        .filter((product) => observedProductAsins.includes(product.asin))
        .flatMap((product) => product.conflictingProviderMetrics.map(
          (field) => `conflicting_provider_metric:${product.asin}:${field}`,
        ))
        .sort();
      return {
        schemaVersion: "sellersprite-family-observation.v1",
        familyIdentity: `sellersprite-family-${sellerSpriteStableHash({
          marketplace: "amazon.com",
          parentAsin,
        }).slice(0, 24)}`,
        parentAsin,
        childAsins: [...children].sort(),
        observedProductAsins,
        productCount: observedProductAsins.length,
        appearanceCount: familyAppearanceRows.length,
        sponsoredAppearanceCount: familyAppearanceRows.filter(
          (appearance) => appearance.placementType === "sponsored",
        ).length,
        organicAppearanceCount: familyAppearanceRows.filter(
          (appearance) => appearance.placementType === "organic",
        ).length,
        appearanceIdentities: familyAppearanceRows
          .map((appearance) => appearance.appearanceIdentity)
          .sort(),
        conflictingMetricWarnings,
        aggregationPolicy: "identity_only_no_metric_aggregation",
        warnings: ["provider_metrics_not_aggregated"],
      };
    });
  return { appearances, products, families };
}
