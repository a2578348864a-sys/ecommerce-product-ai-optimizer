-- Additive: V4FactRecord (P3 SupplierClaim -> ConfirmedFact store, append-only revisions).
CREATE TABLE "V4FactRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "offerIdentity" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "confirmationMethod" TEXT,
    "claimRefsJson" TEXT NOT NULL DEFAULT '[]',
    "documentRefsJson" TEXT NOT NULL DEFAULT '[]',
    "actor" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "revokedByRevision" INTEGER,
    "detailJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "V4FactRecord_runId_offerIdentity_variantKey_field_revision_key" ON "V4FactRecord"("runId", "offerIdentity", "variantKey", "field", "revision");
CREATE INDEX "V4FactRecord_runId_offerIdentity_variantKey_field_idx" ON "V4FactRecord"("runId", "offerIdentity", "variantKey", "field");
CREATE INDEX "V4FactRecord_runId_revision_idx" ON "V4FactRecord"("runId", "revision");
