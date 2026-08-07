import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  PRODUCT_BATCH_MAX_ITEMS,
  PRODUCT_BATCH_OWNER_SUBJECT,
  ProductBatchContractError,
  assertActiveSelection,
  assertBatchStatusTransition,
  assertJsonFieldWithinLimit,
  assertProductBatchItemForPersistence,
  assertReadyBatchCompleteness,
  buildProductBatchDedupeKey,
  type BatchStatus,
  type DataQualityStatus,
  type ProductBatchDedupeInput,
  type ProductBatchItemPersistenceInput,
  type ReadyBatchCompletenessInput,
} from "@/lib/productBatchContract";
import {
  resolveProductionMarketScreeningRegistration,
} from "@/lib/marketScreeningProductionRegistry";
import { prisma } from "@/lib/server/db";

export class ProductBatchRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductBatchRepositoryError";
  }
}

type SqlDatabase = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

type TransactionDatabase = SqlDatabase & {
  $transaction<T>(callback: (transaction: SqlDatabase) => Promise<T>): Promise<T>;
};

type DateValue = Date | string | number | bigint;

interface ProductBatchRow {
  id: string;
  ownerSubject: string;
  batchName: string;
  marketplace: string;
  currency: string;
  reportType: string;
  query: string | null;
  category: string | null;
  priceMinCents: number | bigint | null;
  priceMaxCents: number | bigint | null;
  briefHash: string;
  sourceFileName: string;
  sourceFileSha256: string;
  normalizedBusinessHash: string | null;
  snapshotHash: string | null;
  manifestHash: string | null;
  itemCount: number | bigint | null;
  acceptedCount: number | bigint | null;
  quarantinedCount: number | bigint | null;
  dataQualityStatus: string;
  batchStatus: string;
  sellerSpriteDisclaimerVersion: string | null;
  normalizedSnapshotJson: string | null;
  manifestJson: string | null;
  qualitySummaryJson: string;
  errorJson: string | null;
  dedupeKey: string;
  importedAt: DateValue | null;
  createdAt: DateValue;
  updatedAt: DateValue;
}

interface ProductDiscoverySelectionRow {
  ownerSubject: string;
  activeProductBatchId: string | null;
  activeLegacyRegistrationId: string | null;
  updatedAt: DateValue;
}

interface ProductBatchItemRow {
  id: string;
  batchId: string;
  ordinal: number | bigint;
  productKey: string;
  asin: string | null;
  parentAsin: string | null;
  itemIdentityHash: string;
  itemHash: string;
  evidenceHash: string;
  normalizedProductJson: string;
  occurrenceProjectionJson: string;
  familyProjectionJson: string;
  rankingJson: string;
  provisionalDisposition: string;
  researchPriority: string;
  evidenceStatus: string;
  promotionEligible: boolean | number | bigint;
  imageSnapshotJson: string;
  createdAt: DateValue;
}

export interface ProductBatchRecord {
  id: string;
  ownerSubject: typeof PRODUCT_BATCH_OWNER_SUBJECT;
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
  importedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDiscoverySelectionRecord {
  ownerSubject: typeof PRODUCT_BATCH_OWNER_SUBJECT;
  activeProductBatchId: string | null;
  activeLegacyRegistrationId: string | null;
  updatedAt: Date;
}

export interface CreateProcessingBatchInput extends ProductBatchDedupeInput {
  batchName: string;
  currency: string;
  sourceFileName: string;
  sellerSpriteDisclaimerVersion: string;
}

export interface ProductBatchItemInput extends ProductBatchItemPersistenceInput {
  asin: string | null;
  parentAsin: string | null;
}

export interface ProductBatchItemRecord extends ProductBatchItemInput {
  id: string;
  batchId: string;
  createdAt: Date;
}

export interface MarkBatchBlockedInput {
  errorJson: string;
  qualitySummaryJson: string;
}

function repositoryError(code: string, message: string): never {
  throw new ProductBatchRepositoryError(code, message);
}

function asNumber(value: number | bigint | null): number | null {
  if (value === null) return null;
  const converted = Number(value);
  if (!Number.isSafeInteger(converted)) {
    repositoryError("batch_numeric_value_invalid", "Stored ProductBatch number is unsafe.");
  }
  return converted;
}

function asDate(value: DateValue): Date {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "bigint" ? Number(value) : value);
  if (Number.isNaN(date.getTime())) {
    repositoryError("batch_date_value_invalid", "Stored ProductBatch date is invalid.");
  }
  return date;
}

function asFalse(value: boolean | number | bigint): false {
  if (value !== false && value !== 0 && value !== BigInt(0)) {
    repositoryError(
      "batch_item_promotion_forbidden",
      "Stored SellerSprite V1 item cannot be promotion eligible.",
    );
  }
  return false;
}

function asBatchStatus(value: string): BatchStatus {
  if (
    value !== "processing"
    && value !== "ready"
    && value !== "blocked"
    && value !== "archived"
  ) {
    repositoryError("batch_status_invalid", "Stored ProductBatch status is invalid.");
  }
  return value;
}

function asDataQualityStatus(value: string): DataQualityStatus {
  if (
    value !== "pending"
    && value !== "passed"
    && value !== "passed_with_quarantine"
    && value !== "blocked"
  ) {
    repositoryError("batch_quality_status_invalid", "Stored data quality status is invalid.");
  }
  return value;
}

function toBatchRecord(row: ProductBatchRow): ProductBatchRecord {
  if (row.ownerSubject !== PRODUCT_BATCH_OWNER_SUBJECT) {
    repositoryError("batch_owner_mismatch", "ProductBatch owner boundary was violated.");
  }
  if (row.reportType !== "search_results" && row.reportType !== "category_current") {
    repositoryError("batch_report_type_invalid", "Stored ProductBatch report type is invalid.");
  }
  return {
    ...row,
    ownerSubject: PRODUCT_BATCH_OWNER_SUBJECT,
    reportType: row.reportType,
    priceMinCents: asNumber(row.priceMinCents),
    priceMaxCents: asNumber(row.priceMaxCents),
    itemCount: asNumber(row.itemCount),
    acceptedCount: asNumber(row.acceptedCount),
    quarantinedCount: asNumber(row.quarantinedCount),
    dataQualityStatus: asDataQualityStatus(row.dataQualityStatus),
    batchStatus: asBatchStatus(row.batchStatus),
    importedAt: row.importedAt === null ? null : asDate(row.importedAt),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

function toSelectionRecord(
  row: ProductDiscoverySelectionRow,
): ProductDiscoverySelectionRecord {
  if (row.ownerSubject !== PRODUCT_BATCH_OWNER_SUBJECT) {
    repositoryError("selection_owner_mismatch", "Active selection owner boundary was violated.");
  }
  assertActiveSelection(row);
  return {
    ownerSubject: PRODUCT_BATCH_OWNER_SUBJECT,
    activeProductBatchId: row.activeProductBatchId,
    activeLegacyRegistrationId: row.activeLegacyRegistrationId,
    updatedAt: asDate(row.updatedAt),
  };
}

function toItemRecord(row: ProductBatchItemRow): ProductBatchItemRecord {
  const item = {
    id: row.id,
    batchId: row.batchId,
    ordinal: asNumber(row.ordinal)!,
    productKey: row.productKey,
    asin: row.asin,
    parentAsin: row.parentAsin,
    itemIdentityHash: row.itemIdentityHash,
    itemHash: row.itemHash,
    evidenceHash: row.evidenceHash,
    normalizedProductJson: row.normalizedProductJson,
    occurrenceProjectionJson: row.occurrenceProjectionJson,
    familyProjectionJson: row.familyProjectionJson,
    rankingJson: row.rankingJson,
    provisionalDisposition: row.provisionalDisposition,
    researchPriority: row.researchPriority,
    evidenceStatus: row.evidenceStatus,
    promotionEligible: asFalse(row.promotionEligible),
    imageSnapshotJson: row.imageSnapshotJson,
    createdAt: asDate(row.createdAt),
  };
  try {
    assertProductBatchItemForPersistence(item);
  } catch (error) {
    return translateContractError(error);
  }
  return item;
}

function validateBoundedText(
  value: string,
  field: string,
  maxBytes: number,
): string {
  if (typeof value !== "string") {
    repositoryError("batch_text_invalid", `${field} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || Buffer.byteLength(normalized, "utf8") > maxBytes) {
    repositoryError("batch_text_invalid", `${field} is empty or too large.`);
  }
  return normalized;
}

function validateCreateInput(input: CreateProcessingBatchInput): {
  batchName: string;
  marketplace: string;
  currency: string;
  sourceFileName: string;
  sellerSpriteDisclaimerVersion: string;
  dedupeKey: string;
} {
  const batchName = validateBoundedText(input.batchName, "batchName", 256);
  const marketplace = validateBoundedText(input.marketplace, "marketplace", 32).toUpperCase();
  const currency = validateBoundedText(input.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    repositoryError("batch_currency_invalid", "currency must be a three-letter code.");
  }
  const sourceFileName = validateBoundedText(input.sourceFileName, "sourceFileName", 255);
  if (
    sourceFileName.includes("/")
    || sourceFileName.includes("\\")
    || sourceFileName === "."
    || sourceFileName === ".."
  ) {
    repositoryError(
      "batch_source_filename_invalid",
      "sourceFileName must be a basename, not a path.",
    );
  }
  const sellerSpriteDisclaimerVersion = validateBoundedText(
    input.sellerSpriteDisclaimerVersion,
    "sellerSpriteDisclaimerVersion",
    128,
  );
  const dedupeKey = buildProductBatchDedupeKey({
    ...input,
    marketplace,
  });
  return {
    batchName,
    marketplace,
    currency,
    sourceFileName,
    sellerSpriteDisclaimerVersion,
    dedupeKey,
  };
}

async function getOwnedBatch(
  database: SqlDatabase,
  id: string,
): Promise<ProductBatchRecord | null> {
  const rows = await database.$queryRaw<ProductBatchRow[]>(Prisma.sql`
    SELECT *
    FROM "ProductBatch"
    WHERE "id" = ${id}
      AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
    LIMIT 1
  `);
  return rows[0] ? toBatchRecord(rows[0]) : null;
}

async function requireOwnedBatch(
  database: SqlDatabase,
  id: string,
): Promise<ProductBatchRecord> {
  const batch = await getOwnedBatch(database, id);
  if (!batch) {
    repositoryError("batch_not_found", "ProductBatch does not exist for the fixed Owner.");
  }
  return batch;
}

function translateContractError(error: unknown): never {
  if (error instanceof ProductBatchContractError) {
    repositoryError(error.code, error.message);
  }
  throw error;
}

export function createProductBatchRepository(client: PrismaClient = prisma) {
  const database = client as unknown as TransactionDatabase;

  async function findBatchByDedupeKey(
    dedupeKey: string,
  ): Promise<ProductBatchRecord | null> {
    if (!/^[a-f0-9]{64}$/.test(dedupeKey)) {
      repositoryError("batch_dedupe_key_invalid", "dedupeKey must be a SHA-256 value.");
    }
    const rows = await database.$queryRaw<ProductBatchRow[]>(Prisma.sql`
      SELECT *
      FROM "ProductBatch"
      WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
        AND "dedupeKey" = ${dedupeKey}
      LIMIT 1
    `);
    return rows[0] ? toBatchRecord(rows[0]) : null;
  }

  async function createProcessingBatch(
    input: CreateProcessingBatchInput,
  ): Promise<{ batch: ProductBatchRecord; created: boolean }> {
    const validated = validateCreateInput(input);
    const id = randomUUID();
    const now = new Date();
    const rows = await database.$queryRaw<ProductBatchRow[]>(Prisma.sql`
      INSERT INTO "ProductBatch" (
        "id",
        "ownerSubject",
        "batchName",
        "marketplace",
        "currency",
        "reportType",
        "query",
        "category",
        "priceMinCents",
        "priceMaxCents",
        "briefHash",
        "sourceFileName",
        "sourceFileSha256",
        "dataQualityStatus",
        "batchStatus",
        "sellerSpriteDisclaimerVersion",
        "qualitySummaryJson",
        "dedupeKey",
        "createdAt",
        "updatedAt"
      ) VALUES (
        ${id},
        ${PRODUCT_BATCH_OWNER_SUBJECT},
        ${validated.batchName},
        ${validated.marketplace},
        ${validated.currency},
        ${input.reportType},
        ${input.query},
        ${input.category},
        ${input.priceMinCents},
        ${input.priceMaxCents},
        ${input.briefHash},
        ${validated.sourceFileName},
        ${input.sourceFileSha256},
        'pending',
        'processing',
        ${validated.sellerSpriteDisclaimerVersion},
        '{}',
        ${validated.dedupeKey},
        ${now},
        ${now}
      )
      ON CONFLICT ("ownerSubject", "dedupeKey") DO NOTHING
      RETURNING *
    `);
    if (rows[0]) {
      return { batch: toBatchRecord(rows[0]), created: true };
    }
    const existing = await findBatchByDedupeKey(validated.dedupeKey);
    if (!existing) {
      repositoryError(
        "batch_dedupe_resolution_failed",
        "Concurrent ProductBatch dedupe could not be resolved.",
      );
    }
    return { batch: existing, created: false };
  }

  async function getBatchByIdForOwner(id: string): Promise<ProductBatchRecord | null> {
    return getOwnedBatch(database, id);
  }

  async function listBatchesForOwner(): Promise<ProductBatchRecord[]> {
    const rows = await database.$queryRaw<ProductBatchRow[]>(Prisma.sql`
      SELECT *
      FROM "ProductBatch"
      WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
      ORDER BY "createdAt" DESC, "id" DESC
    `);
    return rows.map(toBatchRecord);
  }

  async function getBatchItemsForOwner(
    batchId: string,
  ): Promise<ProductBatchItemRecord[]> {
    const batch = await getOwnedBatch(database, batchId);
    if (!batch) return [];
    const rows = await database.$queryRaw<ProductBatchItemRow[]>(Prisma.sql`
      SELECT item.*
      FROM "ProductBatchItem" AS item
      INNER JOIN "ProductBatch" AS batch
        ON batch."id" = item."batchId"
      WHERE item."batchId" = ${batchId}
        AND batch."ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
      ORDER BY item."ordinal" ASC, item."id" ASC
    `);
    return rows.map(toItemRecord);
  }

  async function replaceOrInsertBatchItemsDuringProcessing(
    batchId: string,
    items: readonly ProductBatchItemInput[],
  ): Promise<{ insertedCount: number }> {
    if (items.length > PRODUCT_BATCH_MAX_ITEMS) {
      repositoryError("batch_item_limit_exceeded", "ProductBatch cannot exceed 500 items.");
    }
    try {
      for (const item of items) {
        assertProductBatchItemForPersistence(item);
      }
    } catch (error) {
      return translateContractError(error);
    }
    const productKeys = new Set(items.map((item) => item.productKey));
    const ordinals = new Set(items.map((item) => item.ordinal));
    const identities = new Set(items.map((item) => item.itemIdentityHash));
    if (
      productKeys.size !== items.length
      || ordinals.size !== items.length
      || identities.size !== items.length
    ) {
      repositoryError(
        "batch_item_identity_conflict",
        "Batch items contain duplicate productKey, ordinal, or itemIdentityHash.",
      );
    }

    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      if (batch.batchStatus !== "processing") {
        repositoryError(
          "batch_snapshot_immutable",
          "Only processing batches can replace their item projection.",
        );
      }
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "ProductBatchItem"
        WHERE "batchId" = ${batchId}
      `);
      for (const item of items) {
        await transaction.$executeRaw(Prisma.sql`
          INSERT INTO "ProductBatchItem" (
            "id",
            "batchId",
            "ordinal",
            "productKey",
            "asin",
            "parentAsin",
            "itemIdentityHash",
            "itemHash",
            "evidenceHash",
            "normalizedProductJson",
            "occurrenceProjectionJson",
            "familyProjectionJson",
            "rankingJson",
            "provisionalDisposition",
            "researchPriority",
            "evidenceStatus",
            "promotionEligible",
            "imageSnapshotJson",
            "createdAt"
          ) VALUES (
            ${randomUUID()},
            ${batchId},
            ${item.ordinal},
            ${item.productKey},
            ${item.asin},
            ${item.parentAsin},
            ${item.itemIdentityHash},
            ${item.itemHash},
            ${item.evidenceHash},
            ${item.normalizedProductJson},
            ${item.occurrenceProjectionJson},
            ${item.familyProjectionJson},
            ${item.rankingJson},
            ${item.provisionalDisposition},
            ${item.researchPriority},
            ${item.evidenceStatus},
            ${false},
            ${item.imageSnapshotJson},
            ${new Date()}
          )
        `);
      }
      return { insertedCount: items.length };
    });
  }

  async function markBatchReady(
    batchId: string,
    input: ReadyBatchCompletenessInput,
  ): Promise<ProductBatchRecord> {
    try {
      assertReadyBatchCompleteness(input);
    } catch (error) {
      return translateContractError(error);
    }
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      try {
        assertBatchStatusTransition(batch.batchStatus, "ready");
      } catch (error) {
        return translateContractError(error);
      }
      const counts = await transaction.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
        SELECT COUNT(*) AS "count"
        FROM "ProductBatchItem"
        WHERE "batchId" = ${batchId}
      `);
      const storedItemCount = asNumber(counts[0]?.count ?? 0);
      if (storedItemCount !== input.acceptedCount) {
        repositoryError(
          "batch_item_count_mismatch",
          "Stored item count does not match acceptedCount.",
        );
      }
      const now = new Date();
      const rows = await transaction.$queryRaw<ProductBatchRow[]>(Prisma.sql`
        UPDATE "ProductBatch"
        SET
          "normalizedBusinessHash" = ${input.normalizedBusinessHash},
          "snapshotHash" = ${input.snapshotHash},
          "manifestHash" = ${input.manifestHash},
          "itemCount" = ${input.itemCount},
          "acceptedCount" = ${input.acceptedCount},
          "quarantinedCount" = ${input.quarantinedCount},
          "dataQualityStatus" = ${input.dataQualityStatus},
          "batchStatus" = 'ready',
          "sellerSpriteDisclaimerVersion" = ${input.sellerSpriteDisclaimerVersion},
          "normalizedSnapshotJson" = ${input.normalizedSnapshotJson},
          "manifestJson" = ${input.manifestJson},
          "qualitySummaryJson" = ${input.qualitySummaryJson},
          "errorJson" = ${input.errorJson},
          "importedAt" = ${input.importedAt},
          "updatedAt" = ${now}
        WHERE "id" = ${batchId}
          AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "batchStatus" = 'processing'
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("batch_state_raced", "ProductBatch state changed during ready transition.");
      }
      return toBatchRecord(rows[0]);
    });
  }

  async function markBatchBlocked(
    batchId: string,
    input: MarkBatchBlockedInput,
  ): Promise<ProductBatchRecord> {
    try {
      assertJsonFieldWithinLimit("errorJson", input.errorJson);
      assertJsonFieldWithinLimit("qualitySummaryJson", input.qualitySummaryJson);
    } catch (error) {
      return translateContractError(error);
    }
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      try {
        assertBatchStatusTransition(batch.batchStatus, "blocked");
      } catch (error) {
        return translateContractError(error);
      }
      const rows = await transaction.$queryRaw<ProductBatchRow[]>(Prisma.sql`
        UPDATE "ProductBatch"
        SET
          "batchStatus" = 'blocked',
          "dataQualityStatus" = 'blocked',
          "qualitySummaryJson" = ${input.qualitySummaryJson},
          "errorJson" = ${input.errorJson},
          "updatedAt" = ${new Date()}
        WHERE "id" = ${batchId}
          AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "batchStatus" = 'processing'
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("batch_state_raced", "ProductBatch state changed during blocked transition.");
      }
      return toBatchRecord(rows[0]);
    });
  }

  async function retryBlockedBatch(
    batchId: string,
  ): Promise<ProductBatchRecord> {
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      try {
        assertBatchStatusTransition(batch.batchStatus, "processing");
      } catch (error) {
        return translateContractError(error);
      }
      const rows = await transaction.$queryRaw<ProductBatchRow[]>(Prisma.sql`
        UPDATE "ProductBatch"
        SET
          "batchStatus" = 'processing',
          "dataQualityStatus" = 'pending',
          "errorJson" = NULL,
          "updatedAt" = ${new Date()}
        WHERE "id" = ${batchId}
          AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "batchStatus" = 'blocked'
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("batch_state_raced", "ProductBatch state changed during retry.");
      }
      return toBatchRecord(rows[0]);
    });
  }

  async function getActiveSelection(): Promise<ProductDiscoverySelectionRecord | null> {
    const rows = await database.$queryRaw<ProductDiscoverySelectionRow[]>(Prisma.sql`
      SELECT *
      FROM "ProductDiscoverySelection"
      WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
      LIMIT 1
    `);
    return rows[0] ? toSelectionRecord(rows[0]) : null;
  }

  async function setActiveBatch(
    batchId: string,
  ): Promise<ProductDiscoverySelectionRecord> {
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      if (batch.batchStatus !== "ready") {
        repositoryError(
          "batch_not_activatable",
          "Only a ready ProductBatch can become active.",
        );
      }
      const rows = await transaction.$queryRaw<ProductDiscoverySelectionRow[]>(Prisma.sql`
        INSERT INTO "ProductDiscoverySelection" (
          "ownerSubject",
          "activeProductBatchId",
          "activeLegacyRegistrationId",
          "updatedAt"
        ) VALUES (
          ${PRODUCT_BATCH_OWNER_SUBJECT},
          ${batchId},
          NULL,
          ${new Date()}
        )
        ON CONFLICT ("ownerSubject") DO UPDATE SET
          "activeProductBatchId" = excluded."activeProductBatchId",
          "activeLegacyRegistrationId" = NULL,
          "updatedAt" = excluded."updatedAt"
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("selection_update_failed", "Active ProductBatch was not persisted.");
      }
      return toSelectionRecord(rows[0]);
    });
  }

  async function setActiveLegacyRegistration(
    registrationId: string,
  ): Promise<ProductDiscoverySelectionRecord> {
    const validatedId = validateBoundedText(
      registrationId,
      "activeLegacyRegistrationId",
      200,
    );
    if (!/^[A-Za-z0-9._:-]+$/.test(validatedId)) {
      repositoryError(
        "legacy_registration_id_invalid",
        "Legacy registration id contains unsupported characters.",
      );
    }
    if (!resolveProductionMarketScreeningRegistration(validatedId)) {
      repositoryError(
        "legacy_registration_not_found",
        "Legacy registration is absent from the frozen production registry.",
      );
    }
    return database.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ProductDiscoverySelectionRow[]>(Prisma.sql`
        INSERT INTO "ProductDiscoverySelection" (
          "ownerSubject",
          "activeProductBatchId",
          "activeLegacyRegistrationId",
          "updatedAt"
        ) VALUES (
          ${PRODUCT_BATCH_OWNER_SUBJECT},
          NULL,
          ${validatedId},
          ${new Date()}
        )
        ON CONFLICT ("ownerSubject") DO UPDATE SET
          "activeProductBatchId" = NULL,
          "activeLegacyRegistrationId" = excluded."activeLegacyRegistrationId",
          "updatedAt" = excluded."updatedAt"
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("selection_update_failed", "Legacy selection was not persisted.");
      }
      return toSelectionRecord(rows[0]);
    });
  }

  async function archiveBatch(batchId: string): Promise<ProductBatchRecord> {
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      try {
        assertBatchStatusTransition(batch.batchStatus, "archived");
      } catch (error) {
        return translateContractError(error);
      }
      const activeRows = await transaction.$queryRaw<Array<{ ownerSubject: string }>>(Prisma.sql`
        SELECT "ownerSubject"
        FROM "ProductDiscoverySelection"
        WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "activeProductBatchId" = ${batchId}
        LIMIT 1
      `);
      if (activeRows.length > 0) {
        repositoryError(
          "batch_is_active",
          "Switch away from a ProductBatch before archiving it.",
        );
      }
      const rows = await transaction.$queryRaw<ProductBatchRow[]>(Prisma.sql`
        UPDATE "ProductBatch"
        SET
          "batchStatus" = 'archived',
          "updatedAt" = ${new Date()}
        WHERE "id" = ${batchId}
          AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "batchStatus" = 'ready'
        RETURNING *
      `);
      if (!rows[0]) {
        repositoryError("batch_state_raced", "ProductBatch state changed during archive.");
      }
      return toBatchRecord(rows[0]);
    });
  }

  async function deleteBatchForOwner(
    batchId: string,
  ): Promise<{ deleted: boolean }> {
    return database.$transaction(async (transaction) => {
      const batch = await requireOwnedBatch(transaction, batchId);
      // 产品规则：删除当前批次 = 取消当前并删除。
      // 先删除 selection 绑定（getActiveSelection 返回 null → 前端显示"尚未选择"），
      // 再解除已进入研究池的候选对该批次 item 的引用，最后删 item 与 batch。
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "ProductDiscoverySelection"
        WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "activeProductBatchId" = ${batchId}
      `);
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "OpportunityCandidate"
        SET "originProductBatchItemId" = NULL
        WHERE "originProductBatchItemId" IN (
          SELECT "id" FROM "ProductBatchItem" WHERE "batchId" = ${batchId}
        )
      `);
      // ProductBatchItem/Selection 对 ProductBatch 为 onDelete: Restrict →
      // 事务内先删条目，再删批次。
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "ProductBatchItem"
        WHERE "batchId" = ${batchId}
      `);
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "ProductBatch"
        WHERE "id" = ${batchId}
          AND "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
      `);
      return { deleted: true };
    });
  }

  async function removeBatchItemForOwner(
    batchId: string,
    itemId: string,
  ): Promise<{ removed: boolean }> {
    return database.$transaction(async (transaction) => {
      await requireOwnedBatch(transaction, batchId);
      const activeRows = await transaction.$queryRaw<Array<{ ownerSubject: string }>>(Prisma.sql`
        SELECT "ownerSubject"
        FROM "ProductDiscoverySelection"
        WHERE "ownerSubject" = ${PRODUCT_BATCH_OWNER_SUBJECT}
          AND "activeProductBatchId" = ${batchId}
        LIMIT 1
      `);
      if (activeRows.length > 0) {
        repositoryError(
          "batch_is_active",
          "Switch away from a ProductBatch before removing items.",
        );
      }
      const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        DELETE FROM "ProductBatchItem"
        WHERE "batchId" = ${batchId}
          AND "id" = ${itemId}
        RETURNING "id"
      `);
      if (!rows[0]) {
        repositoryError(
          "batch_item_not_found",
          "ProductBatch item was not found.",
        );
      }
      return { removed: true };
    });
  }

  return {
    createProcessingBatch,
    findBatchByDedupeKey,
    getBatchByIdForOwner,
    listBatchesForOwner,
    getBatchItemsForOwner,
    markBatchReady,
    markBatchBlocked,
    retryBlockedBatch,
    archiveBatch,
    deleteBatchForOwner,
    removeBatchItemForOwner,
    replaceOrInsertBatchItemsDuringProcessing,
    getActiveSelection,
    setActiveBatch,
    setActiveLegacyRegistration,
  };
}

const defaultProductBatchRepository = createProductBatchRepository();

export const createProcessingBatch =
  defaultProductBatchRepository.createProcessingBatch;
export const findBatchByDedupeKey =
  defaultProductBatchRepository.findBatchByDedupeKey;
export const getBatchByIdForOwner =
  defaultProductBatchRepository.getBatchByIdForOwner;
export const listBatchesForOwner =
  defaultProductBatchRepository.listBatchesForOwner;
export const getBatchItemsForOwner =
  defaultProductBatchRepository.getBatchItemsForOwner;
export const markBatchReady =
  defaultProductBatchRepository.markBatchReady;
export const markBatchBlocked =
  defaultProductBatchRepository.markBatchBlocked;
export const retryBlockedBatch =
  defaultProductBatchRepository.retryBlockedBatch;
export const archiveBatch =
  defaultProductBatchRepository.archiveBatch;
export const deleteBatchForOwner =
  defaultProductBatchRepository.deleteBatchForOwner;
export const removeBatchItemForOwner =
  defaultProductBatchRepository.removeBatchItemForOwner;
export const replaceOrInsertBatchItemsDuringProcessing =
  defaultProductBatchRepository.replaceOrInsertBatchItemsDuringProcessing;
export const getActiveSelection =
  defaultProductBatchRepository.getActiveSelection;
export const setActiveBatch =
  defaultProductBatchRepository.setActiveBatch;
export const setActiveLegacyRegistration =
  defaultProductBatchRepository.setActiveLegacyRegistration;
