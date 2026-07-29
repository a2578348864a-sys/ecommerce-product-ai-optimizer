import { describe, expect, it } from "vitest";

import {
  parseXlsxEmbeddedImages,
} from "@/lib/upstream/sellersprite/xlsx";
import { createSellerSpritePreviewTestWorkbook } from "@/tools/upstream/sellersprite-preview/test-fixtures";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

describe("SellerSprite OOXML embedded images", () => {
  it("resolves worksheet drawings and binds JPEG/PNG bytes to exact data rows", () => {
    const result = parseXlsxEmbeddedImages(createSellerSpritePreviewTestWorkbook({
      embeddedImages: [
        { rowIndex: 1, columnIndex: 1, bytes: JPEG_BYTES, mediaName: "misleading.png" },
        { rowIndex: 2, columnIndex: 1, bytes: PNG_BYTES, mediaName: "second.jpeg" },
      ],
    }), "US");

    expect(result.rejected).toEqual([]);
    expect(result.images).toHaveLength(2);
    expect(result.images.map((image) => ({
      rowNumber: image.rowNumber,
      columnIndex: image.columnIndex,
      mimeType: image.mimeType,
      byteLength: image.byteLength,
    }))).toEqual([
      { rowNumber: 2, columnIndex: 1, mimeType: "image/jpeg", byteLength: JPEG_BYTES.length },
      { rowNumber: 3, columnIndex: 1, mimeType: "image/png", byteLength: PNG_BYTES.length },
    ]);
    expect(result.images[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects SVG, damaged bytes, and images above the 2 MiB bound without trusting extensions", () => {
    const result = parseXlsxEmbeddedImages(createSellerSpritePreviewTestWorkbook({
      embeddedImages: [
        {
          rowIndex: 1,
          columnIndex: 1,
          bytes: Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
        },
        { rowIndex: 2, columnIndex: 1, bytes: Buffer.from("not an image") },
        {
          rowIndex: 1,
          columnIndex: 1,
          bytes: Buffer.concat([JPEG_BYTES, Buffer.alloc(2 * 1024 * 1024)]),
          mediaName: "large.jpg",
        },
      ],
    }), "US");

    expect(result.images).toEqual([]);
    expect(result.rejected.map((item) => item.reason)).toEqual([
      "unsupported_image_type",
      "unsupported_image_type",
      "image_too_large",
    ]);
  });

  it("fails closed for an anchor outside the worksheet and for a missing media relationship target", () => {
    const outOfBounds = createSellerSpritePreviewTestWorkbook({
      embeddedImages: [{ rowIndex: 99, columnIndex: 1, bytes: JPEG_BYTES }],
    });
    expect(() => parseXlsxEmbeddedImages(outOfBounds, "US")).toThrowError(
      expect.objectContaining({ code: "xlsx_drawing_anchor_out_of_bounds" }),
    );

    const missingTarget = createSellerSpritePreviewTestWorkbook({
      embeddedImages: [{
        rowIndex: 1,
        columnIndex: 1,
        bytes: JPEG_BYTES,
        relationshipTarget: "../media/missing.png",
      }],
    });
    expect(() => parseXlsxEmbeddedImages(missingTarget, "US")).toThrowError(
      expect.objectContaining({ code: "invalid_xlsx" }),
    );
  });

  it("preserves multiple same-row anchors so the import layer can apply one explicit main-image rule", () => {
    const result = parseXlsxEmbeddedImages(createSellerSpritePreviewTestWorkbook({
      embeddedImages: [
        { rowIndex: 1, columnIndex: 1, bytes: JPEG_BYTES },
        { rowIndex: 1, columnIndex: 2, bytes: PNG_BYTES },
      ],
    }), "US");

    expect(result.images.map((image) => [image.rowNumber, image.columnIndex])).toEqual([
      [2, 1],
      [2, 2],
    ]);
  });
});
