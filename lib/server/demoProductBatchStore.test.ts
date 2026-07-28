import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID,
} from "@/lib/marketScreeningProductionRegistry";
import {
  DemoProductBatchStoreError,
  createDemoProductBatchStore,
} from "@/lib/server/demoProductBatchStore";

const HASH = "a".repeat(64);

let root: string;

function createInput(sourceFileSha256 = "b".repeat(64)) {
  return {
    batchName: "Closet organizers",
    marketplace: "US",
    currency: "USD",
    reportType: "search_results" as const,
    query: "closet organizer",
    category: "Home",
    priceMinCents: 1500,
    priceMaxCents: 4500,
    briefHash: HASH,
    sourceFileName: "seller-sprite.xlsx",
    sourceFileSha256,
    sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
  };
}

function item() {
  return {
    productKey: "amazon:US:B000000001",
    ordinal: 0,
    asin: "B000000001",
    parentAsin: null,
    itemIdentityHash: "1".repeat(64),
    itemHash: "2".repeat(64),
    evidenceHash: "3".repeat(64),
    normalizedProductJson: '{"name":"Item 1"}',
    occurrenceProjectionJson: '{"occurrences":[]}',
    familyProjectionJson: '{"family":null}',
    rankingJson: '{"scoreRank":1}',
    provisionalDisposition: "provisional_score_only" as const,
    researchPriority: "priority_1" as const,
    evidenceStatus: "sufficient_for_comparison" as const,
    promotionEligible: false as const,
    imageSnapshotJson: '{"status":"not_cached"}',
  };
}

function readyInput() {
  return {
    normalizedBusinessHash: "c".repeat(64),
    snapshotHash: "d".repeat(64),
    manifestHash: "e".repeat(64),
    itemCount: 1,
    acceptedCount: 1,
    quarantinedCount: 0,
    dataQualityStatus: "passed" as const,
    importedAt: new Date("2026-07-28T00:00:00.000Z"),
    sellerSpriteDisclaimerVersion: "sellersprite-v1-frozen.2026-07-27",
    normalizedSnapshotJson: JSON.stringify({
      schemaVersion: "sellersprite-market-snapshot.v3",
    }),
    manifestJson: JSON.stringify({
      schemaVersion: "sellersprite-local-preview-manifest.v3",
    }),
    qualitySummaryJson: "{}",
    errorJson: null,
  };
}

async function createReady(
  store: ReturnType<typeof createDemoProductBatchStore>,
) {
  const created = await store.createOrReuseProcessingBatch(createInput());
  await store.saveBatchItems(created.batch.id, [item()]);
  return store.markReady(created.batch.id, readyInput());
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "demo-product-batches-"));
});

afterEach(() => {
  delete process.env.DEMO_PRODUCT_BATCH_STORE_ROOT;
  rmSync(root, { recursive: true, force: true });
});

describe("Visitor ProductBatch store contract", () => {
  it("uses the configured repository-external sandbox root by default", async () => {
    process.env.DEMO_PRODUCT_BATCH_STORE_ROOT = root;
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa");
    await store.createOrReuseProcessingBatch(createInput());
    const [storePath, resolvedRoot] = store.debugPathsForTests();
    expect(resolvedRoot).toBe(root);
    expect(storePath.startsWith(root)).toBe(true);
  });

  it("supports import, list, items, selection, legacy, archive and refresh recovery", async () => {
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const ready = await createReady(store);
    expect((await store.listBatches()).map((batch) => batch.id)).toEqual([ready.id]);
    expect(await store.getBatchItems(ready.id)).toHaveLength(1);

    await store.activateBatch(ready.id);
    expect(await store.getSelection()).toMatchObject({
      activeProductBatchId: ready.id,
      activeLegacyRegistrationId: null,
    });

    const refreshed = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    expect(await refreshed.getSelection()).toMatchObject({
      activeProductBatchId: ready.id,
    });
    await refreshed.activateLegacy(ACTIVE_PRODUCTION_MARKET_SCREENING_REGISTRATION_ID);
    const archived = await refreshed.archiveBatch(ready.id);
    expect(archived.batchStatus).toBe("archived");
  });

  it("deduplicates the same Visitor while keeping different Visitors isolated", async () => {
    const visitorA = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const visitorB = createDemoProductBatchStore("demo_bbbbbbbbbbbbbbbb", { root });
    const [results, other] = await Promise.all([
      Promise.all([
      visitorA.createOrReuseProcessingBatch(createInput()),
      visitorA.createOrReuseProcessingBatch(createInput()),
      visitorA.createOrReuseProcessingBatch(createInput()),
      ]),
      visitorB.createOrReuseProcessingBatch(createInput()),
    ]);
    expect(new Set(results.map((result) => result.batch.id))).toHaveLength(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);

    expect(other.batch.id).not.toBe(results[0].batch.id);
    expect(await visitorA.getBatch(other.batch.id)).toBeNull();
    expect(await visitorB.getBatch(results[0].batch.id)).toBeNull();
  });

  it("keeps Visitor A and B selections independent and blocks cross-Visitor activation", async () => {
    const visitorA = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const visitorB = createDemoProductBatchStore("demo_bbbbbbbbbbbbbbbb", { root });
    const readyA = await createReady(visitorA);
    await visitorA.activateBatch(readyA.id);

    await expect(visitorB.activateBatch(readyA.id)).rejects.toMatchObject({
      code: "batch_not_found",
    });
    expect(await visitorB.getSelection()).toBeNull();
    expect(await visitorA.getSelection()).toMatchObject({
      activeProductBatchId: readyA.id,
    });
  });

  it("fails closed for traversal identities and never creates a path outside the root", () => {
    expect(() => createDemoProductBatchStore("../visitor-b", { root }))
      .toThrow(DemoProductBatchStoreError);
    expect(existsSync(join(root, "..", "visitor-b.json"))).toBe(false);
  });

  it("fails closed on corrupt JSON without overwriting the old file", async () => {
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    await store.createOrReuseProcessingBatch(createInput());
    const [storePath] = store.debugPathsForTests();
    writeFileSync(storePath, '{"version":1,"batches":', "utf8");
    const before = readFileSync(storePath, "utf8");

    await expect(store.listBatches()).rejects.toMatchObject({
      code: "demo_product_batch_store_invalid",
    });
    expect(readFileSync(storePath, "utf8")).toBe(before);
  });

  it("keeps the old valid file when atomic rename fails", async () => {
    const initial = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    await initial.createOrReuseProcessingBatch(createInput());
    const [storePath] = initial.debugPathsForTests();
    const before = readFileSync(storePath, "utf8");
    const failing = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", {
      root,
      atomicRename: vi.fn(() => {
        throw new Error("rename failed");
      }),
    });

    await expect(failing.createOrReuseProcessingBatch(
      createInput("f".repeat(64)),
    )).rejects.toThrow("rename failed");
    expect(readFileSync(storePath, "utf8")).toBe(before);
  });
});
