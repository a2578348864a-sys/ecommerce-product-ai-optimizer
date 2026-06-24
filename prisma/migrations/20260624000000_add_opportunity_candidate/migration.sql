-- CreateTable
CREATE TABLE "OpportunityCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rawInput" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '机会雷达',
    "keyword" TEXT NOT NULL DEFAULT '',
    "riskLevel" TEXT NOT NULL DEFAULT '',
    "riskLabel" TEXT NOT NULL DEFAULT '',
    "summaryLabel" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceMetaJson" TEXT NOT NULL DEFAULT '{}',
    "analysisJson" TEXT NOT NULL DEFAULT '{}',
    "convertedTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActionAt" DATETIME
);

-- CreateIndex
CREATE INDEX "OpportunityCandidate_status_updatedAt_idx" ON "OpportunityCandidate"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "OpportunityCandidate_score_idx" ON "OpportunityCandidate"("score");

-- CreateIndex
CREATE INDEX "OpportunityCandidate_createdAt_idx" ON "OpportunityCandidate"("createdAt");

-- CreateIndex
CREATE INDEX "OpportunityCandidate_name_idx" ON "OpportunityCandidate"("name");
