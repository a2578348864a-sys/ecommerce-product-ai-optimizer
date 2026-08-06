import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  PRODUCT_BATCH_MAX_ITEMS,
  ProductBatchContractError,
  assertActiveSelection,
  assertBatchStatusTransition,
  assertJsonFieldWithinLimit,
  assertProductBatchItemForPersistence,
  assertReadyBatchCompleteness,
  buildProductBatchDedupeKey,
  type ReadyBatchCompletenessInput,
} from "@/lib/productBatchContract";
import type {
  ProductBatchBlockedInput,
  ProductBatchCreateInput,
  ProductBatchItemInput,
  ProductBatchItemView,
  ProductBatchSelectionView,
  ProductBatchStore,
  ProductBatchView,
} from "@/lib/productBatchStore";
import { resolveProductionMarketScreeningRegistration } from "@/lib/marketScreeningProductionRegistry";

const STORE_VERSION = 1 as const;
const DEMO_ACCESS_ID_PATTERN = /^demo_[A-Za-z0-9_-]{1,120}$/;

interface DemoProductBatchFile {
  version: typeof STORE_VERSION;
  createdAt: string;
  updatedAt: string;
  batches: ProductBatchView[];
  items: ProductBatchItemView[];
  selection: ProductBatchSelectionView | null;
}

export class DemoProductBatchStoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoProductBatchStoreError";
  }
}

interface DemoProductBatchStoreOptions {
  root?: string;
  now?: () => Date;
  atomicRename?: (source: string, destination: string) => void;
}

const subjectLocks = new Map<string, Promise<void>>();

function fail(code: string, message: string): never {
  throw new DemoProductBatchStoreError(code, message);
}

function translateContractError(error: unknown): never {
  if (error instanceof ProductBatchContractError) {
    fail(error.code, error.message);
  }
  throw error;
}

async function withSubjectLock<T>(
  key: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const previous = subjectLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  subjectLocks.set(key, current);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (subjectLocks.get(key) === current) subjectLocks.delete(key);
  }
}

function validIso(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !Number.isNaN(Date.parse(value));
}

function validOptionalText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validOptionalCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function assertBatch(batch: ProductBatchView): void {
  if (
    typeof batch !== "object"
    || batch === null
    || typeof batch.id !== "string"
    || batch.id.length === 0
    || typeof batch.batchName !== "string"
    || batch.batchName.length === 0
    || typeof batch.marketplace !== "string"
    || typeof batch.currency !== "string"
    || (batch.reportType !== "search_results" && batch.reportType !== "category_current")
    || !validOptionalText(batch.query)
    || !validOptionalText(batch.category)
    || !validOptionalCount(batch.priceMinCents)
    || !validOptionalCount(batch.priceMaxCents)
    || !/^[a-f0-9]{64}$/.test(batch.briefHash)
    || typeof batch.sourceFileName !== "string"
    || batch.sourceFileName.includes("/")
    || batch.sourceFileName.includes("\\")
    || isAbsolute(batch.sourceFileName)
    || !/^[a-f0-9]{64}$/.test(batch.sourceFileSha256)
    || !/^[a-f0-9]{64}$/.test(batch.dedupeKey)
    || !validOptionalCount(batch.itemCount)
    || !validOptionalCount(batch.acceptedCount)
    || !validOptionalCount(batch.quarantinedCount)
    || !validIso(batch.createdAt)
    || !validIso(batch.updatedAt)
    || (batch.importedAt !== null && !validIso(batch.importedAt))
  ) {
    fail("demo_product_batch_store_invalid", "Visitor ProductBatch file contains an invalid batch.");
  }
  if (
    !["processing", "ready", "blocked", "archived"].includes(batch.batchStatus)
    || !["pending", "passed", "passed_with_quarantine", "blocked"]
      .includes(batch.dataQualityStatus)
  ) {
    fail("demo_product_batch_store_invalid", "Visitor ProductBatch status is invalid.");
  }
  try {
    assertJsonFieldWithinLimit("qualitySummaryJson", batch.qualitySummaryJson);
    if (batch.errorJson !== null) assertJsonFieldWithinLimit("errorJson", batch.errorJson);
    if (batch.batchStatus === "ready" || batch.batchStatus === "archived") {
      assertReadyBatchCompleteness({
        normalizedBusinessHash: batch.normalizedBusinessHash,
        snapshotHash: batch.snapshotHash,
        manifestHash: batch.manifestHash,
        itemCount: batch.itemCount,
        acceptedCount: batch.acceptedCount,
        quarantinedCount: batch.quarantinedCount,
        dataQualityStatus: batch.dataQualityStatus,
        importedAt: batch.importedAt === null ? null : new Date(batch.importedAt),
        sellerSpriteDisclaimerVersion: batch.sellerSpriteDisclaimerVersion,
        normalizedSnapshotJson: batch.normalizedSnapshotJson,
        manifestJson: batch.manifestJson,
        qualitySummaryJson: batch.qualitySummaryJson,
        errorJson: batch.errorJson,
      });
    }
  } catch (error) {
    translateContractError(error);
  }
}

function assertStore(value: unknown): asserts value is DemoProductBatchFile {
  if (typeof value !== "object" || value === null) {
    fail("demo_product_batch_store_invalid", "Visitor ProductBatch file must be an object.");
  }
  const store = value as DemoProductBatchFile;
  if (
    store.version !== STORE_VERSION
    || !validIso(store.createdAt)
    || !validIso(store.updatedAt)
    || !Array.isArray(store.batches)
    || !Array.isArray(store.items)
  ) {
    fail("demo_product_batch_store_invalid", "Visitor ProductBatch file header is invalid.");
  }
  const batchIds = new Set<string>();
  const dedupeKeys = new Set<string>();
  for (const batch of store.batches) {
    assertBatch(batch);
    if (batchIds.has(batch.id) || dedupeKeys.has(batch.dedupeKey)) {
      fail("demo_product_batch_store_invalid", "Visitor ProductBatch identities are duplicated.");
    }
    batchIds.add(batch.id);
    dedupeKeys.add(batch.dedupeKey);
  }
  const itemIds = new Set<string>();
  const identitiesByBatch = new Map<string, Set<string>>();
  for (const item of store.items) {
    if (
      typeof item !== "object"
      || item === null
      || typeof item.id !== "string"
      || typeof item.batchId !== "string"
      || !batchIds.has(item.batchId)
      || !validIso(item.createdAt)
      || itemIds.has(item.id)
    ) {
      fail("demo_product_batch_store_invalid", "Visitor ProductBatch item envelope is invalid.");
    }
    try {
      assertProductBatchItemForPersistence(item);
    } catch (error) {
      translateContractError(error);
    }
    itemIds.add(item.id);
    const identities = identitiesByBatch.get(item.batchId) ?? new Set<string>();
    const identity = `${item.productKey}\u0000${item.ordinal}\u0000${item.itemIdentityHash}`;
    if (identities.has(identity)) {
      fail("demo_product_batch_store_invalid", "Visitor ProductBatch item identity is duplicated.");
    }
    identities.add(identity);
    identitiesByBatch.set(item.batchId, identities);
  }
  if (store.selection !== null) {
    if (
      typeof store.selection !== "object"
      || !validIso(store.selection.updatedAt)
    ) {
      fail("demo_product_batch_store_invalid", "Visitor selection is invalid.");
    }
    try {
      assertActiveSelection(store.selection);
    } catch (error) {
      translateContractError(error);
    }
    if (
      store.selection.activeProductBatchId !== null
      && !batchIds.has(store.selection.activeProductBatchId)
    ) {
      fail("demo_product_batch_store_invalid", "Visitor selection points to another sandbox.");
    }
    if (
      store.selection.activeLegacyRegistrationId !== null
      && !resolveProductionMarketScreeningRegistration(
        store.selection.activeLegacyRegistrationId,
      )
    ) {
      fail("demo_product_batch_store_invalid", "Visitor selection points to an unknown Legacy batch.");
    }
  }
}

function cloneStore(store: DemoProductBatchFile): DemoProductBatchFile {
  return structuredClone(store);
}

function createEmptyStore(now: string): DemoProductBatchFile {
  return {
    version: STORE_VERSION,
    createdAt: now,
    updatedAt: now,
    batches: [],
    items: [],
    selection: null,
  };
}

function validateRoot(rootInput: string): string {
  const root = resolve(rootInput);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("demo_product_batch_root_unsafe", "Visitor ProductBatch root must be a real directory.");
  }
  const realRoot = resolve(realpathSync(root));
  if (realRoot.toLowerCase() !== root.toLowerCase()) {
    fail("demo_product_batch_root_unsafe", "Visitor ProductBatch root cannot traverse a link.");
  }
  return root;
}

function resolveSubjectPath(root: string, demoAccessId: string): string {
  if (!DEMO_ACCESS_ID_PATTERN.test(demoAccessId)) {
    fail("demo_access_id_invalid", "Visitor identity is invalid.");
  }
  const candidate = resolve(root, `${demoAccessId}.json`);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || isAbsolute(rel) || dirname(candidate) !== root) {
    fail("demo_product_batch_path_unsafe", "Visitor ProductBatch path escaped its sandbox root.");
  }
  return candidate;
}

function loadStrict(storePath: string, now: string): DemoProductBatchFile {
  if (!existsSync(storePath)) return createEmptyStore(now);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8"));
  } catch {
    fail("demo_product_batch_store_invalid", "Visitor ProductBatch file is corrupt.");
  }
  assertStore(parsed);
  return parsed;
}

function persistAtomic(
  storePath: string,
  store: DemoProductBatchFile,
  atomicRename: (source: string, destination: string) => void,
): void {
  assertStore(store);
  const serialized = `${JSON.stringify(store, null, 2)}\n`;
  const reparsed: unknown = JSON.parse(serialized);
  assertStore(reparsed);
  const tempPath = `${storePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(tempPath, "wx", 0o600);
    writeFileSync(descriptor, serialized, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    atomicRename(tempPath, storePath);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(tempPath)) rmSync(tempPath, { force: true });
  }
}

function validateCreateInput(input: ProductBatchCreateInput): {
  dedupeKey: string;
  batchName: string;
  marketplace: string;
  currency: string;
  sourceFileName: string;
  sellerSpriteDisclaimerVersion: string;
} {
  const batchName = input.batchName.trim();
  const marketplace = input.marketplace.trim().toUpperCase();
  const currency = input.currency.trim().toUpperCase();
  const sourceFileName = input.sourceFileName.trim();
  const sellerSpriteDisclaimerVersion = input.sellerSpriteDisclaimerVersion.trim();
  if (
    !batchName
    || Buffer.byteLength(batchName, "utf8") > 256
    || !marketplace
    || !/^[A-Z]{3}$/.test(currency)
    || !sourceFileName
    || sourceFileName.includes("/")
    || sourceFileName.includes("\\")
    || isAbsolute(sourceFileName)
    || !sellerSpriteDisclaimerVersion
  ) {
    fail("batch_create_input_invalid", "Visitor ProductBatch input is invalid.");
  }
  try {
    return {
      dedupeKey: buildProductBatchDedupeKey({ ...input, marketplace }),
      batchName,
      marketplace,
      currency,
      sourceFileName,
      sellerSpriteDisclaimerVersion,
    };
  } catch (error) {
    translateContractError(error);
  }
}

export function createDemoProductBatchStore(
  demoAccessId: string,
  options: DemoProductBatchStoreOptions = {},
): ProductBatchStore & { debugPathsForTests(): readonly [string, string] } {
  const root = validateRoot(
    options.root
      ?? process.env.DEMO_PRODUCT_BATCH_STORE_ROOT
      ?? resolve(process.cwd(), "data", "demo-product-batches"),
  );
  const storePath = resolveSubjectPath(root, demoAccessId);
  const lockKey = storePath.toLowerCase();
  const nowDate = options.now ?? (() => new Date());
  const atomicRename = options.atomicRename ?? renameSync;

  const nowIso = () => nowDate().toISOString();

  const read = <T>(select: (store: DemoProductBatchFile) => T): Promise<T> => (
    withSubjectLock(lockKey, () => select(cloneStore(loadStrict(storePath, nowIso()))))
  );

  const update = <T>(
    mutate: (store: DemoProductBatchFile, now: string) => T,
  ): Promise<T> => withSubjectLock(lockKey, () => {
    const now = nowIso();
    const store = cloneStore(loadStrict(storePath, now));
    const result = mutate(store, now);
    store.updatedAt = now;
    persistAtomic(storePath, store, atomicRename);
    return result;
  });

  const getRequiredBatch = (store: DemoProductBatchFile, batchId: string) => {
    const batch = store.batches.find((candidate) => candidate.id === batchId);
    if (!batch) fail("batch_not_found", "ProductBatch was not found in this Visitor sandbox.");
    return batch;
  };

  return {
    async createOrReuseProcessingBatch(input) {
      const validated = validateCreateInput(input);
      return update((store, now) => {
        const existing = store.batches.find(
          (batch) => batch.dedupeKey === validated.dedupeKey,
        );
        if (existing) return { batch: structuredClone(existing), created: false };
        const batch: ProductBatchView = {
          id: randomUUID(),
          batchName: validated.batchName,
          marketplace: validated.marketplace,
          currency: validated.currency,
          reportType: input.reportType,
          query: input.query,
          category: input.category,
          priceMinCents: input.priceMinCents,
          priceMaxCents: input.priceMaxCents,
          briefHash: input.briefHash,
          sourceFileName: validated.sourceFileName,
          sourceFileSha256: input.sourceFileSha256,
          normalizedBusinessHash: null,
          snapshotHash: null,
          manifestHash: null,
          itemCount: null,
          acceptedCount: null,
          quarantinedCount: null,
          dataQualityStatus: "pending",
          batchStatus: "processing",
          sellerSpriteDisclaimerVersion: validated.sellerSpriteDisclaimerVersion,
          normalizedSnapshotJson: null,
          manifestJson: null,
          qualitySummaryJson: "{}",
          errorJson: null,
          dedupeKey: validated.dedupeKey,
          importedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        assertBatch(batch);
        store.batches.push(batch);
        return { batch: structuredClone(batch), created: true };
      });
    },

    async saveBatchItems(batchId, items) {
      if (items.length > PRODUCT_BATCH_MAX_ITEMS) {
        fail("batch_item_limit_exceeded", "ProductBatch cannot exceed 500 items.");
      }
      for (const item of items) {
        try {
          assertProductBatchItemForPersistence(item);
        } catch (error) {
          translateContractError(error);
        }
      }
      const productKeys = new Set(items.map((item) => item.productKey));
      const ordinals = new Set(items.map((item) => item.ordinal));
      const identities = new Set(items.map((item) => item.itemIdentityHash));
      if (
        productKeys.size !== items.length
        || ordinals.size !== items.length
        || identities.size !== items.length
      ) {
        fail("batch_item_identity_conflict", "ProductBatch items are duplicated.");
      }
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        if (batch.batchStatus !== "processing") {
          fail("batch_snapshot_immutable", "Only processing batches can save items.");
        }
        store.items = store.items.filter((item) => item.batchId !== batchId);
        store.items.push(...items.map((item): ProductBatchItemView => ({
          ...structuredClone(item),
          id: randomUUID(),
          batchId,
          createdAt: now,
        })));
        return { insertedCount: items.length };
      });
    },

    async markReady(batchId, input) {
      try {
        assertReadyBatchCompleteness(input);
      } catch (error) {
        translateContractError(error);
      }
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        try {
          assertBatchStatusTransition(batch.batchStatus, "ready");
        } catch (error) {
          translateContractError(error);
        }
        if (store.items.filter((item) => item.batchId === batchId).length !== input.acceptedCount) {
          fail("batch_item_count_mismatch", "Stored items do not match acceptedCount.");
        }
        Object.assign(batch, {
          ...input,
          importedAt: input.importedAt!.toISOString(),
          batchStatus: "ready" as const,
          updatedAt: now,
        });
        assertBatch(batch);
        return structuredClone(batch);
      });
    },

    async markBlocked(batchId, input) {
      try {
        assertJsonFieldWithinLimit("errorJson", input.errorJson);
        assertJsonFieldWithinLimit("qualitySummaryJson", input.qualitySummaryJson);
      } catch (error) {
        translateContractError(error);
      }
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        try {
          assertBatchStatusTransition(batch.batchStatus, "blocked");
        } catch (error) {
          translateContractError(error);
        }
        Object.assign(batch, {
          batchStatus: "blocked" as const,
          dataQualityStatus: "blocked" as const,
          errorJson: input.errorJson,
          qualitySummaryJson: input.qualitySummaryJson,
          updatedAt: now,
        });
        return structuredClone(batch);
      });
    },

    async retryBlocked(batchId) {
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        try {
          assertBatchStatusTransition(batch.batchStatus, "processing");
        } catch (error) {
          translateContractError(error);
        }
        Object.assign(batch, {
          batchStatus: "processing" as const,
          dataQualityStatus: "pending" as const,
          errorJson: null,
          updatedAt: now,
        });
        return structuredClone(batch);
      });
    },

    async listBatches() {
      return read((store) => [...store.batches].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt)
          || right.id.localeCompare(left.id),
      ));
    },

    async getBatch(batchId) {
      return read((store) => (
        store.batches.find((batch) => batch.id === batchId) ?? null
      ));
    },

    async getBatchItems(batchId) {
      return read((store) => {
        if (!store.batches.some((batch) => batch.id === batchId)) return [];
        return store.items
          .filter((item) => item.batchId === batchId)
          .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
      });
    },

    async getSelection() {
      return read((store) => store.selection);
    },

    async activateBatch(batchId) {
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        if (batch.batchStatus !== "ready") {
          fail("batch_not_activatable", "Only a ready ProductBatch can become active.");
        }
        store.selection = {
          activeProductBatchId: batchId,
          activeLegacyRegistrationId: null,
          updatedAt: now,
        };
        return structuredClone(store.selection);
      });
    },

    async activateLegacy(registrationId) {
      if (!resolveProductionMarketScreeningRegistration(registrationId)) {
        fail("legacy_registration_not_found", "Legacy registration is not allowed.");
      }
      return update((store, now) => {
        store.selection = {
          activeProductBatchId: null,
          activeLegacyRegistrationId: registrationId,
          updatedAt: now,
        };
        return structuredClone(store.selection);
      });
    },

    async archiveBatch(batchId) {
      return update((store, now) => {
        const batch = getRequiredBatch(store, batchId);
        try {
          assertBatchStatusTransition(batch.batchStatus, "archived");
        } catch (error) {
          translateContractError(error);
        }
        if (store.selection?.activeProductBatchId === batchId) {
          fail("batch_is_active", "Switch away from a ProductBatch before archiving it.");
        }
        batch.batchStatus = "archived";
        batch.updatedAt = now;
        return structuredClone(batch);
      });
    },

    async deleteBatch(batchId) {
      return update((store) => {
        // 存在性检查（不存在即抛 batch_not_found）
        getRequiredBatch(store, batchId);
        if (store.selection?.activeProductBatchId === batchId) {
          fail("batch_is_active", "Switch away from a ProductBatch before deleting it.");
        }
        store.batches = store.batches.filter((candidate) => candidate.id !== batchId);
        store.items = store.items.filter((item) => item.batchId !== batchId);
        return { deleted: true };
      });
    },

    async removeBatchItem(batchId, itemId) {
      return update((store) => {
        const batch = getRequiredBatch(store, batchId);
        if (store.selection?.activeProductBatchId === batchId) {
          fail("batch_is_active", "Switch away from a ProductBatch before removing items.");
        }
        const before = store.items.length;
        store.items = store.items.filter(
          (item) => !(item.batchId === batchId && item.id === itemId),
        );
        if (store.items.length === before) {
          fail("batch_item_not_found", "ProductBatch item was not found.");
        }
        return { removed: true };
      });
    },

    debugPathsForTests() {
      return [storePath, root] as const;
    },
  };
}
