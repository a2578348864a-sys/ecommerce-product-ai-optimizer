import type {
  BatchStatus,
  DataQualityStatus,
  ProductBatchDedupeInput,
  ProductBatchItemPersistenceInput,
  ReadyBatchCompletenessInput,
} from "@/lib/productBatchContract";

export const PRODUCT_BATCH_CAPABILITY_MATRIX = {
  owner: {
    importBatch: true,
    listBatches: true,
    viewItems: true,
    activateBatch: true,
    activateLegacy: true,
    archiveBatch: true,
  },
  visitor: {
    importBatch: true,
    listBatches: true,
    viewItems: true,
    activateBatch: true,
    activateLegacy: true,
    archiveBatch: true,
  },
} as const;

export interface ProductBatchCreateInput extends ProductBatchDedupeInput {
  batchName: string;
  currency: string;
  sourceFileName: string;
  sellerSpriteDisclaimerVersion: string;
}

export interface ProductBatchItemInput extends ProductBatchItemPersistenceInput {
  asin: string | null;
  parentAsin: string | null;
}

export interface ProductBatchBlockedInput {
  errorJson: string;
  qualitySummaryJson: string;
}

export interface ProductBatchView {
  id: string;
  batchName: string;
  marketplace: string;
  currency: string;
  reportType: ProductBatchDedupeInput["reportType"];
  query: string | null;
  category: string | null;
  priceMinCents: number | null;
  priceMaxCents: number | null;
  briefHash: string;
  sourceFileName: string;
  sourceFileSha256: string;
  normalizedBusinessHash: string | null;
  snapshotHash: string | null;
  manifestHash: string | null;
  itemCount: number | null;
  acceptedCount: number | null;
  quarantinedCount: number | null;
  dataQualityStatus: DataQualityStatus;
  batchStatus: BatchStatus;
  sellerSpriteDisclaimerVersion: string | null;
  normalizedSnapshotJson: string | null;
  manifestJson: string | null;
  qualitySummaryJson: string;
  errorJson: string | null;
  dedupeKey: string;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductBatchItemView extends ProductBatchItemInput {
  id: string;
  batchId: string;
  createdAt: string;
}

export interface ProductBatchSelectionView {
  activeProductBatchId: string | null;
  activeLegacyRegistrationId: string | null;
  updatedAt: string;
}

export interface ProductBatchStore {
  createOrReuseProcessingBatch(
    input: ProductBatchCreateInput,
  ): Promise<{ batch: ProductBatchView; created: boolean }>;
  saveBatchItems(
    batchId: string,
    items: readonly ProductBatchItemInput[],
  ): Promise<{ insertedCount: number }>;
  markReady(
    batchId: string,
    input: ReadyBatchCompletenessInput,
  ): Promise<ProductBatchView>;
  markBlocked(
    batchId: string,
    input: ProductBatchBlockedInput,
  ): Promise<ProductBatchView>;
  retryBlocked(batchId: string): Promise<ProductBatchView>;
  listBatches(): Promise<ProductBatchView[]>;
  getBatch(batchId: string): Promise<ProductBatchView | null>;
  getBatchItems(batchId: string): Promise<ProductBatchItemView[]>;
  getSelection(): Promise<ProductBatchSelectionView | null>;
  activateBatch(batchId: string): Promise<ProductBatchSelectionView>;
  activateLegacy(registrationId: string): Promise<ProductBatchSelectionView>;
  archiveBatch(batchId: string): Promise<ProductBatchView>;
}

export interface ProductBatchListResponse {
  accessMode: "owner" | "visitor";
  remainingAiCalls: number | null;
  batches: ProductBatchView[];
  selection: ProductBatchSelectionView | null;
  legacyRegistrationId: string | null;
}

export function productBatchResponseShape(
  input: ProductBatchListResponse,
): ProductBatchListResponse {
  return {
    accessMode: input.accessMode,
    remainingAiCalls: input.remainingAiCalls,
    batches: input.batches,
    selection: input.selection,
    legacyRegistrationId: input.legacyRegistrationId,
  };
}
