ALTER TABLE "ViralAnalysisRecord" ADD COLUMN "decisionStatus" TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX "ViralAnalysisRecord_decisionStatus_createdAt_idx" ON "ViralAnalysisRecord"("decisionStatus", "createdAt");
