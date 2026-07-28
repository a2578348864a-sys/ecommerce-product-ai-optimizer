import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDemoAccess,
  getDemoAccessById,
  getRemainingAiCalls,
} from "@/lib/server/demoAccess";
import { createDemoProductBatchStore } from "@/lib/server/demoProductBatchStore";
import { importSellerSpriteProductBatch } from "@/lib/server/productBatchImportService";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "product-batch-import-"));
});

afterEach(() => {
  delete process.env.DEMO_ACCESS_STORE_PATH;
  rmSync(root, { recursive: true, force: true });
});

function input(store: ReturnType<typeof createDemoProductBatchStore>) {
  return {
    store,
    bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook()),
    sourceFileName: "seller-sprite.xlsx",
    reportType: "search_results" as const,
    query: "closet organizer",
    category: "Home",
    priceMin: 10,
    priceMax: 40,
    now: new Date("2026-07-28T00:00:00.000Z"),
  };
}

describe("shared SellerSprite ProductBatch import", () => {
  it("produces the same Snapshot v3 and Ranking v2 for separate role stores", async () => {
    const ownerLike = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const visitor = createDemoProductBatchStore("demo_bbbbbbbbbbbbbbbb", { root });
    const ownerResult = await importSellerSpriteProductBatch(input(ownerLike));
    const visitorResult = await importSellerSpriteProductBatch(input(visitor));

    expect(ownerResult.batch.normalizedBusinessHash).toBe(
      visitorResult.batch.normalizedBusinessHash,
    );
    expect(ownerResult.batch.snapshotHash).toBe(visitorResult.batch.snapshotHash);
    expect(ownerResult.batch.manifestHash).toBe(visitorResult.batch.manifestHash);
    expect(JSON.parse(ownerResult.batch.normalizedSnapshotJson!).schemaVersion)
      .toBe("sellersprite-market-snapshot.v3");
    expect(JSON.parse(ownerResult.batch.manifestJson!).rankingSchemaVersion)
      .toBe("sellersprite-market-signal-ranking.v2");

    const ownerItems = await ownerLike.getBatchItems(ownerResult.batch.id);
    const visitorItems = await visitor.getBatchItems(visitorResult.batch.id);
    expect(ownerItems.map((item) => item.rankingJson))
      .toEqual(visitorItems.map((item) => item.rankingJson));
    expect(ownerItems.every((item) => item.promotionEligible === false)).toBe(true);
    expect(ownerItems.map((item) => item.provisionalDisposition))
      .not.toContain("advance");
  });

  it("does not persist the raw XLSX or any absolute source path", async () => {
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    await importSellerSpriteProductBatch(input(store));
    const files = readdirSync(root);
    expect(files).toHaveLength(1);
    expect(files.some((name) => name.endsWith(".xlsx"))).toBe(false);
    const persisted = readFileSync(join(root, files[0]), "utf8");
    expect(persisted).not.toContain(root);
    expect(persisted).not.toContain("UEsDB");
  });

  it("reuses an existing batch for a repeated identical import", async () => {
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const first = await importSellerSpriteProductBatch(input(store));
    const second = await importSellerSpriteProductBatch(input(store));
    expect(second.created).toBe(false);
    expect(second.batch.id).toBe(first.batch.id);
    expect(await store.listBatches()).toHaveLength(1);
  });

  it("does not consume Visitor real-AI quota during import", async () => {
    process.env.DEMO_ACCESS_STORE_PATH = join(root, "quota.json");
    const { record } = createDemoAccess({
      label: "Batch import quota test",
      hours: 24,
      maxAiCalls: 5,
      startFromCreation: true,
    });
    const before = getRemainingAiCalls(record);
    const store = createDemoProductBatchStore(record.id, {
      root: join(root, "batches"),
    });
    await importSellerSpriteProductBatch(input(store));
    const after = getDemoAccessById(record.id);
    expect(after).not.toBeNull();
    expect(getRemainingAiCalls(after!)).toBe(before);
    expect(after!.usedAiCalls).toBe(0);
  });
});
