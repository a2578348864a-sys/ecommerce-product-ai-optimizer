import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ProductResearchImageConflictError,
  buildAuthoritativeProductImageSnapshot,
  mergeCandidateProductImageSnapshot,
  parseProductImageSnapshot,
  readCandidateProductImageSnapshot,
  resolveResearchTaskProductImage,
} from "@/lib/productResearchImage";

const PRODUCT_KEY = "amazon:US:B012345678";
const OTHER_PRODUCT_KEY = "amazon:US:B087654321";
const IDENTITY_HASH = "1".repeat(64);
const OTHER_IDENTITY_HASH = "2".repeat(64);
const CAPTURED_AT = "2026-07-28T01:00:00.000Z";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

function snapshot(overrides: Partial<Parameters<typeof buildAuthoritativeProductImageSnapshot>[0]> = {}) {
  return buildAuthoritativeProductImageSnapshot({
    dataUrl: PNG_DATA_URL,
    productKey: PRODUCT_KEY,
    candidateIdentityHash: IDENTITY_HASH,
    capturedAt: CAPTURED_AT,
    ...overrides,
  });
}

function candidateSourceMeta(image = snapshot()) {
  return JSON.stringify({
    marketScreeningIdentity: {
      productKey: image.productKey,
      identityHash: image.candidateIdentityHash,
    },
    productImageSnapshot: image,
  });
}

describe("authoritative product research image contract", () => {
  it("accepts a verified PNG data URL and binds MIME, size and SHA-256", () => {
    const image = snapshot();

    expect(image).toMatchObject({
      version: "market-screening-product-image.v1",
      source: "stage15_screening_preview_cache",
      status: "available",
      productKey: PRODUCT_KEY,
      candidateIdentityHash: IDENTITY_HASH,
      mimeType: "image/png",
      bytes: PNG_BYTES.length,
      contentHash: createHash("sha256").update(PNG_BYTES).digest("hex"),
      capturedAt: CAPTURED_AT,
    });
    expect(parseProductImageSnapshot(image)).toEqual(image);
  });

  it.each([
    ["remote hotlink", "https://example.com/product.png"],
    ["unsupported MIME", `data:image/gif;base64,${PNG_BYTES.toString("base64")}`],
    ["MIME and magic mismatch", `data:image/jpeg;base64,${PNG_BYTES.toString("base64")}`],
    ["non-canonical base64", `data:image/png;base64,${PNG_BYTES.toString("base64")}=`],
  ])("rejects %s", (_label, dataUrl) => {
    expect(() => snapshot({ dataUrl })).toThrow();
  });

  it("rejects oversized content and a forged content hash", () => {
    const oversized = Buffer.concat([
      PNG_BYTES,
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    expect(() => snapshot({
      dataUrl: `data:image/png;base64,${oversized.toString("base64")}`,
    })).toThrow();

    expect(parseProductImageSnapshot({
      ...snapshot(),
      contentHash: "f".repeat(64),
    })).toBeNull();
  });

  it("reuses the same image, fills a missing snapshot, and fails closed on hash conflict", () => {
    const image = snapshot();
    const emptyMeta = JSON.stringify({
      marketScreeningIdentity: {
        productKey: PRODUCT_KEY,
        identityHash: IDENTITY_HASH,
      },
    });
    const filled = mergeCandidateProductImageSnapshot(emptyMeta, image);
    expect(filled.changed).toBe(true);
    expect(parseProductImageSnapshot(JSON.parse(filled.sourceMetaJson).productImageSnapshot)).toEqual(image);

    const reused = mergeCandidateProductImageSnapshot(filled.sourceMetaJson, image);
    expect(reused).toEqual({ changed: false, sourceMetaJson: filled.sourceMetaJson });

    const conflicting = snapshot({
      dataUrl: `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.from([1])]).toString("base64")}`,
    });
    expect(() => mergeCandidateProductImageSnapshot(filled.sourceMetaJson, conflicting))
      .toThrow(ProductResearchImageConflictError);
  });

  it("reads a hash-verified cached image from a ProductBatch Candidate snapshot", () => {
    const contentHash = createHash("sha256").update(PNG_BYTES).digest("hex");
    const image = readCandidateProductImageSnapshot(JSON.stringify({
      version: "product-batch-candidate-source.v1",
      originKind: "seller_sprite_product_batch",
      productKey: PRODUCT_KEY,
      itemIdentityHash: IDENTITY_HASH,
      capturedAt: CAPTURED_AT,
      imageSnapshot: {
        status: "cached",
        mimeType: "image/png",
        sizeBytes: PNG_BYTES.length,
        sha256: contentHash,
        base64: PNG_BYTES.toString("base64"),
      },
    }));

    expect(image).toMatchObject({
      version: "product-batch-product-image.v1",
      source: "sellersprite_product_batch",
      productKey: PRODUCT_KEY,
      candidateIdentityHash: IDENTITY_HASH,
      bytes: PNG_BYTES.length,
      contentHash,
    });
    expect(image?.dataUrl).toBe(PNG_DATA_URL);
    expect(parseProductImageSnapshot(image)).toEqual(image);
  });
});

describe("research task image resolution", () => {
  it("prefers the immutable Task snapshot over a changed Candidate image", () => {
    const fixed = snapshot();
    const changed = snapshot({
      dataUrl: `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.from([2])]).toString("base64")}`,
    });
    const result = {
      sourceMeta: {
        source: "opportunity",
        candidateId: "candidate-1",
        candidateSnapshot: {
          version: 1,
          id: "candidate-1",
          identityHash: IDENTITY_HASH,
          productImageSnapshot: fixed,
        },
      },
      candidateToTask: { version: 1, candidateId: "candidate-1" },
    };

    expect(resolveResearchTaskProductImage({
      taskResult: result,
      candidates: [{ id: "candidate-1", sourceMetaJson: candidateSourceMeta(changed) }],
    })).toMatchObject({
      provenance: "task_snapshot",
      contentHash: fixed.contentHash,
      dataUrl: fixed.dataUrl,
    });
  });

  it("uses an exact candidateId fallback for old Tasks and never fuzzy-matches same-title products", () => {
    const result = {
      productName: "Same Product Title",
      sourceMeta: { source: "opportunity", candidateId: "candidate-b" },
    };
    const imageA = snapshot();
    const imageB = snapshot({
      productKey: OTHER_PRODUCT_KEY,
      candidateIdentityHash: OTHER_IDENTITY_HASH,
      dataUrl: `data:image/png;base64,${Buffer.concat([PNG_BYTES, Buffer.from([3])]).toString("base64")}`,
    });

    expect(resolveResearchTaskProductImage({
      taskResult: result,
      candidates: [
        { id: "candidate-a", name: "Same Product Title", sourceMetaJson: candidateSourceMeta(imageA) },
        { id: "candidate-b", name: "Same Product Title", sourceMetaJson: candidateSourceMeta(imageB) },
      ],
    })).toMatchObject({
      provenance: "candidate_fallback",
      contentHash: imageB.contentHash,
    });

    expect(resolveResearchTaskProductImage({
      taskResult: { productName: "Same Product Title" },
      candidates: [
        { id: "candidate-a", name: "Same Product Title", sourceMetaJson: candidateSourceMeta(imageA) },
      ],
    })).toBeNull();
  });

  it("returns placeholder state for broken binding, invalid Candidate image or cross-tenant absence", () => {
    const image = snapshot();
    const brokenTask = {
      sourceMeta: {
        source: "opportunity",
        candidateId: "candidate-1",
        candidateSnapshot: {
          version: 1,
          id: "candidate-other",
          identityHash: IDENTITY_HASH,
          productImageSnapshot: image,
        },
      },
    };
    expect(resolveResearchTaskProductImage({ taskResult: brokenTask, candidates: [] })).toBeNull();

    expect(resolveResearchTaskProductImage({
      taskResult: { sourceMeta: { source: "opportunity", candidateId: "candidate-1" } },
      candidates: [{
        id: "candidate-1",
        sourceMetaJson: candidateSourceMeta({ ...image, contentHash: "f".repeat(64) } as typeof image),
      }],
    })).toBeNull();

    expect(resolveResearchTaskProductImage({
      taskResult: { sourceMeta: { source: "opportunity", candidateId: "owner-candidate" } },
      candidates: [{ id: "visitor-candidate", sourceMetaJson: candidateSourceMeta(image) }],
    })).toBeNull();
  });
});
