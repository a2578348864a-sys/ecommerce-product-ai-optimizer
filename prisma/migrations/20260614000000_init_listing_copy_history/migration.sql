-- CreateTable
CREATE TABLE "ListingCopyHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bulletPoints" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "keywords" TEXT NOT NULL,
    "longTailKeywords" TEXT NOT NULL,
    "faq" TEXT NOT NULL,
    "packingList" TEXT NOT NULL,
    "afterSales" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "sourceInput" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ListingCopyHistory_createdAt_idx" ON "ListingCopyHistory"("createdAt");

-- CreateIndex
CREATE INDEX "ListingCopyHistory_productName_idx" ON "ListingCopyHistory"("productName");
