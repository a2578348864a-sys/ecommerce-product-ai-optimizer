import { describe, expect, it } from "vitest";

import {
  PRODUCT_BATCH_JSON_LIMITS,
  ProductBatchContractError,
  assertActiveSelection,
  assertBatchStatusTransition,
  assertJsonFieldWithinLimit,
  assertProductBatchImageSnapshot,
  assertProductBatchItemForPersistence,
  assertReadyBatchCompleteness,
  buildProductBatchDedupeKey,
} from "@/lib/productBatchContract";

const HASH = "a".repeat(64);

function readyInput() {
  return {
    normalizedBusinessHash: HASH,
    snapshotHash: "b".repeat(64),
    manifestHash: "c".repeat(64),
    itemCount: 3,
    acceptedCount: 2,
    quarantinedCount: 1,
    dataQualityStatus: "passed_with_quarantine" as const,
    importedAt: new Date("2026-07-28T00:00:00.000Z"),
    sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
    normalizedSnapshotJson: JSON.stringify({
      schemaVersion: "sellersprite-market-snapshot.v3",
    }),
    manifestJson: JSON.stringify({
      schemaVersion: "sellersprite-local-preview-manifest.v3",
    }),
    qualitySummaryJson: "{}",
    errorJson: null,
  };
}

function validItem() {
  return {
    productKey: "asin:B000000001",
    ordinal: 0,
    itemIdentityHash: HASH,
    itemHash: "b".repeat(64),
    evidenceHash: "c".repeat(64),
    normalizedProductJson: "{}",
    occurrenceProjectionJson: "{}",
    familyProjectionJson: "{}",
    rankingJson: "{}",
    provisionalDisposition: "provisional_score_only" as const,
    researchPriority: "priority_1" as const,
    evidenceStatus: "sufficient_for_comparison" as const,
    promotionEligible: false as const,
    imageSnapshotJson: JSON.stringify({ status: "not_cached" }),
  };
}

describe("ProductBatch V1 status transitions", () => {
  it("allows processing to become ready or blocked and fails closed for forbidden transitions", () => {
    expect(() => assertBatchStatusTransition("processing", "ready")).not.toThrow();
    expect(() => assertBatchStatusTransition("processing", "blocked")).not.toThrow();
    expect(() => assertBatchStatusTransition("ready", "archived")).not.toThrow();

    expect(() => assertBatchStatusTransition("ready", "processing"))
      .toThrow(ProductBatchContractError);
    expect(() => assertBatchStatusTransition("ready", "blocked"))
      .toThrow(ProductBatchContractError);
    expect(() => assertBatchStatusTransition("archived", "ready"))
      .toThrow(ProductBatchContractError);
  });

  it("allows blocked to return to processing only as the frozen re-import transition", () => {
    expect(() => assertBatchStatusTransition("blocked", "processing")).not.toThrow();
    expect(() => assertBatchStatusTransition("blocked", "ready"))
      .toThrow(ProductBatchContractError);
  });
});

describe("ProductBatch V1 identity and completeness", () => {
  it("builds a stable dedupe key and includes report context", () => {
    const base = {
      marketplace: "US",
      reportType: "search_results" as const,
      query: "closet organizer",
      category: null,
      priceMinCents: 1500,
      priceMaxCents: 4500,
      briefHash: HASH,
      sourceFileSha256: "b".repeat(64),
    };

    expect(buildProductBatchDedupeKey(base)).toBe(buildProductBatchDedupeKey({
      ...base,
      query: "  closet   organizer ",
      marketplace: "us",
    }));
    expect(buildProductBatchDedupeKey({ ...base, query: "shoe rack" }))
      .not.toBe(buildProductBatchDedupeKey(base));
  });

  it("accepts a complete ready snapshot", () => {
    expect(() => assertReadyBatchCompleteness(readyInput())).not.toThrow();
  });

  it("rejects ready state when a required hash or snapshot is missing", () => {
    expect(() => assertReadyBatchCompleteness({
      ...readyInput(),
      manifestHash: null,
    })).toThrow(ProductBatchContractError);
    expect(() => assertReadyBatchCompleteness({
      ...readyInput(),
      normalizedSnapshotJson: null,
    })).toThrow(ProductBatchContractError);
  });

  it("rejects unexpected SellerSprite Snapshot or Manifest versions", () => {
    expect(() => assertReadyBatchCompleteness({
      ...readyInput(),
      normalizedSnapshotJson: JSON.stringify({ schemaVersion: "sellersprite-market-snapshot.v2" }),
    })).toThrow(ProductBatchContractError);
    expect(() => assertReadyBatchCompleteness({
      ...readyInput(),
      manifestJson: JSON.stringify({ schemaVersion: "sellersprite-local-preview-manifest.v2" }),
    })).toThrow(ProductBatchContractError);
  });

  it("requires complete and internally consistent ready counts", () => {
    expect(() => assertReadyBatchCompleteness({
      ...readyInput(),
      acceptedCount: 3,
    })).toThrow(ProductBatchContractError);
  });
});

describe("ProductBatch V1 active selection", () => {
  it("accepts exactly one active pointer", () => {
    expect(() => assertActiveSelection({
      activeProductBatchId: "batch-1",
      activeLegacyRegistrationId: null,
    })).not.toThrow();
    expect(() => assertActiveSelection({
      activeProductBatchId: null,
      activeLegacyRegistrationId: "legacy-1",
    })).not.toThrow();
  });

  it("rejects zero or two active pointers", () => {
    expect(() => assertActiveSelection({
      activeProductBatchId: null,
      activeLegacyRegistrationId: null,
    })).toThrow(ProductBatchContractError);
    expect(() => assertActiveSelection({
      activeProductBatchId: "batch-1",
      activeLegacyRegistrationId: "legacy-1",
    })).toThrow(ProductBatchContractError);
  });
});

describe("ProductBatch V1 bounded JSON and item semantics", () => {
  it("rejects JSON that exceeds the field-specific UTF-8 byte limit", () => {
    const tooLarge = JSON.stringify(
      "x".repeat(PRODUCT_BATCH_JSON_LIMITS.rankingJson + 1),
    );
    expect(() => assertJsonFieldWithinLimit("rankingJson", tooLarge))
      .toThrow(ProductBatchContractError);
  });

  it("accepts SellerSprite-native item semantics and a not-cached image", () => {
    expect(() => assertProductBatchItemForPersistence(validItem())).not.toThrow();
    expect(() => assertProductBatchImageSnapshot(
      JSON.stringify({ status: "not_cached" }),
    )).not.toThrow();
  });

  it("rejects promotion and advance/watch/reject semantics", () => {
    expect(() => assertProductBatchItemForPersistence({
      ...validItem(),
      promotionEligible: true,
    })).toThrow(ProductBatchContractError);
    expect(() => assertProductBatchItemForPersistence({
      ...validItem(),
      provisionalDisposition: "advance",
    })).toThrow(ProductBatchContractError);
  });

  it("rejects SVG, unsupported MIME, and oversized cached images", () => {
    const svg = Buffer.from("<svg></svg>").toString("base64");
    expect(() => assertProductBatchImageSnapshot(JSON.stringify({
      status: "cached",
      mimeType: "image/svg+xml",
      sizeBytes: 11,
      sha256: HASH,
      base64: svg,
    }))).toThrow(ProductBatchContractError);

    const oversized = Buffer.alloc((2 * 1024 * 1024) + 1, 0xff);
    expect(() => assertProductBatchImageSnapshot(JSON.stringify({
      status: "cached",
      mimeType: "image/jpeg",
      sizeBytes: oversized.byteLength,
      sha256: HASH,
      base64: oversized.toString("base64"),
    }))).toThrow(ProductBatchContractError);
  });
});
