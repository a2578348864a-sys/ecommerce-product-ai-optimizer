import { describe, expect, it } from "vitest";

import type { ProductBatchView } from "@/lib/productBatchStore";
import type { ProductBatchCandidateSourceV1 } from "@/lib/server/productBatchCandidateSource";
import { buildProductBatchListingFacts } from "@/lib/server/productBatchListingFacts";

const snapshotHash = "a".repeat(64);
const batch: ProductBatchView = {
  id: "batch-a",
  batchName: "Kitchen & Dining · 当前商品",
  marketplace: "US",
  currency: "USD",
  reportType: "category_current",
  query: null,
  category: "Kitchen & Dining",
  priceMinCents: 0,
  priceMaxCents: 10000,
  briefHash: "b".repeat(64),
  sourceFileName: "sample.xlsx",
  sourceFileSha256: "c".repeat(64),
  normalizedBusinessHash: "d".repeat(64),
  snapshotHash,
  manifestHash: "e".repeat(64),
  itemCount: 1,
  acceptedCount: 1,
  quarantinedCount: 0,
  dataQualityStatus: "passed",
  batchStatus: "ready",
  sellerSpriteDisclaimerVersion: "v1",
  normalizedSnapshotJson: JSON.stringify({
    schemaVersion: "sellersprite-market-snapshot.v3",
    records: [{
      asin: { normalized: "B000000001" },
      extraRaw: {
        类目路径: "Home & Kitchen:Kitchen & Dining:Cups",
        "商品尺寸（单位换算）": "10 x 8 x 6 cm",
        商品重量: "0.5 kg",
        产品卖点: "Leak resistant; reusable",
        AC关键词: "travel mug; insulated cup",
      },
    }],
  }),
  manifestJson: "{}",
  qualitySummaryJson: "{}",
  errorJson: null,
  dedupeKey: "f".repeat(64),
  importedAt: "2026-07-29T00:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const source: ProductBatchCandidateSourceV1 = {
  version: "product-batch-candidate-source.v1",
  originKind: "seller_sprite_product_batch",
  productBatchId: batch.id,
  productBatchItemId: "item-a",
  serverIdentityScope: "visitor:sandbox",
  productKey: "amazon:US:B000000001",
  productName: "Insulated Travel Mug",
  marketplace: "US",
  asin: "B000000001",
  parentAsin: "B000000000",
  reportType: "category_current",
  query: null,
  category: "Kitchen & Dining",
  manifestHash: "e".repeat(64),
  snapshotHash,
  itemIdentityHash: "1".repeat(64),
  itemHash: "2".repeat(64),
  evidenceHash: "3".repeat(64),
  researchPriority: "priority_1",
  provisionalDisposition: "provisional_score_only",
  evidenceStatus: "sufficient_for_comparison",
  promotionEligible: false,
  sellerSpriteDisclaimerVersion: "v1",
  imageSnapshot: { status: "not_cached" },
  productFacts: {
    productTitle: "Insulated Travel Mug",
    brand: "Example",
    price: 0,
    rating: 4.7,
    reviews: 250,
    estimatedMonthlySales: 999,
    estimatedMonthlyRevenue: 9999,
    rootCategory: "Kitchen & Dining",
    subCategory: "Cups",
  },
  capturedAt: "2026-07-29T00:00:00.000Z",
};

describe("ProductBatch Listing facts", () => {
  it("projects exact server snapshots and preserves a real zero without copying estimates", () => {
    const facts = buildProductBatchListingFacts({ batch, source });

    expect(facts).toMatchObject({
      version: "product-batch-listing-facts.v1",
      asin: "B000000001",
      parentAsin: "B000000000",
      category: "Kitchen & Dining",
      productTitle: "Insulated Travel Mug",
      brand: "Example",
      price: 0,
      rating: 4.7,
      reviews: 250,
      categoryPath: "Home & Kitchen:Kitchen & Dining:Cups",
      productDimensions: "10 x 8 x 6 cm",
      productWeight: "0.5 kg",
      productBulletPoints: "Leak resistant; reusable",
      acKeywords: "travel mug; insulated cup",
    });
    expect(facts).not.toHaveProperty("estimatedMonthlySales");
    expect(facts).not.toHaveProperty("estimatedMonthlyRevenue");
  });

  it("fails closed when the Candidate snapshot does not match the authoritative batch", () => {
    expect(buildProductBatchListingFacts({
      batch,
      source: { ...source, snapshotHash: "9".repeat(64) },
    })).toBeNull();
  });
});
