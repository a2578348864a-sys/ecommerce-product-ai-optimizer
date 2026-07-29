import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readProductBatchItemImageSnapshot } from "@/lib/productBatchImagePresentation";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

describe("ProductBatch image presentation", () => {
  it("accepts only a cached JPEG/PNG byte snapshot", () => {
    const base64 = PNG_BYTES.toString("base64");
    const image = readProductBatchItemImageSnapshot(JSON.stringify({
      status: "cached",
      mimeType: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
      sha256: createHash("sha256").update(PNG_BYTES).digest("hex"),
      base64,
    }));

    expect(image).toMatchObject({
      dataUrl: `data:image/png;base64,${base64}`,
      mimeType: "image/png",
      provenance: "product_batch_snapshot",
    });
  });

  it("rejects remote references and invalid image signatures", () => {
    expect(readProductBatchItemImageSnapshot(JSON.stringify({
      status: "remote",
      url: "https://images.example.invalid/product.jpg",
    }))).toBeNull();
    expect(readProductBatchItemImageSnapshot(JSON.stringify({
      status: "cached",
      mimeType: "image/png",
      sizeBytes: 4,
      sha256: "a".repeat(64),
      base64: Buffer.from("fake").toString("base64"),
    }))).toBeNull();
  });
});
