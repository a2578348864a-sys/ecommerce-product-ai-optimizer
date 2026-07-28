import { describe, expect, it, vi } from "vitest";

import { createOwnerProductBatchStore } from "@/lib/server/ownerProductBatchStore";

const date = new Date("2026-07-28T00:00:00.000Z");
const ownerBatch = {
  id: "owner-batch",
  ownerSubject: "owner:v1" as const,
  batchName: "Owner batch",
  marketplace: "US",
  currency: "USD",
  reportType: "search_results" as const,
  query: "organizer",
  category: "Home",
  priceMinCents: 1000,
  priceMaxCents: 3000,
  briefHash: "a".repeat(64),
  sourceFileName: "input.xlsx",
  sourceFileSha256: "b".repeat(64),
  normalizedBusinessHash: null,
  snapshotHash: null,
  manifestHash: null,
  itemCount: null,
  acceptedCount: null,
  quarantinedCount: null,
  dataQualityStatus: "pending" as const,
  batchStatus: "processing" as const,
  sellerSpriteDisclaimerVersion: "v1",
  normalizedSnapshotJson: null,
  manifestJson: null,
  qualitySummaryJson: "{}",
  errorJson: null,
  dedupeKey: "c".repeat(64),
  importedAt: null,
  createdAt: date,
  updatedAt: date,
};

function repositoryDouble() {
  return {
    createProcessingBatch: vi.fn(async () => ({ batch: ownerBatch, created: true })),
    findBatchByDedupeKey: vi.fn(async () => ownerBatch),
    replaceOrInsertBatchItemsDuringProcessing: vi.fn(async () => ({ insertedCount: 0 })),
    markBatchReady: vi.fn(async () => ownerBatch),
    markBatchBlocked: vi.fn(async () => ownerBatch),
    retryBlockedBatch: vi.fn(async () => ownerBatch),
    listBatchesForOwner: vi.fn(async () => [ownerBatch]),
    getBatchByIdForOwner: vi.fn(async () => ownerBatch),
    getBatchItemsForOwner: vi.fn(async () => []),
    getActiveSelection: vi.fn(async () => ({
      ownerSubject: "owner:v1" as const,
      activeProductBatchId: "owner-batch",
      activeLegacyRegistrationId: null,
      updatedAt: date,
    })),
    setActiveBatch: vi.fn(async () => ({
      ownerSubject: "owner:v1" as const,
      activeProductBatchId: "owner-batch",
      activeLegacyRegistrationId: null,
      updatedAt: date,
    })),
    setActiveLegacyRegistration: vi.fn(async () => ({
      ownerSubject: "owner:v1" as const,
      activeProductBatchId: null,
      activeLegacyRegistrationId: "legacy",
      updatedAt: date,
    })),
    archiveBatch: vi.fn(async () => ownerBatch),
  };
}

describe("Owner ProductBatch store adapter", () => {
  it("maps the fixed Owner repository to the shared contract without leaking ownerSubject", async () => {
    const repository = repositoryDouble();
    const store = createOwnerProductBatchStore(repository);
    const batches = await store.listBatches();
    const selection = await store.getSelection();

    expect(batches).toHaveLength(1);
    expect(batches[0].createdAt).toBe(date.toISOString());
    expect(JSON.stringify({ batches, selection })).not.toContain("ownerSubject");
    expect(repository.listBatchesForOwner).toHaveBeenCalledOnce();
    expect(repository.getActiveSelection).toHaveBeenCalledOnce();
  });
});
