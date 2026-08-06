import "server-only";

import type {
  ProductBatchItemRecord,
  ProductBatchRecord,
  ProductDiscoverySelectionRecord,
} from "@/lib/server/productBatchRepository";
import {
  createProductBatchRepository,
} from "@/lib/server/productBatchRepository";
import type {
  ProductBatchItemView,
  ProductBatchSelectionView,
  ProductBatchStore,
  ProductBatchView,
} from "@/lib/productBatchStore";

type ProductBatchRepository = ReturnType<typeof createProductBatchRepository>;

function toBatchView(batch: ProductBatchRecord): ProductBatchView {
  return {
    id: batch.id,
    batchName: batch.batchName,
    marketplace: batch.marketplace,
    currency: batch.currency,
    reportType: batch.reportType,
    query: batch.query,
    category: batch.category,
    priceMinCents: batch.priceMinCents,
    priceMaxCents: batch.priceMaxCents,
    briefHash: batch.briefHash,
    sourceFileName: batch.sourceFileName,
    sourceFileSha256: batch.sourceFileSha256,
    normalizedBusinessHash: batch.normalizedBusinessHash,
    snapshotHash: batch.snapshotHash,
    manifestHash: batch.manifestHash,
    itemCount: batch.itemCount,
    acceptedCount: batch.acceptedCount,
    quarantinedCount: batch.quarantinedCount,
    dataQualityStatus: batch.dataQualityStatus,
    batchStatus: batch.batchStatus,
    sellerSpriteDisclaimerVersion: batch.sellerSpriteDisclaimerVersion,
    normalizedSnapshotJson: batch.normalizedSnapshotJson,
    manifestJson: batch.manifestJson,
    qualitySummaryJson: batch.qualitySummaryJson,
    errorJson: batch.errorJson,
    dedupeKey: batch.dedupeKey,
    importedAt: batch.importedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  };
}

function toItemView(item: ProductBatchItemRecord): ProductBatchItemView {
  return {
    id: item.id,
    batchId: item.batchId,
    productKey: item.productKey,
    ordinal: item.ordinal,
    asin: item.asin,
    parentAsin: item.parentAsin,
    itemIdentityHash: item.itemIdentityHash,
    itemHash: item.itemHash,
    evidenceHash: item.evidenceHash,
    normalizedProductJson: item.normalizedProductJson,
    occurrenceProjectionJson: item.occurrenceProjectionJson,
    familyProjectionJson: item.familyProjectionJson,
    rankingJson: item.rankingJson,
    provisionalDisposition: item.provisionalDisposition,
    researchPriority: item.researchPriority,
    evidenceStatus: item.evidenceStatus,
    promotionEligible: item.promotionEligible,
    imageSnapshotJson: item.imageSnapshotJson,
    createdAt: item.createdAt.toISOString(),
  };
}

function toSelectionView(
  selection: ProductDiscoverySelectionRecord,
): ProductBatchSelectionView {
  return {
    activeProductBatchId: selection.activeProductBatchId,
    activeLegacyRegistrationId: selection.activeLegacyRegistrationId,
    updatedAt: selection.updatedAt.toISOString(),
  };
}

export function createOwnerProductBatchStore(
  repository: ProductBatchRepository = createProductBatchRepository(),
): ProductBatchStore {
  return {
    async createOrReuseProcessingBatch(input) {
      const result = await repository.createProcessingBatch(input);
      return { batch: toBatchView(result.batch), created: result.created };
    },
    saveBatchItems(batchId, items) {
      return repository.replaceOrInsertBatchItemsDuringProcessing(batchId, items);
    },
    async markReady(batchId, input) {
      return toBatchView(await repository.markBatchReady(batchId, input));
    },
    async markBlocked(batchId, input) {
      return toBatchView(await repository.markBatchBlocked(batchId, input));
    },
    async retryBlocked(batchId) {
      return toBatchView(await repository.retryBlockedBatch(batchId));
    },
    async listBatches() {
      return (await repository.listBatchesForOwner()).map(toBatchView);
    },
    async getBatch(batchId) {
      const batch = await repository.getBatchByIdForOwner(batchId);
      return batch ? toBatchView(batch) : null;
    },
    async getBatchItems(batchId) {
      return (await repository.getBatchItemsForOwner(batchId)).map(toItemView);
    },
    async getSelection() {
      const selection = await repository.getActiveSelection();
      return selection ? toSelectionView(selection) : null;
    },
    async activateBatch(batchId) {
      return toSelectionView(await repository.setActiveBatch(batchId));
    },
    async activateLegacy(registrationId) {
      return toSelectionView(
        await repository.setActiveLegacyRegistration(registrationId),
      );
    },
    async archiveBatch(batchId) {
      return toBatchView(await repository.archiveBatch(batchId));
    },
    async deleteBatch(batchId) {
      return repository.deleteBatchForOwner(batchId);
    },
    async removeBatchItem(batchId, itemId) {
      return repository.removeBatchItemForOwner(batchId, itemId);
    },
  };
}
