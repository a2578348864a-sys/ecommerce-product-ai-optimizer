import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDemoAccess,
  getDemoAccessById,
  getRemainingAiCalls,
} from "@/lib/server/demoAccess";
import { createDemoProductBatchStore } from "@/lib/server/demoProductBatchStore";
import {
  importSellerSpriteProductBatch,
  inspectSellerSpriteProductBatch,
} from "@/lib/server/productBatchImportService";
import { SELLERSPRITE_SANITIZED_ROWS } from "@/lib/upstream/sellersprite/fixtures/search-export.sanitized.v1";
import {
  SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
  SELLERSPRITE_CATEGORY_CURRENT_ROWS,
} from "@/lib/upstream/sellersprite/fixtures/category-current.sanitized.v1";
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
  it("inspects report type and category before persistence without inventing a query", () => {
    const categoryCurrent = inspectSellerSpriteProductBatch(
      new Uint8Array(createSellerSpritePreviewTestWorkbook({
        headers: SELLERSPRITE_CATEGORY_CURRENT_HEADERS,
        rows: SELLERSPRITE_CATEGORY_CURRENT_ROWS.map((row) => ({
          ...row,
          大类目: "Kitchen & Dining",
        })),
      })),
      new Date("2026-07-29T00:00:00.000Z"),
    );
    const searchResults = inspectSellerSpriteProductBatch(
      new Uint8Array(createSellerSpritePreviewTestWorkbook({
        rows: SELLERSPRITE_SANITIZED_ROWS.map((row) => ({
          ...row,
          大类目: "Home & Kitchen",
        })),
      })),
      new Date("2026-07-29T00:00:00.000Z"),
    );

    expect(categoryCurrent).toMatchObject({
      reportType: "category_current",
      reportTypeDetected: true,
      categoryDetection: {
        status: "detected",
        category: "Kitchen & Dining",
      },
      query: null,
      queryDetection: "not_available",
    });
    expect(searchResults).toMatchObject({
      reportType: "search_results",
      reportTypeDetected: true,
      categoryDetection: {
        status: "detected",
        category: "Home & Kitchen",
      },
    });
  });

  it("uses the frozen workbook structure detector when no report type is selected", async () => {
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const result = await importSellerSpriteProductBatch({
      ...input(store),
      reportType: null,
    });

    expect(result.batch.reportType).toBe("search_results");
    expect(JSON.parse(result.batch.normalizedSnapshotJson!).reportType).toBe("search_results");
  });

  it("keeps validated Data URL compatibility and never persists an untrusted remote URL", async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const dataUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const rows = SELLERSPRITE_SANITIZED_ROWS.map((row, index) => ({
      ...row,
      商品主图: index === 0 ? dataUrl : "https://images.example.invalid/product.jpg",
    }));
    const result = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({ rows })),
      reportType: null,
    });
    const items = await store.getBatchItems(result.batch.id);
    const cached = items.find((item) => item.asin === SELLERSPRITE_SANITIZED_ROWS[0].ASIN);
    const remote = items.find((item) => item.asin === SELLERSPRITE_SANITIZED_ROWS[1].ASIN);

    expect(JSON.parse(cached!.imageSnapshotJson)).toMatchObject({
      version: "product-batch-image-snapshot.v1",
      status: "cached",
      mimeType: "image/png",
      sizeBytes: pngBytes.length,
      byteLength: pngBytes.length,
      base64: pngBytes.toString("base64"),
      sourceKind: "xlsx_embedded",
    });
    expect(JSON.parse(remote!.imageSnapshotJson)).toMatchObject({
      version: "product-batch-image-snapshot.v1",
      status: "not_cached",
      reason: "remote_fetch_failed",
    });
    expect(remote!.imageSnapshotJson).not.toContain("images.example.invalid");
  });

  it("prefers an exact embedded 图片 anchor and uses the controlled main-image fetch only when absent", async () => {
    const embeddedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const lowerPriorityPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const fetchedPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x02,
    ]);
    const rows = SELLERSPRITE_SANITIZED_ROWS.map((row, index) => ({
      ...row,
      商品主图: index === 1
        ? "https://m.media-amazon.com/images/I/fallback.png"
        : "https://m.media-amazon.com/images/I/unused.png",
    }));
    const fetchMainImage = vi.fn(async () => ({
      bytes: fetchedPng,
      mimeType: "image/png" as const,
      sha256: createHash("sha256").update(fetchedPng).digest("hex"),
    }));
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const result = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({
        rows,
        embeddedImages: [
          { rowIndex: 1, columnIndex: 1, bytes: embeddedJpeg },
          { rowIndex: 1, columnIndex: 13, bytes: lowerPriorityPng },
        ],
      })),
      fetchMainImage,
    });
    const items = await store.getBatchItems(result.batch.id);
    const first = JSON.parse(items.find(
      (item) => item.asin === SELLERSPRITE_SANITIZED_ROWS[0].ASIN,
    )!.imageSnapshotJson);
    const second = JSON.parse(items.find(
      (item) => item.asin === SELLERSPRITE_SANITIZED_ROWS[1].ASIN,
    )!.imageSnapshotJson);

    expect(first).toMatchObject({
      status: "cached",
      mimeType: "image/jpeg",
      sourceKind: "xlsx_embedded",
      sha256: createHash("sha256").update(embeddedJpeg).digest("hex"),
    });
    expect(second).toMatchObject({
      status: "cached",
      mimeType: "image/png",
      sourceKind: "xlsx_main_image_url",
      sha256: createHash("sha256").update(fetchedPng).digest("hex"),
    });
    expect(fetchMainImage).toHaveBeenCalledOnce();
    expect(fetchMainImage).toHaveBeenCalledWith(
      "https://m.media-amazon.com/images/I/fallback.png",
    );
  });

  it("keeps the batch ready with a safe not_cached reason when the remote download fails", async () => {
    const rows = SELLERSPRITE_SANITIZED_ROWS.map((row) => ({
      ...row,
      商品主图: "https://m.media-amazon.com/images/I/unavailable.jpg",
    }));
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const result = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({ rows })),
      fetchMainImage: async () => {
        throw new Error("safe synthetic failure");
      },
    });
    const items = await store.getBatchItems(result.batch.id);

    expect(result.batch.batchStatus).toBe("ready");
    expect(items.every((item) => {
      const image = JSON.parse(item.imageSnapshotJson);
      return image.status === "not_cached" && image.reason === "remote_fetch_failed";
    })).toBe(true);
    expect(items.map((item) => item.imageSnapshotJson).join(""))
      .not.toContain("m.media-amazon.com");
  });

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
