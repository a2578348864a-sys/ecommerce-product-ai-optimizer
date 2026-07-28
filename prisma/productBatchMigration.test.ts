import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const EXISTING_MIGRATIONS = [
  "20260614000000_init_listing_copy_history",
  "20260615000000_add_viral_analysis_records",
  "20260620000000_add_decision_status_to_tasks",
  "20260624000000_add_opportunity_candidate",
] as const;
const PRODUCT_BATCH_MIGRATION = resolve(
  "prisma/migrations/20260728000000_add_product_batch_v1_foundation/migration.sql",
);
const HASH = "a".repeat(64);

function sql(relativePath: string): string {
  return readFileSync(resolve(relativePath), "utf8");
}

function applyExistingMigrations(database: DatabaseSync): void {
  for (const migration of EXISTING_MIGRATIONS) {
    database.exec(sql(`prisma/migrations/${migration}/migration.sql`));
  }
}

function seedLegacyRows(database: DatabaseSync): void {
  database.prepare(`
    INSERT INTO "ListingCopyHistory" (
      "id", "productName", "title", "bulletPoints", "description",
      "shortDescription", "keywords", "longTailKeywords", "faq",
      "packingList", "afterSales", "notes", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "listing-1",
    "Legacy product",
    "Legacy title",
    "[]",
    "Legacy description",
    "Short",
    "keywords",
    "long tail",
    "faq",
    "packing",
    "after sales",
    "notes",
    "2026-07-28T00:00:00.000Z",
  );
  database.prepare(`
    INSERT INTO "ViralAnalysisRecord" (
      "id", "updatedAt", "platform", "materialText", "source", "score",
      "level", "oneLineSummary", "resultJson"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "task-1",
    "2026-07-28T00:00:00.000Z",
    "amazon",
    "legacy input",
    "manual",
    1,
    "pending",
    "legacy summary",
    "{}",
  );
  database.prepare(`
    INSERT INTO "OpportunityCandidate" (
      "id", "name", "updatedAt"
    ) VALUES (?, ?, ?)
  `).run("candidate-1", "Legacy candidate", "2026-07-28T00:00:00.000Z");
}

function migratedDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  applyExistingMigrations(database);
  seedLegacyRows(database);
  database.exec(sql(PRODUCT_BATCH_MIGRATION));
  return database;
}

function insertBatch(
  database: DatabaseSync,
  id: string,
  ownerSubject = "owner:v1",
  dedupeKey = id,
): void {
  database.prepare(`
    INSERT INTO "ProductBatch" (
      "id", "ownerSubject", "batchName", "marketplace", "currency",
      "reportType", "briefHash", "sourceFileName", "sourceFileSha256",
      "qualitySummaryJson", "dedupeKey"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerSubject,
    id,
    "US",
    "USD",
    "search_results",
    HASH,
    "report.xlsx",
    HASH,
    "{}",
    dedupeKey,
  );
}

function insertItem(
  database: DatabaseSync,
  input: {
    id: string;
    batchId: string;
    ordinal?: number;
    productKey?: string;
    itemIdentityHash?: string;
    asin?: string;
    promotionEligible?: number;
  },
): void {
  database.prepare(`
    INSERT INTO "ProductBatchItem" (
      "id", "batchId", "ordinal", "productKey", "asin",
      "itemIdentityHash", "itemHash", "evidenceHash",
      "normalizedProductJson", "occurrenceProjectionJson",
      "familyProjectionJson", "rankingJson", "provisionalDisposition",
      "researchPriority", "evidenceStatus", "promotionEligible",
      "imageSnapshotJson"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.batchId,
    input.ordinal ?? 0,
    input.productKey ?? "asin:B000000001",
    input.asin ?? "B000000001",
    input.itemIdentityHash ?? HASH,
    "b".repeat(64),
    "c".repeat(64),
    "{}",
    "{}",
    "{}",
    "{}",
    "provisional_score_only",
    "priority_1",
    "sufficient_for_comparison",
    input.promotionEligible ?? 0,
    '{"status":"not_cached"}',
  );
}

describe("ProductBatch V1 migration", () => {
  it("keeps the Prisma schema aligned with the frozen V1 model boundary", () => {
    const schema = sql("prisma/schema.prisma");
    expect(schema).toMatch(/model ProductBatch \{/u);
    expect(schema).toMatch(/model ProductBatchItem \{/u);
    expect(schema).toMatch(/model ProductDiscoverySelection \{/u);
    expect(schema).toMatch(/originProductBatchItemId\s+String\?\s+@unique/u);
    expect(schema).toMatch(/onDelete: Restrict/u);
    expect(schema).not.toMatch(/\brevisionReason\b|\brevision\s+Int\b/u);
  });

  it("adds the three new tables without destructive SQL", () => {
    const migrationSql = sql(PRODUCT_BATCH_MIGRATION);
    expect(migrationSql).not.toMatch(/\bDROP\s+TABLE\b/iu);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
    expect(migrationSql).not.toMatch(/\bALTER\s+TABLE\b[\s\S]*\bRENAME\b/iu);

    const database = migratedDatabase();
    try {
      const tables = database.prepare(`
        SELECT "name" FROM "sqlite_master"
        WHERE "type" = 'table'
        ORDER BY "name"
      `).all().map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining([
        "ProductBatch",
        "ProductBatchItem",
        "ProductDiscoverySelection",
      ]));
    } finally {
      database.close();
    }
  });

  it("preserves every old table row and old Candidate column definition", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      applyExistingMigrations(database);
      seedLegacyRows(database);
      const oldCandidateColumns = database.prepare(
        'PRAGMA table_info("OpportunityCandidate")',
      ).all();
      const countsBefore = {
        listing: database.prepare('SELECT COUNT(*) AS "count" FROM "ListingCopyHistory"').get()!.count,
        task: database.prepare('SELECT COUNT(*) AS "count" FROM "ViralAnalysisRecord"').get()!.count,
        candidate: database.prepare('SELECT COUNT(*) AS "count" FROM "OpportunityCandidate"').get()!.count,
      };

      database.exec(sql(PRODUCT_BATCH_MIGRATION));

      const newCandidateColumns = database.prepare(
        'PRAGMA table_info("OpportunityCandidate")',
      ).all();
      expect(newCandidateColumns.slice(0, oldCandidateColumns.length))
        .toEqual(oldCandidateColumns);
      expect(countsBefore).toEqual({
        listing: database.prepare('SELECT COUNT(*) AS "count" FROM "ListingCopyHistory"').get()!.count,
        task: database.prepare('SELECT COUNT(*) AS "count" FROM "ViralAnalysisRecord"').get()!.count,
        candidate: database.prepare('SELECT COUNT(*) AS "count" FROM "OpportunityCandidate"').get()!.count,
      });
    } finally {
      database.close();
    }
  });

  it("adds a nullable unique Candidate foreign key and keeps legacy rows null", () => {
    const database = migratedDatabase();
    try {
      const candidate = database.prepare(`
        SELECT "originProductBatchItemId"
        FROM "OpportunityCandidate"
        WHERE "id" = 'candidate-1'
      `).get();
      expect(candidate?.originProductBatchItemId).toBeNull();

      const foreignKeys = database.prepare(
        'PRAGMA foreign_key_list("OpportunityCandidate")',
      ).all();
      expect(foreignKeys).toEqual(expect.arrayContaining([
        expect.objectContaining({
          table: "ProductBatchItem",
          from: "originProductBatchItemId",
          on_delete: "RESTRICT",
        }),
      ]));
      const indexes = database.prepare(
        'PRAGMA index_list("OpportunityCandidate")',
      ).all();
      expect(indexes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: "OpportunityCandidate_originProductBatchItemId_key",
          unique: 1,
        }),
      ]));
    } finally {
      database.close();
    }
  });

  it("enforces exactly one active selection pointer", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1");
      expect(() => database.prepare(`
        INSERT INTO "ProductDiscoverySelection" ("ownerSubject")
        VALUES ('owner:none')
      `).run()).toThrow();
      expect(() => database.prepare(`
        INSERT INTO "ProductDiscoverySelection" (
          "ownerSubject", "activeProductBatchId", "activeLegacyRegistrationId"
        ) VALUES ('owner:both', 'batch-1', 'legacy-1')
      `).run()).toThrow();
      expect(() => database.prepare(`
        INSERT INTO "ProductDiscoverySelection" (
          "ownerSubject", "activeProductBatchId"
        ) VALUES ('owner:batch', 'batch-1')
      `).run()).not.toThrow();
      expect(() => database.prepare(`
        INSERT INTO "ProductDiscoverySelection" (
          "ownerSubject", "activeLegacyRegistrationId"
        ) VALUES ('owner:legacy', 'legacy-1')
      `).run()).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces owner-scoped batch dedupe while allowing another owner", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1", "owner:v1", "same");
      expect(() => insertBatch(database, "batch-2", "owner:v1", "same")).toThrow();
      expect(() => insertBatch(database, "batch-3", "owner:other", "same")).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces ready completeness at the database boundary", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1");
      expect(() => database.prepare(`
        UPDATE "ProductBatch" SET "batchStatus" = 'ready'
        WHERE "id" = 'batch-1'
      `).run()).toThrow();
      expect(() => database.prepare(`
        UPDATE "ProductBatch" SET
          "normalizedBusinessHash" = ?,
          "snapshotHash" = ?,
          "manifestHash" = ?,
          "itemCount" = 0,
          "acceptedCount" = 0,
          "quarantinedCount" = 0,
          "dataQualityStatus" = 'passed',
          "sellerSpriteDisclaimerVersion" = 'sellersprite-v1-frozen.2026-07-27',
          "normalizedSnapshotJson" = '{"schemaVersion":"sellersprite-market-snapshot.v3"}',
          "manifestJson" = '{"schemaVersion":"sellersprite-local-preview-manifest.v3"}',
          "importedAt" = CURRENT_TIMESTAMP,
          "batchStatus" = 'ready'
        WHERE "id" = 'batch-1'
      `).run(HASH, HASH, HASH)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("enforces all three per-batch item identities and fixed promotion=false", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1");
      insertItem(database, { id: "item-1", batchId: "batch-1" });
      expect(() => insertItem(database, {
        id: "item-product-key",
        batchId: "batch-1",
        ordinal: 1,
        itemIdentityHash: "d".repeat(64),
      })).toThrow();
      expect(() => insertItem(database, {
        id: "item-ordinal",
        batchId: "batch-1",
        productKey: "asin:B000000002",
        itemIdentityHash: "d".repeat(64),
      })).toThrow();
      expect(() => insertItem(database, {
        id: "item-identity",
        batchId: "batch-1",
        ordinal: 1,
        productKey: "asin:B000000002",
      })).toThrow();
      expect(() => insertItem(database, {
        id: "item-promoted",
        batchId: "batch-1",
        ordinal: 1,
        productKey: "asin:B000000002",
        itemIdentityHash: "d".repeat(64),
        promotionEligible: 1,
      })).toThrow();
    } finally {
      database.close();
    }
  });

  it("allows the same ASIN in different batches", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1");
      insertBatch(database, "batch-2");
      insertItem(database, { id: "item-1", batchId: "batch-1" });
      expect(() => insertItem(database, {
        id: "item-2",
        batchId: "batch-2",
      })).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("restricts deletion of an item referenced by a Candidate", () => {
    const database = migratedDatabase();
    try {
      insertBatch(database, "batch-1");
      insertItem(database, { id: "item-1", batchId: "batch-1" });
      database.prepare(`
        UPDATE "OpportunityCandidate"
        SET "originProductBatchItemId" = 'item-1'
        WHERE "id" = 'candidate-1'
      `).run();
      expect(() => database.prepare(`
        DELETE FROM "ProductBatchItem" WHERE "id" = 'item-1'
      `).run()).toThrow();
    } finally {
      database.close();
    }
  });
});
