import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  SELLERSPRITE_PLUGIN_FIELD_KEYS,
  SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS,
  SELLERSPRITE_PLUGIN_PANEL_COLUMNS,
  SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256,
  SELLERSPRITE_PLUGIN_SOURCE_SUBTYPE,
  mapPluginRowToSellerSpriteImportRow,
  sellerSpritePluginAcceptedRowsDigest,
  sellerSpritePluginWarningDigest,
  validateSellerSpritePluginRows,
  validateSellerSpritePluginSelectedRowHashes,
  type SellerSpritePluginRow,
} from "@/lib/server/sellerSpritePluginContract";
import {
  buildSellerSpriteCandidateSourceMeta,
  computeSellerSpriteRowHash,
  parseSellerSpriteCandidateSourceMeta,
  SELLERSPRITE_IMPORT_MARKETPLACE,
} from "@/lib/server/sellerSpriteImportContract";

const CAPTURED_AT = "2026-08-20T08:30:00.000Z";

function fullRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asin: "b0test0001",
    title: "HydroJug Travel Tumbler 40oz",
    productUrl: "https://www.amazon.com/dp/B0TEST0001",
    parentAsin: "B0PARENT01",
    brand: "HydroJug",
    category: "Home & Kitchen",
    imageUrl: "https://images.example.test/hydrojug.jpg",
    sku: "HJ-40-BLK",
    priceUsd: 39.99,
    rating: 4.6,
    reviewCount: 1234,
    searchRank: 3,
    bsr: 120,
    subCategoryBsr: 8,
    estimatedMonthlySales: 5600,
    estimatedMonthlyRevenueUsd: 223944,
    variationCount: 4,
    reviewRate: 12.5,
    grossMargin: 35.2,
    listingDate: "2023-05-01",
    sellerCount: 2,
    fulfillment: "FBA",
    seller: "HydroJug Inc.",
    ...overrides,
  };
}

function validRow(overrides: Record<string, unknown> = {}): SellerSpritePluginRow {
  const result = validateSellerSpritePluginRows([fullRow(overrides)]);
  if (!result.ok) throw new Error(`fixture should validate: ${result.error.code}`);
  return result.rows[0];
}

describe("SellerSprite Plugin Contract", () => {
  describe("panel column whitelist", () => {
    it("exposes the 22 panel columns plus subCategoryBsr", () => {
      expect(SELLERSPRITE_PLUGIN_PANEL_COLUMNS).toHaveLength(22);
      expect(SELLERSPRITE_PLUGIN_FIELD_KEYS).toHaveLength(23);
      expect(SELLERSPRITE_PLUGIN_FIELD_KEYS).toEqual([...SELLERSPRITE_PLUGIN_PANEL_COLUMNS, "subCategoryBsr"]);
    });
  });

  describe("validateSellerSpritePluginRows", () => {
    it("accepts a full row and normalizes identity fields", () => {
      const result = validateSellerSpritePluginRows([fullRow()]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = result.rows[0];
      expect(row.asin).toBe("B0TEST0001");
      expect(row.title).toBe("HydroJug Travel Tumbler 40oz");
      expect(row.productUrl).toBe("https://www.amazon.com/dp/B0TEST0001");
      expect(row.priceUsd).toBe(39.99);
      expect(row.rating).toBe(4.6);
      expect(row.reviewCount).toBe(1234);
      expect(row.bsr).toBe(120);
      expect(row.subCategoryBsr).toBe(8);
      expect(row.estimatedMonthlySales).toBe(5600);
      expect(row.estimatedMonthlyRevenueUsd).toBe(223944);
      expect(row.variationCount).toBe(4);
      expect(row.reviewRate).toBe(12.5);
      expect(row.grossMargin).toBe(35.2);
      expect(row.listingDate).toBe("2023-05-01");
      expect(row.sellerCount).toBe(2);
      expect(row.fulfillment).toBe("FBA");
      expect(row.seller).toBe("HydroJug Inc.");
      expect(row.parentAsin).toBe("B0PARENT01");
      expect(row.sku).toBe("HJ-40-BLK");
    });

    it("accepts a minimal row with only required fields", () => {
      const result = validateSellerSpritePluginRows([{ asin: "B0TEST0001", title: "T", productUrl: "https://www.amazon.com/dp/B0TEST0001" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.rows[0].priceUsd).toBeNull();
      expect(result.rows[0].rating).toBeNull();
      expect(result.rows[0].bsr).toBeNull();
      expect(result.rows[0].seller).toBeNull();
    });

    it("coerces panel-formatted numbers ($, thousands, trailing %)", () => {
      const result = validateSellerSpritePluginRows([fullRow({
        priceUsd: "$39.99",
        estimatedMonthlyRevenueUsd: "223,944",
        reviewRate: "12.5%",
        grossMargin: "-8.2%",
        rating: "4.6",
      })]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = result.rows[0];
      expect(row.priceUsd).toBe(39.99);
      expect(row.estimatedMonthlyRevenueUsd).toBe(223944);
      expect(row.reviewRate).toBe(12.5);
      expect(row.grossMargin).toBe(-8.2);
      expect(row.rating).toBe(4.6);
    });

    it("treats panel null-placeholders as missing", () => {
      const result = validateSellerSpritePluginRows([fullRow({
        priceUsd: "-",
        rating: "--",
        sellerCount: "N/A",
        fulfillment: "",
        brand: "n/a",
      })]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = result.rows[0];
      expect(row.priceUsd).toBeNull();
      expect(row.rating).toBeNull();
      expect(row.sellerCount).toBeNull();
      expect(row.fulfillment).toBeNull();
      expect(row.brand).toBeNull();
    });

    it("rejects a non-array body", () => {
      const result = validateSellerSpritePluginRows({ asin: "B0TEST0001" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_rows_not_array");
    });

    it("rejects an empty array", () => {
      const result = validateSellerSpritePluginRows([]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_rows_empty");
    });

    it(`rejects more than ${SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS} rows`, () => {
      const rows = Array.from({ length: SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS + 1 }, (_, index) => fullRow({
        asin: `B0TEST${String(index).padStart(4, "0")}`,
        productUrl: `https://www.amazon.com/dp/B0TEST${String(index).padStart(4, "0")}`,
      }));
      const result = validateSellerSpritePluginRows(rows);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_rows_too_many");
    });

    it("rejects a non-object row", () => {
      const result = validateSellerSpritePluginRows(["not-an-object"]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_row_not_object");
    });

    it("rejects unknown (out-of-whitelist) fields", () => {
      const result = validateSellerSpritePluginRows([fullRow({ maliciousField: "x" })]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_unknown_field");
      expect(result.error.rowIndex).toBe(0);
    });

    it("rejects a missing required field", () => {
      const { productUrl: _omit, ...row } = fullRow();
      void _omit;
      const result = validateSellerSpritePluginRows([row]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_missing_required_field");
      expect(result.error.field).toBe("productUrl");
    });

    it("rejects an invalid ASIN", () => {
      for (const asin of ["B0TEST", "B0TEST0001!", "B0TEST0001X1"]) {
        const result = validateSellerSpritePluginRows([fullRow({ asin })]);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error.code).toBe("plugin_invalid_asin");
      }
    });

    it("normalizes lowercase ASIN to uppercase", () => {
      const result = validateSellerSpritePluginRows([fullRow({ asin: "b0test0001" })]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.rows[0].asin).toBe("B0TEST0001");
    });

    it("rejects a non-HTTPS product URL", () => {
      const result = validateSellerSpritePluginRows([fullRow({ productUrl: "http://www.amazon.com/dp/B0TEST0001" })]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("plugin_invalid_product_url");
    });

    it("rejects wrong field types", () => {
      for (const [field, value] of [
        ["priceUsd", "not-a-number"],
        ["rating", true],
        ["reviewCount", {}],
        ["listingDate", ["2023-05-01"]],
      ] as const) {
        const result = validateSellerSpritePluginRows([fullRow({ [field]: value })]);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error.code).toBe("plugin_invalid_field_type");
      }
      // title 非文本在必填检查阶段即拒绝。
      const badTitle = validateSellerSpritePluginRows([fullRow({ title: 42 })]);
      expect(badTitle.ok).toBe(false);
      if (!badTitle.ok) expect(badTitle.error.code).toBe("plugin_missing_required_field");
    });

    it("rejects out-of-range values", () => {
      for (const [field, value] of [
        ["rating", 5.1],
        ["rating", -0.1],
        ["reviewRate", 100.5],
        ["priceUsd", -1],
        ["searchRank", 0],
        ["bsr", 0],
        ["sellerCount", 0],
        ["estimatedMonthlySales", 1.5],
        ["variationCount", -2],
      ] as const) {
        const result = validateSellerSpritePluginRows([fullRow({ [field]: value })]);
        expect(result.ok).toBe(false);
        if (result.ok) continue;
        expect(result.error.code).toBe("plugin_invalid_field_value");
      }
    });

    it("accepts negative gross margin (loss-leader products)", () => {
      const result = validateSellerSpritePluginRows([fullRow({ grossMargin: -15.5 })]);
      expect(result.ok).toBe(true);
    });
  });

  describe("mapPluginRowToSellerSpriteImportRow", () => {
    it("maps identity + snapshot fields and reuses the frozen rowHash", () => {
      const row = validRow();
      const mapped = mapPluginRowToSellerSpriteImportRow(row, 2, CAPTURED_AT);
      expect(mapped.rowNumber).toBe(3);
      expect(mapped.rowHash).toBe(computeSellerSpriteRowHash({
        rowNumber: 3,
        asin: "B0TEST0001",
        title: row.title,
        amazonUrl: row.productUrl,
      }));
      expect(mapped.asin).toBe("B0TEST0001");
      expect(mapped.parentAsin).toBe("B0PARENT01");
      expect(mapped.amazonUrl).toBe("https://www.amazon.com/dp/B0TEST0001");
      expect(mapped.priceUsd).toBe(39.99);
      expect(mapped.rating).toBe(4.6);
      expect(mapped.reviewCount).toBe(1234);
      expect(mapped.searchRank).toBe(3);
      expect(mapped.estimatedMonthlySales).toBe(5600);
      expect(mapped.estimatedMonthlyRevenueUsd).toBe(223944);
      expect(mapped.skuRaw).toBe("HJ-40-BLK");
    });

    it("carries pluginCapture with subtype + panel-only metrics", () => {
      const mapped = mapPluginRowToSellerSpriteImportRow(validRow(), 0, CAPTURED_AT);
      expect(mapped.pluginCapture).toEqual({
        subtype: SELLERSPRITE_PLUGIN_SOURCE_SUBTYPE,
        capturedAt: CAPTURED_AT,
        bsr: 120,
        subCategoryBsr: 8,
        variationCount: 4,
        reviewRate: 12.5,
        grossMargin: 35.2,
        listingDate: "2023-05-01",
        sellerCount: 2,
        fulfillment: "FBA",
        seller: "HydroJug Inc.",
      });
    });

    it("is deterministic for the same index and row", () => {
      const a = mapPluginRowToSellerSpriteImportRow(validRow(), 0, CAPTURED_AT);
      const b = mapPluginRowToSellerSpriteImportRow(validRow(), 0, CAPTURED_AT);
      expect(a.rowHash).toBe(b.rowHash);
    });
  });

  describe("sourceMeta subtype bridge (import contract extension)", () => {
    it("round-trips subtype + plugin extras through the frozen source meta", () => {
      const row = mapPluginRowToSellerSpriteImportRow(validRow(), 0, CAPTURED_AT);
      const metaJson = buildSellerSpriteCandidateSourceMeta(row, SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256, "2026-08-20T09:00:00.000Z");
      const parsed = parseSellerSpriteCandidateSourceMeta(metaJson);
      expect(parsed).not.toBeNull();
      expect(parsed!.source.type).toBe("sellersprite_xlsx");
      expect(parsed!.source.subtype).toBe("sellersprite_plugin");
      expect(parsed!.source.sourceFileSha256).toBe(SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256);
      expect(parsed!.source.rowHash).toBe(row.rowHash);
      expect(parsed!.identity.asin).toBe("B0TEST0001");
      expect(parsed!.plugin).toEqual(row.pluginCapture);
      expect(parsed!.sourceRaw?.sku).toBe("HJ-40-BLK");
    });

    it("stays backward compatible: XLSX rows keep no subtype/plugin keys", () => {
      const xlsxRow = {
        rowHash: computeSellerSpriteRowHash({ rowNumber: 2, asin: "B0TEST0001", title: "T", amazonUrl: "https://www.amazon.com/dp/B0TEST0001" }),
        rowNumber: 2,
        asin: "B0TEST0001",
        parentAsin: null,
        title: "T",
        amazonUrl: "https://www.amazon.com/dp/B0TEST0001",
        imageUrl: null,
        priceUsd: 19.99,
        rating: 4.5,
        reviewCount: 100,
        brand: null,
        category: null,
        searchRank: null,
        estimatedMonthlySales: null,
        estimatedMonthlyRevenueUsd: null,
      };
      const parsed = parseSellerSpriteCandidateSourceMeta(buildSellerSpriteCandidateSourceMeta(xlsxRow, "f".repeat(64), "2026-08-20T09:00:00.000Z"));
      expect(parsed).not.toBeNull();
      expect(parsed!.source.subtype).toBeUndefined();
      expect(parsed!.plugin).toBeUndefined();
      expect(parsed!.source.type).toBe("sellersprite_xlsx");
    });

    it("uses a deterministic 64-hex synthetic sourceFileSha256", () => {
      expect(SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256).toMatch(/^[a-f0-9]{64}$/);
      expect(SELLERSPRITE_PLUGIN_SOURCE_FILE_SHA256).toBe(
        createHash("sha256").update("sellersprite-plugin-capture-v1").digest("hex").toLowerCase(),
      );
    });
  });

  describe("digests", () => {
    it("is deterministic and differs across row sets", () => {
      const rowA = mapPluginRowToSellerSpriteImportRow(validRow(), 0, null);
      const rowB = mapPluginRowToSellerSpriteImportRow(validRow({ asin: "B0TEST0002", productUrl: "https://www.amazon.com/dp/B0TEST0002" }), 1, null);
      const digest = sellerSpritePluginAcceptedRowsDigest([rowA]);
      expect(digest).toBe(sellerSpritePluginAcceptedRowsDigest([rowA]));
      expect(digest).not.toBe(sellerSpritePluginAcceptedRowsDigest([rowA, rowB]));
      expect(sellerSpritePluginWarningDigest()).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe("validateSellerSpritePluginSelectedRowHashes", () => {
    const hash = "a".repeat(64);
    it("accepts 1..50 unique 64-hex hashes", () => {
      expect(validateSellerSpritePluginSelectedRowHashes([hash]).ok).toBe(true);
      const many = Array.from({ length: SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS }, () => hash);
      // duplicates → invalid
      expect(validateSellerSpritePluginSelectedRowHashes(many).ok).toBe(false);
      const unique = Array.from({ length: SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS }, (_, index) =>
        String(index).padStart(64, "0"));
      expect(validateSellerSpritePluginSelectedRowHashes(unique).ok).toBe(true);
    });

    it("rejects non-array, empty, non-hash, and duplicate entries", () => {
      expect(validateSellerSpritePluginSelectedRowHashes("x").ok).toBe(false);
      expect(validateSellerSpritePluginSelectedRowHashes([]).ok).toBe(false);
      expect(validateSellerSpritePluginSelectedRowHashes(["not-a-hash"]).ok).toBe(false);
      expect(validateSellerSpritePluginSelectedRowHashes([hash, hash]).ok).toBe(false);
      const over = Array.from({ length: SELLERSPRITE_PLUGIN_IMPORT_MAX_ROWS + 1 }, (_, index) => `${index}`.repeat(64));
      expect(validateSellerSpritePluginSelectedRowHashes(over).ok).toBe(false);
    });
  });

  describe("identity key prefix reuse", () => {
    it("reuses the XLSX chain marketplace:asin idempotency key", () => {
      const row = mapPluginRowToSellerSpriteImportRow(validRow(), 0, null);
      expect(`${SELLERSPRITE_IMPORT_MARKETPLACE}:${row.asin}`).toBe("Amazon US:B0TEST0001");
    });
  });
});
