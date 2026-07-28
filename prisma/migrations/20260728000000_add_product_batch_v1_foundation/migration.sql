-- ProductBatch V1 stores immutable SellerSprite batch snapshots for the fixed
-- server-owned Owner subject. Legacy frozen registrations remain external.

-- CreateTable
CREATE TABLE "ProductBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerSubject" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "query" TEXT,
    "category" TEXT,
    "priceMinCents" INTEGER,
    "priceMaxCents" INTEGER,
    "briefHash" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileSha256" TEXT NOT NULL,
    "normalizedBusinessHash" TEXT,
    "snapshotHash" TEXT,
    "manifestHash" TEXT,
    "itemCount" INTEGER,
    "acceptedCount" INTEGER,
    "quarantinedCount" INTEGER,
    "dataQualityStatus" TEXT NOT NULL DEFAULT 'pending',
    "batchStatus" TEXT NOT NULL DEFAULT 'processing',
    "sellerSpriteDisclaimerVersion" TEXT,
    "normalizedSnapshotJson" TEXT,
    "manifestJson" TEXT,
    "qualitySummaryJson" TEXT NOT NULL DEFAULT '{}',
    "errorJson" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "importedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBatch_reportType_check"
      CHECK ("reportType" IN ('search_results', 'category_current')),
    CONSTRAINT "ProductBatch_batchStatus_check"
      CHECK ("batchStatus" IN ('processing', 'ready', 'blocked', 'archived')),
    CONSTRAINT "ProductBatch_dataQualityStatus_check"
      CHECK ("dataQualityStatus" IN ('pending', 'passed', 'passed_with_quarantine', 'blocked')),
    CONSTRAINT "ProductBatch_priceRange_check"
      CHECK (
        ("priceMinCents" IS NULL OR "priceMinCents" >= 0)
        AND ("priceMaxCents" IS NULL OR "priceMaxCents" >= 0)
        AND (
          "priceMinCents" IS NULL
          OR "priceMaxCents" IS NULL
          OR "priceMinCents" <= "priceMaxCents"
        )
      ),
    CONSTRAINT "ProductBatch_jsonSize_check"
      CHECK (
        ("normalizedSnapshotJson" IS NULL OR length(CAST("normalizedSnapshotJson" AS BLOB)) <= 8388608)
        AND ("manifestJson" IS NULL OR length(CAST("manifestJson" AS BLOB)) <= 2097152)
        AND length(CAST("qualitySummaryJson" AS BLOB)) <= 524288
        AND ("errorJson" IS NULL OR length(CAST("errorJson" AS BLOB)) <= 262144)
      ),
    CONSTRAINT "ProductBatch_readyCompleteness_check"
      CHECK (
        "batchStatus" NOT IN ('ready', 'archived')
        OR (
          "normalizedBusinessHash" IS NOT NULL
          AND length("normalizedBusinessHash") = 64
          AND "snapshotHash" IS NOT NULL
          AND length("snapshotHash") = 64
          AND "manifestHash" IS NOT NULL
          AND length("manifestHash") = 64
          AND "normalizedSnapshotJson" IS NOT NULL
          AND "manifestJson" IS NOT NULL
          AND "sellerSpriteDisclaimerVersion" IS NOT NULL
          AND length("sellerSpriteDisclaimerVersion") > 0
          AND "itemCount" IS NOT NULL
          AND "itemCount" BETWEEN 0 AND 500
          AND "acceptedCount" IS NOT NULL
          AND "acceptedCount" BETWEEN 0 AND 500
          AND "quarantinedCount" IS NOT NULL
          AND "quarantinedCount" >= 0
          AND "acceptedCount" + "quarantinedCount" = "itemCount"
          AND "dataQualityStatus" IN ('passed', 'passed_with_quarantine')
          AND "importedAt" IS NOT NULL
        )
      )
);

-- CreateTable
CREATE TABLE "ProductBatchItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "productKey" TEXT NOT NULL,
    "asin" TEXT,
    "parentAsin" TEXT,
    "itemIdentityHash" TEXT NOT NULL,
    "itemHash" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "normalizedProductJson" TEXT NOT NULL,
    "occurrenceProjectionJson" TEXT NOT NULL,
    "familyProjectionJson" TEXT NOT NULL,
    "rankingJson" TEXT NOT NULL,
    "provisionalDisposition" TEXT NOT NULL,
    "researchPriority" TEXT NOT NULL,
    "evidenceStatus" TEXT NOT NULL,
    "promotionEligible" BOOLEAN NOT NULL DEFAULT false,
    "imageSnapshotJson" TEXT NOT NULL DEFAULT '{"status":"not_cached"}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductBatchItem_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "ProductBatch" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductBatchItem_ordinal_check"
      CHECK ("ordinal" >= 0),
    CONSTRAINT "ProductBatchItem_productKey_check"
      CHECK (length("productKey") BETWEEN 1 AND 512),
    CONSTRAINT "ProductBatchItem_hashes_check"
      CHECK (
        length("itemIdentityHash") = 64
        AND length("itemHash") = 64
        AND length("evidenceHash") = 64
      ),
    CONSTRAINT "ProductBatchItem_disposition_check"
      CHECK (
        "provisionalDisposition" IN (
          'provisional_score_only',
          'insufficient_hard_gate_evidence',
          'conflicting_provider_metrics',
          'insufficient_required_signals'
        )
      ),
    CONSTRAINT "ProductBatchItem_priority_check"
      CHECK (
        "researchPriority" IN (
          'priority_1',
          'priority_2',
          'priority_3',
          'unranked_insufficient_evidence'
        )
      ),
    CONSTRAINT "ProductBatchItem_evidenceStatus_check"
      CHECK (
        "evidenceStatus" IN (
          'sufficient_for_comparison',
          'limited_evidence',
          'insufficient_evidence'
        )
      ),
    CONSTRAINT "ProductBatchItem_promotionEligible_check"
      CHECK ("promotionEligible" = false),
    CONSTRAINT "ProductBatchItem_jsonSize_check"
      CHECK (
        length(CAST("normalizedProductJson" AS BLOB)) <= 262144
        AND length(CAST("occurrenceProjectionJson" AS BLOB)) <= 262144
        AND length(CAST("familyProjectionJson" AS BLOB)) <= 262144
        AND length(CAST("rankingJson" AS BLOB)) <= 131072
        AND length(CAST("imageSnapshotJson" AS BLOB)) <= 3145728
      )
);

-- CreateTable
CREATE TABLE "ProductDiscoverySelection" (
    "ownerSubject" TEXT NOT NULL PRIMARY KEY,
    "activeProductBatchId" TEXT,
    "activeLegacyRegistrationId" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductDiscoverySelection_activeProductBatchId_fkey"
      FOREIGN KEY ("activeProductBatchId") REFERENCES "ProductBatch" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductDiscoverySelection_exactlyOneActive_check"
      CHECK (
        (
          "activeProductBatchId" IS NOT NULL
          AND "activeLegacyRegistrationId" IS NULL
        )
        OR (
          "activeProductBatchId" IS NULL
          AND "activeLegacyRegistrationId" IS NOT NULL
        )
      )
);

-- AddColumn
-- SQLite supports a nullable REFERENCES column without rebuilding the old table.
ALTER TABLE "OpportunityCandidate"
  ADD COLUMN "originProductBatchItemId" TEXT
  REFERENCES "ProductBatchItem" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatch_ownerSubject_dedupeKey_key"
  ON "ProductBatch"("ownerSubject", "dedupeKey");

-- CreateIndex
CREATE INDEX "ProductBatch_ownerSubject_batchStatus_importedAt_idx"
  ON "ProductBatch"("ownerSubject", "batchStatus", "importedAt");

-- CreateIndex
CREATE INDEX "ProductBatch_ownerSubject_createdAt_idx"
  ON "ProductBatch"("ownerSubject", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatchItem_batchId_productKey_key"
  ON "ProductBatchItem"("batchId", "productKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatchItem_batchId_ordinal_key"
  ON "ProductBatchItem"("batchId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "ProductBatchItem_batchId_itemIdentityHash_key"
  ON "ProductBatchItem"("batchId", "itemIdentityHash");

-- CreateIndex
CREATE INDEX "ProductBatchItem_batchId_evidenceStatus_idx"
  ON "ProductBatchItem"("batchId", "evidenceStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityCandidate_originProductBatchItemId_key"
  ON "OpportunityCandidate"("originProductBatchItemId");
