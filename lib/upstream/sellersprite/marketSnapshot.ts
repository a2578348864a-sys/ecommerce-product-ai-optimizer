import {
  sellerSpriteCanonicalCompare,
  sellerSpriteDeterministicStringCompare,
  sellerSpriteStableHash,
} from "./canonical";
import {
  SELLERSPRITE_FIELD_KEYS,
  type SellerSpriteFieldKey,
  type SellerSpriteMetricNature,
} from "./fields";
import type {
  SellerSpriteAggregateEvidence,
  SellerSpriteFieldValue,
  SellerSpritePrecheckResult,
  SellerSpriteRecord,
  SellerSpriteRejectedRecord,
} from "./precheck";
import {
  buildSellerSpriteOfflineProjections,
  type SellerSpriteFamilyObservation,
  type SellerSpriteProductMetricField,
  type SellerSpriteProductObservation,
  type SellerSpriteSearchAppearance,
} from "./projections";

const SCHEMA_VERSION = "sellersprite-market-snapshot.v2" as const;

export interface SellerSpriteNumericSummary {
  validCount: number;
  missingCount: number;
  conflictCount: number;
  minimum: number | null;
  median: number | null;
  maximum: number | null;
}

export interface SellerSpriteMarketNumericSummaries {
  price: SellerSpriteNumericSummary;
  estimatedMonthlySales: SellerSpriteNumericSummary;
  estimatedMonthlyRevenue: SellerSpriteNumericSummary;
  rating: SellerSpriteNumericSummary;
  reviews: SellerSpriteNumericSummary;
}

export interface SellerSpriteFieldCoverage {
  validCount: number;
  missingCount: number;
}

export interface SellerSpriteMetricNatureCoverage {
  fieldValueCount: number;
  validCount: number;
  missingCount: number;
}

export interface SellerSpriteSnapshotRecord extends SellerSpriteRecord {
  rowIdentity: string;
}

export interface SellerSpriteSnapshotRejectedRecord extends SellerSpriteRejectedRecord {
  rowIdentity: string;
}

export interface SellerSpriteConcentrationSummary {
  status: "available" | "missing" | "invalid";
  sheetName: string | null;
  entityCount: number;
  validShareCount: number;
  missingShareCount: number;
  topEntity: string | null;
  topShare: number | null;
  top3Share: number | null;
  rows: SellerSpriteAggregateEvidence["rows"];
}

export interface SellerSpriteMarketSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  sourceFileSha256: string;
  sourceBoundSnapshotHash: string;
  normalizedBusinessHash: string;
  source: "SellerSprite";
  sourceType: "provider_metric";
  marketplace: "amazon.com";
  market: "US";
  sheetName: string;
  ingestedAt: string;
  exportedAt: null;
  providerUpdatedAt: null;
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  warningCounts: Readonly<Record<string, number>>;
  fieldMapping: SellerSpritePrecheckResult["fieldMapping"];
  fieldCoverage: Readonly<Record<SellerSpriteFieldKey, SellerSpriteFieldCoverage>>;
  metricNatureCoverage: Readonly<Record<SellerSpriteMetricNature, SellerSpriteMetricNatureCoverage>>;
  uniqueAsinCount: number;
  duplicateAsinCount: number;
  uniqueParentAsinCount: number;
  sponsoredPlacementCount: number;
  organicPlacementCount: number;
  unknownPlacementCount: number;
  appearanceWeightedSummary: SellerSpriteMarketNumericSummaries;
  productWeightedSummary: SellerSpriteMarketNumericSummaries;
  brandConcentrationSummary: SellerSpriteConcentrationSummary;
  sellerConcentrationSummary: SellerSpriteConcentrationSummary;
  missingSignals: ReadonlyArray<string>;
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>;
  products: ReadonlyArray<SellerSpriteProductObservation>;
  families: ReadonlyArray<SellerSpriteFamilyObservation>;
  records: ReadonlyArray<SellerSpriteSnapshotRecord>;
  rejectedRecords: ReadonlyArray<SellerSpriteSnapshotRejectedRecord>;
  productionEffect: false;
  productionDatabaseWritten: false;
}

function numericSummary(
  values: ReadonlyArray<number | null>,
  conflictCount = 0,
): SellerSpriteNumericSummary {
  const valid = values
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (valid.length === 0) {
    return {
      validCount: 0,
      missingCount: values.length,
      conflictCount,
      minimum: null,
      median: null,
      maximum: null,
    };
  }
  const midpoint = Math.floor(valid.length / 2);
  return {
    validCount: valid.length,
    missingCount: values.length - valid.length,
    conflictCount,
    minimum: valid[0],
    median: valid.length % 2 === 1
      ? valid[midpoint]
      : (valid[midpoint - 1] + valid[midpoint]) / 2,
    maximum: valid[valid.length - 1],
  };
}

function supportedField(
  record: SellerSpriteRecord,
  field: SellerSpriteFieldKey,
): SellerSpriteFieldValue {
  return record[field] as SellerSpriteFieldValue;
}

function concentrationSummary(
  evidence: SellerSpriteAggregateEvidence,
): SellerSpriteConcentrationSummary {
  const availableRows = evidence.rows
    .filter((row) => row.entity.normalized !== null && row.marketShare.normalized !== null)
    .sort((left, right) => (
      (right.marketShare.normalized ?? 0) - (left.marketShare.normalized ?? 0)
      || sellerSpriteDeterministicStringCompare(
        left.entity.normalized ?? "",
        right.entity.normalized ?? "",
      )
    ));
  return {
    status: evidence.status,
    sheetName: evidence.sheetName,
    entityCount: evidence.rows.length,
    validShareCount: availableRows.length,
    missingShareCount: evidence.rows.length - availableRows.length,
    topEntity: availableRows[0]?.entity.normalized ?? null,
    topShare: availableRows[0]?.marketShare.normalized ?? null,
    top3Share: availableRows.length === 0
      ? null
      : availableRows.slice(0, 3)
        .reduce((sum, row) => sum + (row.marketShare.normalized ?? 0), 0),
    rows: evidence.rows,
  };
}

function canonicalField(value: SellerSpriteFieldValue): unknown {
  return {
    raw: value.raw,
    normalized: value.normalized,
    source: value.source,
    sourceType: value.sourceType,
    metricNature: value.metricNature,
  };
}

function buildRowIdentity(
  sourceFileSha256: string,
  sheetName: string,
  rowNumber: number,
  record: SellerSpriteRecord | undefined,
): string {
  const placement = record?.searchRank.normalized ?? null;
  return sellerSpriteStableHash({
    sourceFileSha256,
    sheetName,
    rowNumber,
    asin: record?.asin.normalized ?? null,
    placementType: placement?.placementType ?? null,
    page: placement?.page ?? null,
    position: placement?.position ?? null,
  });
}

function appearanceSummaries(
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>,
): SellerSpriteMarketNumericSummaries {
  const numericValues = (field: SellerSpriteFieldKey): Array<number | null> => (
    appearances.map((appearance) => {
      const value = appearance.providerEvidence.find((item) => item.fieldName === field)?.normalized;
      return typeof value === "number" ? value : null;
    })
  );
  return {
    price: numericSummary(numericValues("price")),
    estimatedMonthlySales: numericSummary(numericValues("estimatedMonthlySales")),
    estimatedMonthlyRevenue: numericSummary(numericValues("estimatedMonthlyRevenue")),
    rating: numericSummary(numericValues("rating")),
    reviews: numericSummary(numericValues("reviews")),
  };
}

function productSummary(
  products: ReadonlyArray<SellerSpriteProductObservation>,
  field: Extract<
  SellerSpriteProductMetricField,
  "price" | "estimatedMonthlySales" | "estimatedMonthlyRevenue" | "rating" | "reviews"
  >,
): SellerSpriteNumericSummary {
  const resolved = products.map((product) => product.providerMetrics[field]);
  const values = resolved.map((metric) => (
    metric.status === "resolved" && typeof metric.normalized === "number"
      ? metric.normalized
      : null
  ));
  const conflictCount = resolved.filter((metric) => metric.status === "conflict").length;
  const missingOnly = resolved.filter((metric) => metric.status === "missing").length;
  const summary = numericSummary(values, conflictCount);
  return {
    ...summary,
    missingCount: missingOnly,
  };
}

function productSummaries(
  products: ReadonlyArray<SellerSpriteProductObservation>,
): SellerSpriteMarketNumericSummaries {
  return {
    price: productSummary(products, "price"),
    estimatedMonthlySales: productSummary(products, "estimatedMonthlySales"),
    estimatedMonthlyRevenue: productSummary(products, "estimatedMonthlyRevenue"),
    rating: productSummary(products, "rating"),
    reviews: productSummary(products, "reviews"),
  };
}

function normalizedAggregate(evidence: SellerSpriteAggregateEvidence): unknown {
  return {
    status: evidence.status,
    rows: evidence.rows
      .map((row) => ({
        entity: row.entity.normalized,
        marketShare: row.marketShare.normalized,
        marketShareStatus: row.marketShare.normalized === null ? "missing" : "resolved",
      }))
      .sort(sellerSpriteCanonicalCompare),
  };
}

function normalizedBusinessPayload(
  appearances: ReadonlyArray<SellerSpriteSearchAppearance>,
  products: ReadonlyArray<SellerSpriteProductObservation>,
  precheck: SellerSpritePrecheckResult,
): unknown {
  const normalizedAppearances = appearances
    .map((appearance) => ({
      asin: appearance.asin,
      parentAsin: appearance.parentAsin,
      placementType: appearance.placementType,
      page: appearance.page,
      position: appearance.position,
      fields: appearance.providerEvidence
        .map((evidence) => ({
          fieldName: evidence.fieldName,
          metricNature: evidence.metricNature,
          usagePolicy: evidence.usagePolicy,
          normalized: evidence.normalized,
          unit: evidence.unit,
          status: evidence.normalized === null ? "missing" : "resolved",
        }))
        .sort(sellerSpriteCanonicalCompare),
      warnings: appearance.warnings.filter((warning) => warning !== "duplicate_asin").sort(),
    }))
    .sort(sellerSpriteCanonicalCompare);
  const normalizedProducts = products
    .map((product) => ({
      asin: product.asin,
      parentAsins: [...product.parentAsins].sort(),
      placementSummary: product.placementSummary,
      providerMetrics: Object.values(product.providerMetrics)
        .map((metric) => ({
          fieldName: metric.fieldName,
          nature: metric.nature,
          usagePolicy: metric.usagePolicy,
          status: metric.status,
          normalized: metric.normalized,
          normalizedValues: metric.normalizedValues
            .filter((value) => value !== null)
            .sort(sellerSpriteCanonicalCompare),
          unit: metric.unit,
        }))
        .sort(sellerSpriteCanonicalCompare),
      missingProviderMetrics: [...product.missingProviderMetrics].sort(),
      conflictingProviderMetrics: [...product.conflictingProviderMetrics].sort(),
    }))
    .sort(sellerSpriteCanonicalCompare);
  return {
    schemaVersion: SCHEMA_VERSION,
    marketplace: "amazon.com",
    market: "US",
    appearances: normalizedAppearances,
    products: normalizedProducts,
    aggregateEvidence: {
      brands: normalizedAggregate(precheck.auxiliaryEvidence.brands),
      sellers: normalizedAggregate(precheck.auxiliaryEvidence.sellers),
    },
  };
}

export function buildSellerSpriteMarketSnapshot(
  precheck: SellerSpritePrecheckResult,
): SellerSpriteMarketSnapshot {
  if (
    precheck.schemaVersion !== "sellersprite-xlsx-precheck.v1"
    || precheck.sheetName === null
    || precheck.errors.some((error) => error.severity === "error" && error.rowNumber === undefined)
  ) {
    throw new Error("SELLERSPRITE_PRECHECK_NOT_SUCCESSFUL");
  }

  const records: SellerSpriteSnapshotRecord[] = precheck.records.map((record) => ({
    ...record,
    rowIdentity: buildRowIdentity(
      precheck.sourceFileHash,
      precheck.sheetName!,
      record.rowNumber,
      record,
    ),
  }));
  const rejectedRecords: SellerSpriteSnapshotRejectedRecord[] = precheck.rejectedRecords.map(
    (record) => ({
      ...record,
      rowIdentity: buildRowIdentity(
        precheck.sourceFileHash,
        precheck.sheetName!,
        record.rowNumber,
        record.normalizedRecord,
      ),
    }),
  );

  const fieldCoverage = Object.fromEntries(SELLERSPRITE_FIELD_KEYS.map((field) => {
    const allRecords = [
      ...records,
      ...rejectedRecords
        .map((record) => record.normalizedRecord)
        .filter((record): record is SellerSpriteRecord => record !== undefined),
    ];
    const validCount = allRecords
      .filter((record) => supportedField(record, field).normalized !== null).length;
    return [field, { validCount, missingCount: allRecords.length - validCount }];
  })) as Record<SellerSpriteFieldKey, SellerSpriteFieldCoverage>;
  const metricNatureCoverage: Record<SellerSpriteMetricNature, SellerSpriteMetricNatureCoverage> = {
    snapshot: { fieldValueCount: 0, validCount: 0, missingCount: 0 },
    estimate: { fieldValueCount: 0, validCount: 0, missingCount: 0 },
    derived: { fieldValueCount: 0, validCount: 0, missingCount: 0 },
    unknown: { fieldValueCount: 0, validCount: 0, missingCount: 0 },
  };
  const projectionRows = [
    ...records.map((record) => ({
      rowIdentity: record.rowIdentity,
      record,
      errors: precheck.errors.filter((error) => error.rowNumber === record.rowNumber),
    })),
    ...rejectedRecords.flatMap((record) => (
      record.normalizedRecord === undefined
        ? []
        : [{
            rowIdentity: record.rowIdentity,
            record: record.normalizedRecord,
            errors: precheck.errors.filter((error) => error.rowNumber === record.rowNumber),
          }]
    )),
  ];
  for (const { record } of projectionRows) {
    for (const field of SELLERSPRITE_FIELD_KEYS) {
      const value = supportedField(record, field);
      const coverage = metricNatureCoverage[value.metricNature];
      coverage.fieldValueCount += 1;
      if (value.normalized === null) coverage.missingCount += 1;
      else coverage.validCount += 1;
    }
    for (const [header, nature] of Object.entries(record.extraRawMetricNature)) {
      const coverage = metricNatureCoverage[nature];
      coverage.fieldValueCount += 1;
      const raw = record.extraRaw[header];
      if (raw === null || raw.trim() === "") coverage.missingCount += 1;
      else coverage.validCount += 1;
    }
  }
  for (const aggregate of [
    precheck.auxiliaryEvidence.brands,
    precheck.auxiliaryEvidence.sellers,
  ]) {
    for (const row of aggregate.rows) {
      const coverage = metricNatureCoverage.derived;
      coverage.fieldValueCount += 1;
      if (row.marketShare.normalized === null) coverage.missingCount += 1;
      else coverage.validCount += 1;
    }
  }

  const projections = buildSellerSpriteOfflineProjections(
    precheck.sourceFileHash,
    projectionRows,
  );
  const warningCounts: Record<string, number> = {};
  for (const warning of precheck.errors.filter((error) => error.severity === "warning")) {
    warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
  }
  const asins = projections.appearances
    .map((appearance) => appearance.asin)
    .filter((value): value is string => value !== null);
  const uniqueAsinCount = new Set(asins).size;
  const missingSignals = [
    ...(precheck.auxiliaryEvidence.brands.status === "available"
      ? []
      : ["brands_aggregate_sheet"]),
    ...(precheck.auxiliaryEvidence.sellers.status === "available"
      ? []
      : ["sellers_aggregate_sheet"]),
    ...SELLERSPRITE_FIELD_KEYS
      .filter((field) => fieldCoverage[field].validCount === 0)
      .map((field) => `product_field:${field}`),
    ...SELLERSPRITE_FIELD_KEYS
      .filter((field) => (
        fieldCoverage[field].validCount > 0 && fieldCoverage[field].missingCount > 0
      ))
      .map((field) => `product_field_partial:${field}`),
  ].sort();
  const brandConcentrationSummary = concentrationSummary(precheck.auxiliaryEvidence.brands);
  const sellerConcentrationSummary = concentrationSummary(precheck.auxiliaryEvidence.sellers);
  const sourceBoundSnapshotHash = sellerSpriteStableHash({
    schemaVersion: SCHEMA_VERSION,
    sourceFileSha256: precheck.sourceFileHash,
    sheetName: precheck.sheetName,
    acceptedRows: precheck.acceptedRows,
    rejectedRows: precheck.rejectedRows,
    fieldMapping: precheck.fieldMapping,
    records: records.map((record) => ({
      rowIdentity: record.rowIdentity,
      rowNumber: record.rowNumber,
      fields: Object.fromEntries(SELLERSPRITE_FIELD_KEYS.map((field) => (
        [field, canonicalField(supportedField(record, field))]
      ))),
      extraRaw: record.extraRaw,
      extraRawMetricNature: record.extraRawMetricNature,
    })),
    rejectedRecords: rejectedRecords.map((record) => ({
      rowIdentity: record.rowIdentity,
      rowNumber: record.rowNumber,
      raw: record.raw,
      errorCodes: record.errorCodes,
      normalizedFields: record.normalizedRecord === undefined
        ? null
        : Object.fromEntries(SELLERSPRITE_FIELD_KEYS.map((field) => (
            [field, canonicalField(supportedField(record.normalizedRecord!, field))]
          ))),
    })),
    aggregateEvidence: {
      brands: {
        status: precheck.auxiliaryEvidence.brands.status,
        sheetName: precheck.auxiliaryEvidence.brands.sheetName,
        fieldMapping: precheck.auxiliaryEvidence.brands.fieldMapping,
        errors: precheck.auxiliaryEvidence.brands.errors,
        rows: precheck.auxiliaryEvidence.brands.rows.map((row) => ({
          rowNumber: row.rowNumber,
          entity: canonicalField(row.entity),
          marketShare: canonicalField(row.marketShare),
          raw: row.raw,
        })),
      },
      sellers: {
        status: precheck.auxiliaryEvidence.sellers.status,
        sheetName: precheck.auxiliaryEvidence.sellers.sheetName,
        fieldMapping: precheck.auxiliaryEvidence.sellers.fieldMapping,
        errors: precheck.auxiliaryEvidence.sellers.errors,
        rows: precheck.auxiliaryEvidence.sellers.rows.map((row) => ({
          rowNumber: row.rowNumber,
          entity: canonicalField(row.entity),
          marketShare: canonicalField(row.marketShare),
          raw: row.raw,
        })),
      },
    },
  });
  const normalizedBusinessHash = sellerSpriteStableHash(
    normalizedBusinessPayload(
      projections.appearances,
      projections.products,
      precheck,
    ),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFileSha256: precheck.sourceFileHash,
    sourceBoundSnapshotHash,
    normalizedBusinessHash,
    source: "SellerSprite",
    sourceType: "provider_metric",
    marketplace: "amazon.com",
    market: "US",
    sheetName: precheck.sheetName,
    ingestedAt: precheck.ingestedAt,
    exportedAt: precheck.exportedAt,
    providerUpdatedAt: precheck.providerUpdatedAt,
    totalRows: precheck.totalRows,
    acceptedRows: precheck.acceptedRows,
    rejectedRows: precheck.rejectedRows,
    warningCounts,
    fieldMapping: precheck.fieldMapping,
    fieldCoverage,
    metricNatureCoverage,
    uniqueAsinCount,
    duplicateAsinCount: asins.length - uniqueAsinCount,
    uniqueParentAsinCount: new Set(projections.appearances
      .map((appearance) => appearance.parentAsin)
      .filter((value): value is string => value !== null)).size,
    sponsoredPlacementCount: projections.appearances
      .filter((appearance) => appearance.placementType === "sponsored").length,
    organicPlacementCount: projections.appearances
      .filter((appearance) => appearance.placementType === "organic").length,
    unknownPlacementCount: projections.appearances
      .filter((appearance) => appearance.placementType === "unknown").length,
    appearanceWeightedSummary: appearanceSummaries(projections.appearances),
    productWeightedSummary: productSummaries(projections.products),
    brandConcentrationSummary,
    sellerConcentrationSummary,
    missingSignals,
    appearances: projections.appearances,
    products: projections.products,
    families: projections.families,
    records,
    rejectedRecords,
    productionEffect: false,
    productionDatabaseWritten: false,
  };
}
