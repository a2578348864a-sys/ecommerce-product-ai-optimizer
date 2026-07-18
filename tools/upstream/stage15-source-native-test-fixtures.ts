import { stableHash } from "../../lib/upstream/pipeline";
import type {
  SourceNativeProductRecord,
  SourceNativeSourceQualification,
} from "./stage15-source-native-contract";

function withRecordHash(body: Omit<SourceNativeProductRecord, "recordHash">): SourceNativeProductRecord {
  return { ...body, recordHash: stableHash(body) };
}

function rehashRecord(record: SourceNativeProductRecord): SourceNativeProductRecord {
  const { recordHash: _recordHash, ...body } = record;
  return withRecordHash(body);
}

function syntheticRecord(index: number): SourceNativeProductRecord {
  const sourceProductId = `SN-${String(index).padStart(3, "0")}`;
  return withRecordHash({
    schemaVersion: "stage15-source-native-product-record.v1",
    sourceId: "synthetic-catalogue",
    sourceProductId,
    variantSignature: `finish=aurora-${index};size=standard`,
    variantBinding: { status: "exact" },
    stableIdentifiers: [{ kind: "manufacturer_number", value: `SYN-${sourceProductId}` }],
    title: `Synthetic Utility Item ${index}`,
    brand: "Northwind Fabrication",
    model: `Model-${index}`,
    sourceUrl: `https://catalogue.synthetic.invalid/products/${sourceProductId}`,
    imageUrls: [`https://images.synthetic.invalid/${sourceProductId}.png`],
    price: { amount: 19.5 + index, currency: "USD" },
    aggregate: { rating: 4.2, reviewCount: 12 + index },
    specifications: {
      dimensions: "10 x 8 x 3 cm",
      weight: "240 g",
      materials: ["synthetic alloy"],
      features: ["modular storage", "tool-free adjustment"],
    },
    reviewSignals: [
      { sentiment: "positive", rating: 5, reviewedAt: "2026-06-01", signal: "Synthetic positive durability signal", evidenceRef: `capture:${sourceProductId}#review-positive` },
      { sentiment: "negative", rating: 2, reviewedAt: "2026-06-02", signal: "Synthetic negative size limitation signal", evidenceRef: `capture:${sourceProductId}#review-negative` },
    ],
    rawCapture: {
      relativePath: `captures/${sourceProductId}.json`,
      fileSha256: "a".repeat(64),
      capturedAt: "2026-07-17T09:00:00.000Z",
    },
    captureSha256: "b".repeat(64),
  });
}

const qualificationBody: Omit<SourceNativeSourceQualification, "qualificationHash"> = {
  schemaVersion: "stage15-source-native-qualification.v1",
  sourceId: "synthetic-catalogue",
  sourceKind: "public_source_native_site",
  sourceOrigin: "https://catalogue.synthetic.invalid",
  loginRequired: false,
  robotsStatus: "allowed",
  licenseStatus: "verified",
  stableIdentifierKinds: ["manufacturer_number"],
};

export const FIXTURE_SOURCE_NATIVE_QUALIFICATION: SourceNativeSourceQualification = {
  ...qualificationBody,
  qualificationHash: stableHash(qualificationBody),
};

export const SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS = Array.from(
  { length: 20 },
  (_value, index) => syntheticRecord(index + 1),
);

export type SourceNativeExcludedFixtureRecord = {
  exclusionReason: "mixed_variant" | "missing_negative_review" | "missing_review_date" | "duplicate_source_product_id";
  record: SourceNativeProductRecord;
};

export const SOURCE_NATIVE_EXCLUDED_FIXTURE_RECORDS: SourceNativeExcludedFixtureRecord[] = [
  {
    exclusionReason: "mixed_variant" as const,
    record: rehashRecord({ ...syntheticRecord(21), variantBinding: { status: "mixed_variant" as const } }),
  },
  {
    exclusionReason: "missing_negative_review" as const,
    record: rehashRecord({ ...syntheticRecord(22), reviewSignals: [syntheticRecord(22).reviewSignals[0]] }),
  },
  {
    exclusionReason: "missing_review_date" as const,
    record: rehashRecord({
      ...syntheticRecord(23),
      reviewSignals: syntheticRecord(23).reviewSignals.map((review, index) => index === 1 ? { ...review, reviewedAt: "" } : review),
    }),
  },
  {
    exclusionReason: "duplicate_source_product_id" as const,
    record: rehashRecord({
      ...syntheticRecord(24),
      sourceProductId: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19].sourceProductId,
      variantSignature: SOURCE_NATIVE_QUALIFIED_FIXTURE_RECORDS[19].variantSignature,
    }),
  },
];
