-- CreateTable
CREATE TABLE "ViralAnalysisRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'viral',
    "title" TEXT,
    "platform" TEXT NOT NULL,
    "productUrl" TEXT,
    "materialText" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "oneLineSummary" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "ViralAnalysisRecord_type_createdAt_idx" ON "ViralAnalysisRecord"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ViralAnalysisRecord_source_idx" ON "ViralAnalysisRecord"("source");

-- CreateIndex
CREATE INDEX "ViralAnalysisRecord_platform_idx" ON "ViralAnalysisRecord"("platform");
