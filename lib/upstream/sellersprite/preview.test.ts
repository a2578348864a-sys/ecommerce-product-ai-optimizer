import { describe, expect, it } from "vitest";
import { createSellerSpritePreviewWorkbook } from "./previewTestFixtures";
import { precheckSellerSpritePreview, SellerSpritePreviewError } from "./preview";

const headers = [
  "ASIN",
  "父ASIN",
  "商品标题",
  "商品详情页链接",
  "商品主图",
  "价格($)",
  "评分",
  "评分数",
  "品牌",
  "类目路径",
  "搜索排名",
  "月销量",
  "月销售额($)",
];

const validRow: Array<string | null> = [
  "B0TEST0001",
  "B0PARENT01",
  "Test product",
  "https://www.amazon.com/dp/B0TEST0001?tag=example",
  "https://images.example.test/product.jpg",
  "$19.99",
  "4.5",
  "123",
  "Example Brand",
  "Home & Kitchen > Test",
  "12",
  "321",
  "$4567.89",
];

const safeWorksheetHyperlinkRelationships = [
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="synthetic-link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" TargetMode="External" Target="https://example.com/relationship-only-marker"/>',
  "</Relationships>",
].join("");

function expectPrecheckFailure(input: Uint8Array, code: SellerSpritePreviewError["code"]): void {
  try {
    precheckSellerSpritePreview(input);
    throw new Error("expected preview precheck to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(SellerSpritePreviewError);
    expect((error as SellerSpritePreviewError).code).toBe(code);
  }
}

describe("SellerSprite Amazon US Search Results preview precheck", () => {
  it("returns only allowlisted facts, snapshots, estimates, statuses, and a stable source hash", () => {
    const source = createSellerSpritePreviewWorkbook({
      headers: [...headers, "Note", "Brands", "Sellers"],
      rows: [[...validRow, "private note", "unrelated brands", "unrelated sellers"]],
      extraEntries: [{
        name: "xl/worksheets/_rels/sheet1.xml.rels",
        content: safeWorksheetHyperlinkRelationships,
      }],
    });
    const result = precheckSellerSpritePreview(source);

    expect(result.schemaVersion).toBe("sellersprite_preview_v1");
    expect(result.source).toMatchObject({
      sourceProvider: "SellerSprite",
      sourceType: "sellersprite_xlsx",
      marketplace: "Amazon US",
      reportType: "SellerSprite Search Results",
      currency: "USD",
    });
    expect(result.source.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.acceptedRows).toEqual([expect.objectContaining({
      rowNumber: 2,
      facts: {
        asin: "B0TEST0001",
        parentAsin: "B0PARENT01",
        title: "Test product",
        amazonUrl: "https://www.amazon.com/dp/B0TEST0001?tag=example",
        imageUrl: "https://images.example.test/product.jpg",
        priceUsd: 19.99,
        rating: 4.5,
        reviewCount: 123,
        brand: "Example Brand",
        category: "Home & Kitchen > Test",
      },
      estimates: {
        searchRank: 12,
        estimatedMonthlySales: 321,
        estimatedMonthlyRevenueUsd: 4567.89,
      },
      fieldStatus: expect.objectContaining({
        asin: "source_fact",
        priceUsd: "snapshot",
        searchRank: "third_party_estimate",
      }),
      missingFields: [],
    })]);
    expect(precheckSellerSpritePreview(source).source.sourceFileSha256).toBe(result.source.sourceFileSha256);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "extraRaw",
      "private note",
      "unrelated brands",
      "unrelated sellers",
      "relationship-only-marker",
      "Note",
      "Sellers",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("fails closed for a non-unique, incomplete, or non-US Search Results layout", () => {
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({
      headers: [...headers, "ASIN"],
      rows: [validRow],
    }), "ambiguous_header");
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({
      headers: headers.filter((header) => header !== "商品详情页链接"),
      rows: [validRow.filter((_, index) => index !== 3)],
    }), "missing_required_column");
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({
      headers,
      rows: [validRow],
      sheetName: "US Search Results",
    }), "unsupported_report_layout");
  });

  it("quarantines invalid rows while retaining safe rows and preserves missing versus unknown", () => {
    const badAsin = [...validRow];
    badAsin[0] = "invalid";
    const missingImage = [...validRow];
    missingImage[4] = null;
    const result = precheckSellerSpritePreview(createSellerSpritePreviewWorkbook({
      headers,
      rows: [validRow, badAsin, missingImage],
    }));
    expect(result.acceptedRowCount).toBe(2);
    expect(result.rejectedRows).toContainEqual(expect.objectContaining({
      rowNumber: 3,
      status: "invalid",
      reasons: expect.arrayContaining([
        { code: "invalid_asin", field: "asin" },
        { code: "asin_url_mismatch", field: "amazonUrl" },
      ]),
    }));
    expect(result.acceptedRows[1].missingFields).toContain("imageUrl");
    expect(result.acceptedRows[1].fieldStatus.imageUrl).toBe("missing");

    const unknownImage = [...validRow];
    unknownImage[4] = "unknown";
    const unknown = precheckSellerSpritePreview(createSellerSpritePreviewWorkbook({ headers, rows: [unknownImage] }));
    expect(unknown.acceptedRows[0].missingFields).toContain("imageUrl");
    expect(unknown.acceptedRows[0].fieldStatus.imageUrl).toBe("unknown");

    const invalidImage = [...validRow];
    invalidImage[4] = "http://image.example.test/not-https.jpg";
    const isolated = precheckSellerSpritePreview(createSellerSpritePreviewWorkbook({ headers, rows: [validRow, invalidImage] }));
    expect(isolated.rejectedRows).toContainEqual({
      rowNumber: 3,
      status: "invalid",
      reasons: [{ code: "invalid_image_url", field: "imageUrl" }],
    });
  });

  it("rejects invalid identity, Amazon URL, parent ASIN, image URL, and USD values", () => {
    const invalidParent = [...validRow];
    invalidParent[1] = "parent";
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({ headers, rows: [invalidParent] }), "no_valid_rows");

    const mismatch = [...validRow];
    mismatch[3] = "https://www.amazon.com/dp/B0OTHER000";
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({ headers, rows: [mismatch] }), "no_valid_rows");

    const invalidPrice = [...validRow];
    invalidPrice[5] = "€19.99";
    expectPrecheckFailure(createSellerSpritePreviewWorkbook({ headers, rows: [invalidPrice] }), "no_valid_rows");
  });

  it("shows duplicate ASINs and blocks key conflicts without selecting a winner", () => {
    const same = precheckSellerSpritePreview(createSellerSpritePreviewWorkbook({ headers, rows: [validRow, validRow] }));
    expect(same.duplicates).toEqual([{
      asin: "B0TEST0001",
      rowNumbers: [2, 3],
      hasCriticalConflict: false,
      conflictStatus: "none",
    }]);
    expect(same.blockingErrors).toEqual([]);

    const conflicting = [...validRow];
    conflicting[5] = "$20.99";
    const blocked = precheckSellerSpritePreview(createSellerSpritePreviewWorkbook({ headers, rows: [validRow, conflicting] }));
    expect(blocked.blockingErrors).toEqual([{
      code: "duplicate_asin_conflict",
      status: "conflict",
      asin: "B0TEST0001",
      rowNumbers: [2, 3],
    }]);
    expect(blocked.acceptedRows).toHaveLength(2);
  });
});
