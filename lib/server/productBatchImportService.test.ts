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
  GOLDEN_CC_CURRENT_ROWS,
  GOLDEN_CURRENT_FORMAT_HEADERS,
} from "@/lib/upstream/sellersprite/golden/golden-fixtures";
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
        headers: [...GOLDEN_CURRENT_FORMAT_HEADERS],
        rows: GOLDEN_CC_CURRENT_ROWS.map((row) => ({
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

  it("persists only products inside the inclusive price filter", async () => {
    const rows = SELLERSPRITE_SANITIZED_ROWS.map((row, index) => ({
      ...row,
      "价格($)": index === 0 ? "$20.00" : "$25.00",
    }));
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", { root });
    const upperBoundResult = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({ rows })),
      priceMin: 10,
      priceMax: 20,
    });

    const upperBoundItems = await store.getBatchItems(upperBoundResult.batch.id);

    expect(upperBoundItems.map((item) => item.asin))
      .toEqual([SELLERSPRITE_SANITIZED_ROWS[0].ASIN]);
    expect(upperBoundResult.batch.priceMinCents).toBe(1_000);
    expect(upperBoundResult.batch.priceMaxCents).toBe(2_000);
    expect(upperBoundResult.batch.acceptedCount).toBe(1);

    const lowerBoundResult = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({ rows })),
      priceMin: 20.01,
      priceMax: 30,
    });
    const lowerBoundItems = await store.getBatchItems(lowerBoundResult.batch.id);

    expect(lowerBoundItems.map((item) => item.asin))
      .toEqual([SELLERSPRITE_SANITIZED_ROWS[1].ASIN]);
    expect(lowerBoundResult.batch.priceMinCents).toBe(2_001);
    expect(lowerBoundResult.batch.priceMaxCents).toBe(3_000);
    expect(lowerBoundResult.batch.acceptedCount).toBe(1);
  });

  it.each([
    {
      label: "10 through 20",
      priceMin: 10,
      priceMax: 20,
      expectedAsins: ["B0TST00001", "B0TST00002"],
      expectedMinCents: 1_000,
      expectedMaxCents: 2_000,
    },
    {
      label: "20.01 through 30",
      priceMin: 20.01,
      priceMax: 30,
      expectedAsins: ["B0TST00003", "B0TST00004"],
      expectedMinCents: 2_001,
      expectedMaxCents: 3_000,
    },
    {
      label: "50 through 100",
      priceMin: 50,
      priceMax: 100,
      expectedAsins: ["B0TST00005", "B0TST00006"],
      expectedMinCents: 5_000,
      expectedMaxCents: 10_000,
    },
    {
      label: "minimum 50 only",
      priceMin: 50,
      priceMax: null,
      expectedAsins: ["B0TST00005", "B0TST00006"],
      expectedMinCents: 5_000,
      expectedMaxCents: null,
    },
    {
      label: "maximum 20 only",
      priceMin: null,
      priceMax: 20,
      expectedAsins: ["B0TST00001", "B0TST00002"],
      expectedMinCents: null,
      expectedMaxCents: 2_000,
    },
    {
      label: "no price filter",
      priceMin: null,
      priceMax: null,
      expectedAsins: [
        "B0TST00001",
        "B0TST00002",
        "B0TST00003",
        "B0TST00004",
        "B0TST00005",
        "B0TST00006",
        "B0TST00007",
        "B0TST00008",
      ],
      expectedMinCents: null,
      expectedMaxCents: null,
    },
  ])("applies the user supplied $label range to ProductBatchItem persistence", async ({
    label,
    priceMin,
    priceMax,
    expectedAsins,
    expectedMinCents,
    expectedMaxCents,
  }) => {
    const pricedRows = [10, 20, 20.01, 30, 50, 100].map((price, index) => ({
      ...SELLERSPRITE_SANITIZED_ROWS[index % SELLERSPRITE_SANITIZED_ROWS.length],
      "#": String(index + 1),
      ASIN: `B0TST0000${index + 1}`,
      SKU: `PRICE-${index + 1}`,
      搜索排名: `自然位：第1页第${index + 1}位`,
      商品标题: `Dynamic price product ${index + 1}`,
      商品详情页链接: `https://www.amazon.com/dp/B0TST0000${index + 1}`,
      父ASIN: "",
      "价格($)": `$${price.toFixed(2)}`,
    }));
    const missingPrice = {
      ...SELLERSPRITE_SANITIZED_ROWS[0],
      "#": "7",
      ASIN: "B0TST00007",
      SKU: "PRICE-7",
      搜索排名: "自然位：第1页第7位",
      商品标题: "Missing price product",
      商品详情页链接: "https://www.amazon.com/dp/B0TST00007",
      父ASIN: "",
      "价格($)": "",
    };
    const conflictingPriceRows = ["$25.00", "$35.00"].map((price, index) => ({
      ...SELLERSPRITE_SANITIZED_ROWS[1],
      "#": String(index + 8),
      ASIN: "B0TST00008",
      SKU: `PRICE-CONFLICT-${index + 1}`,
      搜索排名: `自然位：第1页第${index + 8}位`,
      商品标题: "Conflicting price product",
      商品详情页链接: "https://www.amazon.com/dp/B0TST00008",
      父ASIN: "",
      "价格($)": price,
    }));
    const store = createDemoProductBatchStore("demo_aaaaaaaaaaaaaaaa", {
      root: join(root, label.replaceAll(" ", "-")),
    });

    const result = await importSellerSpriteProductBatch({
      ...input(store),
      bytes: new Uint8Array(createSellerSpritePreviewTestWorkbook({
        rows: [...pricedRows, missingPrice, ...conflictingPriceRows],
      })),
      priceMin,
      priceMax,
    });
    const items = await store.getBatchItems(result.batch.id);

    expect(items.map((item) => item.asin).sort()).toEqual([...expectedAsins].sort());
    expect(result.batch.priceMinCents).toBe(expectedMinCents);
    expect(result.batch.priceMaxCents).toBe(expectedMaxCents);
    expect(result.batch.acceptedCount).toBe(expectedAsins.length);
    if (priceMin === null && priceMax === null) {
      const missingProduct = JSON.parse(
        items.find((item) => item.asin === "B0TST00007")!.normalizedProductJson,
      );
      const conflictingProduct = JSON.parse(
        items.find((item) => item.asin === "B0TST00008")!.normalizedProductJson,
      );
      expect(missingProduct.providerMetrics.price.status).toBe("missing");
      expect(conflictingProduct.providerMetrics.price.status).toBe("conflict");
    }
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
