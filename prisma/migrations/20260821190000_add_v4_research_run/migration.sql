-- Additive V4 research graph run store (P1). No changes to existing tables.
-- CreateTable
CREATE TABLE "V4ResearchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "ownerScope" TEXT NOT NULL,
    "sandboxId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'local_live',
    "graphVersion" TEXT NOT NULL DEFAULT 'research-graph.v4.1',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentNode" TEXT NOT NULL DEFAULT 'load_context',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "planRevision" INTEGER NOT NULL DEFAULT 0,
    "automaticPlanRevisionCount" INTEGER NOT NULL DEFAULT 0,
    "stateJson" TEXT NOT NULL,
    "eventsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "V4SideEffectJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "V4ResearchRun_candidateId_idx" ON "V4ResearchRun"("candidateId");

-- CreateIndex
CREATE INDEX "V4ResearchRun_ownerScope_sandboxId_idx" ON "V4ResearchRun"("ownerScope", "sandboxId");

-- CreateIndex
CREATE INDEX "V4ResearchRun_status_updatedAt_idx" ON "V4ResearchRun"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "V4SideEffectJournal_runId_idx" ON "V4SideEffectJournal"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "V4SideEffectJournal_runId_idempotencyKey_key" ON "V4SideEffectJournal"("runId", "idempotencyKey");
